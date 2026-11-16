import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OFFLINE_MANIFEST_FILENAME,
  buildOfflineManifest,
  collectMalletsightAudioAssets,
  collectPrecacheAssets,
  offlinePrecachePlugin,
} from "./offline-precache-plugin.mjs";

describe("offline-precache-plugin", () => {
  it("collects client js, mjs, and css assets while ignoring sourcemaps and other files", () => {
    const bundle = {
      "assets/main-abc.js": {},
      "assets/noter-def.mjs": {},
      "assets/styles-123.css": {},
      "assets/main-abc.js.map": {},
      "favicon.svg": {},
    };
    assert.deepEqual(collectPrecacheAssets(bundle), [
      "/assets/main-abc.js",
      "/assets/noter-def.mjs",
      "/assets/styles-123.css",
    ]);
  });

  it("collects malletsight sample mp3 files", () => {
    const mp3s = collectMalletsightAudioAssets();
    assert.ok(mp3s.length > 0, "finds malletsight sample mp3 files");
    assert.ok(mp3s.every((p) => p.startsWith("/malletsight/sample-") && p.endsWith(".mp3")));
  });

  it("builds a deterministic manifest with version hash", () => {
    const a = buildOfflineManifest(["/assets/b.js", "/assets/a.js", "/assets/a.js"]);
    const b = buildOfflineManifest(["/assets/a.js", "/assets/b.js"]);
    assert.deepEqual(a.assets, ["/assets/a.js", "/assets/b.js"]);
    assert.equal(a.version, b.version);
    assert.equal(a.version.length, 12);
  });

  it("emits offline-manifest.json only for the client environment", () => {
    const plugin = offlinePrecachePlugin({ malletsightDir: "/nonexistent-dir" });
    const emitted = [];
    const clientCtx = {
      environment: { name: "client" },
      emitFile(file) {
        emitted.push(file);
      },
    };
    const ssrCtx = {
      environment: { name: "ssr" },
      emitFile(file) {
        emitted.push(file);
      },
    };

    plugin.generateBundle.call(ssrCtx, {}, { "assets/server.js": {} });
    assert.equal(emitted.length, 0);

    plugin.generateBundle.call(clientCtx, {}, {
      "assets/main.js": {},
      "assets/app.css": {},
    });
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].fileName, OFFLINE_MANIFEST_FILENAME);
    const parsed = JSON.parse(emitted[0].source);
    assert.deepEqual(parsed.assets, ["/assets/app.css", "/assets/main.js"]);
  });
});
