import db from "../db.server";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

export function normalizeShopDomain(shop: string): string {
  return shop.trim().toLowerCase();
}

export function isValidShopDomain(shop: string): boolean {
  const normalized = normalizeShopDomain(shop);
  return SHOP_DOMAIN_RE.test(normalized) || normalized.includes(".");
}

/**
 * Normalizes a Shopify ID (numeric string, number, or GID like
 * `gid://shopify/ProductVariant/12345`) into its canonical numeric string.
 */
export function normalizeShopifyId(id: string | number): string {
  const raw = String(id).trim();
  const parts = raw.split("/");
  return parts[parts.length - 1] || raw;
}

export interface SubscribeInput {
  shop: string;
  productId: string | number;
  variantId: string | number;
  productTitle: string;
  variantTitle?: string | null;
  productHandle?: string | null;
  variantPrice?: number | null;
  email: string;
}

export interface SubscribeResult {
  success: boolean;
  alreadySubscribed?: boolean;
  message?: string;
  error?: string;
  subscriberId?: string;
}

/**
 * Validates and registers a back-in-stock waitlist subscription,
 * deduplicating pending alerts for the same (shop, variantId, email).
 */
export async function subscribeToWaitlist(
  input: SubscribeInput,
): Promise<SubscribeResult> {
  const shop = normalizeShopDomain(input.shop || "");
  const email = (input.email || "").trim().toLowerCase();
  const productId = normalizeShopifyId(input.productId || "");
  const variantId = normalizeShopifyId(input.variantId || "");
  const productTitle = (input.productTitle || "").trim();
  const variantTitle = input.variantTitle?.trim() || null;
  const productHandle = input.productHandle?.trim() || null;
  const variantPrice =
    typeof input.variantPrice === "number" && Number.isFinite(input.variantPrice)
      ? input.variantPrice
      : null;

  if (!shop || !isValidShopDomain(shop)) {
    return { success: false, error: "A valid Shopify store domain is required." };
  }
  if (!productId || !variantId || !productTitle) {
    return {
      success: false,
      error: "Product and variant details are required.",
    };
  }
  if (!isValidEmail(email)) {
    return { success: false, error: "Please enter a valid email address." };
  }

  const existing = await db.waitlistSubscriber.findFirst({
    where: {
      shop,
      variantId,
      email,
      status: "pending",
    },
  });

  if (existing) {
    const updated = await db.waitlistSubscriber.update({
      where: { id: existing.id },
      data: {
        productTitle,
        ...(variantTitle !== null ? { variantTitle } : {}),
        ...(productHandle !== null ? { productHandle } : {}),
        ...(variantPrice !== null ? { variantPrice } : {}),
      },
    });
    return {
      success: true,
      alreadySubscribed: true,
      subscriberId: updated.id,
      message: "We'll notify you the moment it restocks!",
    };
  }

  const created = await db.waitlistSubscriber.create({
    data: {
      shop,
      productId,
      variantId,
      productTitle,
      variantTitle,
      productHandle,
      variantPrice,
      email,
      status: "pending",
    },
  });

  return {
    success: true,
    alreadySubscribed: false,
    subscriberId: created.id,
    message: "We'll notify you the moment it restocks!",
  };
}
