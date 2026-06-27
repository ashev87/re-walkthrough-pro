# Walkthrough Quality Checklist

Validates a finished property walkthrough before delivering it to an agent.

## Assets & Structure
- [ ] `listing-walkthroughs/{property-slug}/` contains PROPERTY.md, source-images/, scenes/, final/
- [ ] PROPERTY.md has address, Zillow link, specs, and all four build choices recorded
- [ ] source-images/ has at least one photo per animated room
- [ ] scenes/ clip count equals the PROPERTY.md shot-list row count

## Video Output
- [ ] final/ contains a non-zero master file (walkthrough-16x9.mp4 or chosen ratio)
- [ ] Master duration ≈ sum of scene durations (no clip silently dropped)
- [ ] Scenes play in walkthrough order: exterior → entry → living → kitchen → beds → baths → outdoor
- [ ] If 9:16 was requested, final/walkthrough-9x16.mp4 exists and is correctly reframed (subject not cropped out)

## Visual Quality
- [ ] No clip has obvious melting/warping of furniture, doorways, or windows
- [ ] Each clip uses one slow camera move (no fast or compound moves)
- [ ] Exterior opens the tour; an outdoor/backyard shot closes it when available
- [ ] No floorplans, maps, or watermark-heavy photos animated as rooms

## Truth-in-Claims
- [ ] Asset is described as a "cinematic walkthrough," not "3D" or "Matterport"
- [ ] Master is silent (v1) — no accidental audio baked in

## Scoring

| Score | Rating | Action |
|-------|--------|--------|
| 100% | Ship it | Deliverable to the agent |
| 80-99% | Fix and ship | Regenerate the offending room(s), then go |
| 50-79% | Rework | Several bad clips or wrong order — rebuild scenes |
| Below 50% | Restart | Bad source set or wrong listing — re-scrape |
