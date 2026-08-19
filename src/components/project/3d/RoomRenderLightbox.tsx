"use client";

import { useState } from "react";
import type { MarketplaceMatch, RenderResult, RoomResult } from "@/lib/project/types";

function renderSrc(r: RenderResult): string {
  return `data:${r.mimeType || "image/jpeg"};base64,${r.base64}`;
}

function heroIndex(room: RoomResult): number {
  if (room.primaryPhotoId && room.photoRenderMap?.[room.primaryPhotoId] != null) {
    return room.photoRenderMap[room.primaryPhotoId];
  }
  return 0;
}

function ProductCard({ product }: { product: MarketplaceMatch }) {
  return (
    <a
      href={product.url}
      target="_blank"
      rel="noreferrer noopener"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        width: 132,
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <div
        style={{
          width: 132,
          height: 132,
          borderRadius: 10,
          overflow: "hidden",
          background: "#e8e6e2",
        }}
      >
        {product.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.imageUrl}
            alt={product.name}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        )}
      </div>
      <span style={{ fontSize: 12, lineHeight: 1.3, maxHeight: 32, overflow: "hidden" }}>{product.name}</span>
      <span style={{ fontSize: 12, fontWeight: 600 }}>
        {product.price.toLocaleString()} {product.currency}
      </span>
    </a>
  );
}

export function RoomRenderLightbox({
  roomName,
  room,
  onClose,
}: {
  roomName: string;
  room: RoomResult | null;
  onClose: () => void;
}) {
  const renders = room?.renders ?? [];
  const [active, setActive] = useState(room ? heroIndex(room) : 0);
  const activeRender = renders[active] ?? renders[0] ?? null;
  const products = room?.usedScrapedProducts ?? [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 20,
        background: "rgba(15,15,15,0.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 16,
          maxWidth: 920,
          width: "100%",
          maxHeight: "100%",
          overflowY: "auto",
          padding: 20,
          boxShadow: "0 24px 60px rgba(0,0,0,0.3)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h2 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>{roomName}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ fontSize: 22, lineHeight: 1, border: "none", background: "transparent", cursor: "pointer" }}
          >
            ×
          </button>
        </div>

        {activeRender ? (
          <>
            <div style={{ width: "100%", borderRadius: 12, overflow: "hidden", background: "#f0eee9" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={renderSrc(activeRender)}
                alt={activeRender.angleDescription || roomName}
                style={{ width: "100%", display: "block" }}
              />
            </div>
            {renders.length > 1 && (
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                {renders.map((r, i) => (
                  <button
                    key={`${r.angleIndex}-${i}`}
                    type="button"
                    onClick={() => setActive(i)}
                    style={{
                      width: 88,
                      height: 60,
                      borderRadius: 8,
                      overflow: "hidden",
                      border: i === active ? "2px solid #3b82f6" : "2px solid transparent",
                      padding: 0,
                      cursor: "pointer",
                      background: "#e8e6e2",
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={renderSrc(r)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <p style={{ color: "#666" }}>This room hasn&apos;t been rendered yet.</p>
        )}

        {products.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>Products in this room</h3>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              {products.map((p) => (
                <ProductCard key={p.marketplaceId} product={p} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
