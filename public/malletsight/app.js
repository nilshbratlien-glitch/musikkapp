/* global Theory, AudioEngine, ScoreRenderer -- set by the sibling MalletSight scripts */
(function () {
  const T = Theory;
  const STORAGE = "musikkapp.bladlesing";
  const LEGACY = "mallet-sr-settings-v3";
  let host = document.getElementById("malletsight-root") || document;
  let wired = false;
  let onResize = null;
  let onKey = null;
  let offPulse = null;

  const DEFAULTS = {
    instrumentId: "mar50",
    mallets: 2,
    texture: "mixed",
    chordChance: 0.28,
    clef: "auto",
    keyId: "C",
    keyIds: ["C"],
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
  };

  let settings = loadSettings();
  let currentScore = null;
  let currentVisual = null;
  let beatMap = [];
  let practiceBeat = 0;
  let metroBeforePlay = false;

  function migrateKeyIds(keyId) {
    if (!keyId || keyId === "random") return T.KEYS.map((k) => k.id);
    if (T.KEYS.some((k) => k.id === keyId)) return [keyId];
    return ["C"];
  }

  function loadSettings() {
    try {
      let raw = localStorage.getItem(STORAGE);
      let parsed = raw ? JSON.parse(raw) : null;
      const empty = !parsed || (typeof parsed === "object" && !parsed.instrumentId);
      if (empty) {
        const legacy = localStorage.getItem(LEGACY);
        if (legacy) {
          parsed = JSON.parse(legacy);
          try { localStorage.setItem(STORAGE, JSON.stringify(parsed)); } catch (err) { /* best effort */ }
        }
      }
      if (parsed) {
        const merged = Object.assign({}, DEFAULTS, parsed);
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
    return Object.assign({}, DEFAULTS);
  }

  function saveSettings() {
    try { localStorage.setItem(STORAGE, JSON.stringify(settings)); } catch (e) { /* best effort */ }
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
    const wlo = T.clamp(settings.rangeLow + off, SLIDER_LO, SLIDER_HI);
    const whi = T.clamp(settings.rangeHigh + off, SLIDER_LO, SLIDER_HI);
    ["rangeLow", "rangeHigh"].forEach((id) => {
      const el = $("#" + id);
      el.min = String(SLIDER_LO);
      el.max = String(SLIDER_HI);
    });
    $("#rangeLow").value = String(wlo);
    $("#rangeHigh").value = String(whi);
    $("#rangeLowLbl").textContent = midiLabel(wlo);
    $("#rangeHighLbl").textContent = midiLabel(whi);
    if ($("#rangeHint") && inst) {
      $("#rangeHint").textContent =
        "Skrevet " +
        midiLabel(inst.low + off) +
        "–" +
        midiLabel(inst.high + off) +
        " på dette instrumentet. Skalaen går fra C2 til C8.";
    }
  }

  function readRangeSliders() {
    const off = writeOff();
    const inst = T.INSTRUMENTS.find((i) => i.id === settings.instrumentId);
    let wlo = parseInt($("#rangeLow").value, 10);
    let whi = parseInt($("#rangeHigh").value, 10);
    const minW = inst.low + off;
    const maxW = inst.high + off;
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
      settings.rangeLow = inst.low;
      settings.rangeHigh = inst.high;
    }
    settings.rangeLow = Theory.clamp(settings.rangeLow, inst.low, inst.high);
    settings.rangeHigh = Theory.clamp(settings.rangeHigh, inst.low, inst.high);
    if (settings.rangeHigh - settings.rangeLow < 5) settings.rangeHigh = Math.min(inst.high, settings.rangeLow + 12);
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
    { rhythms: ["h", "q", "qd", "8"], rests: ["q", "8"], maxLeap: 5, rhythmDensity: 3, measures: 8, allowRests: true, syncopation: false, ties: true, accidentals: false, dynamics: false, hint: "Punkterte fjerdedeler og overbindinger. Sprang på en kvint." },
    { rhythms: ["q", "qd", "8", "8d", "16"], rests: ["q", "8"], maxLeap: 5, rhythmDensity: 3, measures: 8, allowRests: true, syncopation: false, ties: true, accidentals: false, dynamics: false, hint: "Sekstendeler og punkterte åttendeler." },
    { rhythms: ["q", "qd", "8", "8d", "16"], rests: ["q", "8", "16"], maxLeap: 6, rhythmDensity: 4, measures: 8, allowRests: true, syncopation: true, ties: true, accidentals: true, dynamics: true, hint: "Synkoper, forsetningstegn og dynamikk. Sprang på en sekst." },
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
    if ($("#maxLeap")) $("#maxLeap").value = String(p.maxLeap);
    if ($("#density")) $("#density").value = String(p.rhythmDensity);
    if ($("#measures")) $("#measures").value = String(p.measures);
    ["allowRests", "syncopation", "ties", "accidentals", "dynamics"].forEach((k) => {
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
        { id: "mixed", name: "Melodi med dobbeltgrep" },
        { id: "melody", name: "Bare én linje" },
        { id: "doublestops", name: "Mest dobbeltgrep" },
      ];
    }
    if (settings.mallets === 3) {
      return [
        { id: "mixed", name: "Melodi med akkorder" },
        { id: "melody", name: "Bare én linje" },
        { id: "block", name: "Bare blokker med tre toner" },
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
    fillSelect($("#instrument"), T.INSTRUMENTS, settings.instrumentId);
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
        { id: "treble", name: "Diskant" },
        { id: "bass", name: "Bass" },
        { id: "grand", name: "Dobbelt system" },
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
      "dynamics",
      "showSticking",
    ].forEach((k) => {
      const el = $("#" + k);
      if (el) el.checked = !!settings[k];
    });

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
    const multi = settings.mallets >= 3 && settings.texture !== "melody" && settings.texture !== "mixed";
    $all(".multi-only").forEach((el) => {
      el.hidden = !multi;
    });
    const textureRow = $("#textureRow");
    if (textureRow) textureRow.hidden = false;
    const twoStop = settings.mallets === 2 && (settings.texture === "mixed" || settings.texture === "doublestops");
    const mix = $("#chordChanceRow");
    if (mix) mix.hidden = !(settings.texture === "mixed" || settings.texture === "doublestops");
    const ds = $("#doubleStopRow");
    if (ds) ds.hidden = !twoStop;
    if ($("#chordChanceTitle")) {
      $("#chordChanceTitle").textContent = settings.mallets === 2 ? "Dobbeltgrep i linjen" : "Akkorder i linjen";
    }
    if ($("#chordChanceHint")) {
      $("#chordChanceHint").textContent = settings.mallets === 2
        ? "Samme rytme. Den ekstra tonen er et valgt intervall fra melodien."
        : "Melodien fortsetter, og akkorder kommer på noen av de lengre tonene.";
    }
    const inst = T.INSTRUMENTS.find((i) => i.id === settings.instrumentId);
    const lockTreble = inst && inst.defaultClef === "treble";
    if ($("#clef")) {
      $("#clef").disabled = !!lockTreble;
      if (lockTreble) {
        settings.clef = "treble";
        $("#clef").value = "treble";
      }
    }
  }

  function readInputs() {
    settings.instrumentId = $("#instrument").value;
    settings.mallets = parseInt($("#mallets").value, 10);
    settings.texture = $("#texture").value;
    settings.clef = $("#clef").value;
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
    settings.rolls = $("#rolls").value;
    settings.annotate = $("#annotate").value;
    if ($("#chordChance")) settings.chordChance = parseInt($("#chordChance").value, 10) / 100;
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
      "dynamics",
      "showSticking",
    ].forEach((k) => {
      const el = $("#" + k);
      if (el) settings[k] = el.checked;
    });
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
    };
  }

  function resetPlayButton() {
    const btn = $("#btnPlay");
    if (!btn) return;
    btn.classList.remove("on");
    btn.textContent = "Spill";
  }

  function haltPlay() {
    if (typeof AudioEngine === "undefined" || !AudioEngine.isPlaying()) return;
    AudioEngine.stopPlayback();
    resetPlayButton();
    if (!AudioEngine.isMetro()) {
      const metro = $("#btnMetro");
      if (metro) metro.classList.remove("on");
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
    ScoreRenderer.clearBeat();
    currentVisual = ScoreRenderer.renderScore($("#score"), currentScore, renderOptions());
    const beatTicks = cursorBeatTicks(currentScore && currentScore.time);
    beatMap = ScoreRenderer.prepareCursor(currentVisual, settings.tempo, beatTicks) || [];
    practiceBeat = 0;
    const line = $("#practiceLine");
    if (line && currentScore) {
      const idx = levelIndex();
      const inst = T.INSTRUMENTS.find((i) => i.id === currentScore.settingsSnapshot.instrument);
      line.textContent = [
        idx >= 0 ? "Nivå " + (idx + 1) : "Egendefinert",
        currentScore.key && currentScore.key.name,
        currentScore.time && currentScore.time.id,
        inst ? inst.name : "Køller",
      ].filter(Boolean).join(" · ");
    }
  }

  function generate() {
    readInputs();
    applyInstrumentRange(false);
    resetKeyStepIfNeeded();
    settings.keyIndex = keyStep;
    try {
      currentScore = Generator.generate(settings);
      const n = selectedKeysInCircle().length;
      if (n > 1) keyStep = (keyStep + 1) % n;
      if ($("#keyModeHint")) $("#keyModeHint").textContent = keyModeText();
      paintScore();
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
      AudioEngine.setClicks(true);
      AudioEngine.ac();
      AudioEngine.startMetronome(spec.bpm, spec.beats, {
        subdiv: metroSubdiv,
        onBeat: (i, count, fromClick) => {
          lightBeat(i, count);
          if (!fromClick || !beatMap.length || AudioEngine.isPlaying()) return;
          ScoreRenderer.showBeat(beatMap, practiceBeat % beatMap.length);
          practiceBeat++;
        },
      });
      $("#btnMetro").classList.add("on");
    }

    function endPlay(restartMetro) {
      resetPlayButton();
      ScoreRenderer.clearBeat();
      lightBeat(-1, metroSpec().beats);
      if (restartMetro) startMetro();
      else $("#btnMetro").classList.remove("on");
    }

    $("#btnMetro").addEventListener("click", () => {
      if (AudioEngine.isPlaying()) {
        const on = !$("#btnMetro").classList.contains("on");
        $("#btnMetro").classList.toggle("on", on);
        AudioEngine.setClicks(on);
        return;
      }
      if (AudioEngine.isMetro()) {
        AudioEngine.stopMetronome();
        $("#btnMetro").classList.remove("on");
        lightBeat(-1, metroSpec().beats);
        ScoreRenderer.clearBeat();
      } else {
        startMetro();
      }
    });

    // Another tool took the shared pulse: show Metronome and Play as off.
    AudioEngine.onHalt(() => {
      resetPlayButton();
      $("#btnMetro").classList.remove("on");
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
        const resume = metroBeforePlay;
        AudioEngine.stopPlayback();
        endPlay(resume);
        return;
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
      if (!currentScore) return;
      if (AudioEngine.isPlaying()) {
        AudioEngine.stopPlayback();
        endPlay(false);
      }
      applyTempo(settings.tempo - 10);
      $("#btnPlay").click();
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

    requestAnimationFrame(generate);
    wired = true;
  }

  function unmount() {
    try {
      if (window.AudioEngine) {
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
      wire();
    },
    unmount,
  };
})();
