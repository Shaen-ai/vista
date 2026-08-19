import * as THREE from "three";

/**
 * Slim rewrite of metrics_platform_published/src/app/planner/roomFloorMaterial.ts —
 * keeps only the two modes Vista's apartment viewer needs: a plain color surface
 * and a "customImage" texture-from-URL surface (used to project a room's rendered
 * interior onto a floor/portal in a later phase). The laminate/tile/wardrobe
 * machinery from the source is intentionally dropped.
 */

export interface ColorSurfaceOptions {
  color: THREE.ColorRepresentation;
  roughness?: number;
  metalness?: number;
  transparent?: boolean;
  opacity?: number;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
}

export function buildColorSurfaceMaterial(opts: ColorSurfaceOptions): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(opts.color),
    roughness: opts.roughness ?? 0.9,
    metalness: opts.metalness ?? 0,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    emissive: opts.emissive != null ? new THREE.Color(opts.emissive) : undefined,
    emissiveIntensity: opts.emissiveIntensity ?? 0,
  });
}

export interface CustomImageSurfaceOptions {
  /** Image URL — accepts data: URIs (room renders are base64) or http(s). */
  url: string;
  repeatX?: number;
  repeatY?: number;
  /** Called once the texture finishes loading so a demand-frameloop can repaint. */
  onLoaded?: () => void;
  roughness?: number;
  metalness?: number;
}

/**
 * MeshStandardMaterial whose map is loaded from an arbitrary image URL. The
 * texture streams in asynchronously; call `onLoaded` to `invalidate()` the scene.
 */
export function buildCustomImageSurfaceMaterial(
  opts: CustomImageSurfaceOptions,
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: opts.roughness ?? 0.85,
    metalness: opts.metalness ?? 0,
  });
  const loader = new THREE.TextureLoader();
  loader.load(
    opts.url,
    (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(opts.repeatX ?? 1, opts.repeatY ?? 1);
      texture.needsUpdate = true;
      material.map = texture;
      material.needsUpdate = true;
      opts.onLoaded?.();
    },
    undefined,
    () => {
      // leave the flat color on load failure
    },
  );
  return material;
}
