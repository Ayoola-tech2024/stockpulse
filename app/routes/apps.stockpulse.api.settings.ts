import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getOrCreateShopSettings } from "../services/shop-settings.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const shop = session?.shop || url.searchParams.get("shop") || "";

  if (!shop) {
    return Response.json({ settings: null }, { status: 400 });
  }

  const settings = await getOrCreateShopSettings(shop);

  return Response.json({
    settings: {
      buttonText: settings.buttonText,
      buttonColor: settings.buttonColor,
    },
  });
};
