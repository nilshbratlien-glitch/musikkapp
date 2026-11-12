import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { Drum, FileText, Music, Pause, Piano, Play, Wifi } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { SyncModal } from "@/components/sync-modal";
import { blockName, blockStyle, fmtClock, type BlockId } from "@/lib/oveplan";
import {
  bindPlanNavigate,
  ensurePlanClock,
  getPlanClock,
  getPlanClockVersion,
  startPlanMetro,
  subscribePlanClock,
  togglePlanClock,
} from "@/lib/plan-clock";
import {
  PROFILE_META,
  getProfile,
  getProfileVersion,
  hasChosenProfile,
  setProfile,
  subscribeProfile,
  type InstrumentProfile,
} from "@/lib/profile";
import { unlock } from "@/lib/pulse";
import { initSyncBridge, registerSyncNavigator } from "@/lib/sync/bridge";
import { autoReconnectIfConfigured, getSyncState } from "@/lib/sync/room";
import { useSync } from "@/lib/sync/use-sync";
import { TOOLS, ensureToolNamespaces, toolForPath, type ToolId } from "@/lib/tools";

const ICONS: Record<ToolId, typeof Music> = {
  bladlesing: Music,
  metronom: Drum,
  oveplan: Piano,
  notekort: FileText,
};

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function useInstall() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const ios = "standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    if (ios || window.matchMedia("(display-mode: standalone)").matches) setStandalone(true);
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  async function install() {
    if (prompt) {
      await prompt.prompt();
      setPrompt(null);
      return;
    }
    const ua = navigator.userAgent;
    if (window.top !== window.self) {
      setMessage("Forhåndsvisningen kan ikke installeres. Publiser, og åpne den lenken i Chrome.");
      return;
    }
    const android = /Android/i.test(ua);
    const chrome = /Chrome\/\d+/.test(ua) && !/;\s*wv\)|SamsungBrowser|EdgA|OPR/.test(ua);
    if (android && !chrome) {
      const bare = location.href.replace(/^https?:\/\//, "");
      location.href = `intent://${bare}#Intent;scheme=https;package=com.android.chrome;end`;
      return;
    }
    if (/iPhone|iPad/.test(ua)) {
      setMessage("I Safari: trykk Del, deretter Legg til på Hjem-skjerm.");
      return;
    }
    setMessage("Velg Opprett snarvei i menyen. Chrome kan ikke installere siden, fordi den ligger bak innlogging.");
  }

  return { standalone, message, install };
}

function PlanHeaderTimer() {
  useSyncExternalStore(subscribePlanClock, getPlanClockVersion, getPlanClockVersion);
  useSyncExternalStore(subscribeProfile, getProfileVersion, getProfileVersion);
  const clock = getPlanClock();
  if (!clock.activeId) return null;
  const paused = clock.blockPaused || clock.timer == null;
  const name = blockName(clock.activeId);
  const Icon = paused ? Play : Pause;
  return (
    <button
      type="button"
      onClick={togglePlanClock}
      aria-label={`${paused ? "Fortsett" : "Pause"} ${name}, ${fmtClock(clock.blockLeft)} igjen`}
      aria-pressed={paused}
      style={blockStyle(clock.activeId as BlockId)}
      className={
        paused
          ? "metro-press flex min-h-10 max-w-40 items-center gap-1.5 rounded-lg border border-line px-2 text-sm font-semibold text-muted"
          : "metro-press flex min-h-10 max-w-40 items-center gap-1.5 rounded-lg border border-[var(--block)] bg-[rgb(var(--block-rgb)/0.1)] px-2 text-sm font-semibold text-[var(--block)]"
      }
    >
      <Icon className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
      <span className="min-w-0 truncate">{name}</span>
      <span className="shrink-0 tabular-nums">{fmtClock(clock.blockLeft)}</span>
    </button>
  );
}

function InstrumentModal({
  open,
  active,
  onSelect,
  onClose,
}: {
  open: boolean;
  active: InstrumentProfile;
  onSelect: (profile: InstrumentProfile) => void;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="instrument-modal-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1 text-center">
            <p className="text-xs font-semibold tracking-wider text-accent uppercase">Velg instrumentprofil</p>
            <h2 id="instrument-modal-title" className="mt-1 text-xl font-bold tracking-tight text-fg">
              Hva skal du øve på i dag?
            </h2>
            <p className="mt-1 text-sm text-muted">
              Hver profil har sin egen øveplan, notekort og bladlesing.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Lukk"
            className="metro-press -mr-2 -mt-2 flex size-8 shrink-0 items-center justify-center rounded-lg text-muted hover:text-fg"
          >
            ✕
          </button>
        </div>

        <div className="grid gap-3">
          {(["mallets", "trumpet"] as const).map((id) => {
            const meta = PROFILE_META[id];
            const selected = active === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onSelect(id)}
                className={
                  selected
                    ? "metro-press flex items-start gap-3.5 rounded-xl border-2 border-accent bg-accent/10 p-4 text-left transition"
                    : "metro-press flex items-start gap-3.5 rounded-xl border border-line bg-header p-4 text-left transition hover:border-accent/60"
                }
              >
                <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-surface text-2xl shadow-xs">
                  {meta.emoji}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-lg font-bold text-fg">{meta.label}</span>
                    {selected ? (
                      <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-bg">
                        Aktiv
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs font-medium text-accent">{meta.subtitle}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">{meta.description}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function Shell() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const tool = toolForPath(pathname);
  const install = useInstall();
  const navigate = useNavigate();
  const sync = useSync();
  useSyncExternalStore(subscribeProfile, getProfileVersion, getProfileVersion);
  const profile = getProfile();
  const profileMeta = PROFILE_META[profile];
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);

  useEffect(() => {
    bindPlanNavigate((to) => {
      const state = getSyncState();
      if (state.connected && state.role === "controller") return;
      if (window.location.pathname !== to) void navigate({ to });
    });
    registerSyncNavigator((to) => {
      if (window.location.pathname !== to) void navigate({ to });
    });
    initSyncBridge();
    autoReconnectIfConfigured();
  }, [navigate]);

  useEffect(() => {
    const onGesture = () => {
      const state = getSyncState();
      if (state.connected && !state.audioActive) return;
      unlock();
      const clock = getPlanClock();
      if (clock.metroHeld && clock.activeId && !clock.blockPaused && clock.timer != null) {
        clock.metroHeld = false;
        startPlanMetro(false);
      }
    };
    window.addEventListener("pointerdown", onGesture, { passive: true });
    window.addEventListener("keydown", onGesture, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
  }, []);

  useEffect(() => {
    ensureToolNamespaces();
    ensurePlanClock();
    if (!hasChosenProfile()) {
      setProfileModalOpen(true);
    }
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  }, []);

  function chooseProfile(next: InstrumentProfile) {
    unlock();
    setProfile(next);
    ensureToolNamespaces();
    setProfileModalOpen(false);
  }

  const sheet = tool.id === "bladlesing";

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg text-fg">
      <header className="shrink-0 border-b border-line bg-header px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xl leading-tight font-semibold tracking-tight">Musikkapp</p>
            <p className="truncate text-sm text-muted">
              {tool.label} · {profileMeta.label}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <PlanHeaderTimer />
            <button
              type="button"
              onClick={() => {
                unlock();
                setProfileModalOpen(true);
              }}
              aria-label={`Bytt instrument (nå: ${profileMeta.label})`}
              title={`Aktiv profil: ${profileMeta.label} — trykk for å bytte mellom Køller og Trompet`}
              className="metro-press flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-xs font-semibold text-fg hover:border-accent/60"
            >
              <span aria-hidden="true" className="text-base leading-none">{profileMeta.emoji}</span>
              <span>{profileMeta.label}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                unlock();
                setSyncModalOpen(true);
              }}
              aria-label="Skjerm-synkronisering"
              title={sync.connected ? `Tilkoblet rom ${sync.roomCode} (${sync.role === "controller" ? "Fjernkontroll" : "Skjerm"})` : "Synkroniser skjermer"}
              className={
                sync.connected
                  ? "metro-press flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg border border-ok/40 bg-ok/10 px-2.5 text-xs font-semibold text-ok"
                  : "metro-press flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs font-medium text-muted hover:text-fg"
              }
            >
              <Wifi className={sync.connected ? "size-3.5 text-ok" : "size-3.5 text-muted"} />
              <span className="hidden sm:inline">
                {sync.connected ? `${sync.roomCode} · ${sync.role === "controller" ? "Kontroll" : "Skjerm"}` : "Synk"}
              </span>
            </button>
            {install.standalone ? null : (
              <button
                type="button"
                onClick={() => void install.install()}
                className="metro-press min-h-10 shrink-0 rounded-lg border border-line px-3 text-sm font-semibold"
              >
                Installer
              </button>
            )}
          </div>
        </div>
        {install.message ? <p className="mt-2 text-sm text-muted">{install.message}</p> : null}
      </header>
      <InstrumentModal
        open={profileModalOpen}
        active={profile}
        onSelect={chooseProfile}
        onClose={() => {
          if (!hasChosenProfile()) chooseProfile(profile);
          else setProfileModalOpen(false);
        }}
      />
      <SyncModal open={syncModalOpen} onClose={() => setSyncModalOpen(false)} />
      <main
        className={
          sheet
            ? "min-h-0 flex-1 overflow-hidden"
            : "min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 pt-4"
        }
      >
        <div className={sheet ? "h-full min-h-0" : "mx-auto w-full max-w-xl"}>
          <Outlet />
        </div>
      </main>
      <nav
        aria-label="Verktøy"
        className="shrink-0 border-t border-line bg-header pb-[env(safe-area-inset-bottom)]"
      >
        <ul className="grid grid-cols-4">
          {TOOLS.map((item) => {
            const Icon = ICONS[item.id];
            const active = item.to === pathname;
            return (
              <li key={item.id}>
                <Link
                  to={item.to}
                  aria-current={active ? "page" : undefined}
                  className="flex min-h-16 flex-col items-center justify-center gap-1 px-1"
                >
                  <Icon
                    className={active ? "size-6 text-accent" : "size-6 text-muted"}
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                  <span
                    className={
                      active
                        ? "text-xs font-semibold text-accent"
                        : "text-xs font-medium text-muted"
                    }
                  >
                    {item.label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
