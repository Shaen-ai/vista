"use client";

import { type ComponentRef, type MutableRefObject, useEffect, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { Apartment3D } from "@/lib/project/apartment3d";
import { ApartmentScene } from "./ApartmentScene";

export type ViewMode = "dollhouse" | "top";

type ApartmentOrbitControls = ComponentRef<typeof OrbitControls>;

function apartmentCenter(apartment: Apartment3D) {
  const { minX, maxX, minZ, maxZ } = apartment.bounds;
  return {
    cx: (minX + maxX) / 2,
    cz: (minZ + maxZ) / 2,
    diag: Math.max(Math.hypot(maxX - minX, maxZ - minZ), 4),
  };
}

function CameraController({
  apartment,
  viewMode,
  controlsRef,
}: {
  apartment: Apartment3D;
  viewMode: ViewMode;
  controlsRef: MutableRefObject<ApartmentOrbitControls | null>;
}) {
  const { camera, invalidate } = useThree();

  useEffect(() => {
    const { cx, cz, diag } = apartmentCenter(apartment);
    if (viewMode === "top") {
      camera.position.set(cx, diag * 1.35, cz + 0.001);
    } else {
      camera.position.set(cx + diag * 0.75, diag * 0.85, cz + diag * 0.75);
    }
    camera.updateProjectionMatrix();
    const controls = controlsRef.current;
    if (controls) {
      controls.target.set(cx, 0, cz);
      controls.update();
    }
    invalidate();
  }, [apartment, viewMode, camera, controlsRef, invalidate]);

  const { diag } = apartmentCenter(apartment);
  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enablePan
      minDistance={Math.max(1, diag * 0.2)}
      maxDistance={diag * 3}
      maxPolarAngle={Math.PI / 2.05}
    />
  );
}

function ContextLostHandler({ onLost }: { onLost: () => void }) {
  const { gl, invalidate } = useThree();
  useEffect(() => {
    const canvas = gl.domElement;
    const handleLost = (e: Event) => {
      e.preventDefault();
      onLost();
    };
    const handleRestored = () => invalidate();
    canvas.addEventListener("webglcontextlost", handleLost, false);
    canvas.addEventListener("webglcontextrestored", handleRestored, false);
    return () => {
      canvas.removeEventListener("webglcontextlost", handleLost);
      canvas.removeEventListener("webglcontextrestored", handleRestored);
    };
  }, [gl, invalidate, onLost]);
  return null;
}

export default function ApartmentCanvas({
  apartment,
  viewMode,
  selectedRoomId,
  onSelectRoom,
  onDeselect,
}: {
  apartment: Apartment3D;
  viewMode: ViewMode;
  selectedRoomId: string | null;
  onSelectRoom: (roomId: string) => void;
  onDeselect: () => void;
}) {
  const controlsRef = useRef<ApartmentOrbitControls | null>(null);
  const [canvasKey, setCanvasKey] = useState(0);
  const [contextLost, setContextLost] = useState(false);

  const hideCeiling = viewMode === "top";

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {contextLost && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 5,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            background: "rgba(0,0,0,0.55)",
            color: "#fff",
          }}
        >
          <span>3D view lost its graphics context.</span>
          <button
            type="button"
            onClick={() => {
              setContextLost(false);
              setCanvasKey((k) => k + 1);
            }}
            style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #fff", background: "transparent", color: "#fff" }}
          >
            Reload 3D
          </button>
        </div>
      )}
      <Canvas
        key={canvasKey}
        frameloop="demand"
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.0 }}
        camera={{ fov: 45, near: 0.05, far: 1000, position: [8, 8, 8] }}
        onCreated={({ invalidate }) => invalidate()}
        onPointerMissed={onDeselect}
      >
        <color attach="background" args={["#f2f0ec"]} />
        <ContextLostHandler onLost={() => setContextLost(true)} />
        <CameraController apartment={apartment} viewMode={viewMode} controlsRef={controlsRef} />
        <ApartmentScene
          apartment={apartment}
          selectedRoomId={selectedRoomId}
          hideCeiling={hideCeiling}
          onSelectRoom={onSelectRoom}
        />
      </Canvas>
    </div>
  );
}
