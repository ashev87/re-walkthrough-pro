<higgsfield_camera_moves>

## Purpose

How to drive the Higgsfield MCP to turn a single still room photo into a cinematic clip that reads as "walking through" the house — using the proven Seedance prompt craft from the sibling skills `seedance-real-estate` (15-real-estate) and `seedance-cinematic` (01-cinematic) instead of hand-rolled prompts. A walkthrough is NOT one generation; it is one short image-to-video clip per room, each with a room-appropriate camera move, stitched later.

## The Hard Constraint (read first)

Higgsfield `generate_video` is **image-to-video**: it animates a camera/scene move on one still for a short clip (~5s). It does NOT reconstruct 3D space or walk a continuous path through a house. Therefore:

- Whole-house walkthrough = N per-room clips, stitched on our side (see `stitch-pipeline.md`).
- Never promise true 3D / Matterport. Sell it as a "cinematic walkthrough."

## Image-to-Video Adaptation (important)

`seedance-real-estate` and `seedance-cinematic` mostly author **text-to-video** prompts — they describe the entire scene. We feed a **real listing photo**, so the photo already carries the scene. Borrow only these layers from those skills, applied as a motion prompt ON the photo:

1. The **camera move** (from the RE Camera Movement Library).
2. The **lighting / time-of-day mood** (RE Lighting Guide) — only as a light grade, do not re-describe furniture/layout.
3. For cinematic style, the **film-look layer** from `seedance-cinematic` (color grade, atmosphere, depth).

Do NOT re-describe the room's contents in the prompt — that fights the input image and drifts content. Prompt the camera + light, trust the photo.

## How to Author Each Room's Prompt

For each room photo, build the motion prompt by consulting the sibling skills:

1. Pick the room's camera move from the mapping below (named moves from `seedance-real-estate` → Camera Movement Library).
2. Invoke the **`seedance-real-estate`** skill for that move's wording + the room's entry in Room-by-Room Showcase Strategy + a lighting cue from the Lighting & Time-of-Day Guide.
3. If build style = **cinematic**, also invoke **`seedance-cinematic`** and layer its color-grade / atmosphere language.
4. Compress the move to the ~5s clip length; keep ONE move per clip.

## Room → Camera Move Mapping (RE Camera Movement Library)

| Room / shot | Named move (seedance-real-estate) | Note for image-to-video |
|-------------|-----------------------------------|--------------------------|
| Exterior / establishing | DRONE AERIAL APPROACH (or GIMBAL GLIDE along facade) | slow approach toward entry; compress to ~5s |
| Entry / foyer | DOORWAY THRESHOLD REVEAL → STEADICAM WALKTHROUGH | "walking in" feel |
| Hallway | STEADICAM WALKTHROUGH | human walking pace, smooth |
| Living / great room | ROTATING/ORBIT or GIMBAL SMOOTH GLIDE | reveal space + depth |
| Kitchen | GIMBAL SMOOTH GLIDE (counter flow) or ORBIT (island) | highlight finishes |
| Dining | GIMBAL SMOOTH GLIDE (table approach) | warm, steady |
| Primary bedroom | STEADICAM / gentle GIMBAL GLIDE | calm, spacious |
| Primary bath / spa | DOORWAY THRESHOLD REVEAL → short push-in | bright, clean |
| Secondary bedroom | GIMBAL SMOOTH GLIDE | brief beat |
| Guest bathroom | REVEAL AROUND CORNER / short push-in | quick, don't linger |
| Home office / library | PULLBACK OR PUSH-IN REVEAL | detail → context |
| Specialty (gym, cinema, wine) | PULLBACK/PUSH-IN or ORBIT | feature the wow |
| Window / view feature | WINDOW APPROACH & VIEW REVEAL | the emotional beat |
| Soaring ceiling / 2-story foyer | CEILING-TO-FLOOR VERTICAL TILT | reveal height |
| Outdoor / backyard / pool | DRONE AERIAL APPROACH or LATERAL CRANE | rising reveal closer |
| Detail (marble, fixtures, joinery) | PULLBACK/PUSH-IN REVEAL + SUBTLE FOCUS SHIFT | craftsmanship |

## Prompting Rules

- **One move per clip.** Compound moves warp geometry. Single and slow.
- **Slow beats fast.** Real estate reads premium when calm; fast moves expose AI artifacts (melting furniture, bent doorways).
- **Prompt the camera + light, not the scene.** The photo carries content.
- **Engine is independent of the prompt craft.** The camera-move + lighting + cinematic-grade layers are model-agnostic — they apply to whatever Higgsfield video model you pick (Seedance 2.0 default, Kling 3.0, or a future model). Optionally `models_explore(action:'recommend')` per shot.
- **Aspect ratio = master ratio.** Generate at 16:9 for the agent master (or 9:16 if that's the only output). Reframe later; never generate twice.

## Generation + Polling

1. `generate_video` (image-to-video) per room photo with its authored motion prompt → job id.
2. Dispatch all rooms, then poll `job_status` per id (don't block room N on N-1).
3. Download each clip to `scenes/room-NN-{type}.mp4`, NN = walkthrough position.

## Handling Bad Outputs

| Symptom | Fix |
|---------|-----|
| Furniture melts / warps | Regenerate with a gentler, shorter move (orbit → short push-in) |
| Doorway / window bends | Reduce move distance; prefer lateral glide over push-in for that room |
| Clip too short to feel cinematic | Accept it — stitched short clips still read as a tour; never force one long generation |
| One room keeps failing | Note it, skip after one retry; never block the property on one room |

## Anti-Patterns

| Anti-Pattern | Why It's Bad | Fix |
|-------------|-------------|-----|
| Re-describing the room in the prompt | Fights the input photo, drifts content | Prompt only the camera move + light |
| Copying the seedance skills' full text-to-video scene prompts | They assume no input image; bloats + drifts | Borrow camera-move + lighting layers only |
| Generating the whole house in one call | Higgsfield can't; incoherent output | One clip per room, stitch later |
| Fast / compound camera moves | Exposes AI artifacts, looks cheap | Single slow move per clip |
| Duplicating the RE Camera Library into this skill | Two sources drift on every Seedance update | Invoke `seedance-real-estate` by name |

## Source

Camera-move grammar: `seedance-real-estate` (15-real-estate) Camera Movement Library + Room-by-Room Showcase Strategy + Lighting & Time-of-Day Guide. Film-look layer: `seedance-cinematic` (01-cinematic). Higgsfield MCP: `generate_video`, `models_explore`, `job_status`, `reframe`.

</higgsfield_camera_moves>
