const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { load, settings } = require("./helpers.cjs");

test("static deployment keeps its publish root and has no build command", () => {
  const config = fs.readFileSync("netlify.toml", "utf8");
  assert.match(config, /command = ""/);
  assert.match(config, /publish = "\."/);
  assert.equal(require("../package.json").scripts.build, undefined);
});

test("browser globals load and generate a deterministic score without a build", () => {
  const a = load(1).Generator.generate(settings());
  const b = load(1).Generator.generate(settings());
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(a.measures.length, 8);
});

test("AudioEngine exposes loadInstrument and all playback methods expected by app.js", () => {
  const vm = require("node:vm");
  const ctx = vm.createContext({
    MusikkPulse: {
      audio: () => null,
      output: () => ({}),
      start: () => {},
      stop: () => {},
      setClicks: () => {},
    },
  });
  ctx.window = ctx;
  vm.runInContext(fs.readFileSync("audio.js", "utf8"), ctx, { filename: "audio.js" });
  assert.equal(typeof ctx.AudioEngine.loadInstrument, "function");
  assert.equal(typeof ctx.AudioEngine.playScore, "function");
  assert.equal(typeof ctx.AudioEngine.playAlong, "function");
});

test("markup.html defines #clefRow and settings drawer isolates it for trumpet profile", () => {
  const markup = fs.readFileSync("markup.html", "utf8");
  assert.match(markup, /id=["']clefRow["']/);
  const appJs = fs.readFileSync("app.js", "utf8");
  assert.match(appJs, /clefRow/);
  assert.match(appJs, /clefRow\.hidden\s*=\s*isTrumpet/);
});

