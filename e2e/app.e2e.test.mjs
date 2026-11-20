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

describe("default route", () => {
  it("opens Øveplan by default at / and redirects /oveplan to /", async () => {
    await open("/");
    assert.equal(new URL(page.url()).pathname, "/");
    assert.equal(await page.locator('nav a[href="/"]').getAttribute("aria-current"), "page");
    await page.getByRole("button", { name: "Start", exact: true }).waitFor();

    await page.goto(BASE + "/oveplan");
    await page.waitForFunction(() => location.pathname === "/");
    assert.equal(await page.locator('nav a[href="/"]').getAttribute("aria-current"), "page");
  });
});

describe("block navigation", () => {
  it("2-mallet and 4-mallet stay on Øveplan with the plan timer in the header and play the block metronome", async () => {
    await open("/", plan(["twomallet", "fourmallet"]));
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await header().waitFor();
    assert.equal(new URL(page.url()).pathname, "/");
    assert.match(await header().innerText(), /2-mallet/);
    assert.match(await page.locator("main").innerText(), /\b100\b/, "shows the block BPM");
    const clicks = await recentClicks(2200);
    assert.ok(clicks.length >= 2, "the block metronome plays");
    assert.ok(Math.abs(minGap(clicks) - 0.6) < 0.02, `one 100 BPM stream, got gap ${minGap(clicks)}`);

    await page.getByRole("button", { name: "Ferdig", exact: true }).click();
    assert.match(await header().innerText(), /4-mallet/);
    await header().click();
    const next = await recentClicks(2500);
    assert.ok(Math.abs(minGap(next) - 60 / 72) < 0.02, `one 72 BPM stream, got gap ${minGap(next)}`);
    await noReload();
  });

  it("SRF opens Bladlesing with the plan timer in the header", async () => {
    await open("/", plan(["srf"]));
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.waitForFunction(() => location.pathname === "/bladlesing");
    assert.match(await header().innerText(), /Bladlesing/);
    assert.equal((await recentClicks(800)).length, 0, "SRF does not start a metronome");
    await noReload();
  });

  it("Repertoar keeps today's behaviour: no navigation, no metronome", async () => {
    await open("/", plan(["rep"]));
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.waitForTimeout(500);
    assert.equal(new URL(page.url()).pathname, "/");
    assert.match(await header().innerText(), /Repertoar/);
    assert.equal((await recentClicks(800)).length, 0);
  });

  it("switching block while the timer runs stops the old sound and keeps one countdown", async () => {
    await open("/", plan(["twomallet", "srf"]));
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await header().waitFor();
    assert.ok((await recentClicks(1000)).length >= 1);
    await page.locator(".plan-hero").getByRole("button", { name: /Bladlesing/ }).click();
    await page.waitForFunction(() => location.pathname === "/bladlesing");
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
    await open("/", plan(["rep"]));
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await header().waitFor();
    const first = await headerSeconds();
    const began = Date.now();
    for (const path of ["/metronom", "/bladlesing", "/tuner", "/", "/metronom"]) await tab(path);
    await page.waitForTimeout(Math.max(0, 4000 - (Date.now() - began)));
    const drop = first - (await headerSeconds());
    const elapsed = Math.round((Date.now() - began) / 1000);
    assert.ok(Math.abs(drop - elapsed) <= 1, `countdown fell ${drop}s in ${elapsed}s`);
    assert.equal(await countdownIntervals(), 1, "one countdown interval after tab switches");

    await header().click();
    const paused = await headerSeconds();
    await page.waitForTimeout(1500);
    assert.equal(await headerSeconds(), paused, "paused in the header");
    await tab("/");
    await page.getByRole("button", { name: "Fortsett", exact: true }).waitFor();
    await page.getByRole("button", { name: "Fortsett", exact: true }).click();
    await tab("/tuner");
    await page.waitForTimeout(1500);
    assert.ok((await headerSeconds()) < paused, "resumed from Øveplan, running in Tuner header");

    await tab("/");
    await page.getByRole("button", { name: "Liste", exact: true }).click();
    await page.getByRole("button", { name: "Nullstill", exact: true }).click();
    for (const path of ["/metronom", "/bladlesing"]) {
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
    await tab("/bladlesing");
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
    await open("/bladlesing");
    await page.waitForSelector("#score svg");
    await page.locator("#btnMetro").click();
    assert.equal(await metroOn(), true);
    await tab("/metronom");
    await page.getByRole("button", { name: "Start", exact: true }).click();
    assert.equal(await owner(), "metronom");
    await tab("/bladlesing");
    await page.waitForSelector("#score svg");
    assert.equal(await metroOn(), false, "#btnMetro is not active after returning");
    assert.equal(await owner(), null);
  });

  it("a plan block taking the pulse turns metronome and play-along off", async () => {
    await open("/", plan(["twomallet"]));
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await header().waitFor();
    await header().click();
    await tab("/bladlesing");
    await page.waitForSelector("#score svg");

    await page.locator("#btnMetro").click();
    assert.equal(await owner(), "bladlesing");
    await header().click();
    await page.waitForFunction(() => window.MusikkPulse?.getState().owner === "oveplan");
    assert.equal(new URL(page.url()).pathname, "/bladlesing");
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
    await open("/", plan(["srf"]));
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.waitForFunction(() => location.pathname === "/bladlesing");
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
    await tab("/bladlesing");
    await page.waitForTimeout(1200);
    assert.equal(await header().getAttribute("aria-pressed"), "false", "leaving the tab keeps it running");
    await noReload();
  });
});

describe("Metronom during a 2-mallet block", () => {
  it("Stopp pauses the block, Start resumes it at the block's tempo, and the chips show the block's meter", async () => {
    await open("/", plan(["twomallet"]));
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await header().waitFor();
    await tab("/metronom");
    await page.locator(".plan-chip").waitFor();
    await traceOwners();
    const main = page.locator("main");
    assert.match(await main.innerText(), /2-mallet · 3 slag/);
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
    assert.match(await main.innerText(), /2-mallet · 4 slag/);
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
      await open("/bladlesing");
      for (const path of ["/bladlesing", "/metronom", "/", "/tuner", "/noter"]) {
        await tab(path);
        await page.waitForTimeout(path === "/bladlesing" ? 800 : 200);
        const overflow = await page.evaluate(() =>
          [document.documentElement, document.querySelector("main")].map((el) => el.scrollWidth - el.clientWidth),
        );
        assert.deepEqual(overflow, [0, 0], `${path} overflows`);
      }

      await tab("/bladlesing");
      await page.waitForSelector("#score svg");
      const lines = await page.locator("#btnGenerate").evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
      });
      assert.equal(lines, 1, "«Ny etyde» stays on one line");
      await page.locator("#btnSettings").click();
      for (const panel of ["instrument", "rytme", "register", "toneart", "mer"]) {
        if (await page.locator(`[data-settings="${panel}"]`).isVisible()) {
          await page.locator(`[data-settings="${panel}"]`).click();
        }
        const drawer = await page.locator("#drawer").evaluate((el) => {
          const box = el.getBoundingClientRect();
          const wide = [...el.querySelectorAll("*")].filter((c) => {
            if (c.classList.contains("sr-only-select")) return false;
            const r = c.getBoundingClientRect();
            return r.width > 0 && (r.right > box.right + 0.5 || r.left < box.left - 0.5);
          });
          return { scroll: el.scrollWidth - el.clientWidth, wide: wide.map((c) => c.id || c.className || c.tagName) };
        });
        assert.deepEqual(drawer, { scroll: 0, wide: [] }, `the ${panel} panel overflows`);
        assert.deepEqual(await overflowOf(), [0, 0], `Bladlesing with the ${panel} panel open overflows`);
        await shot(`bladlesing-drawer-${panel}-${width}x${height}`);
        const backBtn = page.locator(`[data-settings-panel="${panel}"] [data-settings-back]`);
        if (await backBtn.isVisible()) await backBtn.click();
      }
      await page.locator("#btnCloseSettings").click();

      await open("/", plan(["twomallet"]));
      await page.getByRole("button", { name: "Start", exact: true }).click();
      await header().waitFor();
      await tab("/metronom");
      await page.locator(".plan-chip").waitFor();
      assert.deepEqual(await overflowOf(), [0, 0], "/metronom with the plan chip overflows");
      await shot(`metronom-chip-${width}x${height}`);
      await header().click();
      await tab("/bladlesing");
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
      const pulseColor = await page.locator("#pulseNote").evaluate((el) => {
        const probe = document.createElement("span");
        probe.style.color = "var(--color-twomallet)";
        document.body.appendChild(probe);
        const expected = getComputedStyle(probe).color;
        probe.remove();
        return { actual: getComputedStyle(el).color, expected };
      });
      assert.equal(pulseColor.actual, pulseColor.expected, "the status line uses the 2-mallet colour");
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
    await open("/bladlesing");
    await page.waitForSelector("#score svg");
    for (const mallets of ["2", "3", "4"]) {
      await page.locator("#btnSettings").click();
      if (await page.locator('[data-settings="instrument"]').isVisible()) {
        await page.locator('[data-settings="instrument"]').click();
      }
      await page.locator("#mallets").selectOption(mallets);
      const applyBtn = (await page.locator("#btnApplyTop").isVisible())
        ? page.locator("#btnApplyTop")
        : page.locator("#btnApply");
      await applyBtn.click();
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
    await open("/bladlesing");
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
        await open("/", plan([block]));
        await page.getByRole("button", { name: "Start", exact: true }).click();
        await header().waitFor();
        await tab("/metronom");
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
    if (await page.locator(`[data-settings="${panel}"]`).isVisible()) {
      await page.locator(`[data-settings="${panel}"]`).click();
    }
    const text = await page.locator(`[data-settings-panel="${panel}"]`).evaluate((el) => el.textContent.replace(/\s+/g, " "));
    const backBtn = page.locator(`[data-settings-panel="${panel}"] [data-settings-back]`);
    if (await backBtn.isVisible()) await backBtn.click();
    return text;
  }

  // Nothing sticks out of the drawer, no label is cut off, and no select is too narrow for its longest option.
  async function crampedElements(shotPrefix) {
    const out = [];
    for (const panel of ["instrument", "rytme", "register", "toneart", "mer"]) {
      if (await page.locator(`[data-settings="${panel}"]`).isVisible()) {
        await page.locator(`[data-settings="${panel}"]`).click();
      }
      await shot(`${shotPrefix}-${panel}`);
      out.push(
        ...(await page.locator(`[data-settings-panel="${panel}"]`).evaluate((root, name) => {
          const box = document.querySelector("#drawer").getBoundingClientRect();
          const bad = [];
          const canvas = document.createElement("canvas").getContext("2d");
          for (const el of root.querySelectorAll("*")) {
            if (el.classList.contains("sr-only-select")) continue;
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
      const backBtn = page.locator(`[data-settings-panel="${panel}"] [data-settings-back]`);
      if (await backBtn.isVisible()) await backBtn.click();
    }
    const line = await page.locator("#practiceLine").evaluate((el) => el.scrollWidth - el.clientWidth);
    if (line > 0) out.push("practiceLine clipped");
    const page_ = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (page_ > 0) out.push("page overflows");
    return out;
  }

  it("the new labels show, the old words are gone, and ids and values are unchanged", async () => {
    await open("/bladlesing");
    await openDrawer();
    const text = {};
    for (const panel of ["instrument", "rytme", "register", "toneart", "mer"]) text[panel] = await panelText(panel);
    assert.match(text.instrument, /Instrument/);
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
      groups: [["group", "Tonearter Dur"], ["group", "Tonearter Parallellmoll"], ["group", "Tonearter"]],
    });
    for (const [panel, value] of Object.entries(text)) assert.doesNotMatch(value, OLD_WORDS, `${panel}: ${value.match(OLD_WORDS)?.[0]}`);
    const clef = await page.locator("#clef").evaluate((el) => [...el.options].map((o) => [o.value, o.textContent]));
    assert.deepEqual(clef, [["auto", "Auto"], ["treble", "G-nøkkel"], ["bass", "F-nøkkel"], ["grand", "Pianosystem"]]);
    const textures = {};
    for (const mallets of ["2", "3", "4"]) {
      if (await page.locator('[data-settings="instrument"]').isVisible()) {
        await page.locator('[data-settings="instrument"]').click();
      }
      await page.locator("#mallets").selectOption(mallets);
      textures[mallets] = await page.locator("#texture").evaluate((el) => [...el.options].map((o) => [o.value, o.textContent]));
      const backBtn = page.locator('[data-settings-panel="instrument"] [data-settings-back]');
      if (await backBtn.isVisible()) await backBtn.click();
    }
    assert.deepEqual(textures["2"], [["mixed", "Melodi med akkorder"], ["melody", "Bare én linje"], ["doublestops", "Mest akkorder"]]);
    assert.deepEqual(textures["3"], [["mixed", "Melodi med akkorder"], ["melody", "Bare én linje"], ["block", "Bare treklanger"]]);
    assert.deepEqual(textures["4"].map((o) => o[0]), ["mixed", "melody", "block", "chorale"]);
    await page.locator("#btnCloseSettings").click();
    await page.locator("#btnSettings").click();
    if (await page.locator('[data-settings="mer"]').isVisible()) {
      await page.locator('[data-settings="mer"]').click();
    }
    for (const [level, word] of [[5, "bindebuer"], [7, "løse fortegn"]]) {
      await page.locator(`[data-level="${level}"]`).evaluate((el) => el.click());
      assert.match(await page.locator("#levelHint").textContent(), new RegExp(word), `level ${level} hint`);
    }
  });

  it("a setting saved with the old values still loads and shows the new wording", async () => {
    await open("/bladlesing");
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
      await open("/bladlesing");
      for (const mallets of ["2", "3", "4"]) {
        await openDrawer();
        if (await page.locator('[data-settings="instrument"]').isVisible()) {
          await page.locator('[data-settings="instrument"]').click();
        }
        await page.locator("#mallets").selectOption(mallets);
        await page.locator("#texture").selectOption({ index: 2 });
        const backBtn = page.locator('[data-settings-panel="instrument"] [data-settings-back]');
        if (await backBtn.isVisible()) await backBtn.click();
        assert.deepEqual(await crampedElements(`${name.startsWith("768") ? "768" : "ipad"}-${mallets}k`), [], `${mallets} mallets`);
        if (await page.locator('[data-settings="instrument"]').isVisible()) {
          await page.locator('[data-settings="instrument"]').click();
        }
        const applyBtn = (await page.locator("#btnApplyTop").isVisible())
          ? page.locator("#btnApplyTop")
          : page.locator("#btnApply");
        await applyBtn.click();
        await page.waitForTimeout(300);
        await shot(`${name.startsWith("768") ? "768" : "ipad"}-${mallets}k-score`);
      }
    });
  }
});

// iPad after the screen lock: the shared AudioContext is "interrupted" or its clock stands still, and
// resume() never settles. Playwright cannot lock a real iPad, so the context is faked stuck.
describe("audio after the screen was locked", () => {
  async function lockContext(mode) {
    await page.evaluate((how) => {
      const ctx = window.MusikkPulse.audio();
      window.__stuck = ctx;
      const frozen = ctx.currentTime;
      if (how === "interrupted") Object.defineProperty(ctx, "state", { get: () => "interrupted", configurable: true });
      Object.defineProperty(ctx, "currentTime", { get: () => frozen, configurable: true });
      ctx.resume = () => new Promise(() => {});
    }, mode);
  }
  const replaced = () => page.evaluate(() => window.MusikkPulse.audio() !== window.__stuck);
  const pastFirstBeat = (timeout = 8000) => page.waitForFunction(() => window.MusikkPulse.getState().beat >= 1, null, { timeout });

  it("Metronom, interrupted: the first Start after the lock moves on from beat 1, in the sound and on screen", async () => {
    await open("/metronom");
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.getByRole("button", { name: "Stopp", exact: true }).click();
    await lockContext("interrupted");
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await pastFirstBeat();
    const dot = await page.evaluate(() => [...document.querySelectorAll(".metro-badge")].findIndex((el) => el.classList.contains("is-active")));
    assert.ok(dot >= 0, "a beat dot is lit");
    assert.ok(await replaced(), "the stuck context was replaced in the tap");
    assert.ok(await page.evaluate(() => window.__probe.starts.some((s) => s.ctx >= 1)), "clicks play on the new context");
  });

  it("Metronom, clock freezes while playing: it stops, the screen shows stopped, the next Start works", async () => {
    await open("/metronom");
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await pastFirstBeat();
    await lockContext("frozen");
    await page.waitForFunction(() => !window.MusikkPulse.getState().running, null, { timeout: 8000 });
    assert.equal(await replaced(), false, "nothing was swapped outside a tap");
    assert.equal(await page.getByRole("button", { name: "Start", exact: true }).isEnabled(), true, "Start is available again");
    assert.equal(await page.locator(".metro-badge.is-active").count(), 0, "no beat dot is lit");
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await pastFirstBeat();
    assert.equal(await page.evaluate(() => window.MusikkPulse.audio() !== window.__stuck), true, "the tap replaced the context");
    assert.ok(await page.evaluate(() => window.__probe.starts.some((s) => s.ctx >= 1)), "clicks play on the new context");
  });

  it("Øveplan, clock freezes in a 2-mallet block: the plan pauses with its time kept, and the next Start carries on", async () => {
    await open("/", plan(["twomallet"]));
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await header().waitFor();
    await tab("/metronom");
    await pastFirstBeat();
    assert.equal(await header().getAttribute("aria-pressed"), "false", "the block is running");
    await lockContext("frozen");
    await page.waitForFunction(() => !window.MusikkPulse.getState().running, null, { timeout: 8000 });
    assert.equal(await header().getAttribute("aria-pressed"), "true", "the plan is paused, like the pause button");
    const left = await headerSeconds();
    await page.waitForTimeout(2200);
    assert.equal(await headerSeconds(), left, "the time left stands still");
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await pastFirstBeat();
    assert.equal(await header().getAttribute("aria-pressed"), "false", "the block carries on");
    await page.waitForTimeout(2200);
    assert.ok((await headerSeconds()) < left, "and counts down again");
  });

  it("Øveplan, clock freezes during play-along in a SRF block: the plan pauses with its time kept, and the next Play carries on", async () => {
    await open("/", plan(["srf"]));
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.waitForFunction(() => location.pathname === "/bladlesing");
    await page.waitForSelector("#score svg");
    await lockContext("frozen");
    await page.locator("#btnPlay").click();
    await page.waitForFunction(() => window.MusikkPulse.getState().running, null, { timeout: 8000 });
    await page.waitForFunction(() => !window.MusikkPulse.getState().running, null, { timeout: 8000 });
    assert.equal(await header().getAttribute("aria-pressed"), "true", "the plan is paused, like the pause button");
    const left = await headerSeconds();
    await page.waitForTimeout(2200);
    assert.equal(await headerSeconds(), left, "the time left stands still");
    await page.locator("#btnPlay").click();
    await pastFirstBeat(12000);
    assert.equal(await header().getAttribute("aria-pressed"), "false", "the block carries on");
    await page.waitForTimeout(2200);
    assert.ok((await headerSeconds()) < left, "and counts down again");
  });

  it("Bladlesing, clock frozen but state running: Play stops with the button reset, the next Play plays on a new context", async () => {
    await open("/bladlesing");
    await page.waitForSelector("#score svg");
    await lockContext("frozen");
    await page.locator("#btnPlay").click();
    await page.waitForFunction(() => window.MusikkPulse.getState().running, null, { timeout: 8000 });
    await page.waitForFunction(() => !window.MusikkPulse.getState().running, null, { timeout: 8000 });
    assert.equal(await replaced(), false, "nothing was swapped outside a tap");
    assert.equal(await page.locator("#btnPlay").evaluate((el) => el.classList.contains("on")), false, "Play shows stopped");
    await page.locator("#btnPlay").click();
    await pastFirstBeat(12000);
    assert.equal(await page.evaluate(() => window.MusikkPulse.audio() !== window.__stuck), true, "the tap replaced the context");
  });

  it("Bladlesing, interrupted with a resume() that hangs: Play starts at once", async () => {
    await open("/bladlesing");
    await page.waitForSelector("#score svg");
    await lockContext("interrupted");
    await page.locator("#btnPlay").click();
    await pastFirstBeat(12000);
    assert.ok(await replaced(), "the stuck context was replaced in the tap");
  });
});

describe("duet mode", () => {
  it("toggles duet mode, switches parts, toggles mutes, preloads audio, and fits mobile 390x844 without overflow", async () => {
    const pageErrors = [];
    const consoleErrors = [];
    const sampleRequests = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("request", (req) => {
      if (/\/malletsight\/sample-.*\.mp3/.test(req.url())) sampleRequests.push(req.url());
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await open("/bladlesing");
    await page.waitForSelector("#score svg");

    await page.locator("#btnDuetToggle").click();
    await page.locator("#duetToolbar").waitFor({ state: "visible" });
    assert.equal(
      await page.locator("#btnDuetToggle").evaluate((el) => el.classList.contains("on")),
      true,
      "#btnDuetToggle activates duet mode",
    );

    const overflow = await page.evaluate(() => {
      const toolbar = document.querySelector("#duetToolbar");
      return {
        docOverflow: document.documentElement.scrollWidth > window.innerWidth,
        toolbarOverflow: toolbar ? toolbar.scrollWidth > toolbar.clientWidth : true,
      };
    });
    assert.deepEqual(
      overflow,
      { docOverflow: false, toolbarOverflow: false },
      "duet toolbar and page fit 390x844 without horizontal overflow",
    );

    for (const [part, expectedTitle] of [
      ["trumpet", /Trompet/],
      ["mallets", /Xylofon|Marimba|Vibrafon|Klokkespill/],
      ["score", /Duett/],
    ]) {
      await page.locator(`[data-duet-view="${part}"]`).click();
      await page.waitForTimeout(150);
      assert.equal(
        await page.locator(`[data-duet-view="${part}"]`).evaluate((el) => el.classList.contains("active")),
        true,
        `[data-duet-view="${part}"] is active`,
      );
      assert.equal(await page.locator("#duetViewSelect").inputValue(), part, `#duetViewSelect reflects ${part}`);
      const scoreText = (await page.locator("#score svg").textContent()) || "";
      assert.match(scoreText, expectedTitle, `score updates for ${part} view`);
    }

    for (const muteId of ["#btnMuteTrumpet", "#btnMuteMallets"]) {
      const btn = page.locator(muteId);
      assert.equal(await btn.evaluate((el) => el.classList.contains("muted")), false, `${muteId} starts unmuted`);
      await btn.click();
      assert.equal(await btn.evaluate((el) => el.classList.contains("muted")), true, `${muteId} toggles to muted`);
      await btn.click();
      assert.equal(await btn.evaluate((el) => el.classList.contains("muted")), false, `${muteId} toggles back to unmuted`);
    }

    await page.waitForTimeout(300);
    const audioReady = await page.evaluate(() => {
      const ctx = window.MusikkPulse?.audio?.();
      return !!ctx && ctx.state !== "closed";
    });
    assert.equal(audioReady, true, "AudioContext is initialized and not closed");
    assert.ok(sampleRequests.length >= 1, `expected /malletsight/sample-*.mp3 preload requests, got ${sampleRequests.length}`);
    assert.deepEqual(pageErrors, [], `unexpected page errors: ${pageErrors.join("; ")}`);
    assert.deepEqual(consoleErrors, [], `unexpected console errors: ${consoleErrors.join("; ")}`);
    await noReload();
  });
});

describe("Bladlesing Metronom 1-bar count-in and auto-stop", () => {
  it("plays 1-bar count-in then Stopp, auto-stops at etude end, and keeps the Øveplan timer running", async () => {
    await open("/", plan(["srf"]));
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.waitForFunction(() => location.pathname === "/bladlesing");
    await page.waitForSelector("#score svg");

    // Use a 4-bar etude at max clamped tempo (160 BPM) so 1-bar count-in + 4 bars finishes in ~7.5s.
    await page.evaluate(() => {
      const sel = document.querySelector("#measures");
      if (sel) {
        sel.value = "4";
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }
      window.MalletSight?.generate?.();
      window.MalletSight?.setTempo?.(160);
    });
    await page.waitForSelector("#score svg");
    const beforeSeconds = await headerSeconds();

    await page.locator("#btnMetro").click();
    assert.equal(
      await page.locator("#btnMetro").evaluate((el) => el.classList.contains("on")),
      true,
      "#btnMetro turns on",
    );
    assert.match(await page.locator("#btnMetro").innerText(), /^[1-4]$/, "shows 1-bar count-in beat");
    assert.ok((await recentClicks(900)).length >= 1, "count-in clicks play");

    await page.waitForFunction(() => document.querySelector("#btnMetro")?.textContent === "Stopp", null, { timeout: 5000 });
    await page.waitForFunction(
      () =>
        document.querySelector("#btnMetro")?.textContent === "Metronom" &&
        !document.querySelector("#btnMetro")?.classList.contains("on"),
      null,
      { timeout: 15000 },
    );

    assert.equal(await header().getAttribute("aria-pressed"), "false", "Øveplan block timer stays running");
    const afterSeconds = await headerSeconds();
    assert.ok(afterSeconds < beforeSeconds, `Øveplan timer kept counting down (${beforeSeconds}s -> ${afterSeconds}s)`);
    await noReload();
  });
});

describe("Noter library", () => {
  it("renders the Noter library view at /noter without console or page errors", async () => {
    const pageErrors = [];
    const consoleErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await open("/noter");
    await page.getByRole("heading", { name: "Noter", exact: true }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Last opp PDF" }).waitFor({ state: "visible" });
    assert.match(await page.locator("main").innerText(), /Ingen noter lastet opp ennå/);
    assert.deepEqual(pageErrors, [], `unexpected page errors: ${pageErrors.join("; ")}`);
    assert.deepEqual(consoleErrors, [], `unexpected console errors: ${consoleErrors.join("; ")}`);
    await noReload();
  });
});

function mockPdfJsLib() {
  window.pdfjsLib = {
    GlobalWorkerOptions: { workerSrc: "" },
    getDocument() {
      return {
        promise: Promise.resolve({
          numPages: 3,
          getPage() {
            return Promise.resolve({
              getViewport({ scale }) {
                return {
                  width: Math.round(600 * scale),
                  height: Math.round(800 * scale),
                };
              },
              render({ canvasContext, viewport }) {
                canvasContext.fillStyle = "#ffffff";
                canvasContext.fillRect(0, 0, viewport.width, viewport.height);
                canvasContext.fillStyle = "#111827";
                canvasContext.fillRect(
                  viewport.width * 0.2,
                  viewport.height * 0.2,
                  viewport.width * 0.6,
                  viewport.height * 0.6,
                );
                return { promise: Promise.resolve(), cancel() {} };
              },
            });
          },
          destroy() {
            return Promise.resolve();
          },
        }),
      };
    },
  };
}

async function getSettledLayerBox(page, layer, timeoutMs = 5000) {
  await layer.waitFor({ state: "visible" });
  const deadline = Date.now() + timeoutMs;
  let prev = null;
  while (Date.now() < deadline) {
    const hasStyleWidth = await layer.evaluate((el) => el.style.width !== "");
    const box = await layer.boundingBox();
    if (hasStyleWidth && box && box.width > 180 && box.height > 200) {
      if (
        prev &&
        Math.abs(prev.x - box.x) < 1 &&
        Math.abs(prev.y - box.y) < 1 &&
        Math.abs(prev.width - box.width) < 1 &&
        Math.abs(prev.height - box.height) < 1
      ) {
        return box;
      }
      prev = box;
    } else {
      prev = null;
    }
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  }
  throw new Error("Timed out waiting for annotation layer bounding box to settle");
}

describe("Noter annotation & stage mode", () => {
  it("supports pencil, highlighter, undo/redo, stamps, text, eraser, visibility, IndexedDB persistence, auto-crop, and half-page turn", async () => {
    const pageErrors = [];
    const consoleErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.route("https://cdn.jsdelivr.net/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/javascript",
        headers: { "access-control-allow-origin": "*" },
        body: "",
      }),
    );
    await page.addInitScript(mockPdfJsLib);
    await open("/noter");

    await page.locator('input[type="file"][accept="application/pdf,.pdf"]').setInputFiles({
      name: "test-stykke.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n%mock\n"),
    });

    const sheetButton = page.getByRole("button", { name: /^test stykke/i });
    await sheetButton.waitFor({ state: "visible" });
    await sheetButton.click();

    const viewer = page.getByRole("dialog", { name: /Noteviser:/ });
    await viewer.waitFor({ state: "visible" });
    await viewer.getByText("Side 1 / 3").waitFor({ state: "visible" });

    // 1. Pencil (Blyant, Tykk, Rød)
    await viewer.getByRole("button", { name: "Blyant", exact: true }).click();
    await viewer.getByRole("button", { name: "Tykk", exact: true }).click();
    await viewer.getByRole("button", { name: "Farge Rød", exact: true }).click();

    const layer = viewer.locator('[data-testid="annotation-layer-page-1"]');
    let box = await getSettledLayerBox(page, layer);
    assert.ok(box && box.width > 180 && box.height > 200, "annotation layer has a valid settled bounding box");

    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.32, { steps: 5 });
    await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.35, { steps: 5 });
    await page.mouse.up();

    assert.equal(await layer.locator("svg path").count(), 1, "pencil stroke renders an SVG path");
    assert.equal(await layer.locator("svg path").first().getAttribute("stroke"), "#dc2626");

    // 2. Highlighter (Tusj)
    await viewer.getByRole("button", { name: "Tusj", exact: true }).click();
    box = await getSettledLayerBox(page, layer);
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.48);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.5, { steps: 6 });
    await page.mouse.up();

    assert.equal(
      await layer.locator('svg path[stroke-opacity="0.35"]').count(),
      1,
      "highlighter renders a semi-transparent path",
    );
    assert.equal(await layer.locator("svg path").count(), 2);

    // 3. Undo & Redo
    await viewer.getByRole("button", { name: "Angre", exact: true }).click();
    assert.equal(await layer.locator("svg path").count(), 1, "undo removes the last stroke");
    await viewer.getByRole("button", { name: "Gjør om", exact: true }).click();
    assert.equal(await layer.locator("svg path").count(), 2, "redo restores the undone stroke");

    // 4. Musical stamp (Stempel -> Velg stempel -> Fermate)
    await viewer.getByRole("button", { name: "Stempel", exact: true }).click();
    await viewer.getByRole("button", { name: "Velg stempel" }).click();
    const stampDialog = viewer.getByRole("dialog", { name: "Velg musikalsk stempel" });
    await stampDialog.waitFor({ state: "visible" });
    await stampDialog.getByRole("button", { name: "Fermate", exact: true }).click();

    box = await getSettledLayerBox(page, layer);
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.65);
    assert.equal(await layer.locator("svg g").count(), 1, "stamp renders an SVG <g> element");

    // 5. Short text note (Tekst -> Tekstnotat -> Bekreft)
    await viewer.getByRole("button", { name: "Tekst", exact: true }).click();
    box = await getSettledLayerBox(page, layer);
    await page.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.78);
    const textInput = viewer.getByRole("textbox", { name: "Tekstnotat" });
    await textInput.waitFor({ state: "visible" });
    await textInput.fill("Molto espressivo");
    await viewer.getByRole("button", { name: "Bekreft", exact: true }).click();

    assert.equal(await layer.locator("svg text").count(), 1, "text note renders an SVG <text> element");
    assert.equal(await layer.locator("svg text").first().textContent(), "Molto espressivo");

    // 6. Eraser (Viskelær)
    await viewer.getByRole("button", { name: "Viskelær", exact: true }).click();
    box = await getSettledLayerBox(page, layer);
    await page.mouse.move(box.x + box.width * 0.48, box.y + box.height * 0.65);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.52, box.y + box.height * 0.65, { steps: 4 });
    await page.mouse.up();

    assert.equal(await layer.locator("svg g").count(), 0, "eraser removes the targeted stamp");
    assert.equal(await layer.locator("svg path").count(), 2, "remaining strokes stay intact");
    assert.equal(await layer.locator("svg text").count(), 1, "remaining text stays intact");

    // 7. Visibility toggle (Skjul annoteringer / Vis annoteringer)
    const hideBtn = viewer.getByRole("button", { name: "Skjul annoteringer", exact: true });
    assert.equal(await hideBtn.getAttribute("aria-pressed"), "true");
    await hideBtn.click();

    const showBtn = viewer.getByRole("button", { name: "Vis annoteringer", exact: true });
    assert.equal(await showBtn.getAttribute("aria-pressed"), "false");
    assert.equal(await layer.locator("svg path").count(), 0, "paths hidden when visibility is off");
    assert.equal(await layer.locator("svg text").count(), 0, "text hidden when visibility is off");

    await showBtn.click();
    assert.equal(
      await viewer.getByRole("button", { name: "Skjul annoteringer", exact: true }).getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(await layer.locator("svg path").count(), 2, "paths restored when visibility is on");
    assert.equal(await layer.locator("svg text").count(), 1, "text restored when visibility is on");

    // 8. IndexedDB v2 persistence across reload
    await viewer.getByRole("button", { name: "Lukk noteviser", exact: true }).click();
    await viewer.waitFor({ state: "detached" });
    await page.reload();

    const reopenedButton = page.getByRole("button", { name: /^test stykke/i });
    await reopenedButton.waitFor({ state: "visible" });
    await reopenedButton.click();
    await viewer.waitFor({ state: "visible" });
    await viewer.getByText("Side 1 / 3").waitFor({ state: "visible" });

    const annotationSvg = viewer.locator('svg[preserveAspectRatio="none"]').first();
    await annotationSvg.locator("path").first().waitFor({ state: "visible" });
    await annotationSvg.locator("text").first().waitFor({ state: "visible" });
    assert.equal(await annotationSvg.locator("path").count(), 2, "persisted paths reload from IndexedDB");
    assert.equal(
      await annotationSvg.locator("text").first().textContent(),
      "Molto espressivo",
      "persisted text reloads from IndexedDB",
    );

    // 9. Auto-crop
    assert.equal(await annotationSvg.getAttribute("viewBox"), "0 0 1000 1000");
    await viewer.getByRole("button", { name: "Slå på auto-beskjæring", exact: true }).click();
    assert.equal(
      await viewer.getByRole("button", { name: "Slå av auto-beskjæring", exact: true }).getAttribute("aria-pressed"),
      "true",
    );
    await page.waitForFunction(() => {
      const svg = document.querySelector('[role="dialog"][aria-label^="Noteviser:"] svg[preserveAspectRatio="none"]');
      const vb = svg?.getAttribute("viewBox");
      return Boolean(vb && vb !== "0 0 1000 1000");
    });
    assert.notEqual(
      await annotationSvg.getAttribute("viewBox"),
      "0 0 1000 1000",
      "auto-crop updates annotation SVG viewBox",
    );

    // 10. Half-page turn
    await viewer.getByRole("button", { name: "Slå på halvside-vending", exact: true }).click();
    assert.equal(
      await viewer.getByRole("button", { name: "Slå av halvside-vending", exact: true }).getAttribute("aria-pressed"),
      "true",
    );
    await viewer.getByRole("button", { name: "Neste side", exact: true }).click();
    await viewer.getByText("Side 1–2 / 3").waitFor({ state: "visible" });
    await viewer.getByText("Side 2 (øverst)").waitFor({ state: "visible" });
    await viewer.getByText("Side 1 (nederst)").waitFor({ state: "visible" });
    assert.equal(await viewer.locator("canvas").count(), 2, "split view renders two canvases");

    await viewer.getByRole("button", { name: "Neste side", exact: true }).click();
    await viewer.getByText("Side 2 / 3").waitFor({ state: "visible" });
    assert.equal(await viewer.locator("canvas").count(), 1, "advancing from split view shows page 2");

    // 11. Zero console errors, page errors, and horizontal overflow
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    assert.equal(overflow, false, "no horizontal overflow at 390x844");
    assert.deepEqual(pageErrors, [], `unexpected page errors: ${pageErrors.join("; ")}`);
    assert.deepEqual(consoleErrors, [], `unexpected console errors: ${consoleErrors.join("; ")}`);
  });

  it("supports Korrekturlakk whiteout paint matching page background and placing a stamp on top", async () => {
    const pageErrors = [];
    const consoleErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.route("https://cdn.jsdelivr.net/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/javascript",
        headers: { "access-control-allow-origin": "*" },
        body: "",
      }),
    );
    await page.addInitScript(mockPdfJsLib);
    await open("/noter");

    await page.locator('input[type="file"][accept="application/pdf,.pdf"]').setInputFiles({
      name: "dynamikk-test.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n%mock\n"),
    });

    const sheetButton = page.getByRole("button", { name: /^dynamikk test/i });
    await sheetButton.waitFor({ state: "visible" });
    await sheetButton.click();

    const viewer = page.getByRole("dialog", { name: /Noteviser:/ });
    await viewer.waitFor({ state: "visible" });
    await viewer.getByText("Side 1 / 3").waitFor({ state: "visible" });

    // Select Korrekturlakk and Stor brush size
    await viewer.getByRole("button", { name: "Korrekturlakk", exact: true }).click();
    await viewer.getByRole("button", { name: "Stor", exact: true }).click();

    const layer = viewer.locator('[data-testid="annotation-layer-page-1"]');
    const box = await getSettledLayerBox(page, layer);
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5, { steps: 5 });
    await page.mouse.up();

    assert.equal(await layer.locator("svg path").count(), 1, "whiteout stroke renders an SVG path");
    assert.equal(
      await layer.locator("svg path").first().getAttribute("stroke"),
      "#ffffff",
      "whiteout stroke matches sampled white canvas background",
    );

    // Place a Forte (f) stamp on top of the whiteout stroke
    await viewer.getByRole("button", { name: "Stempel", exact: true }).click();
    await viewer.getByRole("button", { name: "Velg stempel", exact: true }).click();
    const stampDialog = viewer.getByRole("dialog", { name: "Velg musikalsk stempel" });
    await stampDialog.waitFor({ state: "visible" });
    await stampDialog.getByRole("button", { name: "Forte", exact: true }).click();

    await page.mouse.click(box.x + box.width * 0.48, box.y + box.height * 0.5);
    assert.equal(await layer.locator("svg g").count(), 1, "stamp renders on top of whiteout");

    // Verify DOM order: whiteout <path> comes before stamp <g>
    const whiteoutBeforeStamp = await layer.evaluate((el) => {
      const children = Array.from(el.querySelectorAll("svg > path, svg > g"));
      const pathIdx = children.findIndex((n) => n.tagName.toLowerCase() === "path");
      const gIdx = children.findIndex((n) => n.tagName.toLowerCase() === "g");
      return pathIdx !== -1 && gIdx !== -1 && pathIdx < gIdx;
    });
    assert.equal(whiteoutBeforeStamp, true, "stamp is layered above whiteout in SVG");

    assert.deepEqual(pageErrors, [], `unexpected page errors: ${pageErrors.join("; ")}`);
    assert.deepEqual(consoleErrors, [], `unexpected console errors: ${consoleErrors.join("; ")}`);
  });

  it("moves stamps and jump links via long-press in Vis mode with alignment reticle and single-step undo", async () => {
    const pageErrors = [];
    const consoleErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.route("https://cdn.jsdelivr.net/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/javascript",
        headers: { "access-control-allow-origin": "*" },
        body: "",
      }),
    );
    await page.addInitScript(mockPdfJsLib);
    await open("/noter");

    await page.locator('input[type="file"][accept="application/pdf,.pdf"]').setInputFiles({
      name: "flytt-test.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n%mock\n"),
    });

    const sheetButton = page.getByRole("button", { name: /^flytt test/i });
    await sheetButton.waitFor({ state: "visible" });
    await sheetButton.click();

    const viewer = page.getByRole("dialog", { name: /Noteviser:/ });
    await viewer.waitFor({ state: "visible" });
    await viewer.getByText("Side 1 / 3").waitFor({ state: "visible" });

    // Place a Fermate stamp at (0.35, 0.35)
    await viewer.getByRole("button", { name: "Stempel", exact: true }).click();
    const layer = viewer.locator('[data-testid="annotation-layer-page-1"]');
    let box = await getSettledLayerBox(page, layer);
    await page.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.35);
    const stampTransformBefore = await layer.locator("svg g").first().getAttribute("transform");
    assert.ok(stampTransformBefore, "stamp has initial transform");

    // Place a jump link at (0.3, 0.7) -> page 3
    await viewer.getByRole("button", { name: "Lenke", exact: true }).click();
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.7);
    await viewer.getByLabel("Målside", { exact: true }).fill("3");
    await viewer.getByRole("button", { name: "Lagre lenke", exact: true }).click();

    // Switch to Vis mode
    await viewer.getByRole("button", { name: "Vis", exact: true }).click();
    box = await getSettledLayerBox(page, layer);

    // Long-press the stamp for 420ms, verify alignment reticle appears, and drag to (0.65, 0.5)
    await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.35);
    await page.mouse.down();
    await page.waitForTimeout(420);
    await layer.locator('[data-testid="annotation-drag-reticle"]').waitFor({ state: "visible" });
    await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.5, { steps: 6 });
    await page.mouse.up();

    const stampTransformAfter = await layer.locator("svg g").first().getAttribute("transform");
    assert.notEqual(stampTransformAfter, stampTransformBefore, "stamp moved to new position");

    // Long-press the jump-link chip for 420ms and drag it without activating page jump
    const jumpChip = viewer.getByRole("button", { name: "Hopp til side 3: D.S.", exact: true });
    const chipBefore = await jumpChip.boundingBox();
    assert.ok(chipBefore, "jump chip bounding box exists");
    await page.mouse.move(
      chipBefore.x + chipBefore.width / 2,
      chipBefore.y + chipBefore.height / 2,
    );
    await page.mouse.down();
    await page.waitForTimeout(420);
    await page.mouse.move(
      chipBefore.x + chipBefore.width / 2 + 80,
      chipBefore.y + chipBefore.height / 2 - 40,
      { steps: 6 },
    );
    await page.mouse.up();

    // Still on Side 1 / 3 (release after long-press did not trigger jump)
    await viewer.getByText("Side 1 / 3").waitFor({ state: "visible" });
    await page.waitForFunction(
      ({ selector, prevX }) => {
        const el = document.querySelector(selector);
        if (!el) return false;
        return Math.abs(el.getBoundingClientRect().x - prevX) > 40;
      },
      { selector: '[aria-label="Hopp til side 3: D.S."]', prevX: chipBefore.x },
    );
    const chipAfter = await jumpChip.boundingBox();
    assert.ok(chipAfter && Math.abs(chipAfter.x - chipBefore.x) > 40, "jump chip moved");

    // Undo in one step reverts the stamp back to its original position
    await viewer.getByRole("button", { name: "Stempel", exact: true }).click();
    await viewer.getByRole("button", { name: "Angre", exact: true }).click();
    const stampTransformUndone = await layer.locator("svg g").first().getAttribute("transform");
    assert.equal(stampTransformUndone, stampTransformBefore, "single-step undo restores stamp");

    assert.deepEqual(pageErrors, [], `unexpected page errors: ${pageErrors.join("; ")}`);
    assert.deepEqual(consoleErrors, [], `unexpected console errors: ${consoleErrors.join("; ")}`);
  });

  it("offsets touch stamp placement and Vis-mode touch drag 48px above the finger", async () => {
    const pageErrors = [];
    const consoleErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.route("https://cdn.jsdelivr.net/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/javascript",
        headers: { "access-control-allow-origin": "*" },
        body: "",
      }),
    );
    await page.addInitScript(mockPdfJsLib);
    await open("/noter");

    await page.locator('input[type="file"][accept="application/pdf,.pdf"]').setInputFiles({
      name: "touch-offset-test.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n%mock\n"),
    });

    const sheetButton = page.getByRole("button", { name: /^touch offset test/i });
    await sheetButton.waitFor({ state: "visible" });
    await sheetButton.click();

    const viewer = page.getByRole("dialog", { name: /Noteviser:/ });
    await viewer.waitFor({ state: "visible" });
    await viewer.getByText("Side 1 / 3").waitFor({ state: "visible" });

    // Place a stamp with mouse at (0.3, 0.5) -> y should be ~500 in 1000-unit viewBox
    await viewer.getByRole("button", { name: "Stempel", exact: true }).click();
    const layer = viewer.locator('[data-testid="annotation-layer-page-1"]');
    let box = await getSettledLayerBox(page, layer);
    const targetY = box.y + box.height * 0.5;
    await page.mouse.click(box.x + box.width * 0.3, targetY);
    const mouseTransform = await layer.locator("svg g").first().getAttribute("transform");
    const mouseMatch = /translate\(([-\d.]+)\s+([-\d.]+)\)/.exec(mouseTransform ?? "");
    assert.ok(mouseMatch, "mouse stamp has transform");
    const mouseY = Number.parseFloat(mouseMatch[2]);

    // Place a stamp with touch at the same Y (x = 0.6, y = 0.5) -> live reticle appears and stamp lands ~48px higher
    const touchX = box.x + box.width * 0.6;
    await layer.evaluate(
      (el, { x, y }) => {
        el.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            cancelable: true,
            pointerId: 11,
            pointerType: "touch",
            clientX: x,
            clientY: y,
            isPrimary: true,
          }),
        );
      },
      { x: touchX, y: targetY },
    );
    await layer.locator('[data-testid="annotation-drag-reticle"]').waitFor({ state: "visible" });
    await layer.evaluate(
      (el, { x, y }) => {
        el.dispatchEvent(
          new PointerEvent("pointerup", {
            bubbles: true,
            cancelable: true,
            pointerId: 11,
            pointerType: "touch",
            clientX: x,
            clientY: y,
            isPrimary: true,
          }),
        );
      },
      { x: touchX, y: targetY },
    );

    const touchTransform = await layer.locator("svg g").nth(1).getAttribute("transform");
    const touchMatch = /translate\(([-\d.]+)\s+([-\d.]+)\)/.exec(touchTransform ?? "");
    assert.ok(touchMatch, "touch stamp has transform");
    const touchY = Number.parseFloat(touchMatch[2]);
    const expectedDeltaSvg = (48 / box.height) * 1000;
    assert.ok(
      Math.abs(mouseY - touchY - expectedDeltaSvg) < 8,
      `expected touch stamp ~48px higher (mouseY=${mouseY}, touchY=${touchY}, expectedDelta=${expectedDeltaSvg})`,
    );

    // Switch to Vis mode and long-press the touch-placed stamp with touch -> lifts 48px above finger
    await viewer.getByRole("button", { name: "Vis", exact: true }).click();
    box = await getSettledLayerBox(page, layer);
    const stampScreenY = box.y + (touchY / 1000) * box.height;
    const stampScreenX = box.x + (Number.parseFloat(touchMatch[1]) / 1000) * box.width;

    await layer.evaluate(
      (el, { x, y }) => {
        el.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            cancelable: true,
            pointerId: 12,
            pointerType: "touch",
            clientX: x,
            clientY: y,
            isPrimary: true,
          }),
        );
      },
      { x: stampScreenX, y: stampScreenY },
    );
    await page.waitForTimeout(420);
    await layer.locator('[data-testid="annotation-drag-reticle"]').waitFor({ state: "visible" });
    await layer.evaluate(
      (el, { x, y }) => {
        window.dispatchEvent(
          new PointerEvent("pointerup", {
            bubbles: true,
            cancelable: true,
            pointerId: 12,
            pointerType: "touch",
            clientX: x,
            clientY: y,
            isPrimary: true,
          }),
        );
      },
      { x: stampScreenX, y: stampScreenY },
    );

    const liftedTransform = await layer.locator("svg g").nth(1).getAttribute("transform");
    const liftedMatch = /translate\(([-\d.]+)\s+([-\d.]+)\)/.exec(liftedTransform ?? "");
    assert.ok(liftedMatch, "lifted stamp has transform");
    const liftedY = Number.parseFloat(liftedMatch[2]);
    const expectedLiftDeltaSvg = (48 / box.height) * 1000;
    assert.ok(
      Math.abs(touchY - liftedY - expectedLiftDeltaSvg) < 8,
      `expected Vis touch long-press to lift ~48px (touchY=${touchY}, liftedY=${liftedY})`,
    );

    assert.deepEqual(pageErrors, [], `unexpected page errors: ${pageErrors.join("; ")}`);
    assert.deepEqual(consoleErrors, [], `unexpected console errors: ${consoleErrors.join("; ")}`);
  });
});

describe("Noter setlists, navigation & backup", () => {
  it("manages setlists, seamless concert transitions, nav drawer bookmarks, jump links, tuner, and JSON backup", async () => {
    const pageErrors = [];
    const consoleErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("https://cdn.jsdelivr.net/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/javascript",
        headers: { "access-control-allow-origin": "*" },
        body: "",
      }),
    );
    await page.addInitScript(mockPdfJsLib);
    await open("/noter");

    // 1. Upload two PDFs
    const fileInput = page.locator('input[type="file"][accept*="pdf"]');
    await fileInput.setInputFiles([
      {
        name: "stykke-en.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF-1.4\n%fake-1"),
      },
      {
        name: "stykke-to.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF-1.4\n%fake-2"),
      },
    ]);

    await page.getByRole("button", { name: /^stykke en/i }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: /^stykke to/i }).waitFor({ state: "visible" });

    // 2. Switch to Settlister tab, create setlist, add both pieces, and start concert mode
    await page.getByRole("tab", { name: /Settlister/i }).click();
    await page.getByLabel("Navn på ny settliste", { exact: true }).fill("Konsert 17. mai");
    await page.getByRole("button", { name: "Opprett", exact: true }).click();
    await page.getByRole("heading", { name: "Konsert 17. mai" }).waitFor({ state: "visible" });

    const select = page.getByLabel("Velg stykke til Konsert 17. mai", { exact: true });
    const options = await select.locator("option").all();
    const firstVal = await options[0].getAttribute("value");
    const secondVal = await options[1].getAttribute("value");
    await select.selectOption(firstVal);
    await page.getByRole("button", { name: "Legg til", exact: true }).click();
    await select.selectOption(secondVal);
    await page.getByRole("button", { name: "Legg til", exact: true }).click();

    await page.getByRole("button", { name: "Start konsertmodus", exact: true }).click();
    const viewer = page.locator('[role="dialog"][aria-label^="Noteviser:"]');
    await viewer.waitFor({ state: "visible" });
    await viewer.getByText("1/2").waitFor({ state: "visible" });
    await viewer.getByText("Side 1 / 3").waitFor({ state: "visible" });

    // 3. Seamless concert transition across piece boundary
    await viewer.getByRole("button", { name: "Neste side", exact: true }).click();
    await viewer.getByText("Side 2 / 3").waitFor({ state: "visible" });
    await viewer.getByRole("button", { name: "Neste side", exact: true }).click();
    await viewer.getByText("Side 3 / 3").waitFor({ state: "visible" });
    await viewer.getByRole("button", { name: "Neste side", exact: true }).click();
    await viewer.getByText("2/2").waitFor({ state: "visible" });
    await viewer.getByText("Side 1 / 3").waitFor({ state: "visible" });

    // Step backward across boundary back to piece 1 page 3
    await viewer.getByRole("button", { name: "Forrige side", exact: true }).click();
    await viewer.getByText("1/2").waitFor({ state: "visible" });
    await viewer.getByText("Side 3 / 3").waitFor({ state: "visible" });

    // With two-page spread active on piece 1, moving to piece 2 and back preserves two-page spread on piece 1
    const spreadBtn = viewer.getByRole("button", { name: /to-siders visning/i });
    await spreadBtn.click();
    await viewer.getByText("Side 2–3 / 3").waitFor({ state: "visible" });
    await viewer.getByRole("button", { name: "Neste side", exact: true }).click();
    await viewer.getByText("2/2").waitFor({ state: "visible" });
    await viewer.getByText("Side 1 / 3").waitFor({ state: "visible" });
    await viewer.getByRole("button", { name: "Forrige side", exact: true }).click();
    await viewer.getByText("1/2").waitFor({ state: "visible" });
    await viewer.getByText("Side 2–3 / 3").waitFor({ state: "visible" });
    await spreadBtn.click();
    await viewer.getByText("Side 2 / 3").waitFor({ state: "visible" });

    // 4. Nav drawer thumbnails & bookmark
    await viewer.getByRole("button", { name: "Sideoversikt og bokmerker", exact: true }).click();
    const drawer = page.getByRole("dialog", { name: "Sider og bokmerker" });
    await drawer.waitFor({ state: "visible" });
    await drawer.getByRole("button", { name: /Side 1/i }).click();
    await drawer.waitFor({ state: "detached" });
    await viewer.getByText("Side 1 / 3").waitFor({ state: "visible" });

    await viewer.getByRole("button", { name: "Sideoversikt og bokmerker", exact: true }).click();
    await drawer.getByRole("tab", { name: /Bokmerker/i }).click();
    await drawer.getByLabel("Navn på bokmerke", { exact: true }).fill("Trio");
    await drawer.getByRole("button", { name: "Side 1", exact: true }).click();
    await drawer.getByText("Trio").waitFor({ state: "visible" });
    await drawer.getByRole("button", { name: "Lukk sideoversikt", exact: true }).click();

    // 5. Jump link creation, activation, and Tilbake button
    await viewer.getByRole("button", { name: "Lenke", exact: true }).click();
    const layer = viewer.getByTestId("annotation-layer-page-1");
    const box = await layer.boundingBox();
    assert.ok(box, "annotation layer bounding box exists");
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);

    await viewer.getByLabel("Målside", { exact: true }).fill("3");
    await viewer.getByRole("button", { name: "Lagre lenke", exact: true }).click();

    await viewer.getByRole("button", { name: "Vis", exact: true }).click();
    await viewer.getByRole("button", { name: "Hopp til side 3: D.S.", exact: true }).click();
    await viewer.getByText("Side 3 / 3").waitFor({ state: "visible" });

    const backBtn = viewer.getByRole("button", { name: "Tilbake til side 1", exact: true });
    await backBtn.waitFor({ state: "visible" });
    await backBtn.click();
    await viewer.getByText("Side 1 / 3").waitFor({ state: "visible" });

    // 6. Reference tone in quick-metronome bar
    await viewer.getByRole("button", { name: "Hurtig-metronom og stemmegaffel", exact: true }).click();
    await viewer.getByRole("button", { name: "442 Hz", exact: true }).click();
    await viewer.getByRole("button", { name: "Referansetone A", exact: true }).click();
    await viewer.getByRole("button", { name: "Stopp tone", exact: true }).click();

    // 7. Close viewer and test JSON backup export & restore
    await viewer.getByRole("button", { name: "Lukk noteviser", exact: true }).click();
    await viewer.waitFor({ state: "detached" });

    await page.getByRole("button", { name: "Backup", exact: true }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Eksporter backup (JSON)", exact: true }).click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    assert.ok(downloadPath, "backup JSON downloaded");

    const backupInput = page.locator('input[type="file"][accept*="json"]');
    await backupInput.setInputFiles(downloadPath);
    await page.getByRole("status").waitFor({ state: "visible" });

    // 8. Zero console errors, page errors, and horizontal overflow
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    assert.equal(overflow, false, "no horizontal overflow at 390x844");
    assert.deepEqual(pageErrors, [], `unexpected page errors: ${pageErrors.join("; ")}`);
    assert.deepEqual(consoleErrors, [], `unexpected console errors: ${consoleErrors.join("; ")}`);
  });
});

describe("Noter PDF page trimming", () => {
  it("prompts on large PDF upload, saves trimmed copy, and trims in-place from nav drawer", async () => {
    const pageErrors = [];
    const consoleErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("https://cdn.jsdelivr.net/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/javascript",
        headers: { "access-control-allow-origin": "*" },
        body: "",
      }),
    );

    await page.addInitScript(() => {
      window.pdfjsLib = {
        GlobalWorkerOptions: { workerSrc: "" },
        getDocument({ data }) {
          const bytes = new Uint8Array(data);
          const numPages = bytes.byteLength === 5 ? bytes[4] : 15;
          return {
            promise: Promise.resolve({
              numPages,
              getPage() {
                return Promise.resolve({
                  getViewport({ scale }) {
                    return {
                      width: Math.round(600 * scale),
                      height: Math.round(800 * scale),
                    };
                  },
                  render({ canvasContext, viewport }) {
                    canvasContext.fillStyle = "#ffffff";
                    canvasContext.fillRect(0, 0, viewport.width, viewport.height);
                    canvasContext.fillStyle = "#111827";
                    canvasContext.fillRect(
                      viewport.width * 0.2,
                      viewport.height * 0.2,
                      viewport.width * 0.6,
                      viewport.height * 0.6,
                    );
                    return { promise: Promise.resolve(), cancel() {} };
                  },
                });
              },
              destroy() {
                return Promise.resolve();
              },
            }),
          };
        },
      };

      window.PDFLib = {
        PDFDocument: {
          async load(data) {
            const bytes = new Uint8Array(data);
            const total = bytes.byteLength === 5 ? bytes[4] : 15;
            return { getPageCount: () => total };
          },
          async create() {
            const pages = [];
            return {
              async copyPages(_src, indices) {
                return indices.map((i) => ({ pageIndex: i }));
              },
              addPage(p) {
                pages.push(p);
              },
              async save() {
                return new Uint8Array([37, 80, 68, 70, pages.length]);
              },
            };
          },
        },
      };
    });

    await open("/noter");

    // 1. Upload a 15-page PDF -> trim modal opens automatically
    const fileInput = page.locator('input[type="file"][accept*="pdf"]');
    await fileInput.setInputFiles({
      name: "stort-partitur.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n%fake-big-score"),
    });

    const trimDialog = page.getByRole("dialog", { name: "Velg sider å beholde" });
    await trimDialog.waitFor({ state: "visible" });

    // 2. Select pages 14-15 via range input and save as copy
    await trimDialog.getByLabel("Sideområde", { exact: true }).fill("14-15");
    await trimDialog.getByRole("button", { name: "Bruk", exact: true }).click();
    await trimDialog.getByText("2 / 15 valgt").waitFor({ state: "visible" });

    await trimDialog.getByRole("button", { name: "Lagre som nytt stykke", exact: true }).click();
    await trimDialog.getByRole("button", { name: "Opprett utdrag", exact: true }).click();
    await trimDialog.waitFor({ state: "detached" });

    await page.getByRole("button", { name: /stort partitur \(utdrag\).*2 sider/i }).waitFor({
      state: "visible",
    });

    // 3. Open the original 15-page sheet and trim it in-place from NavDrawer
    await page
      .getByRole("button", { name: /^stort partitur/i })
      .filter({ hasText: "15 sider" })
      .click();
    const viewer = page.locator('[role="dialog"][aria-label^="Noteviser:"]');
    await viewer.waitFor({ state: "visible" });
    await viewer.getByText("Side 1 / 15").waitFor({ state: "visible" });

    await viewer.getByRole("button", { name: "Sideoversikt og bokmerker", exact: true }).click();
    const navDrawer = page.getByRole("dialog", { name: "Sider og bokmerker" });
    await navDrawer.waitFor({ state: "visible" });
    await navDrawer.getByRole("button", { name: "Velg sider å beholde (Trim PDF)", exact: true }).click();

    await trimDialog.waitFor({ state: "visible" });
    await trimDialog.getByLabel("Sideområde", { exact: true }).fill("2-4");
    await trimDialog.getByRole("button", { name: "Bruk", exact: true }).click();
    await trimDialog.getByRole("button", { name: "Behold 3 sider", exact: true }).click();
    await trimDialog.waitFor({ state: "detached" });

    await viewer.getByText("Side 1 / 3").waitFor({ state: "visible" });

    // 4. Zero console errors, page errors, and horizontal overflow
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    assert.equal(overflow, false, "no horizontal overflow at 390x844");
    assert.deepEqual(pageErrors, [], `unexpected page errors: ${pageErrors.join("; ")}`);
    assert.deepEqual(consoleErrors, [], `unexpected console errors: ${consoleErrors.join("; ")}`);
  });
});

describe("Noter manual PDF cropping", () => {
  it("opens manual crop modal, drags corner handle, applies crop, and persists across reload", async () => {
    const pageErrors = [];
    const consoleErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("https://cdn.jsdelivr.net/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/javascript",
        headers: { "access-control-allow-origin": "*" },
        body: "",
      }),
    );
    await page.addInitScript(mockPdfJsLib);
    await open("/noter");

    const fileInput = page.locator('input[type="file"][accept*="pdf"]');
    await fileInput.setInputFiles({
      name: "skann-med-stoy.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n%noisy-scan"),
    });

    await page.getByRole("button", { name: /^skann med stoy/i }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: /^skann med stoy/i }).click();

    const viewer = page.locator('[role="dialog"][aria-label^="Noteviser:"]');
    await viewer.waitFor({ state: "visible" });
    await viewer.getByText("Side 1 / 3").waitFor({ state: "visible" });

    const annotationSvg = viewer.locator('svg[preserveAspectRatio="none"]').first();
    assert.equal(await annotationSvg.getAttribute("viewBox"), "0 0 1000 1000");

    // Open manual crop modal
    await viewer.getByRole("button", { name: "Manuell beskjæring", exact: true }).click();
    const cropDialog = page.getByRole("dialog", { name: "Manuell beskjæring av side 1" });
    await cropDialog.waitFor({ state: "visible" });

    // Drag top-left corner handle inward
    const nwHandle = cropDialog.getByRole("button", { name: "Juster øvre venstre hjørne", exact: true });
    const handleBox = await nwHandle.boundingBox();
    assert.ok(handleBox, "nw corner handle bounding box exists");
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      handleBox.x + handleBox.width / 2 + 45,
      handleBox.y + handleBox.height / 2 + 60,
      { steps: 5 },
    );
    await page.mouse.up();

    // Apply to all pages and save
    await cropDialog.getByRole("checkbox", { name: /Bruk på alle 3 sider/i }).check();
    await cropDialog.getByRole("button", { name: "Lagre beskjæring", exact: true }).click();
    await cropDialog.waitFor({ state: "detached" });

    // Annotation SVG viewBox reflects the manual crop
    await page.waitForFunction(() => {
      const svg = document.querySelector('[role="dialog"][aria-label^="Noteviser:"] svg[preserveAspectRatio="none"]');
      const vb = svg?.getAttribute("viewBox");
      return Boolean(vb && vb !== "0 0 1000 1000");
    });
    const croppedViewBox = await annotationSvg.getAttribute("viewBox");
    assert.notEqual(croppedViewBox, "0 0 1000 1000");

    // Reload and verify manual crop persists on page 2 as well
    await page.reload();
    await page.getByRole("button", { name: /^skann med stoy/i }).click();
    await viewer.waitFor({ state: "visible" });
    await viewer.getByRole("button", { name: "Neste side", exact: true }).click();
    await viewer.getByText("Side 2 / 3").waitFor({ state: "visible" });
    await page.waitForFunction(() => {
      const svg = document.querySelector('[role="dialog"][aria-label^="Noteviser:"] svg[preserveAspectRatio="none"]');
      const vb = svg?.getAttribute("viewBox");
      return Boolean(vb && vb !== "0 0 1000 1000");
    });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    assert.equal(overflow, false, "no horizontal overflow at 390x844");
    assert.deepEqual(pageErrors, [], `unexpected page errors: ${pageErrors.join("; ")}`);
    assert.deepEqual(consoleErrors, [], `unexpected console errors: ${consoleErrors.join("; ")}`);
  });
});

describe("Noter library categories and tags", () => {
  it("creates categories, assigns multiple tags per sheet, filters with chips, renames, and deletes", async () => {
    const pageErrors = [];
    const consoleErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await open("/noter");

    const pdfBytes = Buffer.from("%PDF-1.4\n%fake-pdf");
    const fileInput = page.locator('input[type="file"][accept*="pdf"]');
    await fileInput.setInputFiles([
      { name: "Korpsmarsj.pdf", mimeType: "application/pdf", buffer: pdfBytes },
      { name: "Marimba Etude.pdf", mimeType: "application/pdf", buffer: pdfBytes },
    ]);

    await page.getByRole("button", { name: /^Korpsmarsj/i }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: /^Marimba Etude/i }).waitFor({ state: "visible" });

    // Assign tags to Korpsmarsj via the Tag picker modal
    await page.getByRole("button", { name: "Kategorier for Korpsmarsj", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "Korpsmarsj" });
    await picker.waitFor({ state: "visible" });
    await picker.getByRole("textbox", { name: "Ny kategori for dette stykket" }).fill("Korps");
    await picker.getByRole("button", { name: "Legg til", exact: true }).click();
    await picker.getByRole("button", { name: "Korps", exact: true }).waitFor({ state: "visible" });
    await picker.getByRole("textbox", { name: "Ny kategori for dette stykket" }).fill("17. mai");
    await picker.getByRole("button", { name: "Legg til", exact: true }).click();
    await picker.getByRole("button", { name: "17. mai", exact: true }).waitFor({ state: "visible" });
    await picker.getByRole("button", { name: "Ferdig", exact: true }).click();
    await picker.waitFor({ state: "detached" });

    // Filter by Korps chip
    const filterRegion = page.getByRole("region", { name: "Filtrer etter kategori" });
    await filterRegion.getByRole("button", { name: "Korps (1)", exact: true }).click();
    await page.getByRole("button", { name: /^Korpsmarsj/i }).waitFor({ state: "visible" });
    assert.equal(await page.getByRole("button", { name: /^Marimba Etude/i }).count(), 0);

    // Filter by Uten kategori chip
    await filterRegion.getByRole("button", { name: "Uten kategori (1)", exact: true }).click();
    await page.getByRole("button", { name: /^Marimba Etude/i }).waitFor({ state: "visible" });
    assert.equal(await page.getByRole("button", { name: /^Korpsmarsj/i }).count(), 0);

    // Rename category via inline manager
    await filterRegion.getByRole("button", { name: "Kategorier", exact: true }).click();
    const manager = page.getByRole("region", { name: "Administrer kategorier" });
    await manager.waitFor({ state: "visible" });
    await manager.getByRole("button", { name: "Gi nytt navn til kategori Korps", exact: true }).click();
    const renameInput = manager.getByRole("textbox", { name: "Nytt navn for Korps" });
    await renameInput.fill("Skolekorps");
    await manager.getByRole("button", { name: "Lagre kategorinavn", exact: true }).click();
    await filterRegion.getByRole("button", { name: "Skolekorps (1)", exact: true }).waitFor({ state: "visible" });

    // Delete category and verify sheets remain intact
    await manager.getByRole("button", { name: "Slett kategori Skolekorps", exact: true }).click();
    await filterRegion.getByRole("button", { name: "Alle (2)", exact: true }).click();
    await page.getByRole("button", { name: /^Korpsmarsj/i }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: /^Marimba Etude/i }).waitFor({ state: "visible" });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    assert.equal(overflow, false, "no horizontal overflow at 390x844");
    assert.deepEqual(pageErrors, [], `unexpected page errors: ${pageErrors.join("; ")}`);
    assert.deepEqual(consoleErrors, [], `unexpected console errors: ${consoleErrors.join("; ")}`);
  });
});

describe("offline precache", () => {
  it("serves offline-manifest.json and navigates all routes offline after initial load", async () => {
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await open("/");

    const manifestRes = await page.evaluate(async () => {
      const res = await fetch("/offline-manifest.json");
      if (!res.ok) return null;
      return res.json();
    });
    assert.ok(manifestRes && Array.isArray(manifestRes.assets), "offline-manifest.json exists");
    assert.ok(manifestRes.assets.some((a) => a.endsWith(".js")), "manifest lists JS bundles");
    assert.ok(manifestRes.assets.some((a) => a.endsWith(".css")), "manifest lists CSS bundles");
    assert.ok(
      manifestRes.assets.some((a) => a.startsWith("/malletsight/sample-") && a.endsWith(".mp3")),
      "manifest lists malletsight sample MP3s",
    );

    // Wait for service worker to become active and control this page
    await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return;
      await navigator.serviceWorker.ready;
    });
    await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller));

    // Go offline and navigate to tabs that were NOT visited while online
    await page.context().setOffline(true);
    try {
      for (const path of ["/noter", "/metronom", "/tuner", "/bladlesing", "/"]) {
        await tab(path);
      }
      const mp3Ok = await page.evaluate(async () => {
        const res = await fetch("/malletsight/sample-marimba-C4.mp3");
        return res.ok;
      });
      assert.equal(mp3Ok, true, "precached malletsight sample MP3 loads offline");
      assert.deepEqual(pageErrors, [], `unexpected offline page errors: ${pageErrors.join("; ")}`);
    } finally {
      await page.context().setOffline(false);
    }
  });
});

describe("Øveplan Repertoar linked to Noter and expanded stamps", () => {
  it("links a Noter sheet to Repertoar, opens it on Start, and shows arrow stamps", async () => {
    const pageErrors = [];

    await page.route("https://cdn.jsdelivr.net/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/javascript",
        headers: { "access-control-allow-origin": "*" },
        body: "",
      }),
    );
    await page.addInitScript(mockPdfJsLib);

    await open("/noter");
    const fileInput = page.locator('input[type="file"][accept*="pdf"]');
    await fileInput.setInputFiles({
      name: "Konsertmarsj.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n%fake-pdf"),
    });
    await page.getByRole("button", { name: /^Konsertmarsj/i }).waitFor({ state: "visible" });

    // Configure Øveplan with only the Repertoar block and link Konsertmarsj
    await open("/", plan(["rep"]));
    page.on("pageerror", (err) => pageErrors.push(err.message));

    const repSelect = page.getByLabel("Koblet noteark eller settliste", { exact: true });
    await repSelect.waitFor({ state: "visible" });
    const optionValue = await repSelect.locator("option", { hasText: "Konsertmarsj" }).getAttribute("value");
    assert.ok(optionValue && optionValue.startsWith("sheet:"), "Konsertmarsj option exists");
    await repSelect.selectOption(optionValue);

    // Start the Repertoar block -> navigates to /noter?sheet=... and opens Noteviser
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.waitForFunction(() => location.pathname === "/noter");
    assert.match(await header().innerText(), /Repertoar/);

    const viewer = page.locator('[role="dialog"][aria-label^="Noteviser:"]');
    await viewer.waitFor({ state: "visible" });
    await viewer.getByText("Side 1 / 3").waitFor({ state: "visible" });

    // Open Stempel tool and verify Piler group + Pil høyre stamp are available
    await viewer.getByRole("button", { name: "Stempel", exact: true }).click();
    await viewer.getByRole("button", { name: "Velg stempel", exact: true }).click();
    const stampPopover = viewer.getByRole("dialog", { name: "Velg musikalsk stempel" });
    await stampPopover.waitFor({ state: "visible" });
    await stampPopover.getByText(/^Piler$/i).waitFor({ state: "visible" });
    await stampPopover.getByRole("button", { name: "Pil høyre", exact: true }).click();
    await stampPopover.waitFor({ state: "detached" });

    assert.deepEqual(pageErrors, [], `unexpected page errors: ${pageErrors.join("; ")}`);
  });
});

describe("Lenovo tablet Pro suite", () => {
  it("persists Kun penn, supports To sider spread, S/M/L sizes + tap-to-edit text, edge-tap turns, PDF export, and v2 full backup", async () => {
    const pageErrors = [];
    const consoleErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.route("https://cdn.jsdelivr.net/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/javascript",
        headers: { "access-control-allow-origin": "*" },
        body: "",
      }),
    );
    await page.addInitScript(() => {
      // Mock pdfjsLib (3 pages)
      window.pdfjsLib = {
        GlobalWorkerOptions: { workerSrc: "" },
        getDocument() {
          return {
            promise: Promise.resolve({
              numPages: 3,
              getPage() {
                return Promise.resolve({
                  getViewport({ scale }) {
                    return {
                      width: Math.round(600 * scale),
                      height: Math.round(800 * scale),
                    };
                  },
                  render({ canvasContext, viewport }) {
                    canvasContext.fillStyle = "#ffffff";
                    canvasContext.fillRect(0, 0, viewport.width, viewport.height);
                    canvasContext.fillStyle = "#111827";
                    canvasContext.fillRect(
                      viewport.width * 0.2,
                      viewport.height * 0.2,
                      viewport.width * 0.6,
                      viewport.height * 0.6,
                    );
                    return { promise: Promise.resolve(), cancel() {} };
                  },
                });
              },
              destroy() {
                return Promise.resolve();
              },
            }),
          };
        },
      };
      // Mock PDFLib for annotated PDF export
      window.PDFLib = {
        StandardFonts: {
          Helvetica: "Helvetica",
          HelveticaBold: "HelveticaBold",
          TimesRomanBoldItalic: "TimesRomanBoldItalic",
        },
        rgb: (r, g, b) => ({ r, g, b }),
        PDFDocument: {
          load: async () => ({
            getPages: () => [
              {
                getSize: () => ({ width: 612, height: 792 }),
                drawLine: () => {},
                drawCircle: () => {},
                drawText: () => {},
              },
              {
                getSize: () => ({ width: 612, height: 792 }),
                drawLine: () => {},
                drawCircle: () => {},
                drawText: () => {},
              },
              {
                getSize: () => ({ width: 612, height: 792 }),
                drawLine: () => {},
                drawCircle: () => {},
                drawText: () => {},
              },
            ],
            embedFont: async () => ({ widthOfTextAtSize: (t, s) => t.length * s * 0.5 }),
            save: async () => new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]),
          }),
        },
      };
    });

    // Simulate Lenovo IdeaPad Pro 13" landscape tablet viewport
    await page.setViewportSize({ width: 1280, height: 800 });
    await open("/noter");

    const fileInput = page.locator('input[type="file"][accept*="pdf"]');
    await fileInput.setInputFiles({
      name: "Lenovo_Konsert.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n%fake-pdf"),
    });
    const sheetBtn = page.getByRole("button", { name: /^Lenovo Konsert/i });
    await sheetBtn.waitFor({ state: "visible" });
    await sheetBtn.click();

    const viewer = page.locator('[role="dialog"][aria-label^="Noteviser:"]');
    await viewer.waitFor({ state: "visible" });
    await viewer.getByText("Side 1 / 3").waitFor({ state: "visible" });

    // 1. Kun penn persistence
    const stylusBtn = viewer.getByRole("button", { name: "Kun penn", exact: true });
    await stylusBtn.click();
    assert.equal(await stylusBtn.getAttribute("aria-pressed"), "true");

    // 2. Stempel S/M/L size selector
    await viewer.getByRole("button", { name: "Stempel", exact: true }).click();
    await viewer.getByRole("button", { name: "Stempelstørrelse L", exact: true }).click();
    assert.equal(
      await viewer.getByRole("button", { name: "Stempelstørrelse L", exact: true }).getAttribute("aria-pressed"),
      "true",
    );

    // 3. Tekst S/M/L size selector + place text + tap-to-edit existing text
    await viewer.getByRole("button", { name: "Tekst", exact: true }).click();
    await viewer.getByRole("button", { name: "Tekststørrelse S", exact: true }).click();
    const layer = viewer.locator('[data-testid="annotation-layer-page-1"]');
    const box = await getSettledLayerBox(page, layer);

    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    const textInput = viewer.getByRole("textbox", { name: "Tekstnotat" });
    await textInput.waitFor({ state: "visible" });
    await textInput.fill("Subito p");
    await viewer.getByRole("button", { name: "Bekreft", exact: true }).click();
    await viewer.getByText("Subito p").waitFor({ state: "visible" });

    // Tap existing text to edit in place
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await textInput.waitFor({ state: "visible" });
    assert.equal(await textInput.inputValue(), "Subito p");
    await textInput.fill("Subito pp");
    await viewer.getByRole("button", { name: "Bekreft", exact: true }).click();
    await viewer.getByText("Subito pp").waitFor({ state: "visible" });

    // Stylus handwriting box: touchAction auto on input AND all ancestors, quick-expression chip, and tap-outside auto-commit
    await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.2);
    await textInput.waitFor({ state: "visible" });
    const blockedTouchActions = await textInput.evaluate((el) => {
      const blocked = [];
      let cur = el;
      while (cur) {
        const ta = getComputedStyle(cur).touchAction;
        if (ta === "none") blocked.push(cur.tagName);
        cur = cur.parentElement;
      }
      return blocked;
    });
    assert.deepEqual(
      blockedTouchActions,
      [],
      "no ancestor of Tekstnotat may have touch-action: none while open (blocks Android Direct Stylus Handwriting)",
    );
    await viewer.getByRole("button", { name: "rit.", exact: true }).click();
    assert.equal(await textInput.inputValue(), "rit.");
    await page.mouse.click(box.x + box.width * 0.9, box.y + box.height * 0.9);
    await textInput.waitFor({ state: "detached" });
    await viewer.getByText("rit.").waitFor({ state: "visible" });

    // Switch back to Vis mode
    await viewer.getByRole("button", { name: "Vis", exact: true }).click();

    // 4. Edge-tap page turn (tap right 18% -> page 2, tap left 18% -> page 1)
    const stageBox = await viewer.locator("div.relative.flex.min-h-0.flex-1").boundingBox();
    assert.ok(stageBox, "stage boundingBox exists");
    await page.mouse.click(stageBox.x + stageBox.width * 0.92, stageBox.y + stageBox.height * 0.5);
    await viewer.getByText("Side 2 / 3").waitFor({ state: "visible" });
    await page.mouse.click(stageBox.x + stageBox.width * 0.08, stageBox.y + stageBox.height * 0.5);
    await viewer.getByText("Side 1 / 3").waitFor({ state: "visible" });

    // 5. To sider (two-page spread) toggle & stepping
    const spreadBtn = viewer.getByRole("button", { name: /to-siders visning/i });
    await spreadBtn.click();
    assert.equal(await spreadBtn.getAttribute("aria-pressed"), "true");
    await viewer.getByText("Side 1–2 / 3").waitFor({ state: "visible" });
    assert.equal(await viewer.locator('svg[preserveAspectRatio="none"]').count(), 2);

    await viewer.getByRole("button", { name: "Neste side", exact: true }).click();
    await viewer.getByText("Side 3 / 3").waitFor({ state: "visible" });

    // 6. Eksporter PDF button triggers download without error
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      viewer.getByRole("button", { name: "Eksporter annotert PDF", exact: true }).click(),
    ]);
    assert.match(download.suggestedFilename(), /-annotert\.pdf$/);

    // Close viewer and reload to verify Kun penn + To sider persisted
    await viewer.getByRole("button", { name: "Lukk noteviser", exact: true }).click();
    await viewer.waitFor({ state: "detached" });

    await page.reload();
    await page.getByRole("button", { name: /^Lenovo Konsert/i }).click();
    await viewer.waitFor({ state: "visible" });
    assert.equal(
      await viewer.getByRole("button", { name: "Kun penn", exact: true }).getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(
      await viewer.getByRole("button", { name: /to-siders visning/i }).getAttribute("aria-pressed"),
      "true",
    );
    await viewer.getByRole("button", { name: "Lukk noteviser", exact: true }).click();
    await viewer.waitFor({ state: "detached" });

    // 7. Full backup (inkl. PDF-er) export
    await page.getByRole("button", { name: "Backup", exact: true }).click();
    const [backupDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Full backup (inkl. PDF-er)", exact: true }).click(),
    ]);
    assert.match(backupDownload.suggestedFilename(), /^noter-full-backup-.*\.json$/);
    await page.getByText(/Eksporterte full backup med 1 PDF-er/i).waitFor({ state: "visible" });

    assert.deepEqual(pageErrors, [], `unexpected page errors: ${pageErrors.join("; ")}`);
    assert.deepEqual(consoleErrors, [], `unexpected console errors: ${consoleErrors.join("; ")}`);
  });
});

describe("Tablet 16:10 GUX & GUI suite", () => {
  it("renders landscape left nav rail without overflow, supports Metronom Tap Tempo & +/-5, Tuner calibration/transposition/drone, and Noter Øveplan start", async () => {
    const pageErrors = [];
    const consoleErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    // 0. Portrait 800x1280 keeps nav bar at bottom
    await page.setViewportSize({ width: 800, height: 1280 });
    await open("/");
    const portraitNavBox = await page.locator('nav[aria-label="Verktøy"]').boundingBox();
    assert.ok(
      portraitNavBox && portraitNavBox.y > 1000 && portraitNavBox.width >= 700,
      "nav stays at the bottom in 800x1280 portrait",
    );

    await page.setViewportSize({ width: 1280, height: 800 });
    await open("/");

    // 1. Landscape left nav rail & zero horizontal overflow across all 5 routes
    const navBox = await page.locator('nav[aria-label="Verktøy"]').boundingBox();
    assert.ok(navBox && navBox.width <= 100 && navBox.height > 400, "nav renders as a left rail in 1280x800 landscape");
    for (const path of ["/", "/metronom", "/bladlesing", "/tuner", "/noter"]) {
      await tab(path);
      const overflow = await page.evaluate(() =>
        [document.documentElement, document.querySelector("main")].map((el) => el.scrollWidth - el.clientWidth),
      );
      assert.deepEqual(overflow, [0, 0], `${path} has no horizontal overflow at 1280x800`);
    }

    // 2. Metronom +/-5 & Tap tempo
    await tab("/metronom");
    await page.getByRole("button", { name: "Øk tempo 5", exact: true }).click();
    assert.equal((await page.locator(".metro-hero p").first().textContent())?.trim(), "85");
    await page.getByRole("button", { name: "Senk tempo 5", exact: true }).click();
    assert.equal((await page.locator(".metro-hero p").first().textContent())?.trim(), "80");
    const tapBtn = page.getByRole("button", { name: "Tap tempo", exact: true });
    await tapBtn.click();
    await page.waitForTimeout(500);
    await tapBtn.click();
    const bpmText = await page.locator(".metro-hero p").first().textContent();
    const tappedBpm = Number(bpmText?.trim());
    assert.ok(tappedBpm >= 90 && tappedBpm <= 160, `Tap tempo updated BPM (${tappedBpm})`);

    // 3. Tuner A4 calibration (442 default -> 440), transposition, and chromatic drone pad
    await tab("/tuner");
    assert.equal((await page.locator("[data-tuner-a4]").textContent())?.trim(), "442 Hz");
    await page.getByRole("button", { name: "440", exact: true }).click();
    assert.equal((await page.locator("[data-tuner-a4]").textContent())?.trim(), "440 Hz");
    await page.getByRole("button", { name: "442", exact: true }).click();
    assert.equal((await page.locator("[data-tuner-a4]").textContent())?.trim(), "442 Hz");

    const transGroup = page.getByRole("group", { name: "Transponering" });
    await transGroup.getByRole("button", { name: "B", exact: true }).click();
    assert.equal(await transGroup.getByRole("button", { name: "B", exact: true }).getAttribute("aria-pressed"), "true");

    const droneA4 = page.locator('[data-drone-note="A4"]');
    await droneA4.click();
    assert.equal(await droneA4.getAttribute("aria-pressed"), "true");
    const stopDroneBtn = page.getByRole("button", { name: "Stopp lyd", exact: true });
    await stopDroneBtn.waitFor({ state: "visible" });
    assert.equal(await liveContexts(), 1, "Tuner drone reuses the shared AudioContext");
    await stopDroneBtn.click();
    await stopDroneBtn.waitFor({ state: "detached" });

    // 4. Start & pause Øveplan directly from Noter tab
    await tab("/noter");
    await page.getByRole("button", { name: "Start øveplan", exact: true }).click();
    const timerBtn = page.locator("header button").filter({ hasText: /\d+:\d\d/ });
    await timerBtn.waitFor({ state: "visible" });
    await timerBtn.click();
    assert.equal(await timerBtn.getAttribute("aria-pressed"), "true");

    assert.deepEqual(pageErrors, [], `unexpected page errors: ${pageErrors.join("; ")}`);
    assert.deepEqual(consoleErrors, [], `unexpected console errors: ${consoleErrors.join("; ")}`);
  });
});

