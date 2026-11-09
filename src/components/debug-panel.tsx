import { useEffect, useState } from "react";
import { getLastResume, getPlanClock, subscribePlanClock } from "@/lib/plan-clock";

const KEY = "musikkapp.debug";

/** ?debug=1 turns the panel on (and remembers it for the session), ?debug=0 turns it off. */
function wanted() {
  try {
    const flag = new URLSearchParams(window.location.search).get("debug");
    if (flag === "1") sessionStorage.setItem(KEY, "1");
    if (flag === "0") sessionStorage.removeItem(KEY);
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return new URLSearchParams(window.location.search).get("debug") === "1";
  }
}

/** Safari's `stack` has no message line, so name and message come first. */
function reasonText(reason: unknown) {
  const error = reason as { name?: string; message?: string; stack?: string } | null;
  if (!error || typeof error !== "object") return String(reason);
  return `${error.name ?? "Error"}: ${error.message ?? ""} ${String(error.stack ?? "").replace(/\s+/g, " ")}`;
}

type Failure = { at: number; text: string };
let lastError: Failure | null = null;
/** Registered at load whether or not the panel is on, so a failure before ?debug=1 shows is not lost. */
if (typeof window !== "undefined") {
  const note = (text: string) => (lastError = { at: Date.now(), text: text.slice(0, 300) });
  window.addEventListener("error", (event) => note(`${event.message} (${String(event.filename).replace(location.origin, "")}:${event.lineno}:${event.colno})`));
  window.addEventListener("unhandledrejection", (event) => note(`unhandledrejection: ${reasonText(event.reason)}`));
}

type Taps = { events: string[]; count: number; lastAt: number; hit: string };
const taps: Taps = { events: [], count: 0, lastAt: 0, hit: "" };

/** Record what reaches #btnPlay (click, touch, pointer) and what sits on top of it at that moment. */
function listenForPlay() {
  const record = (event: Event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = document.querySelector("#btnPlay");
    if (!button || !target || !(target === button || button.contains(target))) return;
    taps.events = [...taps.events.filter((name) => name !== event.type), event.type];
    if (event.type === "click") {
      taps.count += 1;
      taps.lastAt = Date.now();
    }
    const box = button.getBoundingClientRect();
    const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    taps.hit = top ? (top === button || button.contains(top) ? "btnPlay" : `${top.tagName}#${top.id}.${String(top.className).slice(0, 30)}`) : "none";
  };
  const types = ["pointerdown", "touchstart", "touchend", "click"];
  for (const type of types) document.addEventListener(type, record, true);
  return () => types.forEach((type) => document.removeEventListener(type, record, true));
}

async function fetchProbe(cache: RequestCache) {
  try {
    const text = await (await fetch("/malletsight/app.js", { cache })).text();
    return `${text.includes("resumeFromBladlesing") ? "har" : "MANGLER"} resumeFromBladlesing (${text.length} B)`;
  } catch (error) {
    return `feil ${String(error)}`;
  }
}

type Info = Record<string, string>;

async function collect(): Promise<Info> {
  const clock = getPlanClock();
  const last = getLastResume();
  const registration = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
  const caches_ = "caches" in window ? await caches.keys() : [];
  const script = document.querySelector<HTMLScriptElement>('script[data-ms$="app.js"]');
  const nav = navigator as Navigator & { standalone?: boolean };
  return {
    bygg: `${__BUILD__.commit} · filer ${__BUILD__.assets} · ${__BUILD__.builtAt.slice(0, 16)}Z`,
    MusikkPlan: typeof window.MusikkPlan?.resumeFromBladlesing === "function" ? "finnes" : "MANGLER",
    "app.js lastet": script ? script.src.replace(location.origin, "") : "ikke lastet",
    klokke: `activeId=${clock.activeId} timer=${clock.timer != null} blockPaused=${clock.blockPaused}`,
    "siste Play-kall": last ? `${last.result} kl ${new Date(last.at).toLocaleTimeString("nb-NO")} (etter: paused=${last.paused} timer=${last.timer})` : "aldri kalt",
    "#btnPlay": `click ${taps.count}${taps.lastAt ? ` kl ${new Date(taps.lastAt).toLocaleTimeString("nb-NO")}` : ""} · ${taps.events.join(",") || "ingen hendelser"} · øverst: ${taps.hit || "?"}`,
    SW: `${registration ? "registrert" : "ingen"} · styrer siden: ${!!navigator.serviceWorker?.controller} · cache: ${caches_.join(",") || "ingen"}`,
    "app.js via HTTP-cache": await fetchProbe("default"),
    "app.js fra nett": await fetchProbe("reload"),
    "siste feil": lastError ? `${new Date(lastError.at).toLocaleTimeString("nb-NO")} ${lastError.text}` : "ingen",
    standalone: String(nav.standalone === true || window.matchMedia("(display-mode: standalone)").matches),
    UA: navigator.userAgent,
  };
}

/** Small fixed text panel, off unless ?debug=1; out of the layout flow and never catches touches. */
export function DebugPanel() {
  const [on, setOn] = useState(false);
  const [info, setInfo] = useState<Info | null>(null);

  useEffect(() => setOn(wanted()), []);

  useEffect(() => {
    if (!on) return;
    const stopListening = listenForPlay();
    let alive = true;
    const refresh = () => void collect().then((next) => alive && setInfo(next));
    refresh();
    const timer = window.setInterval(refresh, 1000);
    const unsubscribe = subscribePlanClock(refresh);
    return () => {
      alive = false;
      stopListening();
      window.clearInterval(timer);
      unsubscribe();
    };
  }, [on]);

  if (!on) return null;
  return (
    <pre
      id="debug-panel"
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 m-0 max-h-[45dvh] overflow-hidden bg-black/85 p-2 font-mono text-[10px] leading-tight break-words whitespace-pre-wrap text-white"
    >
      {info ? Object.entries(info).map(([key, value]) => `${key}: ${value}`).join("\n") : "debug …"}
    </pre>
  );
}
