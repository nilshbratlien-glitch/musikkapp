const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const defaults = vm.runInNewContext("(" + app.match(/const DEFAULTS = (\{[\s\S]*?\n  \});/)[1] + ")");
const levels = vm.runInNewContext("(" + app.match(/const LEVELS = (\[[\s\S]*?\n  \]);/)[1] + ")");

function load(seed = 1) {
  const math = Object.create(Math);
  math.random = () => {
    let n = seed += 0x6D2B79F5;
    n = Math.imul(n ^ n >>> 15, n | 1);
    n ^= n + Math.imul(n ^ n >>> 7, n | 61);
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  };
  const context = vm.createContext({ Math: math });
  context.window = context;
  for (const file of ["theory.js", "generator.js", "renderer.js"]) {
    vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename: file });
  }
  return context;
}

function settings(overrides = {}) {
  return { ...defaults, ...overrides };
}

module.exports = { load, settings, levels };
