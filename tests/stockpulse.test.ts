import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock Prisma client before importing server services
const mockDb = vi.hoisted(() => ({
  shopSettings: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  waitlistSubscriber: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  notificationLog: {
    create: vi.fn(),
  },
  inventoryLevelState: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
}));

vi.mock("../app/db.server", () => ({
  default: mockDb,
}));

import {
  isValidEmail,
  normalizeShopifyId,
  subscribeToWaitlist,
} from "../app/services/waitlist.server";
import {
  buildProductUrl,
  renderEmailTemplate,
  sendRestockEmail,
} from "../app/services/email.server";
import {
  FREE_PLAN_MONTHLY_LIMIT,
  getOrCreateShopSettings,
  getRemainingMonthlyQuota,
} from "../app/services/shop-settings.server";
import { processInventoryLevelUpdate } from "../app/services/inventory-restock.server";
import { createGrowthSubscription, syncShopBillingPlan } from "../app/services/billing.server";
import { buildWaitlistCsv } from "../app/services/csv.server";

describe("StockPulse waitlist subscription service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("validates emails and normalizes Shopify GIDs", () => {
    expect(isValidEmail("buyer@example.com")).toBe(true);
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(normalizeShopifyId("gid://shopify/ProductVariant/987654321")).toBe("987654321");
    expect(normalizeShopifyId(12345)).toBe("12345");
  });

  it("rejects invalid email or missing store domain", async () => {
    const badEmail = await subscribeToWaitlist({
      shop: "demo-store.myshopify.com",
      productId: "111",
      variantId: "222",
      productTitle: "Winter Jacket",
      email: "invalid",
    });
    expect(badEmail.success).toBe(false);
    expect(badEmail.error).toMatch(/valid email/i);

    const badShop = await subscribeToWaitlist({
      shop: "",
      productId: "111",
      variantId: "222",
      productTitle: "Winter Jacket",
      email: "buyer@example.com",
    });
    expect(badShop.success).toBe(false);
  });

  it("deduplicates pending alerts for the same email and variant", async () => {
    mockDb.waitlistSubscriber.findFirst.mockResolvedValueOnce({
      id: "sub-existing",
    });
    mockDb.waitlistSubscriber.update.mockResolvedValueOnce({
      id: "sub-existing",
    });

    const res = await subscribeToWaitlist({
      shop: "Demo-Store.myshopify.com",
      productId: "gid://shopify/Product/111",
      variantId: "gid://shopify/ProductVariant/222",
      productTitle: "Winter Jacket",
      variantTitle: "Large / Black",
      email: "  BUYER@Example.com ",
    });

    expect(res).toEqual({
      success: true,
      alreadySubscribed: true,
      subscriberId: "sub-existing",
      message: "We'll notify you the moment it restocks!",
    });
    expect(mockDb.waitlistSubscriber.findFirst).toHaveBeenCalledWith({
      where: {
        shop: "demo-store.myshopify.com",
        variantId: "222",
        email: "buyer@example.com",
        status: "pending",
      },
    });
    expect(mockDb.waitlistSubscriber.create).not.toHaveBeenCalled();
  });

  it("creates a new pending subscriber when none exists", async () => {
    mockDb.waitlistSubscriber.findFirst.mockResolvedValueOnce(null);
    mockDb.waitlistSubscriber.create.mockResolvedValueOnce({ id: "sub-new" });

    const res = await subscribeToWaitlist({
      shop: "demo-store.myshopify.com",
      productId: "111",
      variantId: "222",
      productTitle: "Winter Jacket",
      variantPrice: 129.99,
      email: "buyer@example.com",
    });

    expect(res.success).toBe(true);
    expect(res.alreadySubscribed).toBe(false);
    expect(res.subscriberId).toBe("sub-new");
    expect(mockDb.waitlistSubscriber.create).toHaveBeenCalledTimes(1);
  });
});

describe("StockPulse email & quota services", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  it("renders email template placeholders and product URL", () => {
    expect(
      renderEmailTemplate("{{product_title}} ({{variant_title}}) at {{shop_name}}", {
        product_title: "Alpine Boots",
        variant_title: "Size 10",
        shop_name: "demo-store",
      }),
    ).toBe("Alpine Boots (Size 10) at demo-store");

    expect(buildProductUrl("demo-store.myshopify.com", "alpine-boots")).toBe(
      "https://demo-store.myshopify.com/products/alpine-boots",
    );
  });

  it("dispatches transactional emails via Resend API", async () => {
    process.env.RESEND_API_KEY = "re_test_123";
    process.env.RESEND_FROM_EMAIL = "alerts@stockpulse.dev";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "email_123" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await sendRestockEmail({
      to: "shopper@example.com",
      senderName: "Demo Store",
      subjectTemplate: "Back in stock: {{product_title}}",
      shop: "demo-store.myshopify.com",
      productTitle: "Alpine Boots",
      variantTitle: "Size 10",
      productHandle: "alpine-boots",
    });

    expect(res).toEqual({ delivered: true, messageId: "email_123" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer re_test_123",
        }),
      }),
    );
  });

  it("enforces Free plan monthly quota and resets across UTC months", async () => {
    expect(
      getRemainingMonthlyQuota({ plan: "free", monthlyAlertsUsed: 25 }),
    ).toBe(FREE_PLAN_MONTHLY_LIMIT - 25);
    expect(
      getRemainingMonthlyQuota({ plan: "growth", monthlyAlertsUsed: 500 }),
    ).toBe(Number.POSITIVE_INFINITY);

    mockDb.shopSettings.findUnique.mockResolvedValueOnce({
      id: "set-1",
      shop: "demo.myshopify.com",
      plan: "free",
      monthlyAlertsUsed: 30,
      quotaResetAt: new Date("2020-01-01T00:00:00.000Z"),
    });
    mockDb.shopSettings.update.mockResolvedValueOnce({
      id: "set-1",
      shop: "demo.myshopify.com",
      plan: "free",
      monthlyAlertsUsed: 0,
      quotaResetAt: new Date(),
    });

    const settings = await getOrCreateShopSettings("demo.myshopify.com");
    expect(settings.monthlyAlertsUsed).toBe(0);
    expect(mockDb.shopSettings.update).toHaveBeenCalledTimes(1);
  });
});

describe("StockPulse inventory webhook & billing", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  it("ignores inventory updates that did not transition from <= 0 to > 0", async () => {
    mockDb.inventoryLevelState.findUnique.mockResolvedValueOnce({
      available: 4,
    });
    mockDb.inventoryLevelState.upsert.mockResolvedValueOnce({});

    const admin = { graphql: vi.fn() };
    const result = await processInventoryLevelUpdate({
      shop: "demo.myshopify.com",
      inventoryItemId: 555,
      locationId: 777,
      available: 10,
      admin,
    });

    expect(result.processed).toBe(false);
    expect(result.reason).toBe("already_in_stock");
    expect(admin.graphql).not.toHaveBeenCalled();
  });

  it("notifies pending subscribers up to Free plan quota on restock", async () => {
    process.env.RESEND_API_KEY = "re_test_123";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: "email_ok" }),
      }),
    );

    mockDb.inventoryLevelState.findUnique.mockResolvedValueOnce({ available: 0 });
    mockDb.inventoryLevelState.upsert.mockResolvedValueOnce({});
    mockDb.waitlistSubscriber.findMany.mockResolvedValueOnce([
      {
        id: "sub-1",
        email: "first@example.com",
        productTitle: "Canvas Tote",
        variantTitle: "Olive",
        productHandle: "canvas-tote",
      },
      {
        id: "sub-2",
        email: "second@example.com",
        productTitle: "Canvas Tote",
        variantTitle: "Olive",
        productHandle: "canvas-tote",
      },
    ]);
    mockDb.shopSettings.findUnique.mockResolvedValueOnce({
      id: "set-1",
      shop: "demo.myshopify.com",
      plan: "free",
      monthlyAlertsUsed: 29,
      quotaResetAt: new Date(),
      senderName: "Demo Store",
      emailSubject: "Good news! {{product_title}} is back in stock",
    });

    const admin = {
      graphql: vi.fn().mockResolvedValue({
        json: async () => ({
          data: {
            inventoryItem: {
              variant: {
                id: "gid://shopify/ProductVariant/222",
                legacyResourceId: "222",
                title: "Olive",
                price: "35.00",
                inventoryQuantity: 12,
                product: {
                  id: "gid://shopify/Product/111",
                  legacyResourceId: "111",
                  title: "Canvas Tote",
                  handle: "canvas-tote",
                },
              },
            },
          },
        }),
      }),
    };

    const result = await processInventoryLevelUpdate({
      shop: "demo.myshopify.com",
      inventoryItemId: 555,
      locationId: 777,
      available: 12,
      admin,
    });

    expect(result).toEqual({
      processed: true,
      variantId: "222",
      notifiedCount: 1,
      failedCount: 0,
      skippedQuotaCount: 1,
    });
    expect(mockDb.notificationLog.create).toHaveBeenCalledTimes(1);
    expect(mockDb.waitlistSubscriber.update).toHaveBeenCalledTimes(1);
    expect(mockDb.shopSettings.update).toHaveBeenCalledWith({
      where: { shop: "demo.myshopify.com" },
      data: { monthlyAlertsUsed: { increment: 1 } },
    });
  });

  it("creates a $9.99/mo Shopify Growth subscription and syncs active plan", async () => {
    const admin = {
      graphql: vi
        .fn()
        .mockResolvedValueOnce({
          json: async () => ({
            data: {
              appSubscriptionCreate: {
                userErrors: [],
                confirmationUrl: "https://demo.myshopify.com/admin/charges/confirm",
                appSubscription: { id: "gid://shopify/AppSubscription/999", status: "PENDING" },
              },
            },
          }),
        })
        .mockResolvedValueOnce({
          json: async () => ({
            data: {
              currentAppInstallation: {
                activeSubscriptions: [
                  {
                    id: "gid://shopify/AppSubscription/999",
                    name: "StockPulse Growth",
                    status: "ACTIVE",
                    test: true,
                    currentPeriodEnd: null,
                  },
                ],
              },
            },
          }),
        }),
    };

    const created = await createGrowthSubscription(
      admin,
      "https://stockpulse.dev/app/pricing",
    );
    expect(created.confirmationUrl).toBe(
      "https://demo.myshopify.com/admin/charges/confirm",
    );

    mockDb.shopSettings.findUnique.mockResolvedValueOnce({
      id: "set-1",
      shop: "demo.myshopify.com",
      plan: "free",
      planActivatedAt: null,
      quotaResetAt: new Date(),
    });
    mockDb.shopSettings.update.mockResolvedValueOnce({
      id: "set-1",
      shop: "demo.myshopify.com",
      plan: "growth",
      subscriptionId: "gid://shopify/AppSubscription/999",
    });

    const synced = await syncShopBillingPlan("demo.myshopify.com", admin);
    expect(synced.plan).toBe("growth");
  });

  it("escapes CSV cells properly in buildWaitlistCsv", () => {
    const csv = buildWaitlistCsv([
      {
        email: "alice@example.com",
        productTitle: 'Jacket, "Limited" Edition',
        variantTitle: "Large",
        variantPrice: 149.5,
        status: "notified",
        createdAt: new Date("2026-11-01T10:00:00.000Z"),
        notifiedAt: new Date("2026-11-02T12:00:00.000Z"),
      },
    ]);

    expect(csv).toContain("Email,Product,Variant,Price,Status,Subscribed At,Notified At");
    expect(csv).toContain(
      'alice@example.com,"Jacket, ""Limited"" Edition",Large,149.50,notified,2026-11-01T10:00:00.000Z,2026-11-02T12:00:00.000Z',
    );
  });
});
