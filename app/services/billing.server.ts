import db from "../db.server";
import type { AdminGraphqlClient } from "./inventory-restock.server";
import { getOrCreateShopSettings, GROWTH_PLAN_PRICE } from "./shop-settings.server";

export const GROWTH_PLAN_NAME = "StockPulse Growth";

const ACTIVE_SUBSCRIPTIONS_QUERY = `#graphql
  query StockPulseActiveSubscriptions {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        test
        currentPeriodEnd
        lineItems {
          id
          plan {
            pricingDetails {
              ... on AppRecurringPricing {
                interval
                price {
                  amount
                  currencyCode
                }
              }
            }
          }
        }
      }
    }
  }
`;

const APP_SUBSCRIPTION_CREATE_MUTATION = `#graphql
  mutation StockPulseAppSubscriptionCreate(
    $name: String!
    $lineItems: [AppSubscriptionLineItemInput!]!
    $returnUrl: URL!
    $test: Boolean
  ) {
    appSubscriptionCreate(
      name: $name
      lineItems: $lineItems
      returnUrl: $returnUrl
      test: $test
    ) {
      userErrors {
        field
        message
      }
      confirmationUrl
      appSubscription {
        id
        status
      }
    }
  }
`;

const APP_SUBSCRIPTION_CANCEL_MUTATION = `#graphql
  mutation StockPulseAppSubscriptionCancel($id: ID!) {
    appSubscriptionCancel(id: $id) {
      userErrors {
        field
        message
      }
      appSubscription {
        id
        status
      }
    }
  }
`;

export interface ActiveShopifySubscription {
  id: string;
  name: string;
  status: string;
  test: boolean;
  currentPeriodEnd: string | null;
}

export async function getActiveGrowthSubscription(
  admin: AdminGraphqlClient,
): Promise<ActiveShopifySubscription | null> {
  const response = await admin.graphql(ACTIVE_SUBSCRIPTIONS_QUERY);
  const json = (await response.json()) as {
    data?: {
      currentAppInstallation?: {
        activeSubscriptions?: ActiveShopifySubscription[];
      };
    };
  };

  const subs = json.data?.currentAppInstallation?.activeSubscriptions ?? [];
  return (
    subs.find(
      (sub) => sub.name === GROWTH_PLAN_NAME && sub.status === "ACTIVE",
    ) ?? null
  );
}

/**
 * Synchronizes ShopSettings.plan with Shopify's activeSubscriptions.
 */
export async function syncShopBillingPlan(
  shop: string,
  admin: AdminGraphqlClient,
) {
  const settings = await getOrCreateShopSettings(shop);
  const activeSub = await getActiveGrowthSubscription(admin);

  if (activeSub && settings.plan !== "growth") {
    return db.shopSettings.update({
      where: { shop },
      data: {
        plan: "growth",
        subscriptionId: activeSub.id,
        planActivatedAt: settings.planActivatedAt ?? new Date(),
      },
    });
  }

  if (!activeSub && settings.plan === "growth") {
    return db.shopSettings.update({
      where: { shop },
      data: {
        plan: "free",
        subscriptionId: null,
      },
    });
  }

  return settings;
}

export async function createGrowthSubscription(
  admin: AdminGraphqlClient,
  returnUrl: string,
): Promise<{
  confirmationUrl?: string;
  subscriptionId?: string;
  error?: string;
}> {
  const isTest =
    process.env.SHOPIFY_BILLING_TEST_MODE === "true" ||
    process.env.NODE_ENV !== "production";

  const response = await admin.graphql(APP_SUBSCRIPTION_CREATE_MUTATION, {
    variables: {
      name: GROWTH_PLAN_NAME,
      returnUrl,
      test: isTest,
      lineItems: [
        {
          plan: {
            appRecurringPricingDetails: {
              price: {
                amount: GROWTH_PLAN_PRICE,
                currencyCode: "USD",
              },
              interval: "EVERY_30_DAYS",
            },
          },
        },
      ],
    },
  });

  const json = (await response.json()) as {
    data?: {
      appSubscriptionCreate?: {
        userErrors?: Array<{ field?: string[]; message: string }>;
        confirmationUrl?: string | null;
        appSubscription?: { id: string; status: string } | null;
      };
    };
  };

  const result = json.data?.appSubscriptionCreate;
  if (!result) {
    return { error: "Failed to initiate Shopify billing subscription." };
  }

  if (result.userErrors && result.userErrors.length > 0) {
    return {
      error: result.userErrors.map((e) => e.message).join("; "),
    };
  }

  if (!result.confirmationUrl) {
    return { error: "Shopify did not return a billing confirmation URL." };
  }

  return {
    confirmationUrl: result.confirmationUrl,
    subscriptionId: result.appSubscription?.id,
  };
}

export async function cancelGrowthSubscription(
  shop: string,
  admin: AdminGraphqlClient,
): Promise<{ success: boolean; error?: string }> {
  const activeSub = await getActiveGrowthSubscription(admin);

  if (activeSub) {
    const response = await admin.graphql(APP_SUBSCRIPTION_CANCEL_MUTATION, {
      variables: { id: activeSub.id },
    });
    const json = (await response.json()) as {
      data?: {
        appSubscriptionCancel?: {
          userErrors?: Array<{ field?: string[]; message: string }>;
        };
      };
    };

    const userErrors = json.data?.appSubscriptionCancel?.userErrors ?? [];
    if (userErrors.length > 0) {
      return {
        success: false,
        error: userErrors.map((e) => e.message).join("; "),
      };
    }
  }

  await db.shopSettings.update({
    where: { shop },
    data: {
      plan: "free",
      subscriptionId: null,
    },
  });

  return { success: true };
}
