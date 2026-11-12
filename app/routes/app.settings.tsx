import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  getOrCreateShopSettings,
  updateShopSettings,
} from "../services/shop-settings.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await getOrCreateShopSettings(session.shop);

  return {
    plan: settings.plan,
    emailSubject: settings.emailSubject,
    senderName: settings.senderName,
    buttonText: settings.buttonText,
    buttonColor: settings.buttonColor,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  const updated = await updateShopSettings(session.shop, {
    emailSubject: String(formData.get("emailSubject") || ""),
    senderName: String(formData.get("senderName") || ""),
    buttonText: String(formData.get("buttonText") || ""),
    buttonColor: String(formData.get("buttonColor") || ""),
  });

  return {
    ok: true,
    settings: {
      emailSubject: updated.emailSubject,
      senderName: updated.senderName,
      buttonText: updated.buttonText,
      buttonColor: updated.buttonColor,
    },
  };
};

export default function SettingsPage() {
  const initial = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [emailSubject, setEmailSubject] = useState(initial.emailSubject);
  const [senderName, setSenderName] = useState(initial.senderName);
  const [buttonText, setButtonText] = useState(initial.buttonText);
  const [buttonColor, setButtonColor] = useState(initial.buttonColor);

  const isSaving =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";

  useEffect(() => {
    if (fetcher.data?.ok) {
      shopify.toast.show("Settings saved");
    }
  }, [fetcher.data, shopify]);

  const handleSave = () => {
    fetcher.submit(
      {
        emailSubject,
        senderName,
        buttonText,
        buttonColor,
      },
      { method: "POST" },
    );
  };

  return (
    <s-page heading="Email & Widget Settings">
      <s-button
        slot="primary-action"
        onClick={handleSave}
        {...(isSaving ? { loading: true } : {})}
      >
        Save settings
      </s-button>

      <s-section heading="Restock Email Template">
        <s-stack direction="block" gap="base">
          <s-text-field
            label="Sender Name"
            value={senderName}
            details="Shown as the From name in customer restock alerts."
            onInput={(e) => {
              const target = e.currentTarget as unknown as { value: string };
              setSenderName(target.value);
            }}
          />
          <s-text-field
            label="Email Subject Line"
            value={emailSubject}
            details="Supports {{product_title}}, {{variant_title}}, and {{shop_name}} placeholders."
            onInput={(e) => {
              const target = e.currentTarget as unknown as { value: string };
              setEmailSubject(target.value);
            }}
          />
        </s-stack>
      </s-section>

      <s-section heading="Storefront Notify Me Button">
        <s-stack direction="block" gap="base">
          <s-text-field
            label="Button Label"
            value={buttonText}
            onInput={(e) => {
              const target = e.currentTarget as unknown as { value: string };
              setButtonText(target.value);
            }}
          />
          <s-color-field
            label="Button Background Color"
            value={buttonColor}
            onInput={(e) => {
              const target = e.currentTarget as unknown as { value: string };
              setButtonColor(target.value);
            }}
          />
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >
            <s-stack direction="block" gap="small">
              <s-text tone="neutral">Live Button Preview</s-text>
              <div>
                <button
                  type="button"
                  style={{
                    backgroundColor: buttonColor || "#008060",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "6px",
                    padding: "10px 18px",
                    fontWeight: 600,
                    fontSize: "14px",
                    cursor: "default",
                  }}
                >
                  {buttonText || "Notify Me When Available"}
                </button>
              </div>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Template Variables">
        <s-unordered-list>
          <s-list-item>
            <code>{"{{product_title}}"}</code> &mdash; Product name
          </s-list-item>
          <s-list-item>
            <code>{"{{variant_title}}"}</code> &mdash; Selected size/color
          </s-list-item>
          <s-list-item>
            <code>{"{{shop_name}}"}</code> &mdash; Your store name
          </s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
