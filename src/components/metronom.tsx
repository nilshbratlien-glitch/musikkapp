import { useEffect, useState, useSyncExternalStore } from "react";
import { PlainMetronome } from "@/components/plain-metronome";
import { SnareSpeed } from "@/components/snare-speed";
import { getProfile, getProfileVersion, subscribeProfile } from "@/lib/profile";
import { readToolStore, writeToolStore } from "@/lib/tools";

type Mode = "metro" | "rudiment";

export function Metronom() {
  useSyncExternalStore(subscribeProfile, getProfileVersion, getProfileVersion);
  const profile = getProfile();
  const [mode, setMode] = useState<Mode>("metro");

  useEffect(() => {
    const saved = readToolStore("metronom").mode;
    if (saved === "rudiment" || saved === "metro") setMode(saved);
    else setMode("metro");
  }, [profile]);

  function choose(next: Mode) {
    setMode(next);
    const store = readToolStore("metronom");
    writeToolStore("metronom", { ...store, mode: next });
  }

  if (profile === "trumpet") {
    return (
      <section className="pb-4">
        <PlainMetronome />
      </section>
    );
  }

  return (
    <section className="pb-4">
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl border border-line bg-header p-1 md:max-w-md">
        <button
          type="button"
          onClick={() => choose("metro")}
          className={
            mode === "metro"
              ? "min-h-10 rounded-lg border border-line/70 bg-surface font-semibold text-fg shadow-xs transition"
              : "min-h-10 rounded-lg border border-transparent text-muted transition hover:text-fg"
          }
        >
          Metronom
        </button>
        <button
          type="button"
          onClick={() => choose("rudiment")}
          className={
            mode === "rudiment"
              ? "min-h-10 rounded-lg border border-line/70 bg-surface font-semibold text-fg shadow-xs transition"
              : "min-h-10 rounded-lg border border-transparent text-muted transition hover:text-fg"
          }
        >
          Rudiment
        </button>
      </div>
      {mode === "metro" ? <PlainMetronome /> : <SnareSpeed />}
    </section>
  );
}
