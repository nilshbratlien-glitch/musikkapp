import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Drum, FileText, Music, Piano } from "lucide-react";
import { useEffect } from "react";
import { TOOLS, ensureToolNamespaces, toolForPath, type ToolId } from "@/lib/tools";

const ICONS: Record<ToolId, typeof Music> = {
  bladlesing: Music,
  metronom: Drum,
  oveplan: Piano,
  notekort: FileText,
};

export function Shell() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const tool = toolForPath(pathname);

  useEffect(() => {
    ensureToolNamespaces();
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  const sheet = tool.id === "bladlesing";

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg text-fg">
      <header className="shrink-0 border-b border-line bg-header px-4 py-3">
        <p className="text-xl leading-tight font-semibold tracking-tight">Musikkapp</p>
        <p className="text-sm text-muted">{tool.label}</p>
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
