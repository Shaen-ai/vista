# Roboflow CubiCasa floor-plan detect (Full Project upload)

Doors, windows, and walls are detected with the [CubiCasa5k](https://universe.roboflow.com/floorplan-recognition/cubicasa5k-2-qpmsa) model. Detections are merged into **Full Project analyze** as a geometry prior for OpenAI vision and post-snap of openings (not overlay-only).

## Environment (server)

Add to `vista/.env.local`:

```bash
ROBOFLOW_API_KEY=your_key
# Serverless path is `{project}/{version}` — preferred:
ROBOFLOW_MODEL=cubicasa5k-2-qpmsa
ROBOFLOW_MODEL_VERSION=6   # integer from Roboflow model page (Universe cubicasa5k-2 is usually 6)
# Universe workspace prefix also works (stripped automatically):
# ROBOFLOW_MODEL=floorplan-recognition/cubicasa5k-2-qpmsa
```

Optional offline dev (returns bundled 31-box fixture scaled to upload size):

```bash
ROBOFLOW_USE_MOCK=1
```

Restart `npm run dev` after changing env vars.

## API

`POST /api/project/roboflow-detect` — multipart field `file` (original image bytes).

Response:

```json
{
  "image": { "width": 914, "height": 1720 },
  "predictions": [ … ],
  "normalized": [ … 0–1 overlay coords … ]
}
```

Normalization **must** use `image.width` and `image.height` from Roboflow (see [`floorPlanDetections.ts`](../src/lib/project/floorPlanDetections.ts)).

## Dev fixture (matched pair)

| Asset | Path |
|--------|------|
| Inference-sized image (914×1720) | [`public/fixtures/cubicasa5k-sample.jpg`](../public/fixtures/cubicasa5k-sample.jpg) |
| 31 predictions + `image` size | [`src/lib/project/fixtures/cubicasa5k-sample.detections.json`](../src/lib/project/fixtures/cubicasa5k-sample.detections.json) |

On [`/project/new`](../src/app/project/new/page.tsx), use **Load sample plan** (development only): loads the fixture image and overlay without calling Roboflow.

## Verification

1. **Fixture:** `/project/new` → Load sample plan → boxes align with walls/openings (same aspect as 914×1720 JSON).
2. **Live:** Upload the **same file** you used in Roboflow Universe → overlay should match Universe when `ROBOFLOW_*` is configured.
3. Using static JSON on a **different resolution** upload will misalign (expected).

Replace `cubicasa5k-sample.jpg` with your exact Roboflow inference export if the bundled resize differs from your Universe upload.
