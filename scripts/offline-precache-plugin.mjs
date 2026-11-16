import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";

export const OFFLINE_MANIFEST_FILENAME = "offline-manifest.json";

export function collectPrecacheAssets(bundle) {
  const assets = [];
  for (const fileName of Object.keys(bundle)) {
    if (fileName.endsWith(".map")) continue;
    if (
      fileName.endsWith(".js") ||
      fileName.endsWith(".mjs") ||
      fileName.endsWith(".css")
    ) {
      const normalized = `/${fileName.replace(/^\/+/, "")}`;
      assets.push(normalized);
    }
  }
  assets.sort();
  return assets;
}

export function collectMalletsightAudioAssets(
  dir = join(process.cwd(), "public", "malletsight"),
) {
  try {
    return readdirSync(dir)
      .filter((name) => name.startsWith("sample-") && name.endsWith(".mp3"))
      .sort()
      .map((name) => `/malletsight/${name}`);
  } catch {
    return [];
  }
}

export function buildOfflineManifest(assets) {
  const unique = [...new Set(assets)].sort();
  const version = createHash("sha256")
    .update(unique.join("\n"))
    .digest("hex")
    .slice(0, 12);
  return { version, assets: unique };
}

export function offlinePrecachePlugin(options = {}) {
  return {
    name: "musikkapp:offline-precache",
    apply: "build",
    enforce: "post",
    generateBundle(_outputOptions, bundle) {
      if (this.environment && this.environment.name !== "client") {
        return;
      }
      const bundleAssets = collectPrecacheAssets(bundle);
      if (bundleAssets.length === 0) {
        return;
      }
      const audioAssets = collectMalletsightAudioAssets(options.malletsightDir);
      const manifest = buildOfflineManifest([...bundleAssets, ...audioAssets]);
      this.emitFile({
        type: "asset",
        fileName: OFFLINE_MANIFEST_FILENAME,
        source: JSON.stringify(manifest, null, 2),
      });
    },
  };
}
