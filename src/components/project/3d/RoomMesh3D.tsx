"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { type ThreeEvent, useThree } from "@react-three/fiber";
import type { Opening3D, Room3D, Vec2 } from "@/lib/project/apartment3d";
import {
  createPolygonWallSegmentWithHoles,
  edgeFrame,
  miterExtension,
  polygonWallHoleCutsForSegment,
} from "@/lib/three/polygonWallCsg";

const WALL_COLOR = "#e9e6e1";
const SLAB_COLOR = "#cfcac2";
const GLASS_COLOR = "#bfe4f5";

/** Base floor tint per room type — muted, distinguishable in the dollhouse. */
const ROOM_TYPE_COLOR: Record<string, string> = {
  living: "#d8ccb9",
  kitchen: "#d6d2c4",
  bedroom: "#d3c8bd",
  children: "#d9cdc9",
  bathroom: "#c9d6d6",
  toilet: "#c9d6d6",
  laundry: "#ccd2d2",
  hallway: "#d2cec7",
  dining: "#d8ccb9",
  office: "#cdccc4",
  wardrobe: "#d2c9c0",
  storage: "#cdc9c2",
  balcony: "#cfd3cc",
  other: "#d3cfc8",
};

function roomColor(type: string): string {
  return ROOM_TYPE_COLOR[type] ?? ROOM_TYPE_COLOR.other;
}

/** THREE.Shape from an XZ outline (shape space uses x, z), extruded then rotated to lie on XZ. */
function createOutlineShape(outline: Vec2[]): THREE.Shape {
  const shape = new THREE.Shape();
  if (!outline.length) return shape;
  shape.moveTo(outline[0].x, outline[0].z);
  for (let i = 1; i < outline.length; i++) shape.lineTo(outline[i].x, outline[i].z);
  shape.closePath();
  return shape;
}

function openingsForEdge(openings: Opening3D[], edgeIndex: number): Opening3D[] {
  return openings.filter((o) => o.edgeIndex === edgeIndex);
}

/** One wall slab for polygon edge `edgeIndex`, with door/window holes + corner miter. */
function WallSegmentMesh({
  room,
  edgeIndex,
  wallThickness,
  material,
}: {
  room: Room3D;
  edgeIndex: number;
  wallThickness: number;
  material: THREE.Material;
}) {
  const geom = useMemo(() => {
    const n = room.outline.length;
    const a = room.outline[edgeIndex];
    const b = room.outline[(edgeIndex + 1) % n];
    const { L } = edgeFrame(a.x, a.z, b.x, b.z);
    const halfLen = L / 2;
    const cuts = polygonWallHoleCutsForSegment(
      -halfLen,
      halfLen,
      halfLen,
      openingsForEdge(room.openings, edgeIndex),
      room.height,
    );
    const extend0 = miterExtension(room.cornerAnglesDeg[edgeIndex] ?? 90, wallThickness);
    const extend1 = miterExtension(room.cornerAnglesDeg[(edgeIndex + 1) % n] ?? 90, wallThickness);
    return createPolygonWallSegmentWithHoles(
      a.x,
      a.z,
      b.x,
      b.z,
      room.height,
      wallThickness,
      cuts,
      { extend0, extend1, epsilon: 0.0015 },
    );
  }, [room, edgeIndex, wallThickness]);

  useEffect(() => () => geom.dispose(), [geom]);

  return <mesh geometry={geom} material={material} castShadow receiveShadow />;
}

/** Thin translucent glass pane sitting in each window hole. */
function WindowPane({ room, opening, wallThickness }: { room: Room3D; opening: Opening3D; wallThickness: number }) {
  const n = room.outline.length;
  const a = room.outline[opening.edgeIndex % n];
  const b = room.outline[(opening.edgeIndex + 1) % n];
  const { tx, tz, ox, oz, L } = edgeFrame(a.x, a.z, b.x, b.z);
  const halfLen = L / 2;
  const along = opening.position * halfLen;
  const mx = (a.x + b.x) / 2 + tx * along + ox * (wallThickness / 2);
  const mz = (a.z + b.z) / 2 + tz * along + oz * (wallThickness / 2);
  const sill = opening.height > 1.5 ? 0 : 0.8;
  const cy = sill + opening.height / 2;
  const rotationY = Math.atan2(-tz, tx);

  return (
    <mesh position={[mx, cy, mz]} rotation={[0, rotationY, 0]}>
      <boxGeometry args={[opening.width * 0.96, opening.height * 0.96, 0.02]} />
      <meshStandardMaterial color={GLASS_COLOR} transparent opacity={0.32} roughness={0.1} metalness={0} />
    </mesh>
  );
}

export function RoomMesh3D({
  room,
  wallThickness,
  selected,
  hideCeiling,
  onSelect,
}: {
  room: Room3D;
  wallThickness: number;
  selected: boolean;
  hideCeiling: boolean;
  onSelect: (roomId: string) => void;
}) {
  const { invalidate } = useThree();
  const floorRef = useRef<THREE.Mesh>(null);

  const shape = useMemo(() => createOutlineShape(room.outline), [room.outline]);

  const floorGeom = useMemo(() => {
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2);
    return g;
  }, [shape]);

  const slabGeom = useMemo(() => {
    const g = new THREE.ExtrudeGeometry(shape, { depth: wallThickness, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    g.translate(0, -wallThickness / 2, 0);
    return g;
  }, [shape, wallThickness]);

  const ceilingGeom = useMemo(() => {
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    g.translate(0, room.height - 0.03, 0);
    return g;
  }, [shape, room.height]);

  useEffect(
    () => () => {
      floorGeom.dispose();
      slabGeom.dispose();
      ceilingGeom.dispose();
    },
    [floorGeom, slabGeom, ceilingGeom],
  );

  const floorMaterial = useMemo(() => {
    const base = new THREE.Color(roomColor(room.type));
    return new THREE.MeshStandardMaterial({
      color: base,
      roughness: 0.92,
      metalness: 0,
      side: THREE.DoubleSide,
      emissive: selected ? new THREE.Color("#3b82f6") : new THREE.Color("#000000"),
      emissiveIntensity: selected ? 0.35 : 0,
    });
  }, [room.type, selected]);
  useEffect(() => () => floorMaterial.dispose(), [floorMaterial]);

  const wallMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: WALL_COLOR, roughness: 0.95, metalness: 0 }),
    [],
  );
  useEffect(() => () => wallMaterial.dispose(), [wallMaterial]);

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onSelect(room.id);
  };
  const handleOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    document.body.style.cursor = "pointer";
    invalidate();
  };
  const handleOut = () => {
    document.body.style.cursor = "";
    invalidate();
  };

  const n = room.outline.length;
  const windows = room.openings.filter((o) => o.type === "window");

  return (
    <group>
      <mesh geometry={slabGeom} receiveShadow name={`slab-${room.id}`}>
        <meshStandardMaterial color={SLAB_COLOR} roughness={0.95} metalness={0} />
      </mesh>
      <mesh
        ref={floorRef}
        geometry={floorGeom}
        material={floorMaterial}
        position={[0, 0.004, 0]}
        receiveShadow
        renderOrder={1}
        name={`floor-${room.id}`}
        onClick={handleClick}
        onPointerOver={handleOver}
        onPointerOut={handleOut}
      />

      {!hideCeiling && (
        <mesh geometry={ceilingGeom} name={`ceiling-${room.id}`} receiveShadow>
          <meshStandardMaterial color="#f4f2ee" roughness={1} metalness={0} side={THREE.DoubleSide} />
        </mesh>
      )}

      {Array.from({ length: n }, (_, i) =>
        room.suppressedWallEdges.includes(i) ? null : (
          <WallSegmentMesh
            key={`w-${i}`}
            room={room}
            edgeIndex={i}
            wallThickness={wallThickness}
            material={wallMaterial}
          />
        ),
      )}

      {windows.map((o) => (
        <WindowPane key={`pane-${o.id}`} room={room} opening={o} wallThickness={wallThickness} />
      ))}
    </group>
  );
}
