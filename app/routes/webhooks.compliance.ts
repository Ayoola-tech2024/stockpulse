import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

interface CompliancePayload {
  customer?: {
    email?: string;
  };
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} compliance webhook for ${shop}`);

  const data = payload as CompliancePayload;

  if (topic === "CUSTOMERS_REDACT") {
    const email = data.customer?.email?.trim().toLowerCase();
    if (email) {
      await db.waitlistSubscriber.deleteMany({ where: { shop, email } });
      await db.notificationLog.deleteMany({ where: { shop, email } });
    }
  } else if (topic === "SHOP_REDACT") {
    await db.notificationLog.deleteMany({ where: { shop } });
    await db.waitlistSubscriber.deleteMany({ where: { shop } });
    await db.inventoryLevelState.deleteMany({ where: { shop } });
    await db.shopSettings.deleteMany({ where: { shop } });
    await db.session.deleteMany({ where: { shop } });
  }

  return new Response(null, { status: 200 });
};
