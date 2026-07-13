"use client";

import { useCallback, useEffect, useState } from "react";
import { Folder, Plus, Trash2, Pencil, Clock, Layers, Home, Loader2, Share2 } from "lucide-react";
import { useConsumerDesignStore, type SavedProjectSummary } from "@/app/store";
import { useProjectPersistence } from "@/hooks/useProjectPersistence";
import { authJsonHeaders } from "@/lib/authApi";
import { LANDING_MODE_IMAGES } from "@/lib/landingModeAssets";
import { useTranslation } from "@/i18n/VistaLocaleProvider";
import { ShareProjectModal } from "@/components/ShareProjectModal";

type OrchestratorPreviewPayload = {
  previewUrl: string;
  render?: { base64: string; mimeType: string; roomId: string; angleIndex: number };
  floorPlan?: { base64: string; mime: string };
};

function previewFromPreviewEndpoint(p: {
  roomId: string;
  base64: string;
  mimeType: string;
}): OrchestratorPreviewPayload {
  const mimeType = p.mimeType ?? "image/png";
  return {
    previewUrl: `data:${mimeType};base64,${p.base64}`,
    render: {
      base64: p.base64,
      mimeType,
      roomId: p.roomId,
      angleIndex: 0,
    },
  };
}

async function persistOrchestratorPreview(
  vistaProjectId: string,
  preview: OrchestratorPreviewPayload,
  versionCount: number,
  options?: { repairMissing?: boolean },
): Promise<boolean> {
  if (preview.render && (versionCount === 0 || options?.repairMissing)) {
    const res = await fetch(`/api/vista/projects/${vistaProjectId}/versions`, {
      method: "POST",
      headers: authJsonHeaders(),
      body: JSON.stringify({
        base64: preview.render.base64,
        mime_type: preview.render.mimeType,
        room_id: preview.render.roomId,
        angle_index: preview.render.angleIndex,
        repair_missing: options?.repairMissing ?? false,
      }),
    });
    return res.ok;
  }

  if (preview.floorPlan) {
    const res = await fetch(`/api/vista/projects/${vistaProjectId}`, {
      method: "PATCH",
      headers: authJsonHeaders(),
      body: JSON.stringify({
        floor_plan_base64: preview.floorPlan.base64,
        floor_plan_mime: preview.floorPlan.mime,
      }),
    });
    return res.ok;
  }

  return false;
}

type FilterMode = "all" | "quick_room" | "project";

// Module-level so remounts (hub loading swaps, navigation) can't re-trigger the
// heavy base64 preview fetch for the same project within a session.
const backfillAttempted = new Set<string>();
const repairAttempted = new Set<string>();

interface MyProjectsProps {
  onSelectProject: (projectId: string) => void;
  onNewDesign: () => void;
  openingProjectId?: string | null;
  modeFilter?: "quick_room" | "project";
  showModeBadge?: boolean;
  titleKey?: string;
  reloadMode?: "quick_room" | "project";
  editorialLayout?: boolean;
  hubMode?: "quick_room" | "project";
}

export function MyProjects({
  onSelectProject,
  onNewDesign,
  openingProjectId = null,
  modeFilter,
  showModeBadge = true,
  titleKey,
  reloadMode,
  editorialLayout = false,
  hubMode,
}: MyProjectsProps) {
  const { t } = useTranslation();
  const { savedProjects, savedProjectsLoading } = useConsumerDesignStore();
  const { loadProjects, renameProject, deleteProject } = useProjectPersistence();
  const [filter, setFilter] = useState<FilterMode>(modeFilter ?? "all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [shareProjectId, setShareProjectId] = useState<string | null>(null);
  const [lazyPreviews, setLazyPreviews] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!reloadMode) {
      void loadProjects();
      return;
    }
    // Hub parent (ModeProjectHub) already loads by mode; avoid duplicate fetch flicker.
    if (!editorialLayout) {
      void loadProjects({ mode: reloadMode });
    }
  }, [loadProjects, reloadMode, editorialLayout]);

  const effectiveFilter = modeFilter ?? filter;
  const modeFiltered =
    effectiveFilter === "all"
      ? savedProjects
      : savedProjects.filter((p) => p.mode === effectiveFilter);
  const filtered = modeFiltered;

  useEffect(() => {
    const needsBackfill = filtered.filter(
      (p) => p.mode === "project" && !p.coverImageUrl && p.orchestratorProjectId,
    );
    for (const project of needsBackfill) {
      if (backfillAttempted.has(project.id)) continue;
      backfillAttempted.add(project.id);
      const orchId = project.orchestratorProjectId!;
      void (async () => {
        try {
          const res = await fetch(`/api/project/${orchId}?preview=1`, { cache: "no-store" });
          if (!res.ok) return;
          const json = await res.json();
          const p = json.data?.preview as
            | { roomId: string; base64: string; mimeType: string }
            | null
            | undefined;
          if (!p?.base64) return;
          const preview = previewFromPreviewEndpoint(p);
          setLazyPreviews((prev) => ({ ...prev, [project.id]: preview.previewUrl }));
          const ok = await persistOrchestratorPreview(project.id, preview, project.versionCount);
          if (ok) {
            if (reloadMode) void loadProjects({ mode: reloadMode });
            else void loadProjects();
          }
        } catch {
          /* ignore */
        }
      })();
    }
  }, [filtered, loadProjects, reloadMode]);

  const fetchOrchestratorPreview = useCallback(
    async (project: SavedProjectSummary, repairMissing: boolean): Promise<void> => {
      const orchId = project.orchestratorProjectId;
      if (!orchId) return;

      try {
        const res = await fetch(`/api/project/${orchId}?preview=1`, { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        const p = json.data?.preview as
          | { roomId: string; base64: string; mimeType: string }
          | null
          | undefined;
        if (!p?.base64) return;
        const preview = previewFromPreviewEndpoint(p);
        setLazyPreviews((prev) => ({ ...prev, [project.id]: preview.previewUrl }));
        const ok = await persistOrchestratorPreview(
          project.id,
          preview,
          project.versionCount,
          { repairMissing },
        );
        if (ok) {
          if (reloadMode) void loadProjects({ mode: reloadMode });
          else void loadProjects();
        }
      } catch {
        /* ignore */
      }
    },
    [loadProjects, reloadMode],
  );

  const handlePreviewImageError = useCallback(
    (project: SavedProjectSummary) => {
      if (project.mode !== "project" || !project.orchestratorProjectId) return;
      if (repairAttempted.has(project.id)) return;
      repairAttempted.add(project.id);
      void fetchOrchestratorPreview(project, true);
    },
    [fetchOrchestratorPreview],
  );

  const listTitle = titleKey ? t(titleKey) : (t("myProjects.title") ?? "My Designs");
  const emptyThumbSrc =
    hubMode === "quick_room" ? LANDING_MODE_IMAGES.quick : LANDING_MODE_IMAGES.project;

  const handleRename = useCallback(
    async (project: SavedProjectSummary) => {
      if (!editTitle.trim() || editTitle.trim() === project.title) {
        setEditingId(null);
        return;
      }
      try {
        const ok = await renameProject(project.id, editTitle.trim());
        if (ok) {
          if (reloadMode) void loadProjects({ mode: reloadMode });
          else void loadProjects();
        }
      } catch {
        /* ignore */
      }
      setEditingId(null);
    },
    [editTitle, loadProjects, reloadMode, renameProject],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        const ok = await deleteProject(id);
        if (ok) {
          if (reloadMode) void loadProjects({ mode: reloadMode });
          else void loadProjects();
        }
      } catch {
        /* ignore */
      }
      setDeletingId(null);
    },
    [deleteProject, loadProjects, reloadMode],
  );

  const formatRelativeTime = (dateStr: string | null): string => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return t("myProjects.justNow") ?? "Just now";
    if (diffMin < 60) return t("myProjects.minutesAgo", { count: diffMin });
    const diffHrs = Math.floor(diffMin / 60);
    if (diffHrs < 24) return t("myProjects.hoursAgo", { count: diffHrs });
    const diffDays = Math.floor(diffHrs / 24);
    if (diffDays < 7) return t("myProjects.daysAgo", { count: diffDays });
    return date.toLocaleDateString();
  };

  const renderProjectCard = (project: SavedProjectSummary, editorial: boolean) => {
    const previewSrc = project.coverImageUrl ?? lazyPreviews[project.id] ?? null;
    const isOpening = openingProjectId === project.id;
    const cardClass = editorial
      ? `cd-hub-card${isOpening ? " opacity-70 pointer-events-none" : ""}`
      : `group relative rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden hover:shadow-lg transition-shadow cursor-pointer${isOpening ? " opacity-70 pointer-events-none" : ""}`;
    const photoClass = editorial ? "cd-hub-card-photo" : "aspect-[4/3] bg-[var(--muted)] relative overflow-hidden";
    const bodyClass = editorial ? "cd-hub-card-body" : "p-3";
    const actionsClass = editorial
      ? "cd-hub-card-actions"
      : "absolute top-2 right-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex gap-1";
    const actionBtnClass = editorial
      ? "cd-hub-card-action-btn"
      : "min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full bg-[var(--background)]/80 backdrop-blur-sm hover:bg-[var(--background)] transition-colors";
    const deleteBtnClass = editorial
      ? "cd-hub-card-action-btn cd-hub-card-action-btn--danger"
      : `${actionBtnClass} hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600`;

    return (
      <div
        key={project.id}
        className={cardClass}
        onClick={() => {
          if (editingId !== project.id && deletingId !== project.id) {
            onSelectProject(project.id);
          }
        }}
      >
        <div className={photoClass}>
          {isOpening ? (
            <div className={editorial ? "cd-hub-card-photo-placeholder" : "w-full h-full flex items-center justify-center"}>
              <Loader2 size={editorial ? 28 : 32} className="animate-spin text-[var(--primary)]" aria-hidden />
            </div>
          ) : previewSrc ? (
            <img
              src={previewSrc}
              alt={project.title}
              onError={() => {
                if (previewSrc.startsWith("http") || previewSrc.startsWith("/vista-files")) {
                  handlePreviewImageError(project);
                }
              }}
            />
          ) : (
            <div className={editorial ? "cd-hub-card-photo-placeholder" : "w-full h-full flex items-center justify-center"}>
              <Home size={editorial ? 28 : 32} className="text-[var(--muted-foreground)] opacity-40" />
            </div>
          )}

          {showModeBadge && !editorial && (
            <div className="absolute top-2 left-2">
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold backdrop-blur-sm ${
                  project.mode === "quick_room"
                    ? "bg-blue-500/20 text-blue-700 dark:text-blue-300"
                    : "bg-purple-500/20 text-purple-700 dark:text-purple-300"
                }`}
              >
                {project.mode === "quick_room" ? "Quick" : "Project"}
              </span>
            </div>
          )}

          <div className={actionsClass}>
            {project.mode === "quick_room" && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShareProjectId(project.id);
                }}
                className={actionBtnClass}
                title={t("share.title")}
              >
                <Share2 size={14} />
              </button>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setEditingId(project.id);
                setEditTitle(project.title);
              }}
              className={actionBtnClass}
              title="Rename"
            >
              <Pencil size={14} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setDeletingId(project.id);
              }}
              className={deleteBtnClass}
              title="Delete"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        <div className={bodyClass}>
          {editingId === project.id ? (
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onBlur={() => handleRename(project)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename(project);
                if (e.key === "Escape") setEditingId(null);
              }}
              onClick={(e) => e.stopPropagation()}
              autoFocus
              className={
                editorial
                  ? "cd-hub-card-title-input"
                  : "w-full text-sm font-medium bg-transparent border-b border-[var(--primary)] outline-none text-[var(--foreground)] pb-0.5"
              }
            />
          ) : editorial ? (
            <h3 className="cd-hub-card-title">{project.title}</h3>
          ) : (
            <h3 className="text-sm font-medium text-[var(--foreground)] truncate">{project.title}</h3>
          )}
          <div className={editorial ? "cd-hub-card-meta" : "flex items-center gap-3 mt-1.5 text-xs text-[var(--muted-foreground)]"}>
            {project.versionCount === 0 && !previewSrc && (
              <span>{t("myProjects.draft")}</span>
            )}
            <span>
              <Layers size={11} aria-hidden />
              {project.versionCount}{" "}
              {project.versionCount === 1 ? t("myProjects.version") : t("myProjects.versions")}
            </span>
            <span>
              <Clock size={11} aria-hidden />
              {formatRelativeTime(project.lastInteractionAt)}
            </span>
          </div>
        </div>

        {deletingId === project.id &&
          (editorial ? (
            <div className="cd-hub-card-delete-overlay" onClick={(e) => e.stopPropagation()}>
              <p>Delete this design?</p>
              <div className="cd-hub-card-delete-actions">
                <button
                  type="button"
                  onClick={() => setDeletingId(null)}
                  className="px-3 py-1.5 text-xs rounded-md border border-[var(--border)] hover:bg-[var(--muted)]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(project.id)}
                  className="px-3 py-1.5 text-xs rounded-md bg-red-600 text-white hover:bg-red-700"
                >
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <div
              className="absolute inset-0 bg-[var(--background)]/90 backdrop-blur-sm flex flex-col items-center justify-center gap-3 p-4"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-sm text-[var(--foreground)] text-center font-medium">
                Delete this design?
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setDeletingId(null)}
                  className="px-3 py-1.5 text-xs rounded-md border border-[var(--border)] hover:bg-[var(--muted)]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(project.id)}
                  className="px-3 py-1.5 text-xs rounded-md bg-red-600 text-white hover:bg-red-700"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
      </div>
    );
  };

  if (savedProjectsLoading && savedProjects.length === 0) {
    return (
      <div className={editorialLayout ? "cd-hub-section" : "w-full max-w-5xl mx-auto px-4"}>
        <div className="flex items-center justify-center py-12">
          <div className="animate-pulse text-sm text-[var(--muted-foreground)]">
            {t("modeHub.loading")}
          </div>
        </div>
      </div>
    );
  }

  if (editorialLayout) {
    return (
      <>
      <div className="cd-hub-section">
        <div className="cd-hub-toolbar">
          {filtered.length > 0 ? (
            <span className="cd-hub-toolbar-count">
              {filtered.length}{" "}
              {filtered.length === 1 ? t("myProjects.design") : t("myProjects.designs")}
            </span>
          ) : (
            <span className="cd-hub-toolbar-count" />
          )}
          {savedProjects.length > 0 && (
            <button type="button" onClick={onNewDesign} className="cd-hub-new-btn">
              <Plus size={16} className="cd-surface-btn__icon" aria-hidden />
              {t("myProjects.newDesign") ?? "New Design"}
            </button>
          )}
        </div>

        {!modeFilter && savedProjects.length > 0 && (
          <div className="cd-hub-filter">
            {(
              [
                ["all", t("myProjects.all") ?? "All"],
                ["quick_room", t("myProjects.quickRoom") ?? "Quick Room"],
                ["project", t("myProjects.project") ?? "Project"],
              ] as [FilterMode, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`cd-hub-filter-btn${filter === key ? " cd-hub-filter-btn--active" : ""}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {filtered.length === 0 && !savedProjectsLoading && (
          <div className="cd-hub-empty">
            {hubMode && (
              <div className="cd-hub-empty-thumb">
                <img src={emptyThumbSrc} alt="" loading="lazy" />
              </div>
            )}
            <p className="cd-hub-empty-text">
              {t("myProjects.empty") ?? "No designs yet. Start creating!"}
            </p>
            <button type="button" onClick={onNewDesign} className="cd-hub-empty-cta">
              <Plus size={16} className="cd-surface-btn__icon" aria-hidden />
              {t("myProjects.createFirst") ?? "Create your first design"}
            </button>
          </div>
        )}

        {filtered.length > 0 && (
          <div className="cd-hub-cards">
            {filtered.map((project) => renderProjectCard(project, true))}
          </div>
        )}
      </div>
      {shareProjectId && (
        <ShareProjectModal
          projectId={shareProjectId}
          open
          onClose={() => setShareProjectId(null)}
        />
      )}
      </>
    );
  }

  return (
    <>
    <div className="w-full max-w-5xl mx-auto px-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div className="flex items-center gap-3 min-w-0">
          <Folder size={20} className="text-[var(--primary)] shrink-0" />
          <h2 className="text-lg font-semibold text-[var(--foreground)] truncate">
            {listTitle}
            {filtered.length > 0 && (
              <span className="ml-2 text-sm font-normal text-[var(--muted-foreground)]">
                ({filtered.length})
              </span>
            )}
          </h2>
        </div>
        {savedProjects.length > 0 && (
          <button
            type="button"
            onClick={onNewDesign}
            className="flex items-center justify-center gap-1.5 rounded-full bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity shrink-0 self-start sm:self-auto"
          >
            <Plus size={16} />
            {t("myProjects.newDesign") ?? "New Design"}
          </button>
        )}
      </div>

      {!modeFilter && savedProjects.length > 0 && (
        <div
          className="flex gap-1 mb-5 p-1 bg-[var(--muted)] rounded-lg overflow-x-auto max-w-full"
          style={{ scrollbarWidth: "none" }}
        >
          {(
            [
              ["all", t("myProjects.all") ?? "All"],
              ["quick_room", t("myProjects.quickRoom") ?? "Quick Room"],
              ["project", t("myProjects.project") ?? "Project"],
            ] as [FilterMode, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`shrink-0 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                filter === key
                  ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 && !savedProjectsLoading && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-full bg-[var(--muted)] flex items-center justify-center mb-4">
            <Layers size={28} className="text-[var(--muted-foreground)]" />
          </div>
          <p className="text-sm text-[var(--muted-foreground)] mb-4">
            {t("myProjects.empty") ?? "No designs yet. Start creating!"}
          </p>
          <button
            type="button"
            onClick={onNewDesign}
            className="flex items-center gap-1.5 rounded-full border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
          >
            <Plus size={16} />
            {t("myProjects.createFirst") ?? "Create your first design"}
          </button>
        </div>
      )}

      {filtered.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((project) => renderProjectCard(project, false))}
        </div>
      )}
    </div>
    {shareProjectId && (
      <ShareProjectModal
        projectId={shareProjectId}
        open
        onClose={() => setShareProjectId(null)}
      />
    )}
    </>
  );
}
