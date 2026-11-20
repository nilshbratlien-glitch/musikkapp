import {
  AudioWaveform,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  Minus,
  Plus,
  Square,
  Volume2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getProfile, getProfileVersion, subscribeProfile } from "@/lib/profile";
import { markAudioRouteStale } from "@/lib/pulse";
import {
  DEFAULT_A4_HZ,
  MAX_A4_HZ,
  MIN_A4_HZ,
  NOTE_NAMES_NB,
  PitchSmoother,
  TRANSPOSITION_OPTIONS,
  clampA4,
  detectPitchYin,
  freqToPitchReading,
  loadTunerSettings,
  midiToFrequency,
  midiToNorwegianLabel,
  saveTunerSettings,
  startTunerDrone,
  stopTunerDrone,
  updateTunerDronePitch,
  type DroneWave,
  type PitchReading,
  type TunerSettings,
  type TunerTransposition,
} from "@/lib/tuner";

interface TraceSample {
  t: number;
  cents: number | null;
}

const TRACE_WINDOW_MS = 6000;
const HOLD_READING_MS = 1800;

const QUICK_DRONE_NOTES: ReadonlyArray<{ label: string; midi: number }> = [
  { label: "A4", midi: 69 },
  { label: "B3", midi: 58 },
  { label: "C4", midi: 60 },
  { label: "F4", midi: 65 },
];

const GAUGE_TICKS: readonly number[] = [
  -50, -45, -40, -35, -30, -25, -20, -15, -10, -5, 0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50,
];

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const start = polar(cx, cy, r, startDeg);
  const end = polar(cx, cy, r, endDeg);
  const largeArc = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

function centsColor(cents: number | null): string {
  if (cents === null) return "var(--color-muted)";
  const abs = Math.abs(cents);
  if (abs <= 5) return "var(--color-ok)";
  if (abs <= 18) return "var(--color-accent)";
  return "var(--color-no)";
}

function formatCents(cents: number): string {
  const rounded = Math.round(cents);
  if (rounded === 0) return "0 ¢";
  return `${rounded > 0 ? "+" : ""}${rounded} ¢`;
}

export function TunerView() {
  useSyncExternalStore(subscribeProfile, getProfileVersion, getProfileVersion);
  const profile = getProfile();

  const [settings, setSettings] = useState<TunerSettings>(() => loadTunerSettings(profile));
  const [listening, setListening] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [reading, setReading] = useState<PitchReading | null>(null);
  const [isLiveSignal, setIsLiveSignal] = useState(false);
  const [inputLevel, setInputLevel] = useState(0);
  const [activeDroneMidi, setActiveDroneMidi] = useState<number | null>(null);
  const [standMode, setStandMode] = useState(false);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const profileRef = useRef(profile);
  profileRef.current = profile;

  const micCtxRef = useRef<AudioContext | null>(null);
  const micSessionRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const smootherRef = useRef(new PitchSmoother(0.28, 80));
  const lastLockAtRef = useRef<number>(0);
  const traceRef = useRef<TraceSample[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Reload profile-scoped tuner settings when switching between Slagverk & B-trompet
  useEffect(() => {
    const loaded = loadTunerSettings(profile);
    setSettings(loaded);
    settingsRef.current = loaded;
  }, [profile]);

  const updateSettings = useCallback((patch: Partial<TunerSettings>) => {
    setSettings((prev) => {
      const next: TunerSettings = {
        ...prev,
        ...patch,
        a4Hz: patch.a4Hz !== undefined ? clampA4(patch.a4Hz) : prev.a4Hz,
      };
      settingsRef.current = next;
      saveTunerSettings(next, profileRef.current);
      return next;
    });
  }, []);

  // Keep active drone frequency synced if A4 calibration changes while playing
  useEffect(() => {
    if (activeDroneMidi !== null) {
      updateTunerDronePitch(activeDroneMidi, settings.a4Hz);
    }
  }, [activeDroneMidi, settings.a4Hz]);

  // Escape key exits Notestativ-modus
  useEffect(() => {
    if (!standMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setStandMode(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [standMode]);

  // Screen Wake Lock while Tuner microphone or fullscreen stand mode is active
  useEffect(() => {
    if (!listening && !standMode) return;
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let sentinel: { release: () => Promise<void> } | null = null;
    let disposed = false;

    const acquire = () => {
      if (disposed || document.visibilityState !== "visible") return;
      const wl = (
        navigator as Navigator & {
          wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> };
        }
      ).wakeLock;
      if (!wl) return;
      void wl
        .request("screen")
        .then((s) => {
          if (disposed) void s.release().catch(() => {});
          else sentinel = s;
        })
        .catch(() => {});
    };

    acquire();
    const onVis = () => {
      if (document.visibilityState === "visible") acquire();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVis);
      if (sentinel) {
        void sentinel.release().catch(() => {});
        sentinel = null;
      }
    };
  }, [listening, standMode]);

  const drawTrace = useCallback((now: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.save();
    ctx.scale(dpr, dpr);
    const width = rect.width;
    const height = rect.height;
    ctx.clearRect(0, 0, width, height);

    const styles = getComputedStyle(document.documentElement);
    const lineCol = styles.getPropertyValue("--color-line").trim() || "#2a3447";
    const okCol = styles.getPropertyValue("--color-ok").trim() || "#22c55e";
    const accentCol = styles.getPropertyValue("--color-accent").trim() || "#3b82f6";
    const noCol = styles.getPropertyValue("--color-no").trim() || "#ef4444";
    const mutedCol = styles.getPropertyValue("--color-muted").trim() || "#94a3b8";

    const yForCents = (c: number) => height / 2 - (Math.max(-50, Math.min(50, c)) / 50) * (height * 0.42);

    // Green ±5 cents target corridor
    const yTop = yForCents(5);
    const yBot = yForCents(-5);
    ctx.fillStyle = okCol;
    ctx.globalAlpha = 0.12;
    ctx.fillRect(0, yTop, width, yBot - yTop);
    ctx.globalAlpha = 1;

    // Guide lines: +25, 0, -25
    ctx.lineWidth = 1;
    for (const refCents of [-25, 0, 25]) {
      const y = yForCents(refCents);
      ctx.beginPath();
      ctx.strokeStyle = refCents === 0 ? okCol : lineCol;
      ctx.globalAlpha = refCents === 0 ? 0.55 : 0.7;
      ctx.setLineDash(refCents === 0 ? [] : [4, 4]);
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // Right-hand subtle scale labels
    ctx.font = "600 10px Outfit, system-ui, sans-serif";
    ctx.fillStyle = mutedCol;
    ctx.textAlign = "right";
    ctx.fillText("+25¢", width - 6, yForCents(25) - 3);
    ctx.fillText("0", width - 6, yForCents(0) - 3);
    ctx.fillText("-25¢", width - 6, yForCents(-25) + 11);

    // Prune and plot live cents trace
    const cutoff = now - TRACE_WINDOW_MS;
    const samples = traceRef.current;
    while (samples.length > 0 && samples[0]!.t < cutoff) samples.shift();

    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (let i = 1; i < samples.length; i++) {
      const prev = samples[i - 1]!;
      const cur = samples[i]!;
      if (prev.cents === null || cur.cents === null) continue;
      if (cur.t - prev.t > 260) continue;
      const x1 = ((prev.t - cutoff) / TRACE_WINDOW_MS) * width;
      const x2 = ((cur.t - cutoff) / TRACE_WINDOW_MS) * width;
      const y1 = yForCents(prev.cents);
      const y2 = yForCents(cur.cents);
      const abs = Math.abs(cur.cents);
      ctx.strokeStyle = abs <= 5 ? okCol : abs <= 18 ? accentCol : noCol;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    // Current dot at right edge
    const last = samples[samples.length - 1];
    if (last && last.cents !== null && now - last.t < 240) {
      const x = ((last.t - cutoff) / TRACE_WINDOW_MS) * width;
      const y = yForCents(last.cents);
      const abs = Math.abs(last.cents);
      ctx.fillStyle = abs <= 5 ? okCol : abs <= 18 ? accentCol : noCol;
      ctx.beginPath();
      ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }, []);

  const stopMic = useCallback(() => {
    micSessionRef.current += 1;
    const hadMic = Boolean(streamRef.current || micCtxRef.current || rafRef.current !== null);
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    try {
      sourceRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      analyserRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    sourceRef.current = null;
    analyserRef.current = null;
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        try {
          track.stop();
        } catch {
          /* ignore */
        }
      }
      streamRef.current = null;
    }
    if (micCtxRef.current) {
      const toClose = micCtxRef.current;
      micCtxRef.current = null;
      void toClose.close().catch(() => {});
    }
    if (hadMic) {
      try {
        const nav = navigator as Navigator & { audioSession?: { type: string } };
        if (nav.audioSession) nav.audioSession.type = "playback";
      } catch {
        /* ignore */
      }
      // Android/iOS switches hardware audio routing back from capture to media mode after closing mic.
      // Marking the shared playback AudioContext stale ensures the next sound tap gets a fresh media route.
      markAudioRouteStale();
    }
    smootherRef.current.reset();
    setListening(false);
    setIsLiveSignal(false);
    setInputLevel(0);
  }, []);

  const startMic = useCallback(async () => {
    setMicError(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setMicError("Nettleseren støtter ikke mikrofontilgang i denne visningen.");
      return;
    }
    const AudioCtx =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) {
      setMicError("Kunne ikke starte lydmotoren.");
      return;
    }

    // Stop any playing drone before opening the mic so Bluetooth doesn't collide between A2DP and HFP.
    stopTunerDrone();
    setActiveDroneMidi(null);

    const session = ++micSessionRef.current;
    try {
      // Prefer the tablet's built-in microphone over a Bluetooth headset mic so Bluetooth stays in media mode.
      let preferredDeviceId: string | undefined;
      if (typeof navigator.mediaDevices.enumerateDevices === "function") {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const inputs = devices.filter((d) => d.kind === "audioinput" && d.deviceId && d.deviceId !== "default");
          const isBluetooth = (label: string) => /bluetooth|headset|hands-free|handsfree|airpods|buds|sco|hfp/i.test(label);
          const builtin = inputs.find((d) => d.label && !isBluetooth(d.label));
          if (builtin) preferredDeviceId = builtin.deviceId;
        } catch {
          /* ignore */
        }
      }

      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
        ...(preferredDeviceId ? { deviceId: { ideal: preferredDeviceId } } : {}),
      };

      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      if (session !== micSessionRef.current) {
        for (const track of stream.getTracks()) {
          try {
            track.stop();
          } catch {
            /* ignore */
          }
        }
        return;
      }

      // Dedicated capture-only AudioContext so mic lifecycle never disrupts shared playback audio.
      const micCtx = new AudioCtx();
      micCtxRef.current = micCtx;
      if (micCtx.state !== "running") {
        await micCtx.resume().catch(() => {});
      }
      if (session !== micSessionRef.current) {
        for (const track of stream.getTracks()) {
          try {
            track.stop();
          } catch {
            /* ignore */
          }
        }
        void micCtx.close().catch(() => {});
        return;
      }

      const source = micCtx.createMediaStreamSource(stream);
      const analyser = micCtx.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0;
      source.connect(analyser);

      streamRef.current = stream;
      sourceRef.current = source;
      analyserRef.current = analyser;
      smootherRef.current.reset();
      traceRef.current = [];
      setListening(true);

      const buf = new Float32Array(analyser.fftSize);
      const tick = () => {
        const an = analyserRef.current;
        const cap = micCtxRef.current;
        if (!an || !cap || session !== micSessionRef.current) return;
        an.getFloatTimeDomainData(buf);
        const now = performance.now();

        let sumSq = 0;
        for (let i = 0; i < buf.length; i++) sumSq += buf[i]! * buf[i]!;
        const rms = Math.sqrt(sumSq / buf.length);
        setInputLevel(Math.min(1, rms * 6));

        const detected = detectPitchYin(buf, cap.sampleRate, {
          minHz: 32,
          maxHz: 2200,
          minRms: 0.012,
          threshold: 0.15,
        });

        if (detected) {
          const smoothedHz = smootherRef.current.push(detected.hz);
          const curSettings = settingsRef.current;
          const nextReading = freqToPitchReading(smoothedHz, curSettings.a4Hz, curSettings.transposition);
          if (nextReading) {
            lastLockAtRef.current = now;
            setReading(nextReading);
            setIsLiveSignal(true);
            traceRef.current.push({ t: now, cents: nextReading.cents });
          }
        } else {
          setIsLiveSignal(false);
          traceRef.current.push({ t: now, cents: null });
          if (lastLockAtRef.current > 0 && now - lastLockAtRef.current > HOLD_READING_MS) {
            smootherRef.current.reset();
          }
        }

        drawTrace(now);
        rafRef.current = window.requestAnimationFrame(tick);
      };

      rafRef.current = window.requestAnimationFrame(tick);
    } catch (err) {
      if (session === micSessionRef.current) {
        stopMic();
        const msg = err instanceof Error ? err.name : "";
        if (msg === "NotAllowedError" || msg === "PermissionDeniedError") {
          setMicError("Mikrofontilgang ble avslått. Gi tilgang til mikrofon i nettleseren og prøv igjen.");
        } else if (msg === "NotFoundError") {
          setMicError("Fant ingen mikrofon på denne enheten.");
        } else {
          setMicError("Kunne ikke åpne mikrofonen. Sjekk tilgang og prøv igjen.");
        }
      }
    }
  }, [drawTrace, stopMic]);

  // Draw empty trace grid on mount & resize
  useEffect(() => {
    drawTrace(performance.now());
    const onResize = () => drawTrace(performance.now());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [drawTrace]);

  // Release microphone and drone cleanly when leaving /tuner
  useEffect(() => {
    return () => {
      stopMic();
      stopTunerDrone();
    };
  }, [stopMic]);

  const handleToggleDrone = useCallback(
    (midi: number) => {
      if (activeDroneMidi === midi) {
        stopTunerDrone();
        setActiveDroneMidi(null);
        return;
      }
      // Ensure mic capture is stopped before playing drone so Bluetooth stays on A2DP media audio.
      if (streamRef.current || micCtxRef.current) {
        stopMic();
      }
      if (startTunerDrone(midi, settingsRef.current.a4Hz, settingsRef.current.droneWave)) {
        setActiveDroneMidi(midi);
      }
    },
    [activeDroneMidi, stopMic],
  );

  const handleStopDrone = useCallback(() => {
    stopTunerDrone();
    setActiveDroneMidi(null);
  }, []);

  const handleWaveChange = useCallback(
    (wave: DroneWave) => {
      updateSettings({ droneWave: wave });
      if (activeDroneMidi !== null) {
        startTunerDrone(activeDroneMidi, settingsRef.current.a4Hz, wave);
      }
    },
    [activeDroneMidi, updateSettings],
  );

  const handleOctaveChange = useCallback(
    (oct: 3 | 4 | 5) => {
      updateSettings({ droneOctave: oct });
      if (activeDroneMidi !== null) {
        const pc = ((activeDroneMidi % 12) + 12) % 12;
        const shiftedMidi = (oct + 1) * 12 + pc;
        if (startTunerDrone(shiftedMidi, settingsRef.current.a4Hz, settingsRef.current.droneWave)) {
          setActiveDroneMidi(shiftedMidi);
        }
      }
    },
    [activeDroneMidi, updateSettings],
  );

  const needleCents = reading ? reading.cents : 0;
  const needleAngle = (needleCents / 50) * 68;
  const activeColor = reading ? centsColor(reading.cents) : "var(--color-muted)";
  const statusKind: "idle" | "flat" | "in" | "sharp" = !reading
    ? "idle"
    : reading.inTune
      ? "in"
      : reading.cents < 0
        ? "flat"
        : "sharp";

  const droneLabel = activeDroneMidi !== null ? midiToNorwegianLabel(activeDroneMidi).full : null;
  const droneHz = activeDroneMidi !== null ? midiToFrequency(activeDroneMidi, settings.a4Hz) : null;

  return (
    <div
      className={
        standMode
          ? "fixed inset-0 z-30 flex h-full min-h-0 flex-col overflow-y-auto bg-bg px-4 py-3 text-fg"
          : "flex w-full flex-col gap-3 pb-4 text-fg"
      }
    >
      {/* Compact top control bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line bg-surface px-3.5 py-2.5 shadow-[var(--shadow-card)]">
        {/* Mic control + live input meter */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => (listening ? stopMic() : void startMic())}
            aria-pressed={listening}
            className={
              listening
                ? "metro-press inline-flex min-h-10 items-center gap-2 rounded-xl border border-ok bg-[rgb(var(--color-ok-rgb)/0.15)] px-4 text-sm font-bold text-ok"
                : "metro-press inline-flex min-h-10 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-bold text-accent-fg shadow-xs"
            }
          >
            {listening ? (
              <MicOff className="size-4" aria-hidden="true" />
            ) : (
              <Mic className="size-4" aria-hidden="true" />
            )}
            <span>{listening ? "Stopp mikrofon" : "Start mikrofon"}</span>
          </button>

          {/* Compact input level meter */}
          <div className="hidden items-center gap-1.5 sm:flex" aria-hidden="true">
            <AudioWaveform className={isLiveSignal ? "size-4 text-ok" : "size-4 text-muted"} />
            <div className="h-2 w-20 overflow-hidden rounded-full bg-line">
              <div
                className="h-full rounded-full transition-[width] duration-75"
                style={{
                  width: `${Math.round(inputLevel * 100)}%`,
                  background: isLiveSignal ? "var(--color-ok)" : "var(--color-accent)",
                }}
              />
            </div>
          </div>
        </div>

        {/* Right controls: A4 calibration, Transposition, Fullscreen */}
        <div className="flex flex-wrap items-center gap-2">
          {/* A4 Calibration */}
          <div className="inline-flex items-center gap-1 rounded-xl border border-line bg-header p-1" role="group" aria-label="Kammertone A4">
            <span className="px-1.5 text-[11px] font-bold tracking-wider text-muted uppercase">A4</span>
            {([440, 442] as const).map((hz) => {
              const active = settings.a4Hz === hz;
              return (
                <button
                  key={hz}
                  type="button"
                  aria-pressed={active}
                  onClick={() => updateSettings({ a4Hz: hz })}
                  className={
                    active
                      ? "metro-press min-h-8 rounded-lg border border-accent bg-[rgb(var(--color-accent-rgb)/0.14)] px-2.5 text-xs font-bold text-accent tabular-nums"
                      : "metro-press min-h-8 rounded-lg px-2 text-xs font-medium text-muted hover:text-fg tabular-nums"
                  }
                >
                  {hz}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => updateSettings({ a4Hz: settings.a4Hz - 1 })}
              disabled={settings.a4Hz <= MIN_A4_HZ}
              aria-label="Senk A4 med 1 Hz"
              className="metro-press flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface hover:text-fg disabled:opacity-40"
            >
              <Minus className="size-3.5" aria-hidden="true" />
            </button>
            <span
              data-tuner-a4
              className="min-w-12 text-center text-xs font-bold text-fg tabular-nums"
            >
              {settings.a4Hz} Hz
            </span>
            <button
              type="button"
              onClick={() => updateSettings({ a4Hz: settings.a4Hz + 1 })}
              disabled={settings.a4Hz >= MAX_A4_HZ}
              aria-label="Øk A4 med 1 Hz"
              className="metro-press flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface hover:text-fg disabled:opacity-40"
            >
              <Plus className="size-3.5" aria-hidden="true" />
            </button>
          </div>

          {/* Transposition */}
          <div className="inline-flex items-center gap-1 rounded-xl border border-line bg-header p-1" role="group" aria-label="Transponering">
            {TRANSPOSITION_OPTIONS.map((opt) => {
              const active = settings.transposition === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  title={opt.description}
                  aria-pressed={active}
                  onClick={() => updateSettings({ transposition: opt.id as TunerTransposition })}
                  className={
                    active
                      ? "metro-press min-h-8 min-w-8 rounded-lg border border-accent bg-[rgb(var(--color-accent-rgb)/0.14)] px-2.5 text-xs font-bold text-accent"
                      : "metro-press min-h-8 min-w-8 rounded-lg px-2 text-xs font-medium text-muted hover:text-fg"
                  }
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {/* Fullscreen / Notestativ-modus */}
          <button
            type="button"
            onClick={() => setStandMode((s) => !s)}
            aria-pressed={standMode}
            aria-label={standMode ? "Avslutt notestativ-modus" : "Notestativ-modus (fullskjerm)"}
            title={standMode ? "Avslutt fullskjerm (Esc)" : "Notestativ-modus (fullskjerm)"}
            className={
              standMode
                ? "metro-press hidden size-10 items-center justify-center rounded-xl border border-accent bg-[rgb(var(--color-accent-rgb)/0.12)] text-accent sm:inline-flex"
                : "metro-press hidden size-10 items-center justify-center rounded-xl border border-line bg-header text-muted hover:text-fg sm:inline-flex"
            }
          >
            {standMode ? (
              <Minimize2 className="size-4" aria-hidden="true" />
            ) : (
              <Maximize2 className="size-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {micError ? (
        <div
          role="alert"
          className="rounded-xl border border-[rgb(var(--color-no-rgb)/0.4)] bg-[rgb(var(--color-no-rgb)/0.1)] px-4 py-2.5 text-sm font-medium text-no"
        >
          {micError}
        </div>
      ) : null}

      {/* Main 13" 16:10 2-column studio grid */}
      <div className="grid w-full flex-1 gap-3 lg:grid-cols-[minmax(0,1.45fr)_minmax(340px,1fr)]">
        {/* LEFT HERO: Chromatic Arc Gauge + Note Readout + Intonation Trace */}
        <section
          aria-label="Kromatisk tuner"
          className="flex flex-col justify-between gap-3 rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-card)] sm:p-5"
        >
          {/* Status pills row */}
          <div className="flex items-center justify-between gap-2">
            <span
              className={
                statusKind === "flat"
                  ? "rounded-full border border-[rgb(var(--color-no-rgb)/0.45)] bg-[rgb(var(--color-no-rgb)/0.12)] px-3 py-1 text-xs font-bold text-no"
                  : "rounded-full border border-line bg-header px-3 py-1 text-xs font-medium text-muted"
              }
            >
              ♭ For lav
            </span>

            <span
              className={
                statusKind === "in"
                  ? "rounded-full border border-ok bg-[rgb(var(--color-ok-rgb)/0.15)] px-3.5 py-1 text-xs font-bold text-ok"
                  : "rounded-full border border-line bg-header px-3.5 py-1 text-xs font-semibold text-muted"
              }
            >
              {statusKind === "in"
                ? "I stemme"
                : listening
                  ? "Lytter…"
                  : "Klar · trykk Start mikrofon"}
            </span>

            <span
              className={
                statusKind === "sharp"
                  ? "rounded-full border border-[rgb(var(--color-no-rgb)/0.45)] bg-[rgb(var(--color-no-rgb)/0.12)] px-3 py-1 text-xs font-bold text-no"
                  : "rounded-full border border-line bg-header px-3 py-1 text-xs font-medium text-muted"
              }
            >
              For høy ♯
            </span>
          </div>

          {/* Precision SVG Arc Gauge + Note Readout */}
          <div className="flex flex-col items-center">
            <svg
              viewBox="0 0 420 215"
              className="w-full max-w-[460px] select-none"
              role="img"
              aria-label={
                reading
                  ? `Tuner viser ${reading.label}, ${formatCents(reading.cents)}`
                  : "Tuner venter på tone"
              }
            >
              {/* Background arc */}
              <path
                d={arcPath(210, 200, 156, -68, 68)}
                fill="none"
                stroke="var(--color-line)"
                strokeWidth="12"
                strokeLinecap="round"
              />

              {/* Green ±5 cents sweet spot corridor */}
              <path
                d={arcPath(210, 200, 156, -6.8, 6.8)}
                fill="none"
                stroke="var(--color-ok)"
                strokeWidth="12"
                strokeLinecap="round"
                opacity="0.7"
              />

              {/* Graduated ticks */}
              {GAUGE_TICKS.map((c) => {
                const deg = (c / 50) * 68;
                const isMajor = c % 25 === 0 || c === 0;
                const inner = polar(210, 200, isMajor ? 132 : 140, deg);
                const outer = polar(210, 200, 148, deg);
                const lbl = polar(210, 200, 178, deg);
                return (
                  <g key={c}>
                    <line
                      x1={inner.x}
                      y1={inner.y}
                      x2={outer.x}
                      y2={outer.y}
                      stroke={c === 0 ? "var(--color-ok)" : "var(--color-muted)"}
                      strokeWidth={c === 0 ? 3 : isMajor ? 2 : 1.25}
                      strokeLinecap="round"
                      opacity={c === 0 ? 1 : 0.65}
                    />
                    {c === -50 || c === -25 || c === 0 || c === 25 || c === 50 ? (
                      <text
                        x={lbl.x}
                        y={lbl.y}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill={c === 0 ? "var(--color-ok)" : "var(--color-muted)"}
                        fontSize="11"
                        fontWeight={c === 0 ? "700" : "600"}
                      >
                        {c === 0 ? "0" : c > 0 ? `+${c}` : `${c}`}
                      </text>
                    ) : null}
                  </g>
                );
              })}

              {/* Smooth rotating needle */}
              <g
                style={{
                  transform: `rotate(${needleAngle.toFixed(2)}deg)`,
                  transformOrigin: "210px 200px",
                  transition: "transform 70ms ease-out",
                  opacity: reading ? (isLiveSignal ? 1 : 0.5) : 0.25,
                }}
              >
                <line
                  x1="210"
                  y1="200"
                  x2="210"
                  y2="54"
                  stroke={activeColor}
                  strokeWidth="4.5"
                  strokeLinecap="round"
                />
                <circle cx="210" cy="54" r="6" fill={activeColor} />
              </g>
              <circle cx="210" cy="200" r="10" fill="var(--color-surface)" stroke={activeColor} strokeWidth="3.5" />
            </svg>

            {/* Giant Tabular Note Readout */}
            <div className="-mt-1 flex flex-col items-center">
              <div
                className="flex items-baseline gap-1 font-bold tracking-tight tabular-nums transition-opacity"
                style={{
                  color: activeColor,
                  opacity: reading ? (isLiveSignal ? 1 : 0.6) : 0.45,
                }}
              >
                <span className="text-6xl leading-none sm:text-7xl">{reading ? reading.noteName : "–"}</span>
                {reading ? <span className="text-2xl font-semibold sm:text-3xl">{reading.octave}</span> : null}
              </div>

              <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-xs font-semibold tabular-nums sm:text-sm">
                <span className="rounded-lg border border-line bg-header px-2.5 py-1 text-fg">
                  {reading ? `${reading.hz.toFixed(1)} Hz` : `A4 = ${settings.a4Hz} Hz`}
                </span>
                <span
                  className="rounded-lg border border-line bg-header px-2.5 py-1"
                  style={{ color: activeColor }}
                >
                  {reading ? formatCents(reading.cents) : "±0 ¢"}
                </span>
                {reading && settings.transposition !== "C" ? (
                  <span className="rounded-lg border border-[rgb(var(--color-accent-rgb)/0.4)] bg-[rgb(var(--color-accent-rgb)/0.1)] px-2.5 py-1 text-accent">
                    Klinger {reading.concertLabel}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          {/* 6-second Live Intonation Trace */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-medium text-muted">
              <span className="font-bold tracking-wider text-accent uppercase">Intonasjonsgraf (6 sek)</span>
              <span>Grønt felt = ±5 cent</span>
            </div>
            <div className="h-24 w-full overflow-hidden rounded-xl border border-line bg-header sm:h-28">
              <canvas ref={canvasRef} className="block h-full w-full" aria-label="Intonasjonsgraf over tid" />
            </div>
          </div>
        </section>

        {/* RIGHT COLUMN: Chromatic Reference Drone Pad */}
        <section
          aria-label="Referansetone"
          className="flex flex-col justify-between gap-3 rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-card)] sm:p-5"
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-xs font-bold tracking-wider text-accent uppercase">Referansetone (Drone)</h2>
                <p className="text-xs text-muted">
                  {droneLabel && droneHz
                    ? `Spiller ${droneLabel} · ${droneHz.toFixed(1)} Hz`
                    : "Trykk en tone for å stemme på gehør"}
                </p>
              </div>
              {activeDroneMidi !== null ? (
                <button
                  type="button"
                  onClick={handleStopDrone}
                  className="metro-press inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-[rgb(var(--color-no-rgb)/0.45)] bg-[rgb(var(--color-no-rgb)/0.12)] px-3 text-xs font-bold text-no"
                >
                  <Square className="size-3 fill-current" aria-hidden="true" />
                  <span>Stopp lyd</span>
                </button>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-lg border border-line bg-header px-2.5 py-1 text-[11px] font-semibold text-muted">
                  <Volume2 className="size-3.5" aria-hidden="true" />
                  <span>Klingende</span>
                </span>
              )}
            </div>

            {/* Quick common tuning notes */}
            <div className="space-y-1">
              <span className="block text-[11px] font-medium text-muted">Hurtigvalg (korps & orkester)</span>
              <div className="grid grid-cols-4 gap-1.5">
                {QUICK_DRONE_NOTES.map((item) => {
                  const active = activeDroneMidi === item.midi;
                  return (
                    <button
                      key={item.label}
                      type="button"
                      aria-pressed={active}
                      onClick={() => handleToggleDrone(item.midi)}
                      className={
                        active
                          ? "metro-press min-h-10 rounded-xl border border-ok bg-[rgb(var(--color-ok-rgb)/0.15)] text-xs font-bold text-ok"
                          : "metro-press min-h-10 rounded-xl border border-line bg-header text-xs font-semibold text-fg hover:border-[rgb(var(--color-accent-rgb)/0.5)]"
                      }
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 12-note Chromatic Pad Grid (4x3) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-medium text-muted">
                <span>Kromatisk tastatur (oktav {settings.droneOctave})</span>
                <span className="tabular-nums">A4 = {settings.a4Hz} Hz</span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {NOTE_NAMES_NB.map((name, pc) => {
                  const midi = (settings.droneOctave + 1) * 12 + pc;
                  const hz = midiToFrequency(midi, settings.a4Hz);
                  const active = activeDroneMidi === midi;
                  return (
                    <button
                      key={name}
                      type="button"
                      data-drone-note={`${name}${settings.droneOctave}`}
                      aria-pressed={active}
                      onClick={() => handleToggleDrone(midi)}
                      className={
                        active
                          ? "metro-press flex min-h-16 flex-col items-center justify-center rounded-xl border border-accent bg-[rgb(var(--color-accent-rgb)/0.14)] px-2 py-2 text-accent shadow-xs"
                          : "metro-press flex min-h-16 flex-col items-center justify-center rounded-xl border border-line bg-header px-2 py-2 text-fg hover:border-[rgb(var(--color-accent-rgb)/0.5)]"
                      }
                    >
                      <span className="text-base font-bold leading-tight">
                        {name}
                        <span className="text-xs font-semibold opacity-75">{settings.droneOctave}</span>
                      </span>
                      <span className="mt-0.5 text-[11px] font-medium text-muted tabular-nums">
                        {hz.toFixed(0)} Hz
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Bottom Drone Controls: Octave + Timbre */}
          <div className="grid grid-cols-2 gap-2 border-t border-line pt-3">
            <div className="space-y-1">
              <span className="block text-[11px] font-medium text-muted">Oktav</span>
              <div className="grid grid-cols-3 gap-1" role="group" aria-label="Drone-oktav">
                {([3, 4, 5] as const).map((oct) => {
                  const active = settings.droneOctave === oct;
                  return (
                    <button
                      key={oct}
                      type="button"
                      aria-pressed={active}
                      onClick={() => handleOctaveChange(oct)}
                      className={
                        active
                          ? "metro-press min-h-9 rounded-lg border border-accent bg-[rgb(var(--color-accent-rgb)/0.14)] text-xs font-bold text-accent"
                          : "metro-press min-h-9 rounded-lg border border-line bg-header text-xs font-medium text-muted hover:text-fg"
                      }
                    >
                      {oct}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1">
              <span className="block text-[11px] font-medium text-muted">Klang</span>
              <div className="grid grid-cols-2 gap-1" role="group" aria-label="Drone-klang">
                {(
                  [
                    ["triangle", "Varm"],
                    ["sine", "Ren"],
                  ] as const
                ).map(([wave, label]) => {
                  const active = settings.droneWave === wave;
                  return (
                    <button
                      key={wave}
                      type="button"
                      aria-pressed={active}
                      onClick={() => handleWaveChange(wave)}
                      className={
                        active
                          ? "metro-press min-h-9 rounded-lg border border-accent bg-[rgb(var(--color-accent-rgb)/0.14)] text-xs font-bold text-accent"
                          : "metro-press min-h-9 rounded-lg border border-line bg-header text-xs font-medium text-muted hover:text-fg"
                      }
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {settings.a4Hz !== DEFAULT_A4_HZ ? (
            <p className="text-center text-[11px] text-muted">
              Standard kammertone er {DEFAULT_A4_HZ} Hz — nå stilt til {settings.a4Hz} Hz.
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
