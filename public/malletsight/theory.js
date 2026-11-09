/* Musical constants and pitch helpers */
(function (global) {
  const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  const INSTRUMENTS = [
    { id: "glock", name: "Klokkespill", low: 79, high: 108, writtenOff: -24, defaultClef: "treble" },
    { id: "xylo", name: "Xylofon", low: 65, high: 108, writtenOff: -12, defaultClef: "treble" },
    { id: "vibes", name: "Vibrafon", low: 53, high: 89, writtenOff: 0, defaultClef: "treble" },
    { id: "mar43", name: "Marimba 4.3", low: 45, high: 96, writtenOff: 0, defaultClef: "auto" },
    { id: "mar50", name: "Marimba 5.0", low: 36, high: 96, writtenOff: 0, defaultClef: "auto" },
  ];

  const KEYS = [
    { id: "C", name: "C-dur", vex: "C", tonic: 0, mode: "major", fifths: 0, flats: false },
    { id: "G", name: "G-dur", vex: "G", tonic: 7, mode: "major", fifths: 1, flats: false },
    { id: "D", name: "D-dur", vex: "D", tonic: 2, mode: "major", fifths: 2, flats: false },
    { id: "A", name: "A-dur", vex: "A", tonic: 9, mode: "major", fifths: 3, flats: false },
    { id: "E", name: "E-dur", vex: "E", tonic: 4, mode: "major", fifths: 4, flats: false },
    { id: "B", name: "H-dur", vex: "B", tonic: 11, mode: "major", fifths: 5, flats: false },
    { id: "F#", name: "Fiss-dur", vex: "F#", tonic: 6, mode: "major", fifths: 6, flats: false },
    { id: "F", name: "F-dur", vex: "F", tonic: 5, mode: "major", fifths: -1, flats: true },
    { id: "Bb", name: "B-dur", vex: "Bb", tonic: 10, mode: "major", fifths: -2, flats: true },
    { id: "Eb", name: "Ess-dur", vex: "Eb", tonic: 3, mode: "major", fifths: -3, flats: true },
    { id: "Ab", name: "Ass-dur", vex: "Ab", tonic: 8, mode: "major", fifths: -4, flats: true },
    { id: "Db", name: "Dess-dur", vex: "Db", tonic: 1, mode: "major", fifths: -5, flats: true },
    { id: "Am", name: "a-moll", vex: "Am", tonic: 9, mode: "harmonic", fifths: 0, flats: false },
    { id: "Em", name: "e-moll", vex: "Em", tonic: 4, mode: "harmonic", fifths: 1, flats: false },
    { id: "Bm", name: "h-moll", vex: "Bm", tonic: 11, mode: "harmonic", fifths: 2, flats: false },
    { id: "F#m", name: "fiss-moll", vex: "F#m", tonic: 6, mode: "harmonic", fifths: 3, flats: false },
    { id: "C#m", name: "ciss-moll", vex: "C#m", tonic: 1, mode: "harmonic", fifths: 4, flats: false },
    { id: "Dm", name: "d-moll", vex: "Dm", tonic: 2, mode: "harmonic", fifths: -1, flats: true },
    { id: "Gm", name: "g-moll", vex: "Gm", tonic: 7, mode: "harmonic", fifths: -2, flats: true },
    { id: "Cm", name: "c-moll", vex: "Cm", tonic: 0, mode: "harmonic", fifths: -3, flats: true },
    { id: "Fm", name: "f-moll", vex: "Fm", tonic: 5, mode: "harmonic", fifths: -4, flats: true },
  ];

  /* 96 ticks per whole note: 32nds and triplets share one grid. */
  const TICKS = { whole: 96, half: 48, quarter: 24, eighth: 12, sixteenth: 6, thirtysecond: 3 };

  const TIMES = [
    { id: "4/4", num: 4, den: 4, ticks: 96, simple: true, beatTicks: 24 },
    { id: "3/4", num: 3, den: 4, ticks: 72, simple: true, beatTicks: 24 },
    { id: "2/4", num: 2, den: 4, ticks: 48, simple: true, beatTicks: 24 },
    { id: "2/2", num: 2, den: 2, ticks: 96, simple: true, beatTicks: 48 },
    { id: "6/8", num: 6, den: 8, ticks: 72, simple: false, beatTicks: 36 },
    { id: "3/8", num: 3, den: 8, ticks: 36, simple: false, beatTicks: 36 },
    { id: "5/8", num: 5, den: 8, ticks: 60, simple: false, beatTicks: 12 },
    { id: "7/8", num: 7, den: 8, ticks: 84, simple: false, beatTicks: 12 },
  ];

  const DURATIONS = [
    { id: "w", name: "Helnote", ticks: 96, dots: 0, beamable: false },
    { id: "h", name: "Halvnote", ticks: 48, dots: 0, beamable: false },
    { id: "hd", name: "Punktert halvnote", ticks: 72, dots: 1, beamable: false },
    { id: "q", name: "Fjerdedel", ticks: 24, dots: 0, beamable: false },
    { id: "qd", name: "Punktert fjerdedel", ticks: 36, dots: 1, beamable: false },
    { id: "qdd", name: "Dobbeltpunktert fjerdedel", ticks: 42, dots: 2, beamable: false },
    { id: "qt", name: "Fjerdedelstriol", ticks: 16, writtenTicks: 24, group: 3, dots: 0, beamable: false },
    { id: "8", name: "Åttendel", ticks: 12, dots: 0, beamable: true },
    { id: "8d", name: "Punktert åttendel", ticks: 18, dots: 1, beamable: true },
    { id: "8t", name: "Åttendelstriol", ticks: 8, writtenTicks: 12, group: 3, dots: 0, beamable: true },
    { id: "16", name: "Sekstendel", ticks: 6, dots: 0, beamable: true },
    { id: "16d", name: "Punktert sekstendel", ticks: 9, dots: 1, beamable: true },
    { id: "16t", name: "Sekstendelstriol", ticks: 4, writtenTicks: 6, group: 3, dots: 0, beamable: true },
    { id: "32", name: "Trettitodel", ticks: 3, dots: 0, beamable: true },
  ];

  const LEAPS = [
    { id: 2, name: "Sekund" },
    { id: 3, name: "Ters" },
    { id: 4, name: "Kvart" },
    { id: 5, name: "Kvint" },
    { id: 6, name: "Sekst" },
    { id: 7, name: "Septim" },
    { id: 8, name: "Oktav" },
    { id: 9, name: "None" },
    { id: 12, name: "Duodesim" },
  ];

  const MAJOR = [0, 2, 4, 5, 7, 9, 11];
  const NAT_MINOR = [0, 2, 3, 5, 7, 8, 10];
  const HAR_MINOR = [0, 2, 3, 5, 7, 8, 11];
  const MEL_MINOR_UP = [0, 2, 3, 5, 7, 9, 11];

  const SHARP_NAMES = ["c", "c#", "d", "d#", "e", "f", "f#", "g", "g#", "a", "a#", "b"];
  const FLAT_NAMES = ["c", "db", "d", "eb", "e", "f", "gb", "g", "ab", "a", "bb", "b"];

  function scalePcs(key) {
    const steps =
      key.mode === "major" ? MAJOR :
      key.mode === "natural" ? NAT_MINOR :
      key.mode === "melodic" ? MEL_MINOR_UP :
      HAR_MINOR;
    return steps.map((s) => (key.tonic + s) % 12);
  }

  function midiOctave(midi) {
    return Math.floor(midi / 12) - 1;
  }

  function midiToName(midi, flats) {
    const pc = ((midi % 12) + 12) % 12;
    return (flats ? FLAT_NAMES : SHARP_NAMES)[pc];
  }

  function midiToVexKey(midi, flats) {
    return midiToName(midi, flats) + "/" + midiOctave(midi);
  }

  const LETTERS = [
    { L: "C", pc: 0 },
    { L: "D", pc: 2 },
    { L: "E", pc: 4 },
    { L: "F", pc: 5 },
    { L: "G", pc: 7 },
    { L: "A", pc: 9 },
    { L: "B", pc: 11 },
  ];
  const SHARP_ORDER = ["F", "C", "G", "D", "A", "E", "B"];
  const FLAT_ORDER = ["B", "E", "A", "D", "G", "C", "F"];

  function signatureAcc(letter, key) {
    const n = key.fifths || 0;
    if (n > 0 && SHARP_ORDER.indexOf(letter) >= 0 && SHARP_ORDER.indexOf(letter) < n) return 1;
    if (n < 0 && FLAT_ORDER.indexOf(letter) >= 0 && FLAT_ORDER.indexOf(letter) < -n) return -1;
    return 0;
  }

  function abcOctave(letter, oct) {
    if (oct <= 1) return letter + ",,,";
    if (oct === 2) return letter + ",,";
    if (oct === 3) return letter + ",";
    if (oct === 4) return letter;
    if (oct === 5) return letter.toLowerCase();
    if (oct === 6) return letter.toLowerCase() + "'";
    if (oct === 7) return letter.toLowerCase() + "''";
    return letter.toLowerCase() + "'''";
  }

  /* Carry accidentals by letter and octave within the current measure. */
  function spellAbc(midi, key, accidentals) {
    const pc = ((midi % 12) + 12) % 12;
    const options = [];
    LETTERS.forEach((item) => {
      let acc = pc - item.pc;
      if (acc > 6) acc -= 12;
      if (acc < -6) acc += 12;
      if (acc < -1 || acc > 1) return;
      const natural = midi - acc;
      const oct = Math.floor(natural / 12) - 1;
      const sig = signatureAcc(item.L, key);
      options.push({ L: item.L, acc: acc, oct: oct, sig: sig });
    });
    const ranked = options.slice().sort((a, b) => spellScore(b, key) - spellScore(a, key));
    const best = ranked[0];
    let mark = "";
    const name = best.L + best.oct;
    const active = accidentals && accidentals.has(name) ? accidentals.get(name) : best.sig;
    if (accidentals) accidentals.set(name, best.acc);
    if (best.acc !== active) {
      if (best.acc === 0) mark = "=";
      else if (best.acc === 1) mark = "^";
      else if (best.acc === -1) mark = "_";
    }
    return mark + abcOctave(best.L, best.oct);
  }

  function spellScore(opt, key) {
    let s = 0;
    if (opt.acc === opt.sig) s += 10;
    if (opt.sig !== 0 && opt.acc === 0) s += 6;
    if (key.flats && opt.acc < 0) s += 3;
    if (!key.flats && opt.acc > 0) s += 3;
    if (opt.acc === 0) s += 1;
    return s;
  }

  /* Prefer spellings that match the key signature. */
  function spellMidi(midi, key) {
    return midiToVexKey(midi, key.flats);
  }

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function randInt(a, b) {
    return a + Math.floor(Math.random() * (b - a + 1));
  }

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function weightedPick(items, weightFn) {
    let total = 0;
    const weights = items.map((it) => {
      const w = Math.max(0, weightFn(it));
      total += w;
      return w;
    });
    if (total <= 0) return pick(items);
    let r = Math.random() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  function diatonicPitches(key, low, high) {
    const pcs = scalePcs(key);
    const out = [];
    for (let m = low; m <= high; m++) {
      if (pcs.includes(((m % 12) + 12) % 12)) out.push(m);
    }
    return out;
  }

  function chromaticPitches(low, high) {
    const out = [];
    for (let m = low; m <= high; m++) out.push(m);
    return out;
  }

  function intervalSemis(nameSteps) {
    /* diatonic "leap size" 2 = 2nd ≈ 1–2 semitones, up to 8 = octave */
    const map = { 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11, 8: 12, 9: 14, 10: 16, 12: 19 };
    return map[nameSteps] || 12;
  }

  function nearestIn(list, target) {
    let best = list[0];
    let d = Math.abs(best - target);
    for (const n of list) {
      const dd = Math.abs(n - target);
      if (dd < d) {
        best = n;
        d = dd;
      }
    }
    return best;
  }

  function chordTonesFrom(rootPc, quality) {
    if (quality === "maj") return [0, 4, 7].map((x) => (rootPc + x) % 12);
    if (quality === "min") return [0, 3, 7].map((x) => (rootPc + x) % 12);
    if (quality === "dim") return [0, 3, 6].map((x) => (rootPc + x) % 12);
    if (quality === "maj7") return [0, 4, 7, 11].map((x) => (rootPc + x) % 12);
    if (quality === "min7") return [0, 3, 7, 10].map((x) => (rootPc + x) % 12);
    if (quality === "dom7") return [0, 4, 7, 10].map((x) => (rootPc + x) % 12);
    return [0, 4, 7].map((x) => (rootPc + x) % 12);
  }

  function diatonicQualities(key) {
    if (key.mode === "major") {
      return [
        { deg: 0, q: "maj" },
        { deg: 1, q: "min" },
        { deg: 2, q: "min" },
        { deg: 3, q: "maj" },
        { deg: 4, q: "maj" },
        { deg: 5, q: "min" },
        { deg: 6, q: "dim" },
      ];
    }
    return [
      { deg: 0, q: "min" },
      { deg: 1, q: "dim" },
      { deg: 2, q: "maj" },
      { deg: 3, q: "min" },
      { deg: 4, q: "maj" },
      { deg: 5, q: "maj" },
      { deg: 6, q: "dim" },
    ];
  }

  /* Fewest accidentals first. Same count: flats before sharps, major before its relative minor. */
  function circleRank(key) {
    const n = Math.abs(key.fifths || 0);
    const sharp = key.fifths > 0 ? 1 : 0;
    const minor = key.id.endsWith("m") ? 1 : 0;
    return n * 4 + sharp * 2 + minor;
  }

  global.Theory = {
    INSTRUMENTS,
    KEYS,
    TIMES,
    TICKS,
    DURATIONS,
    LEAPS,
    scalePcs,
    midiOctave,
    midiToName,
    midiToVexKey,
    spellMidi,
    spellAbc,
    clamp,
    randInt,
    pick,
    circleRank,
    weightedPick,
    diatonicPitches,
    chromaticPitches,
    intervalSemis,
    nearestIn,
    chordTonesFrom,
    diatonicQualities,
    PC,
    writtenOff: function (instrumentId) {
      const inst = INSTRUMENTS.find((i) => i.id === instrumentId);
      return inst && inst.writtenOff ? inst.writtenOff : 0;
    },
  };
})(window);
