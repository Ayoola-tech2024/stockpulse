import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { processInventoryLevelUpdate } from "../services/inventory-restock.server";

interface InventoryLevelsUpdatePayload {
  inventory_item_id?: number | string;
  location_id?: number | string;
  available?: number | null;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload, admin } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  if (!admin) {
    console.warn(`No offline admin session for ${shop}; skipping restock check.`);
    return new Response(null, { status: 200 });
  }

  const data = payload as InventoryLevelsUpdatePayload;
  if (
    data.inventory_item_id == null ||
    data.location_id == null ||
    data.available == null
  ) {
    return Response.json(
      { processed: false, reason: "missing_inventory_fields" },
      { status: 200 },
    );
  }

  const result = await processInventoryLevelUpdate({
    shop,
    inventoryItemId: data.inventory_item_id,
    locationId: data.location_id,
    available: Number(data.available),
    admin,
  });

  return Response.json(result, { status: 200 });
};
