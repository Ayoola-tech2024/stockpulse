export interface RestockEmailParams {
  to: string;
  senderName: string;
  subjectTemplate: string;
  shop: string;
  productTitle: string;
  variantTitle?: string | null;
  productHandle?: string | null;
}

export interface EmailDispatchResult {
  delivered: boolean;
  messageId?: string;
  errorMessage?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderEmailTemplate(
  template: string,
  variables: Record<string, string>,
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    return key in variables ? variables[key] : "";
  });
}

export function buildProductUrl(shop: string, productHandle?: string | null): string {
  const baseUrl = `https://${shop}`;
  if (productHandle) {
    return `${baseUrl}/products/${encodeURIComponent(productHandle)}`;
  }
  return baseUrl;
}

/**
 * Dispatches a transactional restock alert via the Resend REST API.
 */
export async function sendRestockEmail(
  params: RestockEmailParams,
): Promise<EmailDispatchResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return {
      delivered: false,
      errorMessage: "RESEND_API_KEY is not configured.",
    };
  }

  const fromEmail =
    process.env.RESEND_FROM_EMAIL || "alerts@stockpulse.dev";
  const safeSenderName = params.senderName.replace(/[\r\n<>"]/g, "").trim() || "StockPulse Alerts";
  const from = `${safeSenderName} <${fromEmail}>`;

  const displayVariant =
    params.variantTitle && params.variantTitle !== "Default Title"
      ? params.variantTitle
      : "";
  const productUrl = buildProductUrl(params.shop, params.productHandle);
  const storeName = params.shop.replace(/\.myshopify\.com$/i, "");

  const subject = renderEmailTemplate(params.subjectTemplate, {
    product_title: params.productTitle,
    variant_title: displayVariant,
    shop_name: storeName,
    product_url: productUrl,
  }).trim() || `Good news! ${params.productTitle} is back in stock`;

  const escapedTitle = escapeHtml(params.productTitle);
  const escapedVariant = escapeHtml(displayVariant);
  const escapedStore = escapeHtml(storeName);
  const escapedUrl = escapeHtml(productUrl);

  const html = `
<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:24px;background-color:#f6f6f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#202223;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;border:1px solid #e1e3e5;overflow:hidden;">
      <tr>
        <td style="padding:28px 32px;">
          <p style="margin:0 0 8px 0;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;color:#008060;font-weight:700;">Back in Stock</p>
          <h1 style="margin:0 0 16px 0;font-size:22px;line-height:1.3;color:#202223;">${escapedTitle} is available again!</h1>
          ${escapedVariant ? `<p style="margin:0 0 16px 0;font-size:14px;color:#6d7175;">Option: <strong>${escapedVariant}</strong></p>` : ""}
          <p style="margin:0 0 24px 0;font-size:15px;line-height:1.5;color:#202223;">
            You asked to be notified when this item restocked at <strong>${escapedStore}</strong>. Grab yours before it sells out again.
          </p>
          <a href="${escapedUrl}" style="display:inline-block;padding:12px 24px;background-color:#008060;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;font-size:15px;">
            Shop Now
          </a>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 32px;background-color:#fafbfb;border-top:1px solid #e1e3e5;font-size:12px;color:#6d7175;">
          Sent via StockPulse Back-in-Stock Alerts for ${escapedStore}.
        </td>
      </tr>
    </table>
  </body>
</html>`.trim();

  const text = [
    `${params.productTitle}${displayVariant ? ` (${displayVariant})` : ""} is back in stock at ${storeName}!`,
    "",
    `Shop now: ${productUrl}`,
  ].join("\n");

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [params.to],
        subject,
        html,
        text,
      }),
    });

    const data = (await response.json().catch(() => ({}))) as {
      id?: string;
      message?: string;
      name?: string;
    };

    if (!response.ok) {
      return {
        delivered: false,
        errorMessage:
          data.message || `Resend API error (HTTP ${response.status})`,
      };
    }

    return {
      delivered: true,
      messageId: data.id,
    };
  } catch (error) {
    return {
      delivered: false,
      errorMessage: error instanceof Error ? error.message : "Network error",
    };
  }
}
