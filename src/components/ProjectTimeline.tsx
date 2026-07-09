"use client";

import { useCallback, useEffect, useState } from "react";
import { Clock, Image as ImageIcon, MessageSquare, Sparkles, Upload } from "lucide-react";
import { authJsonHeaders } from "@/lib/authApi";
import { useConsumerDesignStore } from "@/app/store";
import type { HydratedMessage, HydratedVersion } from "@/lib/projectHydration";

interface ProjectTimelineProps {
  onSelectVersion?: (version: HydratedVersion) => void;
}

export function ProjectTimeline({ onSelectVersion }: ProjectTimelineProps) {
  const { currentProjectDbId } = useConsumerDesignStore();
  const [messages, setMessages] = useState<HydratedMessage[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!currentProjectDbId) {
      setMessages([]);
      return;
    }
    setLoading(true);
    fetch(`/api/vista/projects/${currentProjectDbId}`, {
      headers: authJsonHeaders(),
    })
      .then((res) => res.json())
      .then((json) => {
        const msgs = (json.data?.messages ?? []).map(mapMsg);
        setMessages(msgs);
      })
      .catch(() => setMessages([]))
      .finally(() => setLoading(false));
  }, [currentProjectDbId]);

  if (!currentProjectDbId) return null;

  if (loading) {
    return (
      <div className="flex flex-col gap-2 p-3 animate-pulse">
        <div className="h-4 bg-[var(--muted)] rounded w-3/4" />
        <div className="h-4 bg-[var(--muted)] rounded w-1/2" />
        <div className="h-4 bg-[var(--muted)] rounded w-2/3" />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="p-3 text-xs text-[var(--muted-foreground)] text-center">
        No history yet
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 overflow-y-auto max-h-[60vh] px-2 py-2">
      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] px-2 mb-2">
        History
      </h4>
      {messages.map((msg) => (
        <TimelineItem
          key={msg.id}
          message={msg}
          onSelectVersion={onSelectVersion}
        />
      ))}
    </div>
  );
}

function TimelineItem({
  message,
  onSelectVersion,
}: {
  message: HydratedMessage;
  onSelectVersion?: (version: HydratedVersion) => void;
}) {
  const formatTime = (dateStr: string | null) => {
    if (!dateStr) return "";
    return new Date(dateStr).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const icon = (() => {
    switch (message.contentType) {
      case "image_upload":
        return <Upload size={12} className="text-blue-500" />;
      case "generation":
        return <Sparkles size={12} className="text-amber-500" />;
      case "action":
        return <Clock size={12} className="text-[var(--muted-foreground)]" />;
      default:
        return <MessageSquare size={12} className="text-[var(--muted-foreground)]" />;
    }
  })();

  const isGeneration = message.contentType === "generation" && message.version;

  return (
    <div className="flex gap-2 px-2 py-1.5 rounded-md hover:bg-[var(--muted)] transition-colors group">
      {/* Timeline dot */}
      <div className="flex flex-col items-center pt-1">
        <div className="w-5 h-5 rounded-full bg-[var(--muted)] flex items-center justify-center shrink-0">
          {icon}
        </div>
        <div className="w-px flex-1 bg-[var(--border)] mt-1 min-h-[8px]" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 pb-2">
        {/* User message */}
        {message.role === "user" && message.text && (
          <p className="text-xs text-[var(--foreground)] line-clamp-2">
            {message.text}
          </p>
        )}

        {/* System message */}
        {message.role === "system" && (
          <p className="text-[11px] text-[var(--muted-foreground)] italic">
            {message.text || "System action"}
          </p>
        )}

        {/* Generation with thumbnail */}
        {isGeneration && message.version && (
          <div
            className="cursor-pointer"
            onClick={() => onSelectVersion?.(message.version!)}
          >
            <div className="flex items-center gap-2">
              <div className="w-12 h-9 rounded overflow-hidden bg-[var(--muted)] shrink-0 border border-[var(--border)]">
                <img
                  src={message.version.fileUrl}
                  alt={`Version ${message.version.versionNumber}`}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-[var(--foreground)]">
                  Version {message.version.versionNumber}
                </p>
                {message.version.feedback && (
                  <p className="text-[10px] text-[var(--muted-foreground)] truncate">
                    {message.version.feedback}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Attachment */}
        {message.attachmentUrl && !isGeneration && (
          <div className="mt-1 w-10 h-8 rounded overflow-hidden bg-[var(--muted)] border border-[var(--border)]">
            <img
              src={message.attachmentUrl}
              alt="Attachment"
              className="w-full h-full object-cover"
              loading="lazy"
            />
          </div>
        )}

        {/* Timestamp */}
        <span className="text-[10px] text-[var(--muted-foreground)] mt-0.5 block">
          {formatTime(message.createdAt)}
        </span>
      </div>
    </div>
  );
}

function mapMsg(m: Record<string, unknown>): HydratedMessage {
  return {
    id: m.id as string,
    role: m.role as "user" | "assistant" | "system",
    contentType: (m.content_type as string) ?? "text",
    text: (m.text as string) ?? null,
    versionId: (m.version_id as string) ?? null,
    attachmentUrl: (m.attachment_url as string) ?? null,
    attachmentMime: (m.attachment_mime as string) ?? null,
    sequence: (m.sequence as number) ?? 0,
    createdAt: (m.created_at as string) ?? null,
    version: m.version ? mapVersion(m.version as Record<string, unknown>) : null,
  };
}

function mapVersion(v: Record<string, unknown>) {
  return {
    id: v.id as string,
    fileUrl: v.file_url as string,
    mimeType: (v.mime_type as string) ?? "image/png",
    versionNumber: (v.version_number as number) ?? 1,
    type: (v.type as string) ?? "generated",
    roomId: (v.room_id as string) ?? null,
    angleIndex: (v.angle_index as number) ?? 0,
    designBrief: (v.design_brief as never) ?? null,
    productsUsed: (v.products_used as never) ?? null,
    promptUsed: (v.prompt_used as string) ?? null,
    feedback: (v.feedback as string) ?? null,
    createdAt: (v.created_at as string) ?? null,
  };
}
