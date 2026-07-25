import Image from "next/image";
import { getTunzoneLandingHref } from "@/lib/siteUrl";

type TunzoneLogoLinkProps = {
  className?: string;
  priority?: boolean;
};

export function TunzoneLogoLink({ className, priority = false }: TunzoneLogoLinkProps) {
  return (
    <a
      href={getTunzoneLandingHref()}
      aria-label="Tunzone"
      className={className ? `flex shrink-0 items-center ${className}` : "flex shrink-0 items-center"}
    >
      <Image
        src="/logo.png"
        alt="Tunzone logo"
        width={48}
        height={48}
        priority={priority}
        unoptimized
        className="max-h-12 w-auto h-auto rounded-xl object-contain"
      />
    </a>
  );
}
