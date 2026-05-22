# Admin Setup

One-time setup for the two assessment features:

- **Market routing banner**
- **Cart reward progress bar + auto gift**

After setup, the merchant can manage regional URLs, country mappings, reward thresholds, gift products, and copy from Shopify Admin — no code deploy needed.

Estimated setup time: **~10 minutes**

---

## Setup Overview

You need to configure:

1. `huda_regional_store` metaobject  
   Powers the market routing banner.

2. `huda_cart_reward_milestone` metaobject  
   Powers the reward progress bar and auto gift logic.

3. `huda_assessment.current_region` shop metafield  
   Tells the theme which regional storefront this store represents.

4. Theme settings  
   Enables/disables the features and controls the reward heading.

---

## Before You Start

Go to:

**Settings → Custom data**

No app install is required.

Important: both metaobjects must have **Storefronts access** enabled.

If Storefronts access is not enabled, Liquid receives an empty list and nothing renders on the storefront.

> Most common issue: forgetting to enable **Storefronts can read this metaobject**.

---

## 1. Regional Store Metaobject

Go to:

**Settings → Custom data → Metaobjects → Add definition**

Use:

- **Name:** `Huda regional store`
- **Type / handle:** `huda_regional_store`
- **Access:** enable **Storefronts can read this metaobject**

### Fields

| Field key        | Type                     | Required | Notes                                                     |
| ---------------- | ------------------------ | -------- | --------------------------------------------------------- |
| `region_code`    | Single line text         | Yes      | Short ID, e.g. `UK`. Must match the shop metafield value. |
| `region_name`    | Single line text         | Yes      | Friendly region name shown in banner copy.                |
| `country_codes`  | List of single line text | Yes      | ISO 3166-1 alpha-2 codes, e.g. `GB`, `AE`, `US`.          |
| `store_url`      | URL                      | Yes      | Destination URL for the CTA.                              |
| `cta_label`      | Single line text         | Yes      | CTA text, e.g. `Shop UK store`.                           |
| `banner_message` | Multi-line text          | Yes      | Banner body copy. Supports tokens below.                  |

### Banner Message Tokens

You can use these tokens in `banner_message`:

- `[region_name]` — matched region name
- `[country_code]` — detected country code, e.g. `AE`
- `[country_name]` — detected country name, e.g. `United Arab Emirates`

Example:

```text
Looks like you're shopping from [country_name]. Visit our [region_name] store for local pricing and delivery.
```

### Sample Region Entries

Create one Active entry per region.

| Region         | `region_code` | `country_codes`                                      |
| -------------- | ------------- | ---------------------------------------------------- |
| United Kingdom | `UK`          | `GB`, `GG`, `JE`, `IM`                               |
| United States  | `US`          | `US`                                                 |
| Europe         | `EU`          | `FR`, `DE`, `ES`, `IT`, `NL`, `BE`, `IE`, `PT`, `AT` |
| UAE & GCC      | `UAE`         | `AE`, `SA`, `QA`, `KW`, `BH`, `OM`                   |

Notes:

- **Active** entries are live.
- **Draft** entries are disabled but kept in Admin.
- Keep country codes unique across regions.
- If the same country code exists in multiple entries, the first matching metaobject entry wins.

---

## 2. Cart Reward Milestone Metaobject

Go to:

**Settings → Custom data → Metaobjects → Add definition**

Use:

- **Name:** `Huda cart reward milestone`
- **Type / handle:** `huda_cart_reward_milestone`
- **Access:** enable **Storefronts can read this metaobject**

Create one Active entry per reward tier.

The theme does not hardcode the order. Milestones are sorted by `threshold_amount` at render time.

### Fields

| Field key          | Type              | Required | Notes                                                                                |
| ------------------ | ----------------- | -------- | ------------------------------------------------------------------------------------ |
| `title`            | Single line text  | Yes      | Short label, e.g. `Free shipping`, `Free gift`.                                      |
| `threshold_amount` | Decimal number    | Yes      | Spend amount in major currency units, e.g. `50.00` = £50.                            |
| `before_message`   | Multi-line text   | Yes      | Message before unlock. Supports `[amount_remaining]`.                                |
| `unlocked_message` | Multi-line text   | Yes      | Message after unlock.                                                                |
| `gift_product`     | Product reference | No       | Set only for tiers that should auto-add a free gift. Leave blank for non-gift tiers. |

### Reward Message Token

- `[amount_remaining]` — formatted in the cart currency, e.g. `£12.50`

Example:

```text
Spend [amount_remaining] more to unlock free shipping.
```

### Sample Milestones

| Title               | `threshold_amount` | `gift_product` | `before_message`                                               | `unlocked_message`         |
| ------------------- | ------------------ | -------------- | -------------------------------------------------------------- | -------------------------- |
| Free mini gift      | `35.00`            | Yes            | `Spend [amount_remaining] more to unlock your free mini gift.` | `Free mini gift unlocked.` |
| Free shipping       | `50.00`            | —              | `Spend [amount_remaining] more to unlock free shipping.`       | `Free shipping unlocked.`  |
| Free full-size gift | `100.00`           | Yes            | `Spend [amount_remaining] more to unlock your full-size gift.` | `Full-size gift unlocked.` |

Notes:

- Add more tiers any time.
- Display order is always `threshold_amount` ascending.
- Thresholds use the cart display currency.
- Dev store currency is GBP.
- Two-decimal currencies like USD, EUR, GBP, and AED work as-is.
- Zero/three-decimal currencies like JPY, KWD, and BHD would need a precision tweak in the snippet.

---

## Auto Gift Behavior

- The gift variant is added once the qualifying cart total reaches the threshold.
- If the cart drops below the threshold, the gift is removed automatically.
- If the shopper manually removes the gift while still above the threshold, it stays removed for that session.
- The gift is re-added only after the cart drops below the threshold and crosses it again.
- Gift lines show a **Free gift** badge instead of a quantity selector.
- Gift quantity cannot be increased to 2.
- Gift title and image do not link to the PDP.
- Gift lines always sit at the bottom of the cart.
- Gift line price is excluded from threshold checks, so the gift cannot unlock another reward by itself.

---

## 3. Current Region Shop Metafield

This tells the theme which regional storefront it is, so the banner only appears when the shopper is on the wrong store.

Go to:

**Settings → Custom data → Shop → Add definition**

Use:

- **Namespace and key:** `huda_assessment.current_region`
- **Type:** Metaobject reference to `huda_regional_store`
- **Access:** enable **Storefronts can read this metafield**

Then go to:

**Settings → Custom data → Shop → Edit**

Select the matching region entry.

For the dev store, select:

**United Kingdom (UK)**

---

## 4. Theme Settings

Go to:

**Theme editor → Theme settings → Huda assessment**

Available settings:

- **Enable market routing banner** — on by default
- **Enable cart reward progress** — on by default
- **Cart reward heading** — eyebrow text above the progress bar

Turning either toggle off immediately stops that feature from rendering and skips loading its assets.

---

## Country Detection Logic

The banner detects the shopper country in this order:

1. `?country=XX` query parameter
   Used for QA and reviewer testing. Always wins and is not cached.

2. `sessionStorage` cache
   Reuses the country already resolved for the current tab.

3. `https://ipapi.co/json/`
   IP lookup. Runs once per tab, then caches the result.

---

## Troubleshooting

### Banner is not showing

Check:

1. Is Storefronts access enabled on `huda_regional_store`?
2. Is `huda_assessment.current_region` pointing to the correct region?
3. Is there at least one Active region with a different `region_code`?
4. Does `?country=AE` show the banner?
   - If yes, auto-detection may be blocked by an ad blocker or firewall blocking `ipapi.co`.

5. Is **Enable market routing banner** turned on?

---

### Wrong region wins

A country code is likely assigned to more than one region.

Fix by:

- keeping country codes unique, or
- moving the preferred entry earlier in the metaobject list.

---

### Progress bar is stuck at 0

Check:

1. Is Storefronts access enabled on `huda_cart_reward_milestone`?
2. Is `threshold_amount` saved as a decimal number, not text?
3. Is at least one milestone Active?
4. Is **Enable cart reward progress** turned on?

---

### Free gift does not auto-add

Check:

1. Is `gift_product` set on the milestone?
2. Does the selected product have an available variant?
3. Did the shopper already remove this gift in the same browser session?

For QA reset, clear this localStorage key:

```text
huda_cart_rewards_dismissed_gifts
```

---

### Gift line shows quantity selector instead of Free gift badge

The badge logic checks this cart line property:

```text
item.properties._huda_cart_reward_gift
```

If the gift was added through another flow, such as a manual `/cart/add` call without that property, the row falls back to the normal quantity selector.

---

### Banner does not stay dismissed

Dismissal is stored per tab in `sessionStorage`.

That means:

- refresh keeps it hidden
- opening a new tab can show it again

This is intentional. A longer-lived dismissal would require `localStorage`.

---

## GEO Banner QA Overrides

Use these query parameters for testing:

```text
?country=GB   # UK current region — no banner expected
?country=AE   # UAE banner
?country=US   # US banner
?country=FR   # EU banner
```

```

```
