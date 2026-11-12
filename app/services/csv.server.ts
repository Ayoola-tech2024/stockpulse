function escapeCsvCell(value: string | number | null | undefined): string {
  const str = value == null ? "" : String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export interface WaitlistCsvRow {
  email: string;
  productTitle: string;
  variantTitle: string | null;
  variantPrice: number | null;
  status: string;
  createdAt: Date;
  notifiedAt: Date | null;
}

export function buildWaitlistCsv(rows: WaitlistCsvRow[]): string {
  const header = [
    "Email",
    "Product",
    "Variant",
    "Price",
    "Status",
    "Subscribed At",
    "Notified At",
  ].join(",");

  const lines = rows.map((row) =>
    [
      escapeCsvCell(row.email),
      escapeCsvCell(row.productTitle),
      escapeCsvCell(row.variantTitle || "Default Title"),
      escapeCsvCell(
        row.variantPrice != null ? row.variantPrice.toFixed(2) : "",
      ),
      escapeCsvCell(row.status),
      escapeCsvCell(row.createdAt.toISOString()),
      escapeCsvCell(row.notifiedAt ? row.notifiedAt.toISOString() : ""),
    ].join(","),
  );

  return [header, ...lines].join("\r\n");
}
