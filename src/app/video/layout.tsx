import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Vista — Your room, redesigned",
  description: "AI interior design for your home",
};

export default function VideoLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style>{`
        html, body { margin: 0; padding: 0; background: #0a0a0a; overflow: hidden; width: 100%; height: 100%; }
      `}</style>
      {children}
    </>
  );
}
