// End-to-end checks for the shared metronome core, the plan clock and block navigation.
// Runs against `vite preview` of a fresh build (`npm run test:e2e`), or E2E_URL if set.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { after, before, beforeEach, describe, it } from "node:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const BASE = process.env.E2E_URL || "http://127.0.0.1:8081";
// Optional: save review screenshots here (not used in CI).
const SHOTS = process.env.E2E_SHOTS || "";
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
  browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--disable-audio-output"] });
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
    assert.equal(await page.locator("#btnPlay").innerText(), "Play", "play-along shows as stopped");
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

      await open("/oveplan", plan(["twomallet"]));
      await page.getByRole("button", { name: "Start", exact: true }).click();
      await page.waitForFunction(() => location.pathname === "/metronom");
      await page.locator(".plan-chip").waitFor();
      assert.deepEqual(await overflowOf(), [0, 0], "/metronom with the plan chip overflows");
      await shot(`metronom-chip-${width}x${height}`);
      await header().click();
      await tab("/");
      await page.waitForSelector("#score svg");
      await header().click();
      await page.locator("#pulseNote").waitFor({ state: "visible" });
      assert.deepEqual(await overflowOf(), [0, 0], "Bladlesing with the status line overflows");
      await shot(`bladlesing-yielded-${width}x${height}`);
    });
  }
});
