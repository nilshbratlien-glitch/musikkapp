// The built CSS has to work in Safari 15.6 (iPadOS 15.8): see e2e/safari15.mjs. Run after `npm run build`.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { asSafari15, safari15Problems } from "./safari15.mjs";

const ASSETS = ".vercel/output/static/assets";
const sheets = () => [
  ...readdirSync(ASSETS)
    .filter((f) => f.endsWith(".css"))
    .map((f) => join(ASSETS, f)),
  "public/malletsight/app.css",
];

describe("built CSS for Safari 15.6", () => {
  it("every color-mix() is guarded and has a fallback that keeps its transparency, and no media range syntax", () => {
    const problems = sheets().flatMap((file) => safari15Problems(readFileSync(file, "utf8"), file));
    assert.deepEqual(problems, []);
  });

  it("the block colours' rgb channels match their hex tokens", () => {
    const css = readFileSync("src/styles.css", "utf8");
    for (const name of ["twomallet", "fourmallet", "accent", "rep"]) {
      const hex = css.match(new RegExp(`--color-${name}:\\s*#([0-9a-f]{6})`, "i"))?.[1];
      const rgb = css.match(new RegExp(`--color-${name}-rgb:\\s*([\\d ]+);`))?.[1];
      assert.ok(hex && rgb, `--color-${name} and --color-${name}-rgb are defined`);
      assert.equal(rgb, [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(" "), name);
    }
  });

  it("the Safari 15.6 simulation removes what Safari 15.6 lacks", () => {
    const css = '.a{background:#0000}@supports (color:color-mix(in lab, red, red)){.a{background:color-mix(in srgb,red 10%,transparent)}}@property --x{syntax:"*";inherits:false}.b{color:color-mix(in srgb,var(--y) 5%,red)}';
    assert.equal(asSafari15(css), ".a{background:#0000}.b{color:unset}");
  });
});
