import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  FREE_PLAN_MONTHLY_LIMIT,
  getOrCreateShopSettings,
} from "../services/shop-settings.server";
import { syncShopBillingPlan } from "../services/billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  let settings;
  try {
    settings = await syncShopBillingPlan(shop, admin);
  } catch {
    settings = await getOrCreateShopSettings(shop);
  }

  const url = new URL(request.url);
  const searchQuery = (url.searchParams.get("q") || "").trim();
  const productFilter = (url.searchParams.get("product") || "all").trim();
  const statusFilter = (url.searchParams.get("status") || "all").trim();

  const [
    pendingCount,
    notifiedSubscribers,
    allProducts,
    filteredSubscribers,
  ] = await Promise.all([
    db.waitlistSubscriber.count({
      where: { shop, status: "pending" },
    }),
    db.waitlistSubscriber.findMany({
      where: { shop, status: "notified" },
      select: { variantPrice: true },
    }),
    db.waitlistSubscriber.findMany({
      where: { shop },
      distinct: ["productTitle"],
      select: { productTitle: true },
      orderBy: { productTitle: "asc" },
    }),
    db.waitlistSubscriber.findMany({
      where: {
        shop,
        ...(statusFilter !== "all" ? { status: statusFilter } : {}),
        ...(productFilter !== "all" ? { productTitle: productFilter } : {}),
        ...(searchQuery
          ? {
              OR: [
                { email: { contains: searchQuery, mode: "insensitive" } },
                { productTitle: { contains: searchQuery, mode: "insensitive" } },
                { variantTitle: { contains: searchQuery, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  const estimatedRecapturedSales = notifiedSubscribers.reduce(
    (sum, item) => sum + (item.variantPrice ?? 0),
    0,
  );

  return {
    shop,
    plan: settings.plan,
    monthlyAlertsUsed: settings.monthlyAlertsUsed,
    monthlyLimit:
      settings.plan === "growth" ? null : FREE_PLAN_MONTHLY_LIMIT,
    metrics: {
      pendingCount,
      alertsSentThisMonth: settings.monthlyAlertsUsed,
      notifiedCount: notifiedSubscribers.length,
      estimatedRecapturedSales,
    },
    products: allProducts.map((p) => p.productTitle),
    filters: {
      q: searchQuery,
      product: productFilter,
      status: statusFilter,
    },
    subscribers: filteredSubscribers.map((sub) => ({
      id: sub.id,
      email: sub.email,
      productTitle: sub.productTitle,
      variantTitle: sub.variantTitle,
      variantPrice: sub.variantPrice,
      status: sub.status,
      createdAt: sub.createdAt.toISOString(),
      notifiedAt: sub.notifiedAt ? sub.notifiedAt.toISOString() : null,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");
  const subscriberId = String(formData.get("subscriberId") || "");

  if (!subscriberId) {
    return { ok: false, error: "Missing subscriber ID." };
  }

  if (intent === "cancel") {
    await db.waitlistSubscriber.updateMany({
      where: { id: subscriberId, shop: session.shop },
      data: { status: "cancelled" },
    });
    return { ok: true, message: "Subscriber alert cancelled." };
  }

  if (intent === "delete") {
    await db.waitlistSubscriber.deleteMany({
      where: { id: subscriberId, shop: session.shop },
    });
    return { ok: true, message: "Subscriber removed." };
  }

  return { ok: false, error: "Unsupported action." };
};

function statusBadgeTone(
  status: string,
): "success" | "info" | "neutral" {
  if (status === "notified") return "success";
  if (status === "pending") return "info";
  return "neutral";
}

export default function StockPulseDashboard() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  const shopify = useAppBridge();

  const [searchValue, setSearchValue] = useState(data.filters.q);
  const [productValue, setProductValue] = useState(data.filters.product);
  const [statusValue, setStatusValue] = useState(data.filters.status);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (fetcher.data?.message) {
      shopify.toast.show(fetcher.data.message);
    } else if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  const applyFilters = (q: string, product: string, status: string) => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (product && product !== "all") params.set("product", product);
    if (status && status !== "all") params.set("status", status);
    const qs = params.toString();
    navigate(qs ? `/app?${qs}` : "/app");
  };

  const handleExportCsv = async () => {
    if (data.plan !== "growth") {
      shopify.toast.show(
        "CSV export is included in the Growth plan ($9.99/mo).",
      );
      navigate("/app/pricing");
      return;
    }

    setExporting(true);
    try {
      const response = await fetch("/app/export");
      if (!response.ok) {
        throw new Error("Export failed");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "stockpulse-waitlist.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      shopify.toast.show("Waitlist CSV downloaded");
    } catch {
      shopify.toast.show("Could not export CSV. Please try again.", {
        isError: true,
      });
    } finally {
      setExporting(false);
    }
  };

  const nearQuota =
    data.monthlyLimit !== null &&
    data.monthlyAlertsUsed >= data.monthlyLimit - 5;
  const quotaReached =
    data.monthlyLimit !== null && data.monthlyAlertsUsed >= data.monthlyLimit;

  return (
    <s-page heading="StockPulse Back-in-Stock Dashboard">
      <s-button
        slot="primary-action"
        onClick={handleExportCsv}
        {...(exporting ? { loading: true } : {})}
      >
        {data.plan === "growth" ? "Export CSV" : "Export CSV (Growth)"}
      </s-button>
      <s-button
        slot="secondary-actions"
        variant="secondary"
        onClick={() => navigate("/app/settings")}
      >
        Customize Widget &amp; Email
      </s-button>

      {data.plan === "free" && nearQuota && (
        <s-banner
          heading={
            quotaReached
              ? "Monthly Free Plan Alert Limit Reached (30/30)"
              : `Approaching Monthly Free Limit (${data.monthlyAlertsUsed}/30 alerts used)`
          }
          tone={quotaReached ? "critical" : "warning"}
        >
          Upgrade to the Growth plan ($9.99/mo) for unlimited restock email
          alerts and one-click CSV exports.
          <s-button
            slot="secondary-actions"
            variant="secondary"
            onClick={() => navigate("/app/pricing")}
          >
            Upgrade to Growth
          </s-button>
        </s-banner>
      )}

      <s-section heading="Performance Overview">
        <s-grid gridTemplateColumns="repeat(3, 1fr)" gap="base">
          <s-grid-item>
            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
            >
              <s-stack direction="block" gap="small">
                <s-text tone="neutral">Total Waitlist (Pending)</s-text>
                <s-heading>{data.metrics.pendingCount}</s-heading>
                <s-text tone="neutral">Shoppers waiting for restock</s-text>
              </s-stack>
            </s-box>
          </s-grid-item>

          <s-grid-item>
            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
            >
              <s-stack direction="block" gap="small">
                <s-text tone="neutral">Alerts Sent This Month</s-text>
                <s-heading>
                  {data.monthlyLimit !== null
                    ? `${data.metrics.alertsSentThisMonth} / ${data.monthlyLimit}`
                    : data.metrics.alertsSentThisMonth}
                </s-heading>
                <s-text tone="neutral">
                  {data.plan === "growth" ? "Growth Plan (Unlimited)" : "Free Plan"}
                </s-text>
              </s-stack>
            </s-box>
          </s-grid-item>

          <s-grid-item>
            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
            >
              <s-stack direction="block" gap="small">
                <s-text tone="neutral">Est. Recaptured Sales</s-text>
                <s-heading>
                  ${data.metrics.estimatedRecapturedSales.toFixed(2)}
                </s-heading>
                <s-text tone="neutral">
                  {data.metrics.notifiedCount} restock notifications sent
                </s-text>
              </s-stack>
            </s-box>
          </s-grid-item>
        </s-grid>
      </s-section>

      <s-section heading="Waitlist Subscribers">
        <s-stack direction="block" gap="base">
          <s-grid gridTemplateColumns="2fr 1fr 1fr auto" gap="small" alignItems="end">
            <s-grid-item>
              <s-text-field
                label="Search email or product"
                value={searchValue}
                placeholder="customer@example.com or jacket..."
                onInput={(e) => {
                  const target = e.currentTarget as unknown as { value: string };
                  setSearchValue(target.value);
                }}
              />
            </s-grid-item>
            <s-grid-item>
              <s-select
                label="Product"
                value={productValue}
                onChange={(e) => {
                  const target = e.currentTarget as unknown as { value: string };
                  setProductValue(target.value);
                  applyFilters(searchValue, target.value, statusValue);
                }}
              >
                <s-option value="all">All products</s-option>
                {data.products.map((title) => (
                  <s-option key={title} value={title}>
                    {title}
                  </s-option>
                ))}
              </s-select>
            </s-grid-item>
            <s-grid-item>
              <s-select
                label="Status"
                value={statusValue}
                onChange={(e) => {
                  const target = e.currentTarget as unknown as { value: string };
                  setStatusValue(target.value);
                  applyFilters(searchValue, productValue, target.value);
                }}
              >
                <s-option value="all">All statuses</s-option>
                <s-option value="pending">Pending</s-option>
                <s-option value="notified">Notified</s-option>
                <s-option value="cancelled">Cancelled</s-option>
              </s-select>
            </s-grid-item>
            <s-grid-item>
              <s-button
                variant="secondary"
                onClick={() =>
                  applyFilters(searchValue, productValue, statusValue)
                }
              >
                Filter
              </s-button>
            </s-grid-item>
          </s-grid>

          {data.subscribers.length === 0 ? (
            <s-box
              padding="large"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
            >
              <s-stack direction="block" gap="small">
                <s-heading>No waitlist subscribers found</s-heading>
                <s-paragraph>
                  Add the StockPulse Notify Me block to your Product template in
                  Online Store &rarr; Themes &rarr; Customize to start capturing
                  out-of-stock demand.
                </s-paragraph>
              </s-stack>
            </s-box>
          ) : (
            <s-table variant="auto">
              <s-table-header-row>
                <s-table-header listSlot="primary">Customer Email</s-table-header>
                <s-table-header listSlot="labeled">Product</s-table-header>
                <s-table-header listSlot="labeled">Variant</s-table-header>
                <s-table-header listSlot="inline">Status</s-table-header>
                <s-table-header listSlot="secondary">Subscribed</s-table-header>
                <s-table-header listSlot="inline">Actions</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {data.subscribers.map((sub) => (
                  <s-table-row key={sub.id}>
                    <s-table-cell>{sub.email}</s-table-cell>
                    <s-table-cell>{sub.productTitle}</s-table-cell>
                    <s-table-cell>
                      {sub.variantTitle || "Default Title"}
                    </s-table-cell>
                    <s-table-cell>
                      <s-badge tone={statusBadgeTone(sub.status)}>
                        {sub.status}
                      </s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      {new Date(sub.createdAt).toLocaleDateString()}
                    </s-table-cell>
                    <s-table-cell>
                      <s-stack direction="inline" gap="small">
                        {sub.status === "pending" && (
                          <s-button
                            variant="tertiary"
                            onClick={() =>
                              fetcher.submit(
                                { intent: "cancel", subscriberId: sub.id },
                                { method: "POST" },
                              )
                            }
                          >
                            Cancel
                          </s-button>
                        )}
                        <s-button
                          variant="tertiary"
                          tone="critical"
                          onClick={() =>
                            fetcher.submit(
                              { intent: "delete", subscriberId: sub.id },
                              { method: "POST" },
                            )
                          }
                        >
                          Remove
                        </s-button>
                      </s-stack>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Theme App Extension Setup">
        <s-unordered-list>
          <s-list-item>
            Open <strong>Online Store &rarr; Themes &rarr; Customize</strong>.
          </s-list-item>
          <s-list-item>
            Navigate to a <strong>Product</strong> template.
          </s-list-item>
          <s-list-item>
            Click <strong>Add block &rarr; Apps &rarr; StockPulse Notify Me</strong>.
          </s-list-item>
          <s-list-item>
            Save your theme. The widget appears automatically whenever a
            selected variant is out of stock.
          </s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
