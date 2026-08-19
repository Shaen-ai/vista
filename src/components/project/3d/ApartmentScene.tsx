"use client";

import type { Apartment3D } from "@/lib/project/apartment3d";
import { RoomMesh3D } from "./RoomMesh3D";
import { ColumnMesh } from "./ColumnMesh";

export function ApartmentScene({
  apartment,
  selectedRoomId,
  hideCeiling,
  onSelectRoom,
}: {
  apartment: Apartment3D;
  selectedRoomId: string | null;
  hideCeiling: boolean;
  onSelectRoom: (roomId: string) => void;
}) {
  const cx = (apartment.bounds.minX + apartment.bounds.maxX) / 2;
  const cz = (apartment.bounds.minZ + apartment.bounds.maxZ) / 2;
  const span = Math.max(
    apartment.bounds.maxX - apartment.bounds.minX,
    apartment.bounds.maxZ - apartment.bounds.minZ,
    4,
  );

  return (
    <group>
      <hemisphereLight args={[0xfff8f0, 0x4a4844, 0.55]} />
      <ambientLight intensity={0.4} color="#faf8f5" />
      <directionalLight
        position={[cx + span, span * 1.4, cz + span]}
        intensity={1.1}
        color="#fff6ea"
        castShadow
        shadow-mapSize={[2048, 2048]}
      />

      {apartment.rooms.map((room) => (
        <RoomMesh3D
          key={room.id}
          room={room}
          wallThickness={apartment.wallThickness}
          selected={room.id === selectedRoomId}
          hideCeiling={hideCeiling}
          onSelect={onSelectRoom}
        />
      ))}

      {apartment.columns.map((column) => (
        <ColumnMesh key={column.id} column={column} />
      ))}
    </group>
  );
}
