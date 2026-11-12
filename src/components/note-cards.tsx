import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Bass, Treble } from "@/components/staff-clefs";
import {
  CLEFS,
  INSTRUMENTS,
  LETTERS,
  STAFF,
  TRUMPET_INSTRUMENTS,
  VALVE_COMBOS,
  drawCard,
  fullName,
  ledgerSteps,
  letterName,
  loadNoteState,
  poolOf,
  saveNoteState,
  selectionForInstrument,
  valveForIdx,
  viewBoxFor,
  worstNotes,
  type Clef,
  type DrillMode,
  type Lang,
  type NoteSelection,
  type NoteState,
  type ValveCombo,
} from "@/lib/notekort";
import { getProfile, getProfileVersion, subscribeProfile } from "@/lib/profile";
import { readToolStore } from "@/lib/tools";

type Tab = "drill" | "deck";

type Session = {
  card: string | null;
  prev: string | null;
  right: number;
  wrong: number;
  streak: number;
  best: number;
  locked: boolean;
  feedback: string;
  kind: "" | "ok" | "no";
};

type Model = {
  stored: NoteState;
  draft: { treble: Set<number>; bass: Set<number> };
  tab: Tab;
  clef: Clef;
  session: Session;
  toast: string;
  toastBad: boolean;
  toastTimer: number | null;
  timer: number | null;
  cont: (() => void) | null;
};

function freshSession(): Session {
  return { card: null, prev: null, right: 0, wrong: 0, streak: 0, best: 0, locked: false, feedback: "", kind: "" };
}

function selectionOf(draft: Model["draft"]): NoteSelection {
  return {
    treble: [...draft.treble].sort((a, b) => a - b),
    bass: [...draft.bass].sort((a, b) => a - b),
  };
}

function StaffCard({ clef, idx, pool }: { clef: Clef; idx: number; pool: string[] }) {
  const y = yOf(clef, idx);
  return (
    <div className="staff-card px-1 py-1.5">
      <svg viewBox={viewBoxFor(pool)} role="img" aria-label={`Note i ${CLEFS[clef].label}`} className="block h-auto w-full">
        <g stroke="#14171b" strokeWidth={1.6} strokeLinecap="square">
          {[0, 1, 2, 3, 4].map((line) => {
            const lineY = STAFF.bottom - line * STAFF.gap;
            return <line key={line} x1={10} y1={lineY} x2={210} y2={lineY} />;
          })}
          {ledgerSteps(clef, idx).map((step) => {
            const lineY = STAFF.bottom - step * (STAFF.gap / 2);
            return <line key={step} x1={STAFF.noteX - 15} y1={lineY} x2={STAFF.noteX + 15} y2={lineY} />;
          })}
        </g>
        {clef === "treble" ? <Treble /> : <Bass />}
        <ellipse
          cx={STAFF.noteX}
          cy={y}
          rx={9}
          ry={6.6}
          fill="#14171b"
          transform={`rotate(-18 ${STAFF.noteX} ${y})`}
        />
      </svg>
    </div>
  );
}

function yOf(clef: Clef, idx: number) {
  return STAFF.bottom - (idx - CLEFS[clef].bottom) * (STAFF.gap / 2);
}

export function NoteCards() {
  useSyncExternalStore(subscribeProfile, getProfileVersion, getProfileVersion);
  const profile = getProfile();
  const isTrumpet = profile === "trumpet";

  const model = useRef<Model>({
    stored: { sel: { treble: [], bass: [] }, lang: "no", stats: {} },
    draft: { treble: new Set(), bass: new Set() },
    tab: "deck",
    clef: "treble",
    session: freshSession(),
    toast: "",
    toastBad: false,
    toastTimer: null,
    timer: null,
    cont: null,
  });
  const answerRef = useRef<(letter: number) => void>(() => {});
  const answerValveRef = useRef<(combo: ValveCombo) => void>(() => {});
  const valveBufferRef = useRef<string[]>([]);
  const valveTimerRef = useRef<number | null>(null);
  const [, bump] = useState(0);
  const redraw = () => bump((n) => n + 1);

  function clearContinue() {
    const cur = model.current;
    if (cur.timer != null) window.clearTimeout(cur.timer);
    cur.timer = null;
    if (cur.cont) document.removeEventListener("click", cur.cont);
    cur.cont = null;
  }

  function flashToast(message: string, bad = false) {
    const cur = model.current;
    cur.toast = message;
    cur.toastBad = bad;
    if (cur.toastTimer != null) window.clearTimeout(cur.toastTimer);
    cur.toastTimer = window.setTimeout(() => {
      model.current.toast = "";
      model.current.toastTimer = null;
      redraw();
    }, 2600);
  }

  function persist() {
    const cur = model.current;
    cur.stored = { ...cur.stored, sel: selectionOf(cur.draft) };
    if (!saveNoteState(cur.stored)) flashToast("Fikk ikke lagret. Er lagring blokkert i nettleseren?", true);
  }

  function nextCard() {
    const cur = model.current;
    clearContinue();
    const pool = poolOf(cur.stored.sel);
    cur.session.prev = cur.session.card;
    cur.session.card = drawCard(pool, cur.session.prev);
    cur.session.locked = false;
    cur.session.feedback = "";
    cur.session.kind = "";
    redraw();
  }

  function recordOutcome(correct: boolean, okFeedback: string, wrongFeedback: string) {
    const cur = model.current;
    if (!cur.session.card) return;
    const prev = cur.stored.stats[cur.session.card] ?? { r: 0, w: 0 };
    cur.stored = {
      ...cur.stored,
      stats: {
        ...cur.stored.stats,
        [cur.session.card]: correct ? { r: prev.r + 1, w: prev.w } : { r: prev.r, w: prev.w + 1 },
      },
    };
    if (correct) {
      cur.session.right += 1;
      cur.session.streak += 1;
      cur.session.best = Math.max(cur.session.best, cur.session.streak);
      cur.session.feedback = okFeedback;
      cur.session.kind = "ok";
      persist();
      cur.timer = window.setTimeout(nextCard, 420);
    } else {
      cur.session.wrong += 1;
      cur.session.streak = 0;
      cur.session.feedback = wrongFeedback;
      cur.session.kind = "no";
      persist();
      cur.timer = window.setTimeout(() => {
        const go = () => nextCard();
        cur.cont = go;
        document.addEventListener("click", go, { once: true });
      }, 120);
    }
    redraw();
  }

  function answer(letterIdx: number) {
    const cur = model.current;
    if (cur.tab !== "drill" || cur.session.locked || !cur.session.card) return;
    cur.session.locked = true;
    const idx = Number(cur.session.card.split(":")[1]);
    const correct = idx % 7 === letterIdx;
    recordOutcome(
      correct,
      `${letterName(idx, cur.stored.lang)} — riktig`,
      `Det var ${fullName(idx, cur.stored.lang)}`,
    );
  }
  answerRef.current = answer;

  function answerValve(combo: ValveCombo) {
    const cur = model.current;
    if (cur.tab !== "drill" || cur.session.locked || !cur.session.card) return;
    cur.session.locked = true;
    const idx = Number(cur.session.card.split(":")[1]);
    const expected = valveForIdx(idx);
    const correct = combo === expected;
    const noteLabel = fullName(idx, cur.stored.lang);
    recordOutcome(
      correct,
      `${expected === "0" ? "0 (åpen)" : expected} · ${noteLabel} — riktig`,
      `Det var ${expected === "0" ? "0 (åpen)" : expected} (${noteLabel})`,
    );
  }
  answerValveRef.current = answerValve;

  function flushValveBuffer() {
    if (valveTimerRef.current != null) {
      window.clearTimeout(valveTimerRef.current);
      valveTimerRef.current = null;
    }
    const buf = valveBufferRef.current;
    valveBufferRef.current = [];
    if (!buf.length) return;
    const sorted = [...buf].sort().join("-");
    let combo: ValveCombo | null = null;
    if (sorted === "0") combo = "0";
    else if (sorted === "1") combo = "1";
    else if (sorted === "2") combo = "2";
    else if (sorted === "3") combo = "1-2";
    else if (sorted === "1-2") combo = "1-2";
    else if (sorted === "2-3") combo = "2-3";
    else if (sorted === "1-3") combo = "1-3";
    else if (sorted === "1-2-3") combo = "1-2-3";

    if (combo) {
      answerValveRef.current(combo);
    }
  }

  function setDrillMode(mode: DrillMode) {
    const cur = model.current;
    cur.stored = { ...cur.stored, mode };
    persist();
    redraw();
  }

  useEffect(() => {
    const cur = model.current;
    clearContinue();
    const rawStore = readToolStore("notekort");
    let loaded = loadNoteState();
    // For a fresh trumpet profile with no saved selection yet, pre-populate C4–C5 so the player can drill immediately.
    if (isTrumpet && !("sel" in rawStore) && !poolOf(loaded.sel).length) {
      const defaultSel = selectionForInstrument(28, 35);
      loaded = { ...loaded, sel: defaultSel, mode: "valves" };
      saveNoteState(loaded);
    }
    cur.stored = loaded;
    cur.draft = { treble: new Set(loaded.sel.treble), bass: new Set(loaded.sel.bass) };
    if (isTrumpet) cur.clef = "treble";
    const pool = poolOf(loaded.sel);
    cur.tab = pool.length ? "drill" : "deck";
    cur.session = freshSession();
    if (pool.length) cur.session.card = drawCard(pool, null);
    redraw();
  }, [profile, isTrumpet]);

  useEffect(() => {
    const currentModel = model.current;
    const onKey = (event: KeyboardEvent) => {
      const live = model.current;
      if (live.tab !== "drill" || live.session.locked || !live.session.card) {
        if ((event.key === " " || event.key === "Enter") && live.cont) {
          event.preventDefault();
          live.cont();
        }
        return;
      }
      const target = event.target;
      if (target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "SELECT")) return;

      const activeProfile = getProfile();
      const isTrumpetProfile = activeProfile === "trumpet";
      const activeMode: DrillMode = isTrumpetProfile ? (live.stored.mode ?? "valves") : "names";

      if (activeMode === "valves") {
        if (event.key === "0") {
          event.preventDefault();
          if (valveTimerRef.current != null) {
            window.clearTimeout(valveTimerRef.current);
            valveTimerRef.current = null;
          }
          valveBufferRef.current = [];
          answerValveRef.current("0");
        } else if (event.key === "1" || event.key === "2" || event.key === "3") {
          event.preventDefault();
          if (!valveBufferRef.current.includes(event.key)) {
            valveBufferRef.current.push(event.key);
          }
          if (valveBufferRef.current.length >= 3) {
            flushValveBuffer();
          } else {
            if (valveTimerRef.current != null) {
              window.clearTimeout(valveTimerRef.current);
            }
            valveTimerRef.current = window.setTimeout(flushValveBuffer, 280);
          }
        } else if (event.key === "Enter" || event.key === " ") {
          if (valveBufferRef.current.length > 0) {
            event.preventDefault();
            flushValveBuffer();
          }
        }
        return;
      }

      const key = event.key.toUpperCase();
      const index = key === "H" ? 6 : LETTERS.indexOf(key as (typeof LETTERS)[number]);
      if (index >= 0) {
        event.preventDefault();
        answerRef.current(index);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (valveTimerRef.current != null) {
        window.clearTimeout(valveTimerRef.current);
        valveTimerRef.current = null;
      }
      if (currentModel.toastTimer != null) window.clearTimeout(currentModel.toastTimer);
      clearContinue();
    };
  }, []);

  const cur = model.current;
  const pool = poolOf(cur.stored.sel);
  const clefSpec = CLEFS[cur.clef];
  const total = cur.session.right + cur.session.wrong;
  const card = cur.session.card?.split(":") ?? null;
  const rows = worstNotes(cur.stored.stats);
  const activeMode: DrillMode = isTrumpet ? (cur.stored.mode ?? "valves") : "names";
  const presetList = isTrumpet ? TRUMPET_INSTRUMENTS : INSTRUMENTS;

  // Fanebytte avbryter ikke svartimeren. nextCard() nullstiller locked når timeren går ut,
  // slik at kortet ikke henger hvis man forlater Øv før 420 ms.
  function show(tab: Tab) {
    model.current.tab = tab;
    if (tab === "drill" && !model.current.session.card) {
      model.current.session.card = drawCard(poolOf(model.current.stored.sel), model.current.session.prev);
    }
    redraw();
  }

  return (
    <section className="pb-4">
      <p className="mb-2 min-h-4 text-center text-xs tracking-wider text-muted uppercase">
        {pool.length ? `${pool.length} noter` : ""}
      </p>
      <div className="mb-4 grid grid-cols-2 gap-1.5" role="tablist" aria-label="Notekort">
        {(
          [
            ["drill", "Øv"],
            ["deck", "Noter"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={cur.tab === id}
            onClick={() => show(id)}
            className={
              cur.tab === id
                ? "min-h-11 rounded-lg border border-accent bg-surface text-sm font-semibold"
                : "min-h-11 rounded-lg border border-line text-sm text-muted"
            }
          >
            {label}
          </button>
        ))}
      </div>

      {cur.tab === "drill" ? (
        pool.length && card ? (
          <>
            {isTrumpet ? (
              <div className="mb-3 grid grid-cols-2 gap-1.5" role="group" aria-label="Øvingsmodus for trompet">
                {(
                  [
                    ["valves", "🎺 Ventilgrep (0, 1, 1-2…)"],
                    ["names", "🎵 Notenavn (C–H)"],
                  ] as const
                ).map(([m, label]) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={activeMode === m}
                    onClick={() => setDrillMode(m)}
                    className={
                      activeMode === m
                        ? "min-h-10 rounded-lg bg-accent px-2 text-xs font-semibold text-bg"
                        : "min-h-10 rounded-lg border border-line px-2 text-xs font-medium text-muted"
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="mb-2.5 flex items-center justify-between text-sm text-muted">
              <p>
                <b className="font-semibold text-fg">{cur.session.right}</b> riktig · {cur.session.wrong} feil
                {total ? ` · ${Math.round((cur.session.right / total) * 100)}%` : ""}
              </p>
              <p>
                På rad: <b className="font-semibold text-fg">{cur.session.streak}</b>
                {cur.session.best > 2 ? ` (beste ${cur.session.best})` : ""}
              </p>
            </div>
            <StaffCard clef={card[0] === "bass" ? "bass" : "treble"} idx={Number(card[1])} pool={pool} />
            <p className="mt-2.5 text-center text-xs tracking-wider text-muted uppercase">
              {CLEFS[card[0] === "bass" ? "bass" : "treble"].label}
              {isTrumpet ? " · B-trompet" : ""}
            </p>
            <p
              className={
                cur.session.kind === "ok"
                  ? "mt-2 min-h-8 text-center text-lg font-semibold text-ok"
                  : cur.session.kind === "no"
                    ? "mt-2 min-h-8 text-center text-lg font-semibold text-no"
                    : "mt-2 min-h-8 text-center text-lg font-semibold"
              }
            >
              {cur.session.feedback || "\u00a0"}
            </p>
            {activeMode === "valves" ? (
              <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7">
                {VALVE_COMBOS.map((combo) => (
                  <button
                    key={combo}
                    type="button"
                    disabled={cur.session.locked}
                    onClick={() => answerValve(combo)}
                    className="answer-key min-h-12 text-base font-bold"
                  >
                    {combo}
                  </button>
                ))}
              </div>
            ) : (
              <div className="answer-row">
                {LETTERS.map((letter, index) => (
                  <button
                    key={letter}
                    type="button"
                    disabled={cur.session.locked}
                    onClick={() => answer(index)}
                    className="answer-key text-lg"
                  >
                    {letter === "B" && cur.stored.lang === "no" ? "H" : letter}
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="rounded-card border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
            <b className="mb-1 block font-semibold text-fg">Ingen noter valgt</b>
            Velg noter under Noter-fanen.
          </div>
        )
      ) : (
        <div className="grid gap-3">
          <div className="rounded-card border border-line bg-surface p-4">
            <h2 className="text-sm font-semibold">{isTrumpet ? "Trompet-register" : "Instrument"}</h2>
            <p className="mt-1 mb-2.5 text-sm text-muted">
              {isTrumpet
                ? "Velg hvor høyt og lavt du vil øve på B-trompeten (skrevet G-nøkkel)."
                : "Setter utvalget til instrumentets noterte register. Noter under G-nøkkelens område legges i F-nøkkel."}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {presetList.map(([label, lo, hi]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => {
                    const sel = selectionFor(lo, hi);
                    model.current.draft = { treble: new Set(sel.treble), bass: new Set(sel.bass) };
                    redraw();
                  }}
                  className="min-h-9 rounded-full border border-line px-3 text-sm"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-card border border-line bg-surface p-4">
            <h2 className="text-sm font-semibold">Nøkkel</h2>
            {isTrumpet ? (
              <p className="mt-1 text-sm font-medium text-accent">G-nøkkel (Trompet i B)</p>
            ) : (
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                {(["treble", "bass"] as const).map((id) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={cur.clef === id}
                    onClick={() => {
                      model.current.clef = id;
                      redraw();
                    }}
                    className={
                      cur.clef === id
                        ? "min-h-11 rounded-lg bg-accent text-sm font-semibold text-bg"
                        : "min-h-11 rounded-lg border border-line text-sm text-muted"
                    }
                  >
                    {CLEFS[id].label}
                  </button>
                ))}
              </div>
            )}
            <p className="mt-3 text-sm text-muted">
              {clefSpec.label}: notene du huker av trekkes tilfeldig. Tallet er oktaven — C4 er enstrøken C.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {clefSpec.presets.map(([label, lo, hi]) => (
                <button key={label} type="button" onClick={() => fillRange(lo, hi)} className="min-h-9 rounded-full border border-line px-3 text-sm">
                  {label}
                </button>
              ))}
              <button type="button" onClick={() => fillRange(clefSpec.min, clefSpec.max)} className="min-h-9 rounded-full border border-line px-3 text-sm">
                Alle
              </button>
              <button
                type="button"
                onClick={() => {
                  model.current.draft[cur.clef].clear();
                  redraw();
                }}
                className="min-h-9 rounded-full border border-line px-3 text-sm"
              >
                Tøm
              </button>
            </div>
            <div className="mt-3 grid gap-3">
              {octaveGroups(cur.clef).map((group) => (
                <div key={group.octave}>
                  <p className="mb-1 text-xs tracking-wide text-muted">Oktav {group.octave}</p>
                  <div className="flex flex-wrap gap-1">
                    {group.notes.map((idx) => {
                      const on = cur.draft[cur.clef].has(idx);
                      return (
                        <button
                          key={idx}
                          type="button"
                          aria-pressed={on}
                          onClick={() => {
                            const set = model.current.draft[cur.clef];
                            if (set.has(idx)) set.delete(idx);
                            else set.add(idx);
                            redraw();
                          }}
                          className={
                            on
                              ? "min-h-11 min-w-11 rounded-md border border-accent bg-header px-1.5 text-sm font-semibold"
                              : "min-h-11 min-w-11 rounded-md border border-line px-1.5 text-sm text-muted"
                          }
                        >
                          {letterName(idx, cur.stored.lang)}
                          <small className="block text-[10px] font-normal opacity-60">{group.octave}</small>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                const live = model.current;
                live.stored = { ...live.stored, sel: selectionOf(live.draft) };
                const saved = saveNoteState(live.stored);
                live.session = freshSession();
                flashToast(
                  !saved
                    ? "Fikk ikke lagret. Er lagring blokkert i nettleseren?"
                    : poolOf(live.stored.sel).length
                      ? "Utvalget er lagret."
                      : "Ingen noter valgt.",
                  !saved,
                );
                redraw();
              }}
              className="metro-press mt-4 min-h-12 w-full rounded-lg bg-accent font-semibold text-bg"
            >
              Lagre utvalget
            </button>
            <p className={cur.toastBad ? "mt-2 min-h-5 text-center text-sm text-no" : "mt-2 min-h-5 text-center text-sm text-ok"}>
              {cur.toast}
            </p>
          </div>

          <div className="overflow-hidden rounded-card border border-line">
            <h2 className="px-3 pt-3 text-sm font-semibold">Treff per note</h2>
            {rows.length ? (
              rows.map((row) => {
                const [clef, raw] = row.key.split(":");
                const name = `${clef === "treble" ? "G " : "F "}${fullName(Number(raw), cur.stored.lang)}`;
                return (
                  <div key={row.key} className="flex items-center gap-2.5 border-t border-line px-3 py-2 text-sm">
                    <span className="w-14 font-semibold">{name}</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded bg-header">
                      <span className="block h-full bg-accent" style={{ width: `${Math.round(row.pct * 100)}%` }} />
                    </span>
                    <span className="w-16 text-right text-xs text-muted">
                      {Math.round(row.pct * 100)}% · {row.n}
                    </span>
                  </div>
                );
              })
            ) : (
              <p className="border-t border-line px-3 py-2.5 text-sm text-muted">Ingen svar registrert ennå</p>
            )}
          </div>

          <div className="rounded-card border border-line bg-surface p-4">
            <h2 className="text-sm font-semibold">Notenavn</h2>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              {(
                [
                  ["no", "Norsk (H)"],
                  ["en", "Engelsk (B)"],
                ] as const
              ).map(([lang, label]) => (
                <button
                  key={lang}
                  type="button"
                  aria-pressed={cur.stored.lang === lang}
                  onClick={() => setLang(lang)}
                  className={
                    cur.stored.lang === lang
                      ? "min-h-11 rounded-lg bg-accent text-sm font-semibold text-bg"
                      : "min-h-11 rounded-lg border border-line text-sm text-muted"
                  }
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                if (!confirm("Nullstiller treffstatistikken. Utvalget beholdes. Fortsette?")) return;
                const live = model.current;
                live.stored = { ...live.stored, stats: {}, sel: selectionOf(live.draft) };
                const saved = saveNoteState(live.stored);
                flashToast(
                  saved ? "Statistikken er nullstilt." : "Fikk ikke lagret. Er lagring blokkert i nettleseren?",
                  !saved,
                );
                redraw();
              }}
              className="metro-press mt-3 min-h-11 w-full rounded-lg border border-line text-sm text-muted"
            >
              Nullstill statistikk
            </button>
          </div>
        </div>
      )}
    </section>
  );

  function fillRange(lo: number, hi: number) {
    const set = model.current.draft[model.current.clef];
    for (let idx = lo; idx <= hi; idx++) set.add(idx);
    redraw();
  }

  function setLang(lang: Lang) {
    const live = model.current;
    live.stored = { ...live.stored, lang };
    persist();
    redraw();
  }
}

function selectionFor(lo: number, hi: number): NoteSelection {
  const sel: NoteSelection = { treble: [], bass: [] };
  for (let idx = lo; idx <= hi; idx++) {
    if (idx >= CLEFS.treble.min && idx <= CLEFS.treble.max) sel.treble.push(idx);
    else if (idx >= CLEFS.bass.min && idx <= CLEFS.bass.max) sel.bass.push(idx);
  }
  return sel;
}

function octaveGroups(clef: Clef, maxOverride?: number) {
  const spec = CLEFS[clef];
  const hi = maxOverride != null ? Math.min(spec.max, maxOverride) : spec.max;
  const groups: { octave: number; notes: number[] }[] = [];
  for (let idx = spec.min; idx <= hi; idx++) {
    const octave = Math.floor(idx / 7);
    const last = groups[groups.length - 1];
    if (!last || last.octave !== octave) groups.push({ octave, notes: [idx] });
    else last.notes.push(idx);
  }
  return groups;
}
