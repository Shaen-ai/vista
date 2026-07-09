"use client";

import { Mail, MessageCircle, X } from "lucide-react";
import { useTranslation } from "@/i18n/VistaLocaleProvider";
import { getContactSupportEmail } from "@/lib/publicEnv";
import { track } from "@/lib/analytics";

interface SupportContactModalProps {
  open: boolean;
  onClose: () => void;
}

export function SupportContactModal({ open, onClose }: SupportContactModalProps) {
  const { t } = useTranslation();
  if (!open) return null;

  const supportEmail = getContactSupportEmail();
  const whatsappRaw = (process.env.NEXT_PUBLIC_CONTACT_WHATSAPP || "").replace(/[^\d]/g, "");
  const mailSubject = encodeURIComponent(t("supportModal.emailSubject"));
  const mailBody = encodeURIComponent(t("supportModal.emailBody"));
  const whatsappMessage = encodeURIComponent(t("supportModal.whatsappMessage"));

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center backdrop-blur-sm bg-black/40"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="relative w-full max-w-md mx-4 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="support-modal-title"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
          aria-label={t("common.close")}
        >
          <X size={18} />
        </button>

        <h3 id="support-modal-title" className="text-base font-bold mb-2 pr-8">
          {t("supportModal.title")}
        </h3>
        <p className="text-sm text-[var(--muted-foreground)] mb-5 leading-relaxed">
          {t("supportModal.description")}
        </p>

        <div className="flex flex-col gap-3">
          {whatsappRaw ? (
            <a
              href={`https://wa.me/${whatsappRaw}?text=${whatsappMessage}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => track("support_contact_clicked", { channel: "whatsapp" })}
              className="flex items-center justify-center gap-2 w-full py-3 rounded-xl font-bold bg-[var(--primary)] text-white hover:brightness-110 transition-all"
            >
              <MessageCircle size={18} />
              {t("supportModal.contactWhatsApp")}
            </a>
          ) : null}
          <a
            href={`mailto:${supportEmail}?subject=${mailSubject}&body=${mailBody}`}
            onClick={() => track("support_contact_clicked", { channel: "email" })}
            className={`flex items-center justify-center gap-2 w-full py-3 rounded-xl font-bold transition-all ${
              whatsappRaw
                ? "border border-[var(--border)] bg-[var(--muted)] text-[var(--foreground)] hover:bg-[var(--border)]"
                : "bg-[var(--primary)] text-white hover:brightness-110"
            }`}
          >
            <Mail size={18} />
            {t("supportModal.contactEmail")}
          </a>
          <button
            type="button"
            onClick={onClose}
            className="w-full py-3 rounded-xl font-medium text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
          >
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
