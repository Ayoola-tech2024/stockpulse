import db from "../db.server";

export const FREE_PLAN_MONTHLY_LIMIT = 30;
export const GROWTH_PLAN_PRICE = 9.99;

function isDifferentUtcMonth(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() !== b.getUTCFullYear() ||
    a.getUTCMonth() !== b.getUTCMonth()
  );
}

/**
 * Fetches ShopSettings for a shop, creating defaults if none exist,
 * and resets monthlyAlertsUsed when crossing into a new UTC month.
 */
export async function getOrCreateShopSettings(shop: string) {
  const now = new Date();

  let settings = await db.shopSettings.findUnique({ where: { shop } });
  if (!settings) {
    settings = await db.shopSettings.create({
      data: {
        shop,
        quotaResetAt: now,
      },
    });
    return settings;
  }

  if (isDifferentUtcMonth(settings.quotaResetAt, now)) {
    settings = await db.shopSettings.update({
      where: { shop },
      data: {
        monthlyAlertsUsed: 0,
        quotaResetAt: now,
      },
    });
  }

  return settings;
}

export interface ShopSettingsUpdateInput {
  emailSubject?: string;
  senderName?: string;
  buttonText?: string;
  buttonColor?: string;
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export async function updateShopSettings(
  shop: string,
  input: ShopSettingsUpdateInput,
) {
  await getOrCreateShopSettings(shop);

  const data: ShopSettingsUpdateInput = {};

  if (typeof input.emailSubject === "string" && input.emailSubject.trim()) {
    data.emailSubject = input.emailSubject.trim().slice(0, 200);
  }
  if (typeof input.senderName === "string" && input.senderName.trim()) {
    data.senderName = input.senderName.trim().slice(0, 100);
  }
  if (typeof input.buttonText === "string" && input.buttonText.trim()) {
    data.buttonText = input.buttonText.trim().slice(0, 80);
  }
  if (typeof input.buttonColor === "string" && HEX_COLOR_RE.test(input.buttonColor.trim())) {
    data.buttonColor = input.buttonColor.trim();
  }

  return db.shopSettings.update({
    where: { shop },
    data,
  });
}

export function getRemainingMonthlyQuota(settings: {
  plan: string;
  monthlyAlertsUsed: number;
}): number {
  if (settings.plan === "growth") {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(0, FREE_PLAN_MONTHLY_LIMIT - settings.monthlyAlertsUsed);
}
