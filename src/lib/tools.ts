import { getProfile, type InstrumentProfile } from "./profile.ts";

export const TOOLS = [
  {
    id: "bladlesing",
    label: "Bladlesing",
    to: "/",
    body: "Bladlesing for køller og trompet. Noter, nivåer og avspilling kommer her.",
  },
  {
    id: "metronom",
    label: "Metronom",
    to: "/metronom",
    body: "Progressiv metronom og teknikk. Tempo, underdeling og beste-tider kommer her.",
  },
  {
    id: "oveplan",
    label: "Øveplan",
    to: "/oveplan",
    body: "Øveplan for køller og trompet. Økter, tidtaking og lagrede planer kommer her.",
  },
  {
    id: "notekort",
    label: "Notekort",
    to: "/notekort",
    body: "Notekort for nøkler, register og ventilgrep. Kort, utvalg og treff kommer her.",
  },
] as const;

export type ToolId = (typeof TOOLS)[number]["id"];

export function toolNamespace(id: ToolId, profile: InstrumentProfile = getProfile()) {
  return profile === "trumpet" ? `musikkapp.trumpet.${id}` : `musikkapp.${id}`;
}

export function toolForPath(pathname: string) {
  return TOOLS.find((tool) => tool.to === pathname) ?? TOOLS[0];
}

function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readToolStore(id: ToolId, profile: InstrumentProfile = getProfile()): Record<string, unknown> {
  const storage = browserStorage();
  if (!storage) return {};
  try {
    const raw = storage.getItem(toolNamespace(id, profile));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function writeToolStore(
  id: ToolId,
  value: Record<string, unknown>,
  profile: InstrumentProfile = getProfile(),
): boolean {
  const storage = browserStorage();
  if (!storage) return false;
  try {
    storage.setItem(toolNamespace(id, profile), JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function ensureToolNamespaces() {
  const storage = browserStorage();
  if (!storage) return;
  for (const tool of TOOLS) {
    if (storage.getItem(toolNamespace(tool.id)) == null) {
      writeToolStore(tool.id, {});
    }
  }
}
