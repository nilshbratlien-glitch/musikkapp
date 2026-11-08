import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Drum, FileText, Music, Piano } from "lucide-react";
import { useEffect, useState } from "react";
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
    setMessage("I Chrome: trykk ⋮ øverst til høyre, deretter Installer app.");
  }

  return { standalone, message, install };
}

export function Shell() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const tool = toolForPath(pathname);
  const install = useInstall();

  useEffect(() => {
    ensureToolNamespaces();
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  }, []);

  const sheet = tool.id === "bladlesing";

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg text-fg">
      <header className="shrink-0 border-b border-line bg-header px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xl leading-tight font-semibold tracking-tight">Musikkapp</p>
            <p className="text-sm text-muted">{tool.label}</p>
          </div>
          {install.standalone ? null : (
            <button
              type="button"
              onClick={() => void install.install()}
              className="metro-press mt-0.5 min-h-10 shrink-0 rounded-lg border border-line px-3 text-sm font-semibold"
            >
              Installer
            </button>
          )}
        </div>
        {install.message ? <p className="mt-2 text-sm text-muted">{install.message}</p> : null}
      </header>
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
