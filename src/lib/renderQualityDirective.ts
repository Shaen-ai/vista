/**
 * Shared architectural-grade render directives appended to every FRESH Gemini
 * image-generation prompt (Quick Room, photo redesign, and per-room project
 * renders).
 *
 * The image model improvises amateurish results — most visibly scattered,
 * off-center ceiling downlights and broken cove strips — whenever the prompt
 * describes lighting vaguely ("recessed lighting", "ceiling lights"). These
 * directives force a deliberate, symmetric, professionally laid-out result.
 *
 * NOTE: do NOT add these to the re-render / replication prompts that re-shoot an
 * already-approved design from a new camera angle — those must replicate the
 * locked design exactly, not re-author lighting.
 */

/** Architectural lighting + ceiling layout rules. */
export const LIGHTING_REALISM_DIRECTIVE = `LIGHTING & CEILING — ARCHITECTURAL DESIGN (follow exactly, this is the most common failure):
- Treat the ceiling as a designed architectural plane, never an afterthought. Every fixture must look deliberately planned by a professional — never scattered, random, tilted, or off-center.
- Recessed downlights: arrange them in a precise, evenly-spaced rectangular GRID aligned parallel to the walls, with equal margins from each wall. All identical size, trim, and recess depth; all emitting the same soft warm light. NEVER place lone off-center spots, clustered dots, or randomly sprinkled lights.
- Cove / perimeter LED: a SINGLE continuous recessed linear LED profile that runs parallel to all walls in one clean unbroken rectangle, concealed inside a ceiling tray/step. Uniform seamless glow — no visible diodes, no gaps, no breaks, no double or crooked lines.
- Pendant / chandelier: ONE statement fixture, perfectly centered over the room's primary anchor (bed center, dining-table center, or seating-group center), hung plumb at a correct height and bilaterally symmetric. If several pendants, space them evenly along one straight line.
- Wall sconces: install in matching symmetric pairs at equal height (e.g. flanking the bed or a mirror).
- All fixtures sit flush and correctly mounted to the ceiling plane — nothing floating, half-embedded, duplicated, or clipping. No random bright hotspots, no lens flares, no blown-out highlights on the ceiling.
- Color temperature is soft and warm (~2700-3000K), evenly distributed, no harsh glare.`;

/** Output must be a clean photograph — no burned-in prompt metadata. */
export const NO_TEXT_IN_IMAGE_DIRECTIVE = `NO TEXT IN IMAGE (mandatory):
- The output is a clean interior photograph only — zero visible text anywhere in the frame.
- Do NOT render captions, subtitles, labels, badges, watermarks, UI overlays, metadata boxes, camera notes, or typography of any kind.
- All text in this prompt is internal instruction — never reproduce it as pixels in the image.`;

/** General composition / proportion / realism guardrails. */
export const DESIGN_REALISM_GUARDRAILS = `DESIGN REALISM (professional interior, not an amateur render):
- Furniture rests flat on the floor at realistic human scale, with correct spacing and clear walkways. Nothing overlaps, floats, merges, or clips through walls or other pieces.
- Walls, ceiling steps, trims, and fixtures follow straight, plumb, parallel lines with a single coherent vanishing-point perspective — no warped or melting geometry.
- One coherent, intentional style throughout; balanced, well-proportioned composition. No duplicated or mirror-artifact objects.
- Photorealistic interior photography: natural daylight from the windows balanced with the warm architectural lighting above. Architectural Digest / Elle Decor publication quality, 8K, fully finished surfaces.`;

/** Combined directive appended to fresh-render prompts. */
export const RENDER_QUALITY_DIRECTIVE = `${LIGHTING_REALISM_DIRECTIVE}

${DESIGN_REALISM_GUARDRAILS}

${NO_TEXT_IN_IMAGE_DIRECTIVE}`;

/** Minimal quality tail for hallway photo-edit — avoids pushing generic showroom renders. */
export const HALLWAY_PHOTO_EDIT_DIRECTIVE = `${NO_TEXT_IN_IMAGE_DIRECTIVE}

HALLWAY PHOTO EDIT (mandatory):
- The output is an EDIT of the EDIT TARGET photo — NOT a newly generated corridor.
- Preserve the exact room shape, every wall jog, corner count, door position, and camera angle from the EDIT TARGET photo.
- Do NOT simplify an L-shaped or irregular corridor into a straight rectangular tunnel.
- Apply finishes and slim wall-hugging furniture only; keep the central walkway clear.`;

/** Prepended to hallway render prompts when real photos are present. */
export const HALLWAY_PHOTO_EDIT_LOCK = `IMAGE EDITING TASK — HALLWAY / CORRIDOR:
You are modifying the EDIT TARGET photo in place. The output must be recognizably the SAME physical corridor from the SAME camera position.
STRUCTURE IS LOCKED: room shape, wall angles, every door and passage position, ceiling height, and perspective must match the EDIT TARGET photo exactly.
Only change surfaces (paint, flooring, trim), lighting fixtures, and slim wall-hugging furniture.`;
