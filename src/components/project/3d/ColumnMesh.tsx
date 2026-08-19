"use client";

import type { Column3D } from "@/lib/project/apartment3d";

export function ColumnMesh({ column }: { column: Column3D }) {
  return (
    <mesh position={[column.x, column.height / 2, column.z]} castShadow receiveShadow>
      <boxGeometry args={[column.width, column.height, column.depth]} />
      <meshStandardMaterial color="#c4bdb2" roughness={0.95} metalness={0} />
    </mesh>
  );
}
