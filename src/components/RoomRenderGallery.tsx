"use client";

import { Check, X } from "lucide-react";

export function RoomRenderGalleryGrid({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`grid grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3 ${className}`.trim()}>
      {children}
    </div>
  );
}

export function RoomRenderGalleryCard({
  src,
  alt,
  onOpen,
  onRemove,
  canRemove = false,
  removeLabel = "Remove",
  isActive = false,
  activeLabel,
  onSetActive,
  setActiveLabel,
  viewLabel,
  notConfirmed,
  notConfirmedLabel,
  disabled = false,
  borderClassName = "border-[var(--border)]",
  overlay,
  aspectClassName = "aspect-[4/3]",
}: {
  src: string;
  alt: string;
  onOpen: () => void;
  onRemove?: () => void;
  canRemove?: boolean;
  removeLabel?: string;
  isActive?: boolean;
  activeLabel?: string;
  onSetActive?: () => void;
  setActiveLabel?: string;
  viewLabel?: string;
  notConfirmed?: boolean;
  notConfirmedLabel?: string;
  disabled?: boolean;
  borderClassName?: string;
  overlay?: React.ReactNode;
  aspectClassName?: string;
}) {
  return (
    <div className={`relative group ${aspectClassName}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={onOpen}
        className={`absolute inset-0 w-full h-full rounded-xl overflow-hidden border-2 ${borderClassName} cursor-pointer hover:shadow-lg transition-shadow disabled:opacity-50 disabled:pointer-events-none`}
      >
        <img src={src} alt={alt} className="w-full h-full object-cover" />
        {viewLabel != null && (
          <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--primary)] text-white z-[1]">
            {viewLabel}
          </span>
        )}
        {notConfirmed && notConfirmedLabel && (
          <span
            className={`absolute top-2 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500 text-white z-[1] ${
              canRemove ? "right-10" : "right-2"
            }`}
          >
            {notConfirmedLabel}
          </span>
        )}
        {isActive && activeLabel && (
          <span className="absolute bottom-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-600 text-white z-[1] flex items-center gap-0.5">
            <Check size={10} aria-hidden />
            {activeLabel}
          </span>
        )}
        {overlay}
      </button>
      {canRemove && onRemove && (
        <button
          type="button"
          aria-label={removeLabel}
          title={removeLabel}
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="absolute top-2 right-2 z-[2] p-1.5 min-h-[28px] min-w-[28px] flex items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 focus:opacity-100 disabled:opacity-50"
        >
          <X size={14} />
        </button>
      )}
      {onSetActive && !isActive && setActiveLabel && (
        <button
          type="button"
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            onSetActive();
          }}
          className="absolute bottom-2 right-2 z-[2] px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--foreground)]/80 text-[var(--background)] hover:bg-[var(--foreground)] transition-colors disabled:opacity-50"
        >
          {setActiveLabel}
        </button>
      )}
    </div>
  );
}

export function RoomRenderGalleryPendingCard({
  viewLabel,
  children,
  onClick,
}: {
  viewLabel: string;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  const interactive = !!onClick;
  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      className={`aspect-[4/3] rounded-xl border-2 border-dashed border-[var(--border)] bg-[var(--muted)]/30 p-4 flex items-center justify-center relative ${
        interactive ? "cursor-pointer hover:border-[var(--primary)] hover:bg-[var(--muted)]/50 transition-colors" : ""
      }`}
    >
      <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--muted)] text-[var(--muted-foreground)]">
        {viewLabel}
      </span>
      {children}
    </div>
  );
}
