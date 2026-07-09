import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Vista — Interior Design";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          background: "linear-gradient(135deg, #1a1614 0%, #2a1f18 46%, #d4622a 100%)",
          color: "#f2eee7",
          fontFamily: "Inter, Arial, sans-serif",
          padding: 72,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 24,
          }}
        >
          <div
            style={{
              fontSize: 72,
              fontWeight: 700,
              fontStyle: "italic",
              letterSpacing: "-0.02em",
            }}
          >
            Vista
          </div>
          <div
            style={{
              fontSize: 32,
              opacity: 0.85,
              textAlign: "center",
              maxWidth: 800,
            }}
          >
            Interior Design
          </div>
          <div
            style={{
              fontSize: 20,
              opacity: 0.6,
              marginTop: 16,
            }}
          >
            vista.tunzone.com
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
