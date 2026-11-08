export const TOOLS = [
  {
    id: "bladlesing",
    label: "Bladlesing",
    to: "/",
    body: "Bladlesing for malletinstrumenter. Noter, nivåer og avspilling kommer her.",
  },
  {
    id: "metronom",
    label: "Metronom",
    to: "/metronom",
    body: "Progressiv metronom og rudimenter. Tempo, sticking og beste-tider kommer her.",
  },
  {
    id: "oveplan",
    label: "Øveplan",
    to: "/oveplan",
    body: "Øveplan for xylo og mallets. Økter, tidtaking og lagrede planer kommer her.",
  },
  {
    id: "notekort",
    label: "Notekort",
    to: "/notekort",
    body: "Notekort for nøkler og register. Kort, utvalg og treff kommer her.",
  },
] as const;

export type ToolId = (typeof TOOLS)[number]["id"];

export function toolNamespace(id: ToolId) {
  return `musikkapp.${id}`;
}

export function readToolStore(id: ToolId): Record<string, unknown> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(toolNamespace(id));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function writeToolStore(id: ToolId, value: Record<string, unknown>) {
  localStorage.setItem(toolNamespace(id), JSON.stringify(value));
}

/** Ensures each tool has its own key, without touching existing data. */
export function ensureToolNamespaces() {
  if (typeof window === "undefined") return;
  for (const tool of TOOLS) {
    if (localStorage.getItem(toolNamespace(tool.id)) == null) {
      writeToolStore(tool.id, {});
    }
  }
}
