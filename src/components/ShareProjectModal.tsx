"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Loader2, X } from "lucide-react";
import { InviteShareButtons } from "@/components/inviteShare";
import { useProjectPersistence, type ShareStatus } from "@/hooks/useProjectPersistence";
import { useTranslation } from "@/i18n/VistaLocaleProvider";

type ShareProjectModalProps = {
  projectId: string;
  open: boolean;
  onClose: () => void;
};

export function ShareProjectModal({ projectId, open, onClose }: ShareProjectModalProps) {
  const { t } = useTranslation();
  const { getShareStatus, enableShare } = useProjectPersistence();
  const [status, setStatus] = useState<ShareStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pasteTip, setPasteTip] = useState(false);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(false);
    const result = await getShareStatus(projectId);
    if (!result) {
      setError(true);
      setStatus(null);
      setLoading(false);
      return;
    }

    if (!result.enabled || !result.share_url) {
      const enabled = await enableShare(projectId);
      if (!enabled?.share_url) {
        setError(true);
        setStatus(null);
        setLoading(false);
        return;
      }
      setStatus(enabled);
    } else {
      setStatus(result);
    }
    setLoading(false);
  }, [enableShare, getShareStatus, projectId]);

  useEffect(() => {
    if (!open) return;
    void loadStatus();
  }, [open, loadStatus]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  async function handleCopy() {
    if (!status?.share_url) return;
    try {
      await navigator.clipboard.writeText(status.share_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  }

  function handleCopyThenOpen() {
    setPasteTip(true);
    setTimeout(() => setPasteTip(false), 2000);
  }

  if (!open) return null;

  const shareUrl = status?.share_url ?? "";
  const shareMessage = shareUrl ? t("share.shareMessage", { url: shareUrl }) : "";

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-modal-title"
    >
      <div
        className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5 sm:px-6 sm:pt-6">
          <h2 id="share-modal-title" className="text-lg font-bold text-[var(--foreground)]">
            {t("share.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
            aria-label={t("common.close")}
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-8 w-8 animate-spin text-[var(--primary)]" aria-hidden />
          </div>
        ) : error ? (
          <p className="px-5 pb-5 text-sm text-[var(--muted-foreground)] sm:px-6 sm:pb-6">{t("share.error")}</p>
        ) : shareUrl ? (
          <div className="mt-2 pb-2">
            <div className="flex items-center gap-2 px-5 py-2 sm:px-6">
              <span className="min-w-0 flex-1 truncate font-mono text-xs sm:text-sm">{shareUrl}</span>
            </div>
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="flex w-full cursor-pointer items-center gap-2 px-5 py-2 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--muted)] sm:px-6"
            >
              {copied ? <Check size={16} className="shrink-0" aria-hidden /> : <Copy size={16} className="shrink-0" aria-hidden />}
              {copied ? t("common.copied") : t("share.copyLink")}
            </button>
            <InviteShareButtons
              url={shareUrl}
              message={shareMessage}
              layout="inline"
              t={t}
              onCopyThenOpen={handleCopyThenOpen}
            />
            {pasteTip && (
              <p className="px-5 pb-1 text-xs text-[var(--muted-foreground)] sm:px-6">{t("referral.pasteInChat")}</p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
