import { VISTA_SITE_URL } from "@/lib/siteUrl";

export interface JsonLdWebApplication {
  "@context": "https://schema.org";
  "@type": "SoftwareApplication";
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
  logo: string;
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
    "@type": "SoftwareApplication",
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
    logo: "https://tunzone.com/logo.png",
    sameAs: ["https://tunzone.com/about"],
  };
}

export function buildBlogPostingJsonLd(post: {
  title: string;
  description: string;
  date: string;
  slug: string;
}): object {
  const url = `${VISTA_SITE_URL}/blog/${post.slug}`;
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    dateModified: post.date,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    url,
    author: buildOrganizationJsonLd(),
    publisher: buildOrganizationJsonLd(),
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
