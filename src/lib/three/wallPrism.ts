import * as THREE from "three";

/**
 * Ported from metrics_platform_published/src/app/planner/utils/wallPrism.ts
 * (only the piece Vista needs). CSG wall geometries omit UVs while boolean cuts
 * are evaluated; this restores planar UVs afterwards so wall/floor textures have
 * coordinates to sample.
 */

function normalizedRange(value: number, min: number, span: number) {
  return span > 1e-6 ? (value - min) / span : 0;
}

/** Generate simple wall/floor/ceiling UVs from world-space position and face normal. */
export function applyPlanarSurfaceUvs(geom: THREE.BufferGeometry): THREE.BufferGeometry {
  const position = geom.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!position) return geom;
  if (!geom.getAttribute("normal")) geom.computeVertexNormals();

  const normal = geom.getAttribute("normal") as THREE.BufferAttribute | undefined;
  geom.computeBoundingBox();
  const box = geom.boundingBox;
  if (!box) return geom;

  const spanX = box.max.x - box.min.x;
  const spanY = box.max.y - box.min.y;
  const spanZ = box.max.z - box.min.z;
  const uv: number[] = [];

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const nx = normal?.getX(i) ?? 0;
    const ny = normal?.getY(i) ?? 0;
    const nz = normal?.getZ(i) ?? 0;
    const ax = Math.abs(nx);
    const ay = Math.abs(ny);
    const az = Math.abs(nz);

    if (ay >= ax && ay >= az) {
      uv.push(normalizedRange(x, box.min.x, spanX), normalizedRange(z, box.min.z, spanZ));
    } else if (ax >= az) {
      uv.push(normalizedRange(z, box.min.z, spanZ), normalizedRange(y, box.min.y, spanY));
    } else {
      uv.push(normalizedRange(x, box.min.x, spanX), normalizedRange(y, box.min.y, spanY));
    }
  }

  geom.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  return geom;
}
