import { BladlesingView } from "@/components/bladlesing/bladlesing-view";
import "@/lib/pulse";

declare global {
  interface Window {
    MalletSight?: {
      mount?: (root: HTMLElement) => void;
      unmount?: () => void;
      isReady?: () => boolean;
      setProfile?: (profile?: string) => boolean;
      setDuetEnabled?: (on: boolean) => boolean;
      generate?: () => boolean;
      getScore?: () => unknown;
      getTempo?: () => number;
      applyScore?: (score: unknown, tempo?: number) => boolean;
      getSeed?: () => number | null;
      getSyncSettings?: () => Record<string, unknown> | null;
      applySeed?: (payload: { seed: number; settings?: Record<string, unknown>; tempo?: number }) => boolean;
      getDuetViewPart?: () => "score" | "trumpet" | "mallets";
      setDuetViewPart?: (part: "score" | "trumpet" | "mallets") => boolean;
      togglePlay?: () => boolean;
      toggleMetro?: () => boolean;
      startPlay?: () => boolean;
      stopPlay?: () => boolean;
      startMetro?: () => boolean;
      stopMetro?: () => boolean;
      again?: () => boolean;
      stopAll?: () => void;
      setTempo?: (bpm: number) => boolean;
    };
  }
}

export function Malletsight() {
  return <BladlesingView />;
}
