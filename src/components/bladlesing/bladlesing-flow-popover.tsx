import { EyeOff, FastForward, Timer, X } from "lucide-react";
import type { BladlesingSettings } from "@/lib/bladlesing-config";

export function BladlesingFlowPopover({
  open,
  settings,
  onUpdate,
  onClose,
}: {
  open: boolean;
  settings: BladlesingSettings;
  onUpdate: (patch: Partial<BladlesingSettings>) => void;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Bladlesingsflyt"
      className="absolute top-full right-0 z-40 mt-2 w-72 rounded-2xl border border-line bg-[rgb(var(--color-chrome-rgb)/0.98)] p-3.5 text-fg shadow-xl backdrop-blur-md sm:w-80"
    >
        <div className="mb-2.5 flex items-center justify-between">
          <div>
            <p className="text-xs font-bold tracking-wider text-accent uppercase">Bladlesingsflyt</p>
            <p className="text-[11px] text-muted">Håndfri øving på notestativet</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Lukk bladlesingsflyt"
            className="metro-press flex size-8 items-center justify-center rounded-lg text-muted hover:bg-header hover:text-fg"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-2">
          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3 py-2.5">
            <span className="flex items-start gap-2.5">
              <Timer className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
              <span>
                <span className="block text-xs font-semibold text-fg">1 takt opptelling</span>
                <span className="block text-[11px] text-muted">Teller inn før takt 1 starter</span>
              </span>
            </span>
            <input
              type="checkbox"
              checked={settings.flowCountIn}
              onChange={(e) => onUpdate({ flowCountIn: e.target.checked })}
              className="size-4 shrink-0 accent-[var(--color-accent)]"
            />
          </label>

          <div className="rounded-xl border border-line bg-surface px-3 py-2.5">
            <label className="flex cursor-pointer items-center justify-between gap-3">
              <span className="flex items-start gap-2.5">
                <FastForward className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
                <span>
                  <span className="block text-xs font-semibold text-fg">Automatisk neste etyde</span>
                  <span className="block text-[11px] text-muted">Lager og spiller ny når etyden slutter</span>
                </span>
              </span>
              <input
                type="checkbox"
                checked={settings.flowAutoNext}
                onChange={(e) => onUpdate({ flowAutoNext: e.target.checked })}
                className="size-4 shrink-0 accent-[var(--color-accent)]"
              />
            </label>
            {settings.flowAutoNext ? (
              <div className="mt-2.5 flex items-center justify-between border-t border-line pt-2">
                <span className="text-[11px] font-medium text-muted">Pause mellom etyder</span>
                <div className="flex gap-1">
                  {[2, 3, 5].map((sec) => (
                    <button
                      key={sec}
                      type="button"
                      onClick={() => onUpdate({ flowAutoNextDelay: sec })}
                      className={
                        settings.flowAutoNextDelay === sec
                          ? "rounded-md bg-accent px-2 py-0.5 text-[11px] font-bold text-accent-fg"
                          : "rounded-md border border-line bg-header px-2 py-0.5 text-[11px] font-medium text-muted hover:text-fg"
                      }
                    >
                      {sec}s
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3 py-2.5">
            <span className="flex items-start gap-2.5">
              <EyeOff className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
              <span>
                <span className="block text-xs font-semibold text-fg">Les forover</span>
                <span className="block text-[11px] text-muted">Toner ned takten du spiller for å trene blikket</span>
              </span>
            </span>
            <input
              type="checkbox"
              checked={settings.flowDisappearing}
              onChange={(e) => onUpdate({ flowDisappearing: e.target.checked })}
              className="size-4 shrink-0 accent-[var(--color-accent)]"
            />
          </label>
      </div>
    </div>
  );
}
