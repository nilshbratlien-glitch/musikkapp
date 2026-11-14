/* Etude playback for Bladlesing. Clicks, timing and the AudioContext come from the
   app's shared pulse core (window.MusikkPulse), so only one sound source ever runs. */
(function (global) {
  const Pulse = global.MusikkPulse;
  let metroOn = false;
  let playing = false;
  let playOwned = false;
  let selfStop = false;
  let onHalt = null;
  let tempo = 80;
  let beatsPerBar = 4;
  let subdiv = 1;
  let onBeat = null;
  let onPlayDone = null;
  let playToken = 0;

  function ac() {
    return Pulse.audio();
  }

  function noiseBuffer(c, seconds) {
    const n = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  let clickBuf = null;
  function getClickBuf(c) {
    if (!clickBuf) clickBuf = noiseBuffer(c, 0.04);
    return clickBuf;
  }

  function midiToFreq(m) {
    return 440 * Math.pow(2, (m - 69) / 12);
  }

  const NOTE_MIDI = {
    C2: 36, G2: 43, C3: 48, G3: 55, C4: 60, G4: 67,
    C5: 72, G5: 79, C6: 84, G6: 91, C7: 96, G7: 103, C8: 108,
  };
  const SAMPLE_DIR = {
    glock: "glockenspiel",
    xylo: "xylophone",
    vibes: "vibraphone",
    mar43: "marimba",
    mar50: "marimba",
    trumpet: "trumpet",
  };
  const sampleBank = {};

  function sampleFolder(id) {
    return SAMPLE_DIR[id] || "marimba";
  }

  function loadInstrument(instId) {
    const folder = sampleFolder(instId);
    if (Array.isArray(sampleBank[folder])) return Promise.resolve(sampleBank[folder]);
    const c = ac();
    if (!c || c.state === "closed") return Promise.resolve([]);
    if (sampleBank[folder]) return sampleBank[folder];
    const p = Promise.all(
      Object.keys(NOTE_MIDI).map((name) =>
        fetch("/malletsight/sample-" + folder + "-" + name + ".mp3")
          .then((r) => (r.ok ? r.arrayBuffer() : null))
          .then((arr) => (arr ? c.decodeAudioData(arr.slice(0)) : null))
          .then((buf) => (buf ? { midi: NOTE_MIDI[name], buffer: buf } : null))
          .catch(() => null)
      )
    ).then((list) => {
      const ready = list.filter(Boolean).sort((a, b) => a.midi - b.midi);
      if (ready.length) sampleBank[folder] = ready;
      else delete sampleBank[folder];
      return ready;
    });
    sampleBank[folder] = p;
    return p;
  }

  function playSample(time, midi, instId) {
    if (instId === "trumpet") return false;
    const folder = sampleFolder(instId);
    const list = sampleBank[folder];
    if (!Array.isArray(list) || !list.length) return false;
    if (!list || !list.length) return false;
    let best = list[0];
    for (let i = 1; i < list.length; i++) {
      if (Math.abs(list[i].midi - midi) < Math.abs(best.midi - midi)) best = list[i];
    }
    const c = ac();
    if (time < c.currentTime) time = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = best.buffer;
    src.playbackRate.value = midiToFreq(midi) / midiToFreq(best.midi);
    const g = c.createGain();
    g.gain.setValueAtTime(instId === "xylo" ? 3.75 : instId === "mar43" || instId === "mar50" ? 1.125 : 0.75, time);
    src.connect(g);
    g.connect(scoreOut());
    src.start(time);
    trackNode(src);
    return true;
  }

  const MALLET_VOICE = {
    glock: { decay: 1.8, brightness: 1.6, hardness: 0.28, ratios: [1, 2.76, 5.4, 8.93], gains: [1, 0.35, 0.16, 0.08] },
    xylo: { decay: 0.38, brightness: 1.35, hardness: 0.34, ratios: [1, 3.15, 6.3, 10.2], gains: [1, 0.28, 0.12, 0.05] },
    vibes: { decay: 2.4, brightness: 0.85, hardness: 0.12, ratios: [1, 3.98, 9.2], gains: [1, 0.22, 0.07] },
    mar43: { decay: 1.15, brightness: 0.95, hardness: 0.16, ratios: [1, 3.95, 10.7], gains: [1, 0.2, 0.06] },
    mar50: { decay: 1.25, brightness: 0.9, hardness: 0.15, ratios: [1, 3.95, 10.7], gains: [1, 0.18, 0.05] },
  };

  let master = null;
  let masterBus = null;
  let playBus = null;
  let liveNodes = [];

  function out() {
    const c = ac();
    const bus = Pulse.output();
    if (!master || masterBus !== bus) {
      master = c.createGain();
      master.gain.value = 0.7;
      master.connect(bus);
      masterBus = bus;
      playBus = null;
    }
    return master;
  }

  function scoreOut() {
    const c = ac();
    const dest = out();
    if (!playBus) {
      playBus = c.createGain();
      playBus.gain.value = 0.85;
      playBus.connect(dest);
    }
    return playBus;
  }

  function trackNode(node) {
    liveNodes.push(node);
    try {
      node.onended = function () {
        liveNodes = liveNodes.filter((n) => n !== node);
      };
    } catch (e) { /* best effort */ }
  }

  function cutScoreAudio() {
    const c = ac();
    const now = c.currentTime;
    liveNodes.forEach((n) => {
      try { n.stop(now); } catch (e) { /* best effort */ }
    });
    liveNodes = [];
    if (playBus) {
      try {
        playBus.gain.cancelScheduledValues(now);
        playBus.gain.setValueAtTime(0, now);
      } catch (e) { /* best effort */ }
      playBus = c.createGain();
      playBus.gain.value = 0.85;
      playBus.connect(out());
    }
  }

  function scheduleStrike(time, midi, instId, gain) {
    const c = ac();
    if (time < c.currentTime) time = c.currentTime;
    const spec = MALLET_VOICE[instId] || MALLET_VOICE.mar50;
    const f0 = midiToFreq(midi);
    const strike = c.createBufferSource();
    strike.buffer = getClickBuf(c);
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = Math.min(8000, f0 * spec.brightness * 3.2);
    bp.Q.value = 1.4;
    const sg = c.createGain();
    sg.gain.setValueAtTime(spec.hardness * gain, time);
    sg.gain.exponentialRampToValueAtTime(0.001, time + 0.03);
    strike.connect(bp);
    bp.connect(sg);
    sg.connect(scoreOut());
    strike.start(time);
    strike.stop(time + 0.04);
    trackNode(strike);
  }

  function playTrumpetSample(time, soundMidi, durSec, isSlurred) {
    const folder = "trumpet";
    const list = sampleBank[folder];
    if (!Array.isArray(list) || !list.length) return false;
    let best = list[0];
    for (let i = 1; i < list.length; i++) {
      if (Math.abs(list[i].midi - soundMidi) < Math.abs(best.midi - soundMidi)) best = list[i];
    }
    const c = ac();
    if (time < c.currentTime) time = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = best.buffer;
    src.playbackRate.value = midiToFreq(soundMidi) / midiToFreq(best.midi);
    const g = c.createGain();
    const hold = Math.max(0.1, durSec * 0.94);
    const stopAt = time + hold + 0.08;
    if (isSlurred) {
      g.gain.setValueAtTime(0.35, time);
      g.gain.linearRampToValueAtTime(1.05, time + 0.015);
    } else {
      g.gain.setValueAtTime(0.001, time);
      g.gain.linearRampToValueAtTime(1.2, time + 0.025);
    }
    g.gain.setValueAtTime(1.0, time + hold);
    g.gain.exponentialRampToValueAtTime(0.001, stopAt);
    src.connect(g);
    g.connect(scoreOut());
    src.start(time);
    src.stop(stopAt + 0.02);
    trackNode(src);
    return true;
  }

  /* Authentic sampled B-trumpet: sounds 2 semitones below written pitch (Bb transposition). */
  function scheduleTrumpetNote(time, writtenMidi, durSec, isSlurred) {
    const sOff = global.Theory && global.Theory.soundOff ? global.Theory.soundOff("trumpet") : -2;
    const soundMidi = writtenMidi + sOff;

    if (playTrumpetSample(time, soundMidi, durSec, isSlurred)) {
      return;
    }

    const c = ac();
    if (time < c.currentTime) time = c.currentTime;
    const f0 = midiToFreq(soundMidi);
    const dest = scoreOut();
    const hold = Math.max(0.07, durSec * 0.92);
    const stopAt = time + hold + 0.07;

    /* Gentle lip/breath articulation transient ("tu") - omitted on slurred/legato notes */
    if (!isSlurred) {
      const breath = c.createBufferSource();
      breath.buffer = getClickBuf(c);
      const bp = c.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = Math.min(4500, f0 * 2.6);
      bp.Q.value = 1.8;
      const bg = c.createGain();
      bg.gain.setValueAtTime(0.04, time);
      bg.gain.exponentialRampToValueAtTime(0.001, time + 0.028);
      breath.connect(bp);
      bp.connect(bg);
      bg.connect(dest);
      breath.start(time);
      breath.stop(time + 0.035);
      trackNode(breath);
    }

    /* Brass low-pass filter with attack bloom */
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 2.0;
    const startCut = Math.min(2800, f0 * (isSlurred ? 2.5 : 1.8));
    const peakCut = Math.min(5200, f0 * 5.0);
    const sustainCut = Math.min(3800, f0 * 3.5);
    lp.frequency.setValueAtTime(startCut, time);
    lp.frequency.exponentialRampToValueAtTime(peakCut, time + (isSlurred ? 0.02 : 0.04));
    lp.frequency.exponentialRampToValueAtTime(sustainCut, time + Math.min(hold, 0.14));

    const env = c.createGain();
    if (isSlurred) {
      env.gain.setValueAtTime(0.12, time);
      env.gain.linearRampToValueAtTime(0.24, time + 0.015);
    } else {
      env.gain.setValueAtTime(0.0001, time);
      env.gain.linearRampToValueAtTime(0.28, time + 0.026);
    }
    env.gain.linearRampToValueAtTime(0.22, time + Math.min(hold, 0.09));
    env.gain.setValueAtTime(0.22, time + hold);
    env.gain.exponentialRampToValueAtTime(0.0001, stopAt);

    lp.connect(env);
    env.connect(dest);

    const voices = [
      { type: "sawtooth", detune: 1.0, gain: 0.55 },
      { type: "triangle", detune: 1.0, gain: 0.45 },
      { type: "sawtooth", detune: 1.0022, gain: 0.22 },
    ];
    voices.forEach((v) => {
      const o = c.createOscillator();
      const vg = c.createGain();
      o.type = v.type;
      o.frequency.setValueAtTime(f0 * v.detune, time);
      vg.gain.value = v.gain;
      o.connect(vg);
      vg.connect(lp);
      o.start(time);
      o.stop(stopAt + 0.01);
      trackNode(o);
    });
  }

  function scheduleNote(time, midi, durSec, instId, roll, isSlurred) {
    if (instId === "trumpet") {
      scheduleTrumpetNote(time, midi, durSec, isSlurred);
      return;
    }
    const c = ac();
    if (time < c.currentTime) time = c.currentTime;
    const spec = MALLET_VOICE[instId] || MALLET_VOICE.mar50;
    const f0 = midiToFreq(midi);
    const low = midi < 55;
    const decay = spec.decay * (low ? 1.45 : midi > 84 ? 0.7 : 1) * Math.max(0.55, Math.min(1.2, durSec / 0.4));
    const dest = scoreOut();

    scheduleStrike(time, midi, instId, 1);
    if (roll && durSec > 0.2) {
      const gap = 0.07;
      for (let t = time + gap; t < time + durSec - 0.03; t += gap) scheduleStrike(t, midi, instId, 0.55);
    }

    if (playSample(time, midi, instId)) {
      if (roll && durSec > 0.2) {
        const gap = 0.07;
        for (let t = time + gap; t < time + durSec - 0.03; t += gap) playSample(t, midi, instId);
      }
      return;
    }

    spec.ratios.forEach((ratio, i) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = "sine";
      o.frequency.value = f0 * ratio;
      const amp = 0.22 * spec.gains[i] / Math.sqrt(spec.ratios.length);
      const life = decay * (i === 0 ? 1 : 0.45 / ratio);
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(Math.max(0.001, amp), time + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, time + Math.max(0.08, life));
      o.connect(g);
      g.connect(dest);
      o.start(time);
      o.stop(time + life + 0.03);
      trackNode(o);
    });
  }

  function isTiedInto(prev, midi) {
    return !!(prev && prev.tie && !prev.rest && prev.pitches && prev.pitches.indexOf(midi) >= 0);
  }

  function heldTicks(items, idx, midi) {
    let ticks = items[idx].ev.dur && items[idx].ev.dur.ticks ? items[idx].ev.dur.ticks : quarterTicks();
    let i = idx;
    while (i < items.length - 1 && items[i].ev.tie) {
      const nxt = items[i + 1].ev;
      if (nxt.rest || !nxt.pitches || nxt.pitches.indexOf(midi) < 0) break;
      ticks += nxt.dur && nxt.dur.ticks ? nxt.dur.ticks : quarterTicks();
      i++;
    }
    return ticks;
  }

  function quarterTicks() {
    return (global.Theory && global.Theory.TICKS && global.Theory.TICKS.quarter) || 24;
  }

  function scoreMusicClicks(score, beats) {
    if (!score) return 0;
    const qTicks = quarterTicks();
    let tickPos = 0;
    if (score.isDuet) {
      let tptTick = 0;
      (score.trumpetMeasures || []).forEach((m) => {
        (m.events || []).forEach((ev) => {
          tptTick += ev.dur && ev.dur.ticks ? ev.dur.ticks : qTicks;
        });
      });
      let malletTick = 0;
      (score.malletMeasures || []).forEach((m) => {
        (m.events || []).forEach((ev) => {
          malletTick += ev.dur && ev.dur.ticks ? ev.dur.ticks : qTicks;
        });
      });
      tickPos = Math.max(tptTick, malletTick);
    } else if (score.measures) {
      score.measures.forEach((m) => {
        (m.events || []).forEach((ev) => {
          tickPos += ev.dur && ev.dur.ticks ? ev.dur.ticks : qTicks;
        });
      });
    }
    if (!tickPos) return 0;
    const safeBeats = Math.max(1, beats || 4);
    const barTicks = score.time && score.time.ticks ? score.time.ticks : safeBeats * qTicks;
    const clickTicks = barTicks / safeBeats;
    return Math.max(1, Math.round(tickPos / clickTicks));
  }

  let metroToken = 0;
  let metroEndTimer = null;
  let onMetroDone = null;

  function clearMetroEnd() {
    if (metroEndTimer) {
      clearTimeout(metroEndTimer);
      metroEndTimer = null;
    }
  }

  function startMetronome(bpm, beats, opts) {
    opts = opts || {};
    clearMetroEnd();
    const token = ++metroToken;
    tempo = bpm || 80;
    beatsPerBar = Math.max(1, beats || 4);
    subdiv = opts.subdiv === 2 ? 2 : opts.subdiv === 4 ? 4 : 1;
    onBeat = opts.onBeat || null;
    onMetroDone = opts.done || null;
    const countIn = Math.max(0, opts.countIn | 0);
    const countBeats = countIn * beatsPerBar;
    const musicClicks = Math.max(0, opts.musicClicks | 0);
    const totalClicks = musicClicks > 0 ? countBeats + musicClicks : 0;
    const steps = subdiv;
    const c = ac();
    const t0 = (c ? c.currentTime : 0) + 0.05;
    selfStop = true;
    Pulse.start({
      owner: "bladlesing",
      bpm: tempo,
      beats: beatsPerBar,
      sub: steps,
      at: t0,
      count: totalClicks > 0 ? totalClicks * steps : undefined,
      onClick: (click) => {
        if (!click.downbeat) return;
        const i = Math.floor(click.tick / steps);
        const inCount = i < countBeats;
        const cue = {
          phase: inCount ? "countin" : "play",
          beat: inCount ? i % beatsPerBar : i - countBeats,
          beats: beatsPerBar,
          musicBeats: musicClicks,
        };
        const cur = ac();
        const wait = cur && cur.state === "running" ? Math.max(0, Math.min(150, (click.time - cur.currentTime) * 1000)) : 0;
        if (totalClicks > 0 && i === totalClicks - 1) {
          clearMetroEnd();
          const tailMs = (60 / tempo + 0.08) * 1000;
          metroEndTimer = setTimeout(() => {
            if (token !== metroToken || !metroOn) return;
            metroToken++;
            metroOn = false;
            const cb = onMetroDone;
            onMetroDone = null;
            onBeat = null;
            selfStop = true;
            Pulse.stop("bladlesing");
            selfStop = false;
            if (cb) cb();
          }, wait + tailMs);
        }
        if (onBeat) {
          setTimeout(() => {
            if (token === metroToken && metroOn && onBeat) onBeat(cue.beat, beatsPerBar, true, cue);
          }, wait);
        }
      },
      onStop: () => {
        if (token !== metroToken) return;
        metroToken++;
        const was = metroOn;
        metroOn = false;
        clearMetroEnd();
        onMetroDone = null;
        onBeat = null;
        if (was && !selfStop && onHalt) onHalt();
      },
    });
    selfStop = false;
    metroOn = true;
    if (onBeat) onBeat(0, beatsPerBar, false, { phase: countBeats > 0 ? "countin" : "play", beat: 0, beats: beatsPerBar, musicBeats: musicClicks });
  }

  function stopMetronome() {
    metroToken++;
    clearMetroEnd();
    onMetroDone = null;
    selfStop = true;
    if (metroOn) Pulse.stop("bladlesing");
    selfStop = false;
    metroOn = false;
    onBeat = null;
  }

  function setTempo(bpm) {
    tempo = Math.max(30, Math.min(240, bpm || tempo));
    if (metroOn) Pulse.setBpm(tempo);
  }

  function setSubdiv(n) {
    subdiv = n === 2 || n === 4 ? n : 1;
    if (metroOn) Pulse.setMeter(beatsPerBar, subdiv);
  }

  let playEndTimer = null;

  function playAlong(score, opts) {
    stopPlayback();
    opts = opts || {};
    const token = playToken;
    playing = true;
    ac();
    const quarterBpm = Number(opts.quarterBpm) || tempo || 80;
    const clickBpm = Number(opts.clickBpm) || quarterBpm;
    const beats = Math.max(1, opts.beatsPerBar || 4);
    const countIn = Math.max(0, opts.countIn | 0);
    const onCue = opts.onCue || null;
    onPlayDone = opts.done || null;
    const instId = (score && score.settingsSnapshot && score.settingsSnapshot.instrument) || "mar50";
    const qTicks = quarterTicks();
    const qSec = 60 / quarterBpm;

    let kicked = false;
    const kick = () => {
      if (kicked || token !== playToken || !playing) return;
      kicked = true;
      const c = ac();
      if (!score || !score.measures) {
        playing = false;
        const cb = onPlayDone;
        onPlayDone = null;
        if (cb) cb();
        return;
      }
      const items = [];
      const tptItems = [];
      const malletItems = [];
      let tickPos = 0;

      if (score.isDuet) {
        let tptTick = 0;
        (score.trumpetMeasures || []).forEach((m) => {
          (m.events || []).forEach((ev) => {
            tptItems.push({ ev: ev, tick: tptTick });
            tptTick += ev.dur && ev.dur.ticks ? ev.dur.ticks : qTicks;
          });
        });

        let malletTick = 0;
        (score.malletMeasures || []).forEach((m) => {
          (m.events || []).forEach((ev) => {
            malletItems.push({ ev: ev, tick: malletTick });
            malletTick += ev.dur && ev.dur.ticks ? ev.dur.ticks : qTicks;
          });
        });

        tickPos = Math.max(tptTick, malletTick);
      } else {
        score.measures.forEach((m) => {
          (m.events || []).forEach((ev) => {
            items.push({ ev: ev, tick: tickPos });
            tickPos += ev.dur && ev.dur.ticks ? ev.dur.ticks : qTicks;
          });
        });
      }

      const barTicks = score.time && score.time.ticks ? score.time.ticks : beats * qTicks;
      const clickTicks = barTicks / beats;
      const beatSec = (clickTicks / qTicks) * qSec;
      const musicSec = (tickPos / qTicks) * qSec;
      const musicClicks = Math.max(1, Math.round(tickPos / clickTicks));
      const baseTime = c ? c.currentTime : 0;
      const t0 = baseTime + 0.07;
      const countBeats = countIn * beats;
      const musicAt = t0 + countBeats * beatSec;
      const steps = subdiv === 2 || subdiv === 4 ? subdiv : 1;
      const total = countBeats + musicClicks;
      Pulse.setClicks(true);
      Pulse.start({
        owner: "bladlesing",
        bpm: 60 / beatSec,
        beats: beats,
        sub: steps,
        at: t0,
        count: total * steps,
        onClick: (click) => {
          if (!click.downbeat || !onCue) return;
          const i = Math.floor(click.tick / steps);
          const inCount = i < countBeats;
          const cue = {
            phase: inCount ? "countin" : "play",
            beat: inCount ? i % beats : i - countBeats,
            beats: beats,
            musicBeats: musicClicks,
          };
          const wait = c && c.state === "running" ? Math.max(0, Math.min(150, (click.time - c.currentTime) * 1000)) : 0;
          setTimeout(() => {
            if (token === playToken && playing) onCue(cue);
          }, wait);
        },
        onStop: () => {
          if (token !== playToken) return;
          playToken++;
          playing = false;
          playOwned = false;
          onPlayDone = null;
          clearPlayEnd();
          if (onHalt) onHalt();
        },
      });
      playOwned = true;
      if (c && c.state === "running") {
        if (score.isDuet) {
          if (!opts.muteTrumpet) {
            tptItems.forEach((item, idx) => {
              const ev = item.ev;
              const when = musicAt + (item.tick / qTicks) * qSec;
              if (!ev.rest && ev.pitches && ev.pitches.length) {
                const prev = idx > 0 ? tptItems[idx - 1].ev : null;
                ev.pitches.forEach((p) => {
                  if (isTiedInto(prev, p)) return;
                  const dur = Math.max(0.05, (heldTicks(tptItems, idx, p) / qTicks) * qSec);
                  try { scheduleNote(when, p, dur, "trumpet", false, !!ev.slurred); } catch (err) {}
                });
              }
            });
          }
          if (!opts.muteMallets) {
            const mInst = score.malletInstrumentId || "xylo";
            malletItems.forEach((item, idx) => {
              const ev = item.ev;
              const when = musicAt + (item.tick / qTicks) * qSec;
              if (!ev.rest && ev.pitches && ev.pitches.length) {
                const prev = idx > 0 ? malletItems[idx - 1].ev : null;
                ev.pitches.forEach((p) => {
                  if (isTiedInto(prev, p)) return;
                  const dur = Math.max(0.05, (heldTicks(malletItems, idx, p) / qTicks) * qSec);
                  try { scheduleNote(when, p, dur, mInst, !!ev.roll, false); } catch (err) {}
                });
              }
            });
          }
        } else {
          items.forEach((item, idx) => {
            const ev = item.ev;
            const when = musicAt + (item.tick / qTicks) * qSec;
            if (!ev.rest && ev.pitches && ev.pitches.length) {
              const prev = idx > 0 ? items[idx - 1].ev : null;
              ev.pitches.forEach((p) => {
                if (isTiedInto(prev, p)) return;
                const dur = Math.max(0.05, (heldTicks(items, idx, p) / qTicks) * qSec);
                try { scheduleNote(when, p, dur, instId, !!ev.roll, !!ev.slurred); } catch (err) { /* best effort */ }
              });
            }
          });
        }
      }
      const totalDurationMs = Math.max(0, (0.07 + countBeats * beatSec + musicSec + 0.08) * 1000);
      playEndTimer = setTimeout(() => {
        if (token !== playToken) return;
        playToken++;
        playing = false;
        playOwned = false;
        const cb = onPlayDone;
        onPlayDone = null;
        Pulse.stop("bladlesing");
        if (cb) cb();
      }, totalDurationMs);
    };

    const timeout = setTimeout(kick, 800);
    const loadPromise = score && score.isDuet
      ? Promise.all([
          loadInstrument("trumpet"),
          loadInstrument(score.malletInstrumentId || (score.settingsSnapshot && score.settingsSnapshot.duetMalletInstrument) || "xylo"),
        ])
      : loadInstrument(instId);

    loadPromise
      .then(() => {
        clearTimeout(timeout);
        kick();
      })
      .catch(() => {
        clearTimeout(timeout);
        kick();
      });
  }

  function setClicks(on) {
    Pulse.setClicks(!!on);
  }

  function clearPlayEnd() {
    if (playEndTimer) {
      clearTimeout(playEndTimer);
      playEndTimer = null;
    }
  }

  function playScore(score, bpm, done) {
    playAlong(score, { quarterBpm: bpm, clickBpm: bpm, beatsPerBar: 4, countIn: 0, done: done });
  }

  function stopPlayback() {
    playToken++;
    playing = false;
    clearPlayEnd();
    onPlayDone = null;
    if (playOwned) Pulse.stop("bladlesing");
    playOwned = false;
    cutScoreAudio();
  }

  function isPlaying() {
    return playing;
  }
  function isMetro() {
    return metroOn;
  }

  global.AudioEngine = {
    loadInstrument,
    scoreMusicClicks,
    startMetronome,
    stopMetronome,
    setTempo,
    setSubdiv,
    playScore,
    playAlong,
    setClicks,
    stopPlayback,
    isPlaying,
    isMetro,
    onHalt: (fn) => { onHalt = fn || null; },
    ac,
  };
})(window);
