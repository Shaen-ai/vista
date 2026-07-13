import type { Metadata } from "next";
import { getServerLaravelOrigin } from "@/lib/publicEnv";
import { VISTA_SITE_URL } from "@/lib/siteUrl";
import { SharePageClient, type ShareProjectData } from "./SharePageClient";

type Props = {
  params: Promise<{ token: string }>;
};

async function fetchShareData(token: string): Promise<ShareProjectData | null> {
  try {
    const origin = getServerLaravelOrigin();
    const res = await fetch(`${origin}/api/public/vista/share/${encodeURIComponent(token)}`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: ShareProjectData };
    return json.data ?? null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const data = await fetchShareData(token);

  if (!data) {
    return {
      title: "Vista — Shared design",
      robots: { index: false, follow: false },
    };
  }

  const title = data.title || "Shared design";
  const latestVersion = data.versions.length ? data.versions[data.versions.length - 1] : null;
  const imagePath = latestVersion?.image_url ?? data.room_image_url ?? null;
  const ogImage = imagePath ? `${VISTA_SITE_URL}${imagePath}` : undefined;

  return {
    title: `${title} — Vista`,
    description: "View this room design shared on Vista",
    openGraph: {
      title: `${title} — Vista`,
      description: "View this room design shared on Vista",
      type: "website",
      url: `${VISTA_SITE_URL}/share/${token}`,
      images: ogImage ? [{ url: ogImage, width: 1200, height: 630, alt: title }] : undefined,
    },
    twitter: {
      card: ogImage ? "summary_large_image" : "summary",
      title: `${title} — Vista`,
      description: "View this room design shared on Vista",
      images: ogImage ? [ogImage] : undefined,
    },
    robots: { index: false, follow: false },
  };
}

export default async function SharePage({ params }: Props) {
  const { token } = await params;
  const data = await fetchShareData(token);
  return <SharePageClient initialData={data} />;
}
