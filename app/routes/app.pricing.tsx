import { useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  FREE_PLAN_MONTHLY_LIMIT,
  GROWTH_PLAN_PRICE,
  getOrCreateShopSettings,
} from "../services/shop-settings.server";
import {
  cancelGrowthSubscription,
  createGrowthSubscription,
  syncShopBillingPlan,
} from "../services/billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  let settings;
  try {
    settings = await syncShopBillingPlan(session.shop, admin);
  } catch {
    settings = await getOrCreateShopSettings(session.shop);
  }

  return {
    plan: settings.plan,
    monthlyAlertsUsed: settings.monthlyAlertsUsed,
    freeLimit: FREE_PLAN_MONTHLY_LIMIT,
    growthPrice: GROWTH_PLAN_PRICE,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent === "upgrade") {
    const appUrl =
      process.env.SHOPIFY_APP_URL || new URL(request.url).origin;
    const returnUrl = `${appUrl.replace(/\/$/, "")}/app/pricing`;
    const result = await createGrowthSubscription(admin, returnUrl);
    if (result.error) {
      return { ok: false, error: result.error };
    }
    return { ok: true, confirmationUrl: result.confirmationUrl };
  }

  if (intent === "downgrade") {
    const result = await cancelGrowthSubscription(session.shop, admin);
    if (!result.success) {
      return { ok: false, error: result.error || "Failed to cancel plan." };
    }
    return { ok: true, downgraded: true };
  }

  return { ok: false, error: "Invalid billing action." };
};

export default function PricingPage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const isSubmitting =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";

  useEffect(() => {
    if (fetcher.data?.confirmationUrl) {
      window.open(fetcher.data.confirmationUrl, "_top");
    } else if (fetcher.data?.downgraded) {
      shopify.toast.show("Switched back to Free plan");
    } else if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  return (
    <s-page heading="Plans &amp; Billing">
      <s-banner
        heading={
          data.plan === "growth"
            ? "Active Plan: StockPulse Growth ($9.99/mo)"
            : `Active Plan: Free ($0/mo) — ${data.monthlyAlertsUsed}/${data.freeLimit} alerts used this month`
        }
        tone={data.plan === "growth" ? "success" : "info"}
      >
        All subscriptions are billed natively through your monthly Shopify
        invoice in USD.
      </s-banner>

      <s-section heading="Choose your StockPulse plan">
        <s-grid gridTemplateColumns="repeat(2, 1fr)" gap="base">
          <s-grid-item>
            <s-box
              padding="large"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
            >
              <s-stack direction="block" gap="base">
                <s-stack direction="inline" gap="small" alignItems="center">
                  <s-heading>Free</s-heading>
                  {data.plan === "free" && (
                    <s-badge tone="info">Current Plan</s-badge>
                  )}
                </s-stack>
                <s-heading>$0 / month</s-heading>
                <s-unordered-list>
                  <s-list-item>Up to 30 restock email alerts / month</s-list-item>
                  <s-list-item>Online Store 2.0 Theme App Extension</s-list-item>
                  <s-list-item>Real-time inventory webhook tracking</s-list-item>
                  <s-list-item>Deduplicated waitlist capture</s-list-item>
                </s-unordered-list>
                {data.plan === "growth" && (
                  <s-button
                    variant="secondary"
                    onClick={() =>
                      fetcher.submit({ intent: "downgrade" }, { method: "POST" })
                    }
                    {...(isSubmitting ? { loading: true } : {})}
                  >
                    Switch to Free Plan
                  </s-button>
                )}
              </s-stack>
            </s-box>
          </s-grid-item>

          <s-grid-item>
            <s-box
              padding="large"
              borderWidth="base"
              borderRadius="base"
              background="base"
            >
              <s-stack direction="block" gap="base">
                <s-stack direction="inline" gap="small" alignItems="center">
                  <s-heading>Growth</s-heading>
                  {data.plan === "growth" ? (
                    <s-badge tone="success">Current Plan</s-badge>
                  ) : (
                    <s-badge tone="info">Recommended</s-badge>
                  )}
                </s-stack>
                <s-heading>${data.growthPrice.toFixed(2)} / month</s-heading>
                <s-unordered-list>
                  <s-list-item>Unlimited restock email alerts</s-list-item>
                  <s-list-item>Custom email subject &amp; sender name</s-list-item>
                  <s-list-item>One-click CSV waitlist export</s-list-item>
                  <s-list-item>Recaptured sales analytics</s-list-item>
                </s-unordered-list>
                {data.plan !== "growth" && (
                  <s-button
                    variant="primary"
                    onClick={() =>
                      fetcher.submit({ intent: "upgrade" }, { method: "POST" })
                    }
                    {...(isSubmitting ? { loading: true } : {})}
                  >
                    Upgrade to Growth ($9.99/mo)
                  </s-button>
                )}
              </s-stack>
            </s-box>
          </s-grid-item>
        </s-grid>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
