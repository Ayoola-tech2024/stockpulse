import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { subscribeToWaitlist } from "../services/waitlist.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return Response.json(
      { success: false, error: "Method not allowed." },
      { status: 405 },
    );
  }

  const { session } = await authenticate.public.appProxy(request);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json(
      { success: false, error: "Invalid JSON payload." },
      { status: 400 },
    );
  }

  const url = new URL(request.url);
  const shop =
    session?.shop ||
    url.searchParams.get("shop") ||
    String(body.shop ?? "");

  const result = await subscribeToWaitlist({
    shop,
    productId: String(body.productId ?? ""),
    variantId: String(body.variantId ?? ""),
    productTitle: String(body.productTitle ?? ""),
    variantTitle:
      typeof body.variantTitle === "string" ? body.variantTitle : null,
    productHandle:
      typeof body.productHandle === "string" ? body.productHandle : null,
    variantPrice:
      typeof body.variantPrice === "number" ? body.variantPrice : null,
    email: String(body.email ?? ""),
  });

  return Response.json(result, { status: result.success ? 200 : 400 });
};
