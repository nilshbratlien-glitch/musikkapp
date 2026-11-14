/* global Theory, AudioEngine, ScoreRenderer -- set by the sibling MalletSight scripts */
(function () {
  const T = Theory;
  const LEGACY = "mallet-sr-settings-v3";
  let host = document.getElementById("malletsight-root") || document;
  let wired = false;
  let remoteCall = false;
  let onResize = null;
  let onKey = null;
  let offPulse = null;

  function currentProfile() {
    if (typeof window !== "undefined" && window.MusikkProfile && typeof window.MusikkProfile.get === "function") {
      return window.MusikkProfile.get();
    }
    try {
      const p = localStorage.getItem("musikkapp.profile");
      if (p === "trumpet" || p === "mallets") return p;
    } catch { /* best effort */ }
    return "mallets";
  }

  function storageKey() {
    return currentProfile() === "trumpet" ? "musikkapp.trumpet.bladlesing" : "musikkapp.bladlesing";
  }

  const DEFAULTS = {
    instrumentId: "mar50",
    mallets: 2,
    texture: "mixed",
    chordChance: 0.28,
    clef: "auto",
    keyId: "C",
    keyIds: ["C"],
    keyIndex: 0,
    keyFilter: "all",
    timeId: "4/4",
    measures: 8,
    tempo: 80,
    rangeLow: 60,
    rangeHigh: 84,
    maxLeap: 5,
    rhythms: ["h", "q", "8"],
    rests: ["q", "8"],
    allowRests: true,
    rhythmDensity: 2,
    syncopation: false,
    ties: false,
    accidentals: false,
    startTonic: true,
    endTonic: true,
    accents: false,
    staccato: false,
    legato: false,
    dynamics: false,
    rolls: "off",
    showSticking: false,
    annotate: "off",
    doubleStopChance: 0.25,
    threeDouble: "auto",
    handSpanMin: 3,
    handSpanMax: 12,
    innerGapMax: 16,
    maxGripShift: 12,
    zoom: 1,
    stopIntervals: ["3", "4", "5", "6", "8"],
    stopPlace: "below",
    voicing: "closed",
    blockSize: "mix",
    duetEnabled: false,
    duetMalletInstrument: "xylo",
    duetStyle: "harmony",
    duetViewPart: "score",
    duetPlayTrumpet: true,
    duetPlayMallets: true,
    duetRangeTptLow: 60,
    duetRangeTptHigh: 74,
    duetRangeMalletLow: 60,
    duetRangeMalletHigh: 84,
    duetMallets: 2,
    duetAllowChords: true,
  };

  const TRUMPET_DEFAULTS = Object.assign({}, DEFAULTS, {
    instrumentId: "trumpet",
    clef: "treble",
    rangeLow: 60,
    rangeHigh: 72,
    maxLeap: 4,
    tempo: 76,
    showSticking: true,
    texture: "melody",
    rolls: "off",
    chordChance: 0,
    doubleStopChance: 0,
  });

  let settings = loadSettings();
  let currentScore = null;
  let currentSeed = null;
  let currentVisual = null;
  let beatMap = [];
  let practiceBeat = 0;
  let metroBeforePlay = false;

  const LOCAL_ONLY_SETTING_KEYS = new Set([
    "duetViewPart",
    "duetPlayTrumpet",
    "duetPlayMallets",
    "zoom",
  ]);

  function compactSyncSettings() {
    const out = {};
    for (const key of Object.keys(settings)) {
      if (!LOCAL_ONLY_SETTING_KEYS.has(key)) {
        out[key] = settings[key];
      }
    }
    return out;
  }

  function migrateKeyIds(keyId) {
    if (!keyId || keyId === "random") return T.KEYS.map((k) => k.id);
    if (T.KEYS.some((k) => k.id === keyId)) return [keyId];
    return ["C"];
  }

  function loadSettings() {
    const isTrumpet = currentProfile() === "trumpet";
    const key = storageKey();
    const fallback = isTrumpet ? TRUMPET_DEFAULTS : DEFAULTS;
    try {
      let raw = localStorage.getItem(key);
      let parsed = raw ? JSON.parse(raw) : null;
      const empty = !parsed || (typeof parsed === "object" && !parsed.instrumentId);
      if (empty && !isTrumpet) {
        const legacy = localStorage.getItem(LEGACY);
        if (legacy) {
          parsed = JSON.parse(legacy);
          try { localStorage.setItem(key, JSON.stringify(parsed)); } catch (err) { /* best effort */ }
        }
      }
      if (parsed) {
        const merged = Object.assign({}, fallback, parsed);
        if (isTrumpet) {
          merged.instrumentId = "trumpet";
          merged.clef = "treble";
          merged.mallets = 1;
          merged.texture = "melody";
          merged.rolls = "off";
          merged.chordChance = 0;
          merged.doubleStopChance = 0;
        }
        const valid = new Set(T.KEYS.map((k) => k.id));
        if (!Array.isArray(parsed.keyIds)) {
          merged.keyIds = migrateKeyIds(parsed.keyId);
        } else {
          merged.keyIds = parsed.keyIds.filter((id) => valid.has(id));
          if (!merged.keyIds.length) merged.keyIds = ["C"];
        }
        return merged;
      }
    } catch (e) { /* best effort */ }
    return Object.assign({}, fallback);
  }

  function saveSettings() {
    try { localStorage.setItem(storageKey(), JSON.stringify(settings)); } catch (e) { /* best effort */ }
  }

  function $(sel) {
    return host.querySelector(sel);
  }
  function $all(sel) {
    return Array.from(host.querySelectorAll(sel));
  }

  function midiLabel(m) {
    return Theory.midiToName(m, false).toUpperCase().replace("#", "♯") + Theory.midiOctave(m);
  }

  function writtenLabel(sounding) {
    return midiLabel(sounding + T.writtenOff(settings.instrumentId));
  }

  const SLIDER_LO = 36; /* written C2 */
  const SLIDER_HI = 108; /* written C8 */

  function writeOff() {
    return T.writtenOff(settings.instrumentId);
  }

  function syncRangeSliders() {
    const off = writeOff();
    const inst = T.INSTRUMENTS.find((i) => i.id === settings.instrumentId);
    const minW = inst ? inst.low + off : SLIDER_LO;
    const maxW = inst ? inst.high + off : SLIDER_HI;
    const wlo = T.clamp(settings.rangeLow + off, minW, maxW);
    const whi = T.clamp(settings.rangeHigh + off, minW, maxW);
    ["rangeLow", "rangeHigh"].forEach((id) => {
      const el = $("#" + id);
      if (el) {
        el.min = String(minW);
        el.max = String(maxW);
      }
    });
    if ($("#rangeLow")) $("#rangeLow").value = String(wlo);
    if ($("#rangeHigh")) $("#rangeHigh").value = String(whi);
    if ($("#rangeLowLbl")) $("#rangeLowLbl").textContent = midiLabel(wlo);
    if ($("#rangeHighLbl")) $("#rangeHighLbl").textContent = midiLabel(whi);
    if ($("#rangeHint") && inst) {
      $("#rangeHint").textContent =
        "Skrevet omfang for " +
        inst.name +
        ": " +
        midiLabel(minW) +
        "–" +
        midiLabel(maxW) +
        ".";
    }
  }

  function readRangeSliders() {
    const off = writeOff();
    const inst = T.INSTRUMENTS.find((i) => i.id === settings.instrumentId);
    let wlo = parseInt($("#rangeLow").value, 10);
    let whi = parseInt($("#rangeHigh").value, 10);
    const minW = inst ? inst.low + off : SLIDER_LO;
    const maxW = inst ? inst.high + off : SLIDER_HI;
    wlo = T.clamp(wlo, minW, maxW);
    whi = T.clamp(whi, minW, maxW);
    if (wlo > whi) {
      const t = wlo;
      wlo = whi;
      whi = t;
    }
    settings.rangeLow = wlo - off;
    settings.rangeHigh = whi - off;
    syncRangeSliders();
  }

  function applyInstrumentRange(force) {
    const inst = T.INSTRUMENTS.find((i) => i.id === settings.instrumentId);
    if (!inst) return;
    const inheritedLow = T.INSTRUMENTS.some(
      (other) => other.id !== inst.id && other.low === settings.rangeLow && other.low > inst.low
    );
    if (force || inheritedLow || settings.rangeLow < inst.low || settings.rangeHigh > inst.high) {
      if (inst.id === "trumpet") {
        settings.rangeLow = 60;
        settings.rangeHigh = 72;
      } else if (inst.id === "mar50") {
        settings.rangeLow = 36;
        settings.rangeHigh = 84;
      } else if (inst.id === "mar43") {
        settings.rangeLow = 45;
        settings.rangeHigh = 84;
      } else {
        settings.rangeLow = inst.low;
        settings.rangeHigh = inst.high;
      }
    }
    settings.rangeLow = Theory.clamp(settings.rangeLow, inst.low, inst.high);
    settings.rangeHigh = Theory.clamp(settings.rangeHigh, inst.low, inst.high);
    if (settings.rangeHigh - settings.rangeLow < 5) settings.rangeHigh = Math.min(inst.high, settings.rangeLow + 12);
  }

  function defaultDuetMalletRange(instId) {
    const inst = T.INSTRUMENTS.find((i) => i.id === instId);
    if (!inst) return { low: 60, high: 84, minW: 36, maxW: 108 };
    const off = inst.writtenOff || 0;
    const minW = inst.low + off;
    const maxW = inst.high + off;
    let low = minW;
    let high = maxW;
    switch (instId) {
      case "glock":
        low = 55;
        high = 84;
        break;
      case "xylo":
        low = 53;
        high = 84;
        break;
      case "vibes":
        low = 53;
        high = 84;
        break;
      case "mar43":
        low = 45;
        high = 84;
        break;
      case "mar50":
        low = 36;
        high = 84;
        break;
      default:
        low = Math.max(minW, 60);
        high = Math.min(maxW, 84);
    }
    return { low, high, minW, maxW };
  }

  function syncDuetRangeSliders(forceMalletDefault) {
    const malInstId = settings.duetMalletInstrument || "xylo";
    const { low: defLow, high: defHigh, minW, maxW } = defaultDuetMalletRange(malInstId);

    if (forceMalletDefault || !settings.duetRangeMalletLow || settings.duetRangeMalletLow < minW || settings.duetRangeMalletLow > maxW) {
      settings.duetRangeMalletLow = defLow;
    }
    if (forceMalletDefault || !settings.duetRangeMalletHigh || settings.duetRangeMalletHigh < minW || settings.duetRangeMalletHigh > maxW) {
      settings.duetRangeMalletHigh = defHigh;
    }
    if (settings.duetRangeMalletLow > settings.duetRangeMalletHigh) {
      const t = settings.duetRangeMalletLow;
      settings.duetRangeMalletLow = settings.duetRangeMalletHigh;
      settings.duetRangeMalletHigh = t;
    }

    const tptLow = settings.duetRangeTptLow || 60;
    const tptHigh = settings.duetRangeTptHigh || 74;
    const malLow = settings.duetRangeMalletLow;
    const malHigh = settings.duetRangeMalletHigh;

    ["rangeTptLow", "duetRangeTptLow"].forEach((id) => {
      const el = $("#" + id);
      if (el) {
        el.min = "54";
        el.max = "84";
        el.value = String(tptLow);
      }
    });
    ["rangeTptHigh", "duetRangeTptHigh"].forEach((id) => {
      const el = $("#" + id);
      if (el) {
        el.min = "54";
        el.max = "84";
        el.value = String(tptHigh);
      }
    });
    if ($("#rangeTptLowLbl")) $("#rangeTptLowLbl").textContent = midiLabel(tptLow);
    if ($("#duetRangeTptLowLbl")) $("#duetRangeTptLowLbl").textContent = midiLabel(tptLow);
    if ($("#rangeTptHighLbl")) $("#rangeTptHighLbl").textContent = midiLabel(tptHigh);
    if ($("#duetRangeTptHighLbl")) $("#duetRangeTptHighLbl").textContent = midiLabel(tptHigh);

    ["rangeMalletLow", "duetRangeMalletLow"].forEach((id) => {
      const el = $("#" + id);
      if (el) {
        el.min = String(minW);
        el.max = String(maxW);
        el.value = String(malLow);
      }
    });
    ["rangeMalletHigh", "duetRangeMalletHigh"].forEach((id) => {
      const el = $("#" + id);
      if (el) {
        el.min = String(minW);
        el.max = String(maxW);
        el.value = String(malHigh);
      }
    });
    if ($("#rangeMalletLowLbl")) $("#rangeMalletLowLbl").textContent = midiLabel(malLow);
    if ($("#duetRangeMalletLowLbl")) $("#duetRangeMalletLowLbl").textContent = midiLabel(malLow);
    if ($("#rangeMalletHighLbl")) $("#rangeMalletHighLbl").textContent = midiLabel(malHigh);
    if ($("#duetRangeMalletHighLbl")) $("#duetRangeMalletHighLbl").textContent = midiLabel(malHigh);
  }

  function fillSelect(el, items, value, labelFn, valueFn) {
    el.innerHTML = "";
    items.forEach((it) => {
      const opt = document.createElement("option");
      opt.value = valueFn ? valueFn(it) : it.id;
      opt.textContent = labelFn ? labelFn(it) : it.name;
      el.appendChild(opt);
    });
    el.value = value;
  }

  const RHYTHM_PRESETS = {
    all: null,
    long: ["w", "h", "hd", "q"],
    simple: ["h", "q", "8", "16"],
    dotted: ["hd", "qd", "qdd", "8d", "16d"],
    triplets: ["qt", "8t", "16t"],
    short: ["8", "16", "16d", "32", "8t", "16t"],
  };

  function rhythmPresetIds(name) {
    if (name === "all") return T.DURATIONS.map((d) => d.id);
    return (RHYTHM_PRESETS[name] || []).slice();
  }

  const LEVELS = [
    { rhythms: ["h", "q"], rests: ["q"], maxLeap: 2, rhythmDensity: 1, measures: 4, allowRests: false, syncopation: false, ties: false, accidentals: false, dynamics: false, hint: "Halvnoter og fjerdedeler. Bare trinn." },
    { rhythms: ["h", "q"], rests: ["h", "q"], maxLeap: 3, rhythmDensity: 1, measures: 4, allowRests: true, syncopation: false, ties: false, accidentals: false, dynamics: false, hint: "Pauser, og sprang på en ters." },
    { rhythms: ["h", "q", "8"], rests: ["q", "8"], maxLeap: 3, rhythmDensity: 2, measures: 4, allowRests: true, syncopation: false, ties: false, accidentals: false, dynamics: false, hint: "Åttendeler kommer inn. Sprangene er små." },
    { rhythms: ["hd", "h", "q", "8"], rests: ["h", "q", "8"], maxLeap: 4, rhythmDensity: 2, measures: 8, allowRests: true, syncopation: false, ties: false, accidentals: false, dynamics: false, hint: "Punkterte halvnoter. Sprang på en kvart." },
    { rhythms: ["h", "q", "qd", "8"], rests: ["q", "8"], maxLeap: 5, rhythmDensity: 3, measures: 8, allowRests: true, syncopation: false, ties: true, accidentals: false, dynamics: false, hint: "Punkterte fjerdedeler og bindebuer. Sprang på en kvint." },
    { rhythms: ["q", "qd", "8", "8d", "16"], rests: ["q", "8"], maxLeap: 5, rhythmDensity: 3, measures: 8, allowRests: true, syncopation: false, ties: true, accidentals: false, dynamics: false, hint: "Sekstendeler og punkterte åttendeler." },
    { rhythms: ["q", "qd", "8", "8d", "16"], rests: ["q", "8", "16"], maxLeap: 6, rhythmDensity: 4, measures: 8, allowRests: true, syncopation: true, ties: true, accidentals: true, dynamics: true, hint: "Synkoper, løse fortegn og dynamikk. Sprang på en sekst." },
    { rhythms: ["q", "qd", "8", "16", "8t"], rests: ["q", "8"], maxLeap: 6, rhythmDensity: 4, measures: 12, allowRests: true, syncopation: true, ties: true, accidentals: true, dynamics: true, hint: "Åttendelstrioler." },
    { rhythms: ["q", "qd", "8", "8d", "16", "16d", "8t"], rests: ["q", "8", "16"], maxLeap: 8, rhythmDensity: 5, measures: 12, allowRests: true, syncopation: true, ties: true, accidentals: true, dynamics: true, hint: "Punkterte sekstendeler og oktavsprang." },
    { rhythms: ["q", "qd", "qdd", "8", "8d", "16", "16d", "32", "8t", "16t"], rests: ["q", "8", "16"], maxLeap: 8, rhythmDensity: 5, measures: 12, allowRests: true, syncopation: true, ties: true, accidentals: true, dynamics: true, hint: "Trettitodeler og sekstendelstrioler. Full miks." },
  ];

  function sameIds(a, b) {
    return (a || []).slice().sort().join("|") === (b || []).slice().sort().join("|");
  }

  function levelIndex() {
    for (let i = 0; i < LEVELS.length; i++) {
      const p = LEVELS[i];
      if (!sameIds(p.rhythms, settings.rhythms)) continue;
      if (!sameIds(p.rests, settings.rests)) continue;
      if (p.maxLeap !== settings.maxLeap) continue;
      if (p.rhythmDensity !== settings.rhythmDensity) continue;
      if (Number(p.measures) !== Number(settings.measures)) continue;
      if (!!p.allowRests !== !!settings.allowRests) continue;
      if (!!p.syncopation !== !!settings.syncopation) continue;
      if (!!p.ties !== !!settings.ties) continue;
      if (!!p.accidentals !== !!settings.accidentals) continue;
      if (!!p.dynamics !== !!settings.dynamics) continue;
      const expectedLegato = settings.instrumentId === "trumpet" ? i + 1 >= 3 : false;
      if (!!settings.legato !== expectedLegato) continue;
      return i;
    }
    return -1;
  }

  function markLevel() {
    const idx = levelIndex();
    document.querySelectorAll("[data-level]").forEach((btn) => {
      btn.classList.toggle("on", Number(btn.dataset.level) === idx + 1);
    });
    const hint = $("#levelHint");
    if (hint) {
      hint.textContent = idx >= 0
        ? "Nivå " + (idx + 1) + ". " + LEVELS[idx].hint
        : "Egendefinert miks. Velg 1–10 for å stille inn rytmer, pauser, sprang og markeringer.";
    }
    const read = $("#levelRead");
    if (read) read.textContent = idx >= 0 ? String(idx + 1) : "–";
    const down = $("#btnLevelDown");
    const up = $("#btnLevelUp");
    if (down) down.disabled = idx === 0;
    if (up) up.disabled = idx === LEVELS.length - 1;
  }

  function stepLevel(dir) {
    const idx = levelIndex();
    const n = idx < 0 ? 1 : idx + 1 + dir;
    if (n < 1 || n > LEVELS.length) return;
    applyLevel(n);
  }

  function applyLevel(n) {
    const p = LEVELS[n - 1];
    if (!p) return;
    settings.rhythms = p.rhythms.slice();
    settings.rests = p.rests.slice();
    settings.maxLeap = p.maxLeap;
    settings.rhythmDensity = p.rhythmDensity;
    settings.measures = p.measures;
    settings.allowRests = p.allowRests;
    settings.syncopation = p.syncopation;
    settings.ties = p.ties;
    settings.accidentals = p.accidentals;
    settings.dynamics = p.dynamics;
    if (settings.instrumentId === "trumpet") {
      settings.legato = n >= 3;
      settings.rangeLow = n <= 4 ? 60 : n <= 6 ? 58 : 55;
      settings.rangeHigh = n <= 2 ? 67 : n <= 4 ? 72 : n <= 6 ? 74 : 79;
      syncRangeSliders();
    } else {
      settings.legato = false;
    }
    if ($("#maxLeap")) $("#maxLeap").value = String(p.maxLeap);
    if ($("#density")) $("#density").value = String(p.rhythmDensity);
    if ($("#measures")) $("#measures").value = String(p.measures);
    ["allowRests", "syncopation", "ties", "accidentals", "dynamics", "legato"].forEach((k) => {
      const el = $("#" + k);
      if (el) el.checked = !!settings[k];
    });
    saveSettings();
    buildRhythmToggles($("#rhythms"), "rhythms", settings.rhythms);
    buildRhythmToggles($("#rests"), "rests", settings.rests);
    markLevel();
    openSettings(false);
    requestAnimationFrame(() => requestAnimationFrame(generate));
  }

  function buildRhythmToggles(container, key, selected) {
    container.innerHTML = "";
    const list = key === "rests" ? T.DURATIONS.filter((d) => !d.group) : T.DURATIONS;
    list.forEach((d) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip" + (selected.includes(d.id) ? " on" : "");
      btn.textContent = d.name;
      btn.dataset.id = d.id;
      btn.addEventListener("click", () => {
        const set = new Set(settings[key]);
        if (set.has(d.id)) {
          if (set.size > 1) set.delete(d.id);
        } else set.add(d.id);
        settings[key] = list.map((x) => x.id).filter((id) => set.has(id));
        saveSettings();
        buildRhythmToggles(container, key, settings[key]);
      });
      container.appendChild(btn);
    });
    if (key === "rhythms") {
      const now = selected.slice().sort().join("|");
      document.querySelectorAll("[data-rhythm-preset]").forEach((btn) => {
        const ids = rhythmPresetIds(btn.dataset.rhythmPreset).slice().sort().join("|");
        btn.classList.toggle("on", ids === now);
      });
    }
    markLevel();
  }

  function buildStopIntervalToggles() {
    const box = $("#stopIntervals");
    if (!box) return;
    const opts = [
      { id: "3", name: "Ters" },
      { id: "4", name: "Kvart" },
      { id: "5", name: "Kvint" },
      { id: "6", name: "Sekst" },
      { id: "8", name: "Oktav" },
    ];
    if (!settings.stopIntervals) settings.stopIntervals = ["3", "4", "5", "6", "8"];
    box.innerHTML = "";
    opts.forEach((d) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip" + (settings.stopIntervals.includes(d.id) ? " on" : "");
      btn.textContent = d.name;
      btn.addEventListener("click", () => {
        const set = new Set(settings.stopIntervals);
        if (set.has(d.id)) {
          if (set.size > 1) set.delete(d.id);
        } else set.add(d.id);
        settings.stopIntervals = opts.map((x) => x.id).filter((id) => set.has(id));
        saveSettings();
        buildStopIntervalToggles();
      });
      box.appendChild(btn);
    });
  }

  /** Short Norwegian key name for a chip: "Fiss-dur" → "Fiss", "h-moll" → "h". */
  function keyChipLabel(key) {
    return key.name.split("-")[0];
  }

  let keyStep = 0;
  let keyStepFor = "";

  function selectedKeysInCircle() {
    const ids = new Set(settings.keyIds || []);
    return T.KEYS.filter((k) => ids.has(k.id)).slice().sort((a, b) => T.circleRank(a) - T.circleRank(b));
  }

  function selectionToken() {
    return (settings.keyIds || []).slice().sort().join("|");
  }

  function resetKeyStepIfNeeded() {
    const token = selectionToken();
    if (token !== keyStepFor) {
      keyStep = 0;
      keyStepFor = token;
    }
  }

  function keyModeText() {
    const ordered = selectedKeysInCircle();
    if (ordered.length <= 1) {
      return (ordered[0] ? ordered[0].name : "Én toneart") + " · fast";
    }
    const next = ordered[keyStep % ordered.length];
    return "Neste · " + next.name;
  }

  function syncLegacyKeyId() {
    settings.keyId = settings.keyIds.length === 1 ? settings.keyIds[0] : "random";
  }

  function setKeyIds(ids) {
    const valid = new Set(T.KEYS.map((k) => k.id));
    const next = [];
    ids.forEach((id) => {
      if (valid.has(id) && next.indexOf(id) < 0) next.push(id);
    });
    settings.keyIds = next.length ? next : ["C"];
    keyStep = 0;
    keyStepFor = selectionToken();
    syncLegacyKeyId();
    saveSettings();
    buildKeyToggles();
  }

  function buildKeyToggles() {
    const majorBox = $("#keysMajorChips");
    const minorBox = $("#keysMinorChips");
    if (!majorBox || !minorBox) return;
    if (!settings.keyIds || !settings.keyIds.length) settings.keyIds = ["C"];
    function fill(box, keys) {
      box.innerHTML = "";
      keys.forEach((k) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "chip" + (settings.keyIds.indexOf(k.id) >= 0 ? " on" : "");
        btn.textContent = keyChipLabel(k);
        btn.title = k.name;
        btn.addEventListener("click", () => {
          const set = new Set(settings.keyIds);
          if (set.has(k.id)) {
            if (set.size > 1) set.delete(k.id);
          } else set.add(k.id);
          setKeyIds(T.KEYS.map((x) => x.id).filter((id) => set.has(id)));
        });
        box.appendChild(btn);
      });
    }
    fill(majorBox, T.KEYS.filter((k) => !k.id.endsWith("m")).sort((a, b) => T.circleRank(a) - T.circleRank(b)));
    fill(minorBox, T.KEYS.filter((k) => k.id.endsWith("m")).sort((a, b) => T.circleRank(a) - T.circleRank(b)));
    const ids = settings.keyIds.slice().sort().join(",");
    const all = T.KEYS.map((k) => k.id).sort().join(",");
    const majors = T.KEYS.filter((k) => !k.id.endsWith("m")).map((k) => k.id).sort().join(",");
    const minors = T.KEYS.filter((k) => k.id.endsWith("m")).map((k) => k.id).sort().join(",");
    if ($("#keysAll")) $("#keysAll").classList.toggle("on", ids === all);
    if ($("#keysMajor")) $("#keysMajor").classList.toggle("on", ids === majors);
    if ($("#keysMinor")) $("#keysMinor").classList.toggle("on", ids === minors);
    if ($("#keyModeHint")) $("#keyModeHint").textContent = keyModeText();
  }

  function textureOptions() {
    if (settings.mallets === 2) {
      return [
        { id: "mixed", name: "Melodi med akkorder" },
        { id: "melody", name: "Bare én linje" },
        { id: "doublestops", name: "Mest akkorder" },
      ];
    }
    if (settings.mallets === 3) {
      return [
        { id: "mixed", name: "Melodi med akkorder" },
        { id: "melody", name: "Bare én linje" },
        { id: "block", name: "Bare treklanger" },
      ];
    }
    return [
      { id: "mixed", name: "Melodi med akkorder" },
      { id: "melody", name: "Bare én linje" },
      { id: "block", name: "Bare blokkakkorder" },
      { id: "chorale", name: "Koral / lange akkorder" },
    ];
  }

  function syncTexture() {
    const opts = textureOptions();
    if (!opts.some((o) => o.id === settings.texture)) settings.texture = opts[0].id;
    fillSelect($("#texture"), opts, settings.texture);
  }

  function bindUI() {
    const isTrumpet = currentProfile() === "trumpet";
    const availableInstruments = isTrumpet
      ? T.INSTRUMENTS.filter((i) => i.id === "trumpet")
      : T.INSTRUMENTS.filter((i) => i.id !== "trumpet");
    fillSelect($("#instrument"), availableInstruments, settings.instrumentId);
    buildKeyToggles();
    fillSelect(
      $("#time"),
      [{ id: "random", name: "Tilfeldig taktart" }].concat(T.TIMES),
      settings.timeId,
      (t) => t.name || t.id
    );
    fillSelect($("#maxLeap"), T.LEAPS, String(settings.maxLeap), (l) => l.name, (l) => String(l.id));
    fillSelect(
      $("#clef"),
      [
        { id: "auto", name: "Auto" },
        { id: "treble", name: "G-nøkkel" },
        { id: "bass", name: "F-nøkkel" },
        { id: "grand", name: "Pianosystem" },
      ],
      settings.clef
    );
    syncTexture();

    $("#mallets").value = String(settings.mallets);
    $("#measures").value = String(settings.measures);
    $("#tempo").value = String(settings.tempo);
    $("#tempoVal").textContent = settings.tempo;
    $("#density").value = String(settings.rhythmDensity);
    syncRangeSliders();
    $("#handSpanMax").value = String(settings.handSpanMax);
    $("#gripShift").value = String(settings.maxGripShift);
    if ($("#handSpanLbl")) $("#handSpanLbl").textContent = settings.handSpanMax;
    if ($("#gripShiftLbl")) $("#gripShiftLbl").textContent = settings.maxGripShift;
    if ($("#voicing")) $("#voicing").value = settings.voicing || "closed";
    if ($("#blockSize")) $("#blockSize").value = settings.blockSize || "mix";
    $("#rolls").value = settings.rolls;
    $("#annotate").value = settings.annotate;
    if ($("#chordChance")) {
      $("#chordChance").value = String(Math.round((settings.chordChance || 0.28) * 100));
      $("#chordChanceLbl").textContent = $("#chordChance").value + "%";
    }

    [
      "allowRests",
      "syncopation",
      "ties",
      "accidentals",
      "startTonic",
      "endTonic",
      "accents",
      "staccato",
      "legato",
      "dynamics",
      "showSticking",
    ].forEach((k) => {
      const el = $("#" + k);
      if (el) el.checked = !!settings[k];
    });

    if ($("#duetEnabled")) $("#duetEnabled").checked = !!settings.duetEnabled;
    if ($("#duetMalletInstrument")) $("#duetMalletInstrument").value = settings.duetMalletInstrument || "xylo";
    if ($("#duetToolbarMalletSelect")) $("#duetToolbarMalletSelect").value = settings.duetMalletInstrument || "xylo";
    const mCnt = String(settings.duetMallets || settings.mallets || 2);
    if ($("#duetToolbarMalletCount")) $("#duetToolbarMalletCount").value = mCnt;
    if ($("#duetMallets")) $("#duetMallets").value = mCnt;
    if ($("#duetStyle")) $("#duetStyle").value = settings.duetStyle || "harmony";
    if ($("#duetViewSelect")) $("#duetViewSelect").value = settings.duetViewPart || "score";
    if ($("#duetAllowChords")) $("#duetAllowChords").checked = settings.duetAllowChords !== false;
    if ($("#duetPlayTrumpet")) $("#duetPlayTrumpet").checked = settings.duetPlayTrumpet !== false;
    if ($("#duetPlayMallets")) $("#duetPlayMallets").checked = settings.duetPlayMallets !== false;
    if ($("#btnDuetToggle")) $("#btnDuetToggle").classList.toggle("on", !!settings.duetEnabled);

    const isDuet = Boolean(settings.duetEnabled);
    if ($("#soloRangeControls")) $("#soloRangeControls").hidden = isDuet;
    if ($("#duetRangeControls")) $("#duetRangeControls").hidden = !isDuet;

    syncDuetRangeSliders(false);

    buildRhythmToggles($("#rhythms"), "rhythms", settings.rhythms);
    buildRhythmToggles($("#rests"), "rests", settings.rests);
    document.querySelectorAll("[data-rhythm-preset]").forEach((btn) => {
      btn.addEventListener("click", () => {
        settings.rhythms = rhythmPresetIds(btn.dataset.rhythmPreset);
        saveSettings();
        buildRhythmToggles($("#rhythms"), "rhythms", settings.rhythms);
      });
    });
    document.querySelectorAll("[data-level]").forEach((btn) => {
      btn.addEventListener("click", () => applyLevel(Number(btn.dataset.level)));
    });
    buildStopIntervalToggles();
    if ($("#stopPlace")) $("#stopPlace").value = settings.stopPlace || "below";
    if ($("#keysAll")) {
      $("#keysAll").addEventListener("click", () => setKeyIds(T.KEYS.map((k) => k.id)));
    }
    if ($("#keysMajor")) {
      $("#keysMajor").addEventListener("click", () => {
        setKeyIds(T.KEYS.filter((k) => !k.id.endsWith("m")).map((k) => k.id));
      });
    }
    if ($("#keysMinor")) {
      $("#keysMinor").addEventListener("click", () => {
        setKeyIds(T.KEYS.filter((k) => k.id.endsWith("m")).map((k) => k.id));
      });
    }
    updateMalletHints();
  }

  function updateMalletHints() {
    const isTrumpet = currentProfile() === "trumpet";
    const malletsRow = $("#malletsRow");
    if (malletsRow) {
      malletsRow.hidden = isTrumpet && !settings.duetEnabled;
      const lbl = malletsRow.querySelector("label");
      if (lbl) lbl.textContent = settings.duetEnabled ? "Køller (slagverk)" : "Køller";
    }
    const multi = !isTrumpet && settings.mallets >= 3 && settings.texture !== "melody" && settings.texture !== "mixed";
    $all(".multi-only").forEach((el) => {
      el.hidden = !multi;
    });
    const textureRow = $("#textureRow");
    if (textureRow) textureRow.hidden = isTrumpet;
    const twoStop = !isTrumpet && settings.mallets === 2 && (settings.texture === "mixed" || settings.texture === "doublestops");
    const mix = $("#chordChanceRow");
    if (mix) mix.hidden = isTrumpet || !(settings.texture === "mixed" || settings.texture === "doublestops");
    const ds = $("#doubleStopRow");
    if (ds) ds.hidden = isTrumpet || !twoStop;
    const clefRow = $("#clefRow");
    if (clefRow) clefRow.hidden = isTrumpet;
    const rollsRow = $("#rollsRow");
    if (rollsRow) rollsRow.hidden = isTrumpet;

    if ($("#brandTitle")) {
      $("#brandTitle").textContent = isTrumpet ? "Trompet Bladlesing" : "Mallet Sight Reader";
    }
    if ($("#brandSubtitle")) {
      $("#brandSubtitle").textContent = isTrumpet ? "Trompet i B" : "v1.4 · 2–4 køller";
    }
    if ($("#showStickingLabel")) {
      $("#showStickingLabel").textContent = isTrumpet ? "Vis ventilgrep" : "Vis køllenummer";
    }

    if ($("#chordChanceTitle")) {
      $("#chordChanceTitle").textContent = "Akkorder i linjen";
    }
    if ($("#chordChanceHint")) {
      $("#chordChanceHint").textContent = settings.mallets === 2
        ? "Samme rytme. Den ekstra tonen er et valgt intervall fra melodien."
        : "Melodien fortsetter, og akkorder kommer på noen av de lengre tonene.";
    }
    const inst = T.INSTRUMENTS.find((i) => i.id === settings.instrumentId);
    const lockTreble = (inst && inst.defaultClef === "treble") || isTrumpet;
    if ($("#clef")) {
      $("#clef").disabled = !!lockTreble;
      if (lockTreble) {
        settings.clef = "treble";
        $("#clef").value = "treble";
      }
    }
  }

  function readInputs() {
    const isTrumpet = currentProfile() === "trumpet";
    settings.instrumentId = isTrumpet ? "trumpet" : $("#instrument").value;
    if (settings.duetEnabled) {
      const dm = parseInt(($("#duetToolbarMalletCount") && $("#duetToolbarMalletCount").value) || ($("#duetMallets") && $("#duetMallets").value) || ($("#mallets") && $("#mallets").value) || "2", 10);
      settings.duetMallets = dm;
      settings.mallets = dm;
    } else {
      settings.mallets = isTrumpet ? 1 : parseInt($("#mallets").value, 10);
    }
    settings.texture = isTrumpet ? "melody" : $("#texture").value;
    settings.clef = isTrumpet ? "treble" : $("#clef").value;
    const instClef = T.INSTRUMENTS.find((i) => i.id === settings.instrumentId);
    if (instClef && instClef.defaultClef === "treble") settings.clef = "treble";
    settings.timeId = $("#time").value;
    syncLegacyKeyId();
    settings.measures = parseInt($("#measures").value, 10);
    settings.tempo = parseInt($("#tempo").value, 10);
    settings.maxLeap = parseInt($("#maxLeap").value, 10);
    settings.rhythmDensity = parseInt($("#density").value, 10);
    readRangeSliders();
    settings.handSpanMax = parseInt($("#handSpanMax").value, 10);
    settings.maxGripShift = parseInt($("#gripShift").value, 10);
    if ($("#voicing")) settings.voicing = $("#voicing").value;
    if ($("#blockSize")) settings.blockSize = $("#blockSize").value;
    settings.rolls = isTrumpet ? "off" : $("#rolls").value;
    settings.annotate = $("#annotate").value;
    if ($("#chordChance")) settings.chordChance = isTrumpet ? 0 : parseInt($("#chordChance").value, 10) / 100;
    if ($("#stopPlace")) settings.stopPlace = $("#stopPlace").value;
    [
      "allowRests",
      "syncopation",
      "ties",
      "accidentals",
      "startTonic",
      "endTonic",
      "accents",
      "staccato",
      "legato",
      "dynamics",
      "showSticking",
    ].forEach((k) => {
      const el = $("#" + k);
      if (el) settings[k] = el.checked;
    });
    if ($("#duetEnabled")) settings.duetEnabled = $("#duetEnabled").checked;
    if ($("#duetToolbarMalletSelect")) settings.duetMalletInstrument = $("#duetToolbarMalletSelect").value;
    else if ($("#duetMalletInstrument")) settings.duetMalletInstrument = $("#duetMalletInstrument").value;
    if ($("#duetStyle")) settings.duetStyle = $("#duetStyle").value;
    if ($("#duetViewSelect")) settings.duetViewPart = $("#duetViewSelect").value;
    if ($("#duetAllowChords")) settings.duetAllowChords = $("#duetAllowChords").checked;
    if ($("#duetPlayTrumpet")) settings.duetPlayTrumpet = $("#duetPlayTrumpet").checked;
    if ($("#duetPlayMallets")) settings.duetPlayMallets = $("#duetPlayMallets").checked;
    if ($("#rangeTptLow")) settings.duetRangeTptLow = Number($("#rangeTptLow").value);
    else if ($("#duetRangeTptLow")) settings.duetRangeTptLow = Number($("#duetRangeTptLow").value);
    if ($("#rangeTptHigh")) settings.duetRangeTptHigh = Number($("#rangeTptHigh").value);
    else if ($("#duetRangeTptHigh")) settings.duetRangeTptHigh = Number($("#duetRangeTptHigh").value);
    if ($("#rangeMalletLow")) settings.duetRangeMalletLow = Number($("#rangeMalletLow").value);
    else if ($("#duetRangeMalletLow")) settings.duetRangeMalletLow = Number($("#duetRangeMalletLow").value);
    if ($("#rangeMalletHigh")) settings.duetRangeMalletHigh = Number($("#rangeMalletHigh").value);
    else if ($("#duetRangeMalletHigh")) settings.duetRangeMalletHigh = Number($("#duetRangeMalletHigh").value);
    if (settings.duetRangeTptLow > settings.duetRangeTptHigh) {
      const t = settings.duetRangeTptLow;
      settings.duetRangeTptLow = settings.duetRangeTptHigh;
      settings.duetRangeTptHigh = t;
    }
    if (settings.duetRangeMalletLow > settings.duetRangeMalletHigh) {
      const t = settings.duetRangeMalletLow;
      settings.duetRangeMalletLow = settings.duetRangeMalletHigh;
      settings.duetRangeMalletHigh = t;
    }
    if (settings.rangeLow > settings.rangeHigh) {
      const t = settings.rangeLow;
      settings.rangeLow = settings.rangeHigh;
      settings.rangeHigh = t;
    }
    saveSettings();
    markLevel();
  }

  function renderOptions() {
    return {
      zoom: settings.zoom,
      showSticking: settings.showSticking,
      annotate: settings.annotate,
      viewPart: settings.duetViewPart || "score",
    };
  }

  function resetPlayButton() {
    const btn = $("#btnPlay");
    if (!btn) return;
    btn.classList.remove("on");
    btn.textContent = "Spill";
  }

  function resetMetroButton() {
    const btn = $("#btnMetro");
    if (!btn) return;
    btn.classList.remove("on");
    btn.textContent = "Metronom";
  }

  function haltPlay() {
    if (typeof AudioEngine === "undefined" || !AudioEngine.isPlaying()) return;
    if (!remoteCall && window.MusikkSync && window.MusikkSync.isController && window.MusikkSync.isController()) {
      window.MusikkSync.sightAction("stopPlay");
    }
    AudioEngine.stopPlayback();
    resetPlayButton();
    if (!AudioEngine.isMetro()) {
      resetMetroButton();
    }
    if (typeof ScoreRenderer !== "undefined") ScoreRenderer.clearBeat();
  }

  function cursorBeatTicks(time) {
    if (!time) return 24;
    if (time.id === "3/8") return 12;
    return time.beatTicks || 24;
  }

  function paintScore() {
    haltPlay();
    if (typeof AudioEngine !== "undefined" && AudioEngine.isMetro()) {
      AudioEngine.stopMetronome();
      resetMetroButton();
    }
    ScoreRenderer.clearBeat();
    currentVisual = ScoreRenderer.renderScore($("#score"), currentScore, renderOptions());
    const beatTicks = cursorBeatTicks(currentScore && currentScore.time);
    beatMap = ScoreRenderer.prepareCursor(currentVisual, settings.tempo, beatTicks) || [];
    practiceBeat = 0;
    const line = $("#practiceLine");
    if (line && currentScore) {
      if (currentScore.isDuet) {
        const styleName =
          currentScore.duetStyle === "call_response"
            ? "Ekkolek"
            : currentScore.duetStyle === "melody_comp"
              ? "Melodi & komp"
              : "Terser & sekster";
        const mName = currentScore.malletInstrumentName || "Slagverk";
        line.textContent = [
          "Duett: " + styleName,
          currentScore.key && currentScore.key.name + (currentScore.trumpetKey ? " (Trompet i " + currentScore.trumpetKey.name + ")" : ""),
          currentScore.time && currentScore.time.id,
          "Trompet (B) + " + mName,
        ].filter(Boolean).join(" · ");
      } else {
        const idx = levelIndex();
        const inst = T.INSTRUMENTS.find((i) => i.id === currentScore.settingsSnapshot.instrument);
        line.textContent = [
          idx >= 0 ? "Nivå " + (idx + 1) : "Egendefinert",
          currentScore.key && currentScore.key.name,
          currentScore.time && currentScore.time.id,
          inst ? inst.name : (currentProfile() === "trumpet" ? "Trompet (B)" : "Køller"),
        ].filter(Boolean).join(" · ");
      }
    }

    const duetToolbar = $("#duetToolbar");
    if (duetToolbar) {
      const isDuet = Boolean(currentScore && currentScore.isDuet);
      duetToolbar.hidden = !isDuet;
      if (isDuet) {
        const vp = settings.duetViewPart || "score";
        $all("[data-duet-view]").forEach((btn) => {
          btn.classList.toggle("active", btn.getAttribute("data-duet-view") === vp);
        });
        const btnTpt = $("#btnMuteTrumpet");
        if (btnTpt) {
          btnTpt.classList.toggle("active", settings.duetPlayTrumpet !== false);
          btnTpt.classList.toggle("muted", settings.duetPlayTrumpet === false);
        }
        const btnMal = $("#btnMuteMallets");
        if (btnMal) {
          btnMal.classList.toggle("active", settings.duetPlayMallets !== false);
          btnMal.classList.toggle("muted", settings.duetPlayMallets === false);
        }
        const btnPairView = $("#btnDuetPairView");
        if (btnPairView) {
          const isCtrl = Boolean(window.MusikkSync && window.MusikkSync.isController && window.MusikkSync.isController());
          btnPairView.hidden = !isCtrl;
          if (isCtrl) {
            btnPairView.classList.toggle("active", Boolean(window.MusikkSync.isDuetViewPaired && window.MusikkSync.isDuetViewPaired()));
          }
        }
      }
    }
    const btnDuetToggle = $("#btnDuetToggle");
    if (btnDuetToggle) {
      btnDuetToggle.classList.toggle("on", !!settings.duetEnabled);
    }
  }

  function generate(seedOverride) {
    readInputs();
    applyInstrumentRange(false);
    if (!remoteCall && typeof seedOverride !== "number") {
      resetKeyStepIfNeeded();
      settings.keyIndex = keyStep;
    } else if (typeof settings.keyIndex === "number" && Number.isFinite(settings.keyIndex)) {
      keyStep = settings.keyIndex;
      keyStepFor = selectionToken();
    }
    const seed = typeof seedOverride === "number" && Number.isFinite(seedOverride)
      ? (seedOverride >>> 0)
      : ((Math.random() * 0xffffffff) >>> 0);
    currentSeed = seed;
    try {
      if (settings.duetEnabled) {
        const lvlIdx = levelIndex();
        const duetLevel = lvlIdx >= 0
          ? lvlIdx + 1
          : Math.max(1, Math.min(10, (Number(settings.rhythmDensity) || 2) * 2));
        currentScore = Generator.generateDuet(Object.assign({}, settings, { level: duetLevel, seed }));
        if (window.AudioEngine && typeof AudioEngine.loadInstrument === "function") {
          AudioEngine.loadInstrument("trumpet");
          AudioEngine.loadInstrument(settings.duetMalletInstrument || "xylo");
        }
      } else {
        currentScore = Generator.generate(Object.assign({}, settings, { seed }));
      }
      const n = selectedKeysInCircle().length;
      if (n > 1) keyStep = (keyStep + 1) % n;
      if ($("#keyModeHint")) $("#keyModeHint").textContent = keyModeText();
      paintScore();
      if (!remoteCall && window.MusikkSync && window.MusikkSync.isController && window.MusikkSync.isController() && currentScore) {
        if (window.MusikkSync.sightSeed) {
          window.MusikkSync.sightSeed(seed, compactSyncSettings(), settings.tempo);
        } else if (window.MusikkSync.sightScore) {
          window.MusikkSync.sightScore(currentScore, settings.tempo);
        }
      }
    } catch (err) {
      console.error(err);
      $("#score").innerHTML =
        '<p class="error">Kunne ikke tegne denne etyden. Prøv færre takter, enklere rytmer eller et større register.<br><small>' +
        String(err.message || err) +
        "</small></p>";
    }
  }

  function showSettings(name) {
    const grid = $("#settingsGrid");
    if (grid) grid.hidden = !!name;
    $all("[data-settings-panel]").forEach((panel) => {
      panel.hidden = panel.getAttribute("data-settings-panel") !== name;
    });
    $all(".settings-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-settings") === name);
    });
  }

  function openSettings(open) {
    $("#drawer").classList.toggle("open", open);
    $("#scrim").classList.toggle("open", open);
    document.body.classList.toggle("drawer-open", open);
    if (open) showSettings("");
  }

  function wire() {
    bindUI();

    $("#instrument").addEventListener("change", () => {
      settings.instrumentId = $("#instrument").value;
      applyInstrumentRange(true);
      syncRangeSliders();
      updateMalletHints();
      saveSettings();
    });

    $("#mallets").addEventListener("change", () => {
      settings.mallets = parseInt($("#mallets").value, 10);
      settings.duetMallets = settings.mallets;
      if ($("#duetToolbarMalletCount")) $("#duetToolbarMalletCount").value = String(settings.mallets);
      if ($("#duetMallets")) $("#duetMallets").value = String(settings.mallets);
      settings.texture = settings.mallets === 4 ? "block" : "mixed";
      syncTexture();
      updateMalletHints();
      const inst = T.INSTRUMENTS.find((i) => i.id === settings.instrumentId);
      if (inst && inst.id.indexOf("mar") === 0 && settings.mallets >= 3) {
        settings.rangeLow = inst.low;
        settings.rangeHigh = Math.min(inst.high, Math.max(settings.rangeHigh, 84));
        syncRangeSliders();
        if ($("#clef")) $("#clef").value = "grand";
      }
      saveSettings();
      if (settings.duetEnabled) generate();
    });

    $("#texture").addEventListener("change", () => {
      settings.texture = $("#texture").value;
      updateMalletHints();
      saveSettings();
    });
    if ($("#chordChance")) {
      $("#chordChance").addEventListener("input", () => {
        $("#chordChanceLbl").textContent = $("#chordChance").value + "%";
      });
    }
    $("#handSpanMax").addEventListener("input", () => {
      if ($("#handSpanLbl")) $("#handSpanLbl").textContent = $("#handSpanMax").value;
    });
    $("#gripShift").addEventListener("input", () => {
      if ($("#gripShiftLbl")) $("#gripShiftLbl").textContent = $("#gripShift").value;
    });
    $("#texture").addEventListener("change", () => {
      if ($("#texture").value === "block" && settings.mallets >= 3) {
        const inst = T.INSTRUMENTS.find((i) => i.id === settings.instrumentId);
        if (inst && inst.id.startsWith("mar") && settings.rangeLow > 55) {
          settings.rangeLow = Math.max(inst.low, 48);
          syncRangeSliders();
        }
      }
    });

    function applyTempo(bpm) {
      settings.tempo = Math.max(40, Math.min(160, bpm));
      $("#tempo").value = String(settings.tempo);
      $("#tempoVal").textContent = settings.tempo;
      $("#tempoRead").textContent = settings.tempo;
      if (typeof metroBpm === "function") AudioEngine.setTempo(metroBpm());
      saveSettings();
      if (!remoteCall && window.MusikkSync && window.MusikkSync.isController && window.MusikkSync.isController()) {
        window.MusikkSync.setTempo(settings.tempo);
      }
    }

    $("#tempo").addEventListener("input", () => {
      applyTempo(parseInt($("#tempo").value, 10));
    });
    if ($("#btnTempoDown")) $("#btnTempoDown").addEventListener("click", () => applyTempo(settings.tempo - 5));
    if ($("#btnTempoUp")) $("#btnTempoUp").addEventListener("click", () => applyTempo(settings.tempo + 5));

    $("#rangeLow").addEventListener("input", () => {
      readRangeSliders();
    });
    $("#rangeHigh").addEventListener("input", () => {
      readRangeSliders();
    });

    $("#btnSettings").addEventListener("click", () => openSettings(true));
    $("#btnCloseSettings").addEventListener("click", () => openSettings(false));
    $("#scrim").addEventListener("click", () => openSettings(false));
    $all(".settings-btn").forEach((btn) => {
      btn.addEventListener("click", () => showSettings(btn.getAttribute("data-settings")));
    });
    $all("[data-settings-back]").forEach((btn) => {
      btn.addEventListener("click", () => showSettings(""));
    });
    function generateFresh() {
      openSettings(false);
      requestAnimationFrame(() => requestAnimationFrame(generate));
    }
    $("#btnGenerate").addEventListener("click", generateFresh);
    $("#btnLevelDown").addEventListener("click", () => stepLevel(-1));
    $("#btnLevelUp").addEventListener("click", () => stepLevel(1));
    $("#btnApply").addEventListener("click", generateFresh);

    if ($("#btnDuetToggle")) {
      $("#btnDuetToggle").addEventListener("click", () => {
        settings.duetEnabled = !settings.duetEnabled;
        if ($("#duetEnabled")) $("#duetEnabled").checked = settings.duetEnabled;
        $("#btnDuetToggle").classList.toggle("on", settings.duetEnabled);
        if ($("#soloRangeControls")) $("#soloRangeControls").hidden = settings.duetEnabled;
        if ($("#duetRangeControls")) $("#duetRangeControls").hidden = !settings.duetEnabled;
        if (settings.duetEnabled) {
          syncDuetRangeSliders(false);
        } else {
          syncRangeSliders();
        }
        saveSettings();
        generate();
      });
    }
    if ($("#duetEnabled")) {
      $("#duetEnabled").addEventListener("change", () => {
        settings.duetEnabled = $("#duetEnabled").checked;
        if ($("#btnDuetToggle")) $("#btnDuetToggle").classList.toggle("on", settings.duetEnabled);
        if ($("#soloRangeControls")) $("#soloRangeControls").hidden = settings.duetEnabled;
        if ($("#duetRangeControls")) $("#duetRangeControls").hidden = !settings.duetEnabled;
        if (settings.duetEnabled) {
          syncDuetRangeSliders(false);
        } else {
          syncRangeSliders();
        }
        saveSettings();
      });
    }
    const onMalletInstChange = (newVal) => {
      settings.duetMalletInstrument = newVal;
      if ($("#duetMalletInstrument")) $("#duetMalletInstrument").value = newVal;
      if ($("#duetToolbarMalletSelect")) $("#duetToolbarMalletSelect").value = newVal;
      syncDuetRangeSliders(true);
      saveSettings();
      AudioEngine.loadInstrument(newVal);
      if (settings.duetEnabled) generate();
    };
    if ($("#duetToolbarMalletSelect")) {
      $("#duetToolbarMalletSelect").addEventListener("change", () => {
        onMalletInstChange($("#duetToolbarMalletSelect").value);
      });
    }
    if ($("#duetMalletInstrument")) {
      $("#duetMalletInstrument").addEventListener("change", () => {
        onMalletInstChange($("#duetMalletInstrument").value);
      });
    }

    const onDuetMalletCountChange = (cnt) => {
      const val = parseInt(cnt, 10) || 2;
      settings.mallets = val;
      settings.duetMallets = val;
      if ($("#mallets")) $("#mallets").value = String(val);
      if ($("#duetToolbarMalletCount")) $("#duetToolbarMalletCount").value = String(val);
      if ($("#duetMallets")) $("#duetMallets").value = String(val);
      updateMalletHints();
      saveSettings();
      if (settings.duetEnabled) generate();
    };
    if ($("#duetToolbarMalletCount")) {
      $("#duetToolbarMalletCount").addEventListener("change", () => {
        onDuetMalletCountChange($("#duetToolbarMalletCount").value);
      });
    }
    if ($("#duetMallets")) {
      $("#duetMallets").addEventListener("change", () => {
        onDuetMalletCountChange($("#duetMallets").value);
      });
    }

    if ($("#duetAllowChords")) {
      $("#duetAllowChords").addEventListener("change", () => {
        settings.duetAllowChords = $("#duetAllowChords").checked;
        saveSettings();
        if (settings.duetEnabled) generate();
      });
    }

    [
      { id: "rangeTptLow", pair: "duetRangeTptLow", lbl: "rangeTptLowLbl", pairLbl: "duetRangeTptLowLbl", key: "duetRangeTptLow" },
      { id: "rangeTptHigh", pair: "duetRangeTptHigh", lbl: "rangeTptHighLbl", pairLbl: "duetRangeTptHighLbl", key: "duetRangeTptHigh" },
      { id: "rangeMalletLow", pair: "duetRangeMalletLow", lbl: "rangeMalletLowLbl", pairLbl: "duetRangeMalletLowLbl", key: "duetRangeMalletLow" },
      { id: "rangeMalletHigh", pair: "duetRangeMalletHigh", lbl: "rangeMalletHighLbl", pairLbl: "duetRangeMalletHighLbl", key: "duetRangeMalletHigh" },
    ].forEach((cfg) => {
      [cfg.id, cfg.pair].forEach((domId) => {
        const el = $("#" + domId);
        if (!el) return;
        el.addEventListener("input", () => {
          const val = Number(el.value);
          settings[cfg.key] = val;
          const pairEl = $("#" + (domId === cfg.id ? cfg.pair : cfg.id));
          if (pairEl) pairEl.value = val;
          const lblA = $("#" + cfg.lbl);
          const lblB = $("#" + cfg.pairLbl);
          if (lblA) lblA.textContent = midiLabel(val);
          if (lblB) lblB.textContent = midiLabel(val);
          saveSettings();
        });
        el.addEventListener("change", () => {
          if (settings.duetEnabled) generate();
        });
      });
    });
    if ($("#duetStyle")) {
      $("#duetStyle").addEventListener("change", () => {
        settings.duetStyle = $("#duetStyle").value;
        saveSettings();
      });
    }
    if ($("#duetViewSelect")) {
      $("#duetViewSelect").addEventListener("change", () => {
        settings.duetViewPart = $("#duetViewSelect").value;
        saveSettings();
        if (currentScore && currentScore.isDuet) paintScore();
        if (!remoteCall && window.MusikkSync && window.MusikkSync.isController && window.MusikkSync.isController() && window.MusikkSync.isDuetViewPaired && window.MusikkSync.isDuetViewPaired() && window.MusikkSync.sightDuetView) {
          window.MusikkSync.sightDuetView(settings.duetViewPart);
        }
      });
    }
    $all("[data-duet-view]").forEach((btn) => {
      btn.addEventListener("click", () => {
        settings.duetViewPart = btn.getAttribute("data-duet-view");
        if ($("#duetViewSelect")) $("#duetViewSelect").value = settings.duetViewPart;
        saveSettings();
        if (currentScore && currentScore.isDuet) paintScore();
        if (!remoteCall && window.MusikkSync && window.MusikkSync.isController && window.MusikkSync.isController() && window.MusikkSync.isDuetViewPaired && window.MusikkSync.isDuetViewPaired() && window.MusikkSync.sightDuetView) {
          window.MusikkSync.sightDuetView(settings.duetViewPart);
        }
      });
    });
    if ($("#btnDuetPairView")) {
      $("#btnDuetPairView").addEventListener("click", () => {
        if (!window.MusikkSync || typeof window.MusikkSync.setDuetViewPaired !== "function") return;
        const next = !(window.MusikkSync.isDuetViewPaired && window.MusikkSync.isDuetViewPaired());
        window.MusikkSync.setDuetViewPaired(next);
        $("#btnDuetPairView").classList.toggle("active", next);
      });
    }
    if ($("#btnMuteTrumpet")) {
      $("#btnMuteTrumpet").addEventListener("click", () => {
        settings.duetPlayTrumpet = settings.duetPlayTrumpet === false;
        if ($("#duetPlayTrumpet")) $("#duetPlayTrumpet").checked = settings.duetPlayTrumpet;
        $("#btnMuteTrumpet").classList.toggle("active", settings.duetPlayTrumpet !== false);
        $("#btnMuteTrumpet").classList.toggle("muted", settings.duetPlayTrumpet === false);
        saveSettings();
      });
    }
    if ($("#btnMuteMallets")) {
      $("#btnMuteMallets").addEventListener("click", () => {
        settings.duetPlayMallets = settings.duetPlayMallets === false;
        if ($("#duetPlayMallets")) $("#duetPlayMallets").checked = settings.duetPlayMallets;
        $("#btnMuteMallets").classList.toggle("active", settings.duetPlayMallets !== false);
        $("#btnMuteMallets").classList.toggle("muted", settings.duetPlayMallets === false);
        saveSettings();
      });
    }

    let metroSubdiv = 1;

    function currentTimeSig() {
      return currentScore
        ? currentScore.time
        : T.TIMES.find((t) => t.id === settings.timeId) || T.TIMES[0];
    }

    function metroSpec() {
      const time = currentTimeSig();
      if (time.id === "6/8") return { beats: 2, bpm: settings.tempo * 2 / 3 };
      if (time.id === "2/2") return { beats: 2, bpm: settings.tempo / 2 };
      if (time.den === 8) return { beats: time.num, bpm: settings.tempo * 2 };
      return { beats: time.num || 4, bpm: settings.tempo };
    }

    function metroBpm() {
      return metroSpec().bpm;
    }

    function drawLamps(count) {
      const box = $("#beatLamps");
      if (!box) return;
      box.innerHTML = "";
      for (let i = 0; i < count; i++) {
        const s = document.createElement("span");
        box.appendChild(s);
      }
    }

    function lightBeat(i, count) {
      const box = $("#beatLamps");
      if (!box) return;
      const dots = box.querySelectorAll("span");
      if (dots.length !== count) drawLamps(count);
      box.querySelectorAll("span").forEach((el, n) => {
        el.classList.toggle("on", n === i);
        el.classList.toggle("down", n === i && i === 0);
      });
    }

    function startMetro() {
      const spec = metroSpec();
      drawLamps(spec.beats);
      practiceBeat = 0;
      const musicClicks =
        typeof AudioEngine.scoreMusicClicks === "function"
          ? AudioEngine.scoreMusicClicks(currentScore, spec.beats)
          : 0;
      AudioEngine.setClicks(true);
      AudioEngine.ac();
      $("#btnMetro").classList.add("on");
      $("#btnMetro").textContent = "1";
      ScoreRenderer.showBeat(beatMap, 0);
      AudioEngine.startMetronome(spec.bpm, spec.beats, {
        subdiv: metroSubdiv,
        countIn: 1,
        musicClicks,
        onBeat: (i, count, fromClick, cue) => {
          if (!fromClick) {
            lightBeat(i, count);
            return;
          }
          if (AudioEngine.isPlaying()) return;
          if (cue && cue.phase === "countin") {
            lightBeat(cue.beat, count);
            $("#btnMetro").textContent = String(cue.beat + 1);
            ScoreRenderer.showBeat(beatMap, 0);
          } else {
            const beatIdx = cue ? cue.beat : practiceBeat;
            lightBeat(beatIdx % count, count);
            $("#btnMetro").textContent = "Stopp";
            if (beatMap.length) {
              ScoreRenderer.showBeat(beatMap, Math.min(beatIdx, beatMap.length - 1));
            }
            practiceBeat = beatIdx + 1;
          }
        },
        done: () => {
          resetMetroButton();
          lightBeat(-1, spec.beats);
          ScoreRenderer.clearBeat();
        },
      });
    }

    function endPlay(restartMetro) {
      resetPlayButton();
      ScoreRenderer.clearBeat();
      lightBeat(-1, metroSpec().beats);
      if (restartMetro) startMetro();
      else resetMetroButton();
    }

    $("#btnMetro").addEventListener("click", () => {
      if (AudioEngine.isPlaying()) {
        const on = !$("#btnMetro").classList.contains("on");
        if (!remoteCall && window.MusikkSync && window.MusikkSync.isController && window.MusikkSync.isController()) {
          window.MusikkSync.sightAction(on ? "startMetro" : "stopMetro");
        }
        $("#btnMetro").classList.toggle("on", on);
        AudioEngine.setClicks(on);
        return;
      }
      if (AudioEngine.isMetro()) {
        if (!remoteCall && window.MusikkSync && window.MusikkSync.isController && window.MusikkSync.isController()) {
          window.MusikkSync.sightAction("stopMetro");
        }
        AudioEngine.stopMetronome();
        resetMetroButton();
        lightBeat(-1, metroSpec().beats);
        ScoreRenderer.clearBeat();
      } else {
        if (!remoteCall && window.MusikkSync && window.MusikkSync.isController && window.MusikkSync.isController()) {
          window.MusikkSync.sightAction("startMetro");
        }
        startMetro();
      }
    });

    // Another tool took the shared pulse: show Metronome and Play as off.
    AudioEngine.onHalt(() => {
      if (!remoteCall && window.MusikkSync && window.MusikkSync.isController && window.MusikkSync.isController()) {
        window.MusikkSync.sightAction("stopPlay");
        window.MusikkSync.sightAction("stopMetro");
      }
      resetPlayButton();
      resetMetroButton();
      lightBeat(-1, metroSpec().beats);
      ScoreRenderer.clearBeat();
    });

    // While Øveplan owns the pulse, Metronome and Play show that they gave way.
    const syncYield = () => {
      const yielded = window.MusikkPulse.getState().owner === "oveplan";
      $("#btnMetro").classList.toggle("yielded", yielded);
      $("#btnPlay").classList.toggle("yielded", yielded);
      $("#pulseNote").hidden = !yielded;
      const color = window.MusikkPlan && window.MusikkPlan.activeBlockColor();
      if (color) $("#pulseNote").style.setProperty("--block", color);
    };
    offPulse = window.MusikkPulse.subscribe(syncYield);
    syncYield();

    if ($("#btnSubdiv")) {
      $("#btnSubdiv").addEventListener("click", () => {
        metroSubdiv = metroSubdiv === 1 ? 2 : metroSubdiv === 2 ? 4 : 1;
        $("#btnSubdiv").textContent = metroSubdiv === 1 ? "♩" : metroSubdiv === 2 ? "♪" : "♬";
        $("#btnSubdiv").classList.toggle("on", metroSubdiv > 1);
        AudioEngine.setSubdiv(metroSubdiv);
        if (AudioEngine.isMetro()) startMetro();
      });
    }

    $("#btnPlay").addEventListener("click", () => {
      if (AudioEngine.isPlaying()) {
        if (!remoteCall && window.MusikkSync && window.MusikkSync.isController && window.MusikkSync.isController()) {
          window.MusikkSync.sightAction("stopPlay");
        }
        const resume = metroBeforePlay;
        AudioEngine.stopPlayback();
        endPlay(resume);
        return;
      }
      if (!remoteCall && window.MusikkSync && window.MusikkSync.isController && window.MusikkSync.isController()) {
        if (window.MusikkPlan) window.MusikkPlan.resumeFromBladlesing();
        window.MusikkSync.sightAction("startPlay");
      }
      if (!currentScore) generate();
      if (!currentScore) return;
      // Play carries on a paused SRF block in Øveplan; nothing in Bladlesing pauses it.
      if (window.MusikkPlan) window.MusikkPlan.resumeFromBladlesing();
      metroBeforePlay = AudioEngine.isMetro();
      AudioEngine.stopMetronome();
      AudioEngine.setClicks(true);
      AudioEngine.ac();
      const spec = metroSpec();
      drawLamps(spec.beats);
      beatMap = ScoreRenderer.prepareCursor(currentVisual, settings.tempo, cursorBeatTicks(currentScore.time)) || [];
      $("#btnPlay").classList.add("on");
      $("#btnPlay").textContent = "1";
      $("#btnMetro").classList.add("on");
      AudioEngine.playAlong(currentScore, {
        quarterBpm: settings.tempo,
        clickBpm: spec.bpm,
        beatsPerBar: spec.beats,
        beatTicks: currentScore.time.beatTicks,
        countIn: 1,
        muteTrumpet: settings.duetPlayTrumpet === false,
        muteMallets: settings.duetPlayMallets === false,
        onCue: (q) => {
          if (!AudioEngine.isPlaying()) return;
          const lamp = q.phase === "countin" ? q.beat : q.beat % q.beats;
          lightBeat(lamp, q.beats);
          if (q.phase === "countin") {
            $("#btnPlay").textContent = String(q.beat + 1);
            ScoreRenderer.showBeat(beatMap, 0);
          } else {
            $("#btnPlay").textContent = "Stopp";
            ScoreRenderer.showBeat(beatMap, q.beat);
          }
        },
        done: () => endPlay(metroBeforePlay),
      });
    });

    $("#btnAgain").addEventListener("click", () => {
      if (!currentScore) generate();
      if (!currentScore) return;
      if (!remoteCall && window.MusikkSync && window.MusikkSync.isController && window.MusikkSync.isController()) {
        if (window.MusikkPlan) window.MusikkPlan.resumeFromBladlesing();
        window.MusikkSync.sightAction("again");
      }
      if (AudioEngine.isPlaying()) {
        AudioEngine.stopPlayback();
        endPlay(false);
      }
      remoteCall = true;
      try {
        applyTempo(settings.tempo - 10);
        $("#btnPlay").click();
      } finally {
        remoteCall = false;
      }
    });

    $("#btnZoomOut").addEventListener("click", () => {
      settings.zoom = Math.max(0.7, settings.zoom - 0.1);
      saveSettings();
      if (currentScore) paintScore();
    });
    $("#btnZoomIn").addEventListener("click", () => {
      settings.zoom = Math.min(1.6, settings.zoom + 0.1);
      saveSettings();
      if (currentScore) paintScore();
    });

    window.addEventListener("resize", onResize = () => {
      if (currentScore) paintScore();
    });

    document.addEventListener("keydown", onKey = (e) => {
      if (e.key === "n" || e.key === "N") {
        if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
        generate();
      }
      if (e.key === "Escape") openSettings(false);
    });

    $("#tempoRead").textContent = settings.tempo;
    syncRangeSliders();

    generate();
    wired = true;
  }

  function unmount() {
    try {
      if (window.AudioEngine) {
        const wasPlaying = AudioEngine.isPlaying();
        const wasMetro = AudioEngine.isMetro();
        if (!remoteCall && window.MusikkSync && window.MusikkSync.isController && window.MusikkSync.isController()) {
          if (wasPlaying) window.MusikkSync.sightAction("stopPlay");
          if (wasMetro) window.MusikkSync.sightAction("stopMetro");
        }
        AudioEngine.onHalt(null);
        AudioEngine.stopPlayback();
        AudioEngine.stopMetronome();
      }
    } catch (e) { /* best effort */ }
    if (onResize) window.removeEventListener("resize", onResize);
    if (onKey) document.removeEventListener("keydown", onKey);
    if (offPulse) offPulse();
    offPulse = null;
    onResize = null;
    onKey = null;
    wired = false;
  }

  window.MalletSight = {
    mount(root) {
      host = root || document.getElementById("malletsight-root") || document;
      if (wired) return;
      settings = loadSettings();
      wire();
      if ($("#showStickingLabel")) {
        $("#showStickingLabel").textContent = currentProfile() === "trumpet" ? "Vis ventilgrep" : "Vis køllenummer";
      }
      if (window.AudioEngine && typeof AudioEngine.loadInstrument === "function") {
        AudioEngine.loadInstrument(settings.instrumentId);
        if (settings.duetEnabled || currentProfile() === "trumpet") {
          AudioEngine.loadInstrument("trumpet");
          AudioEngine.loadInstrument(settings.duetMalletInstrument || "xylo");
        }
      }
    },
    unmount,
    isReady() {
      return Boolean(wired && $("#btnPlay"));
    },
    setProfile() {
      settings = loadSettings();
      if (!wired) return true;
      remoteCall = true;
      try {
        haltPlay();
        applyInstrumentRange(true);
        syncRangeSliders();
        syncDuetRangeSliders(false);
        bindUI();
        if ($("#showStickingLabel")) {
          $("#showStickingLabel").textContent = currentProfile() === "trumpet" ? "Vis ventilgrep" : "Vis køllenummer";
        }
        generate();
        if (window.AudioEngine && typeof AudioEngine.loadInstrument === "function") {
          AudioEngine.loadInstrument(settings.instrumentId);
          if (settings.duetEnabled || currentProfile() === "trumpet") {
            AudioEngine.loadInstrument("trumpet");
            AudioEngine.loadInstrument(settings.duetMalletInstrument || "xylo");
          }
        }
      } finally {
        remoteCall = false;
      }
      return true;
    },
    generate() {
      if (!wired) return false;
      remoteCall = true;
      try {
        openSettings(false);
        generate();
      } finally {
        remoteCall = false;
      }
      return true;
    },
    getScore() {
      return currentScore || null;
    },
    getSeed() {
      return currentSeed;
    },
    getSyncSettings() {
      return compactSyncSettings();
    },
    getTempo() {
      return settings.tempo;
    },
    getDuetViewPart() {
      return settings.duetViewPart || "score";
    },
    setDuetViewPart(part) {
      if (part !== "score" && part !== "trumpet" && part !== "mallets") return false;
      settings.duetViewPart = part;
      if ($("#duetViewSelect")) $("#duetViewSelect").value = part;
      saveSettings();
      if (wired && currentScore && currentScore.isDuet) paintScore();
      return true;
    },
    setDuetEnabled(enabled) {
      settings.duetEnabled = Boolean(enabled);
      if ($("#duetEnabled")) $("#duetEnabled").checked = settings.duetEnabled;
      if ($("#btnDuetToggle")) $("#btnDuetToggle").classList.toggle("on", settings.duetEnabled);
      saveSettings();
      if (wired && (!currentScore || Boolean(currentScore.isDuet) !== settings.duetEnabled)) {
        generate();
      }
      return true;
    },
    applySeed(payload) {
      if (!wired || !payload || typeof payload.seed !== "number" || !Number.isFinite(payload.seed)) return false;
      remoteCall = true;
      try {
        openSettings(false);
        if (payload.settings && typeof payload.settings === "object") {
          for (const key of Object.keys(payload.settings)) {
            if (!LOCAL_ONLY_SETTING_KEYS.has(key) && key in settings) {
              settings[key] = payload.settings[key];
            }
          }
          if (typeof payload.settings.keyIndex === "number" && Number.isFinite(payload.settings.keyIndex)) {
            settings.keyIndex = payload.settings.keyIndex;
          }
        }
        if (typeof payload.tempo === "number" && Number.isFinite(payload.tempo)) {
          const clamped = Math.max(40, Math.min(160, Math.round(payload.tempo)));
          settings.tempo = clamped;
          if ($("#tempo")) $("#tempo").value = String(clamped);
          if ($("#tempoVal")) $("#tempoVal").textContent = String(clamped);
          if ($("#tempoRead")) $("#tempoRead").textContent = String(clamped);
        }
        bindUI();
        generate(payload.seed);
      } finally {
        remoteCall = false;
      }
      return true;
    },
    applyScore(score, tempo) {
      if (!wired || !score) return false;
      remoteCall = true;
      try {
        openSettings(false);
        currentScore = score;
        if (typeof score.seed === "number") currentSeed = score.seed;
        settings.duetEnabled = Boolean(score.isDuet);
        if ($("#duetEnabled")) $("#duetEnabled").checked = settings.duetEnabled;
        if ($("#btnDuetToggle")) $("#btnDuetToggle").classList.toggle("on", settings.duetEnabled);
        if (typeof tempo === "number" && Number.isFinite(tempo)) {
          const clamped = Math.max(40, Math.min(160, Math.round(tempo)));
          settings.tempo = clamped;
          if ($("#tempo")) $("#tempo").value = String(clamped);
          if ($("#tempoVal")) $("#tempoVal").textContent = String(clamped);
          if ($("#tempoRead")) $("#tempoRead").textContent = String(clamped);
        }
        if (score.isDuet && window.AudioEngine && typeof AudioEngine.loadInstrument === "function") {
          AudioEngine.loadInstrument("trumpet");
          AudioEngine.loadInstrument(score.malletInstrumentId || "xylo");
        }
        paintScore();
      } finally {
        remoteCall = false;
      }
      return true;
    },
    togglePlay() {
      if (!wired) return false;
      const btn = $("#btnPlay");
      if (!btn) return false;
      remoteCall = true;
      try {
        btn.click();
      } finally {
        remoteCall = false;
      }
      return true;
    },
    startPlay() {
      if (!wired) return false;
      const btn = $("#btnPlay");
      if (!btn) return false;
      remoteCall = true;
      try {
        if (typeof AudioEngine !== "undefined" && AudioEngine.isPlaying()) {
          AudioEngine.stopPlayback();
          endPlay(false);
        }
        btn.click();
      } finally {
        remoteCall = false;
      }
      return true;
    },
    stopPlay() {
      if (!wired) return false;
      remoteCall = true;
      try {
        if (typeof AudioEngine !== "undefined" && AudioEngine.isPlaying()) {
          const resume = metroBeforePlay;
          AudioEngine.stopPlayback();
          endPlay(resume);
        } else {
          resetPlayButton();
          if (typeof ScoreRenderer !== "undefined") ScoreRenderer.clearBeat();
        }
      } finally {
        remoteCall = false;
      }
      return true;
    },
    toggleMetro() {
      if (!wired) return false;
      const btn = $("#btnMetro");
      if (!btn) return false;
      remoteCall = true;
      try {
        btn.click();
      } finally {
        remoteCall = false;
      }
      return true;
    },
    startMetro() {
      if (!wired) return false;
      const btn = $("#btnMetro");
      if (!btn) return false;
      remoteCall = true;
      try {
        if (typeof AudioEngine !== "undefined" && AudioEngine.isPlaying()) {
          btn.classList.add("on");
          AudioEngine.setClicks(true);
        } else if (typeof AudioEngine === "undefined" || !AudioEngine.isMetro()) {
          btn.click();
        }
      } finally {
        remoteCall = false;
      }
      return true;
    },
    stopMetro() {
      if (!wired) return false;
      const btn = $("#btnMetro");
      remoteCall = true;
      try {
        if (typeof AudioEngine !== "undefined" && AudioEngine.isPlaying()) {
          if (btn) btn.classList.remove("on");
          AudioEngine.setClicks(false);
        } else if (typeof AudioEngine !== "undefined" && AudioEngine.isMetro()) {
          AudioEngine.stopMetronome();
          resetMetroButton();
          lightBeat(-1, metroSpec().beats);
          if (typeof ScoreRenderer !== "undefined") ScoreRenderer.clearBeat();
        }
      } finally {
        remoteCall = false;
      }
      return true;
    },
    again() {
      if (!wired) return false;
      const btn = $("#btnAgain");
      if (!btn) return false;
      remoteCall = true;
      try {
        btn.click();
      } finally {
        remoteCall = false;
      }
      return true;
    },
    stopAll() {
      if (!wired) return;
      remoteCall = true;
      try {
        haltPlay();
        if (typeof AudioEngine !== "undefined" && AudioEngine.isMetro()) {
          AudioEngine.stopMetronome();
          resetMetroButton();
          if (typeof ScoreRenderer !== "undefined") ScoreRenderer.clearBeat();
        }
      } finally {
        remoteCall = false;
      }
    },
    setTempo(bpm) {
      if (!wired) return false;
      const clamped = Math.max(40, Math.min(160, Math.round(bpm)));
      settings.tempo = clamped;
      if ($("#tempo")) $("#tempo").value = String(clamped);
      if ($("#tempoVal")) $("#tempoVal").textContent = String(clamped);
      if ($("#tempoRead")) $("#tempoRead").textContent = String(clamped);
      if (typeof AudioEngine !== "undefined") AudioEngine.setTempo(clamped);
      saveSettings();
      return true;
    },
  };
})();
