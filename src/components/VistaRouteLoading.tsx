import { Loader2 } from "lucide-react";

export default function VistaRouteLoading() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4">
      <Loader2 size={40} className="animate-spin text-[var(--primary)]" aria-hidden />
    </div>
  );
}
