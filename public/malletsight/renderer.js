/* ABC / abcjs rendering — beaming and stems follow standard notation */
(function (global) {
  const T = global.Theory;

  function abcOctaveLetter(letter, oct) {
    if (oct <= 1) return letter + ",,,";
    if (oct === 2) return letter + ",,";
    if (oct === 3) return letter + ",";
    if (oct === 4) return letter;
    if (oct === 5) return letter.toLowerCase();
    if (oct === 6) return letter.toLowerCase() + "'";
    if (oct === 7) return letter.toLowerCase() + "''";
    return letter.toLowerCase() + "'''";
  }

  function midiToAbcNote(midi, key, accidentals) {
    return T.spellAbc(midi, key, accidentals);
  }

  function gcd(a, b) {
    a = Math.abs(a);
    b = Math.abs(b);
    while (b) {
      const t = a % b;
      a = b;
      b = t;
    }
    return a || 1;
  }

  function durAbc(ticks) {
    const unit = T.TICKS.sixteenth;
    let n = ticks;
    let d = unit;
    const g = gcd(n, d);
    n /= g;
    d /= g;
    if (d === 1) return n === 1 ? "" : String(n);
    if (n === 1) return "/" + d;
    return n + "/" + d;
  }

  function abcTicks(ev) {
    return ev.dur.writtenTicks || ev.dur.ticks;
  }

  function eventToken(ev, score, options, accidentals) {
    if (ev.rest || !ev.pitches || !ev.pitches.length) {
      return "z" + durAbc(abcTicks(ev));
    }
    const off = T.writtenOff(score.settingsSnapshot.instrument);
    const pitches = [...new Set(ev.pitches)].sort((a, b) => a - b).map((p) => p + off);
    const notes = pitches.map((p) => midiToAbcNote(p, score.key, accidentals));
    const len = durAbc(abcTicks(ev));
    let body;
    if (notes.length === 1) body = notes[0] + len;
    else body = "[" + notes.join("") + "]" + len;
    if (ev.tie) body += "-";
    if (ev.articulations && ev.articulations.indexOf("staccato") >= 0) body = "." + body;
    if (ev.articulations && ev.articulations.indexOf("a") >= 0) body = "!>!" + body;
    if (ev.roll) body = "!///!" + body;
    if (options.showSticking) {
      if (score.settingsSnapshot.instrument === "trumpet" && pitches.length) {
        body = '"^' + T.trumpetValve(pitches[0]) + '"' + body;
      } else if (ev.mallets && ev.mallets.length) {
        body = '"' + ev.mallets.join("") + '"' + body;
      }
    }
    return body;
  }

  function measureClef(measure, off, prev) {
    const pts = measure.events.flatMap((e) => (e.pitches || []).map((p) => p + off));
    if (!pts.length) return prev || "treble";
    const mid = pts.reduce((a, b) => a + b, 0) / pts.length;
    const lowShare = pts.filter((p) => p <= 58).length / pts.length;
    const highShare = pts.filter((p) => p >= 62).length / pts.length;
    if (highShare >= 0.65) return "treble";
    if (lowShare >= 0.40) return "bass";
    if (mid >= 62) return "treble";
    if (mid <= 58) return "bass";
    return prev || (mid >= 60 ? "treble" : "bass");
  }

  function staffClef(score) {
    if (score.clef === "bass" || score.clef === "treble" || score.clef === "grand" || score.clef === "auto") {
      return score.clef;
    }
    return "treble";
  }

  function collapseTupletRests(events) {
    const out = [];
    let i = 0;
    while (i < events.length) {
      if (events[i].tuplet !== "start") {
        out.push(events[i]);
        i++;
        continue;
      }
      let j = i;
      const group = [];
      while (j < events.length) {
        group.push(events[j]);
        if (events[j].tuplet === "end") {
          j++;
          break;
        }
        j++;
      }
      const closed = group.length && group[group.length - 1].tuplet === "end";
      if (closed && group.every((e) => e.rest)) {
        const ticks = group.reduce((s, e) => s + (e.dur.ticks || 0), 0);
        out.push({ rest: true, dur: { ticks: ticks }, pitches: [], mallets: [] });
      } else {
        group.forEach((e) => out.push(e));
      }
      i = j;
    }
    return out;
  }

  function packStaffEvents(events, barTicks) {
    events = collapseTupletRests(events);
    const raw = [];
    events.forEach((ev) => {
      if (ev.rest && !ev.tuplet && raw.length && raw[raw.length - 1].rest && !raw[raw.length - 1].tuplet) {
        raw[raw.length - 1] = {
          rest: true,
          dur: { ticks: raw[raw.length - 1].dur.ticks + ev.dur.ticks },
          pitches: [],
          mallets: [],
        };
      } else if (ev.rest && ev.tuplet) {
        raw.push(ev);
      } else if (ev.rest) {
        raw.push({ rest: true, dur: { ticks: ev.dur.ticks }, pitches: [], mallets: [] });
      } else {
        raw.push(ev);
      }
    });
    const units = T.DURATIONS.filter((d) => !d.group).map((d) => d.ticks).sort((a, b) => b - a);
    const out = [];
    raw.forEach((ev) => {
      if (!ev.rest || ev.tuplet) {
        out.push(ev);
        return;
      }
      let t = ev.dur.ticks;
      units.forEach((u) => {
        while (t >= u) {
          out.push({ rest: true, dur: { ticks: u }, pitches: [], mallets: [] });
          t -= u;
        }
      });
    });
    const sounding = out.some((e) => !e.rest);
    if (!sounding && barTicks) {
      return [{ rest: true, dur: { ticks: barTicks }, pitches: [], mallets: [] }];
    }
    return out;
  }

  function measureAbc(measure, score, options, time) {
    const beat = time.beatTicks || T.TICKS.quarter;
    const events = collapseTupletRests(measure.events || []);
    const accidentals = new Map();
    let out = "";
    let beam = "";
    let acc = 0;
    const flush = () => {
      if (beam) out += beam + " ";
      beam = "";
    };
    let i = 0;
    while (i < events.length) {
      const ev = events[i];
      if (ev.tuplet === "start" && ev.dur && ev.dur.group > 1) {
        flush();
        const group = [];
        while (i < events.length) {
          group.push(events[i]);
          acc += events[i].dur.ticks;
          const end = events[i].tuplet === "end";
          i++;
          if (end) break;
        }
        const closed = group.length === (ev.dur.group || 3) && group[group.length - 1].tuplet === "end";
        if (!closed) {
          group.forEach((g) => {
            const plain = Object.assign({}, g, { tuplet: null, dur: Object.assign({}, g.dur, { group: 0, writtenTicks: g.dur.ticks }) });
            out += markingPrefix(plain) + eventToken(plain, score, options, accidentals) + " ";
          });
          continue;
        }
        let tok = "(3";
        group.forEach((g) => {
          tok += markingPrefix(g) + eventToken(g, score, options, accidentals);
        });
        out += tok + " ";
        continue;
      }
      let tok = eventToken(ev, score, options, accidentals);
      const prefix = markingPrefix(ev);
      const beamable = !ev.rest && ev.dur.beamable && ev.pitches && ev.pitches.length;
      if (prefix) tok = prefix + tok;
      if (!beamable) {
        flush();
        out += tok + " ";
      } else {
        beam += tok;
      }
      acc += ev.dur.ticks;
      if (beat && acc % beat === 0) flush();
      i++;
    }
    flush();
    return out.trim();
  }

  function splitEv(ev, split, side, off) {
    off = off || 0;
    if (ev.rest) return ev;
    const pitches = (ev.pitches || []).filter((p) =>
      side === "upper" ? p + off >= split : p + off < split
    );
    if (!pitches.length) return { rest: true, dur: ev.dur, pitches: [], mallets: [], tuplet: ev.tuplet || null };
    const copy = Object.assign({}, ev, { pitches: pitches });
    if (side === "lower") {
      const upperHas = (ev.pitches || []).some((p) => p + off >= split);
      if (upperHas) {
        copy.dynamic = null;
        copy.hairpin = null;
      }
    }
    return copy;
  }

  function markingPrefix(ev) {
    let prefix = "";
    if (ev.hairpin === "cresc-start") prefix += "!<(!";
    else if (ev.hairpin === "dim-start") prefix += "!>(!";
    else if (ev.hairpin === "cresc-end") prefix += "!<)!";
    else if (ev.hairpin === "dim-end") prefix += "!>)!";
    if (ev.dynamic) prefix += "!" + ev.dynamic + "!";
    return prefix;
  }

  function scoreToAbc(score, options) {
    const inst = T.INSTRUMENTS.find((i) => i.id === score.settingsSnapshot.instrument);
    const off = inst && inst.writtenOff ? inst.writtenOff : 0;
    const sOff = inst && inst.soundOff ? inst.soundOff : 0;
    const trans =
      off === -12
        ? " · klinger 8va"
        : off === -24
          ? " · klinger 15ma"
          : sOff === -2
            ? " · klinger i B"
            : "";
    const malletPart =
      inst && inst.monophonic
        ? ""
        : " · " + score.settingsSnapshot.mallets + " køller";
    const title =
      (inst ? inst.name : "Køller") +
      trans +
      malletPart +
      " · " +
      score.key.name;
    let clef = staffClef(score);
    if (inst && inst.defaultClef === "treble") clef = "treble";
    const keyId = score.key.id;
    const lines = [
      "X:1",
      "T:" + title,
      "M:" + score.time.id,
      "L:1/16",
      "Q:1/4=" + (score.settingsSnapshot.tempo || 80),
      "%%stretchlast 0",
    ];
    if (clef === "grand") {
      lines.push("%%staves {1 2}");
      lines.push("V:1 clef=treble");
      lines.push("V:2 clef=bass");
      lines.push("K:" + keyId);
      const upper = [];
      const lower = [];
      score.measures.forEach((m) => {
        const u = {
          events: packStaffEvents(
            m.events.map((ev) => splitEv(ev, 60, "upper", off)),
            score.time.ticks
          ),
        };
        const l = {
          events: packStaffEvents(
            m.events.map((ev) => splitEv(ev, 60, "lower", off)),
            score.time.ticks
          ),
        };
        upper.push(measureAbc(u, score, options, score.time));
        lower.push(measureAbc(l, score, options, score.time));
      });
      lines.push("[V:1] " + upper.join(" | ") + " |]");
      lines.push("[V:2] " + lower.join(" | ") + " |]");
    } else if (clef === "auto") {
      lines.push("%%linebreak <EOL>");
      let prev = null;
      const bars = score.measures.map((m) => {
        const c = measureClef(m, off, prev);
        const bar = { clef: c, changed: prev != null && c !== prev, music: measureAbc(m, score, options, score.time) };
        prev = c;
        return bar;
      });
      const width = options.staffWidth || 640;
      const per = width < 520 ? 2 : width < 860 ? 3 : 4;
      const groups = [[]];
      bars.forEach((bar) => {
        const line = groups[groups.length - 1];
        if (line.length >= per && !bar.changed) groups.push([]);
        else if (line.length >= per + 1 && bar.changed) groups.push([]);
        groups[groups.length - 1].push(bar);
      });
      if (bars.length) lines.push("K:" + keyId + " clef=" + bars[0].clef);
      groups.forEach((group, gi) => {
        if (!group.length) return;
        const body = group
          .map((bar, bi) => (bar.changed && !(gi === 0 && bi === 0) ? "[K:" + keyId + " clef=" + bar.clef + "] " : "") + bar.music)
          .join(" | ");
        lines.push(body + (gi === groups.length - 1 ? " |]" : " |"));
      });
    } else {
      lines.push("K:" + keyId + " clef=" + (clef === "bass" ? "bass" : "treble"));
      const body = score.measures.map((m) => measureAbc(m, score, options, score.time)).join(" | ");
      lines.push(body + " |]");
    }
    return lines.join("\n");
  }

  function renderScore(container, score, options) {
    options = options || {};
    container.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "score-inner abc-wrap";
    container.appendChild(wrap);

    if (typeof ABCJS === "undefined") {
      wrap.innerHTML = '<p class="error">Notemotoren mangler (abcjs).</p>';
      return;
    }

    const pageW = Math.max(280, container.clientWidth || 800);
    const abc = scoreToAbc(score, Object.assign({}, options, { staffWidth: Math.max(240, pageW - 36) }));
    const pageWUsed = Math.max(240, pageW - 36);
    const scale = Math.max(0.75, Math.min(1.8, options.zoom || 1));
    const manualLines = abc.indexOf("%%linebreak") >= 0;
    try {
      const rendered = ABCJS.renderAbc(wrap, abc, {
        scale: scale,
        staffwidth: pageWUsed,
        paddingtop: 8,
        paddingbottom: 12,
        paddingleft: 8,
        paddingright: 12,
        wrap: manualLines
          ? undefined
          : {
              minSpacing: 1.35,
              maxSpacing: 2.2,
              staffwidth: pageWUsed,
            },
        add_classes: true,
      });
      return rendered && rendered[0] ? rendered[0] : null;
    } catch (err) {
      console.error(err);
      const p = document.createElement("p");
      p.className = "error";
      p.textContent = "Kunne ikke tegne denne etyden. " + String(err.message || err);
      wrap.appendChild(p);
      return null;
    }
  }

  let hotNotes = [];
  let cursorLine = null;

  function flattenTimingElements(ev) {
    const out = [];
    (ev.elements || []).forEach((item) => {
      if (!item) return;
      if (item.length && item.nodeType == null) {
        for (let i = 0; i < item.length; i++) if (item[i]) out.push(item[i]);
      } else out.push(item);
    });
    return out;
  }

  function prepareCursor(visual, quarterBpm, beatTicks) {
    if (!visual || !visual.setTiming) return [];
    const bpm = Number(quarterBpm) || 80;
    const beatMs = ((beatTicks || 24) / 24) * (60000 / bpm);
    if (!beatMs) return [];
    let timings = [];
    try { timings = visual.setTiming(0, 0) || []; } catch (err) { return []; }
    const beats = [];
    timings.forEach((ev) => {
      if (!ev || ev.type !== "event") return;
      const idx = Math.max(0, Math.floor((ev.milliseconds + 1) / beatMs));
      if (!beats[idx]) beats[idx] = { elements: [] };
      flattenTimingElements(ev).forEach((el) => beats[idx].elements.push(el));
    });
    return beats;
  }

  function clearBeat() {
    hotNotes.forEach((el) => {
      if (el.classList) el.classList.remove("beat-hot");
    });
    hotNotes = [];
    if (cursorLine && cursorLine.parentNode) cursorLine.parentNode.removeChild(cursorLine);
    cursorLine = null;
  }

  function showBeat(beats, index) {
    clearBeat();
    if (!beats || !beats.length || index < 0) return;
    let beat = null;
    const max = Math.min(index, beats.length - 1);
    for (let i = max; i >= 0; i--) {
      if (beats[i] && beats[i].elements && beats[i].elements.length) {
        beat = beats[i];
        break;
      }
    }
    if (!beat) return;
    let svg = null;
    let x = Infinity;
    let y1 = Infinity;
    let y2 = -Infinity;
    beat.elements.forEach((el) => {
      if (!el || !el.classList) return;
      el.classList.add("beat-hot");
      hotNotes.push(el);
      if (!svg && el.ownerSVGElement) svg = el.ownerSVGElement;
      try {
        const box = el.getBBox();
        x = Math.min(x, box.x);
        y1 = Math.min(y1, box.y);
        y2 = Math.max(y2, box.y + box.height);
      } catch (err) {}
    });
    if (svg && isFinite(x) && isFinite(y1)) {
      cursorLine = document.createElementNS(svg.namespaceURI, "line");
      cursorLine.setAttribute("class", "beat-cursor");
      cursorLine.setAttribute("x1", x - 5);
      cursorLine.setAttribute("x2", x - 5);
      cursorLine.setAttribute("y1", y1 - 8);
      cursorLine.setAttribute("y2", y2 + 10);
      cursorLine.setAttribute("stroke", "#d6452e");
      cursorLine.setAttribute("stroke-width", "2.5");
      cursorLine.setAttribute("stroke-linecap", "round");
      svg.appendChild(cursorLine);
    }
    const el = hotNotes[0];
    const stage = (document.getElementById("malletsight-root") || document).querySelector(".stage");
    if (el && stage && el.getBoundingClientRect) {
      const r = el.getBoundingClientRect();
      const s = stage.getBoundingClientRect();
      if (r.bottom < s.top + 24 || r.top > s.bottom - 24) {
        el.scrollIntoView({ block: "center", inline: "nearest" });
      }
    }
  }

  global.ScoreRenderer = { renderScore, scoreToAbc, prepareCursor, showBeat, clearBeat };
})(window);
