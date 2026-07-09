import { VistaMarketingNav } from "@/components/marketing/VistaMarketingNav";
import { VistaMarketingFooter } from "@/components/marketing/VistaMarketingFooter";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="cd-page min-h-screen flex flex-col">
      <VistaMarketingNav />
      <main className="flex-1">{children}</main>
      <VistaMarketingFooter />
    </div>
  );
}
