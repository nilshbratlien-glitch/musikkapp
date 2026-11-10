// End-to-end checks for the shared metronome core, the plan clock and block navigation.
// Runs against `vite preview` of a fresh build (`npm run test:e2e`), or E2E_URL if set.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { after, before, beforeEach, describe, it } from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, devices, webkit } from "playwright";
import { asSafari15, contrastInPage } from "./safari15.mjs";

const BASE = process.env.E2E_URL || "http://127.0.0.1:8081";
// Optional: save review screenshots here (not used in CI).
const SHOTS = process.env.E2E_SHOTS || "";
// E2E_BROWSER=webkit runs the suite in Playwright WebKit (a current engine, not Safari 15.6).
const ENGINE = process.env.E2E_BROWSER === "webkit" ? webkit : chromium;
let server = null;
let browser;
let page;

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(BASE)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`preview did not start at ${BASE}`);
}

// Counts AudioContexts, oscillator starts and live intervals so the tests can see
// overlapping sound sources and double countdowns.
function instrument() {
  const probe = { contexts: [], starts: [], intervals: new Map() };
  window.__probe = probe;
  const Original = window.AudioContext;
  window.AudioContext = class extends Original {
    constructor(...args) {
      super(...args);
      probe.contexts.push(this);
    }
  };
  const start = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function (when) {
    probe.starts.push({ wall: performance.now(), when: when || this.context.currentTime, ctx: probe.contexts.indexOf(this.context) });
    return start.call(this, when);
  };
  const setI = window.setInterval.bind(window);
  const clearI = window.clearInterval.bind(window);
  window.setInterval = (fn, ms, ...rest) => {
    const id = setI(fn, ms, ...rest);
    probe.intervals.set(id, ms);
    return id;
  };
  window.clearInterval = (id) => {
    probe.intervals.delete(id);
    return clearI(id);
  };
}

function plan(on, extra = {}) {
  const ids = ["twomallet", "fourmallet", "srf", "rep"];
  return {
    items: ids.map((id) => ({ id, on: on.includes(id), mins: 5, skipped: false })),
    done: [],
    log: [],
    presets: [],
    sessionDate: "",
    bpmMap: { twomallet: 100, fourmallet: 72 },
    bpm: 80,
    beats: 3,
    sub: 1,
    ...extra,
  };
}

async function open(path, store) {
  await page.goto(BASE + path);
  await page.evaluate((value) => {
    localStorage.clear();
    if (value) localStorage.setItem("musikkapp.oveplan", JSON.stringify(value));
  }, store ?? null);
  await page.goto(BASE + path);
  await page.waitForSelector("nav a");
  await page.waitForTimeout(400);
  await page.evaluate(() => (window.__mark = "same-document"));
}

async function tab(path) {
  await page.click(`nav a[href="${path}"]`);
  await page.waitForFunction((p) => location.pathname === p, path);
  await page.waitForTimeout(150);
}

async function noReload() {
  assert.equal(await page.evaluate(() => window.__mark), "same-document", "the page reloaded");
}

const header = () => page.locator("header button").filter({ hasText: /\d+:\d\d/ });

async function headerSeconds() {
  const text = await header().innerText();
  const [m, s] = text.match(/(\d+):(\d\d)/).slice(1).map(Number);
  return m * 60 + s;
}

// Audio-time click onsets scheduled during the last `ms` of wall time, deduplicated.
async function recentClicks(ms) {
  await page.waitForTimeout(ms);
  return page.evaluate((window_) => {
    const now = performance.now();
    const times = window.__probe.starts.filter((s) => now - s.wall <= window_).map((s) => s.when).sort((a, b) => a - b);
    return times.filter((t, i) => i === 0 || t - times[i - 1] > 0.002);
  }, ms);
}

function minGap(times) {
  let gap = Infinity;
  for (let i = 1; i < times.length; i++) gap = Math.min(gap, times[i] - times[i - 1]);
  return gap;
}

async function liveContexts() {
  return page.evaluate(() => window.__probe.contexts.filter((c) => c.state !== "closed").length);
}

async function shot(name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

const pulseState = () => page.evaluate(() => window.MusikkPulse?.getState() ?? null);

async function pressed(name) {
  return page.getByRole("button", { name, exact: true }).getAttribute("aria-pressed");
}

/** Every pulse owner seen since the call, in order. */
async function traceOwners() {
  await page.evaluate(() => {
    window.__owners = [];
    window.MusikkPulse.subscribe(() => {
      const owner = window.MusikkPulse.getState().owner;
      if (window.__owners.at(-1) !== owner) window.__owners.push(owner);
    });
  });
}

async function countdownIntervals() {
  return page.evaluate(() => [...window.__probe.intervals.values()].filter((ms) => ms === 200).length);
}

before(async () => {
  if (!process.env.E2E_URL) {
    server = spawn("node", ["scripts/with-app-env.mjs", "vite", "preview"], { stdio: "ignore", detached: true });
  }
  await waitForServer();
  browser = await ENGINE.launch(
    ENGINE === chromium ? { args: ["--autoplay-policy=no-user-gesture-required", "--disable-audio-output"] } : {},
  );
});

after(async () => {
  await browser?.close();
  if (server) process.kill(-server.pid);
});

beforeEach(async () => {
  await page?.context().close();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(instrument);
  page = await context.newPage();
});

describe("block navigation", () => {
  it("2-mallet and 4-mallet open Metronom with the plan timer in the header", async () => {
    await open("/oveplan", plan(["twomallet", "fourmallet"]));
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.waitForFunction(() => location.pathname === "/metronom");
    assert.match(await header().innerText(), /2-mallet/);
    assert.match(await page.locator("main").innerText(), /\b100\b/, "Metronom shows the block BPM");
    const clicks = await recentClicks(2200);
    assert.ok(clicks.length >= 2, "the block metronome plays");
    assert.ok(Math.abs(minGap(clicks) - 0.6) < 0.02, `one 100 BPM stream, got gap ${minGap(clicks)}`);

    await tab("/oveplan");
    await page.getByRole("button", { name: "Ferdig", exact: true }).click();
    await page.waitForFunction(() => location.pathname === "/metronom");
    assert.match(await header().innerText(), /4-mallet/);
    await header().click();
    const next = await recentClicks(2500);
    assert.ok(Math.abs(minGap(next) - 60 / 72) < 0.02, `one 72 BPM stream, got gap ${minGap(next)}`);
    await noReload();
  });

  it("SRF opens Bladlesing with the plan timer in the header", async () => {
    await open("/oveplan", plan(["srf"]));
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.waitForFunction(() => location.pathname === "/");
    assert.match(await header().innerText(), /Bladlesing/);
    assert.equal((await recentClicks(800)).length, 0, "SRF does not start a metronome");
    await noReload();
  });

  it("Repertoar keeps today's behaviour: no navigation, no metronome", async () => {
    await open("/oveplan", plan(["rep"]));
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.waitForTimeout(500);
    assert.equal(new URL(page.url()).pathname, "/oveplan");
    assert.match(await header().innerText(), /Repertoar/);
    assert.equal((await recentClicks(800)).length, 0);
  });

  it("switching block while the timer runs stops the old sound and keeps one countdown", async () => {
    await open("/oveplan", plan(["twomallet", "srf"]));
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.waitForFunction(() => location.pathname === "/metronom");
    assert.ok((await recentClicks(1000)).length >= 1);
    await tab("/oveplan");
    await page.locator(".plan-hero").getByRole("button", { name: /Bladlesing/ }).click();
    await page.waitForFunction(() => location.pathname === "/");
    await page.waitForTimeout(300);
    assert.equal((await recentClicks(1200)).length, 0, "2-mallet metronome stopped");
    assert.ok((await liveContexts()) <= 1, "one audio context");
    assert.equal(await countdownIntervals(), 1, "one countdown interval");
    const first = await headerSeconds();
    await page.waitForTimeout(3000);
    const drop = first - (await headerSeconds());
    assert.ok(drop >= 2 && drop <= 4, `countdown fell ${drop}s in 3s`);
    await noReload();
  });
});

describe("plan clock sync", () => {
  it("start, pause and stop show in the header and the other tabs, without drift", async () => {
    await open("/oveplan", plan(["rep"]));
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await header().waitFor();
    const first = await headerSeconds();
    const began = Date.now();
    for (const path of ["/metronom", "/", "/notekort", "/oveplan", "/metronom"]) await tab(path);
    await page.waitForTimeout(Math.max(0, 4000 - (Date.now() - began)));
    const drop = first - (await headerSeconds());
    const elapsed = Math.round((Date.now() - began) / 1000);
    assert.ok(Math.abs(drop - elapsed) <= 1, `countdown fell ${drop}s in ${elapsed}s`);
    assert.equal(await countdownIntervals(), 1, "one countdown interval after tab switches");

    await header().click();
    const paused = await headerSeconds();
    await page.waitForTimeout(1500);
    assert.equal(await headerSeconds(), paused, "paused in the header");
    await tab("/oveplan");
    await page.getByRole("button", { name: "Fortsett", exact: true }).waitFor();
    await page.getByRole("button", { name: "Fortsett", exact: true }).click();
    await tab("/notekort");
    await page.waitForTimeout(1500);
    assert.ok((await headerSeconds()) < paused, "resumed from Øveplan, running in Notekort header");

    await tab("/oveplan");
    await page.getByRole("button", { name: "Liste", exact: true }).click();
    await page.getByRole("button", { name: "Nullstill", exact: true }).click();
    for (const path of ["/metronom", "/"]) {
      await tab(path);
      assert.equal(await header().count(), 0, `stopped in ${path}`);
    }
    await noReload();
  });
});

describe("one sound source", () => {
  it("Metronom, snare and Bladlesing never overlap", async () => {
    await open("/metronom");
    await page.getByRole("button", { name: "Start", exact: true }).click();
    assert.ok((await recentClicks(1000)).length >= 1);
    await page.getByRole("button", { name: "Rudiment", exact: true }).click();
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.waitForTimeout(200);
    assert.equal(await liveContexts(), 1, "Metronom and snare share one AudioContext");
    await tab("/");
    await page.waitForSelector("#score svg");
    await page.locator("#btnMetro").click();
    const clicks = await recentClicks(2500);
    assert.ok(clicks.length >= 2, "Bladlesing metronome plays");
    assert.ok(minGap(clicks) > 0.2, `one stream only, got gap ${minGap(clicks)}`);
    await page.locator("#btnPlay").click();
    await page.waitForTimeout(1500);
    assert.equal(await page.evaluate(() => window.MusikkPulse?.getState().owner), "bladlesing", "play-along runs on the core");
    assert.equal(await liveContexts(), 1, "play-along uses the shared AudioContext");
    await tab("/metronom");
    assert.equal((await recentClicks(1000)).length, 0, "leaving Bladlesing stops its playback");
    await page.getByRole("button", { name: "Metronom", exact: true }).click();
    await page.getByRole("button", { name: "Start", exact: true }).click();
    assert.ok(minGap(await recentClicks(2000)) > 0.5);
    assert.equal(await liveContexts(), 1, "one AudioContext for all tools");
    await noReload();
  });
});

describe("Bladlesing buttons follow the shared pulse", () => {
  const owner = () => page.evaluate(() => window.MusikkPulse?.getState().owner ?? null);
  const metroOn = () => page.locator("#btnMetro").evaluate((el) => el.classList.contains("on"));

  it("Metronom tab and back: the metronome button is off", async () => {
    await open("/");
    await page.waitForSelector("#score svg");
    await page.locator("#btnMetro").click();
    assert.equal(await metroOn(), true);
    await tab("/metronom");
    await page.getByRole("button", { name: "Start", exact: true }).click();
    assert.equal(await owner(), "metronom");
    await tab("/");
    await page.waitForSelector("#score svg");
    assert.equal(await metroOn(), false, "#btnMetro is not active after returning");
    assert.equal(await owner(), null);
  });

  it("a plan block taking the pulse turns metronome and play-along off", async () => {
    await open("/oveplan", plan(["twomallet"]));
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.waitForFunction(() => location.pathname === "/metronom");
    await header().click();
    await tab("/");
    await page.waitForSelector("#score svg");

    await page.locator("#btnMetro").click();
    assert.equal(await owner(), "bladlesing");
    await header().click();
    await page.waitForFunction(() => window.MusikkPulse?.getState().owner === "oveplan");
    assert.equal(new URL(page.url()).pathname, "/");
    assert.equal(await metroOn(), false, "#btnMetro is off once the plan owns the pulse");
    assert.equal(await page.locator("#btnMetro.yielded").count(), 1, "#btnMetro shows it gave way");
    assert.equal(await page.locator("#btnPlay.yielded").count(), 1, "Play shows it gave way");
    assert.equal(await page.locator("#pulseNote").innerText(), "Øveplan styrer metronomen");
    assert.ok(await page.locator("#pulseNote").isVisible(), "the status line is visible");

    await header().click();
    await page.locator("#btnPlay").click();
    await page.waitForFunction(() => window.MusikkPulse?.getState().owner === "bladlesing");
    await header().click();
    await page.waitForFunction(() => window.MusikkPulse?.getState().owner === "oveplan");
    await page.waitForTimeout(200);
    assert.equal(await page.locator("#btnPlay").innerText(), "Spill", "play-along shows as stopped");
    assert.equal(await page.locator("#btnPlay").evaluate((el) => el.classList.contains("on")), false);
    assert.equal(await metroOn(), false);
    assert.equal(await liveContexts(), 1);

    await page.locator("#btnMetro").click();
    assert.equal(await owner(), "bladlesing");
    assert.equal(await page.locator(".yielded").count(), 0, "taking the pulse back clears .yielded");
    assert.equal(await page.locator("#pulseNote").isVisible(), false);
    await noReload();
  });
});

describe("Bladlesing during a SRF block", () => {
  it("Play resumes the paused block; Stopp and leaving the tab never pause it", async () => {
    await open("/oveplan", plan(["srf"]));
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.waitForFunction(() => location.pathname === "/");
    await page.waitForSelector("#score svg");
    await header().click();
    const paused = await headerSeconds();
    await page.waitForTimeout(1200);
    assert.equal(await headerSeconds(), paused, "paused from the header");

    await page.locator("#btnPlay").click();
    await page.waitForTimeout(1500);
    assert.equal(await header().getAttribute("aria-pressed"), "false", "Play resumed the SRF block");
    const resumed = await headerSeconds();
    assert.ok(resumed < paused && resumed >= paused - 2, `same time left, then counting: ${paused} -> ${resumed}`);

    await page.locator("#btnPlay").click();
    await page.waitForTimeout(1200);
    assert.ok((await headerSeconds()) < resumed, "Stopp in Bladlesing keeps the plan running");
    await tab("/metronom");
    await tab("/");
    await page.waitForTimeout(1200);
    assert.equal(await header().getAttribute("aria-pressed"), "false", "leaving the tab keeps it running");
    await noReload();
  });
});

describe("Metronom during a 2-mallet block", () => {
  it("Stopp pauses the block, Start resumes it at the block's tempo, and the chips show the block's meter", async () => {
    await open("/oveplan", plan(["twomallet"]));
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.waitForFunction(() => location.pathname === "/metronom");
    await page.locator(".plan-chip").waitFor();
    await traceOwners();
    const main = page.locator("main");
    assert.match(await main.innerText(), /Øveplan · 3 slag/);
    assert.equal(await pressed("3/4"), "true", "the 3-beat chip is selected");
    assert.equal(await pressed("4/4"), "false", "never 3 slag and 4/4 at once");
    assert.equal(await page.locator('main [aria-pressed="true"]').count(), 2, "one meter and one subdivision chip");
    assert.equal(await pressed("Slag"), "true");
    assert.match(await header().getAttribute("aria-label"), /^Pause 2-mallet, \d+:\d\d igjen$/);
    assert.equal(await header().getAttribute("aria-pressed"), "false");

    await page.getByRole("button", { name: "Stopp", exact: true }).click();
    const paused = await headerSeconds();
    assert.equal((await pulseState()).owner, null);
    await page.waitForTimeout(1500);
    assert.equal(await headerSeconds(), paused, "Stopp paused the plan timer");
    assert.equal(await header().getAttribute("aria-pressed"), "true");
    assert.match(await header().getAttribute("aria-label"), /^Fortsett 2-mallet, \d+:\d\d igjen$/, "paused, the label offers Fortsett");
    assert.equal((await recentClicks(800)).length, 0, "and the clicks");
    assert.match(await main.innerText(), /\b100\b/, "paused, Metronom still shows the block BPM");
    assert.equal(await pressed("3/4"), "true", "and the block meter");
    await shot("metronom-paused-block");

    await page.getByRole("button", { name: "Start", exact: true }).click();
    const state = await pulseState();
    assert.equal(state.owner, "oveplan", "Start resumes the block instead of taking the pulse");
    assert.equal(state.bpm, 100, "at the block BPM, not 80");
    const clicks = await recentClicks(2200);
    assert.ok(Math.abs(minGap(clicks) - 0.6) < 0.02, `one 100 BPM stream, got gap ${minGap(clicks)}`);
    assert.ok((await headerSeconds()) < paused, "the plan timer runs again");
    assert.match(await header().getAttribute("aria-label"), /^Pause 2-mallet, /, "running, the label offers Pause again");
    assert.deepEqual(await page.evaluate(() => window.__owners), [null, "oveplan"], "Metronom never owned the pulse");

    await page.getByRole("button", { name: "4/4", exact: true }).click();
    assert.equal((await pulseState()).beats, 4);
    assert.match(await main.innerText(), /Øveplan · 4 slag/);
    assert.equal(await pressed("4/4"), "true");
    assert.equal(await pressed("3/4"), "false");
    await shot("metronom-block-running");
    await noReload();
  });
});

const overflowOf = () =>
  page.evaluate(() => [document.documentElement, document.querySelector("main")].map((el) => el.scrollWidth - el.clientWidth));

describe("layout", () => {
  for (const [width, height] of [
    [768, 1024],
    [1024, 768],
    [375, 812],
  ]) {
    it(`no horizontal overflow at ${width}x${height}`, async () => {
      await page.setViewportSize({ width, height });
      await open("/");
      for (const path of ["/", "/metronom", "/oveplan", "/notekort"]) {
        await tab(path);
        await page.waitForTimeout(path === "/" ? 800 : 200);
        const overflow = await page.evaluate(() =>
          [document.documentElement, document.querySelector("main")].map((el) => el.scrollWidth - el.clientWidth),
        );
        assert.deepEqual(overflow, [0, 0], `${path} overflows`);
      }

      await tab("/");
      await page.waitForSelector("#score svg");
      const lines = await page.locator("#btnGenerate").evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
      });
      assert.equal(lines, 1, "«Ny etyde» stays on one line");
      await page.locator("#btnSettings").click();
      for (const panel of ["instrument", "rytme", "register", "toneart", "mer"]) {
        await page.locator(`[data-settings="${panel}"]`).click();
        const drawer = await page.locator("#drawer").evaluate((el) => {
          const box = el.getBoundingClientRect();
          const wide = [...el.querySelectorAll("*")].filter((c) => {
            const r = c.getBoundingClientRect();
            return r.width > 0 && (r.right > box.right + 0.5 || r.left < box.left - 0.5);
          });
          return { scroll: el.scrollWidth - el.clientWidth, wide: wide.map((c) => c.id || c.className || c.tagName) };
        });
        assert.deepEqual(drawer, { scroll: 0, wide: [] }, `the ${panel} panel overflows`);
        assert.deepEqual(await overflowOf(), [0, 0], `Bladlesing with the ${panel} panel open overflows`);
        await shot(`bladlesing-drawer-${panel}-${width}x${height}`);
        await page.locator(`[data-settings-panel="${panel}"] [data-settings-back]`).click();
      }
      await page.locator("#btnCloseSettings").click();

      await open("/oveplan", plan(["twomallet"]));
      await page.getByRole("button", { name: "Start", exact: true }).click();
      await page.waitForFunction(() => location.pathname === "/metronom");
      await page.locator(".plan-chip").waitFor();
      assert.deepEqual(await overflowOf(), [0, 0], "/metronom with the plan chip overflows");
      await shot(`metronom-chip-${width}x${height}`);
      await header().click();
      await tab("/");
      await page.waitForSelector("#score svg");
      const scoreTop = () => page.locator("#score").evaluate((el) => el.getBoundingClientRect().top);
      const before = await scoreTop();
      await header().click();
      await page.locator("#pulseNote").waitFor({ state: "visible" });
      assert.equal(await scoreTop(), before, "the status line does not push the score down");
      const note = await page.locator("#pulseNote").evaluate((el) => {
        const r = el.getBoundingClientRect();
        const next = document.querySelector("#practiceLine").getBoundingClientRect();
        const score = document.querySelector("#score").getBoundingClientRect();
        return {
          size: parseFloat(getComputedStyle(el).fontSize),
          clipped: el.scrollWidth > el.clientWidth,
          clear: r.bottom <= (next.height ? next.top : score.top) + 0.5,
        };
      });
      assert.ok(note.size >= 13, `the status line is at least 13px, got ${note.size}`);
      assert.equal(note.clipped, false, "the status line fits on one line");
      assert.equal(note.clear, true, "the status line does not overlap the meta line or the score");
      assert.equal(
        await page.locator("#pulseNote").evaluate((el) => getComputedStyle(el).color),
        "rgb(126, 224, 214)",
        "the status line uses the 2-mallet colour",
      );
      assert.deepEqual(await overflowOf(), [0, 0], "Bladlesing with the status line overflows");
      await shot(`bladlesing-yielded-${width}x${height}`);
    });
  }
});

/** English words that used to be labels in Bladlesing; none may be left in the drawer, the meta line or the title. */
const ENGLISH =
  /\b(keyboard|mallets?|texture|chords?|double|stops?|second|below|above|either|staff|treble|grand|all|long|simple|dotted|triplets?|short|whole|half|quarter|eighth|sixteenth|16th|32nd|allow|rests?|density|syncopation|ties|low|high|max|leap|keys?|majors?|minors?|accidentals|tonic|meter|measures|accents|dynamics|rolls|off|often|names|show|voicing|closed|open|notes?|generate|settings|level|custom|random|melody|single|only|fixed|next|sounds|the|and|with|glockenspiel|xylophone|vibraphone|octave|[2-9](nd|rd|th))\b/i;

async function bladlesingTexts() {
  return page.evaluate(() => {
    const score = document.querySelector("#score svg");
    return {
      drawer: document.querySelector("#drawer").textContent.replace(/\s+/g, " "),
      meta: document.querySelector("#practiceLine").textContent,
      title: score ? score.querySelector("text")?.textContent ?? "" : "",
    };
  });
}

describe("Bladlesing in Norwegian", () => {
  it("the drawer, the meta line and the sheet title have no English labels left, with 2, 3 and 4 mallets", async () => {
    await open("/");
    await page.waitForSelector("#score svg");
    for (const mallets of ["2", "3", "4"]) {
      await page.locator("#btnSettings").click();
      await page.locator('[data-settings="instrument"]').click();
      await page.locator("#mallets").selectOption(mallets);
      await page.locator("#btnApply").click();
      await page.waitForFunction(
        (n) => document.querySelector("#score svg text")?.textContent.includes(` ${n} `),
        mallets,
      );
      const texts = await bladlesingTexts();
      for (const [where, text] of Object.entries(texts)) {
        assert.doesNotMatch(text, ENGLISH, `${where} with ${mallets} mallets: ${text.match(ENGLISH)?.[0]} in «${text.slice(0, 200)}»`);
      }
      const key = texts.meta.match(/^Egendefinert · ([A-Ha-h](?:is|es|s)?-(?:dur|moll)) · 4\/4 · Marimba 5\.0$/)?.[1];
      assert.ok(key, `Norwegian meta line, got «${texts.meta}»`);
      assert.equal(texts.title, `Marimba 5.0 · ${mallets} køller · ${key}`);
    }
  });

  it("settings saved by the old English version still load, with the same ids and values", async () => {
    await open("/");
    const old = {
      instrumentId: "xylo",
      mallets: 2,
      texture: "melody",
      clef: "treble",
      keyId: "Bb",
      keyIds: ["Bb"],
      timeId: "3/4",
      measures: 4,
      rhythms: ["q", "8", "q."],
      rolls: "long",
      annotate: "names",
    };
    await page.evaluate((value) => {
      localStorage.removeItem("musikkapp.bladlesing");
      localStorage.setItem("mallet-sr-settings-v3", JSON.stringify(value));
    }, old);
    await page.reload();
    await page.waitForSelector("#score svg");
    const selected = (id) =>
      page.locator(id).evaluate((el) => ({ value: el.value, text: el.selectedOptions[0]?.textContent }));
    assert.deepEqual(await selected("#instrument"), { value: "xylo", text: "Xylofon" });
    assert.deepEqual(await selected("#texture"), { value: "melody", text: "Bare én linje" });
    assert.deepEqual(await selected("#clef"), { value: "treble", text: "G-nøkkel" });
    assert.deepEqual(await selected("#time"), { value: "3/4", text: "3/4" });
    assert.deepEqual(await selected("#rolls"), { value: "long", text: "Lange toner" });
    assert.deepEqual(await selected("#annotate"), { value: "names", text: "Tonenavn" });
    assert.equal(await page.locator("#measures").inputValue(), "4");
    const { meta, title } = await bladlesingTexts();
    assert.equal(meta, "Egendefinert · B-dur · 3/4 · Xylofon");
    assert.match(title, /^Xylofon · klinger 8va · 2 køller · B-dur$/);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("musikkapp.bladlesing")));
    for (const key of Object.keys(old)) assert.deepEqual(saved[key], old[key], `saved ${key} keeps its old value`);
  });
});

/** Serve every stylesheet as Safari 15.6 would read it (no color-mix, no @property). */
async function simulateSafari15() {
  await page.route(/\.css(\?|$)/, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: asSafari15(await response.text()) });
  });
}

const tintOf = (locator) =>
  locator.evaluate((el) => {
    const s = getComputedStyle(el);
    return { color: s.color, background: s.backgroundColor, border: s.borderTopColor };
  });

describe("Safari 15.6 readability", () => {
  for (const simulated of [false, true]) {
    for (const block of ["twomallet", "fourmallet"]) {
      it(`the header pill and the Metronom chip are readable in a ${block} block${simulated ? " without color-mix() and @property" : ""}`, async () => {
        if (simulated) await simulateSafari15();
        await open("/oveplan", plan([block]));
        await page.getByRole("button", { name: "Start", exact: true }).click();
        await page.waitForFunction(() => location.pathname === "/metronom");
        const chip = page.locator(".plan-chip");
        await chip.waitFor();
        const pill = header();
        const contrast = { pill: await pill.evaluate(contrastInPage), chip: await chip.evaluate(contrastInPage) };
        const tints = { pill: await tintOf(pill), chip: await tintOf(chip), contrast };
        if (SHOTS) {
          mkdirSync(SHOTS, { recursive: true });
          const suffix = `${block}${simulated ? "-safari15" : ""}-${process.env.E2E_BROWSER || "chromium"}`;
          writeFileSync(join(SHOTS, `tint-${suffix}.json`), JSON.stringify(tints, null, 2) + "\n");
          const box = await page.locator("header").boundingBox();
          const chipBox = await chip.boundingBox();
          await page.screenshot({ path: join(SHOTS, `pill-${suffix}.png`), clip: box });
          await page.screenshot({
            path: join(SHOTS, `chip-${suffix}.png`),
            clip: { x: chipBox.x - 24, y: chipBox.y - 90, width: chipBox.width + 48, height: chipBox.height + 110 },
          });
        }
        for (const [name, c] of Object.entries(contrast)) {
          assert.ok(c.ratio >= 3, `${name}: text ${c.text} on ${c.back}, contrast ${c.ratio.toFixed(2)}:1`);
        }
      });
    }
  }
});

// The Bladlesing settings use music-theory wording; ids and saved values stay as they were.
describe("Bladlesing settings wording", () => {
  const OLD_WORDS = /Klaviatur|Tekstur|Dobbeltgrep|Bare blokker med tre toner|Diskant|\bBass\b|Dobbelt system|Overbinding|Forsetningstegn/i;

  async function openDrawer() {
    await page.waitForSelector("#score svg");
    await page.locator("#btnSettings").click();
  }

  async function panelText(panel) {
    await page.locator(`[data-settings="${panel}"]`).click();
    const text = await page.locator(`[data-settings-panel="${panel}"]`).evaluate((el) => el.textContent.replace(/\s+/g, " "));
    await page.locator(`[data-settings-panel="${panel}"] [data-settings-back]`).click();
    return text;
  }

  // Nothing sticks out of the drawer, no label is cut off, and no select is too narrow for its longest option.
  async function crampedElements(shotPrefix) {
    const out = [];
    for (const panel of ["instrument", "rytme", "register", "toneart", "mer"]) {
      await page.locator(`[data-settings="${panel}"]`).click();
      await shot(`${shotPrefix}-${panel}`);
      out.push(
        ...(await page.locator(`[data-settings-panel="${panel}"]`).evaluate((root, name) => {
          const box = document.querySelector("#drawer").getBoundingClientRect();
          const bad = [];
          const canvas = document.createElement("canvas").getContext("2d");
          for (const el of root.querySelectorAll("*")) {
            const r = el.getBoundingClientRect();
            if (!r.width) continue;
            if (r.right > box.right + 0.5 || r.left < box.left - 0.5) bad.push(`${name}: ${el.tagName} sticks out`);
            if (el.tagName !== "SELECT" && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).display !== "inline")
              bad.push(`${name}: ${el.tagName} «${el.textContent.trim().slice(0, 30)}» clipped`);
            if (el.tagName === "SELECT") {
              const s = getComputedStyle(el);
              canvas.font = `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
              const widest = Math.max(...[...el.options].map((o) => canvas.measureText(o.textContent).width));
              const room = r.width - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight) - 24;
              if (widest > room) bad.push(`${name}: select #${el.id} too narrow for its longest option`);
            }
          }
          return bad;
        }, panel)),
      );
      await page.locator(`[data-settings-panel="${panel}"] [data-settings-back]`).click();
    }
    const line = await page.locator("#practiceLine").evaluate((el) => el.scrollWidth - el.clientWidth);
    if (line > 0) out.push("practiceLine clipped");
    const page_ = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (page_ > 0) out.push("page overflows");
    return out;
  }

  it("the new labels show, the old words are gone, and ids and values are unchanged", async () => {
    await open("/");
    await openDrawer();
    const text = {};
    for (const panel of ["instrument", "rytme", "register", "toneart", "mer"]) text[panel] = await panelText(panel);
    assert.match(text.instrument, /Instrument Instrument/);
    assert.match(text.instrument, /Notebilde/);
    assert.match(text.rytme, /Bindebuer/);
    assert.match(text.toneart, /Løse fortegn/);
    const a11y = await page.evaluate(() => {
      const name = (el) => el.getAttribute("aria-labelledby").split(" ").map((id) => document.getElementById(id).textContent.trim()).join(" ");
      const groups = [document.querySelector("#keysMajorChips"), document.querySelector("#keysMinorChips"), document.querySelector("#keysAll").parentElement];
      return {
        slider: name(document.querySelector("#chordChance")),
        sliderLabelFor: document.querySelector("#chordChanceTitle").closest("label").htmlFor,
        groups: groups.map((el) => [el.getAttribute("role"), name(el)]),
      };
    });
    assert.deepEqual(a11y, {
      slider: "Akkorder i linjen",
      sliderLabelFor: "chordChance",
      groups: [["group", "Tonearter Dur"], ["group", "Tonearter Moll"], ["group", "Tonearter"]],
    });
    for (const [panel, value] of Object.entries(text)) assert.doesNotMatch(value, OLD_WORDS, `${panel}: ${value.match(OLD_WORDS)?.[0]}`);
    const clef = await page.locator("#clef").evaluate((el) => [...el.options].map((o) => [o.value, o.textContent]));
    assert.deepEqual(clef, [["auto", "Auto"], ["treble", "G-nøkkel"], ["bass", "F-nøkkel"], ["grand", "Pianosystem"]]);
    const textures = {};
    for (const mallets of ["2", "3", "4"]) {
      await page.locator('[data-settings="instrument"]').click();
      await page.locator("#mallets").selectOption(mallets);
      textures[mallets] = await page.locator("#texture").evaluate((el) => [...el.options].map((o) => [o.value, o.textContent]));
      await page.locator('[data-settings-panel="instrument"] [data-settings-back]').click();
    }
    assert.deepEqual(textures["2"], [["mixed", "Melodi med akkorder"], ["melody", "Bare én linje"], ["doublestops", "Mest akkorder"]]);
    assert.deepEqual(textures["3"], [["mixed", "Melodi med akkorder"], ["melody", "Bare én linje"], ["block", "Bare treklanger"]]);
    assert.deepEqual(textures["4"].map((o) => o[0]), ["mixed", "melody", "block", "chorale"]);
    await page.locator("#btnCloseSettings").click();
    await page.locator("#btnSettings").click();
    await page.locator('[data-settings="mer"]').click();
    for (const [level, word] of [[5, "bindebuer"], [7, "fortegn"]]) {
      await page.locator(`[data-level="${level}"]`).evaluate((el) => el.click());
      assert.match(await page.locator("#levelHint").textContent(), new RegExp(word), `level ${level} hint`);
    }
  });

  it("a setting saved with the old values still loads and shows the new wording", async () => {
    await open("/");
    const old = { instrumentId: "mar50", mallets: 3, texture: "block", clef: "bass", keyId: "C", keyIds: ["C"], timeId: "4/4", ties: true, accidentals: true };
    await page.evaluate((value) => {
      localStorage.removeItem("musikkapp.bladlesing");
      localStorage.setItem("mallet-sr-settings-v3", JSON.stringify(value));
    }, old);
    await page.reload();
    await openDrawer();
    const selected = (id) => page.locator(id).evaluate((el) => ({ value: el.value, text: el.selectedOptions[0]?.textContent }));
    assert.deepEqual(await selected("#texture"), { value: "block", text: "Bare treklanger" });
    assert.deepEqual(await selected("#clef"), { value: "bass", text: "F-nøkkel" });
    assert.equal(await page.locator("#ties").isChecked(), true);
    assert.equal(await page.locator("#accidentals").isChecked(), true);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("musikkapp.bladlesing")));
    for (const key of ["instrumentId", "mallets", "texture", "clef", "ties", "accidentals"]) assert.deepEqual(saved[key], old[key], key);
  });

  for (const [name, setup] of [
    ["768x1024", async () => page.setViewportSize({ width: 768, height: 1024 })],
    ["iPad (gen 7) profile", async () => {
      const { defaultBrowserType: _browser, ...ipad } = devices["iPad (gen 7)"];
      await page.context().close();
      page = await (await browser.newContext(ipad)).newPage();
    }],
  ]) {
    it(`nothing overflows or is cut off in the settings, status and meta line on ${name}`, async () => {
      await setup();
      await open("/");
      for (const mallets of ["2", "3", "4"]) {
        await openDrawer();
        await page.locator('[data-settings="instrument"]').click();
        await page.locator("#mallets").selectOption(mallets);
        await page.locator("#texture").selectOption({ index: 2 });
        await page.locator('[data-settings-panel="instrument"] [data-settings-back]').click();
        assert.deepEqual(await crampedElements(`${name.startsWith("768") ? "768" : "ipad"}-${mallets}k`), [], `${mallets} mallets`);
        await page.locator('[data-settings="instrument"]').click();
        await page.locator("#btnApply").click();
        await page.waitForTimeout(300);
        await shot(`${name.startsWith("768") ? "768" : "ipad"}-${mallets}k-score`);
      }
    });
  }
});
