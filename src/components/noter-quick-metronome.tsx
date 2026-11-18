import { useEffect, useState } from "react";
import { Minus, Pause, Play, Plus, Volume2 } from "lucide-react";
import { MAX_BPM, MIN_BPM } from "@/lib/noter";
import {
  REFERENCE_A4_OPTIONS,
  REFERENCE_NOTES,
  type ReferenceNoteId,
} from "@/lib/noter-tuner";
import { getState, subscribe } from "@/lib/pulse";

function useNoterPulseState() {
  const [pulseState, setPulseState] = useState(() => ({ ...getState() }));
  useEffect(() => {
    setPulseState({ ...getState() });
    return subscribe(() => {
      setPulseState({ ...getState() });
    });
  }, []);
  return pulseState;
}

export function NoterMetronomeButton({
  bpm,
  metronomeOpen,
  tunerActive,
  onToggleOpen,
}: {
  bpm: number;
  metronomeOpen: boolean;
  tunerActive: boolean;
  onToggleOpen: () => void;
}) {
  const pulseState = useNoterPulseState();
  const metroRunning = pulseState.running && pulseState.owner === "noter";

  return (
    <button
      type="button"
      onClick={onToggleOpen}
      aria-expanded={metronomeOpen}
      aria-label="Hurtig-metronom og stemmegaffel"
      style={
        metroRunning || tunerActive
          ? { backgroundColor: "rgba(224, 177, 90, 0.15)" }
          : undefined
      }
      className={
        metroRunning || tunerActive
          ? "metro-press flex min-h-10 items-center gap-1.5 rounded-lg border border-accent px-2 text-xs font-semibold text-accent sm:px-2.5"
          : "metro-press flex min-h-10 items-center gap-1.5 rounded-lg border border-line bg-surface px-2 text-xs font-semibold text-fg sm:px-2.5"
      }
    >
      <span
        aria-hidden="true"
        className={
          metroRunning
            ? "size-2.5 rounded-full bg-accent transition-transform duration-75"
            : "size-2.5 rounded-full"
        }
        style={
          metroRunning
            ? pulseState.beat >= 0
              ? { transform: pulseState.beat === 0 ? "scale(1.4)" : "scale(1.1)" }
              : undefined
            : { backgroundColor: "rgba(154, 163, 176, 0.6)" }
        }
      />
      <span className="tabular-nums">{bpm} BPM</span>
    </button>
  );
}

export function NoterQuickMetronomeBar({
  bpm,
  tunerA4,
  tunerNote,
  onTogglePlayback,
  onUpdateBpm,
  onTapTempo,
  onChangeTunerA4,
  onToggleTunerNote,
  onStopTuner,
}: {
  bpm: number;
  tunerA4: 440 | 442;
  tunerNote: ReferenceNoteId | null;
  onTogglePlayback: () => void;
  onUpdateBpm: (rawBpm: number) => void;
  onTapTempo: () => void;
  onChangeTunerA4: (hz: 440 | 442) => void;
  onToggleTunerNote: (noteId: ReferenceNoteId) => void;
  onStopTuner: () => void;
}) {
  const pulseState = useNoterPulseState();
  const metroRunning = pulseState.running && pulseState.owner === "noter";

  return (
    <div
      aria-label="Hurtig-metronom kontroller"
      className="z-20 flex shrink-0 flex-col gap-2 border-b border-line bg-surface px-3 py-2.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onTogglePlayback}
            style={metroRunning ? undefined : { backgroundColor: "rgba(224, 177, 90, 0.15)" }}
            className={
              metroRunning
                ? "metro-press flex min-h-11 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-bold text-[#1a1408]"
                : "metro-press flex min-h-11 items-center gap-1.5 rounded-lg border border-accent px-3.5 text-sm font-semibold text-accent"
            }
          >
            {metroRunning ? (
              <>
                <Pause className="size-4" aria-hidden="true" />
                <span>Stopp</span>
              </>
            ) : (
              <>
                <Play className="size-4" aria-hidden="true" />
                <span>Start</span>
              </>
            )}
          </button>

          <div className="flex items-center gap-1 rounded-lg border border-line bg-header px-1 py-0.5">
            <button
              type="button"
              onClick={() => onUpdateBpm(bpm - 1)}
              aria-label="Reduser BPM"
              className="metro-press flex min-h-11 min-w-11 items-center justify-center rounded-md text-fg hover:bg-surface"
            >
              <Minus className="size-4" aria-hidden="true" />
            </button>
            <input
              type="number"
              min={MIN_BPM}
              max={MAX_BPM}
              value={bpm}
              onChange={(e) => {
                const val = Number(e.target.value);
                if (!Number.isNaN(val)) onUpdateBpm(val);
              }}
              aria-label="BPM-verdi"
              className="w-14 bg-transparent text-center text-sm font-bold text-fg tabular-nums focus:outline-none"
            />
            <button
              type="button"
              onClick={() => onUpdateBpm(bpm + 1)}
              aria-label="Øk BPM"
              className="metro-press flex min-h-11 min-w-11 items-center justify-center rounded-md text-fg hover:bg-surface"
            >
              <Plus className="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="flex flex-1 items-center gap-2 sm:max-w-xs">
          <input
            type="range"
            min={MIN_BPM}
            max={MAX_BPM}
            value={bpm}
            onChange={(e) => onUpdateBpm(Number(e.target.value))}
            aria-label="BPM-skyveknapp"
            className="h-2 w-full accent-[#e0b15a]"
          />
          <button
            type="button"
            onClick={onTapTempo}
            className="metro-press min-h-11 min-w-11 shrink-0 rounded-lg border border-line bg-header px-3 text-xs font-semibold text-fg hover:border-accent"
          >
            Tap
          </button>
        </div>
      </div>

      {/* Referansetone (stemmegaffel) */}
      <div
        aria-label="Referansetone"
        className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2"
      >
        <div className="flex items-center gap-1.5">
          <Volume2 className="size-4 text-accent" aria-hidden="true" />
          <span className="text-xs font-semibold text-muted">Referansetone</span>
          <div className="flex items-center rounded-lg border border-line bg-header p-0.5">
            {REFERENCE_A4_OPTIONS.map((hz) => (
              <button
                key={hz}
                type="button"
                onClick={() => onChangeTunerA4(hz)}
                aria-pressed={tunerA4 === hz}
                style={
                  tunerA4 === hz
                    ? { backgroundColor: "rgba(224, 177, 90, 0.18)" }
                    : undefined
                }
                className={
                  tunerA4 === hz
                    ? "metro-press min-h-8 rounded-md px-2 text-xs font-bold text-accent tabular-nums"
                    : "metro-press min-h-8 rounded-md px-2 text-xs font-medium text-muted hover:text-fg tabular-nums"
                }
              >
                {hz} Hz
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {REFERENCE_NOTES.map((note) => {
            const active = tunerNote === note.id;
            return (
              <button
                key={note.id}
                type="button"
                onClick={() => onToggleTunerNote(note.id)}
                aria-pressed={active}
                aria-label={`Referansetone ${note.label}`}
                style={active ? { backgroundColor: "rgba(224, 177, 90, 0.2)" } : undefined}
                className={
                  active
                    ? "metro-press min-h-10 min-w-10 rounded-lg border border-accent px-3 text-sm font-bold text-accent"
                    : "metro-press min-h-10 min-w-10 rounded-lg border border-line bg-header px-3 text-sm font-semibold text-fg hover:border-accent"
                }
              >
                {note.label}
              </button>
            );
          })}

          {tunerNote ? (
            <button
              type="button"
              onClick={onStopTuner}
              className="metro-press min-h-10 rounded-lg border border-line bg-header px-2.5 text-xs font-semibold text-muted hover:text-fg"
            >
              Stopp tone
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
