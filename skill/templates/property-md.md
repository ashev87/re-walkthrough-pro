# Property Template

Template for `listing-walkthroughs/{property-slug}/PROPERTY.md` — the per-property brief that travels with the walkthrough assets.

**Purpose:** Capture everything about the property (so the folder is self-describing for re-runs and for the agent pitch) plus the creative choices used for this build.

---

## File Template

```markdown
# {property-address}

**Zillow:** {zillow-url}
**Status:** {listing-status}
**Slug:** {property-slug}
**Built:** {build-date}

## Property
| Field | Value |
|-------|-------|
| Price | {price} |
| Beds | {beds} |
| Baths | {baths} |
| Living area | {sqft} sqft |
| Year built | {year-built} |
| Home type | {home-type} |

## Agent
- **Name:** [Listing agent name]
- **Contact:** [Phone / email if returned]
- **Brokerage:** [Brokerage]

## Photos
- Source count: {source-photo-count} (in `source-images/`)
- Curated for animation: {curated-count}

## Shot List (walkthrough order)
| # | Room | Photo | Camera move |
|---|------|-------|-------------|
| 01 | [exterior] | [NN-original.jpg] | [push-in] |
| 02 | [entry] | [NN-original.jpg] | [forward dolly] |
| ... | ... | ... | ... |

## Build Choices
- **Style:** {style}            (cinematic / basic)
- **Rooms:** {room-mode}        (auto-curate / all)
- **Output ratio:** {ratio}     (16:9 / 9:16 / both)
- **Engine:** {engine}          (Seedance 2.0 / Kling 3.0)

## Outputs
- Master: `final/walkthrough-16x9.mp4`
- Social: [final/walkthrough-9x16.mp4 if produced]
- Scenes: {scene-count} clips in `scenes/`

## Run Notes
[Any rooms skipped/failed, regenerations, or cost notes]
```

---

## Field Documentation

| Field | Type | Required | Purpose | Example |
|-------|------|----------|---------|---------|
| `{property-address}` | variable | Yes | Full street address | `17 Zelma Dr, Greenville, SC 29617` |
| `{zillow-url}` | variable | Yes | Source listing link | `https://www.zillow.com/homedetails/.../11026031_zpid/` |
| `{listing-status}` | variable | Yes | FOR_SALE / RECENTLY_SOLD / FOR_RENT | `FOR_SALE` |
| `{property-slug}` | variable | Yes | kebab-case folder name | `17-zelma-dr-greenville-sc-29617` |
| `{build-date}` | variable | Yes | Date built (YYYY-MM-DD) | `2026-06-27` |
| `{price}` `{beds}` `{baths}` `{sqft}` `{year-built}` `{home-type}` | variable | Yes | Core specs from the actor | `$415,000` / `3` / `2` / `1840` / `1998` / `Single Family` |
| `{source-photo-count}` `{curated-count}` `{scene-count}` | variable | Yes | Counts from the run | `34` / `8` / `8` |
| `{style}` `{room-mode}` `{ratio}` `{engine}` | variable | Yes | The build choices | `cinematic` / `auto-curate` / `16:9` / `Seedance 2.0` |
| `[Listing agent name]` / `[Contact]` / `[Brokerage]` | prose | No | Agent details if the actor returned them | `Jane Doe, Keller Williams` |
| `[Shot list rows]` | prose | Yes | One row per animated room | `01 / exterior / 03-original.jpg / push-in` |
| `[Run Notes]` | prose | No | Skips, retries, cost | `Bath 2 skipped — only floorplan photo` |

## Section Specifications

### Property
**Purpose:** The spec table the agent cares about.
**Contains:** Price, beds, baths, sqft, year, home type — pulled straight from the detail scraper.
**Quality check:** Every cell filled from actor data, not guessed.

### Shot List
**Purpose:** Audit trail mapping each scene clip back to its source photo + camera move.
**Contains:** One row per animated room in walkthrough order.
**Quality check:** Row count equals `scenes/` clip count.

### Build Choices
**Purpose:** Reproducibility — re-run the same property the same way.
**Quality check:** All four choices recorded (style, rooms, ratio, engine).
