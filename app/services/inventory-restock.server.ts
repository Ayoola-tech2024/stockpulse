import db from "../db.server";
import { sendRestockEmail } from "./email.server";
import {
  getOrCreateShopSettings,
  getRemainingMonthlyQuota,
} from "./shop-settings.server";
import { normalizeShopifyId } from "./waitlist.server";

export interface AdminGraphqlClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}

export interface InventoryUpdateInput {
  shop: string;
  inventoryItemId: string | number;
  locationId: string | number;
  available: number;
  admin: AdminGraphqlClient;
}

export interface InventoryUpdateResult {
  processed: boolean;
  reason?: string;
  variantId?: string;
  notifiedCount: number;
  failedCount: number;
  skippedQuotaCount: number;
}

const INVENTORY_ITEM_VARIANT_QUERY = `#graphql
  query StockPulseInventoryItemVariant($id: ID!) {
    inventoryItem(id: $id) {
      id
      variant {
        id
        legacyResourceId
        title
        price
        inventoryQuantity
        product {
          id
          legacyResourceId
          title
          handle
        }
      }
    }
  }
`;

/**
 * Processes an `inventory_levels/update` webhook payload:
 * 1. Tracks previous available inventory in InventoryLevelState to detect <= 0 -> > 0 transitions.
 * 2. Resolves the variant via Shopify Admin GraphQL.
 * 3. Enforces monthly plan quota and dispatches Resend restock emails to pending waitlist subscribers.
 */
export async function processInventoryLevelUpdate(
  input: InventoryUpdateInput,
): Promise<InventoryUpdateResult> {
  const inventoryItemId = normalizeShopifyId(input.inventoryItemId);
  const locationId = normalizeShopifyId(input.locationId);
  const available = Number(input.available);

  if (!Number.isFinite(available)) {
    return {
      processed: false,
      reason: "invalid_available_quantity",
      notifiedCount: 0,
      failedCount: 0,
      skippedQuotaCount: 0,
    };
  }

  const previousState = await db.inventoryLevelState.findUnique({
    where: {
      shop_inventoryItemId_locationId: {
        shop: input.shop,
        inventoryItemId,
        locationId,
      },
    },
  });

  await db.inventoryLevelState.upsert({
    where: {
      shop_inventoryItemId_locationId: {
        shop: input.shop,
        inventoryItemId,
        locationId,
      },
    },
    update: { available },
    create: {
      shop: input.shop,
      inventoryItemId,
      locationId,
      available,
    },
  });

  // Trigger only when inventory transitions from <= 0 (or unrecorded) to > 0
  const transitionedToInStock =
    available > 0 && (previousState === null || previousState.available <= 0);

  if (!transitionedToInStock) {
    return {
      processed: false,
      reason:
        available <= 0 ? "still_out_of_stock" : "already_in_stock",
      notifiedCount: 0,
      failedCount: 0,
      skippedQuotaCount: 0,
    };
  }

  const gid = `gid://shopify/InventoryItem/${inventoryItemId}`;
  const response = await input.admin.graphql(INVENTORY_ITEM_VARIANT_QUERY, {
    variables: { id: gid },
  });
  const json = (await response.json()) as {
    data?: {
      inventoryItem?: {
        variant?: {
          id: string;
          legacyResourceId?: string;
          title?: string;
          price?: string;
          inventoryQuantity?: number;
          product?: {
            id: string;
            legacyResourceId?: string;
            title?: string;
            handle?: string;
          };
        };
      };
    };
  };

  const variant = json.data?.inventoryItem?.variant;
  if (!variant) {
    return {
      processed: false,
      reason: "variant_not_found",
      notifiedCount: 0,
      failedCount: 0,
      skippedQuotaCount: 0,
    };
  }

  const variantId = normalizeShopifyId(
    variant.legacyResourceId || variant.id,
  );
  const productTitle = variant.product?.title || "Restocked Item";
  const variantTitle = variant.title || null;
  const productHandle = variant.product?.handle || null;

  const pendingSubscribers = await db.waitlistSubscriber.findMany({
    where: {
      shop: input.shop,
      variantId,
      status: "pending",
    },
    orderBy: { createdAt: "asc" },
  });

  if (pendingSubscribers.length === 0) {
    return {
      processed: true,
      variantId,
      reason: "no_pending_subscribers",
      notifiedCount: 0,
      failedCount: 0,
      skippedQuotaCount: 0,
    };
  }

  const settings = await getOrCreateShopSettings(input.shop);
  let remainingQuota = getRemainingMonthlyQuota(settings);

  let notifiedCount = 0;
  let failedCount = 0;
  let skippedQuotaCount = 0;

  for (const subscriber of pendingSubscribers) {
    if (remainingQuota <= 0) {
      skippedQuotaCount += 1;
      continue;
    }

    const emailResult = await sendRestockEmail({
      to: subscriber.email,
      senderName: settings.senderName,
      subjectTemplate: settings.emailSubject,
      shop: input.shop,
      productTitle: subscriber.productTitle || productTitle,
      variantTitle: subscriber.variantTitle ?? variantTitle,
      productHandle: subscriber.productHandle ?? productHandle,
    });

    await db.notificationLog.create({
      data: {
        shop: input.shop,
        subscriberId: subscriber.id,
        variantId,
        email: subscriber.email,
        status: emailResult.delivered ? "delivered" : "failed",
        errorMessage: emailResult.errorMessage ?? null,
      },
    });

    if (emailResult.delivered) {
      await db.waitlistSubscriber.update({
        where: { id: subscriber.id },
        data: {
          status: "notified",
          notifiedAt: new Date(),
        },
      });
      notifiedCount += 1;
      if (Number.isFinite(remainingQuota)) {
        remainingQuota -= 1;
      }
    } else {
      failedCount += 1;
    }
  }

  if (notifiedCount > 0) {
    await db.shopSettings.update({
      where: { shop: input.shop },
      data: {
        monthlyAlertsUsed: { increment: notifiedCount },
      },
    });
  }

  return {
    processed: true,
    variantId,
    notifiedCount,
    failedCount,
    skippedQuotaCount,
  };
}
