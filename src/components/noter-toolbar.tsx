import {
  ChevronDown,
  Eraser,
  Eye,
  EyeOff,
  Hand,
  Highlighter,
  Link2,
  PenTool,
  Pencil,
  Redo2,
  Stamp,
  Type,
  Undo2,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  ANNOTATION_COLORS,
  HIGHLIGHTER_COLORS,
  STAMP_DEFINITIONS,
  type StampDefinition,
  type StampId,
} from "@/lib/noter-annotations";
import {
  StampSvgContent,
  type AnnotationTool,
  type PencilThickness,
} from "@/components/noter-annotation-layer";

export type NoterToolbarProps = {
  tool: AnnotationTool;
  onSelectTool: (tool: AnnotationTool) => void;
  pencilColor: string;
  onSelectPencilColor: (color: string) => void;
  pencilThickness: PencilThickness;
  onSelectPencilThickness: (thickness: PencilThickness) => void;
  highlighterColor: string;
  onSelectHighlighterColor: (color: string) => void;
  activeStampId: StampId;
  onSelectStampId: (stampId: StampId) => void;
  stylusOnly: boolean;
  onToggleStylusOnly: () => void;
  annotationsVisible: boolean;
  onToggleAnnotationsVisible: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
};

type ToolOption = {
  id: AnnotationTool;
  label: string;
  icon: typeof Hand;
};

const TOOL_OPTIONS: readonly ToolOption[] = [
  { id: "view", label: "Vis", icon: Hand },
  { id: "pencil", label: "Blyant", icon: Pencil },
  { id: "highlighter", label: "Tusj", icon: Highlighter },
  { id: "eraser", label: "Viskelær", icon: Eraser },
  { id: "stamp", label: "Stempel", icon: Stamp },
  { id: "text", label: "Tekst", icon: Type },
  { id: "link", label: "Lenke", icon: Link2 },
];

const STAMP_GROUPS: ReadonlyArray<{
  category: StampDefinition["category"];
  title: string;
}> = [
  { category: "symbol", title: "Symboler" },
  { category: "arrow", title: "Piler" },
  { category: "dynamic", title: "Dynamikk" },
  { category: "fingering", title: "Fingersetting" },
];

const COLOR_LABELS: Record<string, string> = {
  "#111827": "Svart",
  "#dc2626": "Rød",
  "#2563eb": "Blå",
  "#16a34a": "Grønn",
  "#d97706": "Oransje",
  "#9333ea": "Lilla",
  "#facc15": "Gul",
  "#4ade80": "Lysegrønn",
  "#60a5fa": "Lyseblå",
  "#f472b6": "Rosa",
};

export function NoterToolbar({
  tool,
  onSelectTool,
  pencilColor,
  onSelectPencilColor,
  pencilThickness,
  onSelectPencilThickness,
  highlighterColor,
  onSelectHighlighterColor,
  activeStampId,
  onSelectStampId,
  stylusOnly,
  onToggleStylusOnly,
  annotationsVisible,
  onToggleAnnotationsVisible,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: NoterToolbarProps) {
  const [stampPickerOpen, setStampPickerOpen] = useState(false);

  useEffect(() => {
    if (tool !== "stamp") {
      setStampPickerOpen(false);
    }
  }, [tool]);

  const activeStampDef =
    STAMP_DEFINITIONS.find((item) => item.id === activeStampId) ?? STAMP_DEFINITIONS[0]!;

  const showColorSubBar =
    tool === "pencil" || tool === "highlighter" || tool === "stamp" || tool === "text";

  return (
    <div
      role="toolbar"
      aria-label="Annoteringsverktøy"
      style={{ backgroundColor: "rgba(22, 26, 34, 0.95)" }}
      className="relative z-20 flex shrink-0 flex-col gap-2 border-b border-line px-3 py-2"
    >
      {/* Primary row: tools + undo/redo + visibility + stylus-only */}
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex flex-wrap items-center gap-1">
          {TOOL_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const active = tool === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => onSelectTool(opt.id)}
                aria-pressed={active}
                style={active ? { backgroundColor: "rgba(224, 177, 90, 0.15)" } : undefined}
                className={
                  active
                    ? "metro-press flex min-h-10 items-center gap-1.5 rounded-lg border border-accent px-2.5 text-xs font-semibold text-accent"
                    : "metro-press flex min-h-10 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-xs font-medium text-muted hover:text-fg"
                }
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            aria-label="Angre"
            title="Angre"
            className="metro-press flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-line bg-surface px-2 text-xs font-medium text-fg disabled:opacity-40"
          >
            <Undo2 className="size-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            aria-label="Gjør om"
            title="Gjør om"
            className="metro-press flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-line bg-surface px-2 text-xs font-medium text-fg disabled:opacity-40"
          >
            <Redo2 className="size-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={onToggleAnnotationsVisible}
            aria-pressed={annotationsVisible}
            aria-label={annotationsVisible ? "Skjul annoteringer" : "Vis annoteringer"}
            title={annotationsVisible ? "Skjul annoteringer" : "Vis annoteringer"}
            style={
              annotationsVisible
                ? { backgroundColor: "rgba(224, 177, 90, 0.12)" }
                : undefined
            }
            className={
              annotationsVisible
                ? "metro-press flex min-h-10 items-center gap-1.5 rounded-lg border border-accent px-2.5 text-xs font-semibold text-accent"
                : "metro-press flex min-h-10 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-xs font-medium text-muted hover:text-fg"
            }
          >
            {annotationsVisible ? (
              <Eye className="size-4 shrink-0" aria-hidden="true" />
            ) : (
              <EyeOff className="size-4 shrink-0" aria-hidden="true" />
            )}
            <span className="hidden md:inline">
              {annotationsVisible ? "Skjul annoteringer" : "Vis annoteringer"}
            </span>
          </button>

          <button
            type="button"
            onClick={onToggleStylusOnly}
            aria-pressed={stylusOnly}
            aria-label="Kun penn"
            title="Kun penn (ignorer fingerberøring)"
            style={stylusOnly ? { backgroundColor: "rgba(224, 177, 90, 0.15)" } : undefined}
            className={
              stylusOnly
                ? "metro-press flex min-h-10 items-center gap-1.5 rounded-lg border border-accent px-2.5 text-xs font-semibold text-accent"
                : "metro-press flex min-h-10 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-xs font-medium text-muted hover:text-fg"
            }
          >
            <PenTool className="size-4 shrink-0" aria-hidden="true" />
            <span>Kun penn</span>
          </button>
        </div>
      </div>

      {/* Contextual sub-controls */}
      {showColorSubBar ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
          {tool === "pencil" ? (
            <div className="flex items-center gap-1 rounded-lg border border-line bg-header p-0.5">
              <button
                type="button"
                onClick={() => onSelectPencilThickness("thin")}
                aria-pressed={pencilThickness === "thin"}
                style={
                  pencilThickness === "thin"
                    ? { backgroundColor: "rgba(224, 177, 90, 0.15)" }
                    : undefined
                }
                className={
                  pencilThickness === "thin"
                    ? "metro-press min-h-9 rounded-md px-2.5 text-xs font-semibold text-accent"
                    : "metro-press min-h-9 rounded-md px-2.5 text-xs font-medium text-muted hover:text-fg"
                }
              >
                Tynn
              </button>
              <button
                type="button"
                onClick={() => onSelectPencilThickness("thick")}
                aria-pressed={pencilThickness === "thick"}
                style={
                  pencilThickness === "thick"
                    ? { backgroundColor: "rgba(224, 177, 90, 0.15)" }
                    : undefined
                }
                className={
                  pencilThickness === "thick"
                    ? "metro-press min-h-9 rounded-md px-2.5 text-xs font-semibold text-accent"
                    : "metro-press min-h-9 rounded-md px-2.5 text-xs font-medium text-muted hover:text-fg"
                }
              >
                Tykk
              </button>
            </div>
          ) : null}

          {tool === "highlighter" ? (
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Tusjfarge">
              {HIGHLIGHTER_COLORS.map((hex) => {
                const selected = highlighterColor === hex;
                const label = COLOR_LABELS[hex] ?? hex;
                return (
                  <button
                    key={hex}
                    type="button"
                    onClick={() => onSelectHighlighterColor(hex)}
                    aria-pressed={selected}
                    aria-label={`Tusjfarge ${label}`}
                    className={
                      selected
                        ? "metro-press flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-accent bg-surface"
                        : "metro-press flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-transparent hover:border-line"
                    }
                  >
                    <span
                      aria-hidden="true"
                      style={{ backgroundColor: hex, opacity: 0.75 }}
                      className="size-6 rounded-full border border-line"
                    />
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Farge">
              {ANNOTATION_COLORS.map((hex) => {
                const selected = pencilColor === hex;
                const label = COLOR_LABELS[hex] ?? hex;
                return (
                  <button
                    key={hex}
                    type="button"
                    onClick={() => onSelectPencilColor(hex)}
                    aria-pressed={selected}
                    aria-label={`Farge ${label}`}
                    className={
                      selected
                        ? "metro-press flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-accent bg-surface"
                        : "metro-press flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-transparent hover:border-line"
                    }
                  >
                    <span
                      aria-hidden="true"
                      style={{ backgroundColor: hex, borderColor: "rgba(255, 255, 255, 0.25)" }}
                      className="size-6 rounded-full border"
                    />
                  </button>
                );
              })}
            </div>
          )}

          {tool === "stamp" ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => setStampPickerOpen((prev) => !prev)}
                aria-expanded={stampPickerOpen}
                aria-label="Velg stempel"
                className="metro-press flex min-h-10 items-center gap-2 rounded-lg border border-line bg-surface px-2.5 text-xs font-semibold text-fg hover:border-accent"
              >
                <svg
                  viewBox="-20 -20 40 40"
                  aria-hidden="true"
                  className="size-5 shrink-0"
                >
                  <StampSvgContent stampId={activeStampId} color="currentColor" />
                </svg>
                <span>{activeStampDef.label}</span>
                <ChevronDown className="size-3.5 text-muted" aria-hidden="true" />
              </button>

              {stampPickerOpen ? (
                <div
                  role="dialog"
                  aria-label="Velg musikalsk stempel"
                  style={{ backgroundColor: "rgba(22, 26, 34, 0.98)" }}
                  className="absolute left-0 top-full z-30 mt-1.5 max-h-[60vh] w-72 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-xl border border-line p-3 shadow-2xl"
                >
                  <div className="flex flex-col gap-3">
                    {STAMP_GROUPS.map((group) => {
                      const defs = STAMP_DEFINITIONS.filter(
                        (def) => def.category === group.category,
                      );
                      return (
                        <div key={group.category} className="flex flex-col gap-1.5">
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                            {group.title}
                          </span>
                          <div className="flex flex-wrap gap-1.5">
                            {defs.map((def) => {
                              const selected = activeStampId === def.id;
                              return (
                                <button
                                  key={def.id}
                                  type="button"
                                  onClick={() => {
                                    onSelectStampId(def.id);
                                    setStampPickerOpen(false);
                                  }}
                                  aria-pressed={selected}
                                  aria-label={def.label}
                                  title={def.label}
                                  style={
                                    selected
                                      ? { backgroundColor: "rgba(224, 177, 90, 0.18)" }
                                      : undefined
                                  }
                                  className={
                                    selected
                                      ? "metro-press flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-accent text-accent"
                                      : "metro-press flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-line bg-surface text-fg hover:border-accent"
                                  }
                                >
                                  <svg
                                    viewBox="-20 -20 40 40"
                                    aria-hidden="true"
                                    className="size-6"
                                  >
                                    <StampSvgContent
                                      stampId={def.id}
                                      color="currentColor"
                                    />
                                  </svg>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
