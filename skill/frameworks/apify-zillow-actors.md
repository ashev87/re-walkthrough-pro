<apify_zillow_actors>

## Purpose

The Apify actor stack for pulling Zillow listings + photos, and how to call it via the Apify MCP. Researched and validated 2026-06-27. Zillow hard-blocks naive `fetch`/headless scraping, so an actor is the reliable source of both the listing metadata and the photos — Claude cannot "just grab" the images from a URL.

## The Stack

| Role | Actor (`username/name`) | Use it for |
|------|-------------------------|------------|
| **Primary — detail + photos** | `maxcopell/zillow-detail-scraper` | One property → photos + address + price + beds/baths/sqft + year + room types + agent, in ONE call. This is the default for both input paths. |
| **Discovery — search** | `maxcopell/zillow-scraper` | "Find listings" from a Zillow search URL. Returns listing URLs + a dataset. |
| **Discovery — by ZIP** | `maxcopell/zillow-zip-search` | "Find listings in 07042" — search by ZIP code with filters. |
| **Fallback — images only** | `burbn/zillow-property-images-scraper` | If the detail scraper's photo set is thin; hi-res images to 1536px from `propertyUrls`. |

**Why this stack:** the maxcopell suite is built to chain — a search actor writes a dataset, and the detail scraper reads it via its `searchResultsDatasetId` input. So discovery and single-property paths share one downstream actor (the detail scraper), which is the one that returns photos.

## How to Call (Apify MCP)

Use the Apify MCP tools (load via ToolSearch if deferred: `mcp__apify__fetch-actor-details`, `mcp__apify__call-actor`, `mcp__apify__get-dataset-items`).

1. **Inspect input** (only if unsure of fields): `fetch-actor-details` with `{ inputSchema: true }`.
2. **Run** the actor: `call-actor` with the actor `fullName` + input JSON. For a single property, prefer `waitSecs > 0` so the run completes and returns results inline.
3. **Read output**: results land in the run's dataset — read them (the call result includes the dataset, or use `get-dataset-items` with the returned dataset id).

### Detail scraper input — by URL (most common)

```json
{
  "startUrls": [
    { "url": "https://www.zillow.com/homedetails/17-Zelma-Dr-Greenville-SC-29617/11026031_zpid/" }
  ],
  "propertyStatus": "FOR_SALE"
}
```

### Detail scraper input — by address

```json
{
  "addresses": ["18 Zelma Dr, Greenville, SC 29617"],
  "propertyStatus": "FOR_SALE"
}
```

### Chaining discovery → detail

```json
// after running maxcopell/zillow-zip-search and getting its dataset id:
{ "searchResultsDatasetId": "<dataset-id-from-search-run>" }
```

## What the Detail Scraper Returns (validated)

Per its README, each result includes: price + listing status, full address + coordinates, home type, year built, lot size, living area, room counts and **room types**, parking/garage, HOA/fees, interior/exterior features, **image URLs and rich media links**, agent/broker contact + license, tour availability, MLS/attribution, parcel/tax ids, tax + price history, nearby/comparable listings, schools.

The fields this skill needs: `address`, `price`, `beds`/`baths`/`sqft` (living area), `yearBuilt`, agent name/contact, and the **image URL list** (feeds `source-images/` and the per-room animation).

## propertyStatus matters

Zillow serves for-sale, for-rent, and sold via different methods, so the detail scraper needs `propertyStatus` to match the listing. If it's wrong, the actor self-corrects but spends extra requests. Defaults: active listing → `FOR_SALE`; sold comps → `RECENTLY_SOLD`; rentals → `FOR_RENT`.

## Cost

All PAY_PER_EVENT, sub-cent per property on the free tier (detail scraper ~$0.0036/result, search ~$0.0023/result; cheaper at higher Apify tiers). Scraping cost is negligible next to Higgsfield credits — the room count (curation) is the real cost lever, not the scrape.

## Anti-Patterns

| Anti-Pattern | Why It's Bad | Fix |
|-------------|-------------|-----|
| Trying to fetch Zillow photos with curl/headless directly | Zillow blocks it; you get nothing or a CAPTCHA | Always route images through the actor |
| Running the images-only actor AND the detail scraper for one property | Detail scraper already returns photos — double spend | Use detail scraper alone; images actor only as a fallback |
| Omitting `propertyStatus` on a sold/rental listing | Extra requests, slower, possible wrong record | Pass the correct status |
| Re-scraping on every run | Wastes events; photos already in source-images/ | Reuse the saved source-images/ when regenerating clips |

## Source

Apify Store, Real Estate category. Actor IDs current as of 2026-06-27; re-verify with `search-actors "Zillow"` if a run 404s or an actor is deprecated.

</apify_zillow_actors>
