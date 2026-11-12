/* Sight-reading generator for 2 / 3 / 4 mallet keyboard percussion */
(function (global) {
  const T = global.Theory;

  function durById(id) {
    return T.DURATIONS.find((d) => d.id === id);
  }

  function spanOf(d) {
    return d.ticks * (d.group || 1);
  }

  function emitRhythm(events, choice, rest) {
    const n = choice.group || 1;
    if (n > 1 && rest) {
      const ticks = choice.ticks * n;
      const plain = durById(
        (T.DURATIONS.find((d) => !d.group && d.ticks === ticks) || {}).id
      );
      events.push({ dur: plain || { ticks: ticks, dots: 0, beamable: false }, rest: true });
      return ticks;
    }
    if (n > 1) {
      for (let i = 0; i < n; i++) {
        events.push({
          dur: choice,
          rest: rest,
          tuplet: i === 0 ? "start" : i === n - 1 ? "end" : "mid",
        });
      }
      return choice.ticks * n;
    }
    events.push({ dur: choice, rest: rest });
    return choice.ticks;
  }

  function idsSpan(ids) {
    return ids.reduce((sum, id) => sum + spanOf(durById(id)), 0);
  }

  function featureOf(ids) {
    if (ids.some((id) => id === "8t" || id === "qt")) return "8t";
    if (ids.some((id) => id === "16t")) return "16t";
    if (ids.some((id) => id === "32")) return "32";
    if (ids.some((id) => id === "16" || id === "8d" || id === "16d")) return "16";
    if (ids.some((id) => id === "qd" || id === "qdd" || id === "hd")) return "dot";
    return "plain";
  }

  function featureWeight(name, density) {
    if (name === "plain") return 2.2;
    if (name === "dot") return 1.6;
    if (name === "16") return density >= 4 ? 1.8 : 0.45;
    if (name === "8t") return density >= 3 ? 1.5 : 0.4;
    if (name === "16t" || name === "32") return density >= 5 ? 1.3 : 0.25;
    return 1;
  }

  function asCell(ids) {
    return { ids: ids, key: ids.join("."), feature: featureOf(ids), span: idsSpan(ids) };
  }

  function cellsFitting(has, span) {
    const catalog = [
      ["q"],
      ["8"],
      ["8", "8"],
      ["8", "8", "8"],
      ["8", "8", "8", "8"],
      ["q", "q"],
      ["q", "8", "8"],
      ["8", "8", "q"],
      ["h"],
      ["hd"],
      ["w"],
      ["qd"],
      ["qd", "8"],
      ["qd", "8", "8", "8"],
      ["q", "8"],
      ["8", "q"],
      ["8d", "16"],
      ["16", "8d"],
      ["16", "16"],
      ["16", "16", "16", "16"],
      ["8", "16", "16"],
      ["16", "16", "8"],
      ["16", "8", "16"],
      ["16d", "32"],
      ["32", "32", "32", "32", "32", "32", "32", "32"],
      ["8t"],
      ["16t"],
      ["16t", "16t"],
      ["qt"],
      ["qdd", "16"],
    ];
    return catalog.filter((ids) => ids.every(has) && idsSpan(ids) === span).map(asCell);
  }

  function pickCell(list, density) {
    return T.weightedPick(list, (cell) => {
      const spans = cell.ids.map((id) => durById(id).ticks);
      const shortest = Math.min.apply(null, spans);
      const longest = Math.max.apply(null, spans);
      let w = 1;
      if (density <= 1) w = longest >= 24 ? 3.2 : longest >= 12 ? 1.1 : 0.35;
      else if (density === 2) w = longest >= 24 ? 1.8 : shortest <= 6 ? 0.6 : 1;
      else if (density >= 4) w = shortest <= 12 ? 1.8 : 0.7;
      if (cell.feature !== "plain" && density < 3) w *= 0.45;
      return w;
    });
  }

  function pauseShare(density) {
    if (density <= 1) return 0.42;
    if (density === 2) return 0.26;
    if (density === 3) return 0.14;
    if (density === 4) return 0.07;
    return 0.02;
  }

  function pauseChance(density) {
    if (density <= 1) return 0.72;
    if (density === 2) return 0.45;
    if (density === 3) return 0.24;
    if (density === 4) return 0.1;
    return 0.04;
  }

  function isRunCell(cell) {
    if (!cell || !cell.ids || cell.ids.length < 2) return false;
    return cell.ids.every((id) => {
      const d = durById(id);
      return d && d.ticks <= 12;
    });
  }

  function keyIsRun(key) {
    if (!key) return false;
    const parts = key.split(".").filter(Boolean);
    if (parts.length < 4) return false;
    const shorts = parts.filter((part) => {
      const id = part.replace(/^z/, "");
      return id === "8" || id === "16" || id === "32" || id === "8t" || id === "16t";
    }).length;
    return shorts / parts.length >= 0.75;
  }

  function buildVaried(has, ticks, beat, density, allowRests, avoidKeys) {
    if (!beat || ticks % beat !== 0) return null;
    const beats = ticks / beat;
    const beatList = cellsFitting(has, beat);
    const halfList = beats >= 2 ? cellsFitting(has, beat * 2) : [];
    const barList = cellsFitting(has, ticks).filter((cell) => cell.ids.length > 1);
    const features = {};
    beatList.concat(halfList, barList).forEach((cell) => {
      features[cell.feature] = 1;
    });
    const names = Object.keys(features);
    if (!names.length) return null;

    function once() {
      const feature = T.weightedPick(names, (name) => featureWeight(name, density));
      const ok = (cell) => cell.feature === "plain" || cell.feature === feature;
      const beatsOk = beatList.filter(ok);
      const halvesOk = halfList.filter(ok);
      const barsOk = barList.filter(ok);
      if (!beatsOk.length && !halvesOk.length && !barsOk.length) return null;

      function takeBeat(differ) {
        const pool = differ && beatsOk.length > 1 ? beatsOk.filter((cell) => cell.key !== differ) : beatsOk;
        return pickCell(pool.length ? pool : beatsOk, density);
      }
      function oneHalf() {
        const calmHalves = halvesOk.filter((cell) => !isRunCell(cell));
        if (calmHalves.length && Math.random() < 0.5) return [pickCell(calmHalves, density)];
        if (halvesOk.length && !beatsOk.length) return [pickCell(halvesOk, density)];
        const a = takeBeat();
        let b = takeBeat(a.key);
        if (isRunCell(a) && isRunCell(b)) {
          const calm = beatsOk.filter((cell) => !isRunCell(cell));
          if (calm.length) b = pickCell(calm, density);
        }
        return [a, b];
      }

      let parts = [];
      if (barsOk.length && Math.random() < 0.3) {
        parts = [pickCell(barsOk, density)];
      } else if (beats === 4 && (halvesOk.length || beatsOk.length)) {
        const left = oneHalf();
        let right = oneHalf();
        const leftKey = left.map((cell) => cell.key).join("|");
        let guard = 0;
        while (right.map((cell) => cell.key).join("|") === leftKey && halvesOk.length + beatsOk.length > 1 && guard < 6) {
          right = oneHalf();
          guard++;
        }
        parts = left.concat(right);
      } else if (beats === 2 && (halvesOk.length || beatsOk.length)) {
        if (halvesOk.length && (!beatsOk.length || Math.random() < 0.4)) parts = [pickCell(halvesOk, density)];
        else {
          const a = takeBeat();
          parts = [a, takeBeat(a.key)];
        }
      } else if (beatsOk.length && (beats === 5 || beats === 7)) {
        const group = beats === 5 ? (Math.random() < 0.5 ? [2, 3] : [3, 2]) : Math.random() < 0.5 ? [2, 2, 3] : [3, 2, 2];
        let prev = null;
        group.forEach((len) => {
          const cell = takeBeat(prev);
          for (let i = 0; i < len; i++) parts.push(cell);
          prev = cell.key;
        });
      } else if (beatsOk.length) {
        const a = takeBeat();
        for (let i = 0; i < beats; i++) parts.push(a);
        if (beats > 1) {
          const other = takeBeat(a.key);
          if (other.key !== a.key) {
            parts[beats - 1] = other;
            if (beats >= 3 && Math.random() < 0.45) parts[beats - 2] = other;
          }
        }
      }
      if (!parts.length) return null;
      if (beats === 4 && parts.length >= 2) {
        const runs = parts.filter(isRunCell).length;
        if (runs >= parts.length - 1) {
          const calm = beatsOk.filter((cell) => !isRunCell(cell));
          if (calm.length) {
            const swap = pickCell(calm, density);
            const idx = parts.findIndex((cell) => cell.span === swap.span && isRunCell(cell));
            if (idx >= 0) parts[idx] = swap;
          }
        }
      }
      if (feature !== "plain" && !parts.some((cell) => cell.feature === feature)) {
        const feat = beatsOk.concat(halvesOk, barsOk).filter((cell) => cell.feature === feature);
        const swap = feat.length ? pickCell(feat, density) : null;
        if (swap) {
          const idx = parts.findIndex((cell) => cell.span === swap.span);
          if (idx >= 0) parts[idx] = swap;
        }
      }
      const span = parts.reduce((sum, cell) => sum + cell.span, 0);
      if (span !== ticks) return null;
      const events = [];
      const restState = { pos: 0, restTicks: 0, lastRest: false, bar: ticks };
      parts.forEach((cell) => emitIds(events, cell.ids, allowRests, restState));
      const used = events.reduce((sum, event) => sum + event.dur.ticks, 0);
      if (used !== ticks) return null;
      const ids = parts.reduce((list, cell) => list.concat(cell.ids), []);
      const straight = { q: 1, h: 1, hd: 1, w: 1, "8": 1 };
      events.syncOk = ids.every((id) => straight[id]);
      events.cellKey = events.map((event) => (event.rest ? "z" : "") + event.dur.id).join(".");
      return events;
    }

    function emitIds(events, ids, allow, restState) {
      ids.forEach((id) => {
        const d = durById(id);
        const share = restState.restTicks / restState.bar;
        const canRest =
          allow &&
          restState.pos > 0 &&
          !restState.lastRest &&
          !d.group &&
          share < pauseShare(density) &&
          Math.random() < pauseChance(density);
        const written = emitRhythm(events, d, canRest);
        restState.pos += written;
        if (canRest) restState.restTicks += written;
        restState.lastRest = canRest;
      });
    }

    let last = null;
    const blocked = avoidKeys || [];
    const lastWasRun = keyIsRun(blocked.length ? blocked[blocked.length - 1] : "");
    for (let attempt = 0; attempt < 8; attempt++) {
      const built = once();
      if (!built) continue;
      last = built;
      if (blocked.indexOf(built.cellKey) >= 0) continue;
      if (lastWasRun && keyIsRun(built.cellKey) && attempt < 6) continue;
      return built;
    }
    return last;
  }

  function breakEvenRuns(events, allowed) {
    if (!events || events.length < 4) return events;
    const ids = {};
    allowed.forEach((d) => {
      ids[d.id] = d;
    });
    let splices = 0;
    let run = 0;
    for (let i = 0; i < events.length && splices < 2; i++) {
      const ev = events[i];
      if (!ev.rest && ev.dur && ev.dur.id === "8" && !ev.tuplet) run++;
      else run = 0;
      if (run < 4) continue;
      if (ids["16"]) {
        events.splice(i, 1, { dur: ids["16"], rest: false, tuplet: null }, { dur: ids["16"], rest: false, tuplet: null });
        splices++;
        run = 0;
      } else if (ids.q && i >= 1 && events[i - 1].dur && events[i - 1].dur.id === "8" && !events[i - 1].tuplet && !events[i - 1].rest) {
        events.splice(i - 1, 2, { dur: ids.q, rest: false, tuplet: null });
        splices++;
        run = 0;
        i--;
      }
    }
    return events;
  }

  function rhythmAllowed(events, settings) {
    return events.every((ev) =>
      ev.rest ? settings.allowRests && settings.rests.includes(ev.dur.id) : settings.rhythms.includes(ev.dur.id)
    );
  }

  function buildRhythm(settings, ticks, beatTicks, avoidKeys) {
    const allowed = settings.rhythms.map(durById).filter(Boolean);
    const has = (id) => allowed.some((d) => d.id === id);
    const density = settings.rhythmDensity || 3;
    const varied = buildVaried(has, ticks, beatTicks || T.TICKS.quarter, density, !!settings.allowRests, avoidKeys);
    if (varied) {
      const result = breakEvenRuns(varied, allowed);
      if (rhythmAllowed(result, settings)) return result;
    }

    const restAllowed = settings.allowRests ? settings.rests.map(durById).filter((d) => d && !d.group) : [];
    const units = allowed.concat(restAllowed);
    const canFill = Array(ticks + 1).fill(false);
    canFill[0] = true;
    for (let t = 1; t <= ticks; t++) {
      canFill[t] = units.some((d) => spanOf(d) <= t && canFill[t - spanOf(d)]);
    }
    if (!canFill[ticks]) throw new Error("Valgte note- og pauseverdier kan ikke fylle denne taktarten.");
    const events = [];
    let left = ticks;
    let lastWasRest = false;
    const beat = beatTicks || T.TICKS.quarter;
    const restChance = settings.allowRests ? pauseChance(density) : 0;
    const q = T.TICKS.quarter;
    while (left > 0) {
      const pos = ticks - left;
      const toBeat = beat - (pos % beat);
      const cap = pos % beat === 0 ? left : toBeat;
      const fits = (choices, limit) => choices.filter((d) => spanOf(d) <= limit && canFill[left - spanOf(d)]);
      let noteFits = fits(allowed, cap);
      let restFits = fits(restAllowed, cap);
      if (!noteFits.length && !restFits.length) {
        noteFits = fits(allowed, left);
        restFits = fits(restAllowed, left);
      }
      const useRest = restFits.length > 0 && (!noteFits.length ||
        (!lastWasRest && events.length > 0 && Math.random() < restChance));
      const pool = useRest ? restFits : noteFits;
      const onBeat = pos % beat === 0;
      const choice = T.weightedPick(pool, (d) => {
        const shortBias = density / 5;
        const longBias = 1 - shortBias;
        const span = spanOf(d);
        let s = longBias * span + shortBias * (T.TICKS.whole + 1 - span) + (d.id === "q" ? q : 0);
        if (onBeat && (d.id === "q" || d.id === "h")) s += q;
        if (!onBeat && span >= T.TICKS.half) s *= 0.2;
        return s;
      });
      left -= emitRhythm(events, choice, useRest);
      lastWasRest = useRest;
    }
    events.syncOk = true;
    return events;
  }

  function durByTicks(ticks) {
    return T.DURATIONS.find((d) => !d.group && d.ticks === ticks) || null;
  }

  function syncWindow(beat) {
    if (beat >= 36) return beat;
    if (beat <= 12) return 36;
    return beat * 2;
  }

  /* One offbeat note that holds across the next pulse. The rest of the bar stays. */
  function syncFigures(win, allowRests) {
    const eighth = durByTicks(12);
    const quarter = durByTicks(24);
    const dotted = durByTicks(36);
    const figs = [];
    if (win === 48 && eighth && dotted) {
      figs.push({ w: 6, notes: [{ dur: eighth, rest: false }, { dur: dotted, rest: false }] });
      if (allowRests) figs.push({ w: 2, notes: [{ dur: eighth, rest: true }, { dur: dotted, rest: false }] });
    }
    if (win === 48 && eighth && quarter) {
      figs.push({
        w: 2,
        notes: [
          { dur: eighth, rest: false },
          { dur: quarter, rest: false },
          { dur: eighth, rest: false },
        ],
      });
    }
    if (win === 36 && eighth && quarter) {
      figs.push({ w: 5, notes: [{ dur: eighth, rest: false }, { dur: quarter, rest: false }] });
      if (allowRests) figs.push({ w: 2, notes: [{ dur: eighth, rest: true }, { dur: quarter, rest: false }] });
    }
    return figs;
  }

  function copyRhythm(ev, ticks) {
    const dur = ticks == null ? ev.dur : durByTicks(ticks);
    if (!dur) return null;
    return {
      dur: dur,
      rest: !!ev.rest,
      tuplet: ticks == null ? ev.tuplet || null : null,
    };
  }

  function cutAround(events, start, end) {
    let t = 0;
    const before = [];
    const after = [];
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      const a = t;
      const b = t + ev.dur.ticks;
      t = b;
      if (b <= start) {
        before.push(copyRhythm(ev));
        continue;
      }
      if (a >= end) {
        after.push(copyRhythm(ev));
        continue;
      }
      if (ev.tuplet) return null;
      if (a < start) {
        const left = copyRhythm(ev, start - a);
        if (!left) return null;
        before.push(left);
      }
      if (b > end) {
        const right = copyRhythm(ev, b - end);
        if (!right) return null;
        after.push(right);
      }
    }
    return { before: before, after: after };
  }

  function applySyncopation(events, ticks, beat, settings) {
    if (!settings.syncopation || !events.length || !beat) return events;
    const win = syncWindow(beat);
    const figs = syncFigures(win, !!settings.allowRests);
    if (!win || !figs.length || ticks < win) return events;
    const starts = [];
    for (let pos = 0; pos + win <= ticks; pos += beat) starts.push(pos);
    const order = starts.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (let i = 0; i < order.length; i++) {
      const cut = cutAround(events, order[i], order[i] + win);
      if (!cut) continue;
      const fig = T.weightedPick(figs, (f) => f.w);
      const mid = fig.notes.map((n) => ({ dur: n.dur, rest: n.rest, tuplet: null }));
      const out = cut.before.concat(mid, cut.after);
      const used = out.reduce((s, e) => s + e.dur.ticks, 0);
      if (used === ticks && rhythmAllowed(out, settings)) return out;
    }
    return events;
  }

  function colorTop(pitches, settings, key, cell) {
    if (!settings.accidentals || (cell && cell.cadence) || !pitches || !pitches.length) return pitches;
    if (Math.random() > 0.22) return pitches;
    const pcs = T.scalePcs(key);
    const topAt = pitches.length - 1;
    const top = pitches[topAt];
    const opts = [top - 1, top + 1].filter((p) => {
      const pc = ((p % 12) + 12) % 12;
      return p >= settings.rangeLow && p <= settings.rangeHigh && pcs.indexOf(pc) < 0 && pitches.indexOf(p) < 0;
    });
    if (!opts.length) return pitches;
    const next = pitches.slice();
    next[topAt] = T.pick(opts);
    next.sort((a, b) => a - b);
    return next;
  }

  function pitchPool(settings, key) {
    const diat = T.diatonicPitches(key, settings.rangeLow, settings.rangeHigh);
    if (!settings.accidentals) return diat;
    /* Mix a few chromatics into the pool, still prefer diatonic. */
    return diat;
  }

  function leapRate(semi) {
    if (semi <= 2) return 0;
    if (semi <= 4) return 0.22;
    if (semi <= 5) return 0.28;
    if (semi <= 7) return 0.55;
    if (semi <= 9) return 0.7;
    if (semi <= 11) return 0.8;
    return 0.85;
  }

  function leapSteps(semi) {
    const approx = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19];
    const options = [];
    for (let n = 2; n < approx.length; n++) {
      if (approx[n] <= semi && approx[n] >= Math.min(semi, 5)) options.push(n);
    }
    if (!options.length) {
      for (let n = 2; n < approx.length; n++) if (approx[n] <= semi) options.push(n);
    }
    if (!options.length) return 1;
    const top = options[options.length - 1];
    const floor = Math.max(options[0], top - 2);
    const big = options.filter((n) => n >= floor);
    return T.weightedPick(big.length ? big : options, (n) => (n === top ? 4 : 2));
  }

  function createMelodyWalker(settings, key, pool) {
    const pcs = T.scalePcs(key);
    const tonic = key.tonic;
    const maxSemi = T.intervalSemis(settings.maxLeap);
    const lo = pool[0];
    const hi = pool[pool.length - 1];
    let prev = null;
    let prevWasChromatic = false;
    let dir = Math.random() < 0.5 ? 1 : -1;
    let stepsLeft = 3 + ((Math.random() * 2) | 0);
    let leapDebt = false;
    let phraseLeft = 6 + ((Math.random() * 3) | 0);
    let repeated = false;
    let goal = null;
    let gestures = 0;
    let runDir = 0;
    let runLen = 0;

    function pcOf(p) {
      return ((p % 12) + 12) % 12;
    }
    function degOf(p) {
      const i = pcs.indexOf(pcOf(p));
      return i < 0 ? -1 : i;
    }
    function nearestTonic(from) {
      const tonics = pool.filter((p) => pcOf(p) === tonic);
      return tonics.length ? T.nearestIn(tonics, from) : T.nearestIn(pool, from);
    }
    function nearestApproach(from) {
      const approaches = pool.filter((p) => {
        const d = (pcOf(p) - tonic + 12) % 12;
        return d === 2 || d === 11 || d === 7;
      });
      return approaches.length ? T.nearestIn(approaches, from) : from;
    }
    function inScale(p) {
      return pcs.indexOf(pcOf(p)) >= 0;
    }
    function indexOfPitch(p) {
      const exact = pool.indexOf(p);
      if (exact >= 0) return exact;
      let best = 0;
      let dist = 99;
      pool.forEach((n, i) => {
        const d = Math.abs(n - p);
        if (d < dist) {
          dist = d;
          best = i;
        }
      });
      return best;
    }
    function scaleSteps(from, steps) {
      if (!steps) return from;
      const j = indexOfPitch(from) + steps;
      if (j < 0 || j >= pool.length) return null;
      const p = pool[j];
      if (Math.abs(p - from) > maxSemi) return null;
      return p;
    }
    function chromaticBeside(pitch, from) {
      const opts = [];
      [pitch - 1, pitch + 1].forEach((p) => {
        if (p < settings.rangeLow || p > settings.rangeHigh) return;
        if (inScale(p)) return;
        if (from != null && Math.abs(p - from) > maxSemi) return;
        opts.push(p);
      });
      if (!opts.length) return pitch;
      const steps = from == null ? opts : opts.filter((p) => Math.abs(p - from) <= 2);
      return (steps.length ? steps : opts)[0];
    }
    function turn() {
      dir *= -1;
      stepsLeft = 3 + ((Math.random() * 2) | 0);
    }
    function finish(pitch, from) {
      if (from != null && runLen >= 2 && Math.sign(pitch - from) === runDir && Math.abs(pitch - from) <= 4) {
        const back = scaleSteps(from, -runDir * 2) || scaleSteps(from, -runDir);
        if (back != null && back !== from) pitch = back;
      }
      const moved = from == null ? 0 : Math.sign(pitch - from);
      const step = from != null && Math.abs(pitch - from) <= 4;
      if (moved && step && moved === runDir) runLen++;
      else if (moved && step) {
        runDir = moved;
        runLen = 1;
      } else {
        runDir = moved;
        runLen = 0;
      }
      const leap = from != null && Math.abs(pitch - from) >= 5;
      leapDebt = leap;
      if (leap) dir = Math.sign(pitch - from) || dir;
      prev = pitch;
      repeated = from != null && pitch === from;
      if (!leapDebt && !repeated && settings.accidentals && phraseLeft > 2 && Math.random() < 0.16) {
        const chrom = chromaticBeside(pitch, from);
        if (chrom !== pitch) {
          prev = chrom;
          prevWasChromatic = true;
          leapDebt = false;
        }
      }
      return prev;
    }

    function openingPitch() {
      const mid = (lo + hi) / 2;
      if (settings.startTonic) {
        const tonics = pool.filter((p) => pcOf(p) === tonic);
        if (!tonics.length) return T.nearestIn(pool, mid);
        const ranked = tonics.slice().sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
        return T.pick(ranked.slice(0, Math.min(3, ranked.length)));
      }
      const reach = Math.max(12, Math.round((hi - lo) * 0.35));
      const band = pool.filter((p) => Math.abs(p - mid) <= reach);
      return T.pick(band.length ? band : pool);
    }

    return function next(kind) {
      if (prev == null) {
        prev = openingPitch();
        prevWasChromatic = false;
        return prev;
      }
      if (kind === "tonic") {
        prev = nearestTonic(prev);
        prevWasChromatic = false;
        leapDebt = false;
        return prev;
      }
      if (kind === "approach") {
        prev = nearestApproach(prev);
        prevWasChromatic = false;
        leapDebt = false;
        return prev;
      }
      const from = prev;
      if (prevWasChromatic) {
        prevWasChromatic = false;
        const back = scaleSteps(from, -dir) || scaleSteps(from, dir) || nearestTonic(from);
        prev = back;
        leapDebt = false;
        return prev;
      }
      if (leapDebt) {
        const back = scaleSteps(from, -dir) || scaleSteps(from, dir);
        leapDebt = false;
        if (back && back !== from) return finish(back, from);
      }
      if (settings.texture === "melody" && hi - lo >= 7) {
        if (goal == null || phraseLeft <= 0) {
          gestures++;
          phraseLeft = 2 + ((Math.random() * 3) | 0);
          const drift = gestures % 4 === 0;
          if (!drift && Math.random() < 0.55) dir *= -1;
          const mid = (lo + hi) / 2;
          const way = drift ? (from < mid ? 1 : -1) : dir;
          const hop = drift
            ? Math.max(4, Math.min(Math.round((hi - lo) * 0.28), 6 + maxSemi))
            : 2 + ((Math.random() * 3) | 0);
          goal = T.nearestIn(pool, Math.max(lo, Math.min(hi, from + way * hop)));
          dir = Math.sign(goal - from) || dir;
        }
        phraseLeft--;
        const roll = Math.random();
        if (roll < 0.08) return finish(from, from);
        let steps = 1;
        let pitch = null;
        if (roll < leapRate(maxSemi)) {
          steps = leapSteps(maxSemi);
          pitch = scaleSteps(from, dir * steps) || scaleSteps(from, -dir * steps);
        }
        if (pitch == null) {
          if (maxSemi >= 4 && maxSemi < 7 && roll < 0.55) steps = 2;
          else steps = 1;
          pitch = scaleSteps(from, dir * steps) || scaleSteps(from, dir) || from;
        }
        return finish(pitch, from);
      }
      phraseLeft--;
      if (phraseLeft <= 1) {
        const goal = nearestTonic(from);
        if (pcOf(from) === tonic || phraseLeft < 0) {
          phraseLeft = 6 + ((Math.random() * 3) | 0);
          dir = Math.random() < 0.5 ? 1 : -1;
          stepsLeft = 3;
        } else {
          const toward = Math.sign(goal - from) || -dir;
          const step = scaleSteps(from, toward) || goal;
          dir = toward;
          return finish(step, from);
        }
      }
      stepsLeft--;
      if (stepsLeft <= 0 || from <= lo + 2 || from >= hi - 2) turn();
      let pitch = null;
      const roll = Math.random();
      if (!repeated && roll < 0.08) pitch = from;
      else if (maxSemi >= 7 && roll < leapRate(maxSemi)) {
        const n = leapSteps(maxSemi);
        pitch = scaleSteps(from, dir * n) || scaleSteps(from, -dir * n);
      } else if (roll < 0.72) pitch = scaleSteps(from, dir);
      else if (roll < 0.84 && maxSemi >= 4) pitch = scaleSteps(from, dir * 2);
      else if (maxSemi >= 4) pitch = scaleSteps(from, dir * leapSteps(maxSemi)) || scaleSteps(from, -dir * leapSteps(maxSemi));
      if (pitch == null) {
        turn();
        pitch = scaleSteps(from, dir) || scaleSteps(from, -dir) || from;
      }
      if (kind === "beat" && (pitch == null || Math.abs(pitch - from) <= 2)) {
        const step = scaleSteps(from, dir);
        if (step != null && [0, 2, 4].indexOf(degOf(step)) >= 0) pitch = step;
      }
      return finish(pitch, from);
    };
  }

  function handSpanOk(a, b, minS, maxS) {
    const d = Math.abs(b - a);
    return d >= minS && d <= maxS;
  }

  function wideReach(settings) {
    return twoStaff(settings) && settings.rangeLow < 45;
  }

  function handGapMax(settings) {
    return wideReach(settings) ? 22 : 12;
  }

  function twoStaff(settings) {
    if (settings.clef === "treble" || settings.clef === "bass") return false;
    if (settings.texture === "melody") return false;
    const marimba = String(settings.instrumentId || "").indexOf("mar") === 0 && settings.mallets >= 3;
    if (!marimba) return false;
    if (settings.clef === "grand") return true;
    return settings.rangeLow < 55 && settings.rangeHigh >= 64;
  }

  function playable(chord, nNotes, settings) {
    if (!chord || chord.length !== nNotes) return false;
    const span = chord[chord.length - 1] - chord[0];
    const wide = twoStaff(settings);
    const spanMax = wide ? (settings.rangeLow < 45 ? 40 : 31) : 19;
    if (span > spanMax) return false;
    const maxS = Math.min(settings.handSpanMax || 12, 12);
    if (nNotes === 2) return wide || handSpanOk(chord[0], chord[1], 3, maxS);
    if (nNotes === 3) {
      return handSpanOk(chord[0], chord[1], 3, maxS) || handSpanOk(chord[1], chord[2], 3, maxS);
    }
    const hands =
      handSpanOk(chord[0], chord[1], 3, maxS) && handSpanOk(chord[2], chord[3], 3, maxS);
    if (wide) return hands;
    return (
      hands &&
      chord[2] - chord[1] >= 1 &&
      chord[2] - chord[1] <= Math.min(settings.innerGapMax || 12, 12)
    );
  }

  function stackClosed(available, bass, nNotes) {
    const chord = [bass];
    let cursor = bass;
    while (chord.length < nNotes) {
      const nexts = available.filter((p) => p > cursor && p - cursor <= 7);
      if (!nexts.length) return null;
      const nxt = nexts.slice().sort((a, b) => {
        const score = (d) => (d === 3 || d === 4 ? 0 : d === 5 ? 1 : d === 2 ? 2 : 3);
        return score(a - cursor) - score(b - cursor) || a - b;
      })[0];
      chord.push(nxt);
      cursor = nxt;
    }
    return chord;
  }

  function malletsFor(n) {
    return n === 2 ? [1, 2] : n === 3 ? [1, 2, 3] : [1, 2, 3, 4];
  }

  function motionPenalty(from, to) {
    if (from == null) return 0;
    const d = Math.abs(to - from);
    if (d === 0) return 0;
    if (d <= 2) return 1;
    if (d === 5 || d === 7) return 2;
    if (d === 12) return 3;
    if (d <= 5) return 4;
    return 8 + d;
  }

  /* Two grips: each hand a 3rd, 4th, or 5th, small gap, triad tones only. */
  function splitHands(tones, pool, settings, prev, opts) {
    opts = opts || {};
    const pcOf = (p) => ((p % 12) + 12) % 12;
    const grand = twoStaff(settings);
    const avail = pool.filter(
      (p) => p >= settings.rangeLow && p <= settings.rangeHigh && tones.indexOf(pcOf(p)) >= 0
    );
    if (avail.length < 2) return null;
    const prevBass = prev && prev.length ? prev[0] : null;
    const prevTop = prev && prev.length ? prev[prev.length - 1] : null;
    const want = Math.min(settings.mallets, opts.nNotes || settings.mallets);
    const rootPc = opts.rootPc;
    const topNote = opts.topNote;
    let best = null;
    let bestScore = 1e9;

    function consider(pitches) {
      const uniq = [...new Set(pitches)].sort((a, b) => a - b);
      if (uniq.length < 2 || uniq.length > Math.min(4, want)) return;
      if (topNote != null && uniq[uniq.length - 1] !== topNote) return;
      if (want >= 4 && uniq.length < 3) return;
      if (want <= 2 && uniq.length !== 2) return;
      if (!gripShape(uniq, grand, settings)) return;
      let score = 0;
      if (rootPc != null && pcOf(uniq[0]) !== rootPc) score += 30;
      score += motionPenalty(prevBass, uniq[0]) * 3;
      score += motionPenalty(prevTop, uniq[uniq.length - 1]) * 2;
      if (prev && prev.length) {
        uniq.forEach((p) => {
          let near = prev[0];
          prev.forEach((q) => {
            if (Math.abs(q - p) < Math.abs(near - p)) near = q;
          });
          score += motionPenalty(near, p);
          if (prev.indexOf(p) >= 0) score -= 2;
        });
      }
      if (want >= 4 && uniq.length === 4) score -= 3;
      if (want >= 4 && uniq.length < 4) score += 5;
      if (wideReach(settings)) {
        if (uniq[0] < 45) score -= 2;
        if (uniq[0] <= settings.rangeLow + 2) score += 6;
        score += Math.random() * 8;
      }
      if (score < bestScore) {
        bestScore = score;
        best = uniq;
      }
    }

    let bassList = avail.filter((p) => {
      if (grand && p >= 59) return false;
      if (rootPc != null && pcOf(p) !== rootPc) return false;
      if (prevBass == null) return true;
      const d = Math.abs(p - prevBass);
      return d <= (wideReach(settings) ? 19 : 7) || d === 12;
    });
    if (!bassList.length) {
      bassList = avail.filter((p) => (!grand || p < 59) && (rootPc == null || pcOf(p) === rootPc));
    }
    if (!bassList.length) return null;

    if (want <= 2) {
      bassList.forEach((bass) => {
        avail.forEach((p) => {
          const d = p - bass;
          if (d >= 3 && d <= 7) consider([bass, p]);
        });
      });
    } else {
      bassList.forEach((bass) => {
        const lhTops = avail.filter((p) => p > bass && p - bass >= 3 && p - bass <= 7 && (!grand || p < 60));
        const rh = avail.filter((p) => {
          if (p <= bass) return false;
          if (grand && p < 60) return false;
          if (!grand && p - bass > 19) return false;
          return p <= Math.min(settings.rangeHigh, grand ? 84 : 108);
        });
        lhTops.forEach((lh) => {
          for (let i = 0; i < rh.length; i++) {
            const gap = rh[i] - lh;
            if (gap < 3 || gap > handGapMax(settings)) continue;
            for (let j = i + 1; j < rh.length; j++) {
              const d = rh[j] - rh[i];
              if (d < 3 || d > 7) continue;
              consider([bass, lh, rh[i], rh[j]]);
            }
          }
        });
        for (let i = 0; i < rh.length; i++) {
          for (let j = i + 1; j < rh.length; j++) {
            const d = rh[j] - rh[i];
            if (d < 3 || d > 7) continue;
            const gap = rh[i] - bass;
            if (gap < 3 || gap > handGapMax(settings)) continue;
            consider([bass, rh[i], rh[j]]);
          }
        }
      });
    }
    if (!best) return null;
    return { pitches: best, mallets: malletsFor(best.length), bass: best[0] };
  }

  function gripShape(pitches, grand, settings) {
    const n = pitches.length;
    if (n === 2) {
      const d = pitches[1] - pitches[0];
      if (d < 3 || d > 7) return false;
      return playable(pitches, 2, settings) || grand;
    }
    if (n === 4) {
      const lh = pitches[1] - pitches[0];
      const rh = pitches[3] - pitches[2];
      const gap = pitches[2] - pitches[1];
      if (lh < 3 || lh > 7 || rh < 3 || rh > 7) return false;
      if (gap < 3 || gap > handGapMax(settings)) return false;
      if (grand && (pitches[1] >= 60 || pitches[2] < 60)) return false;
      if (!grand && pitches[3] - pitches[0] > 19) return false;
      return playable(pitches, 4, settings);
    }
    if (n === 3) {
      if (grand && (pitches[0] >= 60 || pitches[2] < 60)) return false;
      const left = pitches[1] - pitches[0];
      const right = pitches[2] - pitches[1];
      const rhGrip = right >= 3 && right <= 7 && left >= 3 && left <= 12;
      const lhGrip = left >= 3 && left <= 7 && right >= 3 && right <= 12;
      if (!rhGrip && !lhGrip) return false;
      if (!grand && pitches[2] - pitches[0] > 19) return false;
      return playable(pitches, 3, settings);
    }
    return false;
  }

  function buildOpen(available, bass, nNotes) {
    /* LH fifth (or 4th), RH the next closed tones. */
    const fifth = available.find((p) => p > bass && (p - bass === 7 || p - bass === 5));
    if (!fifth) return null;
    if (nNotes === 2) return [bass, fifth];
    const above = available.filter((p) => p > fifth && p - bass <= 19);
    if (nNotes === 3) {
      if (!above.length) return null;
      return [bass, fifth, above[0]];
    }
    if (above.length < 2) return null;
    return [bass, fifth, above[0], above[1]];
  }

  function buildTwoStaffChord(available, bass, nNotes, settings) {
    if (!twoStaff(settings) || bass >= 60) return null;
    const lhTop = available.find((p) => p > bass && p < 60 && (p - bass === 7 || p - bass === 5 || p - bass === 4 || p - bass === 3));
    const rhPool = available.filter((p) => p >= 60 && p <= settings.rangeHigh);
    if (!rhPool.length) return null;
    let best = null;
    let score = 1e9;
    for (let i = 0; i < rhPool.length; i++) {
      for (let j = i + 1; j < rhPool.length; j++) {
        const d = rhPool[j] - rhPool[i];
        if (d < 3 || d > 8) continue;
        const s = Math.abs(rhPool[i] - 64) + Math.abs(rhPool[j] - 70);
        if (s < score) {
          score = s;
          best = [rhPool[i], rhPool[j]];
        }
      }
    }
    if (nNotes === 2) {
      const rh = rhPool.filter((p) => p - bass >= 5 && p - bass <= 19);
      const use = rh.length ? rh : rhPool;
      return [bass, T.nearestIn(use, 67)];
    }
    if (!best) return null;
    if (nNotes === 3) return [bass, best[0], best[1]];
    const left2 = lhTop || bass;
    const chord = [...new Set([bass, left2, best[0], best[1]])].sort((a, b) => a - b);
    return chord.length === nNotes ? chord : [bass, best[0], best[1]];
  }

  function cadenceVoicing(kind, nNotes, pool, key, settings, prev) {
    const pcs = T.scalePcs(key);
    const deg = kind === "approach" ? 4 : 0;
    const spec = T.diatonicQualities(key).find((q) => q.deg === deg) || { q: "maj" };
    const root = pcs[deg];
    const tones = T.chordTonesFrom(root, spec.q);
    const prevPitches = Array.isArray(prev) ? prev : prev && prev.pitches ? prev.pitches : null;
    return splitHands(tones, pool, settings, prevPitches, { nNotes: nNotes, rootPc: root });
  }

  function addBassUnder(melody, pool, key, settings, prevBass, cadence) {
    if (cadence === "tonic" || cadence === "approach") {
      const voiced = cadenceVoicing(cadence, settings.mallets >= 4 ? 4 : 3, pool, key, settings, [prevBass || 48, melody]);
      if (voiced) {
        if (voiced.pitches.indexOf(melody) < 0 && melody >= 60) {
          const next = voiced.pitches.slice();
          next[next.length - 1] = melody;
          const uniq = [...new Set(next)].sort((a, b) => a - b);
          return { pitches: uniq, mallets: malletsFor(uniq.length), bass: voiced.bass };
        }
        return voiced;
      }
    }
    const bassPool = pool.filter((p) => p < 60 && p >= settings.rangeLow);
    if (!bassPool.length) return { pitches: [melody], mallets: [3] };
    const pcs = T.scalePcs(key);
    const quals = T.diatonicQualities(key);
    const topPc = ((melody % 12) + 12) % 12;
    const match = quals.filter((q) => q.q !== "dim" && T.chordTonesFrom(pcs[q.deg], q.q).includes(topPc));
    const list = match.length ? match : quals.filter((q) => q.deg === 0);
    const deg = T.weightedPick(list, (q) => (q.deg === 0 ? 4 : q.deg === 4 ? 3 : 2));
    const tones = T.chordTonesFrom(pcs[deg.deg], deg.q);
    const prev = prevBass != null ? [prevBass, melody] : [melody];
    const voiced = splitHands(tones, pool, settings, prev, {
      nNotes: settings.mallets >= 4 ? 4 : 3,
      topNote: melody >= 60 ? melody : null,
    });
    if (voiced) return voiced;
    return { pitches: [melody], mallets: [3], bass: prevBass };
  }

  function createBlockWalker(settings, key, pool) {
    const quals = T.diatonicQualities(key);
    const pcs = T.scalePcs(key);
    const prog = settings.texture === "chorale"
      ? [0, 3, 4, 0, 5, 1, 4, 0]
      : [0, 0, 3, 4, 0, 5, 4, 0];
    let pi = 0;
    let hold = 0;
    let last = null;

    return function next(nNotes, kind) {
      if (kind === "tonic" || kind === "approach") {
        const voiced = cadenceVoicing(kind, nNotes, pool, key, settings, last);
        if (voiced && voiced.pitches.length >= 2) {
          last = voiced.pitches;
          return voiced;
        }
      }
      if (hold <= 0) {
        pi = (pi + 1) % prog.length;
        hold = settings.texture === "chorale" ? 1 : T.pick([1, 1, 2]);
      }
      hold--;
      const deg = prog[pi];
      const spec = quals.find((q) => q.deg === deg) || quals[0];
      const tones = T.chordTonesFrom(pcs[spec.deg], spec.q);
      const voiced = splitHands(tones, pool, settings, last, { nNotes: nNotes });
      if (voiced && voiced.pitches.length >= 2) {
        last = voiced.pitches;
        return voiced;
      }
      const fallback = voiceBlock(nNotes, pool, key, settings, last);
      if (fallback && fallback.pitches && fallback.pitches.length >= 2 && gripShape(fallback.pitches, twoStaff(settings), settings)) {
        last = fallback.pitches;
        return fallback;
      }
      if (last && last.length >= 2) return { pitches: last.slice(), mallets: malletsFor(last.length) };
      return fallback;
    };
    next.remember = function (pitches) {
      if (pitches && pitches.length) last = pitches.slice();
    };
    return next;
  }

  function voiceBlock(nNotes, pool, key, settings, prevChord) {
    const pcs = T.scalePcs(key);
    const quals = T.diatonicQualities(key);
    const windowCenter = prevChord
      ? Math.round(prevChord.reduce((a, b) => a + b, 0) / prevChord.length)
      : Math.round((settings.rangeLow * 2 + settings.rangeHigh) / 3);
    const winLow = Math.max(settings.rangeLow, windowCenter - 8);
    const winHigh = Math.min(settings.rangeHigh, winLow + 16);
    const localPool = pool.filter((p) => p >= winLow && p <= winHigh);
    const usePool = localPool.length >= nNotes ? localPool : pool;
    const preferredDeg = [0, 4, 5, 3, 1];

    for (let attempt = 0; attempt < 40; attempt++) {
      const deg = T.weightedPick(quals, (q) => {
        const idx = preferredDeg.indexOf(q.deg);
        return idx === -1 ? 1 : 6 - idx;
      });
      const root = pcs[deg.deg];
      const quality = deg.q;
      const tones = T.chordTonesFrom(root, quality);
      const voiced = splitHands(tones, pool, settings, prevChord, { nNotes: nNotes });
      if (voiced) return voiced;
    }

    const tonicTones = T.chordTonesFrom(pcs[0], quals[0].q);
    const fallback = splitHands(tonicTones, pool, settings, prevChord, { nNotes: nNotes, rootPc: pcs[0] });
    if (fallback) return fallback;
    const bass = T.nearestIn(usePool, windowCenter - 4);
    return { pitches: [bass], mallets: [1] };
  }

  function pickNoteCount(settings, cell) {
    if (settings.texture === "melody") return 1;
    if (settings.mallets === 2) {
      if (settings.texture === "doublestops" || settings.texture === "mixed") {
        const base = settings.chordChance || settings.doubleStopChance || 0.28;
        const chance = settings.texture === "doublestops" ? Math.max(base, 0.7) : base;
        const weight = cell.dur.ticks >= T.TICKS.quarter ? 1 : cell.dur.ticks >= T.TICKS.eighth ? 0.55 : 0.12;
        return Math.random() < chance * weight ? 2 : 1;
      }
      return 1;
    }
    if (settings.texture === "mixed") {
      const chance = settings.chordChance == null ? 0.28 : settings.chordChance;
      /* Chords land on longer values so the line still reads as a melody. */
      const weight = cell.dur.ticks >= T.TICKS.quarter ? 1 : cell.dur.ticks >= T.TICKS.eighth ? 0.45 : 0.08;
      if (Math.random() > chance * weight) return 1;
      if (settings.mallets === 3) return Math.random() < 0.7 ? 3 : 2;
      return Math.random() < 0.55 ? 3 : Math.random() < 0.5 ? 2 : 4;
    }
    if (settings.texture === "block" || settings.texture === "chorale") {
      if (settings.blockSize === "3") return 3;
      if (settings.blockSize === "4") return Math.min(4, settings.mallets);
      if (settings.mallets === 3) return 3;
      const r = Math.random();
      if (r < 0.2) return 3;
      return 4;
    }
    if (settings.mallets === 3) return 3;
    if (settings.texture === "chorale") return Math.random() < 0.3 ? 3 : 4;
    return 4;
  }

  function diatonicNeighbor(pitch, pool, steps) {
    const sorted = pool.slice().sort((a, b) => a - b);
    let i = sorted.indexOf(pitch);
    if (i < 0) {
      i = sorted.findIndex((p) => p >= pitch);
      if (i < 0) i = sorted.length - 1;
    }
    const j = i + steps;
    if (j < 0 || j >= sorted.length) return null;
    return sorted[j];
  }

  function addDoubleStop(melody, pool, settings, mem) {
    mem = mem || {};
    const names = settings.stopIntervals && settings.stopIntervals.length
      ? settings.stopIntervals
      : ["3", "4", "5", "6", "8"];
    const stepOf = { "2": 1, "3": 2, "4": 3, "5": 4, "6": 5, "7": 6, "8": 7 };
    const dirs =
      settings.stopPlace === "above" ? [1] :
      settings.stopPlace === "below" ? [-1] :
      Math.random() < 0.75 ? [-1, 1] : [1, -1];
    const preferred = ["3", "3", "4", "5", "6", "8"].filter((n) => names.indexOf(n) >= 0);
    const order = [];
    if (mem.stop && names.indexOf(mem.stop) >= 0 && Math.random() < 0.7) {
      order.push(mem.stop);
    }
    preferred.forEach((n) => {
      if (order.indexOf(n) < 0) order.push(n);
    });
    names.forEach((n) => {
      if (order.indexOf(n) < 0) order.push(n);
    });
    for (const dir of dirs) {
      for (const name of order) {
        const other = diatonicNeighbor(melody, pool, dir * (stepOf[name] || 2));
        if (other == null || other === melody) continue;
        if (other < settings.rangeLow || other > settings.rangeHigh) continue;
        const span = Math.abs(other - melody);
        if (span < 3 || span > 12) continue;
        const pitches = [melody, other].sort((a, b) => a - b);
        mem.stop = name;
        return { pitches, mallets: [1, 2] };
      }
    }
    return { pitches: [melody], mallets: [1] };
  }

  /* Keep the melody note as the top of a chord underneath it. */
  function harmonizeMelody(top, nNotes, pool, key, settings) {
    const pcs = T.scalePcs(key);
    const quals = T.diatonicQualities(key);
    const topPc = ((top % 12) + 12) % 12;
    const candidates = quals.filter((q) => q.q !== "dim" && T.chordTonesFrom(pcs[q.deg], q.q).includes(topPc));
    const list = candidates.length ? candidates : quals.filter((q) => q.deg === 0);
    for (let attempt = 0; attempt < 8; attempt++) {
      const deg = T.weightedPick(list, (q) => (q.deg === 0 ? 4 : q.deg === 4 ? 3 : 2));
      const tones = T.chordTonesFrom(pcs[deg.deg], deg.q);
      const voiced = splitHands(tones, pool, settings, [top], { nNotes: nNotes, topNote: top });
      if (voiced) return voiced;
    }
    return { pitches: [top], mallets: [settings.mallets >= 4 ? 3 : 1] };
  }

  function resolveKey(settings) {
    const all = T.KEYS;
    if (settings.keyId && settings.keyId !== "random" && (!settings.keyIds || settings.keyIds.length <= 1 || !settings.keyIds.includes(settings.keyId))) {
      const match = all.find((k) => k.id === settings.keyId);
      if (match) return match;
    }
    let ids = Array.isArray(settings.keyIds) ? settings.keyIds.filter(Boolean) : [];
    if (!ids.length) {
      if (settings.keyId && settings.keyId !== "random") ids = [settings.keyId];
      else ids = all.map((k) => k.id);
    }
    const pool = all.filter((k) => ids.indexOf(k.id) >= 0);
    const ordered = pool.slice().sort((a, b) => T.circleRank(a) - T.circleRank(b));
    if (!ordered.length) return all[0];
    if (ordered.length === 1) return ordered[0];
    const idx = Math.abs(parseInt(settings.keyIndex, 10) || 0) % ordered.length;
    return ordered[idx];
  }

  function applyDynamics(measures, settings) {
    if (!settings.dynamics) return;
    const notes = [];
    measures.forEach((m) => {
      m.events.forEach((e) => {
        if (!e.rest && e.pitches && e.pitches.length) notes.push(e);
      });
    });
    if (!notes.length) return;
    const ladder = ["p", "mp", "mf", "f"];
    let step = 1 + (Math.random() < 0.5 ? 1 : 0);
    notes[0].dynamic = ladder[step];
    function hairpin(from, to, up) {
      if (to <= from || to >= notes.length) return;
      notes[from].hairpin = up ? "cresc-start" : "dim-start";
      notes[to].hairpin = up ? "cresc-end" : "dim-end";
      step = Math.max(0, Math.min(ladder.length - 1, step + (up ? 1 : -1)));
      notes[to].dynamic = ladder[step];
    }
    if (notes.length >= 6) {
      const a = Math.min(2, notes.length - 4);
      const b = Math.min(notes.length - 2, a + 3 + Math.floor(Math.random() * 2));
      hairpin(a, b, step < 2);
    }
    if (notes.length >= 14) {
      const a = Math.floor(notes.length * 0.55);
      const b = Math.min(notes.length - 1, a + 4);
      hairpin(a, b, step < 2);
    }
  }

  function plainEnding(span, endTonic) {
    const units = [96, 72, 48, 36, 24, 12, 6, 3].map((t) => durByTicks(t)).filter(Boolean);
    const minFinal = Math.min(span, T.TICKS.quarter);
    const finals = units.filter((d) => d.ticks <= span && d.ticks >= minFinal);
    const finalDur = (finals.length ? finals : units.filter((d) => d.ticks <= span))
      .slice()
      .sort((a, b) => b.ticks - a.ticks)[0];
    if (!finalDur) return null;
    const out = [];
    let rem = span - finalDur.ticks;
    const small = [24, 12, 6, 3].map((t) => durByTicks(t)).filter(Boolean);
    while (rem > 0) {
      const d = small.find((u) => u.ticks <= rem);
      if (!d) return null;
      out.push({ dur: d, rest: false, tuplet: null });
      rem -= d.ticks;
    }
    out.push({ dur: finalDur, rest: false, tuplet: null, cadence: endTonic ? "tonic" : null });
    if (endTonic && out.length > 1) out[out.length - 2].cadence = "approach";
    return out;
  }

  /* The last beat is one long note, not a run of sixteenths. */
  function settleEnding(events, ticks, beat, endTonic) {
    if (!events.length || !ticks) return null;
    const b = beat || T.TICKS.quarter;
    const beats = Math.max(1, Math.round(ticks / b));
    const want = b * (beats >= 4 ? 2 : 1);
    const head = events.slice();
    let freed = 0;
    const popOne = () => {
      if (!head.length) return false;
      let last = head.pop();
      freed += last.dur.ticks;
      while (last.tuplet && last.tuplet !== "start" && head.length) {
        last = head.pop();
        freed += last.dur.ticks;
      }
      return true;
    };
    while (head.length && (freed < want || (b && (ticks - freed) % b !== 0))) {
      if (!popOne()) break;
    }
    if (freed <= 0) return null;
    const tail = plainEnding(freed, endTonic);
    if (!tail) return null;
    const out = head.concat(tail);
    const used = out.reduce((s, e) => s + e.dur.ticks, 0);
    if (used !== ticks) return null;
    const last = out[out.length - 1];
    if (!last || last.rest || last.dur.ticks < Math.min(ticks, T.TICKS.quarter)) return null;
    return out;
  }

  /* Phrase ending: half note on beat 3, or a quarter on beat 4. */
  function breathLanding(ticks, beat) {
    const q = T.TICKS.quarter;
    const h = T.TICKS.half;
    const b = beat || q;
    const beats = Math.round(ticks / b);
    const options = [];
    const half = durByTicks(h);
    const quarter = durByTicks(q);
    if (beats >= 4 && half && (beats - 2) * b + h === ticks) {
      options.push({ cut: (beats - 2) * b, dur: half });
    }
    if (beats >= 4 && quarter && b === q && (beats - 1) * b + q === ticks) {
      options.push({ cut: (beats - 1) * b, dur: quarter });
    }
    if (beats === 3 && b === q && half && quarter) {
      options.push({ cut: b, dur: half });
      options.push({ cut: b * 2, dur: quarter });
    }
    if (!options.length && quarter && ticks > q && (ticks - q) % b === 0) {
      options.push({ cut: ticks - q, dur: quarter });
    }
    if (!options.length && b < ticks) {
      const dur = durByTicks(b);
      if (dur) options.push({ cut: ticks - b, dur: dur });
    }
    return options.length ? T.pick(options) : null;
  }

  function phraseBreath(events, ticks, beat, endTonic) {
    if (!events.length || !ticks) return null;
    const landing = breathLanding(ticks, beat);
    if (!landing || !landing.dur) return null;
    const start = landing.cut;
    let head = null;
    const sliced = cutAround(events, start, ticks);
    if (sliced) head = sliced.before;
    if (!head) {
      head = events.slice();
      let used = head.reduce((sum, event) => sum + event.dur.ticks, 0);
      while (head.length && used > start) {
        let last = head.pop();
        used -= last.dur.ticks;
        while (last.tuplet && last.tuplet !== "start" && head.length) {
          last = head.pop();
          used -= last.dur.ticks;
        }
      }
    }
    if (!head) return null;
    let used = head.reduce((sum, event) => sum + event.dur.ticks, 0);
    if (used > start) return null;
    const out = head.slice();
    let gap = start - used;
    const fillers = [T.TICKS.quarter, T.TICKS.eighth, T.TICKS.sixteenth, T.TICKS.thirtysecond]
      .map((t) => durByTicks(t))
      .filter(Boolean);
    while (gap > 0) {
      const d = fillers.find((item) => item.ticks <= gap);
      if (!d) return null;
      out.push({ dur: d, rest: false, tuplet: null });
      gap -= d.ticks;
    }
    out.push({
      dur: landing.dur,
      rest: false,
      tuplet: null,
      cadence: endTonic ? "tonic" : null,
    });
    if (endTonic) {
      for (let i = out.length - 2; i >= 0; i--) {
        if (!out[i].rest) {
          out[i].cadence = "approach";
          break;
        }
      }
    }
    const total = out.reduce((sum, event) => sum + event.dur.ticks, 0);
    if (total !== ticks) return null;
    return out;
  }

  function generate(rawSettings) {
    const instSpec = T.INSTRUMENTS.find((i) => i.id === rawSettings.instrumentId);
    const settings =
      instSpec && instSpec.monophonic
        ? Object.assign({}, rawSettings, { mallets: 1, texture: "melody", rolls: "off", clef: "treble" })
        : rawSettings;
    const key = resolveKey(settings);
    const time =
      settings.timeId === "random"
        ? T.pick(T.TIMES.filter((t) => ["4/4", "3/4", "2/4", "6/8"].includes(t.id)))
        : T.TIMES.find((t) => t.id === settings.timeId) || T.TIMES[0];

    const pool = pitchPool(settings, key);
    const treblePool = twoStaff(settings) ? pool.filter((p) => p >= 60) : pool;
    const melodyPool = (treblePool.length >= 5 ? treblePool : pool).slice().sort((a, b) => a - b);
    const melodyNext = createMelodyWalker(settings, key, melodyPool);
    const measures = [];
    let prevPitch = null;
    let prevChord = null;
    let prevBass = null;
    const recentRhythms = [];
    const lineMem = { stop: null };
    const blockNext =
      settings.texture === "block" || settings.texture === "chorale"
        ? createBlockWalker(settings, key, pool)
        : null;

    for (let m = 0; m < settings.measures; m++) {
      let rhythm = buildRhythm(settings, time.ticks, time.beatTicks, recentRhythms.slice(-2));
      if (rhythm.cellKey) recentRhythms.push(rhythm.cellKey);
      if (rhythm.syncOk) rhythm = applySyncopation(rhythm, time.ticks, time.beatTicks, settings);

      const lastBar = m === settings.measures - 1;
      const phraseEnd = (m + 1) % 4 === 0;
      if (phraseEnd) {
        const breathed = phraseBreath(rhythm, time.ticks, time.beatTicks, settings.endTonic !== false);
        if (breathed && rhythmAllowed(breathed, settings)) rhythm = breathed;
        else if (lastBar) {
          const settled = settleEnding(rhythm, time.ticks, time.beatTicks, settings.endTonic !== false);
          if (settled && rhythmAllowed(settled, settings)) rhythm = settled;
        }
      } else if (lastBar) {
        const settled = settleEnding(rhythm, time.ticks, time.beatTicks, settings.endTonic !== false);
        if (settled && rhythmAllowed(settled, settings)) rhythm = settled;
        else if (settings.endTonic !== false) {
          const sounding = rhythm.map((ev, i) => ({ ev: ev, i: i })).filter((x) => !x.ev.rest);
          if (sounding.length) sounding[sounding.length - 1].ev.cadence = "tonic";
          if (sounding.length > 1) sounding[sounding.length - 2].ev.cadence = "approach";
        }
      }

      const events = [];
      let barPos = 0;
      let harmonyChanges = 0;
      let heldVoicing = prevChord && prevChord.length > 1 ? { pitches: prevChord.slice(), mallets: malletsFor(prevChord.length) } : null;
      for (const cell of rhythm) {
        const noteAt = barPos;
        const onBeat = time.beatTicks ? barPos % time.beatTicks === 0 : true;
        barPos += cell.dur.ticks;
        if (cell.rest) {
          events.push({
            rest: true,
            dur: cell.dur,
            pitches: [],
            mallets: [],
            tuplet: cell.tuplet || null,
            syncTie: !!cell.tie,
          });
          continue;
        }

        let n = pickNoteCount(settings, cell);
        if (cell.dur.ticks < T.TICKS.quarter && n > 1 && !(twoStaff(settings) && cell.tuplet)) n = 1;
        let pitches;
        let mallets;
        const melodyPitch = melodyNext(cell.cadence || (onBeat ? "beat" : null));
        const cadenceKind = cell.cadence === "tonic" || cell.cadence === "approach" ? cell.cadence : null;

        if (cadenceKind && settings.texture !== "melody") {
          const want = settings.mallets <= 2 ? 2 : Math.min(4, settings.mallets);
          const voiced = cadenceVoicing(cadenceKind, want, pool, key, settings, prevChord);
          if (voiced && voiced.pitches.length >= 2) {
            pitches = voiced.pitches;
            const pcs = T.scalePcs(key);
            const deg = cadenceKind === "approach" ? 4 : 0;
            const spec = T.diatonicQualities(key).find((q) => q.deg === deg) || { q: "maj" };
            const tones = T.chordTonesFrom(pcs[deg], spec.q);
            const melPc = ((melodyPitch % 12) + 12) % 12;
            if (tones.indexOf(melPc) >= 0 && pitches.indexOf(melodyPitch) < 0) {
              const trial = pitches.slice();
              trial[trial.length - 1] = melodyPitch;
              const uniq = [...new Set(trial)].sort((a, b) => a - b);
              if (gripShape(uniq, twoStaff(settings), settings)) pitches = uniq;
            }
            mallets = malletsFor(pitches.length);
            prevPitch = pitches[pitches.length - 1];
            prevChord = pitches;
            if (voiced.bass != null) prevBass = voiced.bass;
            if (blockNext && blockNext.remember) blockNext.remember(pitches);
            heldVoicing = { pitches: pitches.slice(), mallets: mallets.slice() };
          }
        }

        if (!pitches && settings.texture === "melody") {
          pitches = [melodyPitch];
          mallets = settings.mallets === 4 ? [T.pick([2, 3])] : [settings.mallets === 3 ? 2 : 1];
          prevPitch = melodyPitch;
          prevChord = pitches;
        } else if (!pitches && twoStaff(settings) && settings.texture === "mixed") {
          const addBass =
            n > 1 ||
            !!cell.tuplet ||
            cell.dur.ticks >= T.TICKS.quarter ||
            (cell.dur.ticks >= T.TICKS.eighth && Math.random() < 0.55);
          if (addBass || cell.cadence) {
            const voiced = addBassUnder(melodyPitch, pool, key, settings, prevBass, cell.cadence || null);
            pitches = voiced.pitches;
            mallets = voiced.mallets;
            prevBass = voiced.bass;
          } else {
            pitches = [melodyPitch];
            mallets = [3];
          }
          prevPitch = melodyPitch;
          prevChord = pitches;
        } else if (!pitches && n === 1) {
          pitches = [melodyPitch];
          mallets = settings.mallets === 4 ? [T.pick([2, 3])] : [settings.mallets === 3 ? 2 : 1];
          prevPitch = melodyPitch;
          prevChord = pitches;
        } else if (!pitches && settings.mallets === 2 && (settings.texture === "mixed" || settings.texture === "doublestops")) {
          const voiced = addDoubleStop(melodyPitch, pool, settings, lineMem);
          pitches = voiced.pitches;
          mallets = voiced.mallets;
          prevPitch = melodyPitch;
          prevChord = pitches;
        } else if (!pitches && settings.texture === "mixed") {
          const voiced = harmonizeMelody(melodyPitch, n, pool, key, settings);
          pitches = voiced.pitches;
          mallets = voiced.mallets;
          prevPitch = melodyPitch;
          prevChord = pitches;
        } else if (!pitches && blockNext) {
          const dur = cell.dur.ticks;
          const beat = time.beatTicks || T.TICKS.quarter;
          const canChange =
            harmonyChanges === 0 ||
            (dur >= T.TICKS.quarter &&
              harmonyChanges < 2 &&
              noteAt % beat === 0 &&
              noteAt >= time.ticks / 2);
          if (!canChange && heldVoicing) {
            pitches = heldVoicing.pitches.slice();
            mallets = heldVoicing.mallets.slice();
          } else {
            const voiced = blockNext(n, cell.cadence || null);
            pitches = voiced.pitches;
            mallets = voiced.mallets;
            heldVoicing = { pitches: pitches.slice(), mallets: mallets.slice() };
            harmonyChanges++;
          }
          prevPitch = pitches[pitches.length - 1];
          prevChord = pitches;
        } else if (!pitches) {
          const voiced = voiceBlock(n, pool, key, settings, prevChord);
          pitches = voiced.pitches;
          mallets = voiced.mallets;
          prevPitch = pitches[pitches.length - 1];
          prevChord = pitches;
        }

        const art = [];
        if (settings.accents && Math.random() < 0.12) art.push("a");
        if (settings.staccato && Math.random() < 0.14) art.push("staccato");

        const roll =
          settings.rolls !== "off" &&
          !cell.tuplet &&
          pitches.length >= 1 &&
          (settings.rolls === "always"
            ? cell.dur.ticks >= T.TICKS.quarter
            : cell.dur.ticks >= T.TICKS.half) &&
          Math.random() < (settings.rolls === "always"
            ? (cell.dur.ticks >= T.TICKS.half ? 0.8 : 0.45)
            : 0.8);

        events.push({
          rest: false,
          dur: cell.dur,
          pitches,
          mallets,
          articulations: art,
          roll,
          tie: false,
          syncTie: !!cell.tie,
          tuplet: cell.tuplet || null,
        });
      }

      /* Ties = hold the same pitch. No slurs. */
      if (settings.ties) {
        for (let i = 0; i < events.length - 1; i++) {
          const a = events[i];
          const b = events[i + 1];
          if (a.rest || b.rest || a.tuplet || b.tuplet) continue;
          if (a.dur.ticks < T.TICKS.quarter || b.dur.ticks < T.TICKS.quarter) continue;
          if (!a.pitches.length || !b.pitches.length) continue;
          if (a.pitches.length > 2 || b.pitches.length > 2) continue;
          const same =
            a.pitches.length === b.pitches.length &&
            a.pitches.every((p, j) => p === b.pitches[j]);
          if (same || Math.random() < 0.22) {
            b.pitches = a.pitches.slice();
            if (a.mallets) b.mallets = a.mallets.slice();
            a.tie = true;
          }
        }
      }

      for (let i = 0; i < events.length - 1; i++) {
        const a = events[i];
        const b = events[i + 1];
        if (!a.syncTie || a.rest || b.rest || !a.pitches || !a.pitches.length) continue;
        b.pitches = a.pitches.slice();
        if (a.mallets) b.mallets = a.mallets.slice();
        a.tie = true;
      }

      let used = events.reduce((s, e) => s + e.dur.ticks, 0);
      while (used > time.ticks && events.length) {
        let last = events.pop();
        used -= last.dur.ticks;
        while (last.tuplet && last.tuplet !== "start" && events.length) {
          last = events.pop();
          used -= last.dur.ticks;
        }
      }
      if (used < time.ticks) {
        let fill = time.ticks - used;
        const units = T.DURATIONS.filter((d) => !d.dots && !d.group).sort((a, b) => b.ticks - a.ticks);
        units.forEach((d) => {
          while (fill >= d.ticks) {
            events.push({ rest: true, dur: d, pitches: [], mallets: [] });
            fill -= d.ticks;
          }
        });
      }

      /* Legato: group 2–4 consecutive sounding notes under a slur */
      if (settings.legato) {
        applyLegatoGroups(events);
      }

      measures.push({ events });
    }

    applyDynamics(measures, settings);

    let clef = settings.clef;
    const writeOff = T.writtenOff(settings.instrumentId);
    const allPitches = measures.flatMap((ms) => ms.events.flatMap((e) => e.pitches));
    const written = allPitches.map((p) => p + writeOff);
    const lo = written.length ? Math.min(...written) : settings.rangeLow + writeOff;
    const hi = written.length ? Math.max(...written) : settings.rangeHigh + writeOff;
    const soundingEvents = measures.flatMap((ms) => ms.events.filter((e) => !e.rest && e.pitches.length));
    const lowShare = soundingEvents.length
      ? soundingEvents.filter((e) => e.pitches.some((p) => p + writeOff < 55)).length / soundingEvents.length
      : 0;
    const highShare = soundingEvents.length
      ? soundingEvents.filter((e) => e.pitches.some((p) => p + writeOff >= 60)).length / soundingEvents.length
      : 0;
    const reallyGrand =
      writeOff === 0 &&
      lowShare >= 0.25 &&
      highShare >= 0.25 &&
      (settings.texture === "block" || settings.texture === "chorale");
    const hasChords = soundingEvents.some((e) => e.pitches.length > 1);
    const instLock = T.INSTRUMENTS.find((i) => i.id === settings.instrumentId);
    if ((instLock && instLock.defaultClef === "treble") || writeOff !== 0) {
      clef = "treble";
    } else if (clef === "treble" || clef === "bass" || clef === "grand") {
      /* the staff the user picked */
    } else if (!hasChords) {
      clef = "auto";
    } else if (reallyGrand || twoStaff(settings)) {
      clef = "grand";
    } else {
      clef = "auto";
    }

    return {
      key,
      time,
      clef,
      measures,
      settingsSnapshot: {
        mallets: settings.mallets,
        texture: settings.texture,
        showSticking: settings.showSticking,
        instrument: settings.instrumentId,
        tempo: settings.tempo,
        legato: !!settings.legato,
      },
    };
  }

  function applyLegatoGroups(events) {
    let i = 0;
    while (i < events.length - 1) {
      const start = events[i];
      if (start.rest || start.tie || start.tuplet || !start.pitches || !start.pitches.length) {
        i++;
        continue;
      }
      const targetLen = 2 + Math.floor(Math.random() * 3); // 2, 3, or 4
      let len = 1;
      while (len < targetLen && i + len < events.length) {
        const prev = events[i + len - 1];
        const curr = events[i + len];
        if (curr.rest || curr.tie || curr.tuplet || !curr.pitches || !curr.pitches.length) break;
        if (prev.tie) break;
        const p1 = prev.pitches[0];
        const p2 = curr.pitches[0];
        if (p1 === p2 || Math.abs(p2 - p1) > 7) break;
        len++;
      }
      if (len >= 2) {
        events[i].slurStart = true;
        for (let k = 1; k < len; k++) {
          events[i + k].slurred = true;
        }
        events[i + len - 1].slurEnd = true;
        for (let k = 0; k < len; k++) {
          if (events[i + k].articulations) {
            events[i + k].articulations = events[i + k].articulations.filter((a) => a !== "staccato");
          }
        }
        i += len;
      } else {
        i++;
      }
    }
  }

  function generateDuet(rawSettings) {
    const concertKey = resolveKey(rawSettings);
    const trumpetKey = T.transposeKeyForBb ? T.transposeKeyForBb(concertKey) : concertKey;
    const time =
      rawSettings.timeId === "random"
        ? T.pick(T.TIMES.filter((t) => ["4/4", "3/4", "2/4"].includes(t.id)))
        : T.TIMES.find((t) => t.id === rawSettings.timeId) || T.TIMES[0];

    const malletInstId = rawSettings.malletInstrument || rawSettings.duetMalletInstrument || "xylo";
    const malletInst = T.INSTRUMENTS.find((i) => i.id === malletInstId) || T.INSTRUMENTS.find((i) => i.id === "xylo");
    const style = rawSettings.style || rawSettings.duetStyle || "harmony"; // "harmony", "call_response", "melody_comp"
    const malletCount = Math.max(2, Math.min(4, parseInt(rawSettings.duetMallets || rawSettings.mallets, 10) || 2));
    const numMeasures = Math.max(4, parseInt(rawSettings.measures, 10) || 8);

    const scale = T.diatonicPitches(concertKey, 24, 115);

    // Written and sounding ranges
    const tptLow = rawSettings.duetRangeTptLow || rawSettings.rangeTptLow || 60;
    const tptHigh = rawSettings.duetRangeTptHigh || rawSettings.rangeTptHigh || 74;
    const tptSoundLow = tptLow - 2;
    const tptSoundHigh = tptHigh - 2;

    const malletLow = rawSettings.duetRangeMalletLow || (malletInst.low + (malletInst.writtenOff || 0));
    const malletHigh = rawSettings.duetRangeMalletHigh || (malletInst.high + (malletInst.writtenOff || 0));

    // Position tonic within the trumpet range
    let tonicPitch = concertKey.tonic + 60;
    while (tonicPitch < tptSoundLow + 2 && tonicPitch + 12 <= tptSoundHigh) tonicPitch += 12;
    while (tonicPitch > tptSoundHigh - 3 && tonicPitch - 12 >= tptSoundLow) tonicPitch -= 12;
    let tIdx = scale.indexOf(tonicPitch);
    if (tIdx < 0) {
      let bestD = 999;
      scale.forEach((p, i) => {
        const d = Math.abs(p - tonicPitch);
        if (d < bestD) { bestD = d; tIdx = i; }
      });
    }

    // Four cohesive, lyrical singing themes for each meter:
    const d = (id) => T.DURATIONS.find((x) => x.id === id) || T.DURATIONS[0];

    const THEMES_BY_TIME = {
      "4/4": [
        // 1. "Solgløtt" - Nordic cantabile with lyrical question & answer
        [
          [[0, "q"], [1, "8"], [2, "8"], [4, "q"], [2, "q"]], // Bar 1: 1, 2-3, 5, 3
          [[3, "q"], [2, "q"], [1, "h"]],                     // Bar 2: 4, 3, 2 (holds on 2)
          [[2, "q"], [3, "8"], [4, "8"], [5, "q"], [4, "q"]], // Bar 3: 3, 4-5, 6, 5
          [[3, "qd"], [2, "8"], [1, "h"]],                     // Bar 4: 4, 3, 2 (half cadence question)
          [[0, "q"], [1, "8"], [2, "8"], [4, "q"], [2, "q"]], // Bar 5: 1, 2-3, 5, 3 (theme returns)
          [[5, "qd"], [4, "8"], [3, "q"], [2, "q"]],          // Bar 6: 6, 5, 4, 3 (apex descent)
          [[2, "q"], [1, "8"], [0, "8"], [-1, "q"], [1, "q"]],// Bar 7: 3, 2-1, 7_sub, 2 (cadence prep)
          [[0, "w"]],                                         // Bar 8: 1 (peaceful tonic cadence)
        ],
        // 2. "Festmarsj" - Energetic triad fanfare & joyful marching tune
        [
          [[0, "q"], [2, "q"], [4, "qd"], [2, "8"]],          // Bar 1: 1, 3, 5, 3
          [[3, "8"], [4, "8"], [5, "8"], [3, "8"], [4, "h"]], // Bar 2: 4-5-6-4, 5
          [[4, "q"], [3, "8"], [2, "8"], [1, "q"], [3, "q"]], // Bar 3: 5, 4-3, 2, 4
          [[2, "qd"], [1, "8"], [0, "h"]],                     // Bar 4: 3, 2, 1
          [[0, "q"], [2, "q"], [4, "qd"], [2, "8"]],          // Bar 5: 1, 3, 5, 3
          [[5, "q"], [4, "8"], [3, "8"], [2, "q"], [4, "q"]], // Bar 6: 6, 5-4, 3, 5
          [[3, "q"], [2, "q"], [-1, "qd"], [1, "8"]],         // Bar 7: 4, 3, 7_sub, 2
          [[0, "w"]],                                         // Bar 8: 1 (final arrival)
        ],
        // 3. "Hallingdans" - Sprightly folk dance with rhythmic bounce
        [
          [[0, "q"], [2, "8"], [2, "8"], [4, "q"], [2, "q"]], // Bar 1: 1, 3-3, 5, 3
          [[3, "8"], [2, "8"], [1, "8"], [0, "8"], [1, "h"]], // Bar 2: 4-3-2-1, 2
          [[1, "q"], [3, "8"], [3, "8"], [4, "q"], [2, "q"]], // Bar 3: 2, 4-4, 5, 3
          [[3, "q"], [2, "q"], [1, "h"]],                     // Bar 4: 4, 3, 2
          [[0, "q"], [2, "8"], [2, "8"], [4, "q"], [2, "q"]], // Bar 5: 1, 3-3, 5, 3
          [[5, "q"], [4, "q"], [3, "8"], [2, "8"], [1, "q"]], // Bar 6: 6, 5, 4-3, 2
          [[2, "q"], [1, "8"], [0, "8"], [-1, "q"], [1, "q"]],// Bar 7: 3, 2-1, 7_sub, 2
          [[0, "w"]],                                         // Bar 8: 1
        ],
        // 4. "Kveldsro" - Peaceful legato cantabile
        [
          [[2, "h"], [1, "q"], [0, "q"]],                     // Bar 1: 3, 2, 1
          [[1, "qd"], [2, "8"], [3, "h"]],                     // Bar 2: 2, 3, 4
          [[4, "h"], [3, "q"], [2, "q"]],                     // Bar 3: 5, 4, 3
          [[1, "w"]],                                         // Bar 4: 2 (half cadence)
          [[2, "h"], [1, "q"], [0, "q"]],                     // Bar 5: 3, 2, 1
          [[5, "h"], [4, "q"], [3, "q"]],                     // Bar 6: 6, 5, 4
          [[2, "qd"], [1, "8"], [-1, "h"]],                    // Bar 7: 3, 2, 7_sub
          [[0, "w"]],                                         // Bar 8: 1
        ],
      ],
      "3/4": [
        // 1. "Valsefantasi"
        [
          [[0, "q"], [2, "q"], [4, "q"]],
          [[5, "h"], [4, "q"]],
          [[3, "q"], [2, "q"], [1, "q"]],
          [[2, "hd"]],
          [[0, "q"], [2, "q"], [4, "q"]],
          [[5, "h"], [6, "q"]],
          [[4, "q"], [3, "q"], [1, "q"]],
          [[0, "hd"]],
        ],
        // 2. "Sommervals"
        [
          [[2, "h"], [3, "q"]],
          [[4, "h"], [2, "q"]],
          [[1, "q"], [2, "q"], [3, "q"]],
          [[2, "hd"]],
          [[2, "h"], [4, "q"]],
          [[5, "h"], [3, "q"]],
          [[2, "q"], [1, "q"], [-1, "q"]],
          [[0, "hd"]],
        ],
      ],
      "2/4": [
        // 1. "Trompetmarsj"
        [
          [[0, "8"], [2, "8"], [4, "q"]],
          [[5, "8"], [4, "8"], [3, "q"]],
          [[2, "8"], [3, "8"], [4, "8"], [2, "8"]],
          [[1, "h"]],
          [[0, "8"], [2, "8"], [4, "q"]],
          [[5, "8"], [6, "8"], [4, "q"]],
          [[3, "8"], [2, "8"], [-1, "8"], [1, "8"]],
          [[0, "h"]],
        ],
        // 2. "Galopp"
        [
          [[0, "qd"], [2, "8"]],
          [[4, "8"], [3, "8"], [2, "q"]],
          [[1, "qd"], [3, "8"]],
          [[2, "h"]],
          [[0, "qd"], [2, "8"]],
          [[4, "8"], [5, "8"], [6, "q"]],
          [[4, "8"], [3, "8"], [1, "8"], [-1, "8"]],
          [[0, "h"]],
        ],
      ],
    };

    const meterKey = time.id === "3/4" ? "3/4" : time.id === "2/4" ? "2/4" : "4/4";
    const themesForMeter = THEMES_BY_TIME[meterKey] || THEMES_BY_TIME["4/4"];
    const chosenTheme = T.pick(themesForMeter);

    // Harmonic chords per bar (scale degrees relative to tonic):
    const CHORDS_8 = [
      { name: "I",  rootDeg: 0, fifthDeg: 4, thirdDeg: 2 },
      { name: "IV", rootDeg: 3, fifthDeg: 0, thirdDeg: 5 },
      { name: "V",  rootDeg: 4, fifthDeg: 1, thirdDeg: 6 },
      { name: "I",  rootDeg: 0, fifthDeg: 4, thirdDeg: 2 },
      { name: "I",  rootDeg: 0, fifthDeg: 4, thirdDeg: 2 },
      { name: "IV", rootDeg: 3, fifthDeg: 0, thirdDeg: 5 },
      { name: "V",  rootDeg: 4, fifthDeg: 1, thirdDeg: 6 },
      { name: "I",  rootDeg: 0, fifthDeg: 4, thirdDeg: 2 },
    ];

    const isHighPercussion = malletInstId === "xylo" || malletInstId === "glock";

    function getMalletPitch(tptSoundingMidi, isCadenceNote) {
      let idx = scale.indexOf(tptSoundingMidi);
      if (idx < 0) {
        let minDist = 999;
        scale.forEach((p, i) => {
          const dist = Math.abs(p - tptSoundingMidi);
          if (dist < minDist) { minDist = dist; idx = i; }
        });
      }

      // Consonant diatonic counterpoint:
      // - Glockenspiel: 3rd + 2 octaves above (+16 diatonic steps)
      // - Xylophone: 3rd + 1 octave above (+9 diatonic steps)
      // - Marimba / Vibraphone: 3rd below (-2 diatonic steps)
      const stepOffset = malletInstId === "glock" ? 16 : malletInstId === "xylo" ? 9 : -2;
      let targetIdx = idx + stepOffset;

      while (targetIdx < 0 || scale[targetIdx] < malletInst.low) {
        if (targetIdx + 7 >= scale.length) break;
        targetIdx += 7;
      }
      while (targetIdx >= scale.length || scale[targetIdx] > malletInst.high) {
        if (targetIdx - 7 < 0) break;
        targetIdx -= 7;
      }

      const userSoundingLow = malletLow - (malletInst.writtenOff || 0);
      const userSoundingHigh = malletHigh - (malletInst.writtenOff || 0);
      while (scale[targetIdx] < userSoundingLow && targetIdx + 7 < scale.length) targetIdx += 7;
      while (scale[targetIdx] > userSoundingHigh && targetIdx - 7 >= 0) targetIdx -= 7;

      return scale[targetIdx];
    }

    function getEchoPitch(tptSoundingMidi) {
      // Echo the melody in the instrument's sweet singing register:
      // - Glock: +24 semitones (written unison)
      // - Xylo: +12 semitones (written unison)
      // - Marimba / Vibes: +0 semitones (sounding & written unison)
      const octOffset = malletInstId === "glock" ? 24 : malletInstId === "xylo" ? 12 : 0;
      let targetMidi = tptSoundingMidi + octOffset;
      while (targetMidi < malletInst.low) targetMidi += 12;
      while (targetMidi > malletInst.high) targetMidi -= 12;

      const userSoundingLow = malletLow - (malletInst.writtenOff || 0);
      const userSoundingHigh = malletHigh - (malletInst.writtenOff || 0);
      while (targetMidi < userSoundingLow && targetMidi + 12 <= malletInst.high) targetMidi += 12;
      while (targetMidi > userSoundingHigh && targetMidi - 12 >= malletInst.low) targetMidi -= 12;

      return targetMidi;
    }

    function getMalletVoicing(mIndex, isFinalBar, isPhraseEnd, baseMalletPitch) {
      if (malletCount < 2) {
        return { pitches: [baseMalletPitch], mallets: [1] };
      }
      const chord = CHORDS_8[mIndex % 8];
      const rootDeg = chord.rootDeg;
      const thirdDeg = chord.thirdDeg;
      const fifthDeg = chord.fifthDeg;

      let rPitch = scale[Math.max(0, Math.min(scale.length - 1, tIdx + rootDeg))];
      let tPitch = scale[Math.max(0, Math.min(scale.length - 1, tIdx + thirdDeg))];
      let fPitch = scale[Math.max(0, Math.min(scale.length - 1, tIdx + fifthDeg))];

      if (isHighPercussion) {
        const add = malletInstId === "glock" ? 24 : 12;
        rPitch += add;
        tPitch += add;
        fPitch += add;
      } else {
        while (rPitch - 12 >= malletInst.low && rPitch - 12 >= malletLow) rPitch -= 12;
      }
      rPitch = T.clamp(rPitch, malletLow, malletHigh);
      tPitch = T.clamp(tPitch, malletLow, malletHigh);
      fPitch = T.clamp(fPitch, malletLow, malletHigh);

      if (malletCount === 2) {
        // Dyad (2 mallets): root + 3rd or root + 5th
        let upper = (tPitch !== rPitch && Math.abs(tPitch - rPitch) >= 3 && Math.abs(tPitch - rPitch) <= 16)
          ? tPitch
          : fPitch;
        if (upper === rPitch || Math.abs(upper - rPitch) < 3) {
          upper = (rPitch + 7 <= malletHigh) ? rPitch + 7 : (rPitch + 4 <= malletHigh ? rPitch + 4 : baseMalletPitch);
        }
        upper = T.clamp(upper, malletLow, malletHigh);
        const pitches = [...new Set([rPitch, upper])].sort((a, b) => a - b);
        if (pitches.length === 1 && pitches[0] + 7 <= malletHigh) {
          pitches.push(pitches[0] + 7);
        }
        return {
          pitches: pitches.length ? pitches : [baseMalletPitch],
          mallets: pitches.length >= 2 ? [1, 2] : [1],
        };
      } else if (malletCount === 3) {
        // Triad (3 mallets): root + 3rd + 5th
        let triad = [...new Set([rPitch, tPitch, fPitch])].filter((p) => p >= malletLow && p <= malletHigh).sort((a, b) => a - b);
        if (triad.length < 3 && triad[0] + 12 <= malletHigh) {
          triad.push(triad[0] + 12);
        }
        triad.sort((a, b) => a - b);
        return {
          pitches: triad.length ? triad : [baseMalletPitch],
          mallets: [1, 2, 3].slice(0, triad.length),
        };
      } else {
        // 4 mallets: root + 5th + 3rd + octave
        const oct = Math.min(malletHigh, rPitch + 12);
        let quad = [...new Set([rPitch, fPitch, tPitch, oct])].filter((p) => p >= malletLow && p <= malletHigh).sort((a, b) => a - b);
        if (quad.length < 4 && quad[quad.length - 1] + 12 <= malletHigh) {
          quad.push(quad[quad.length - 1] + 12);
        }
        if (quad.length < 4 && quad[0] - 12 >= malletLow) {
          quad.unshift(quad[0] - 12);
        }
        quad.sort((a, b) => a - b);
        return {
          pitches: quad.length ? quad : [baseMalletPitch],
          mallets: [1, 2, 3, 4].slice(0, quad.length),
        };
      }
    }

    // Active rhythm features based on user settings:
    const allowedRhythms = new Set(rawSettings.rhythms || ["w", "h", "hd", "q", "qd", "8"]);
    const has16 = allowedRhythms.has("16");
    const hasTriplets = allowedRhythms.has("8t") || allowedRhythms.has("qt");
    const hasDotted8 = allowedRhythms.has("8d");

    function subdivideCell(cell, isFinalCell) {
      if (isFinalCell) return null;
      const deg = cell[0];
      const durId = cell[1];

      if (durId === "q") {
        if (hasTriplets && Math.random() < 0.35) {
          const dir = Math.random() < 0.5 ? 1 : -1;
          return [
            { deg: deg, dur: d("8t"), tuplet: "start" },
            { deg: deg + dir, dur: d("8t"), tuplet: null },
            { deg: deg, dur: d("8t"), tuplet: "end" },
          ];
        }
        if (has16 && Math.random() < 0.45) {
          const r = Math.random();
          if (hasDotted8 && r < 0.35) {
            return [
              { deg: deg, dur: d("8d"), tuplet: null },
              { deg: deg + 1, dur: d("16"), tuplet: null },
            ];
          } else if (r < 0.70) {
            return [
              { deg: deg, dur: d("16"), tuplet: null },
              { deg: deg + 1, dur: d("16"), tuplet: null },
              { deg: deg + 2, dur: d("16"), tuplet: null },
              { deg: deg + 1, dur: d("16"), tuplet: null },
            ];
          } else {
            return [
              { deg: deg, dur: d("16"), tuplet: null },
              { deg: deg + 1, dur: d("16"), tuplet: null },
              { deg: deg, dur: d("8"), tuplet: null },
            ];
          }
        }
      } else if (durId === "8") {
        if (has16 && Math.random() < 0.28) {
          return [
            { deg: deg, dur: d("16"), tuplet: null },
            { deg: deg + 1, dur: d("16"), tuplet: null },
          ];
        }
      }
      return null;
    }

    const trumpetMeasures = [];
    const malletMeasures = [];
    const callTptEvents = [];

    for (let m = 0; m < numMeasures; m++) {
      let barNotes;
      if (numMeasures === 4) {
        const map4 = [0, 1, 6, 7];
        barNotes = chosenTheme[map4[m]];
      } else {
        barNotes = chosenTheme[m % 8];
      }
      const isFinalBar = m === numMeasures - 1;
      const isPhraseEnd = (m + 1) % 4 === 0 || isFinalBar;

      const tptEvents = [];
      const malletEvents = [];

      if (style === "call_response") {
        const isCadencePhrase = m >= numMeasures - 2;
        const isTptSolo = !isCadencePhrase && (m % 4 === 0 || m % 4 === 1);
        const isMalletSolo = !isCadencePhrase && (m % 4 === 2 || m % 4 === 3);

        if (isTptSolo) {
          barNotes.forEach((item, ni) => {
            const isLastInBar = (ni === barNotes.length - 1);
            const sub = subdivideCell(item, isFinalBar && isLastInBar);
            if (!sub) {
              const deg = item[0];
              const dur = d(item[1]);
              const tptSounding = scale[Math.max(0, Math.min(scale.length - 1, tIdx + deg))];
              const writtenTpt = T.clamp(tptSounding + 2, tptLow, tptHigh);
              tptEvents.push({
                rest: false,
                dur: dur,
                pitches: [writtenTpt],
                mallets: [],
                sticking: rawSettings.showSticking ? T.trumpetValve(writtenTpt) : null,
              });
              malletEvents.push({ rest: true, dur: dur, pitches: [], mallets: [] });
            } else {
              sub.forEach((sn) => {
                const tptSounding = scale[Math.max(0, Math.min(scale.length - 1, tIdx + sn.deg))];
                const writtenTpt = T.clamp(tptSounding + 2, tptLow, tptHigh);
                tptEvents.push({
                  rest: false,
                  dur: sn.dur,
                  tuplet: sn.tuplet || null,
                  pitches: [writtenTpt],
                  mallets: [],
                  sticking: rawSettings.showSticking ? T.trumpetValve(writtenTpt) : null,
                });
                malletEvents.push({ rest: true, dur: sn.dur, tuplet: sn.tuplet || null, pitches: [], mallets: [] });
              });
            }
          });
          callTptEvents[m % 4] = tptEvents.slice();
        } else if (isMalletSolo) {
          const echoRef = callTptEvents[(m % 4) - 2];
          if (echoRef && echoRef.length) {
            echoRef.forEach((refEv) => {
              const dur = refEv.dur;
              const tuplet = refEv.tuplet || null;
              tptEvents.push({ rest: true, dur: dur, tuplet: tuplet, pitches: [], mallets: [] });
              const refTptWritten = refEv.pitches[0];
              const refTptSounding = refTptWritten - 2;
              const malPitch = getEchoPitch(refTptSounding);
              malletEvents.push({ rest: false, dur: dur, tuplet: tuplet, pitches: [malPitch], mallets: [1] });
            });
          } else {
            barNotes.forEach((item) => {
              const deg = item[0];
              const dur = d(item[1]);
              const tptSounding = scale[Math.max(0, Math.min(scale.length - 1, tIdx + deg))];
              tptEvents.push({ rest: true, dur: dur, pitches: [], mallets: [] });
              const malPitch = getEchoPitch(tptSounding);
              malletEvents.push({ rest: false, dur: dur, pitches: [malPitch], mallets: [1] });
            });
          }
        } else {
          // Cadence bars: play together in harmony!
          barNotes.forEach((item, ni) => {
            const isLastInBar = (ni === barNotes.length - 1);
            const isLastNote = isFinalBar && isLastInBar;
            const deg = isLastNote ? 0 : item[0];
            const dur = d(item[1]);
            const tptSounding = scale[Math.max(0, Math.min(scale.length - 1, tIdx + deg))];
            const writtenTpt = T.clamp(tptSounding + 2, tptLow, tptHigh);
            const malPitch = getMalletPitch(tptSounding, isLastNote);

            tptEvents.push({
              rest: false,
              dur: dur,
              pitches: [writtenTpt],
              mallets: [],
              sticking: rawSettings.showSticking ? T.trumpetValve(writtenTpt) : null,
            });
            const voicing = (isLastNote && malletCount >= 2)
              ? getMalletVoicing(m, true, true, malPitch)
              : { pitches: [malPitch], mallets: [1] };
            malletEvents.push({ rest: false, dur: dur, pitches: voicing.pitches, mallets: voicing.mallets });
          });
        }
      } else if (style === "melody_comp") {
        barNotes.forEach((item, ni) => {
          const isLastInBar = (ni === barNotes.length - 1);
          const sub = subdivideCell(item, isFinalBar && isLastInBar);
          if (!sub) {
            const deg = item[0];
            const dur = d(item[1]);
            const tptSounding = scale[Math.max(0, Math.min(scale.length - 1, tIdx + deg))];
            const writtenTpt = T.clamp(tptSounding + 2, tptLow, tptHigh);

            tptEvents.push({
              rest: false,
              dur: dur,
              pitches: [writtenTpt],
              mallets: [],
              sticking: rawSettings.showSticking ? T.trumpetValve(writtenTpt) : null,
            });
          } else {
            sub.forEach((sn) => {
              const tptSounding = scale[Math.max(0, Math.min(scale.length - 1, tIdx + sn.deg))];
              const writtenTpt = T.clamp(tptSounding + 2, tptLow, tptHigh);
              tptEvents.push({
                rest: false,
                dur: sn.dur,
                tuplet: sn.tuplet || null,
                pitches: [writtenTpt],
                mallets: [],
                sticking: rawSettings.showSticking ? T.trumpetValve(writtenTpt) : null,
              });
            });
          }
        });

        const chord = CHORDS_8[m % 8];
        const rootDeg = chord.rootDeg;
        const thirdDeg = chord.thirdDeg;
        const fifthDeg = chord.fifthDeg;

        let rootPitch = scale[Math.max(0, Math.min(scale.length - 1, tIdx + rootDeg))];
        let thirdPitch = scale[Math.max(0, Math.min(scale.length - 1, tIdx + thirdDeg))];
        let fifthPitch = scale[Math.max(0, Math.min(scale.length - 1, tIdx + fifthDeg))];

        let bassPitch = rootPitch;
        if (isHighPercussion) {
          bassPitch = malletInstId === "glock" ? bassPitch + 24 : bassPitch + 12;
          thirdPitch = malletInstId === "glock" ? thirdPitch + 24 : thirdPitch + 12;
          fifthPitch = malletInstId === "glock" ? fifthPitch + 24 : fifthPitch + 12;
        } else {
          while (bassPitch - 12 >= malletInst.low) bassPitch -= 12;
        }
        bassPitch = T.clamp(bassPitch, malletInst.low, malletInst.high);
        thirdPitch = T.clamp(thirdPitch, malletInst.low, malletInst.high);
        fifthPitch = T.clamp(fifthPitch, malletInst.low, malletInst.high);

        if (isFinalBar) {
          const finalDur = meterKey === "4/4" ? d("w") : meterKey === "3/4" ? d("hd") : d("h");
          let finalPitches = [bassPitch];
          let finalMallets = [1];
          if (malletCount === 2) {
            const v2 = getMalletVoicing(m, true, true, bassPitch);
            finalPitches = v2.pitches;
            finalMallets = v2.mallets;
          } else if (malletCount === 3) {
            finalPitches = [...new Set([bassPitch, thirdPitch, fifthPitch])].sort((a, b) => a - b);
            finalMallets = [1, 2, 3].slice(0, finalPitches.length);
          } else if (malletCount >= 4) {
            const oct = Math.min(malletInst.high, bassPitch + 12);
            finalPitches = [...new Set([bassPitch, fifthPitch, thirdPitch, oct])].sort((a, b) => a - b);
            finalMallets = [1, 2, 3, 4].slice(0, finalPitches.length);
          }
          malletEvents.push({
            rest: false,
            dur: finalDur,
            pitches: finalPitches,
            mallets: finalMallets,
          });
        } else if (meterKey === "3/4") {
          malletEvents.push({
            rest: false,
            dur: d("q"),
            pitches: [bassPitch],
            mallets: [1],
          });
          const upperPitches = malletCount >= 3
            ? [...new Set([thirdPitch, fifthPitch])].sort((a, b) => a - b)
            : [thirdPitch];
          const upperMallets = malletCount >= 4 ? [3, 4] : malletCount === 3 ? [2, 3] : [2];
          malletEvents.push({
            rest: false,
            dur: d("q"),
            pitches: upperPitches,
            mallets: upperMallets,
          });
          malletEvents.push({
            rest: false,
            dur: d("q"),
            pitches: upperPitches,
            mallets: upperMallets,
          });
        } else if (meterKey === "2/4") {
          malletEvents.push({
            rest: false,
            dur: d("q"),
            pitches: [bassPitch],
            mallets: [1],
          });
          const upperPitches = malletCount >= 3
            ? [...new Set([thirdPitch, fifthPitch])].sort((a, b) => a - b)
            : [fifthPitch];
          const upperMallets = malletCount >= 4 ? [3, 4] : malletCount === 3 ? [2, 3] : [2];
          malletEvents.push({
            rest: false,
            dur: d("q"),
            pitches: upperPitches,
            mallets: upperMallets,
          });
        } else {
          // 4/4
          let bassP = [bassPitch];
          let bassM = [1];
          if (malletCount === 4 && bassPitch + 7 <= malletInst.high) {
            bassP = [bassPitch, bassPitch + 7];
            bassM = [1, 2];
          }
          malletEvents.push({
            rest: false,
            dur: d("h"),
            pitches: bassP,
            mallets: bassM,
          });
          if (isPhraseEnd) {
            // Half-cadence phrase end: sustained chord
            const phraseChord = getMalletVoicing(m, false, true, bassPitch);
            malletEvents.push({
              rest: false,
              dur: d("h"),
              pitches: phraseChord.pitches,
              mallets: phraseChord.mallets,
            });
          } else {
            const chordP1 = malletCount >= 3
              ? [...new Set([thirdPitch, fifthPitch])].sort((a, b) => a - b)
              : [thirdPitch];
            const chordM1 = malletCount >= 4 ? [3, 4] : malletCount === 3 ? [2, 3] : [2];
            malletEvents.push({
              rest: false,
              dur: d("q"),
              pitches: chordP1,
              mallets: chordM1,
            });
            malletEvents.push({
              rest: false,
              dur: d("q"),
              pitches: chordP1,
              mallets: chordM1,
            });
          }
        }
      } else {
        // "harmony": pure parallel & consonant diatonic 3rds (and 10ths) with musical dialogue
        barNotes.forEach((item, ni) => {
          const isLastInBar = (ni === barNotes.length - 1);
          const isLastNote = isFinalBar && isLastInBar;
          const isPhraseCadence = isPhraseEnd && isLastInBar;
          const deg = isLastNote ? 0 : item[0];
          const origDur = d(item[1]);

          const sub = isLastNote ? null : subdivideCell(item, isFinalBar);

          if (!sub) {
            const tptSounding = scale[Math.max(0, Math.min(scale.length - 1, tIdx + deg))];
            const writtenTpt = T.clamp(tptSounding + 2, tptLow, tptHigh);
            const malPitch = getMalletPitch(tptSounding, isLastNote);

            tptEvents.push({
              rest: false,
              dur: origDur,
              pitches: [writtenTpt],
              mallets: [],
              sticking: rawSettings.showSticking ? T.trumpetValve(writtenTpt) : null,
            });

            let voicing = { pitches: [malPitch], mallets: [1] };
            if ((isLastNote || isPhraseCadence) && malletCount >= 2) {
              voicing = getMalletVoicing(m, isLastNote, isPhraseCadence, malPitch);
            } else if (origDur.ticks >= 24 && malletCount >= 2 && Math.random() < 0.6) {
              voicing = getMalletVoicing(m, false, false, malPitch);
            }

            malletEvents.push({
              rest: false,
              dur: origDur,
              pitches: voicing.pitches,
              mallets: voicing.mallets,
            });
          } else {
            const textureRoll = Math.random();
            if (textureRoll < 0.40) {
              // Both play the flourish in parallel
              sub.forEach((sn) => {
                const tptSounding = scale[Math.max(0, Math.min(scale.length - 1, tIdx + sn.deg))];
                const writtenTpt = T.clamp(tptSounding + 2, tptLow, tptHigh);
                const malPitch = getMalletPitch(tptSounding, false);

                tptEvents.push({
                  rest: false,
                  dur: sn.dur,
                  tuplet: sn.tuplet || null,
                  pitches: [writtenTpt],
                  mallets: [],
                  sticking: rawSettings.showSticking ? T.trumpetValve(writtenTpt) : null,
                });
                malletEvents.push({
                  rest: false,
                  dur: sn.dur,
                  tuplet: sn.tuplet || null,
                  pitches: [malPitch],
                  mallets: [1],
                });
              });
            } else if (textureRoll < 0.70) {
              // Dialogue: Trumpet flourish, Mallet holds sustained note
              sub.forEach((sn) => {
                const tptSounding = scale[Math.max(0, Math.min(scale.length - 1, tIdx + sn.deg))];
                const writtenTpt = T.clamp(tptSounding + 2, tptLow, tptHigh);
                tptEvents.push({
                  rest: false,
                  dur: sn.dur,
                  tuplet: sn.tuplet || null,
                  pitches: [writtenTpt],
                  mallets: [],
                  sticking: rawSettings.showSticking ? T.trumpetValve(writtenTpt) : null,
                });
              });
              const baseTptSounding = scale[Math.max(0, Math.min(scale.length - 1, tIdx + deg))];
              const malPitch = getMalletPitch(baseTptSounding, false);
              const voicing = (origDur.ticks >= 24 && malletCount >= 2)
                ? getMalletVoicing(m, false, isPhraseCadence, malPitch)
                : { pitches: [malPitch], mallets: [1] };
              malletEvents.push({
                rest: false,
                dur: origDur,
                pitches: voicing.pitches,
                mallets: voicing.mallets,
              });
            } else {
              // Dialogue: Trumpet holds sustained note, Mallet plays flourish
              const baseTptSounding = scale[Math.max(0, Math.min(scale.length - 1, tIdx + deg))];
              const writtenTpt = T.clamp(baseTptSounding + 2, tptLow, tptHigh);
              tptEvents.push({
                rest: false,
                dur: origDur,
                pitches: [writtenTpt],
                mallets: [],
                sticking: rawSettings.showSticking ? T.trumpetValve(writtenTpt) : null,
              });
              sub.forEach((sn) => {
                const harmSounding = scale[Math.max(0, Math.min(scale.length - 1, tIdx + sn.deg))];
                const malPitch = getMalletPitch(harmSounding, false);
                malletEvents.push({
                  rest: false,
                  dur: sn.dur,
                  tuplet: sn.tuplet || null,
                  pitches: [malPitch],
                  mallets: [1],
                });
              });
            }
          }
        });
      }

      if (rawSettings.legato) {
        applyLegatoGroups(tptEvents);
        applyLegatoGroups(malletEvents);
      }

      trumpetMeasures.push({ events: tptEvents });
      malletMeasures.push({ events: malletEvents });
    }

    applyDynamics(trumpetMeasures, rawSettings);
    applyDynamics(malletMeasures, rawSettings);

    let malletClef = "treble";
    if (malletInstId === "mar50" || malletInstId === "mar43") {
      const allM = malletMeasures.flatMap((m) => m.events.flatMap((e) => e.pitches));
      const avg = allM.reduce((a, b) => a + b, 0) / (allM.length || 1);
      malletClef = avg < 57 ? "bass" : "treble";
    }

    return {
      isDuet: true,
      key: concertKey,
      trumpetKey: trumpetKey,
      time: time,
      clef: "treble",
      malletClef: malletClef,
      duetStyle: style,
      malletInstrumentId: malletInst.id,
      malletInstrumentName: malletInst.name,
      trumpetMeasures: trumpetMeasures,
      malletMeasures: malletMeasures,
      measures: trumpetMeasures,
      settingsSnapshot: {
        instrument: "duet",
        duetMalletInstrument: malletInst.id,
        duetMallets: malletCount,
        mallets: malletCount,
        duetStyle: style,
        tempo: rawSettings.tempo || 80,
        legato: !!rawSettings.legato,
      },
    };
  }

  global.Generator = { generate, generateDuet };
})(window);
