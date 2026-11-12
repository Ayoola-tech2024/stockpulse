# StockPulse ⚡
> Production-ready Shopify Back-in-Stock & Pre-Order Waitlist app with native Shopify USD subscription billing and Online Store 2.0 Theme App Extensions.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![React Router](https://img.shields.io/badge/React%20Router-v7-red.svg)](https://reactrouter.com/)
[![Shopify API](https://img.shields.io/badge/Shopify%20API-2026--10-green.svg)](https://shopify.dev/docs/api/admin-graphql)
[![Prisma](https://img.shields.io/badge/Prisma-PostgreSQL-teal.svg)](https://www.prisma.io/)
[![Resend](https://img.shields.io/badge/Email-Resend-black.svg)](https://resend.com/)

---

## 🌟 Key Features

1. **Online Store 2.0 Theme App Extension (`stockpulse-theme-ext`)**
   - Automatically renders on out-of-stock product variants (`variant.available == false`).
   - Supports **Inline Form** and **Modal Popup** display modes.
   - Listens to Shopify variant selection changes and URL parameters (`?variant=...`).
   - Dynamically pulls merchant-configured button colors and text from the App Proxy.

2. **Waitlist & Subscription Ingestion API**
   - Validates email syntax and store permanent domains.
   - Normalizes numeric and GID-format Shopify IDs (`gid://shopify/ProductVariant/...`).
   - Deduplicates pending subscriptions so shoppers don't get spammed.
   - Dual-path access: Direct JSON endpoint (`/api/subscribe`) and Shopify App Proxy (`/apps/stockpulse/api/subscribe`).

3. **Shopify Inventory Webhook & Automated Email Alerts**
   - Subscribes to `inventory_levels/update` (API Version `2026-10`).
   - State-aware transition detection: only fires when an item transitions from out-of-stock (`<= 0`) to in-stock (`> 0`).
   - Enforces Free plan monthly quotas (30 alerts/mo) with automatic UTC month reset.
   - Growth plan unlocks unlimited email alerts.
   - Dispatches transactional restock emails via **Resend REST API** with customizable template placeholders (`{{product_title}}`, `{{variant_title}}`, `{{shop_name}}`).

4. **Polaris Merchant Dashboard**
   - **Metrics Overview**: Total Waitlist count, alerts sent this month, and estimated recaptured sales revenue.
   - **Subscriber Table**: Search by customer email/product name, filter by product or status (`pending`, `notified`, `cancelled`), and cancel or remove entries.
   - **Theme Customizer Settings**: Configure sender name, email subject, and button styling with a live preview.
   - **One-Click CSV Export**: Instant waitlist export for marketing & analytics.

5. **Native Shopify Billing (USD Recurring Subscriptions)**
   - **Free Plan**: $0/month (30 alerts/month, full Theme Extension support).
   - **Growth Plan**: $9.99/month (unlimited alerts, custom branding, CSV export).
   - Charged directly to the merchant's monthly Shopify invoice via `appSubscriptionCreate` GraphQL mutation (0% revenue share on first $1M).

6. **Privacy Compliance Webhooks**
   - `customers/data_request`, `customers/redact`, and `shop/redact` fully implemented for Shopify App Store compliance.

---

## 🏗️ Architecture & Database Schema

StockPulse uses **Prisma ORM** with **PostgreSQL** (compatible with Neon, Supabase, Render, AWS RDS, or local PostgreSQL).

- **`Session`**: Shopify merchant authentication sessions.
- **`ShopSettings`**: Store configuration, current billing plan, monthly alert usage counters, and storefront button styling.
- **`WaitlistSubscriber`**: Pending and notified subscribers per product variant.
- **`NotificationLog`**: Audit trail of every restock alert email dispatched (status and error logs).
- **`InventoryLevelState`**: Tracks previous inventory levels per location to detect stock transitions accurately.

---

## 🚀 Quick Start

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/Ayoola-tech2024/stockpulse.git
cd stockpulse
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Set the required variables:

```ini
# Shopify App Credentials (from Shopify Dev Dashboard -> Apps -> StockPulse)
SHOPIFY_API_KEY=your_client_id_here
SHOPIFY_API_SECRET=your_client_secret_here
SHOPIFY_APP_URL=https://your-domain.com
SCOPES=read_products,read_inventory

# PostgreSQL Connection String (Neon, Supabase, or Local Postgres)
DATABASE_URL="postgresql://user:password@host:5432/stockpulse?schema=public"

# Resend Transactional Email API (https://resend.com)
RESEND_API_KEY=re_your_api_key
RESEND_FROM_EMAIL=alerts@yourdomain.com

# Set to "true" during development to generate test charges
SHOPIFY_BILLING_TEST_MODE=true
```

### 3. Initialize the Database

```bash
npx prisma generate
npx prisma db push
```

### 4. Run the Development Server

Link the app to your Shopify Partner App configuration:

```bash
npm run config:link
npm run dev
```

---

## 🧪 Testing & Verification

Run the comprehensive unit test suite, type checking, and production build:

```bash
# Run Vitest unit tests
npm test

# Typecheck with React Router typegen & TypeScript
npm run typecheck

# Lint the codebase
npm run lint

# Build production bundles
npm run build
```

---

## 🎨 Setting Up the Theme App Extension

1. Open your development or merchant store admin.
2. Go to **Online Store &rarr; Themes &rarr; Customize**.
3. In the top template selector, switch to **Products &rarr; Default product**.
4. In the left sidebar, click **Add block** under the Product Information section.
5. Select **Apps &rarr; StockPulse Notify Me**.
6. Customize the display mode (Inline Form or Modal Popup), colors, and copy.
7. Click **Save**. The widget will automatically activate on any out-of-stock variant!

---

## 📄 License

MIT
