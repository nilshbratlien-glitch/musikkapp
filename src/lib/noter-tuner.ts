import { audio } from "./pulse.ts";

export type ReferenceNoteId = "A" | "Bb" | "C" | "F";

export const REFERENCE_NOTES: ReadonlyArray<{
  id: ReferenceNoteId;
  label: string;
  semitonesFromA4: number;
}> = [
  { id: "A", label: "A", semitonesFromA4: 0 },
  { id: "Bb", label: "B♭", semitonesFromA4: 1 },
  { id: "C", label: "C", semitonesFromA4: 3 },
  { id: "F", label: "F", semitonesFromA4: -4 },
];

export const REFERENCE_A4_OPTIONS = [440, 442] as const;

export function getReferenceFrequency(note: ReferenceNoteId, a4Hz = 440): number {
  const safeA4 = Number.isFinite(a4Hz) && a4Hz >= 415 && a4Hz <= 466 ? a4Hz : 440;
  const def = REFERENCE_NOTES.find((n) => n.id === note) ?? REFERENCE_NOTES[0]!;
  return safeA4 * 2 ** (def.semitonesFromA4 / 12);
}

let activeOsc: OscillatorNode | null = null;
let activeGain: GainNode | null = null;
let activeNote: ReferenceNoteId | null = null;

export function isReferenceTonePlaying(): boolean {
  return activeOsc !== null;
}

export function getActiveReferenceNote(): ReferenceNoteId | null {
  return activeNote;
}

export function stopReferenceTone(): void {
  const osc = activeOsc;
  const gain = activeGain;
  activeOsc = null;
  activeGain = null;
  activeNote = null;
  if (!osc || !gain) return;
  try {
    const ctx = gain.context;
    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
    osc.stop(now + 0.05);
  } catch {
    try {
      osc.stop();
    } catch {
      /* already stopped */
    }
  }
}

export function startReferenceTone(note: ReferenceNoteId, a4Hz = 440): boolean {
  stopReferenceTone();
  const ctx = audio();
  if (!ctx) return false;

  try {
    const freq = getReferenceFrequency(note, a4Hz);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, ctx.currentTime);

    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.03);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);

    activeOsc = osc;
    activeGain = gain;
    activeNote = note;
    osc.onended = () => {
      if (activeOsc === osc) {
        activeOsc = null;
        activeGain = null;
        activeNote = null;
      }
    };
    return true;
  } catch {
    stopReferenceTone();
    return false;
  }
}
