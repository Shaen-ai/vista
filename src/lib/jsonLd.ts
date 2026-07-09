import { VISTA_SITE_URL } from "@/lib/siteUrl";

export interface JsonLdWebApplication {
  "@context": "https://schema.org";
  "@type": "WebApplication";
  name: string;
  url: string;
  description: string;
  applicationCategory: string;
  operatingSystem: string;
  offers: {
    "@type": "Offer";
    price: string;
    priceCurrency: string;
    description: string;
  };
  creator: JsonLdOrganization;
}

export interface JsonLdOrganization {
  "@type": "Organization";
  name: string;
  url: string;
  sameAs: string[];
}

export interface JsonLdFaqPage {
  "@context": "https://schema.org";
  "@type": "FAQPage";
  mainEntity: Array<{
    "@type": "Question";
    name: string;
    acceptedAnswer: {
      "@type": "Answer";
      text: string;
    };
  }>;
}

export function buildWebApplicationJsonLd(): JsonLdWebApplication {
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "Vista",
    url: VISTA_SITE_URL,
    description:
      "AI interior design app. Upload a room photo, get photorealistic redesigns with real furniture from local stores.",
    applicationCategory: "DesignApplication",
    operatingSystem: "Web",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      description: "Free signup with bonus tokens. Pay-per-design with token top-ups.",
    },
    creator: buildOrganizationJsonLd(),
  };
}

export function buildOrganizationJsonLd(): JsonLdOrganization {
  return {
    "@type": "Organization",
    name: "Tunzone",
    url: "https://tunzone.com",
    sameAs: ["https://tunzone.com/about"],
  };
}

export function buildFaqJsonLd(
  questions: Array<{ question: string; answer: string }>,
): JsonLdFaqPage {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: questions.map((q) => ({
      "@type": "Question",
      name: q.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: q.answer,
      },
    })),
  };
}
