import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { buildWaitlistCsv } from "../services/csv.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const subscribers = await db.waitlistSubscriber.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
  });

  const csv = buildWaitlistCsv(subscribers);

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="stockpulse-waitlist.csv"',
      "Cache-Control": "no-store",
    },
  });
};
