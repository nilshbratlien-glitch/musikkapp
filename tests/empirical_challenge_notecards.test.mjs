import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("NoteCards Lifecycle, Unmounting & Keyboard Handling Empirical Stress", () => {
  // Mock window/document event harness
  function createEnvironment() {
    const listeners = {
      window: new Map(),
      document: new Map(),
    };

    const timers = new Map();
    let nextTimerId = 1;

    const mockWindow = {
      addEventListener(type, fn) {
        if (!listeners.window.has(type)) listeners.window.set(type, new Set());
        listeners.window.get(type).add(fn);
      },
      removeEventListener(type, fn) {
        listeners.window.get(type)?.delete(fn);
      },
      dispatchEvent(event) {
        const fns = listeners.window.get(event.type) || new Set();
        for (const fn of fns) fn(event);
      },
      setTimeout(fn, ms) {
        const id = nextTimerId++;
        timers.set(id, { fn, ms });
        return id;
      },
      clearTimeout(id) {
        timers.delete(id);
      },
      runTimer(id) {
        const item = timers.get(id);
        if (item) {
          timers.delete(id);
          item.fn();
        }
      },
      runAllTimers() {
        const ids = [...timers.keys()];
        for (const id of ids) {
          const item = timers.get(id);
          if (item) {
            timers.delete(id);
            item.fn();
          }
        }
      },
    };

    const mockDocument = {
      addEventListener(type, fn) {
        if (!listeners.document.has(type)) listeners.document.set(type, new Set());
        listeners.document.get(type).add(fn);
      },
      removeEventListener(type, fn) {
        listeners.document.get(type)?.delete(fn);
      },
      dispatchEvent(event) {
        const fns = listeners.document.get(event.type) || new Set();
        for (const fn of fns) fn(event);
      },
    };

    return { mockWindow, mockDocument, listeners, timers };
  }

  // Harness that recreates NoteCards' exact useEffect lifecycle and refs
  function mountNoteCards(env, { initialProfile = "trumpet", initialMode = "valves" } = {}) {
    const LETTERS = ["C", "D", "E", "F", "G", "A", "H"];
    let currentProfile = initialProfile;

    const model = {
      current: {
        tab: "drill",
        stored: { mode: initialMode, lang: "no" },
        session: { locked: false, card: "treble:28" }, // C4
        toast: "",
        toastTimer: null,
        timer: null,
        cont: null,
      },
    };

    const answeredValves = [];
    const answeredLetters = [];
    let continuationsTriggered = 0;

    const answerRef = {
      current: (idx) => answeredLetters.push(idx),
    };

    const answerValveRef = {
      current: (combo) => answeredValves.push(combo),
    };

    const valveBufferRef = { current: [] };
    const valveTimerRef = { current: null };

    function flushValveBuffer() {
      if (valveTimerRef.current != null) {
        env.mockWindow.clearTimeout(valveTimerRef.current);
        valveTimerRef.current = null;
      }
      const buf = valveBufferRef.current;
      valveBufferRef.current = [];
      if (!buf.length) return;
      const sorted = [...buf].sort().join("-");
      let combo = null;
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

    function clearContinue() {
      const cur = model.current;
      if (cur.timer != null) env.mockWindow.clearTimeout(cur.timer);
      cur.timer = null;
      if (cur.cont) env.mockDocument.removeEventListener("click", cur.cont);
      cur.cont = null;
    }

    // Exact replica of useEffect in note-cards.tsx lines 279-345
    const currentModel = model.current;
    const onKey = (event) => {
      const live = model.current;
      if (live.tab !== "drill" || live.session.locked || !live.session.card) {
        if ((event.key === " " || event.key === "Enter") && live.cont) {
          event.defaultPrevented = true;
          live.cont();
        }
        return;
      }
      const target = event.target;
      if (target && (target.tagName === "INPUT" || target.tagName === "SELECT")) return;

      const activeProfile = currentProfile;
      const isTrumpetProfile = activeProfile === "trumpet";
      const activeMode = isTrumpetProfile ? (live.stored.mode ?? "valves") : "names";

      if (activeMode === "valves") {
        if (event.key === "0") {
          event.defaultPrevented = true;
          if (valveTimerRef.current != null) {
            env.mockWindow.clearTimeout(valveTimerRef.current);
            valveTimerRef.current = null;
          }
          valveBufferRef.current = [];
          answerValveRef.current("0");
        } else if (event.key === "1" || event.key === "2" || event.key === "3") {
          event.defaultPrevented = true;
          if (!valveBufferRef.current.includes(event.key)) {
            valveBufferRef.current.push(event.key);
          }
          if (valveBufferRef.current.length >= 3) {
            flushValveBuffer();
          } else {
            if (valveTimerRef.current != null) {
              env.mockWindow.clearTimeout(valveTimerRef.current);
            }
            valveTimerRef.current = env.mockWindow.setTimeout(flushValveBuffer, 280);
          }
        } else if (event.key === "Enter" || event.key === " ") {
          if (valveBufferRef.current.length > 0) {
            event.defaultPrevented = true;
            flushValveBuffer();
          }
        }
        return;
      }

      const key = event.key.toUpperCase();
      const index = key === "H" ? 6 : LETTERS.indexOf(key);
      if (index >= 0) {
        event.defaultPrevented = true;
        answerRef.current(index);
      }
    };

    env.mockWindow.addEventListener("keydown", onKey);

    const unmount = () => {
      env.mockWindow.removeEventListener("keydown", onKey);
      if (valveTimerRef.current != null) {
        env.mockWindow.clearTimeout(valveTimerRef.current);
        valveTimerRef.current = null;
      }
      if (currentModel.toastTimer != null) env.mockWindow.clearTimeout(currentModel.toastTimer);
      clearContinue();
    };

    return {
      model,
      valveBufferRef,
      valveTimerRef,
      answeredValves,
      answeredLetters,
      setProfile: (p) => (currentProfile = p),
      setMode: (m) => (model.current.stored.mode = m),
      unmount,
      clearContinue,
    };
  }

  it("unbinds window keydown event listener completely on unmount", () => {
    const env = createEnvironment();
    assert.equal(env.listeners.window.get("keydown")?.size || 0, 0);

    const instance = mountNoteCards(env);
    assert.equal(env.listeners.window.get("keydown")?.size, 1);

    // Keydown works while mounted
    env.mockWindow.dispatchEvent({ type: "keydown", key: "0" });
    assert.deepEqual(instance.answeredValves, ["0"]);

    // Unmount
    instance.unmount();
    assert.equal(env.listeners.window.get("keydown")?.size, 0);

    // Keydown after unmount produces NO calls and NO errors
    env.mockWindow.dispatchEvent({ type: "keydown", key: "0" });
    assert.deepEqual(instance.answeredValves, ["0"]); // still 1 item
  });

  it("clears pending valve timer and does not flush buffer after unmount", () => {
    const env = createEnvironment();
    const instance = mountNoteCards(env);

    // Press '1'
    env.mockWindow.dispatchEvent({ type: "keydown", key: "1" });
    assert.deepEqual(instance.valveBufferRef.current, ["1"]);
    assert.ok(instance.valveTimerRef.current != null);
    const scheduledTimerId = instance.valveTimerRef.current;
    assert.ok(env.timers.has(scheduledTimerId));

    // Component unmounts during buffer window
    instance.unmount();
    assert.equal(instance.valveTimerRef.current, null);
    assert.equal(env.timers.has(scheduledTimerId), false, "Timer must be cleared from window");

    // Timers run -> nothing should be answered
    env.mockWindow.runAllTimers();
    assert.deepEqual(instance.answeredValves, [], "No valve answer should fire after unmount");
  });

  it("clears toast timer on unmount without accessing stale model", () => {
    const env = createEnvironment();
    const instance = mountNoteCards(env);

    // Simulate active toast timer
    const toastId = env.mockWindow.setTimeout(() => {}, 2600);
    instance.model.current.toastTimer = toastId;
    assert.ok(env.timers.has(toastId));

    instance.unmount();
    assert.equal(env.timers.has(toastId), false, "Toast timer must be cleared on unmount");
  });

  it("clears continue timer and removes document click listener on unmount", () => {
    const env = createEnvironment();
    const instance = mountNoteCards(env);

    // Simulate incorrect card waiting for continue click
    let nextCardCalled = 0;
    const go = () => nextCardCalled++;
    instance.model.current.cont = go;
    instance.model.current.timer = env.mockWindow.setTimeout(() => {}, 120);
    env.mockDocument.addEventListener("click", go);

    assert.equal(env.listeners.document.get("click")?.size, 1);
    const contTimerId = instance.model.current.timer;
    assert.ok(env.timers.has(contTimerId));

    instance.unmount();
    assert.equal(env.listeners.document.get("click")?.size, 0, "Document click listener must be removed");
    assert.equal(env.timers.has(contTimerId), false, "Continue timer must be cleared");

    // Clicks on document do not fire go
    env.mockDocument.dispatchEvent({ type: "click" });
    assert.equal(nextCardCalled, 0);
  });

  it("flushes rapid combinations accurately in valve mode", () => {
    const env = createEnvironment();
    const instance = mountNoteCards(env);

    // Press '1' and '2' -> timer flushes '1-2'
    env.mockWindow.dispatchEvent({ type: "keydown", key: "1" });
    env.mockWindow.dispatchEvent({ type: "keydown", key: "2" });
    assert.deepEqual(instance.valveBufferRef.current, ["1", "2"]);
    env.mockWindow.runAllTimers();
    assert.deepEqual(instance.answeredValves, ["1-2"]);

    // Press '3' alone -> maps to alternate '1-2'
    env.mockWindow.dispatchEvent({ type: "keydown", key: "3" });
    env.mockWindow.runAllTimers();
    assert.deepEqual(instance.answeredValves, ["1-2", "1-2"]);

    // Press '2' and '3' -> '2-3'
    env.mockWindow.dispatchEvent({ type: "keydown", key: "2" });
    env.mockWindow.dispatchEvent({ type: "keydown", key: "3" });
    env.mockWindow.runAllTimers();
    assert.deepEqual(instance.answeredValves, ["1-2", "1-2", "2-3"]);

    // Press '1' and '3' -> '1-3'
    env.mockWindow.dispatchEvent({ type: "keydown", key: "1" });
    env.mockWindow.dispatchEvent({ type: "keydown", key: "3" });
    env.mockWindow.runAllTimers();
    assert.deepEqual(instance.answeredValves, ["1-2", "1-2", "2-3", "1-3"]);

    // Press '1', '2', '3' -> immediate flush on 3rd key without waiting for timer
    env.mockWindow.dispatchEvent({ type: "keydown", key: "1" });
    env.mockWindow.dispatchEvent({ type: "keydown", key: "2" });
    env.mockWindow.dispatchEvent({ type: "keydown", key: "3" });
    assert.deepEqual(instance.answeredValves, ["1-2", "1-2", "2-3", "1-3", "1-2-3"]);

    // Press '1', then Enter -> immediate flush
    env.mockWindow.dispatchEvent({ type: "keydown", key: "1" });
    env.mockWindow.dispatchEvent({ type: "keydown", key: "Enter" });
    assert.deepEqual(instance.answeredValves, ["1-2", "1-2", "2-3", "1-3", "1-2-3", "1"]);

    // Press '1', then Space -> immediate flush
    env.mockWindow.dispatchEvent({ type: "keydown", key: "2" });
    env.mockWindow.dispatchEvent({ type: "keydown", key: " " });
    assert.deepEqual(instance.answeredValves, ["1-2", "1-2", "2-3", "1-3", "1-2-3", "1", "2"]);

    // Press '1' then '0' -> '0' cancels buffer and answers '0'
    env.mockWindow.dispatchEvent({ type: "keydown", key: "1" });
    env.mockWindow.dispatchEvent({ type: "keydown", key: "0" });
    assert.deepEqual(instance.answeredValves, ["1-2", "1-2", "2-3", "1-3", "1-2-3", "1", "2", "0"]);
  });

  it("isolates letter input from valve mode and vice versa", () => {
    const env = createEnvironment();
    const instance = mountNoteCards(env, { initialProfile: "trumpet", initialMode: "valves" });

    // Pressing letter keys in valves mode does nothing
    for (const letter of ["C", "D", "E", "F", "G", "A", "H"]) {
      env.mockWindow.dispatchEvent({ type: "keydown", key: letter });
    }
    assert.deepEqual(instance.answeredLetters, []);
    assert.deepEqual(instance.answeredValves, []);

    // Switch to names mode in trumpet profile
    instance.setMode("names");
    env.mockWindow.dispatchEvent({ type: "keydown", key: "C" });
    env.mockWindow.dispatchEvent({ type: "keydown", key: "H" });
    assert.deepEqual(instance.answeredLetters, [0, 6]);

    // Number keys in names mode do nothing
    env.mockWindow.dispatchEvent({ type: "keydown", key: "0" });
    env.mockWindow.dispatchEvent({ type: "keydown", key: "1" });
    assert.deepEqual(instance.answeredValves, []);

    // Mallets profile always enforces names mode regardless of stored mode
    instance.setProfile("mallets");
    instance.setMode("valves"); // even if stored.mode is valves
    env.mockWindow.dispatchEvent({ type: "keydown", key: "D" });
    assert.deepEqual(instance.answeredLetters, [0, 6, 1]); // D is index 1
  });

  it("ignores key events when typing inside form input elements", () => {
    const env = createEnvironment();
    const instance = mountNoteCards(env);

    env.mockWindow.dispatchEvent({
      type: "keydown",
      key: "0",
      target: { tagName: "INPUT" },
    });
    env.mockWindow.dispatchEvent({
      type: "keydown",
      key: "1",
      target: { tagName: "SELECT" },
    });
    assert.deepEqual(instance.answeredValves, []);
    assert.deepEqual(instance.valveBufferRef.current, []);
  });
});
