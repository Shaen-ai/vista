"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, X } from "lucide-react";
import { useTranslation } from "@/i18n/VistaLocaleProvider";

type CameraCaptureProps = {
  open: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
  jpegQuality?: number;
};

async function openCameraStream(): Promise<MediaStream> {
  const constraintsList: MediaStreamConstraints[] = [
    {
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    },
    {
      video: {
        facingMode: { ideal: "user" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    },
    {
      video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    },
    { video: true, audio: false },
  ];

  let lastErr: unknown;
  for (const constraints of constraintsList) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("cameraAccessError");
}

export function CameraCapture({ open, onClose, onCapture, jpegQuality = 0.92 }: CameraCaptureProps) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (!open) {
      stopStream();
      setError(null);
      setReady(false);
      return;
    }

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError(t("components.cameraNotSupported"));
      return;
    }

    let cancelled = false;
    setError(null);
    setReady(false);

    (async () => {
      try {
        const stream = await openCameraStream();
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
          if (!cancelled) setReady(true);
        }
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : "";
          setError(msg === "cameraAccessError" ? t("components.cameraAccessError") : t("components.cameraPermissionHint"));
        }
      }
    })();

    return () => {
      cancelled = true;
      stopStream();
    };
  }, [open, stopStream, t]);

  const handleCapture = useCallback(() => {
    const video = videoRef.current;
    if (!video || !ready) return;
    const uw = video.videoWidth;
    const uh = video.videoHeight;
    if (!uw || !uh) return;

    const canvas = document.createElement("canvas");
    canvas.width = uw;
    canvas.height = uh;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, uw, uh);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        stopStream();
        const file = new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" });
        onCapture(file);
        onClose();
      },
      "image/jpeg",
      jpegQuality,
    );
  }, [ready, onCapture, onClose, stopStream, jpegQuality]);

  const handleClose = useCallback(() => {
    stopStream();
    onClose();
  }, [onClose, stopStream]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, handleClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col bg-black"
      style={{
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingRight: "env(safe-area-inset-right, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        paddingLeft: "env(safe-area-inset-left, 0px)",
      }}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2 text-white">
          <Camera size={22} className="text-[var(--primary,#E8772E)]" />
          <span className="font-semibold text-sm">{t("components.cameraTitle")}</span>
        </div>
        <button
          type="button"
          onClick={handleClose}
          className="p-3 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
          aria-label={t("components.closeCamera")}
        >
          <X size={22} />
        </button>
      </div>

      <div className="flex-1 flex flex-col min-h-0 p-4">
        {error ? (
          <div className="flex-1 flex items-center justify-center text-center px-4">
            <p className="text-red-300 text-sm max-w-md">{error}</p>
          </div>
        ) : (
          <video
            ref={videoRef}
            className="flex-1 w-full max-h-[calc(100dvh-200px)] object-contain rounded-xl bg-black"
            playsInline
            muted
            autoPlay
          />
        )}

        <div className="flex gap-3 justify-center pt-4 pb-2">
          <button
            type="button"
            onClick={handleClose}
            className="px-6 py-3 rounded-xl border border-white/30 text-white font-semibold text-sm hover:bg-white/10 transition-colors"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={handleCapture}
            disabled={!ready || !!error}
            className="px-8 py-3 rounded-xl bg-[var(--primary,#E8772E)] text-white font-bold text-sm hover:brightness-110 transition-all disabled:opacity-40 disabled:pointer-events-none"
          >
            {t("components.capture")}
          </button>
        </div>
      </div>
    </div>
  );
}
