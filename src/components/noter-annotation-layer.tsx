import { useEffect, useRef, useState } from "react";
import {
  ANNOTATION_VIEWBOX_SIZE,
  HIGHLIGHTER_OPACITY,
  HIGHLIGHTER_WIDTH,
  clientPointToNormalizedPage,
  getAnnotationSvgViewBox,
  hitTestAnnotation,
  type AnnotationItem,
  type AnnotationPoint,
  type StampId,
  type StrokeAnnotation,
} from "@/lib/noter-annotations";
import { normalizeCropRect, type NormalizedRect } from "@/lib/noter-crop";

export type AnnotationTool = "view" | "pencil" | "highlighter" | "eraser" | "stamp" | "text";
export type PencilThickness = "thin" | "thick";

export type NoterAnnotationLayerProps = {
  pageNumber: number;
  items: readonly AnnotationItem[];
  visible: boolean;
  region: NormalizedRect;
  width: number;
  height: number;
  tool: AnnotationTool;
  pencilColor: string;
  pencilWidth: number;
  highlighterColor: string;
  activeStampId: StampId;
  stylusOnly: boolean;
  onCommitItems: (pageNumber: number, nextItems: AnnotationItem[]) => void;
};

type TextDraft = {
  x: number;
  y: number;
  value: string;
};

const PALM_REJECTION_WINDOW_MS = 800;
const MIN_POINT_DISTANCE = 0.0015;

function createAnnotationId(): string {
  if (typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `ann-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function pointsToSvgPath(points: readonly AnnotationPoint[]): string {
  if (points.length === 0) return "";
  const parts: string[] = [];
  for (let i = 0; i < points.length; i++) {
    const pt = points[i]!;
    const x = Math.round(pt.x * ANNOTATION_VIEWBOX_SIZE * 100) / 100;
    const y = Math.round(pt.y * ANNOTATION_VIEWBOX_SIZE * 100) / 100;
    parts.push(i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`);
  }
  return parts.join(" ");
}

export function StampSvgContent({ stampId, color }: { stampId: StampId; color: string }) {
  switch (stampId) {
    case "fermata":
      return (
        <>
          <path
            d="M -13 4 A 13 13 0 0 1 13 4"
            fill="none"
            stroke={color}
            strokeWidth={2.6}
            strokeLinecap="round"
          />
          <circle cx={0} cy={2} r={2.4} fill={color} />
        </>
      );
    case "breath":
      return (
        <path
          d="M -2 -8 Q 4 -3 2 4 Q 1 9 -3 11"
          fill="none"
          stroke={color}
          strokeWidth={2.8}
          strokeLinecap="round"
        />
      );
    case "glasses":
      return (
        <>
          <circle cx={-7.5} cy={0} r={5} fill="none" stroke={color} strokeWidth={2.2} />
          <circle cx={7.5} cy={0} r={5} fill="none" stroke={color} strokeWidth={2.2} />
          <path
            d="M -2.5 0 Q 0 -3 2.5 0"
            fill="none"
            stroke={color}
            strokeWidth={2.2}
            strokeLinecap="round"
          />
          <path
            d="M -12.5 0 L -15 -3"
            fill="none"
            stroke={color}
            strokeWidth={2.2}
            strokeLinecap="round"
          />
          <path
            d="M 12.5 0 L 15 -3"
            fill="none"
            stroke={color}
            strokeWidth={2.2}
            strokeLinecap="round"
          />
        </>
      );
    case "pp":
    case "p":
    case "mp":
    case "mf":
    case "f":
    case "ff":
      return (
        <text
          x={0}
          y={0}
          textAnchor="middle"
          dominantBaseline="central"
          fill={color}
          fontSize={22}
          fontWeight="700"
          fontStyle="italic"
          fontFamily="Georgia, 'Times New Roman', serif"
        >
          {stampId}
        </text>
      );
    default:
      return (
        <text
          x={0}
          y={0}
          textAnchor="middle"
          dominantBaseline="central"
          fill={color}
          fontSize={20}
          fontWeight="700"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
        >
          {stampId}
        </text>
      );
  }
}

function renderAnnotationItem(item: AnnotationItem) {
  switch (item.kind) {
    case "pencil":
    case "highlighter": {
      if (item.points.length === 0) return null;
      if (item.points.length === 1) {
        const p0 = item.points[0]!;
        return (
          <circle
            key={item.id}
            cx={p0.x * ANNOTATION_VIEWBOX_SIZE}
            cy={p0.y * ANNOTATION_VIEWBOX_SIZE}
            r={item.width / 2}
            fill={item.color}
            fillOpacity={item.opacity}
          />
        );
      }
      return (
        <path
          key={item.id}
          d={pointsToSvgPath(item.points)}
          fill="none"
          stroke={item.color}
          strokeWidth={item.width}
          strokeOpacity={item.opacity}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    }

    case "stamp": {
      const scale = item.scale ?? 1;
      return (
        <g
          key={item.id}
          transform={`translate(${item.x * ANNOTATION_VIEWBOX_SIZE} ${item.y * ANNOTATION_VIEWBOX_SIZE}) scale(${scale})`}
        >
          <StampSvgContent stampId={item.stampId} color={item.color} />
        </g>
      );
    }

    case "text":
      return (
        <text
          key={item.id}
          x={item.x * ANNOTATION_VIEWBOX_SIZE}
          y={item.y * ANNOTATION_VIEWBOX_SIZE}
          fill={item.color}
          fontSize={item.fontSize ?? 18}
          fontWeight="600"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
          dominantBaseline="central"
        >
          {item.text}
        </text>
      );
  }
}

export function NoterAnnotationLayer({
  pageNumber,
  items,
  visible,
  region,
  width,
  height,
  tool,
  pencilColor,
  pencilWidth,
  highlighterColor,
  activeStampId,
  stylusOnly,
  onCommitItems,
}: NoterAnnotationLayerProps) {
  const [draftStroke, setDraftStroke] = useState<StrokeAnnotation | null>(null);
  const [erasedIds, setErasedIds] = useState<Set<string>>(() => new Set());
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);

  const activePointerIdRef = useRef<number | null>(null);
  const lastPenTimeRef = useRef<number>(0);
  const draftStrokeRef = useRef<StrokeAnnotation | null>(null);
  const erasedIdsRef = useRef<Set<string>>(new Set());
  const beforeEraseSnapshotRef = useRef<readonly AnnotationItem[] | null>(null);

  useEffect(() => {
    activePointerIdRef.current = null;
    draftStrokeRef.current = null;
    setDraftStroke(null);
    erasedIdsRef.current = new Set();
    setErasedIds(new Set());
    beforeEraseSnapshotRef.current = null;
  }, [pageNumber, tool]);

  useEffect(() => {
    if (tool !== "text") {
      setTextDraft(null);
    }
  }, [tool]);

  useEffect(() => {
    setTextDraft(null);
  }, [pageNumber]);

  const normRegion = normalizeCropRect(region);
  const viewBox = getAnnotationSvgViewBox(normRegion);

  if (tool === "view") {
    if (!visible) return null;
    return (
      <svg
        aria-hidden="true"
        viewBox={viewBox}
        preserveAspectRatio="none"
        style={
          width > 0 && height > 0
            ? { width: `${width}px`, height: `${height}px` }
            : undefined
        }
        className="pointer-events-none absolute inset-0 z-10 block h-full w-full"
      >
        {items.map((item) => renderAnnotationItem(item))}
      </svg>
    );
  }

  const releaseCaptureSafely = (target: HTMLDivElement, pointerId: number) => {
    try {
      if (target.hasPointerCapture?.(pointerId)) {
        target.releasePointerCapture(pointerId);
      }
    } catch {
      /* ignore synthetic pointer capture errors */
    }
  };

  const resetActiveGesture = () => {
    activePointerIdRef.current = null;
    draftStrokeRef.current = null;
    setDraftStroke(null);
    erasedIdsRef.current = new Set();
    setErasedIds(new Set());
    beforeEraseSnapshotRef.current = null;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;

    if (e.pointerType === "pen") {
      lastPenTimeRef.current = Date.now();
    }

    if (
      e.pointerType === "touch" &&
      (stylusOnly || Date.now() - lastPenTimeRef.current < PALM_REJECTION_WINDOW_MS)
    ) {
      return;
    }

    if (activePointerIdRef.current !== null) return;

    e.stopPropagation();
    activePointerIdRef.current = e.pointerId;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore if synthetic PointerEvent does not support capture */
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const pt = clientPointToNormalizedPage(e.clientX, e.clientY, rect, normRegion);

    if (tool === "pencil" || tool === "highlighter") {
      const stroke: StrokeAnnotation = {
        id: createAnnotationId(),
        kind: tool,
        color: tool === "highlighter" ? highlighterColor : pencilColor,
        width: tool === "highlighter" ? HIGHLIGHTER_WIDTH : pencilWidth,
        opacity: tool === "highlighter" ? HIGHLIGHTER_OPACITY : 1,
        points: [e.pressure > 0 ? { x: pt.x, y: pt.y, p: e.pressure } : { x: pt.x, y: pt.y }],
      };
      draftStrokeRef.current = stroke;
      setDraftStroke(stroke);
      return;
    }

    if (tool === "eraser") {
      beforeEraseSnapshotRef.current = items;
      const nextErased = new Set<string>();
      for (const item of items) {
        if (hitTestAnnotation(item, pt)) {
          nextErased.add(item.id);
        }
      }
      erasedIdsRef.current = nextErased;
      setErasedIds(nextErased);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current !== e.pointerId) return;
    e.stopPropagation();

    const rect = e.currentTarget.getBoundingClientRect();
    const pt = clientPointToNormalizedPage(e.clientX, e.clientY, rect, normRegion);

    if (tool === "pencil" || tool === "highlighter") {
      const current = draftStrokeRef.current;
      if (!current) return;
      const last = current.points[current.points.length - 1];
      if (last && Math.hypot(pt.x - last.x, pt.y - last.y) < MIN_POINT_DISTANCE) {
        return;
      }
      const nextPoint: AnnotationPoint =
        e.pressure > 0 ? { x: pt.x, y: pt.y, p: e.pressure } : { x: pt.x, y: pt.y };
      const updated: StrokeAnnotation = {
        ...current,
        points: [...current.points, nextPoint],
      };
      draftStrokeRef.current = updated;
      setDraftStroke(updated);
      return;
    }

    if (tool === "eraser") {
      const snapshot = beforeEraseSnapshotRef.current;
      if (!snapshot) return;
      let changed = false;
      const nextErased = new Set(erasedIdsRef.current);
      for (const item of snapshot) {
        if (!nextErased.has(item.id) && hitTestAnnotation(item, pt)) {
          nextErased.add(item.id);
          changed = true;
        }
      }
      if (changed) {
        erasedIdsRef.current = nextErased;
        setErasedIds(nextErased);
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current !== e.pointerId) return;
    e.stopPropagation();
    releaseCaptureSafely(e.currentTarget, e.pointerId);
    activePointerIdRef.current = null;

    const rect = e.currentTarget.getBoundingClientRect();
    const pt = clientPointToNormalizedPage(e.clientX, e.clientY, rect, normRegion);

    if (tool === "pencil" || tool === "highlighter") {
      const finished = draftStrokeRef.current;
      draftStrokeRef.current = null;
      setDraftStroke(null);
      if (finished && finished.points.length > 0) {
        onCommitItems(pageNumber, [...items, finished]);
      }
      return;
    }

    if (tool === "eraser") {
      const snapshot = beforeEraseSnapshotRef.current;
      const erased = erasedIdsRef.current;
      beforeEraseSnapshotRef.current = null;
      erasedIdsRef.current = new Set();
      setErasedIds(new Set());
      if (snapshot && erased.size > 0) {
        const nextItems = snapshot.filter((item) => !erased.has(item.id));
        onCommitItems(pageNumber, nextItems);
      }
      return;
    }

    if (tool === "stamp") {
      onCommitItems(pageNumber, [
        ...items,
        {
          id: createAnnotationId(),
          kind: "stamp",
          stampId: activeStampId,
          x: pt.x,
          y: pt.y,
          color: pencilColor,
        },
      ]);
      return;
    }

    if (tool === "text" && textDraft === null) {
      setTextDraft({ x: pt.x, y: pt.y, value: "" });
    }
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current !== e.pointerId) return;
    e.stopPropagation();
    releaseCaptureSafely(e.currentTarget, e.pointerId);
    resetActiveGesture();
  };

  const handleTextSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!textDraft) return;
    const trimmed = textDraft.value.trim();
    if (!trimmed) {
      setTextDraft(null);
      return;
    }
    const clampedX = Math.min(0.92, Math.max(0.02, textDraft.x));
    const clampedY = Math.min(0.96, Math.max(0.03, textDraft.y));
    onCommitItems(pageNumber, [
      ...items,
      {
        id: createAnnotationId(),
        kind: "text",
        x: clampedX,
        y: clampedY,
        text: trimmed,
        color: pencilColor,
        fontSize: 18,
      },
    ]);
    setTextDraft(null);
  };

  const leftPct = textDraft ? ((textDraft.x - normRegion.x) / normRegion.width) * 100 : 0;
  const topPct = textDraft ? ((textDraft.y - normRegion.y) / normRegion.height) * 100 : 0;

  return (
    <div
      data-testid={`annotation-layer-page-${pageNumber}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      style={{
        touchAction: "none",
        width: width > 0 ? `${width}px` : undefined,
        height: height > 0 ? `${height}px` : undefined,
      }}
      className="absolute inset-0 z-10"
    >
      <svg
        aria-hidden="true"
        viewBox={viewBox}
        preserveAspectRatio="none"
        style={{ touchAction: "none" }}
        className="pointer-events-none block h-full w-full"
      >
        {visible
          ? items
              .filter((item) => !erasedIds.has(item.id))
              .map((item) => renderAnnotationItem(item))
          : null}
        {draftStroke ? renderAnnotationItem(draftStroke) : null}
      </svg>

      {textDraft ? (
        <form
          onSubmit={handleTextSubmit}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setTextDraft(null);
            }
          }}
          style={{
            backgroundColor: "rgba(22, 26, 34, 0.96)",
            left: `clamp(8px, ${leftPct}%, calc(100% - 216px))`,
            top: `clamp(8px, ${topPct}%, calc(100% - 104px))`,
          }}
          className="absolute z-20 flex w-52 flex-col gap-2 rounded-xl border border-accent p-2.5 shadow-2xl"
        >
          <input
            type="text"
            autoFocus
            maxLength={80}
            value={textDraft.value}
            onChange={(e) => setTextDraft({ ...textDraft, value: e.target.value })}
            placeholder="Skriv notat …"
            aria-label="Tekstnotat"
            className="w-full rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm text-fg placeholder:text-muted focus:border-accent focus:outline-none"
          />
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setTextDraft(null)}
              className="metro-press min-h-9 rounded-lg border border-line bg-surface px-2.5 text-xs font-semibold text-muted hover:text-fg"
            >
              Avbryt
            </button>
            <button
              type="submit"
              className="metro-press min-h-9 rounded-lg bg-accent px-3 text-xs font-bold text-[#1a1408]"
            >
              Bekreft
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
