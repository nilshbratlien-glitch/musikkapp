import { Volume2, VolumeX } from "lucide-react";
import type { BladlesingSettings, DuetViewPart } from "@/lib/bladlesing-config";
import { useSync } from "@/lib/sync/use-sync";

export function BladlesingDuetBar({
  settings,
  duetPaired,
  onSetViewPart,
  onTogglePaired,
  onUpdateSettings,
}: {
  settings: BladlesingSettings;
  duetPaired: boolean;
  onSetViewPart: (part: DuetViewPart) => void;
  onTogglePaired: () => void;
  onUpdateSettings: (patch: Partial<BladlesingSettings>, opts?: { regenerate?: boolean }) => void;
}) {
  const sync = useSync();

  if (!settings.duetEnabled) return null;

  return (
    <div
      id="duetToolbar"
      className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface px-2.5 py-2 shadow-[var(--shadow-card)]"
    >
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Visningsvalg">
        <select
          id="duetViewSelect"
          value={settings.duetViewPart}
          onChange={(e) => onSetViewPart(e.target.value as DuetViewPart)}
          className="sr-only-select"
          aria-label="Duett-visning"
        >
          <option value="score">Partitur</option>
          <option value="trumpet">Trompet (B)</option>
          <option value="mallets">Slagverk (C)</option>
        </select>
        {(
          [
            ["score", "Partitur", "btnDuetViewScore"],
            ["trumpet", "Trompet (B)", "btnDuetViewTrumpet"],
            ["mallets", "Slagverk (C)", "btnDuetViewMallets"],
          ] as const
        ).map(([part, label, id]) => {
          const active = settings.duetViewPart === part;
          return (
            <button
              key={part}
              id={id}
              type="button"
              data-duet-view={part}
              onClick={() => onSetViewPart(part)}
              className={
                active
                  ? "active metro-press min-h-8 rounded-full border border-ok bg-[rgb(var(--color-ok-rgb)/0.15)] px-3 text-xs font-semibold text-ok md:min-h-9 md:text-sm"
                  : "metro-press min-h-8 rounded-full border border-line bg-header px-3 text-xs font-medium text-muted hover:text-fg md:min-h-9 md:text-sm"
              }
            >
              {label}
            </button>
          );
        })}
        {sync.connected ? (
          <button
            id="btnDuetPairView"
            type="button"
            onClick={onTogglePaired}
            title="Speil stemmevisning til tilkoblede skjermer"
            className={
              duetPaired
                ? "active metro-press min-h-8 rounded-full border border-accent bg-[rgb(var(--color-accent-rgb)/0.12)] px-3 text-xs font-semibold text-accent md:min-h-9 md:text-sm"
                : "metro-press min-h-8 rounded-full border border-line bg-header px-3 text-xs font-medium text-muted hover:text-fg md:min-h-9 md:text-sm"
            }
          >
            Speil skjerm
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Slagverkinstrument">
        <select
          id="duetToolbarMalletSelect"
          value={settings.duetMalletInstrument}
          onChange={(e) => onUpdateSettings({ duetMalletInstrument: e.target.value }, { regenerate: true })}
          title="Bytt slagverkinstrument"
          className="min-h-8 rounded-full border border-line bg-header px-2.5 text-xs font-semibold text-fg md:min-h-9 md:text-sm"
        >
          <option value="xylo">Xylofon</option>
          <option value="mar43">Marimba 4.3</option>
          <option value="mar50">Marimba 5.0</option>
          <option value="vibes">Vibrafon</option>
          <option value="glock">Klokkespill</option>
        </select>
        <select
          id="duetToolbarMalletCount"
          value={String(settings.duetMallets)}
          onChange={(e) => onUpdateSettings({ duetMallets: Number(e.target.value) }, { regenerate: true })}
          title="Antall køller for slagverk"
          className="min-h-8 rounded-full border border-line bg-header px-2.5 text-xs font-semibold text-fg md:min-h-9 md:text-sm"
        >
          <option value="2">2 køller</option>
          <option value="3">3 køller</option>
          <option value="4">4 køller</option>
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Makker-lyd">
        <button
          id="btnMuteTrumpet"
          type="button"
          onClick={() => onUpdateSettings({ duetPlayTrumpet: !settings.duetPlayTrumpet })}
          title="Slå av/på trompet-lyd"
          className={
            settings.duetPlayTrumpet
              ? "active metro-press inline-flex min-h-8 items-center gap-1 rounded-full border border-ok bg-[rgb(var(--color-ok-rgb)/0.15)] px-2.5 text-xs font-semibold text-ok md:min-h-9 md:text-sm"
              : "muted metro-press inline-flex min-h-8 items-center gap-1 rounded-full border border-line bg-header px-2.5 text-xs font-medium text-muted line-through opacity-60 md:min-h-9 md:text-sm"
          }
        >
          {settings.duetPlayTrumpet ? <Volume2 className="size-3.5" aria-hidden="true" /> : <VolumeX className="size-3.5" aria-hidden="true" />}
          <span>Trompet</span>
        </button>
        <button
          id="btnMuteMallets"
          type="button"
          onClick={() => onUpdateSettings({ duetPlayMallets: !settings.duetPlayMallets })}
          title="Slå av/på slagverk-lyd"
          className={
            settings.duetPlayMallets
              ? "active metro-press inline-flex min-h-8 items-center gap-1 rounded-full border border-ok bg-[rgb(var(--color-ok-rgb)/0.15)] px-2.5 text-xs font-semibold text-ok md:min-h-9 md:text-sm"
              : "muted metro-press inline-flex min-h-8 items-center gap-1 rounded-full border border-line bg-header px-2.5 text-xs font-medium text-muted line-through opacity-60 md:min-h-9 md:text-sm"
          }
        >
          {settings.duetPlayMallets ? <Volume2 className="size-3.5" aria-hidden="true" /> : <VolumeX className="size-3.5" aria-hidden="true" />}
          <span>Slagverk</span>
        </button>
      </div>
    </div>
  );
}
