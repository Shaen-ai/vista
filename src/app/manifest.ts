import type { MetadataRoute } from "next";

const VISTA_THEME_COLOR = "#1a1614";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Vista",
    short_name: "Vista",
    description: "Design your room with real furniture from Armenian marketplaces.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: VISTA_THEME_COLOR,
    theme_color: VISTA_THEME_COLOR,
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
