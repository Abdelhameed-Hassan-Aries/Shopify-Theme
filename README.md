# Huda Beauty Frontend Assessment

Take-home for the Frontend Engineer role. Built on the Horizon theme and scoped to a configurable multi-region storefront setup, plus the optional structured-data bonus.
The goal across all three pieces is the same: keep behaviour in code, keep content in admin. A merchandiser can rename a region, retune a reward tier, or swap a free gift without touching Liquid or JS.

---

## What's in here

### 1. Market routing banner (Task 01)

A dismissible banner that appears when the visitor looks like they are on the wrong regional store. Someone in the UAE landing on the UK store gets a one-click jump to `.ae`, with copy that mentions where they are browsing from.

Detection runs in this order:

1. `?country=XX` query string — wins outright and lets a reviewer flip regions without a VPN.
2. `sessionStorage` cache — one IP lookup per tab.
3. `ipapi.co` IP lookup — fallback when nothing is cached.

Everything the banner reads comes from admin:

- Regional store URLs, region names, and country lists — `huda_regional_store` metaobject.
- Which region this storefront _is_ — `huda_assessment.current_region` shop metafield.
- The on/off toggle — checkbox in **Theme settings → Huda assessment**.

The banner only shows when the detected region is different from the current storefront's region. Dismissals are scoped to _current region + target region_ in `sessionStorage`, so refreshing the same tab keeps it hidden while a new tab gives the shopper a fresh chance.

### 2. Cart reward progress (Task 02)

A progress bar that lives inside the cart drawer and on the cart page, nudging the shopper toward each milestone and updating live as items are added or removed. It works on mobile and desktop, and stays visible on empty-cart states so the shopper sees the offer before adding anything.

Tiers come from the `huda_cart_reward_milestone` metaobject and are sorted purely by spend. There is no hardcoded "shipping first, gift second" rule, so admin can add a new tier anywhere by setting its amount.

When a milestone has a `gift_product` set, the matching variant is added to the cart automatically once the qualifying total crosses the threshold, and removed if the total drops back below it.

Gift lines are tagged with a `_huda_cart_reward_gift` line item property, which lets the cart UI:

- show a "Free gift" badge instead of the quantity stepper, so it cannot be nudged to qty 2,
- skip the link to the PDP on the gift title and thumbnail,
- always render gift lines at the bottom of the cart, no matter when they were added.

If a shopper manually removes the gift, it stays removed for the rest of the browser session. The dismissal is persisted per variant in `localStorage` and only resets when the cart total drops below the threshold and crosses it again. That way, the cart respects the shopper's intent without losing the offer if their basket shrinks.

The qualifying total used for the progress bar excludes any gift's own line price, so a £35 free gift cannot push the £50 free-shipping milestone over the line by itself.

### 3. Product structured data — GEO / Schema (bonus)

The brief specifically called this out as relevant to work Huda Beauty is actively exploring around LLM and search engine discoverability, so this is built as a hand-rolled JSON-LD block rather than a one-line filter call.

Two JSON-LD scripts are emitted on every PDP:

- **`Product`** — name, description with HTML stripped, full image gallery, brand as a `Brand` object, category from `product.type`, and **one `Offer` per variant** with that variant's price, availability (`InStock` / `OutOfStock`), URL, condition, plus per-variant `sku` and `gtin` from the variant barcode when set in admin.
- **`BreadcrumbList`** — Home → first collection → product. Falls back to Home → product if the product is not in any collection. Cheap to include and gives crawlers + LLMs explicit navigation context.

Lives in [`snippets/huda-product-jsonld.liquid`](snippets/huda-product-jsonld.liquid) and is rendered from [`sections/product-information.liquid`](sections/product-information.liquid).

#### Why not just keep Horizon's `structured_data` filter?

Horizon ships with `{{ closest.product | structured_data }}` and it works fine for the basics, but it emits a single `Offer` with the cheapest variant's price, a single image, and no breadcrumb. That is the baseline, not the GEO-friendly version.

For this assessment, the brief specifically mentions LLM discoverability, so the schema work is more intentional than just leaving the default filter in place.

The hand-rolled block makes the page more useful for search engines and LLMs because it includes:

- proper schema.org structure: `Product`, `Offer`, `Brand`, and `BreadcrumbList`,
- one offer per variant instead of only the cheapest variant,
- the full product gallery instead of a single image,
- breadcrumb context, so the page structure is clearer.

It also makes the approach more portable. Horizon’s `structured_data` filter is useful, but it depends on modern Liquid and `closest.product`, which is Horizon-specific. Older themes like Brooklyn, Debut, or custom builds would not have that same setup, so this manual approach is closer to what would be needed there.

The original filter call is left commented out in `product-information.liquid` with a note, so it is clear that it was considered and intentionally not used here. The page still only outputs one `Product` schema, so there are no duplicate Product entities for Google to reject.

#### Production-mindset trade-off

In a real engagement, Horizon's filter would probably stay for the core `Product`, because Shopify maintains the edge cases like sale prices, currency, and sold-out variants. Additional schemas can then be added alongside it: `BreadcrumbList`, `Organization`, `FAQPage` where relevant.

Re-implementing `Product` manually means owning those edge cases. For this assessment, the hand-rolled approach demonstrates the implementation clearly, so it was worth implementing it manually.

#### How to verify

- View source on a PDP → exactly two `application/ld+json` blocks: `Product` + `BreadcrumbList`, with no third one from the filter.
- Paste into Google's [Rich Results Test](https://search.google.com/test/rich-results) using code input, since the dev store is password-protected → both items detected, no errors.

---

## Quick start

1. Run through [`docs/SETUP.md`](docs/SETUP.md) once — about 10 minutes in admin to set up the two metaobjects and the shop metafield.
2. Open the storefront with `?country=AE`. The UAE banner should show. Dismiss, refresh — it stays hidden in that tab.
3. Add a product. The progress bar fills toward the first milestone. Cross a tier with a gift set on it and the gift drops in automatically.

---

## File layout

### Market routing banner

| Path                                                                                       | What it does                                                          |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| [`snippets/huda-market-routing-banner.liquid`](snippets/huda-market-routing-banner.liquid) | Markup and JSON config block. Reads the metaobjects + shop metafield. |
| [`assets/huda-market-routing-banner.js`](assets/huda-market-routing-banner.js)             | Country detection, region matching, and dismiss state.                |
| [`assets/huda-market-routing-banner.css`](assets/huda-market-routing-banner.css)           | Banner layout, mobile breakpoint, focus, and hover states.            |

Rendered globally from [`layout/theme.liquid`](layout/theme.liquid), just under `<body>` so it sits above the sticky header.

The stylesheet plus a `preconnect` to `ipapi.co` are emitted from `<head>` only when the feature is enabled and the metaobjects exist, so there are no dead requests if a merchandiser turns the feature off.

### Cart reward progress

| Path                                                                     | What it does                                                                                                                         |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| [`snippets/huda-cart-rewards.liquid`](snippets/huda-cart-rewards.liquid) | Markup and JSON config block. Reads the milestone metaobjects, including the gift variant.                                           |
| [`assets/huda-cart-rewards.js`](assets/huda-cart-rewards.js)             | Listens to `cart:update`, renders progress, syncs reward gift lines, and persists dismissals.                                        |
| [`assets/huda-cart-rewards.css`](assets/huda-cart-rewards.css)           | Progress bar, milestone dots, and responsive layout.                                                                                 |
| [`snippets/cart-products.liquid`](snippets/cart-products.liquid)         | Cart row rendering. Paints the "Free gift" badge, hides the PDP link on gift lines, and groups gift rows at the bottom of the table. |

Rendered from:

- [`snippets/header-actions.liquid`](snippets/header-actions.liquid) — cart drawer.
- [`sections/main-cart.liquid`](sections/main-cart.liquid) — cart page, including empty-cart states so the offer is still visible before the shopper adds anything.

The CSS plus the JS module are emitted from [`layout/theme.liquid`](layout/theme.liquid) `<head>` once per page, regardless of how many slots render the snippet, so the assets are not loaded two or three times.

Cart updates come from Horizon's `cart:update` event. When the event payload already includes the cart's line items, the JS uses it directly and skips an extra `/cart.js` round trip.

Pure removals also reuse the cart that `/cart/change.js` returns, so the only case that still needs a separate fetch is _adding_ a gift, because Shopify's add endpoint does not return the full cart.

Self-dispatched events are filtered out at the top of the handler so the sync does not loop back into itself.

### Theme settings

[`config/settings_schema.json`](config/settings_schema.json) — a single **Huda assessment** group adds:

- Enable market routing banner, default on.
- Enable cart reward progress, default on.
- Cart reward heading, used as the eyebrow text above the bar.

Turning either toggle off stops the feature rendering and skips its assets.

### Bonus — structured data

| Path                                                                         | What it does                                                                                                                                |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| [`snippets/huda-product-jsonld.liquid`](snippets/huda-product-jsonld.liquid) | Hand-rolled `Product` + `BreadcrumbList` JSON-LD with one Offer per variant, full image gallery, brand, and per-variant SKU/GTIN.           |
| [`sections/product-information.liquid`](sections/product-information.liquid) | Renders the snippet on every PDP. Horizon's original `structured_data` filter call is kept commented out as documentation for the reviewer. |

---

## How a merchandiser uses this

Everything a non-technical merchandiser needs to edit is in admin:

- **Regional stores** — the `huda_regional_store` metaobject. One entry per region: code, name, country codes, store URL, CTA label, and banner copy with `[region_name]`, `[country_name]`, and `[country_code]` tokens.
- **Current storefront's region** — the `huda_assessment.current_region` shop metafield. This references the matching `huda_regional_store` entry.
- **Reward milestones** — the `huda_cart_reward_milestone` metaobject. One entry per tier: title, threshold, before/after messages with `[amount_remaining]` token, and optional `gift_product`.
- **Toggles + headings** — Theme settings → Huda assessment.

---

## Accessibility

### Banner

- `role="region"` with a descriptive aria-label.
- Native `<button>` for dismiss, with its own `aria-label`: "Close regional store notice".
- Focus-visible outlines on the CTA and dismiss button.

### Cart progress

- Native `<progress>` element instead of a div-with-ARIA fake.
- `aria-valuemin`, `aria-valuemax`, `aria-valuenow`, and `aria-valuetext` kept in sync.
- `aria-live="polite"` on the status text, so milestone changes are announced without stealing focus.

---

## Trade-offs and what would change for production

- **Cart-side gift insertion, not server-enforced.** Gifts go in via `/cart/add.js` from the storefront and are tagged with a `_huda_cart_reward_gift` line property. It keeps the feature reactive and code-only, but a determined shopper could keep the gift in their cart after going below the threshold by intercepting requests.

  For a real rollout, this should be backed by a Shopify Function or cart transform so the server is the final authority. Real discounts, including codes and automatic discounts, are still out of scope and would live in Shopify Discounts.

```
