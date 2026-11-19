import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  DEFAULTS,
  LEVELS,
  applyLevelPreset,
  applyPracticeRecipe,
  clampZoom,
  compactSyncSettings,
  detectLevelIndex,
  loadBladlesingSettings,
  saveBladlesingSettings,
  type BladlesingSettings,
  type DuetViewPart,
  type PracticeRecipe,
} from "@/lib/bladlesing-config";
import {
  loadBladlesingEngine,
  type BeatTimingEntry,
  type BladlesingEngine,
  type GeneratedScore,
} from "@/lib/bladlesing-engine";
import { activeBlockColor, resumeFromBladlesing } from "@/lib/plan-clock";
import { getProfile, getProfileVersion, subscribeProfile, type InstrumentProfile } from "@/lib/profile";
import { getState as getPulseState, subscribe as subscribePulse, unlock as unlockPulse } from "@/lib/pulse";
import { isDuetViewPaired, setDuetViewPaired, subscribeDuetViewPaired } from "@/lib/sync/bridge";

export interface BladlesingControllerState {
  ready: boolean;
  error: string | null;
  engine: BladlesingEngine | null;
  profile: InstrumentProfile;
  settings: BladlesingSettings;
  score: GeneratedScore | null;
  playing: boolean;
  metroOn: boolean;
  metroLabel: string;
  subdiv: 1 | 2 | 4;
  activeBeat: number;
  beatsPerBar: number;
  yielded: boolean;
  yieldColor: string | null;
  countInBeat: number | null;
  autoNextLeft: number | null;
  duetPaired: boolean;
  practiceLine: string;
  levelIndex: number;
}

function makeSeed(): number {
  return Math.floor(Math.random() * 2147483646) + 1;
}

function defaultDuetMalletRange(engine: BladlesingEngine | null, instId: string) {
  const inst = engine?.Theory.INSTRUMENTS.find((i) => i.id === instId);
  if (!inst) return { low: 60, high: 84, minW: 36, maxW: 108 };
  const off = inst.writtenOff || 0;
  const minW = inst.low + off;
  const maxW = inst.high + off;
  switch (instId) {
    case "glock":
      return { low: 55, high: 84, minW, maxW };
    case "xylo":
    case "vibes":
      return { low: 53, high: 84, minW, maxW };
    case "mar43":
      return { low: 45, high: 84, minW, maxW };
    case "mar50":
      return { low: 36, high: 84, minW, maxW };
    default:
      return { low: Math.max(minW, 60), high: Math.min(maxW, 84), minW, maxW };
  }
}

export function formatPracticeLine(
  engine: BladlesingEngine | null,
  settings: BladlesingSettings,
  score: GeneratedScore | null,
): string {
  const idx = detectLevelIndex(settings);
  const lvl = idx >= 0 ? `Nivå ${idx + 1}` : "Egendefinert";
  const T = engine?.Theory;
  const timeId = score?.time?.id ?? (settings.timeId === "random" ? "4/4" : settings.timeId);

  if (score?.isDuet) {
    const keyName =
      settings.duetViewPart === "trumpet"
        ? score.trumpetKey?.name ?? score.key?.name ?? "C-dur"
        : score.concertKey?.name ?? score.key?.name ?? "C-dur";
    const malInst = T?.INSTRUMENTS.find((i) => i.id === (settings.duetMalletInstrument || "xylo"))?.name ?? "Xylofon";
    return `${lvl} · ${keyName} · ${timeId} · Duett (Trompet + ${malInst})`;
  }

  const keyName =
    score?.key?.name ??
    T?.KEYS.find((k) => k.id === (settings.keyIds[0] || settings.keyId))?.name ??
    "C-dur";
  const instName = T?.INSTRUMENTS.find((i) => i.id === settings.instrumentId)?.name ?? "Marimba 5.0";
  return `${lvl} · ${keyName} · ${timeId} · ${instName}`;
}

export function useBladlesingController(scoreHostRef: React.RefObject<HTMLDivElement | null>) {
  useSyncExternalStore(subscribeProfile, getProfileVersion, getProfileVersion);
  useSyncExternalStore(subscribeDuetViewPaired, () => (isDuetViewPaired() ? 1 : 0), () => 0);
  const profile = getProfile();
  const duetPaired = isDuetViewPaired();

  const [engine, setEngine] = useState<BladlesingEngine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettingsState] = useState<BladlesingSettings>(() => loadBladlesingSettings(profile));
  const [score, setScore] = useState<GeneratedScore | null>(null);
  const [playing, setPlaying] = useState(false);
  const [metroOn, setMetroOn] = useState(false);
  const [metroLabel, setMetroLabel] = useState("Metronom");
  const [subdiv, setSubdivState] = useState<1 | 2 | 4>(1);
  const [activeBeat, setActiveBeat] = useState(-1);
  const [beatsPerBar, setBeatsPerBar] = useState(4);
  const [yielded, setYielded] = useState(() => getPulseState().owner === "oveplan");
  const [yieldColor, setYieldColor] = useState<string | null>(() => activeBlockColor());
  const [countInBeat, setCountInBeat] = useState<number | null>(null);
  const [autoNextLeft, setAutoNextLeft] = useState<number | null>(null);

  const engineRef = useRef<BladlesingEngine | null>(null);
  const settingsRef = useRef<BladlesingSettings>(settings);
  const profileRef = useRef<InstrumentProfile>(profile);
  const scoreRef = useRef<GeneratedScore | null>(null);
  const seedRef = useRef<number | null>(null);
  const visualRef = useRef<unknown>(null);
  const beatMapRef = useRef<BeatTimingEntry[]>([]);
  const subdivRef = useRef<1 | 2 | 4>(1);
  const remoteCallRef = useRef(false);
  const metroBeforePlayRef = useRef(false);
  const practiceBeatRef = useRef(0);
  const autoNextTimerRef = useRef<number | null>(null);
  const autoNextModeRef = useRef<"play" | "metro" | null>(null);
  const fadedElsRef = useRef<Element[]>([]);

  settingsRef.current = settings;
  profileRef.current = profile;
  scoreRef.current = score;
  subdivRef.current = subdiv;

  const clearFadedMeasures = useCallback(() => {
    for (const el of fadedElsRef.current) {
      el.classList.remove("measure-faded");
    }
    fadedElsRef.current = [];
  }, []);

  const fadeCompletedMeasures = useCallback((beatIdx: number, barBeats: number) => {
    if (!settingsRef.current.flowDisappearing) return;
    const currentMeasure = Math.floor(beatIdx / Math.max(1, barBeats));
    if (currentMeasure < 0) return;
    const fadeUpToBeat = (currentMeasure + 1) * Math.max(1, barBeats) - 1;
    const map = beatMapRef.current;
    for (let i = 0; i <= Math.min(fadeUpToBeat, map.length - 1); i++) {
      const entry = map[i];
      if (!entry) continue;
      for (const el of entry.elements) {
        if (el && el.classList && !el.classList.contains("measure-faded")) {
          el.classList.add("measure-faded");
          fadedElsRef.current.push(el);
        }
      }
    }
  }, []);

  const cancelAutoNext = useCallback(() => {
    if (autoNextTimerRef.current != null) {
      window.clearInterval(autoNextTimerRef.current);
      autoNextTimerRef.current = null;
    }
    autoNextModeRef.current = null;
    setAutoNextLeft(null);
  }, []);

  const getMetroSpec = useCallback((s: BladlesingSettings = settingsRef.current, sc: GeneratedScore | null = scoreRef.current) => {
    const T = engineRef.current?.Theory;
    const time = sc?.time ?? T?.TIMES.find((t) => t.id === s.timeId) ?? { id: "4/4", num: 4, den: 4 };
    if (time.id === "6/8") return { beats: 2, bpm: (s.tempo * 2) / 3, beatTicks: 36 };
    if (time.id === "2/2") return { beats: 2, bpm: s.tempo / 2, beatTicks: 48 };
    if (time.den === 8) return { beats: time.num, bpm: s.tempo * 2, beatTicks: 12 };
    return { beats: time.num || 4, bpm: s.tempo, beatTicks: 24 };
  }, []);

  const renderCurrentScore = useCallback(
    (sc: GeneratedScore | null = scoreRef.current, s: BladlesingSettings = settingsRef.current) => {
      const eng = engineRef.current;
      const container = scoreHostRef.current;
      if (!eng || !container || !sc) return;
      clearFadedMeasures();
      eng.ScoreRenderer.clearBeat();
      const visual = eng.ScoreRenderer.renderScore(container, sc, s as unknown as Record<string, unknown>);
      visualRef.current = visual;
      const spec = getMetroSpec(s, sc);
      setBeatsPerBar(spec.beats);
      beatMapRef.current = eng.ScoreRenderer.prepareCursor(visual, s.tempo, spec.beatTicks);
    },
    [clearFadedMeasures, getMetroSpec, scoreHostRef],
  );

  const persistSettings = useCallback((next: BladlesingSettings) => {
    settingsRef.current = next;
    setSettingsState(next);
    saveBladlesingSettings(profileRef.current, next);
  }, []);

  const stopPlaybackOnly = useCallback(() => {
    cancelAutoNext();
    const eng = engineRef.current;
    if (eng?.AudioEngine.isPlaying()) {
      eng.AudioEngine.stopPlayback();
    }
    setPlaying(false);
    setCountInBeat(null);
    setActiveBeat(-1);
    clearFadedMeasures();
    eng?.ScoreRenderer.clearBeat();
  }, [cancelAutoNext, clearFadedMeasures]);

  const stopAll = useCallback(() => {
    cancelAutoNext();
    const eng = engineRef.current;
    if (eng) {
      if (eng.AudioEngine.isPlaying()) eng.AudioEngine.stopPlayback();
      if (eng.AudioEngine.isMetro()) eng.AudioEngine.stopMetronome();
      eng.ScoreRenderer.clearBeat();
    }
    setPlaying(false);
    setMetroOn(false);
    setMetroLabel("Metronom");
    setCountInBeat(null);
    setActiveBeat(-1);
    clearFadedMeasures();
  }, [cancelAutoNext, clearFadedMeasures]);

  const generate = useCallback(
    (opts?: { seed?: number; customSettings?: BladlesingSettings; skipBroadcast?: boolean }) => {
      const eng = engineRef.current;
      if (!eng) return false;
      cancelAutoNext();
      if (eng.AudioEngine.isPlaying()) {
        eng.AudioEngine.stopPlayback();
        setPlaying(false);
      }
      setCountInBeat(null);
      setActiveBeat(-1);
      clearFadedMeasures();
      eng.ScoreRenderer.clearBeat();

      const s = opts?.customSettings ?? settingsRef.current;
      const keys = s.keyIds && s.keyIds.length ? s.keyIds : ["C"];
      const keyIdx = (s.keyIndex ?? 0) % keys.length;
      const chosenKey = keys[keyIdx] ?? "C";
      const seed = opts?.seed ?? makeSeed();
      seedRef.current = seed;

      const genSettings: Record<string, unknown> = {
        ...s,
        keyId: chosenKey,
        seed,
      };
      if (s.timeId === "random" && eng.Theory.TIMES.length) {
        const idx = seed % eng.Theory.TIMES.length;
        genSettings.timeId = eng.Theory.TIMES[idx]?.id ?? "4/4";
      }

      const nextScore = s.duetEnabled
        ? eng.Generator.generateDuet(genSettings)
        : eng.Generator.generate(genSettings);

      const updatedSettings: BladlesingSettings = {
        ...s,
        keyId: chosenKey,
        keyIndex: (keyIdx + 1) % keys.length,
      };
      persistSettings(updatedSettings);
      scoreRef.current = nextScore;
      setScore(nextScore);
      renderCurrentScore(nextScore, updatedSettings);

      // Preload audio samples in background for zero-latency playback
      if (nextScore.isDuet) {
        void eng.AudioEngine.loadInstrument("trumpet").catch(() => {});
        void eng.AudioEngine.loadInstrument(updatedSettings.duetMalletInstrument || "xylo").catch(() => {});
      } else {
        void eng.AudioEngine.loadInstrument(updatedSettings.instrumentId).catch(() => {});
      }

      if (!opts?.skipBroadcast && !remoteCallRef.current && window.MusikkSync?.isController?.()) {
        window.MusikkSync.sightSeed(seed, compactSyncSettings(updatedSettings), updatedSettings.tempo);
      }
      return true;
    },
    [cancelAutoNext, clearFadedMeasures, persistSettings, renderCurrentScore],
  );

  const startMetroInternal = useCallback(() => {
    const eng = engineRef.current;
    if (!eng) return;
    cancelAutoNext();
    const spec = getMetroSpec();
    const countInBars = settingsRef.current.flowCountIn ? 1 : 0;
    setBeatsPerBar(spec.beats);
    practiceBeatRef.current = 0;
    const musicClicks =
      typeof eng.AudioEngine.scoreMusicClicks === "function"
        ? eng.AudioEngine.scoreMusicClicks(scoreRef.current, spec.beats)
        : 0;
    unlockPulse();
    eng.AudioEngine.setClicks(true);
    eng.AudioEngine.ac();
    setMetroOn(true);
    setMetroLabel(countInBars > 0 ? "1" : "Stopp");
    eng.ScoreRenderer.showBeat(beatMapRef.current, 0);
    eng.AudioEngine.startMetronome(spec.bpm, spec.beats, {
      subdiv: subdivRef.current,
      countIn: countInBars,
      musicClicks,
      onBeat: (i, count, fromClick, cue) => {
        if (!fromClick) {
          setActiveBeat(i);
          return;
        }
        if (eng.AudioEngine.isPlaying()) return;
        if (cue && cue.phase === "countin") {
          setActiveBeat(cue.beat);
          setCountInBeat(cue.beat + 1);
          setMetroLabel(String(cue.beat + 1));
          eng.ScoreRenderer.showBeat(beatMapRef.current, 0);
        } else {
          setCountInBeat(null);
          const beatIdx = cue ? cue.beat : practiceBeatRef.current;
          setActiveBeat(beatIdx % count);
          setMetroLabel("Stopp");
          if (beatMapRef.current.length) {
            eng.ScoreRenderer.showBeat(beatMapRef.current, Math.min(beatIdx, beatMapRef.current.length - 1));
          }
          fadeCompletedMeasures(beatIdx, count);
          practiceBeatRef.current = beatIdx + 1;
        }
      },
      done: () => {
        setMetroOn(false);
        setMetroLabel("Metronom");
        setCountInBeat(null);
        setActiveBeat(-1);
        clearFadedMeasures();
        eng.ScoreRenderer.clearBeat();
        if (settingsRef.current.flowAutoNext && !remoteCallRef.current) {
          generate();
          const raw = settingsRef.current.flowAutoNextDelay;
          const delay = [10, 20, 30].includes(raw) ? raw : 10;
          let left = delay;
          autoNextModeRef.current = "metro";
          setAutoNextLeft(left);
          autoNextTimerRef.current = window.setInterval(() => {
            left -= 1;
            if (left <= 0) {
              cancelAutoNext();
              startMetroInternal();
            } else {
              setAutoNextLeft(left);
            }
          }, 1000);
        }
      },
    });
  }, [cancelAutoNext, clearFadedMeasures, fadeCompletedMeasures, generate, getMetroSpec]);

  const startPlayInternal = useCallback(
    (forceGenerate = false) => {
      const eng = engineRef.current;
      if (!eng) return false;
      cancelAutoNext();
      if (!scoreRef.current || forceGenerate) {
        generate();
      }
      const sc = scoreRef.current;
      if (!sc) return false;
      resumeFromBladlesing();

      metroBeforePlayRef.current = eng.AudioEngine.isMetro();
      eng.AudioEngine.stopMetronome();
      unlockPulse();
      const s = settingsRef.current;
      const spec = getMetroSpec(s, sc);
      setBeatsPerBar(spec.beats);
      clearFadedMeasures();

      const countInBars = s.flowCountIn ? 1 : 0;
      const clicksOn = metroBeforePlayRef.current || countInBars > 0;
      setPlaying(true);
      setMetroOn(clicksOn);
      if (clicksOn) setMetroLabel("Metronom");

      eng.AudioEngine.playAlong(sc, {
        quarterBpm: s.tempo,
        clickBpm: spec.bpm,
        beatsPerBar: spec.beats,
        beatTicks: spec.beatTicks,
        subdiv: subdivRef.current,
        countIn: countInBars,
        clicks: clicksOn,
        muteTrumpet: !s.duetPlayTrumpet,
        muteMallets: !s.duetPlayMallets,
        onCue: (cue) => {
          if (cue.phase === "countin") {
            setActiveBeat(cue.beat);
            setCountInBeat(cue.beat + 1);
            eng.ScoreRenderer.showBeat(beatMapRef.current, 0);
          } else {
            setCountInBeat(null);
            setActiveBeat(cue.beat % cue.beats);
            if (beatMapRef.current.length) {
              eng.ScoreRenderer.showBeat(beatMapRef.current, Math.min(cue.beat, beatMapRef.current.length - 1));
            }
            fadeCompletedMeasures(cue.beat, cue.beats);
          }
        },
        done: () => {
          setPlaying(false);
          setCountInBeat(null);
          setActiveBeat(-1);
          clearFadedMeasures();
          eng.ScoreRenderer.clearBeat();
          if (metroBeforePlayRef.current) {
            startMetroInternal();
          } else {
            setMetroOn(false);
            setMetroLabel("Metronom");
          }

          // Sight-Reading Flow Mode: immediately load next etude, then count down scan time before auto-starting
          if (settingsRef.current.flowAutoNext && !remoteCallRef.current) {
            generate();
            const raw = settingsRef.current.flowAutoNextDelay;
            const delay = [10, 20, 30].includes(raw) ? raw : 10;
            let left = delay;
            autoNextModeRef.current = "play";
            setAutoNextLeft(left);
            autoNextTimerRef.current = window.setInterval(() => {
              left -= 1;
              if (left <= 0) {
                cancelAutoNext();
                startPlayInternal(false);
              } else {
                setAutoNextLeft(left);
              }
            }, 1000);
          }
        },
      });
      if (!clicksOn) {
        eng.AudioEngine.setClicks(false);
      }
      return true;
    },
    [cancelAutoNext, clearFadedMeasures, fadeCompletedMeasures, generate, getMetroSpec, startMetroInternal],
  );

  const startAutoNextNow = useCallback(() => {
    const mode = autoNextModeRef.current;
    cancelAutoNext();
    if (mode === "metro") {
      startMetroInternal();
    } else if (mode === "play") {
      startPlayInternal(false);
    }
  }, [cancelAutoNext, startMetroInternal, startPlayInternal]);

  const togglePlay = useCallback(() => {
    const eng = engineRef.current;
    if (!eng) return false;
    if (eng.AudioEngine.isPlaying()) {
      if (!remoteCallRef.current && window.MusikkSync?.isController?.()) {
        window.MusikkSync.sightAction("stopPlay");
      }
      const resume = metroBeforePlayRef.current;
      stopPlaybackOnly();
      if (resume) startMetroInternal();
      else {
        setMetroOn(false);
        setMetroLabel("Metronom");
      }
      return true;
    }
    if (!remoteCallRef.current && window.MusikkSync?.isController?.()) {
      resumeFromBladlesing();
      window.MusikkSync.sightAction("startPlay");
    }
    return startPlayInternal(false);
  }, [startMetroInternal, startPlayInternal, stopPlaybackOnly]);

  const toggleMetro = useCallback(() => {
    const eng = engineRef.current;
    if (!eng) return false;
    if (eng.AudioEngine.isPlaying()) {
      const nextOn = !metroOn;
      if (!remoteCallRef.current && window.MusikkSync?.isController?.()) {
        window.MusikkSync.sightAction(nextOn ? "startMetro" : "stopMetro");
      }
      setMetroOn(nextOn);
      eng.AudioEngine.setClicks(nextOn);
      return true;
    }
    if (eng.AudioEngine.isMetro()) {
      if (!remoteCallRef.current && window.MusikkSync?.isController?.()) {
        window.MusikkSync.sightAction("stopMetro");
      }
      eng.AudioEngine.stopMetronome();
      setMetroOn(false);
      setMetroLabel("Metronom");
      setCountInBeat(null);
      setActiveBeat(-1);
      clearFadedMeasures();
      eng.ScoreRenderer.clearBeat();
      return true;
    }
    if (!remoteCallRef.current && window.MusikkSync?.isController?.()) {
      window.MusikkSync.sightAction("startMetro");
    }
    startMetroInternal();
    return true;
  }, [clearFadedMeasures, metroOn, startMetroInternal]);

  const cycleSubdiv = useCallback(() => {
    const next: 1 | 2 | 4 = subdivRef.current === 1 ? 2 : subdivRef.current === 2 ? 4 : 1;
    setSubdivState(next);
    subdivRef.current = next;
    engineRef.current?.AudioEngine.setSubdiv(next);
    if (engineRef.current?.AudioEngine.isMetro()) {
      startMetroInternal();
    }
  }, [startMetroInternal]);

  const setTempo = useCallback(
    (bpm: number, broadcast = true) => {
      const clamped = Math.max(40, Math.min(180, Math.round(bpm)));
      const next = { ...settingsRef.current, tempo: clamped };
      persistSettings(next);
      engineRef.current?.AudioEngine.setTempo(clamped);
      if (broadcast && !remoteCallRef.current && window.MusikkSync?.isController?.()) {
        window.MusikkSync.setTempo(clamped);
      }
      return true;
    },
    [persistSettings],
  );

  const again = useCallback(() => {
    const slower = Math.max(40, Math.round(settingsRef.current.tempo * 0.9));
    setTempo(slower, true);
    if (!remoteCallRef.current && window.MusikkSync?.isController?.()) {
      window.MusikkSync.sightAction("again");
    }
    if (engineRef.current?.AudioEngine.isPlaying()) {
      stopPlaybackOnly();
    }
    startPlayInternal(false);
    return true;
  }, [setTempo, startPlayInternal, stopPlaybackOnly]);

  const setZoom = useCallback(
    (nextZoom: number) => {
      const clamped = clampZoom(nextZoom);
      if (clamped === settingsRef.current.zoom) return;
      const next = { ...settingsRef.current, zoom: clamped };
      persistSettings(next);
      renderCurrentScore(scoreRef.current, next);
    },
    [persistSettings, renderCurrentScore],
  );

  const updateSettings = useCallback(
    (patch: Partial<BladlesingSettings>, opts?: { regenerate?: boolean; rerender?: boolean }) => {
      const eng = engineRef.current;
      const next: BladlesingSettings = { ...settingsRef.current, ...patch };
      if (patch.instrumentId && patch.instrumentId !== settingsRef.current.instrumentId && eng) {
        const inst = eng.Theory.INSTRUMENTS.find((i) => i.id === patch.instrumentId);
        if (inst) {
          if (inst.id === "trumpet") {
            next.rangeLow = 60;
            next.rangeHigh = 72;
          } else if (inst.id === "mar50") {
            next.rangeLow = 36;
            next.rangeHigh = 84;
          } else if (inst.id === "mar43") {
            next.rangeLow = 45;
            next.rangeHigh = 84;
          } else {
            next.rangeLow = inst.low;
            next.rangeHigh = inst.high;
          }
        }
      }
      if (patch.duetMalletInstrument && patch.duetMalletInstrument !== settingsRef.current.duetMalletInstrument) {
        const r = defaultDuetMalletRange(eng, patch.duetMalletInstrument);
        next.duetRangeMalletLow = r.low;
        next.duetRangeMalletHigh = r.high;
      }
      if (patch.mallets !== undefined) {
        if (patch.mallets === 2 && (next.texture === "block" || next.texture === "chorale")) {
          next.texture = "mixed";
        } else if (patch.mallets >= 3 && next.texture === "doublestops") {
          next.texture = "mixed";
        }
      }
      persistSettings(next);
      if (opts?.regenerate) {
        generate({ customSettings: next });
      } else if (opts?.rerender) {
        renderCurrentScore(scoreRef.current, next);
      }
    },
    [generate, persistSettings, renderCurrentScore],
  );

  const applyLevel = useCallback(
    (levelNum: number) => {
      const next = applyLevelPreset(settingsRef.current, levelNum);
      persistSettings(next);
      generate({ customSettings: next });
    },
    [generate, persistSettings],
  );

  const stepLevel = useCallback(
    (dir: -1 | 1) => {
      const idx = detectLevelIndex(settingsRef.current);
      const target = idx < 0 ? 1 : idx + 1 + dir;
      if (target < 1 || target > LEVELS.length) return;
      applyLevel(target);
    },
    [applyLevel],
  );

  const applyRecipe = useCallback(
    (recipe: PracticeRecipe) => {
      const next = applyPracticeRecipe(settingsRef.current, recipe);
      persistSettings(next);
      generate({ customSettings: next });
    },
    [generate, persistSettings],
  );

  const setDuetViewPart = useCallback(
    (part: DuetViewPart) => {
      const next: BladlesingSettings = { ...settingsRef.current, duetViewPart: part };
      persistSettings(next);
      renderCurrentScore(scoreRef.current, next);
      if (!remoteCallRef.current && window.MusikkSync?.isDuetViewPaired?.()) {
        window.MusikkSync.sightDuetView(part);
      }
      return true;
    },
    [persistSettings, renderCurrentScore],
  );

  const toggleDuetPaired = useCallback(() => {
    setDuetViewPaired(!isDuetViewPaired());
  }, []);

  // Load engine once
  useEffect(() => {
    let cancelled = false;
    loadBladlesingEngine()
      .then((eng) => {
        if (cancelled) return;
        engineRef.current = eng;
        setEngine(eng);
        const validKeys = eng.Theory.KEYS.map((k) => k.id);
        const validInsts = eng.Theory.INSTRUMENTS.map((i) => i.id);
        const loaded = loadBladlesingSettings(profileRef.current, validKeys, validInsts);
        persistSettings(loaded);

        eng.AudioEngine.onHalt(() => {
          if (!remoteCallRef.current && window.MusikkSync?.isController?.()) {
            window.MusikkSync.sightAction("stopPlay");
            window.MusikkSync.sightAction("stopMetro");
          }
          setPlaying(false);
          setMetroOn(false);
          setMetroLabel("Metronom");
          setCountInBeat(null);
          setActiveBeat(-1);
          clearFadedMeasures();
          eng.ScoreRenderer.clearBeat();
        });

        generate({ customSettings: loaded, skipBroadcast: true });
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [clearFadedMeasures, generate, persistSettings]);

  // Switch settings cleanly when instrument profile changes
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;
    stopAll();
    const validKeys = eng.Theory.KEYS.map((k) => k.id);
    const validInsts = eng.Theory.INSTRUMENTS.map((i) => i.id);
    const loaded = loadBladlesingSettings(profile, validKeys, validInsts);
    persistSettings(loaded);
    generate({ customSettings: loaded, skipBroadcast: true });
  }, [profile, generate, persistSettings, stopAll]);

  // Subscribe to shared pulse (Øveplan yield banner)
  useEffect(() => {
    const syncYield = () => {
      setYielded(getPulseState().owner === "oveplan");
      setYieldColor(activeBlockColor());
    };
    syncYield();
    return subscribePulse(syncYield);
  }, []);

  // Re-render SVG responsively on container resize
  useEffect(() => {
    const el = scoreHostRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let raf = 0;
    let lastW = el.clientWidth;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      if (Math.abs(w - lastW) < 12) return;
      lastW = w;
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => {
        renderCurrentScore();
      });
    });
    ro.observe(el);
    return () => {
      window.cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [renderCurrentScore, scoreHostRef]);

  // Keyboard shortcuts when Bladlesing is mounted
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA")) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        generate();
      } else if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        again();
      } else if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        toggleMetro();
      } else if (e.key === "+" || e.key === "=") {
        setZoom(settingsRef.current.zoom + 0.1);
      } else if (e.key === "-") {
        setZoom(settingsRef.current.zoom - 0.1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [again, generate, setZoom, toggleMetro, togglePlay]);

  // Register window.MalletSight API for sync/bridge, oveplan, profile, and E2E tests
  useEffect(() => {
    const api = {
      mount: () => {},
      unmount: () => {
        stopAll();
      },
      isReady: () => Boolean(engineRef.current),
      setProfile: (nextProfile?: string) => {
        const eng = engineRef.current;
        if (!eng) return false;
        const p: InstrumentProfile = nextProfile === "trumpet" ? "trumpet" : "mallets";
        const loaded = loadBladlesingSettings(
          p,
          eng.Theory.KEYS.map((k) => k.id),
          eng.Theory.INSTRUMENTS.map((i) => i.id),
        );
        persistSettings(loaded);
        generate({ customSettings: loaded, skipBroadcast: true });
        return true;
      },
      setDuetEnabled: (on: boolean) => {
        updateSettings({ duetEnabled: Boolean(on) }, { regenerate: true });
        return true;
      },
      generate: () => {
        const sel = document.querySelector<HTMLSelectElement>("#measures");
        if (sel) {
          const val = Number(sel.value);
          if (Number.isFinite(val) && val > 0 && val !== settingsRef.current.measures) {
            return generate({ customSettings: { ...settingsRef.current, measures: val } });
          }
        }
        return generate();
      },
      getScore: () => scoreRef.current,
      getTempo: () => settingsRef.current.tempo,
      getSeed: () => seedRef.current,
      getSyncSettings: () => compactSyncSettings(settingsRef.current),
      applySeed: (payload: { seed: number; settings?: Record<string, unknown>; tempo?: number }) => {
        remoteCallRef.current = true;
        try {
          const merged: BladlesingSettings = {
            ...settingsRef.current,
            ...(payload.settings as Partial<BladlesingSettings> | undefined),
            ...(payload.tempo != null ? { tempo: payload.tempo } : {}),
          };
          return generate({ seed: payload.seed, customSettings: merged, skipBroadcast: true });
        } finally {
          remoteCallRef.current = false;
        }
      },
      applyScore: (incoming: unknown, tempo?: number) => {
        remoteCallRef.current = true;
        try {
          if (tempo != null) setTempo(tempo, false);
          scoreRef.current = incoming as GeneratedScore;
          setScore(incoming as GeneratedScore);
          renderCurrentScore(incoming as GeneratedScore, settingsRef.current);
          return true;
        } finally {
          remoteCallRef.current = false;
        }
      },
      getDuetViewPart: () => settingsRef.current.duetViewPart,
      setDuetViewPart: (part: DuetViewPart) => {
        remoteCallRef.current = true;
        try {
          return setDuetViewPart(part);
        } finally {
          remoteCallRef.current = false;
        }
      },
      togglePlay: () => {
        remoteCallRef.current = true;
        try {
          return togglePlay();
        } finally {
          remoteCallRef.current = false;
        }
      },
      toggleMetro: () => {
        remoteCallRef.current = true;
        try {
          return toggleMetro();
        } finally {
          remoteCallRef.current = false;
        }
      },
      startPlay: () => {
        remoteCallRef.current = true;
        try {
          if (engineRef.current?.AudioEngine.isPlaying()) return true;
          return startPlayInternal(false);
        } finally {
          remoteCallRef.current = false;
        }
      },
      stopPlay: () => {
        remoteCallRef.current = true;
        try {
          stopPlaybackOnly();
          return true;
        } finally {
          remoteCallRef.current = false;
        }
      },
      startMetro: () => {
        remoteCallRef.current = true;
        try {
          if (engineRef.current?.AudioEngine.isPlaying()) {
            setMetroOn(true);
            engineRef.current.AudioEngine.setClicks(true);
            return true;
          }
          if (!engineRef.current?.AudioEngine.isMetro()) startMetroInternal();
          return true;
        } finally {
          remoteCallRef.current = false;
        }
      },
      stopMetro: () => {
        remoteCallRef.current = true;
        try {
          if (engineRef.current?.AudioEngine.isPlaying()) {
            setMetroOn(false);
            engineRef.current.AudioEngine.setClicks(false);
            return true;
          }
          if (engineRef.current?.AudioEngine.isMetro()) {
            engineRef.current.AudioEngine.stopMetronome();
            setMetroOn(false);
            setMetroLabel("Metronom");
            setActiveBeat(-1);
            engineRef.current.ScoreRenderer.clearBeat();
          }
          return true;
        } finally {
          remoteCallRef.current = false;
        }
      },
      again: () => {
        remoteCallRef.current = true;
        try {
          return again();
        } finally {
          remoteCallRef.current = false;
        }
      },
      stopAll: () => {
        remoteCallRef.current = true;
        try {
          stopAll();
        } finally {
          remoteCallRef.current = false;
        }
      },
      setTempo: (bpm: number) => setTempo(bpm, false),
    };
    window.MalletSight = api;
    return () => {
      stopAll();
    };
  }, [
    again,
    generate,
    persistSettings,
    renderCurrentScore,
    setDuetViewPart,
    setTempo,
    startMetroInternal,
    startPlayInternal,
    stopAll,
    stopPlaybackOnly,
    toggleMetro,
    togglePlay,
    updateSettings,
  ]);

  const state: BladlesingControllerState = {
    ready: Boolean(engine),
    error,
    engine,
    profile,
    settings,
    score,
    playing,
    metroOn,
    metroLabel,
    subdiv,
    activeBeat,
    beatsPerBar,
    yielded,
    yieldColor,
    countInBeat,
    autoNextLeft,
    duetPaired,
    practiceLine: formatPracticeLine(engine, settings, score),
    levelIndex: detectLevelIndex(settings),
  };

  return {
    state,
    actions: {
      generate,
      togglePlay,
      toggleMetro,
      cycleSubdiv,
      setTempo,
      again,
      setZoom,
      updateSettings,
      applyLevel,
      stepLevel,
      applyRecipe,
      setDuetViewPart,
      toggleDuetPaired,
      cancelAutoNext,
      startAutoNextNow,
      stopAll,
      resetDefaults: () => {
        const next = profileRef.current === "trumpet" ? { ...DEFAULTS, instrumentId: "trumpet", clef: "treble", mallets: 1, texture: "melody", showSticking: true, rangeLow: 60, rangeHigh: 72, tempo: 76 } : { ...DEFAULTS };
        persistSettings(next);
        generate({ customSettings: next });
      },
    },
  };
}
