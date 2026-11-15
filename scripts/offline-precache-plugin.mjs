import { createHash } from "node:crypto";

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

export function buildOfflineManifest(assets) {
  const unique = [...new Set(assets)].sort();
  const version = createHash("sha256")
    .update(unique.join("\n"))
    .digest("hex")
    .slice(0, 12);
  return { version, assets: unique };
}

export function offlinePrecachePlugin() {
  return {
    name: "musikkapp:offline-precache",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      if (this.environment && this.environment.name !== "client") {
        return;
      }
      const assets = collectPrecacheAssets(bundle);
      if (assets.length === 0) {
        return;
      }
      const manifest = buildOfflineManifest(assets);
      this.emitFile({
        type: "asset",
        fileName: OFFLINE_MANIFEST_FILENAME,
        source: JSON.stringify(manifest, null, 2),
      });
    },
  };
}
