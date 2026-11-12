import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { subscribeToWaitlist } from "../services/waitlist.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  return Response.json(
    { success: false, error: "Method not allowed. Use POST." },
    { status: 405, headers: CORS_HEADERS },
  );
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (request.method !== "POST") {
    return Response.json(
      { success: false, error: "Method not allowed. Use POST." },
      { status: 405, headers: CORS_HEADERS },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json(
      { success: false, error: "Invalid JSON payload." },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const result = await subscribeToWaitlist({
    shop: String(body.shop ?? ""),
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

  return Response.json(result, {
    status: result.success ? 200 : 400,
    headers: CORS_HEADERS,
  });
};
