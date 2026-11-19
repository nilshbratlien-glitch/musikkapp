import { ArrowLeft, Check, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import {
  LEVELS,
  RHYTHM_PRESETS,
  sameIds,
  type BladlesingSettings,
  type DuetStyle,
} from "@/lib/bladlesing-config";
import type { BladlesingEngine } from "@/lib/bladlesing-engine";
import type { InstrumentProfile } from "@/lib/profile";

type PanelId = "instrument" | "rytme" | "register" | "toneart" | "duett" | "mer";

const MALLET_INSTRUMENTS: ReadonlyArray<readonly [string, string, string]> = [
  ["glock", "Klokkespill", "Klokkesp."],
  ["xylo", "Xylofon", "Xylofon"],
  ["vibes", "Vibrafon", "Vibrafon"],
  ["mar43", "Marimba 4.3", "Mar 4.3"],
  ["mar50", "Marimba 5.0", "Mar 5.0"],
];

const CLEF_OPTIONS: ReadonlyArray<readonly [string, string, string]> = [
  ["auto", "Auto", "Auto"],
  ["treble", "G-nøkkel", "G-nøkkel"],
  ["bass", "F-nøkkel", "F-nøkkel"],
  ["grand", "Pianosystem", "Piano"],
];

const TIME_OPTIONS = ["4/4", "3/4", "2/4", "6/8", "2/2", "3/8", "5/8", "7/8", "random"] as const;
const MEASURE_OPTIONS = [4, 8, 12, 16] as const;

const LEAP_OPTIONS: ReadonlyArray<readonly [number, string, string]> = [
  [2, "Sekund", "2. Sek"],
  [3, "Ters", "3. Ters"],
  [4, "Kvart", "4. Kvart"],
  [5, "Kvint", "5. Kvint"],
  [6, "Sekst", "6. Sekst"],
  [8, "Oktav", "8. Oktav"],
];

const ROLL_OPTIONS: ReadonlyArray<readonly [string, string]> = [
  ["off", "Ingen"],
  ["long", "Lange toner"],
  ["often", "Ofte"],
];

const ANNOTATE_OPTIONS: ReadonlyArray<readonly [string, string]> = [
  ["off", "Av"],
  ["names", "Tonenavn"],
  ["solfege", "Solfege"],
];

const DUET_STYLE_OPTIONS: ReadonlyArray<readonly [DuetStyle, string]> = [
  ["harmony", "Harmoni"],
  ["call_response", "Ekkolek"],
  ["melody_comp", "Melodi + komp"],
];

const STOP_INTERVALS: ReadonlyArray<readonly [string, string]> = [
  ["2", "2."],
  ["3", "3."],
  ["4", "4."],
  ["5", "5."],
  ["6", "6."],
  ["7", "7."],
  ["8", "8."],
];

function textureOptionsForMallets(mallets: number): ReadonlyArray<readonly [string, string, string]> {
  if (mallets === 2) {
    return [
      ["mixed", "Melodi med akkorder", "Melodi + akk"],
      ["melody", "Bare én linje", "Kun melodi"],
      ["doublestops", "Mest akkorder", "Mest akk"],
    ];
  }
  if (mallets === 3) {
    return [
      ["mixed", "Melodi med akkorder", "Melodi + akk"],
      ["melody", "Bare én linje", "Kun melodi"],
      ["block", "Bare treklanger", "Treklanger"],
    ];
  }
  return [
    ["mixed", "Melodi med akkorder", "Melodi + akk"],
    ["melody", "Bare én linje", "Kun melodi"],
    ["block", "Blokkakkorder", "Blokkakk."],
    ["chorale", "Koral", "Koral"],
  ];
}

function midiLabel(engine: BladlesingEngine | null, midi: number): string {
  if (!engine) return String(midi);
  return engine.Theory.midiToName(midi, false).toUpperCase().replace("#", "♯") + engine.Theory.midiOctave(midi);
}

function SegPills({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<readonly [string, string]>;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map(([val, label]) => {
        const active = value === val;
        return (
          <button
            key={val}
            type="button"
            onClick={() => onChange(val)}
            className={
              active
                ? "metro-press min-h-8 flex-1 rounded-lg border border-accent bg-accent/12 px-2 py-1 text-center text-xs leading-tight font-semibold text-accent"
                : "metro-press min-h-8 flex-1 rounded-lg border border-line bg-header px-2 py-1 text-center text-xs leading-tight font-medium text-muted hover:text-fg"
            }
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function PillSwitch({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      htmlFor={id}
      className="flex min-h-9 cursor-pointer items-center justify-between gap-2 rounded-lg border border-line bg-header px-2.5 py-1.5 transition hover:border-accent/40"
    >
      <span className="text-xs leading-tight font-medium text-fg">{label}</span>
      <span className="relative inline-flex shrink-0 items-center">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span className="h-5 w-9 rounded-full border border-line bg-bg transition-colors peer-checked:border-accent peer-checked:bg-accent" />
        <span className="pointer-events-none absolute left-0.5 size-4 rounded-full bg-muted transition-transform peer-checked:translate-x-4 peer-checked:bg-accent-fg" />
      </span>
    </label>
  );
}

function DualRange({
  min,
  max,
  low,
  high,
  lowId,
  highId,
  lowLabel,
  highLabel,
  onChangeLow,
  onChangeHigh,
}: {
  min: number;
  max: number;
  low: number;
  high: number;
  lowId?: string;
  highId?: string;
  lowLabel: string;
  highLabel: string;
  onChangeLow: (val: number) => void;
  onChangeHigh: (val: number) => void;
}) {
  const span = Math.max(1, max - min);
  const leftPct = Math.max(0, Math.min(100, ((low - min) / span) * 100));
  const rightPct = Math.max(0, Math.min(100, ((high - min) / span) * 100));

  return (
    <div className="relative flex h-7 items-center">
      <div className="pointer-events-none absolute inset-x-0 h-1.5 overflow-hidden rounded-full bg-line">
        <div
          className="absolute inset-y-0 rounded-full bg-accent/60"
          style={{ left: `${leftPct}%`, width: `${Math.max(3, rightPct - leftPct)}%` }}
        />
      </div>
      <input
        id={lowId}
        type="range"
        min={min}
        max={max}
        value={low}
        aria-label={lowLabel}
        onChange={(e) => onChangeLow(Math.min(Number(e.target.value), high))}
        className="dual-range-input pointer-events-none absolute inset-x-0 m-0 w-full appearance-none bg-transparent accent-[var(--color-accent)]"
      />
      <input
        id={highId}
        type="range"
        min={min}
        max={max}
        value={high}
        aria-label={highLabel}
        onChange={(e) => onChangeHigh(Math.max(Number(e.target.value), low))}
        className="dual-range-input pointer-events-none absolute inset-x-0 m-0 w-full appearance-none bg-transparent accent-[var(--color-accent)]"
      />
    </div>
  );
}

export function BladlesingSettingsDrawer({
  open,
  engine,
  profile,
  settings,
  levelIndex,
  onClose,
  onApply,
  onApplyLevel,
  onUpdateSettings,
  onResetDefaults,
}: {
  open: boolean;
  engine: BladlesingEngine | null;
  profile: InstrumentProfile;
  settings: BladlesingSettings;
  levelIndex: number;
  onClose: () => void;
  onApply: () => void;
  onApplyLevel: (level: number) => void;
  onUpdateSettings: (patch: Partial<BladlesingSettings>, opts?: { regenerate?: boolean; rerender?: boolean }) => void;
  onResetDefaults: () => void;
}) {
  const [mobilePanel, setMobilePanel] = useState<PanelId | null>(null);
  const isTrumpet = profile === "trumpet";
  const T = engine?.Theory;

  const inst = T?.INSTRUMENTS.find((i) => i.id === settings.instrumentId);
  const writeOff = T ? T.writtenOff(settings.instrumentId) : 0;
  const minW = inst ? inst.low + writeOff : 36;
  const maxW = inst ? inst.high + writeOff : 108;
  const curWLo = Math.max(minW, Math.min(maxW, settings.rangeLow + writeOff));
  const curWHi = Math.max(minW, Math.min(maxW, settings.rangeHigh + writeOff));

  const durations = T?.DURATIONS ?? [];
  const restDurations = durations.filter((d) => !d.group);
  const majorKeys = (T?.KEYS ?? []).filter((k) => k.mode === "major");
  const minorKeys = (T?.KEYS ?? []).filter((k) => k.mode === "minor");
  const textureOpts = textureOptionsForMallets(settings.mallets);

  const levelHintText =
    levelIndex >= 0
      ? `Nivå ${levelIndex + 1}. ${LEVELS[levelIndex]!.hint}`
      : "Egendefinert miks. Velg 1–10 for å stille inn rytmer, pauser, sprang og markeringer.";

  function toggleDuration(key: "rhythms" | "rests", id: string) {
    const list = key === "rests" ? restDurations : durations;
    const set = new Set(settings[key]);
    if (set.has(id)) {
      if (set.size > 1) set.delete(id);
    } else {
      set.add(id);
    }
    const next = list.map((d) => d.id).filter((dId) => set.has(dId));
    onUpdateSettings({ [key]: next });
  }

  function toggleStopInterval(id: string) {
    const set = new Set(settings.stopIntervals);
    if (set.has(id)) {
      if (set.size > 1) set.delete(id);
    } else {
      set.add(id);
    }
    const next = STOP_INTERVALS.map(([val]) => val).filter((val) => set.has(val));
    onUpdateSettings({ stopIntervals: next });
  }

  function toggleKey(id: string) {
    const set = new Set(settings.keyIds);
    if (set.has(id)) {
      if (set.size > 1) set.delete(id);
    } else {
      set.add(id);
    }
    const next = (T?.KEYS ?? []).map((k) => k.id).filter((kId) => set.has(kId));
    onUpdateSettings({ keyIds: next.length ? next : ["C"], keyId: next[0] ?? "C" });
  }

  function setKeysGroup(ids: string[]) {
    if (!ids.length) return;
    onUpdateSettings({ keyIds: ids, keyId: ids[0]! });
  }

  function closeDrawer() {
    setMobilePanel(null);
    onClose();
  }

  function panelVisibility(id: PanelId): string {
    return mobilePanel === id ? "block" : "hidden sm:block";
  }

  const categories: Array<{ id: PanelId; label: string; summary: string }> = [
    {
      id: "instrument",
      label: "Instrument",
      summary: isTrumpet ? "B-trompet" : `${inst?.name ?? "Marimba 5.0"} · ${settings.mallets} køller`,
    },
    {
      id: "rytme",
      label: "Rytme",
      summary: `${settings.timeId === "random" ? "Tilfeldig" : settings.timeId} · ${settings.measures} takter`,
    },
    {
      id: "register",
      label: "Register",
      summary: `${midiLabel(engine, curWLo)}–${midiLabel(engine, curWHi)}`,
    },
    {
      id: "toneart",
      label: "Toneart",
      summary:
        settings.keyIds.length === 1
          ? T?.KEYS.find((k) => k.id === settings.keyIds[0])?.name ?? settings.keyIds[0]!
          : `${settings.keyIds.length} tonearter`,
    },
    {
      id: "duett",
      label: "Duett",
      summary: settings.duetEnabled ? "Aktiv" : "Av",
    },
    {
      id: "mer",
      label: "Mer",
      summary: `Tempo ${settings.tempo}`,
    },
  ];

  return (
    <>
      <div
        id="scrim"
        onClick={closeDrawer}
        className={
          open
            ? "fixed inset-0 z-40 bg-[var(--color-scrim)] opacity-100 backdrop-blur-xs transition-opacity"
            : "pointer-events-none fixed inset-0 z-40 bg-[var(--color-scrim)] opacity-0 transition-opacity"
        }
      />

      <aside
        id="drawer"
        aria-label="Innstillinger"
        aria-hidden={!open}
        className={
          open
            ? "fixed inset-0 z-50 flex flex-col bg-bg text-fg transition-transform duration-200 translate-y-0 visible"
            : "pointer-events-none fixed inset-0 z-50 flex flex-col bg-bg text-fg transition-transform duration-200 translate-y-full invisible"
        }
      >
        {/* Compact Command Center Header (optimized for 13" 16:10) */}
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line bg-[rgb(var(--color-chrome-rgb)/0.92)] px-4 py-2.5 backdrop-blur-md">
          <div className="min-w-0">
            <h2 className="text-base leading-tight font-bold tracking-tight text-fg">Innstillinger</h2>
            <p id="levelHint" className="max-w-md truncate text-xs text-muted">
              {levelHintText}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5" aria-label="Nivå 1 til 10">
            <span className="text-[11px] font-bold tracking-wider text-accent uppercase">Nivå</span>
            <div id="difficulty" className="flex flex-wrap gap-1">
              {LEVELS.map((_, i) => {
                const n = i + 1;
                const active = levelIndex === i;
                return (
                  <button
                    key={n}
                    type="button"
                    data-level={n}
                    onClick={() => onApplyLevel(n)}
                    className={
                      active
                        ? "metro-press flex size-8 items-center justify-center rounded-lg border border-accent bg-accent text-xs font-bold text-accent-fg"
                        : "metro-press flex size-8 items-center justify-center rounded-lg border border-line bg-surface text-xs font-semibold text-muted hover:text-fg"
                    }
                  >
                    {n}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="btnApplyTop"
              type="button"
              onClick={() => {
                onApply();
                closeDrawer();
              }}
              className="metro-press hidden min-h-9 items-center gap-1.5 rounded-xl bg-accent px-3.5 text-xs font-bold text-accent-fg sm:inline-flex"
            >
              <Check className="size-3.5" aria-hidden="true" />
              <span>Lag etyde</span>
            </button>
            <button
              id="btnCloseSettings"
              type="button"
              onClick={closeDrawer}
              className="metro-press inline-flex min-h-9 items-center gap-1 rounded-xl border border-line bg-surface px-3 text-xs font-semibold text-fg"
            >
              <X className="size-3.5" aria-hidden="true" />
              <span>Lukk</span>
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4 md:px-5">
          {/* Mobile category grid */}
          {mobilePanel === null ? (
            <nav
              id="settingsGrid"
              aria-label="Innstillingkategorier"
              className="grid grid-cols-2 gap-2.5 sm:hidden"
            >
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  data-settings={cat.id}
                  onClick={() => setMobilePanel(cat.id)}
                  className="metro-press flex min-h-18 flex-col items-center justify-center gap-1 rounded-2xl border border-line bg-surface px-3 py-3 text-center shadow-[var(--shadow-card)]"
                >
                  <span className="text-sm font-bold text-fg">{cat.label}</span>
                  <span className="max-w-full truncate text-xs text-muted">{cat.summary}</span>
                </button>
              ))}
            </nav>
          ) : null}

          {/* Full-width 3-column Command Center for 13" 16:10 (zero wasted space, balanced columns) */}
          <div className="mx-auto grid max-w-[1380px] items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {/* COLUMN 1: INSTRUMENT + AKKORDER + DUETT */}
            <div
              className={
                mobilePanel === "instrument" || mobilePanel === "duett"
                  ? "flex flex-col gap-3"
                  : "hidden sm:flex sm:flex-col sm:gap-3"
              }
            >
              {/* PANEL: INSTRUMENT */}
              <section data-settings-panel="instrument" className={`space-y-2.5 ${panelVisibility("instrument")}`}>
                <button
                  type="button"
                  data-settings-back
                  onClick={() => setMobilePanel(null)}
                  className="inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-accent sm:hidden"
                >
                  <ArrowLeft className="size-4" aria-hidden="true" />
                  <span>Tilbake</span>
                </button>

                <div className="space-y-2.5 rounded-2xl border border-line bg-surface p-3.5 shadow-[var(--shadow-card)]">
                  <h3 className="text-[11px] font-bold tracking-wider text-accent uppercase">Instrument & oppsett</h3>

                  {!isTrumpet ? (
                    <>
                      <div className="space-y-1">
                        <label htmlFor="instrument" className="block text-xs font-medium text-muted">
                          Instrument
                        </label>
                        <select
                          id="instrument"
                          value={settings.instrumentId}
                          onChange={(e) => onUpdateSettings({ instrumentId: e.target.value })}
                          className="sr-only-select"
                        >
                          {MALLET_INSTRUMENTS.map(([val, fullLabel]) => (
                            <option key={val} value={val}>
                              {fullLabel}
                            </option>
                          ))}
                        </select>
                        <SegPills
                          options={MALLET_INSTRUMENTS.map(([val, , shortLabel]) => [val, shortLabel] as const)}
                          value={settings.instrumentId}
                          onChange={(val) => onUpdateSettings({ instrumentId: val })}
                        />
                      </div>

                      <div className="space-y-1">
                        <label htmlFor="mallets" className="block text-xs font-medium text-muted">
                          Køller
                        </label>
                        <select
                          id="mallets"
                          value={String(settings.mallets)}
                          onChange={(e) => onUpdateSettings({ mallets: Number(e.target.value) })}
                          className="sr-only-select"
                        >
                          <option value="2">2 køller</option>
                          <option value="3">3 køller</option>
                          <option value="4">4 køller</option>
                        </select>
                        <SegPills
                          options={[
                            ["2", "2 køller"],
                            ["3", "3 køller"],
                            ["4", "4 køller"],
                          ]}
                          value={String(settings.mallets)}
                          onChange={(val) => onUpdateSettings({ mallets: Number(val) })}
                        />
                      </div>

                      <div className="space-y-1">
                        <label htmlFor="texture" className="block text-xs font-medium text-muted">
                          Notebilde
                        </label>
                        <select
                          id="texture"
                          value={settings.texture}
                          onChange={(e) => onUpdateSettings({ texture: e.target.value })}
                          className="sr-only-select"
                        >
                          {textureOpts.map(([val, fullLabel]) => (
                            <option key={val} value={val}>
                              {fullLabel}
                            </option>
                          ))}
                        </select>
                        <SegPills
                          options={textureOpts.map(([val, , shortLabel]) => [val, shortLabel] as const)}
                          value={settings.texture}
                          onChange={(val) => onUpdateSettings({ texture: val })}
                        />
                      </div>
                    </>
                  ) : (
                    <p className="text-xs leading-relaxed text-muted">
                      B-trompet er aktiv profil. Notene transponeres automatisk og ventilgrep styres under Mer.
                    </p>
                  )}

                  <div className="space-y-1">
                    <label htmlFor="clef" className="block text-xs font-medium text-muted">
                      Notesystem
                    </label>
                    <select
                      id="clef"
                      value={settings.clef}
                      onChange={(e) => onUpdateSettings({ clef: e.target.value })}
                      className="sr-only-select"
                    >
                      {CLEF_OPTIONS.map(([val, fullLabel]) => (
                        <option key={val} value={val}>
                          {fullLabel}
                        </option>
                      ))}
                    </select>
                    <SegPills
                      options={CLEF_OPTIONS.map(([val, , shortLabel]) => [val, shortLabel] as const)}
                      value={settings.clef}
                      onChange={(val) => onUpdateSettings({ clef: val })}
                    />
                  </div>
                </div>

                {/* Akkorder & doble grep (compact conditional card) */}
                {!isTrumpet ? (
                  <div className="space-y-2.5 rounded-2xl border border-line bg-surface p-3.5 shadow-[var(--shadow-card)]">
                    <h3 className="text-[11px] font-bold tracking-wider text-accent uppercase">Akkorder & grep</h3>

                    <div className="space-y-1">
                      <label htmlFor="chordChance" className="flex items-center justify-between text-xs font-medium text-muted">
                        <span id="chordChanceTitle">Akkorder i linjen</span>
                        <span className="font-semibold text-fg tabular-nums">
                          {Math.round(settings.chordChance * 100)}%
                        </span>
                      </label>
                      <input
                        id="chordChance"
                        type="range"
                        min={0}
                        max={100}
                        value={Math.round(settings.chordChance * 100)}
                        aria-labelledby="chordChanceTitle"
                        onChange={(e) => onUpdateSettings({ chordChance: Number(e.target.value) / 100 })}
                        className="w-full accent-[var(--color-accent)]"
                      />
                    </div>

                    {settings.texture !== "melody" && settings.mallets === 2 ? (
                      <div className="space-y-1.5">
                        <span className="block text-xs font-medium text-muted">Tillatte intervaller</span>
                        <div className="flex flex-wrap gap-1">
                          {STOP_INTERVALS.map(([val, label]) => {
                            const active = settings.stopIntervals.includes(val);
                            return (
                              <button
                                key={val}
                                type="button"
                                onClick={() => toggleStopInterval(val)}
                                className={
                                  active
                                    ? "metro-press min-h-7 min-w-8 rounded-lg border border-accent bg-accent/12 px-2 text-xs font-semibold text-accent"
                                    : "metro-press min-h-7 min-w-8 rounded-lg border border-line bg-header px-2 text-xs font-medium text-muted hover:text-fg"
                                }
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}

                    {settings.mallets === 4 && settings.texture !== "melody" ? (
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <span className="block text-xs font-medium text-muted">Akkordleie</span>
                          <SegPills
                            options={[
                              ["closed", "Tett"],
                              ["open", "Åpen"],
                            ]}
                            value={settings.voicing}
                            onChange={(val) => onUpdateSettings({ voicing: val })}
                          />
                        </div>
                        <div className="space-y-1">
                          <span className="block text-xs font-medium text-muted">Toner</span>
                          <SegPills
                            options={[
                              ["mix", "3 & 4"],
                              ["3", "3"],
                              ["4", "4"],
                            ]}
                            value={settings.blockSize}
                            onChange={(val) => onUpdateSettings({ blockSize: val })}
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </section>

              {/* PANEL: DUETT */}
              <section data-settings-panel="duett" className={`space-y-2.5 ${panelVisibility("duett")}`}>
                <button
                  type="button"
                  data-settings-back
                  onClick={() => setMobilePanel(null)}
                  className="inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-accent sm:hidden"
                >
                  <ArrowLeft className="size-4" aria-hidden="true" />
                  <span>Tilbake</span>
                </button>

                <div className="space-y-2.5 rounded-2xl border border-line bg-surface p-3.5 shadow-[var(--shadow-card)]">
                  <h3 className="text-[11px] font-bold tracking-wider text-accent uppercase">Duett</h3>
                  <PillSwitch
                    id="duetEnabled"
                    label="Samspill (Trompet + Slagverk)"
                    checked={settings.duetEnabled}
                    onChange={(v) => onUpdateSettings({ duetEnabled: v })}
                  />
                  {settings.duetEnabled ? (
                    <div className="space-y-2.5">
                      <div className="space-y-1">
                        <span className="block text-xs font-medium text-muted">Stil</span>
                        <SegPills
                          options={DUET_STYLE_OPTIONS}
                          value={settings.duetStyle}
                          onChange={(val) => onUpdateSettings({ duetStyle: val as DuetStyle })}
                        />
                      </div>
                      <PillSwitch
                        id="duetAllowChords"
                        label="Akkorder i slagverk"
                        checked={settings.duetAllowChords}
                        onChange={(v) => onUpdateSettings({ duetAllowChords: v })}
                      />
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-muted">Trompet-omfang</span>
                          <span className="rounded-full border border-line bg-header px-2 py-0.5 text-[11px] font-semibold text-fg tabular-nums">
                            {midiLabel(engine, settings.duetRangeTptLow)}–{midiLabel(engine, settings.duetRangeTptHigh)}
                          </span>
                        </div>
                        <DualRange
                          min={54}
                          max={84}
                          low={settings.duetRangeTptLow}
                          high={settings.duetRangeTptHigh}
                          lowLabel="Trompet laveste tone"
                          highLabel="Trompet høyeste tone"
                          onChangeLow={(v) => onUpdateSettings({ duetRangeTptLow: v })}
                          onChangeHigh={(v) => onUpdateSettings({ duetRangeTptHigh: v })}
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
              </section>
            </div>

            {/* COLUMN 2: RYTME & TAKTART + MER */}
            <div
              className={
                mobilePanel === "rytme" || mobilePanel === "mer"
                  ? "flex flex-col gap-3"
                  : "hidden sm:flex sm:flex-col sm:gap-3"
              }
            >
              {/* PANEL: RYTME */}
              <section data-settings-panel="rytme" className={`space-y-2.5 ${panelVisibility("rytme")}`}>
                <button
                  type="button"
                  data-settings-back
                  onClick={() => setMobilePanel(null)}
                  className="inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-accent sm:hidden"
                >
                  <ArrowLeft className="size-4" aria-hidden="true" />
                  <span>Tilbake</span>
                </button>

                <div className="space-y-2.5 rounded-2xl border border-line bg-surface p-3.5 shadow-[var(--shadow-card)]">
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <h3 className="text-[11px] font-bold tracking-wider text-accent uppercase">Rytme & taktart</h3>
                    <div className="flex flex-wrap gap-1">
                      {(
                        [
                          ["simple", "Enkel"],
                          ["dotted", "Punktert"],
                          ["triplets", "Trioler"],
                          ["all", "Alle"],
                        ] as const
                      ).map(([presetKey, label]) => {
                        const active = sameIds(settings.rhythms, RHYTHM_PRESETS[presetKey]);
                        return (
                          <button
                            key={presetKey}
                            type="button"
                            data-rhythm-preset={presetKey}
                            onClick={() => onUpdateSettings({ rhythms: [...RHYTHM_PRESETS[presetKey]!] })}
                            className={
                              active
                                ? "rounded-md border border-accent bg-accent/12 px-2 py-0.5 text-[11px] font-semibold text-accent"
                                : "rounded-md border border-line bg-header px-2 py-0.5 text-[11px] font-medium text-muted hover:text-fg"
                            }
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div id="rhythms" className="flex flex-wrap gap-1">
                    {durations.map((d) => {
                      const active = settings.rhythms.includes(d.id);
                      return (
                        <button
                          key={d.id}
                          type="button"
                          data-id={d.id}
                          onClick={() => toggleDuration("rhythms", d.id)}
                          className={
                            active
                              ? "metro-press min-h-8 rounded-lg border border-accent bg-accent/12 px-2 text-xs font-semibold text-accent"
                              : "metro-press min-h-8 rounded-lg border border-line bg-header px-2 text-xs font-medium text-muted hover:text-fg"
                          }
                        >
                          {d.name}
                        </button>
                      );
                    })}
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    <PillSwitch
                      id="allowRests"
                      label="Pauser"
                      checked={settings.allowRests}
                      onChange={(v) => onUpdateSettings({ allowRests: v })}
                    />
                    <PillSwitch
                      id="ties"
                      label="Bindebuer"
                      checked={settings.ties}
                      onChange={(v) => onUpdateSettings({ ties: v })}
                    />
                    <PillSwitch
                      id="syncopation"
                      label="Synkoper"
                      checked={settings.syncopation}
                      onChange={(v) => onUpdateSettings({ syncopation: v })}
                    />
                    <PillSwitch
                      id="dynamics"
                      label="Dynamikk"
                      checked={settings.dynamics}
                      onChange={(v) => onUpdateSettings({ dynamics: v })}
                    />
                  </div>

                  {settings.allowRests ? (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted">Pauseverdier</p>
                      <div id="rests" className="flex flex-wrap gap-1">
                        {restDurations.map((d) => {
                          const active = settings.rests.includes(d.id);
                          return (
                            <button
                              key={d.id}
                              type="button"
                              data-id={d.id}
                              onClick={() => toggleDuration("rests", d.id)}
                              className={
                                active
                                  ? "metro-press min-h-7 rounded-lg border border-accent bg-accent/12 px-2 text-xs font-semibold text-accent"
                                  : "metro-press min-h-7 rounded-lg border border-line bg-header px-2 text-xs font-medium text-muted hover:text-fg"
                              }
                            >
                              {d.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  <div className="space-y-1">
                    <label htmlFor="time" className="block text-xs font-medium text-muted">
                      Taktart
                    </label>
                    <select
                      id="time"
                      value={settings.timeId}
                      onChange={(e) => onUpdateSettings({ timeId: e.target.value })}
                      className="sr-only-select"
                    >
                      {TIME_OPTIONS.map((t) => (
                        <option key={t} value={t}>
                          {t === "random" ? "Tilfeldig" : t}
                        </option>
                      ))}
                    </select>
                    <SegPills
                      options={TIME_OPTIONS.map((t) => [t, t === "random" ? "Tilf." : t] as const)}
                      value={settings.timeId}
                      onChange={(val) => onUpdateSettings({ timeId: val })}
                    />
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="measures" className="block text-xs font-medium text-muted">
                      Lengde
                    </label>
                    <select
                      id="measures"
                      value={String(settings.measures)}
                      onChange={(e) => onUpdateSettings({ measures: Number(e.target.value) })}
                      className="sr-only-select"
                    >
                      {MEASURE_OPTIONS.map((m) => (
                        <option key={m} value={String(m)}>
                          {m}
                        </option>
                      ))}
                    </select>
                    <SegPills
                      options={MEASURE_OPTIONS.map((m) => [String(m), `${m} takter`] as const)}
                      value={String(settings.measures)}
                      onChange={(val) => onUpdateSettings({ measures: Number(val) })}
                    />
                  </div>
                </div>
              </section>

              {/* PANEL: MER */}
              <section data-settings-panel="mer" className={`space-y-2.5 ${panelVisibility("mer")}`}>
                <button
                  type="button"
                  data-settings-back
                  onClick={() => setMobilePanel(null)}
                  className="inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-accent sm:hidden"
                >
                  <ArrowLeft className="size-4" aria-hidden="true" />
                  <span>Tilbake</span>
                </button>

                <div className="space-y-2.5 rounded-2xl border border-line bg-surface p-3.5 shadow-[var(--shadow-card)]">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[11px] font-bold tracking-wider text-accent uppercase">Uttrykk & mer</h3>
                    <button
                      type="button"
                      onClick={onResetDefaults}
                      className="metro-press inline-flex items-center gap-1 rounded-md border border-line bg-header px-2 py-0.5 text-[11px] font-medium text-muted hover:text-fg"
                    >
                      <RotateCcw className="size-3" aria-hidden="true" />
                      <span>Tilbakestill</span>
                    </button>
                  </div>

                  <div className="space-y-2.5">
                    <div className="space-y-1">
                      <label htmlFor="rolls" className="block text-xs font-medium text-muted">
                        Virvler
                      </label>
                      <select
                        id="rolls"
                        value={settings.rolls}
                        onChange={(e) => onUpdateSettings({ rolls: e.target.value })}
                        className="sr-only-select"
                      >
                        {ROLL_OPTIONS.map(([val, label]) => (
                          <option key={val} value={val}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <SegPills
                        options={ROLL_OPTIONS}
                        value={settings.rolls}
                        onChange={(val) => onUpdateSettings({ rolls: val })}
                      />
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="annotate" className="block text-xs font-medium text-muted">
                        Hjelpetekst
                      </label>
                      <select
                        id="annotate"
                        value={settings.annotate}
                        onChange={(e) => onUpdateSettings({ annotate: e.target.value })}
                        className="sr-only-select"
                      >
                        {ANNOTATE_OPTIONS.map(([val, label]) => (
                          <option key={val} value={val}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <SegPills
                        options={ANNOTATE_OPTIONS}
                        value={settings.annotate}
                        onChange={(val) => onUpdateSettings({ annotate: val })}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    <PillSwitch
                      id="accents"
                      label="Aksenter"
                      checked={settings.accents}
                      onChange={(v) => onUpdateSettings({ accents: v })}
                    />
                    <PillSwitch
                      id="staccato"
                      label="Stakkato"
                      checked={settings.staccato}
                      onChange={(v) => onUpdateSettings({ staccato: v })}
                    />
                    <PillSwitch
                      id="legato"
                      label="Legato"
                      checked={settings.legato}
                      onChange={(v) => onUpdateSettings({ legato: v })}
                    />
                    <PillSwitch
                      id="showSticking"
                      label={isTrumpet ? "Ventilgrep" : "Kølleføring"}
                      checked={settings.showSticking}
                      onChange={(v) => onUpdateSettings({ showSticking: v })}
                    />
                  </div>
                </div>
              </section>
            </div>

            {/* COLUMN 3: REGISTER & SPRANG + TONEARTER */}
            <div
              className={
                mobilePanel === "register" || mobilePanel === "toneart"
                  ? "flex flex-col gap-3"
                  : "hidden sm:flex sm:flex-col sm:gap-3"
              }
            >
              {/* PANEL: REGISTER */}
              <section data-settings-panel="register" className={`space-y-2.5 ${panelVisibility("register")}`}>
                <button
                  type="button"
                  data-settings-back
                  onClick={() => setMobilePanel(null)}
                  className="inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-accent sm:hidden"
                >
                  <ArrowLeft className="size-4" aria-hidden="true" />
                  <span>Tilbake</span>
                </button>

                <div className="space-y-2.5 rounded-2xl border border-line bg-surface p-3.5 shadow-[var(--shadow-card)]">
                  <h3 className="text-[11px] font-bold tracking-wider text-accent uppercase">Register & sprang</h3>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-muted">Toneomfang</span>
                      <span className="rounded-full border border-line bg-header px-2.5 py-0.5 text-[11px] font-semibold text-fg tabular-nums">
                        <strong id="rangeLowLbl" className="text-accent">
                          {midiLabel(engine, curWLo)}
                        </strong>{" "}
                        –{" "}
                        <strong id="rangeHighLbl" className="text-accent">
                          {midiLabel(engine, curWHi)}
                        </strong>
                      </span>
                    </div>
                    <DualRange
                      min={minW}
                      max={maxW}
                      low={curWLo}
                      high={curWHi}
                      lowId="rangeLow"
                      highId="rangeHigh"
                      lowLabel="Laveste tone"
                      highLabel="Høyeste tone"
                      onChangeLow={(wlo) => onUpdateSettings({ rangeLow: wlo - writeOff })}
                      onChangeHigh={(whi) => onUpdateSettings({ rangeHigh: whi - writeOff })}
                    />
                    <p id="rangeHint" className="text-[11px] text-muted">
                      Skrevet omfang for {inst?.name ?? "Marimba 5.0"}: {midiLabel(engine, minW)}–
                      {midiLabel(engine, maxW)}.
                    </p>
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="maxLeap" className="block text-xs font-medium text-muted">
                      Største sprang
                    </label>
                    <select
                      id="maxLeap"
                      value={String(settings.maxLeap)}
                      onChange={(e) => onUpdateSettings({ maxLeap: Number(e.target.value) })}
                      className="sr-only-select"
                    >
                      {LEAP_OPTIONS.map(([val, fullLabel]) => (
                        <option key={val} value={String(val)}>
                          {fullLabel}
                        </option>
                      ))}
                    </select>
                    <SegPills
                      options={LEAP_OPTIONS.map(([val, , shortLabel]) => [String(val), shortLabel] as const)}
                      value={String(settings.maxLeap)}
                      onChange={(val) => onUpdateSettings({ maxLeap: Number(val) })}
                    />
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="density" className="flex items-center justify-between text-xs font-medium text-muted">
                      <span>Tetthet</span>
                      <span className="font-semibold text-fg tabular-nums">{settings.rhythmDensity} / 5</span>
                    </label>
                    <input
                      id="density"
                      type="range"
                      min={1}
                      max={5}
                      value={settings.rhythmDensity}
                      onChange={(e) => onUpdateSettings({ rhythmDensity: Number(e.target.value) })}
                      className="w-full accent-[var(--color-accent)]"
                    />
                  </div>
                </div>
              </section>

              {/* PANEL: TONEART */}
              <section data-settings-panel="toneart" className={`space-y-2.5 ${panelVisibility("toneart")}`}>
                <button
                  type="button"
                  data-settings-back
                  onClick={() => setMobilePanel(null)}
                  className="inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-accent sm:hidden"
                >
                  <ArrowLeft className="size-4" aria-hidden="true" />
                  <span>Tilbake</span>
                </button>

                <div className="space-y-2.5 rounded-2xl border border-line bg-surface p-3.5 shadow-[var(--shadow-card)]">
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <h3 id="keysHeading" className="text-[11px] font-bold tracking-wider text-accent uppercase">
                      Tonearter
                    </h3>
                    <div role="group" aria-labelledby="keysHeading" className="flex flex-wrap gap-1">
                      <button
                        id="keysAll"
                        type="button"
                        onClick={() => setKeysGroup((T?.KEYS ?? []).map((k) => k.id))}
                        className="rounded-md border border-line bg-header px-2 py-0.5 text-[11px] font-medium text-muted hover:text-fg"
                      >
                        Alle
                      </button>
                      <button
                        type="button"
                        onClick={() => setKeysGroup(["C", "F", "G", "Bb", "D"])}
                        className="rounded-md border border-line bg-header px-2 py-0.5 text-[11px] font-medium text-muted hover:text-fg"
                      >
                        Vanlige
                      </button>
                      <button
                        type="button"
                        onClick={() => setKeysGroup(["C"])}
                        className="rounded-md border border-line bg-header px-2 py-0.5 text-[11px] font-medium text-muted hover:text-fg"
                      >
                        Kun C
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <p id="keysMajorHeading" className="text-[11px] font-medium text-muted">
                      Dur
                    </p>
                    <div
                      id="keysMajorChips"
                      role="group"
                      aria-labelledby="keysHeading keysMajorHeading"
                      className="grid grid-cols-6 gap-1"
                    >
                      {majorKeys.map((k) => {
                        const active = settings.keyIds.includes(k.id);
                        return (
                          <button
                            key={k.id}
                            type="button"
                            onClick={() => toggleKey(k.id)}
                            className={
                              active
                                ? "metro-press min-h-8 rounded-lg border border-accent bg-accent/12 text-xs font-semibold text-accent"
                                : "metro-press min-h-8 rounded-lg border border-line bg-header text-xs font-medium text-muted hover:text-fg"
                            }
                          >
                            {k.name.replace("-dur", "")}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <p id="keysMinorHeading" className="text-[11px] font-medium text-muted">
                      Parallellmoll
                    </p>
                    <div
                      id="keysMinorChips"
                      role="group"
                      aria-labelledby="keysHeading keysMinorHeading"
                      className="grid grid-cols-6 gap-1"
                    >
                      {minorKeys.map((k) => {
                        const active = settings.keyIds.includes(k.id);
                        return (
                          <button
                            key={k.id}
                            type="button"
                            onClick={() => toggleKey(k.id)}
                            className={
                              active
                                ? "metro-press min-h-8 rounded-lg border border-accent bg-accent/12 text-xs font-semibold text-accent"
                                : "metro-press min-h-8 rounded-lg border border-line bg-header text-xs font-medium text-muted hover:text-fg"
                            }
                          >
                            {k.name.replace("-moll", "m")}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    <PillSwitch
                      id="accidentals"
                      label="Løse fortegn"
                      checked={settings.accidentals}
                      onChange={(v) => onUpdateSettings({ accidentals: v })}
                    />
                    <PillSwitch
                      id="startTonic"
                      label="Start grunntone"
                      checked={settings.startTonic}
                      onChange={(v) => onUpdateSettings({ startTonic: v })}
                    />
                    <PillSwitch
                      id="endTonic"
                      label="Slutt grunntone"
                      checked={settings.endTonic}
                      onChange={(v) => onUpdateSettings({ endTonic: v })}
                    />
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>

        {/* Mobile footer apply button */}
        <footer className="flex shrink-0 justify-center border-t border-line bg-[rgb(var(--color-chrome-rgb)/0.92)] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md sm:hidden">
          <button
            id="btnApply"
            type="button"
            onClick={() => {
              onApply();
              closeDrawer();
            }}
            className="metro-press min-h-11 w-full max-w-md rounded-xl bg-accent text-sm font-bold text-accent-fg"
          >
            Lag etyde
          </button>
        </footer>
      </aside>
    </>
  );
}
