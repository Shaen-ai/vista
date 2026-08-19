"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { floorPlanTo3D } from "@/lib/project/apartment3d";
import type { FloorPlanAnalysis, RoomResult } from "@/lib/project/types";
import type { ViewMode } from "./ApartmentCanvas";
import { RoomRenderLightbox } from "./RoomRenderLightbox";

// R3F cannot render on the server — load the Canvas client-side only.
const ApartmentCanvas = dynamic(() => import("./ApartmentCanvas"), {
  ssr: false,
  loading: () => (
    <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", color: "#888" }}>
      Loading 3D view…
    </div>
  ),
});

export function Apartment3DViewer({
  analysis,
  rooms,
  height = 560,
}: {
  analysis: FloorPlanAnalysis;
  rooms: RoomResult[];
  height?: number | string;
}) {
  const apartment = useMemo(() => floorPlanTo3D(analysis), [analysis]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("dollhouse");

  const roomResultById = useMemo(() => {
    const map = new Map<string, RoomResult>();
    for (const r of rooms) map.set(r.roomId, r);
    return map;
  }, [rooms]);

  const selectedName = useMemo(() => {
    if (!selectedRoomId) return "";
    return analysis.rooms.find((r) => r.id === selectedRoomId)?.name ?? "Room";
  }, [selectedRoomId, analysis.rooms]);

  const hasGeometry = apartment.rooms.length > 0;

  return (
    <div style={{ position: "relative", width: "100%", height, borderRadius: 12, overflow: "hidden", background: "#f2f0ec" }}>
      {hasGeometry ? (
        <>
          <div style={{ position: "absolute", top: 12, right: 12, zIndex: 4, display: "flex", gap: 6 }}>
            {(["dollhouse", "top"] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                style={{
                  padding: "6px 12px",
                  borderRadius: 8,
                  fontSize: 13,
                  cursor: "pointer",
                  border: "1px solid rgba(0,0,0,0.12)",
                  background: viewMode === mode ? "#111" : "#fff",
                  color: viewMode === mode ? "#fff" : "#111",
                }}
              >
                {mode === "dollhouse" ? "3D" : "Top"}
              </button>
            ))}
          </div>

          <ApartmentCanvas
            apartment={apartment}
            viewMode={viewMode}
            selectedRoomId={selectedRoomId}
            onSelectRoom={setSelectedRoomId}
            onDeselect={() => setSelectedRoomId(null)}
          />

          {selectedRoomId && (
            <RoomRenderLightbox
              roomName={selectedName}
              room={roomResultById.get(selectedRoomId) ?? null}
              onClose={() => setSelectedRoomId(null)}
            />
          )}
        </>
      ) : (
        <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", color: "#888" }}>
          No floor-plan geometry to display in 3D yet.
        </div>
      )}
    </div>
  );
}
