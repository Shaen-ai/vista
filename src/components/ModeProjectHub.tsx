"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { MyProjects } from "@/components/MyProjects";
import { VistaHeaderActions } from "@/components/VistaHeaderActions";
import { useConsumerDesignStore } from "@/app/store";
import { useProjectPersistence } from "@/hooks/useProjectPersistence";
import { getAuthToken } from "@/lib/authApi";
import { openSavedProject, workspacePathForMode } from "@/lib/openSavedProject";
import { fetchTokenBalance, grantAnonymousTokens } from "@/lib/vistaTokens";
import { LowBalancePrompt } from "@/components/LowBalancePrompt";
import { useTranslation } from "@/i18n/VistaLocaleProvider";
import { useVistaUiTheme } from "@/app/VistaThemeProvider";

type HubMode = "quick_room" | "project";

interface ModeProjectHubProps {
  mode: HubMode;
  createPath: string;
  hubPath: string;
}

function HubHero({ mode }: { mode: HubMode }) {
  const { t } = useTranslation();
  const badgeKey =
    mode === "quick_room" ? "landing.quickCardBadge" : "landing.projectCardBadge";
  const titleKey = mode === "quick_room" ? "modeHub.quickTitle" : "modeHub.projectTitle";
  const subtitleKey =
    mode === "quick_room" ? "modeHub.quickSubtitle" : "modeHub.projectSubtitle";

  return (
    <div className="cd-hub-hero">
      <div className="cd-step-label">
        <span className="cd-step-label-line" />
        <span className="cd-step-label-text">{t(badgeKey)}</span>
        <span className="cd-step-label-line" />
      </div>
      <h1 className="cd-landing-headline">{t(titleKey)}</h1>
      <p className="cd-step-subtitle">{t(subtitleKey)}</p>
    </div>
  );
}

export function ModeProjectHub({ mode, createPath, hubPath }: ModeProjectHubProps) {
  const router = useRouter();
  const { t } = useTranslation();
  const [uiTheme, setUiTheme] = useVistaUiTheme();
  const { savedProjectsLoading, tokenBalance, setTokenBalance } = useConsumerDesignStore();
  const { loadProjects } = useProjectPersistence();
  const [ready, setReady] = useState(false);
  const [checked, setChecked] = useState(false);
  const [openingProjectId, setOpeningProjectId] = useState<string | null>(null);

  useEffect(() => {
    grantAnonymousTokens()
      .then((data) => setTokenBalance(data.balance))
      .catch(() =>
        fetchTokenBalance()
          .then((data) => setTokenBalance(data.balance))
          .catch(() => {}),
      );
  }, [setTokenBalance]);

  useEffect(() => {
    if (!getAuthToken()) {
      router.replace(createPath);
      return;
    }
    let cancelled = false;
    void loadProjects({ mode }).finally(() => {
      if (!cancelled) setChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [mode, createPath, loadProjects, router]);

  // Latch: once the hub is ready, stay ready. Background reloads (rename,
  // delete, cover backfill) must refresh the list in place — flipping back to
  // the full-page loader unmounts MyProjects and can cascade into a reload loop.
  if (!ready && checked && !savedProjectsLoading) {
    setReady(true);
  }

  const handleNewDesign = useCallback(() => {
    useConsumerDesignStore.getState().setCurrentProjectDbId(null);
    if (mode === "project") {
      useConsumerDesignStore.getState().resetProject();
    }
    router.push(createPath);
  }, [mode, createPath, router]);

  const handleSelectProject = useCallback(
    async (projectId: string) => {
      setOpeningProjectId(projectId);
      try {
        const ok = await openSavedProject(projectId, mode);
        if (ok) {
          router.push(workspacePathForMode(mode));
        }
      } finally {
        setOpeningProjectId(null);
      }
    },
    [mode, router],
  );

  const pageClass = `cd-page${uiTheme === "light" ? " cd-page--light" : ""} flex flex-col min-h-screen`;

  if (!ready) {
    return (
      <div className={pageClass}>
        <header className="cd-editorial-header">
          <Link href="/" className="cd-back-link">
            <ArrowLeft size={14} aria-hidden />
            <span>{t("common.back")}</span>
          </Link>
          <VistaHeaderActions
            tokenBalance={tokenBalance}
            onBalanceChange={setTokenBalance}
            uiTheme={uiTheme}
            onThemeChange={setUiTheme}
            hubPath={hubPath}
          />
        </header>
        <main className="cd-hub flex-1">
          <div className="cd-hub-inner cd-landing-animate">
            <HubHero mode={mode} />
            <div className="flex flex-1 items-center justify-center gap-3 py-8 w-full">
              <Loader2 size={28} className="animate-spin text-[var(--primary)]" aria-hidden />
              <p className="text-sm text-[var(--muted-foreground)]">{t("modeHub.loading")}</p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className={pageClass}>
      <header className="cd-editorial-header">
        <Link href="/" className="cd-back-link">
          <ArrowLeft size={14} aria-hidden />
          <span>{t("common.back")}</span>
        </Link>
        <VistaHeaderActions
          tokenBalance={tokenBalance}
          onBalanceChange={setTokenBalance}
          uiTheme={uiTheme}
          onThemeChange={setUiTheme}
          hubPath={hubPath}
        />
      </header>
      <main className="cd-hub flex-1">
        <div className="cd-hub-inner cd-landing-animate">
          <HubHero mode={mode} />
          <div className="cd-hub-section">
            <MyProjects
              modeFilter={mode}
              showModeBadge={false}
              editorialLayout
              hubMode={mode}
              openingProjectId={openingProjectId}
              onSelectProject={handleSelectProject}
              onNewDesign={handleNewDesign}
              reloadMode={mode}
            />
          </div>
        </div>
      </main>
      <LowBalancePrompt />
    </div>
  );
}
