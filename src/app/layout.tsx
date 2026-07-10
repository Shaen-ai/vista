import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { cookies } from "next/headers";
import "./globals.css";
import "./design.css";
import { VistaThemeProvider } from "./VistaThemeProvider";
import { themeFromRequestCookie, VISTA_UI_THEME_COOKIE } from "@/lib/vistaUiTheme";
import { VistaLocaleProvider } from "@/i18n/VistaLocaleProvider";
import {
  buildVistaLocaleBootScript,
  localeFromRequestCookie,
  VISTA_LOCALE_COOKIE,
} from "@/i18n/vistaLocale";
import { translate } from "@/i18n/translate";
import { VISTA_SITE_URL } from "@/lib/siteUrl";
import { localeFromRequest } from "@/lib/localeFromRequest";
import { JsonLdScript } from "@/components/marketing/JsonLdScript";
import { buildWebApplicationJsonLd } from "@/lib/jsonLd";
import { PostHogProvider } from "@/components/PostHogProvider";
import { GoogleAnalytics } from "@/components/GoogleAnalytics";
import { CountryBootstrap } from "@/components/CountryBootstrap";
import { PwaRegister } from "@/components/PwaRegister";
import { PwaInstallProvider } from "@/components/PwaInstallProvider";

const VISTA_THEME_COLOR = "#1a1614";

const GOOGLE_FONTS_URL =
  "https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,300..600;1,300..600&family=Inter+Tight:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Noto+Serif+Armenian:wght@300;400;500;600;700&family=Noto+Sans+Armenian:wght@400;500;600;700&display=swap";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await localeFromRequest();
  const title = translate(locale, "meta.title");
  const description = translate(locale, "meta.description");
  return {
    metadataBase: new URL(VISTA_SITE_URL),
    title,
    description,
    icons: { icon: "/favicon.png", shortcut: "/favicon.png", apple: "/favicon.png" },
    appleWebApp: {
      capable: true,
      title: "Vista",
      statusBarStyle: "black-translucent",
    },
    robots: { index: true, follow: true },
    alternates: { canonical: "/" },
    openGraph: {
      type: "website",
      url: "/",
      siteName: "Vista",
      title,
      description,
      images: [
        {
          url: "/landing/landing-quick-room.jpg",
          width: 1536,
          height: 1024,
          alt: "Vista — Interior Design",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/landing/landing-quick-room.jpg"],
    },
  };
}

export function generateViewport(): Viewport {
  return {
    themeColor: VISTA_THEME_COLOR,
  };
}

const VISTA_THEME_BOOT_SCRIPT = `(function(){try{var k='vista-ui-theme';var c='${VISTA_UI_THEME_COOKIE}';var t=localStorage.getItem(k);if(t!=='light'&&t!=='dark'){var h=new Date().getHours();t=h>=7&&h<19?'light':'dark'}document.documentElement.dataset.vistaTheme=t;document.documentElement.style.colorScheme=t==='light'?'light':'dark';document.cookie=c+'='+t+';path=/;max-age=31536000;SameSite=Lax';}catch(e){}})();`;

const VISTA_LOCALE_BOOT_SCRIPT = buildVistaLocaleBootScript();

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const ssrTheme = themeFromRequestCookie(cookieStore.get(VISTA_UI_THEME_COOKIE)?.value);
  const ssrLocale = localeFromRequestCookie(cookieStore.get(VISTA_LOCALE_COOKIE)?.value);

  return (
    <html lang={ssrLocale} suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href={GOOGLE_FONTS_URL} rel="stylesheet" />
      </head>
      <body className="antialiased" suppressHydrationWarning>
        <JsonLdScript data={buildWebApplicationJsonLd()} />
        <GoogleAnalytics />
        <Script id="vista-locale-boot" strategy="beforeInteractive">
          {VISTA_LOCALE_BOOT_SCRIPT}
        </Script>
        <Script id="vista-theme-boot" strategy="beforeInteractive">
          {VISTA_THEME_BOOT_SCRIPT}
        </Script>
        <PostHogProvider>
          <PwaInstallProvider>
            <VistaLocaleProvider initialLocale={ssrLocale}>
              <VistaThemeProvider initialTheme={ssrTheme}>
                <PwaRegister />
                <CountryBootstrap />
                {children}
              </VistaThemeProvider>
            </VistaLocaleProvider>
          </PwaInstallProvider>
        </PostHogProvider>
      </body>
    </html>
  );
}
