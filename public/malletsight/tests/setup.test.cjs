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
