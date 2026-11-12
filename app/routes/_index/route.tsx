import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>StockPulse</h1>
        <p className={styles.text}>
          Turn out-of-stock product pages into recaptured revenue with automated
          back-in-stock waitlists and instant restock email alerts.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Online Store 2.0 Theme Block</strong>. Automatically displays
            a customizable Notify Me form on out-of-stock variants.
          </li>
          <li>
            <strong>Real-Time Restock Dispatch</strong>. Listens to Shopify
            inventory webhooks and emails waiting shoppers via Resend.
          </li>
          <li>
            <strong>Native Shopify Billing</strong>. Start free with 30 alerts/mo
            and upgrade to unlimited alerts for $9.99/mo.
          </li>
        </ul>
      </div>
    </div>
  );
}
