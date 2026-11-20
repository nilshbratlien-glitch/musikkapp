import { Link2, PenTool, X } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import type { JumpLink } from "@/lib/noter";
import {
  ANNOTATION_VIEWBOX_SIZE,
  HIGHLIGHTER_OPACITY,
  HIGHLIGHTER_WIDTH,
  WHITEOUT_WIDTH_MEDIUM,
  clientPointToNormalizedPage,
  findTopmostAnnotationAtPoint,
  getAnnotationBounds,
  getAnnotationSvgViewBox,
  hitTestAnnotation,
  translateAnnotationItem,
  type AnnotationItem,
  type AnnotationPoint,
  type StampId,
  type StrokeAnnotation,
} from "@/lib/noter-annotations";
import { normalizeCropRect, type NormalizedRect } from "@/lib/noter-crop";

const QUICK_TEXT_EXPRESSIONS = [
  "rit.",
  "a tempo",
  "cresc.",
  "dim.",
  "sub. p",
  "2. gang",
  "H",
  "V",
  "obs!",
] as const;

export type AnnotationTool =
  | "view"
  | "pencil"
  | "highlighter"
  | "whiteout"
  | "eraser"
  | "stamp"
  | "text"
  | "link";
export type PencilThickness = "thin" | "thick";
export type WhiteoutSize = "small" | "medium" | "large";

export type NoterAnnotationLayerProps = {
  pageNumber: number;
  pageCount?: number;
  items: readonly AnnotationItem[];
  visible: boolean;
  region: NormalizedRect;
  width: number;
  height: number;
  tool: AnnotationTool;
  pencilColor: string;
  pencilWidth: number;
  highlighterColor: string;
  whiteoutColor?: string;
  whiteoutWidth?: number;
  nightFilter?: string;
  activeStampId: StampId;
  stampScale?: number;
  textFontSize?: number;
  stylusOnly: boolean;
  onCommitItems: (pageNumber: number, nextItems: AnnotationItem[]) => void;
  jumpLinks?: readonly JumpLink[];
  onAddJumpLink?: (link: Omit<JumpLink, "id">) => void;
  onUpdateJumpLink?: (id: string, patch: { x: number; y: number }) => void;
  onDeleteJumpLink?: (id: string) => void;
  onActivateJumpLink?: (link: JumpLink) => void;
  onViewDragActiveChange?: (active: boolean) => void;
  onTextDraftOpenChange?: (pageNumber: number, open: boolean) => void;
};

type TextDraft = {
  editingId?: string;
  x: number;
  y: number;
  value: string;
  fontSize?: number;
};

type LinkDraft = {
  x: number;
  y: number;
  targetPage: number;
  label: string;
};

const PALM_REJECTION_WINDOW_MS = 800;
const MIN_POINT_DISTANCE = 0.0015;
export const TOUCH_PLACEMENT_OFFSET_PX = 48;

export function getEffectivePlacementClientY(clientY: number, pointerType: string): number {
  return pointerType === "touch" ? clientY - TOUCH_PLACEMENT_OFFSET_PX : clientY;
}

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
    case "caesura":
      return (
        <>
          <path d="M -5 10 L 0 -10" fill="none" stroke={color} strokeWidth={2.8} strokeLinecap="round" />
          <path d="M 1 10 L 6 -10" fill="none" stroke={color} strokeWidth={2.8} strokeLinecap="round" />
        </>
      );
    case "accent":
      return (
        <path
          d="M -9 -6 L 9 0 L -9 6"
          fill="none"
          stroke={color}
          strokeWidth={2.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case "marcato":
      return (
        <path
          d="M -7 7 L 0 -9 L 7 7"
          fill="none"
          stroke={color}
          strokeWidth={2.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case "tenuto":
      return (
        <path
          d="M -10 0 L 10 0"
          fill="none"
          stroke={color}
          strokeWidth={3.2}
          strokeLinecap="round"
        />
      );
    case "staccato":
      return <circle cx={0} cy={0} r={3.6} fill={color} />;
    case "sharp":
      return (
        <>
          <path d="M -4 -12 L -4 12" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
          <path d="M 4 -12 L 4 12" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
          <path d="M -10 -3 L 10 -6" fill="none" stroke={color} strokeWidth={2.8} strokeLinecap="round" />
          <path d="M -10 6 L 10 3" fill="none" stroke={color} strokeWidth={2.8} strokeLinecap="round" />
        </>
      );
    case "flat":
      return (
        <path
          d="M -5 -13 L -5 11 C 2 9 7 4 6 -1 C 5 -5 0 -5 -5 -1"
          fill="none"
          stroke={color}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case "natural":
      return (
        <>
          <path d="M -4 -12 L -4 6 L 5 3" fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
          <path d="M 5 12 L 5 -6 L -4 -3" fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
        </>
      );
    case "coda":
      return (
        <>
          <ellipse cx={0} cy={0} rx={8} ry={10} fill="none" stroke={color} strokeWidth={2.4} />
          <path d="M 0 -14 L 0 14" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
          <path d="M -12 0 L 12 0" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
        </>
      );
    case "segno":
      return (
        <>
          <path
            d="M 5 -9 C 1 -12 -5 -10 -5 -5 C -5 0 6 0 6 5 C 6 10 0 12 -5 9"
            fill="none"
            stroke={color}
            strokeWidth={2.3}
            strokeLinecap="round"
          />
          <path d="M -9 10 L 9 -10" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
          <circle cx={-8} cy={-2} r={2} fill={color} />
          <circle cx={8} cy={2} r={2} fill={color} />
        </>
      );
    case "check":
      return (
        <path
          d="M -9 1 L -3 7 L 10 -7"
          fill="none"
          stroke={color}
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case "star":
      return (
        <path
          d="M 0 -12 L 3.4 -4.2 L 11.8 -3.5 L 5.4 2.1 L 7.3 10.4 L 0 6 L -7.3 10.4 L -5.4 2.1 L -11.8 -3.5 L -3.4 -4.2 Z"
          fill="none"
          stroke={color}
          strokeWidth={2.2}
          strokeLinejoin="round"
        />
      );
    case "arrow-up":
      return (
        <>
          <path d="M 0 11 L 0 -10" fill="none" stroke={color} strokeWidth={2.8} strokeLinecap="round" />
          <path d="M -7 -3 L 0 -11 L 7 -3" fill="none" stroke={color} strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" />
        </>
      );
    case "arrow-down":
      return (
        <>
          <path d="M 0 -11 L 0 10" fill="none" stroke={color} strokeWidth={2.8} strokeLinecap="round" />
          <path d="M -7 3 L 0 11 L 7 3" fill="none" stroke={color} strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" />
        </>
      );
    case "arrow-left":
      return (
        <>
          <path d="M 11 0 L -10 0" fill="none" stroke={color} strokeWidth={2.8} strokeLinecap="round" />
          <path d="M -3 -7 L -11 0 L -3 7" fill="none" stroke={color} strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" />
        </>
      );
    case "arrow-right":
      return (
        <>
          <path d="M -11 0 L 10 0" fill="none" stroke={color} strokeWidth={2.8} strokeLinecap="round" />
          <path d="M 3 -7 L 11 0 L 3 7" fill="none" stroke={color} strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" />
        </>
      );
    case "arrow-repeat":
      return (
        <>
          <path
            d="M -9 -3 L 3 -3 C 8 -3 11 0 11 4 C 11 8 8 11 3 11 L -6 11"
            fill="none"
            stroke={color}
            strokeWidth={2.6}
            strokeLinecap="round"
          />
          <path
            d="M -3 -9 L -10 -3 L -3 3"
            fill="none"
            stroke={color}
            strokeWidth={2.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      );
    case "pp":
    case "p":
    case "mp":
    case "mf":
    case "f":
    case "ff":
    case "sfz":
    case "fp":
      return (
        <text
          x={0}
          y={0}
          textAnchor="middle"
          dominantBaseline="central"
          fill={color}
          fontSize={stampId.length >= 3 ? 18 : 22}
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

function renderAnnotationItem(item: AnnotationItem, nightFilter?: string) {
  switch (item.kind) {
    case "pencil":
    case "highlighter":
    case "whiteout": {
      if (item.points.length === 0) return null;
      const whiteoutStyle =
        item.kind === "whiteout" && nightFilter ? { filter: nightFilter } : undefined;
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
            style={whiteoutStyle}
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
          style={whiteoutStyle}
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

function AlignmentReticle({
  minX,
  minY,
  maxX,
  maxY,
}: {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}) {
  const centerX = ((minX + maxX) / 2) * ANNOTATION_VIEWBOX_SIZE;
  const centerY = ((minY + maxY) / 2) * ANNOTATION_VIEWBOX_SIZE;
  return (
    <g data-testid="annotation-drag-reticle" className="pointer-events-none">
      <line
        x1={0}
        y1={centerY}
        x2={ANNOTATION_VIEWBOX_SIZE}
        y2={centerY}
        stroke="var(--color-accent)"
        strokeWidth={1.2}
        strokeOpacity={0.45}
        strokeDasharray="6 6"
      />
      <line
        x1={centerX}
        y1={0}
        x2={centerX}
        y2={ANNOTATION_VIEWBOX_SIZE}
        stroke="var(--color-accent)"
        strokeWidth={1.2}
        strokeOpacity={0.45}
        strokeDasharray="6 6"
      />
      <rect
        x={minX * ANNOTATION_VIEWBOX_SIZE}
        y={minY * ANNOTATION_VIEWBOX_SIZE}
        width={Math.max(12, (maxX - minX) * ANNOTATION_VIEWBOX_SIZE)}
        height={Math.max(12, (maxY - minY) * ANNOTATION_VIEWBOX_SIZE)}
        rx={6}
        fill="rgb(var(--color-accent-rgb) / 0.1)"
        stroke="var(--color-accent)"
        strokeWidth={2}
        strokeDasharray="5 4"
      />
      <circle cx={centerX} cy={centerY} r={5} fill="none" stroke="var(--color-accent)" strokeWidth={2} />
    </g>
  );
}

const CommittedAnnotationsSvg = memo(function CommittedAnnotationsSvg({
  items,
  erasedIds,
  visible,
  viewBox,
  nightFilter,
}: {
  items: readonly AnnotationItem[];
  erasedIds: Set<string>;
  visible: boolean;
  viewBox: string;
  nightFilter?: string;
}) {
  return (
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
            .map((item) => renderAnnotationItem(item, nightFilter))
        : null}
    </svg>
  );
});

export function NoterAnnotationLayer({
  pageNumber,
  pageCount = 1,
  items,
  visible,
  region,
  width,
  height,
  tool,
  pencilColor,
  pencilWidth,
  highlighterColor,
  whiteoutColor = "#ffffff",
  whiteoutWidth = WHITEOUT_WIDTH_MEDIUM,
  nightFilter,
  activeStampId,
  stampScale = 1,
  textFontSize = 18,
  stylusOnly,
  onCommitItems,
  jumpLinks = [],
  onAddJumpLink,
  onUpdateJumpLink,
  onDeleteJumpLink,
  onActivateJumpLink,
  onViewDragActiveChange,
  onTextDraftOpenChange,
}: NoterAnnotationLayerProps) {
  const [draftStroke, setDraftStroke] = useState<StrokeAnnotation | null>(null);
  const [erasedIds, setErasedIds] = useState<Set<string>>(() => new Set());
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);
  const [linkDraft, setLinkDraft] = useState<LinkDraft | null>(null);
  const [draftPlacement, setDraftPlacement] = useState<{
    kind: "stamp" | "link";
    x: number;
    y: number;
  } | null>(null);
  const [viewDrag, setViewDrag] = useState<
    | {
        kind: "annotation";
        pointerId: number;
        startPt: { x: number; y: number };
        touchOffsetDy: number;
        originalItem: AnnotationItem;
        currentItem: AnnotationItem;
      }
    | {
        kind: "jumpLink";
        pointerId: number;
        startPt: { x: number; y: number };
        touchOffsetDy: number;
        link: JumpLink;
        currentX: number;
        currentY: number;
      }
    | null
  >(null);

  const activePointerIdRef = useRef<number | null>(null);
  const lastPenTimeRef = useRef<number>(0);
  const draftStrokeRef = useRef<StrokeAnnotation | null>(null);
  const erasedIdsRef = useRef<Set<string>>(new Set());
  const beforeEraseSnapshotRef = useRef<readonly AnnotationItem[] | null>(null);
  const editingTextTargetRef = useRef<{
    id: string;
    x: number;
    y: number;
    text: string;
    fontSize?: number;
  } | null>(null);
  const viewLayerRef = useRef<HTMLDivElement | null>(null);
  const textInputRef = useRef<HTMLInputElement | null>(null);
  const viewDragRef = useRef<typeof viewDrag>(null);
  viewDragRef.current = viewDrag;
  const suppressedLinkClickIdRef = useRef<string | null>(null);
  const pendingLongPressRef = useRef<{
    pointerId: number;
    timerId: number;
    cleanupWindow: () => void;
  } | null>(null);

  const clearPendingLongPress = () => {
    const pending = pendingLongPressRef.current;
    if (!pending) return;
    window.clearTimeout(pending.timerId);
    pending.cleanupWindow();
    pendingLongPressRef.current = null;
  };

  useEffect(() => {
    activePointerIdRef.current = null;
    draftStrokeRef.current = null;
    setDraftStroke(null);
    setDraftPlacement(null);
    erasedIdsRef.current = new Set();
    setErasedIds(new Set());
    beforeEraseSnapshotRef.current = null;
    clearPendingLongPress();
    if (viewDragRef.current) {
      setViewDrag(null);
      onViewDragActiveChange?.(false);
    }
  }, [pageNumber, tool, onViewDragActiveChange]);

  useEffect(() => {
    return () => {
      clearPendingLongPress();
    };
  }, []);

  useEffect(() => {
    if (tool !== "text") {
      setTextDraft(null);
    }
    if (tool !== "link") {
      setLinkDraft(null);
    }
  }, [tool]);

  useEffect(() => {
    setTextDraft(null);
    setLinkDraft(null);
  }, [pageNumber]);

  const isTextDraftOpen = textDraft !== null;
  useEffect(() => {
    onTextDraftOpenChange?.(pageNumber, isTextDraftOpen);
    return () => {
      onTextDraftOpenChange?.(pageNumber, false);
    };
  }, [pageNumber, isTextDraftOpen, onTextDraftOpenChange]);

  const normRegion = normalizeCropRect(region);
  const viewBox = getAnnotationSvgViewBox(normRegion);

  const visibleJumpLinks = jumpLinks.filter(
    (link) =>
      link.sourcePage === pageNumber &&
      link.x >= normRegion.x &&
      link.x <= normRegion.x + normRegion.width &&
      link.y >= normRegion.y &&
      link.y <= normRegion.y + normRegion.height,
  );

  const startLongPressWatcher = (
    e: React.PointerEvent<HTMLElement>,
    onActivate: (startPt: { x: number; y: number }, touchOffsetDy: number) => void,
  ) => {
    clearPendingLongPress();
    const layerEl = viewLayerRef.current;
    if (!layerEl) return;
    const pointerId = e.pointerId;
    const pointerType = e.pointerType;
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const rect = layerEl.getBoundingClientRect();
    const startPt = clientPointToNormalizedPage(startClientX, startClientY, rect, normRegion);
    const liftedPt = clientPointToNormalizedPage(
      startClientX,
      getEffectivePlacementClientY(startClientY, pointerType),
      rect,
      normRegion,
    );
    const touchOffsetDy = liftedPt.y - startPt.y;

    const onWindowMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (Math.hypot(ev.clientX - startClientX, ev.clientY - startClientY) > 8) {
        clearPendingLongPress();
      }
    };
    const onWindowEnd = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      clearPendingLongPress();
    };
    const onWindowContextMenu = (ev: MouseEvent) => {
      ev.preventDefault();
    };
    const cleanupWindow = () => {
      window.removeEventListener("pointermove", onWindowMove);
      window.removeEventListener("pointerup", onWindowEnd);
      window.removeEventListener("pointercancel", onWindowEnd);
      window.removeEventListener("contextmenu", onWindowContextMenu);
    };

    window.addEventListener("pointermove", onWindowMove);
    window.addEventListener("pointerup", onWindowEnd);
    window.addEventListener("pointercancel", onWindowEnd);
    window.addEventListener("contextmenu", onWindowContextMenu);

    const timerId = window.setTimeout(() => {
      cleanupWindow();
      pendingLongPressRef.current = null;
      onViewDragActiveChange?.(true);
      onActivate(startPt, touchOffsetDy);
    }, 350);

    pendingLongPressRef.current = { pointerId, timerId, cleanupWindow };
  };

  const isViewDragActive = viewDrag !== null;

  useEffect(() => {
    if (!isViewDragActive) return;
    const pointerId = viewDragRef.current?.pointerId;
    if (pointerId === undefined) return;

    const onWindowDragMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const drag = viewDragRef.current;
      const layerEl = viewLayerRef.current;
      if (!drag || !layerEl) return;
      const rect = layerEl.getBoundingClientRect();
      const pt = clientPointToNormalizedPage(ev.clientX, ev.clientY, rect, normRegion);
      const dx = pt.x - drag.startPt.x;
      const dy = pt.y + drag.touchOffsetDy - drag.startPt.y;
      if (drag.kind === "annotation") {
        setViewDrag({
          ...drag,
          currentItem: translateAnnotationItem(drag.originalItem, dx, dy),
        });
      } else {
        setViewDrag({
          ...drag,
          currentX: Math.min(0.94, Math.max(0.06, drag.link.x + dx)),
          currentY: Math.min(0.94, Math.max(0.06, drag.link.y + dy)),
        });
      }
    };

    const finishDrag = (ev: PointerEvent, commit: boolean) => {
      if (ev.pointerId !== pointerId) return;
      const drag = viewDragRef.current;
      if (!drag) return;
      setViewDrag(null);
      onViewDragActiveChange?.(false);

      if (!commit) return;
      if (drag.kind === "annotation") {
        const nextItems = items.map((item) =>
          item.id === drag.currentItem.id ? drag.currentItem : item,
        );
        onCommitItems(pageNumber, nextItems);
      } else {
        onUpdateJumpLink?.(drag.link.id, { x: drag.currentX, y: drag.currentY });
      }
    };

    const onWindowDragUp = (ev: PointerEvent) => finishDrag(ev, true);
    const onWindowDragCancel = (ev: PointerEvent) => finishDrag(ev, false);
    const onWindowDragContextMenu = (ev: MouseEvent) => ev.preventDefault();

    window.addEventListener("pointermove", onWindowDragMove);
    window.addEventListener("pointerup", onWindowDragUp);
    window.addEventListener("pointercancel", onWindowDragCancel);
    window.addEventListener("contextmenu", onWindowDragContextMenu);
    return () => {
      window.removeEventListener("pointermove", onWindowDragMove);
      window.removeEventListener("pointerup", onWindowDragUp);
      window.removeEventListener("pointercancel", onWindowDragCancel);
      window.removeEventListener("contextmenu", onWindowDragContextMenu);
    };
  }, [
    isViewDragActive,
    items,
    normRegion,
    pageNumber,
    onCommitItems,
    onUpdateJumpLink,
    onViewDragActiveChange,
  ]);

  if (tool === "view") {
    if (!visible && visibleJumpLinks.length === 0) return null;

    const handleViewPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (!visible || viewDragRef.current) return;
      if (
        e.pointerType === "touch" &&
        (stylusOnly || Date.now() - lastPenTimeRef.current < PALM_REJECTION_WINDOW_MS)
      ) {
        return;
      }
      const rect = e.currentTarget.getBoundingClientRect();
      const pt = clientPointToNormalizedPage(e.clientX, e.clientY, rect, normRegion);
      const hitRadius = e.pointerType === "touch" ? 0.032 : 0.022;
      const hitItem = findTopmostAnnotationAtPoint(items, pt, hitRadius);
      if (!hitItem) return;

      startLongPressWatcher(e, (startPt, touchOffsetDy) => {
        setViewDrag({
          kind: "annotation",
          pointerId: e.pointerId,
          startPt,
          touchOffsetDy,
          originalItem: hitItem,
          currentItem:
            touchOffsetDy !== 0 ? translateAnnotationItem(hitItem, 0, touchOffsetDy) : hitItem,
        });
      });
    };

    const draggedBounds =
      viewDrag?.kind === "annotation" ? getAnnotationBounds(viewDrag.currentItem) : null;

    return (
      <div
        ref={viewLayerRef}
        data-testid={`annotation-layer-page-${pageNumber}`}
        onPointerDown={handleViewPointerDown}
        onContextMenu={(e) => e.preventDefault()}
        style={
          width > 0 && height > 0
            ? { width: `${width}px`, height: `${height}px`, touchAction: "none", WebkitTouchCallout: "none" }
            : { touchAction: "none", WebkitTouchCallout: "none" }
        }
        className="pointer-events-auto absolute inset-0 z-10 select-none"
      >
        {visible ? (
          <svg
            aria-hidden="true"
            viewBox={viewBox}
            preserveAspectRatio="none"
            className="pointer-events-none block h-full w-full"
          >
            {items.map((item) => {
              const activeItem =
                viewDrag?.kind === "annotation" && viewDrag.currentItem.id === item.id
                  ? viewDrag.currentItem
                  : item;
              return renderAnnotationItem(activeItem, nightFilter);
            })}
            {draggedBounds ? (
              <AlignmentReticle
                minX={draggedBounds.minX}
                minY={draggedBounds.minY}
                maxX={draggedBounds.maxX}
                maxY={draggedBounds.maxY}
              />
            ) : null}
          </svg>
        ) : null}

        {visibleJumpLinks.map((link) => {
          const isDraggingThisLink =
            viewDrag?.kind === "jumpLink" && viewDrag.link.id === link.id;
          const displayX = isDraggingThisLink ? viewDrag.currentX : link.x;
          const displayY = isDraggingThisLink ? viewDrag.currentY : link.y;
          const leftPct = ((displayX - normRegion.x) / normRegion.width) * 100;
          const topPct = ((displayY - normRegion.y) / normRegion.height) * 100;
          return (
            <button
              key={link.id}
              type="button"
              onContextMenu={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                if (suppressedLinkClickIdRef.current === link.id) {
                  suppressedLinkClickIdRef.current = null;
                  return;
                }
                onActivateJumpLink?.(link);
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                if (e.pointerType === "mouse" && e.button !== 0) return;
                startLongPressWatcher(e, (startPt, touchOffsetDy) => {
                  suppressedLinkClickIdRef.current = link.id;
                  setViewDrag({
                    kind: "jumpLink",
                    pointerId: e.pointerId,
                    startPt,
                    touchOffsetDy,
                    link,
                    currentX: link.x,
                    currentY: Math.min(0.94, Math.max(0.06, link.y + touchOffsetDy)),
                  });
                });
              }}
              onPointerUp={(e) => {
                if (viewDragRef.current?.kind === "jumpLink") {
                  return;
                }
                e.stopPropagation();
              }}
              style={{
                left: `${leftPct}%`,
                top: `${topPct}%`,
                backgroundColor: "rgb(var(--color-chrome-rgb) / 0.92)",
                WebkitTouchCallout: "none",
              }}
              aria-label={`Hopp til side ${link.targetPage}: ${link.label}`}
              className={
                isDraggingThisLink
                  ? "metro-press pointer-events-auto absolute z-30 flex min-h-8 -translate-x-1/2 -translate-y-1/2 scale-105 items-center gap-1 rounded-full border-2 border-accent px-2.5 py-1 text-xs font-bold text-accent shadow-2xl ring-4 ring-accent/30"
                  : "metro-press pointer-events-auto absolute z-20 flex min-h-8 -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full border border-accent px-2.5 py-1 text-xs font-bold text-accent shadow-lg"
              }
            >
              <Link2 className="size-3 shrink-0" aria-hidden="true" />
              <span>{link.label}</span>
            </button>
          );
        })}
      </div>
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
    setDraftPlacement(null);
    erasedIdsRef.current = new Set();
    setErasedIds(new Set());
    beforeEraseSnapshotRef.current = null;
  };

  const commitTextDraft = () => {
    if (!textDraft) return;
    const trimmed = textDraft.value.trim();
    if (textDraft.editingId) {
      if (!trimmed) {
        onCommitItems(
          pageNumber,
          items.filter((item) => item.id !== textDraft.editingId),
        );
      } else {
        onCommitItems(
          pageNumber,
          items.map((item) =>
            item.id === textDraft.editingId && item.kind === "text"
              ? {
                  ...item,
                  text: trimmed,
                  color: pencilColor,
                  fontSize: textFontSize,
                }
              : item,
          ),
        );
      }
      setTextDraft(null);
      return;
    }
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
        fontSize: textDraft.fontSize ?? textFontSize,
      },
    ]);
    setTextDraft(null);
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

    if (tool === "text" && textDraft !== null) {
      e.stopPropagation();
      commitTextDraft();
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

    if (tool === "pencil" || tool === "highlighter" || tool === "whiteout") {
      const stroke: StrokeAnnotation = {
        id: createAnnotationId(),
        kind: tool,
        color:
          tool === "highlighter"
            ? highlighterColor
            : tool === "whiteout"
              ? whiteoutColor
              : pencilColor,
        width:
          tool === "highlighter"
            ? HIGHLIGHTER_WIDTH
            : tool === "whiteout"
              ? whiteoutWidth
              : pencilWidth,
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
      return;
    }

    if (tool === "text" && textDraft === null) {
      const hitRadius = e.pointerType === "touch" ? 0.032 : 0.022;
      const textItems = items.filter((item) => item.kind === "text");
      const hitText = findTopmostAnnotationAtPoint(textItems, pt, hitRadius);
      if (hitText && hitText.kind === "text") {
        editingTextTargetRef.current = {
          id: hitText.id,
          x: hitText.x,
          y: hitText.y,
          text: hitText.text,
          fontSize: hitText.fontSize,
        };
      } else {
        editingTextTargetRef.current = null;
      }
      return;
    }

    if (tool === "stamp" || (tool === "link" && linkDraft === null)) {
      const placementPt = clientPointToNormalizedPage(
        e.clientX,
        getEffectivePlacementClientY(e.clientY, e.pointerType),
        rect,
        normRegion,
      );
      setDraftPlacement({
        kind: tool,
        x: placementPt.x,
        y: placementPt.y,
      });
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current !== e.pointerId) return;
    e.stopPropagation();

    const rect = e.currentTarget.getBoundingClientRect();
    const pt = clientPointToNormalizedPage(e.clientX, e.clientY, rect, normRegion);

    if (tool === "pencil" || tool === "highlighter" || tool === "whiteout") {
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
      return;
    }

    if (tool === "stamp" || (tool === "link" && linkDraft === null)) {
      const placementPt = clientPointToNormalizedPage(
        e.clientX,
        getEffectivePlacementClientY(e.clientY, e.pointerType),
        rect,
        normRegion,
      );
      setDraftPlacement({
        kind: tool,
        x: placementPt.x,
        y: placementPt.y,
      });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current !== e.pointerId) return;
    e.stopPropagation();
    releaseCaptureSafely(e.currentTarget, e.pointerId);
    activePointerIdRef.current = null;

    const rect = e.currentTarget.getBoundingClientRect();
    const pt = clientPointToNormalizedPage(e.clientX, e.clientY, rect, normRegion);
    const placementPt = clientPointToNormalizedPage(
      e.clientX,
      getEffectivePlacementClientY(e.clientY, e.pointerType),
      rect,
      normRegion,
    );

    if (tool === "pencil" || tool === "highlighter" || tool === "whiteout") {
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
      setDraftPlacement(null);
      onCommitItems(pageNumber, [
        ...items,
        {
          id: createAnnotationId(),
          kind: "stamp",
          stampId: activeStampId,
          x: placementPt.x,
          y: placementPt.y,
          color: pencilColor,
          scale: stampScale,
        },
      ]);
      return;
    }

    if (tool === "text" && textDraft === null) {
      const target = editingTextTargetRef.current;
      editingTextTargetRef.current = null;
      if (target) {
        setTextDraft({
          editingId: target.id,
          x: target.x,
          y: target.y,
          value: target.text,
          fontSize: target.fontSize ?? textFontSize,
        });
      } else {
        setTextDraft({ x: pt.x, y: pt.y, value: "", fontSize: textFontSize });
      }
      return;
    }

    if (tool === "link" && linkDraft === null) {
      setDraftPlacement(null);
      const total = Math.max(1, pageCount ?? 1);
      setLinkDraft({
        x: placementPt.x,
        y: placementPt.y,
        targetPage: pageNumber < total ? pageNumber + 1 : 1,
        label: "D.S.",
      });
    }
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current !== e.pointerId) return;
    e.stopPropagation();
    releaseCaptureSafely(e.currentTarget, e.pointerId);
    editingTextTargetRef.current = null;
    resetActiveGesture();
  };

  const handleTextSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    commitTextDraft();
  };

  const handleLinkSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!linkDraft) return;
    const total = Math.max(1, pageCount ?? 1);
    const trimmed = linkDraft.label.trim() || `Side ${linkDraft.targetPage}`;
    const targetPage = Math.min(total, Math.max(1, Math.round(linkDraft.targetPage) || 1));
    const clampedX = Math.min(0.94, Math.max(0.06, linkDraft.x));
    const clampedY = Math.min(0.94, Math.max(0.06, linkDraft.y));
    onAddJumpLink?.({
      sourcePage: pageNumber,
      targetPage,
      x: clampedX,
      y: clampedY,
      label: trimmed,
    });
    setLinkDraft(null);
  };

  const leftPct = textDraft ? ((textDraft.x - normRegion.x) / normRegion.width) * 100 : 0;
  const topPct = textDraft ? ((textDraft.y - normRegion.y) / normRegion.height) * 100 : 0;
  const linkLeftPct = linkDraft ? ((linkDraft.x - normRegion.x) / normRegion.width) * 100 : 0;
  const linkTopPct = linkDraft ? ((linkDraft.y - normRegion.y) / normRegion.height) * 100 : 0;
  const totalPageCount = Math.max(1, pageCount ?? 1);
  const draftStampItem: AnnotationItem | null =
    draftPlacement?.kind === "stamp"
      ? {
          id: "draft-stamp-preview",
          kind: "stamp",
          stampId: activeStampId,
          x: draftPlacement.x,
          y: draftPlacement.y,
          color: pencilColor,
          scale: stampScale,
        }
      : null;
  const draftStampBounds = draftStampItem ? getAnnotationBounds(draftStampItem) : null;

  return (
    <div
      data-testid={`annotation-layer-page-${pageNumber}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onContextMenu={(e) => {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag !== "INPUT" && tag !== "TEXTAREA") e.preventDefault();
      }}
      style={{
        touchAction: textDraft ? "auto" : "none",
        WebkitTouchCallout: textDraft ? "default" : "none",
        width: width > 0 ? `${width}px` : undefined,
        height: height > 0 ? `${height}px` : undefined,
      }}
      className={textDraft ? "absolute inset-0 z-10 select-text" : "absolute inset-0 z-10 select-none"}
    >
      <CommittedAnnotationsSvg
        items={items}
        erasedIds={erasedIds}
        visible={visible}
        viewBox={viewBox}
        nightFilter={nightFilter}
      />

      {draftStroke || draftStampItem ? (
        <svg
          aria-hidden="true"
          viewBox={viewBox}
          preserveAspectRatio="none"
          style={{ touchAction: "none" }}
          className="pointer-events-none absolute inset-0 block h-full w-full"
        >
          {draftStroke ? renderAnnotationItem(draftStroke, nightFilter) : null}
          {draftStampItem ? (
            <>
              {renderAnnotationItem(draftStampItem, nightFilter)}
              {draftStampBounds ? (
                <AlignmentReticle
                  minX={draftStampBounds.minX}
                  minY={draftStampBounds.minY}
                  maxX={draftStampBounds.maxX}
                  maxY={draftStampBounds.maxY}
                />
              ) : null}
            </>
          ) : null}
        </svg>
      ) : null}

      {draftPlacement?.kind === "link" ? (
        <div
          data-testid="link-placement-preview"
          style={{
            left: `${((draftPlacement.x - normRegion.x) / normRegion.width) * 100}%`,
            top: `${((draftPlacement.y - normRegion.y) / normRegion.height) * 100}%`,
            backgroundColor: "rgb(var(--color-chrome-rgb) / 0.94)",
          }}
          className="pointer-events-none absolute z-30 flex min-h-8 -translate-x-1/2 -translate-y-1/2 scale-105 items-center gap-1 rounded-full border-2 border-accent px-2.5 py-1 text-xs font-bold text-accent shadow-2xl ring-4 ring-accent/30"
        >
          <Link2 className="size-3 shrink-0" aria-hidden="true" />
          <span>Lenke</span>
        </div>
      ) : null}

      {tool === "link"
        ? visibleJumpLinks.map((link) => {
            const jLeftPct = ((link.x - normRegion.x) / normRegion.width) * 100;
            const jTopPct = ((link.y - normRegion.y) / normRegion.height) * 100;
            return (
              <div
                key={link.id}
                onPointerDown={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
                style={{
                  left: `${jLeftPct}%`,
                  top: `${jTopPct}%`,
                  backgroundColor: "rgb(var(--color-chrome-rgb) / 0.94)",
                }}
                className="absolute z-20 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full border border-accent py-1 pl-2.5 pr-1 text-xs font-bold text-accent shadow-lg"
              >
                <Link2 className="size-3 shrink-0" aria-hidden="true" />
                <span>
                  {link.label} → s.{link.targetPage}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteJumpLink?.(link.id);
                  }}
                  aria-label={`Slett hoppepunkt ${link.label}`}
                  className="metro-press flex size-6 items-center justify-center rounded-full text-muted hover:text-fg"
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              </div>
            );
          })
        : null}

      {textDraft ? (
        <form
          onSubmit={handleTextSubmit}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerMove={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onPointerCancel={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setTextDraft(null);
            }
          }}
          style={{
            backgroundColor: "rgb(var(--color-chrome-rgb) / 0.97)",
            touchAction: "auto",
            WebkitTouchCallout: "default",
            left: `clamp(8px, ${leftPct}%, max(8px, calc(100% - 328px)))`,
            top: `clamp(8px, ${topPct}%, max(8px, calc(100% - 216px)))`,
          }}
          className="absolute z-20 flex w-80 max-w-[calc(100%-16px)] select-text flex-col gap-2 rounded-xl border border-accent p-3 shadow-2xl"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-fg">
              <PenTool className="size-3.5 text-accent" aria-hidden="true" />
              Penn til tekst
            </span>
            <span className="text-[11px] text-muted">Skriv rett i feltet med penn</span>
          </div>

          <input
            ref={textInputRef}
            type="text"
            autoFocus
            lang="nb"
            autoCapitalize="sentences"
            enterKeyHint="done"
            maxLength={80}
            value={textDraft.value}
            onChange={(e) => setTextDraft({ ...textDraft, value: e.target.value })}
            placeholder="Skriv med penn eller tastatur …"
            aria-label="Tekstnotat"
            style={{
              touchAction: "auto",
              WebkitTouchCallout: "default",
              borderColor: "rgb(var(--color-accent-rgb) / 0.55)",
            }}
            className="min-h-13 w-full select-text rounded-lg border-2 border-dashed bg-bg px-3 py-2 text-base text-fg placeholder:text-muted focus:outline-none"
          />

          <div
            className="flex flex-wrap gap-1"
            role="group"
            aria-label="Hurtiguttrykk for tekstnotat"
          >
            {QUICK_TEXT_EXPRESSIONS.map((expr) => (
              <button
                key={expr}
                type="button"
                onClick={() => {
                  setTextDraft((prev) => {
                    if (!prev) return prev;
                    const trimmed = prev.value.trim();
                    const next = trimmed ? `${trimmed} ${expr}` : expr;
                    return { ...prev, value: next.slice(0, 80) };
                  });
                  textInputRef.current?.focus();
                }}
                className="metro-press min-h-8 rounded-md border border-line bg-surface px-2 text-xs font-medium text-fg hover:border-accent"
              >
                {expr}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-end gap-1.5">
            {textDraft.editingId ? (
              <button
                type="button"
                onClick={() => {
                  onCommitItems(
                    pageNumber,
                    items.filter((item) => item.id !== textDraft.editingId),
                  );
                  setTextDraft(null);
                }}
                className="metro-press mr-auto min-h-9 rounded-lg border border-line bg-surface px-2.5 text-xs font-semibold text-no hover:border-no"
              >
                Slett
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setTextDraft(null)}
              className="metro-press min-h-9 rounded-lg border border-line bg-surface px-2.5 text-xs font-semibold text-muted hover:text-fg"
            >
              Avbryt
            </button>
            <button
              type="submit"
              className="metro-press min-h-9 rounded-lg bg-accent px-3 text-xs font-bold text-accent-fg"
            >
              Bekreft
            </button>
          </div>
        </form>
      ) : null}

      {linkDraft ? (
        <form
          onSubmit={handleLinkSubmit}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setLinkDraft(null);
            }
          }}
          style={{
            backgroundColor: "rgb(var(--color-chrome-rgb) / 0.97)",
            left: `clamp(8px, ${linkLeftPct}%, calc(100% - 240px))`,
            top: `clamp(8px, ${linkTopPct}%, calc(100% - 180px))`,
          }}
          className="absolute z-30 flex w-56 flex-col gap-2 rounded-xl border border-accent p-3 shadow-2xl"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-fg">Nytt hoppepunkt</span>
            <span className="text-[11px] text-muted">Fra side {pageNumber}</span>
          </div>

          <div className="flex flex-wrap gap-1">
            {["D.S.", "Coda", "Refr."].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setLinkDraft({ ...linkDraft, label: preset })}
                style={
                  linkDraft.label === preset
                    ? { backgroundColor: "rgb(var(--color-accent-rgb) / 0.18)" }
                    : undefined
                }
                className={
                  linkDraft.label === preset
                    ? "metro-press min-h-7 rounded-md border border-accent px-2 text-xs font-bold text-accent"
                    : "metro-press min-h-7 rounded-md border border-line bg-surface px-2 text-xs font-medium text-muted hover:text-fg"
                }
              >
                {preset}
              </button>
            ))}
          </div>

          <input
            type="text"
            maxLength={24}
            value={linkDraft.label}
            onChange={(e) => setLinkDraft({ ...linkDraft, label: e.target.value })}
            placeholder="Etikett (f.eks. D.S.)"
            aria-label="Lenkeetikett"
            className="w-full rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm text-fg placeholder:text-muted focus:border-accent focus:outline-none"
          />

          <label className="flex items-center justify-between gap-2 text-xs text-muted">
            <span>Målside</span>
            <input
              type="number"
              min={1}
              max={totalPageCount}
              value={linkDraft.targetPage}
              onChange={(e) =>
                setLinkDraft({
                  ...linkDraft,
                  targetPage: Math.min(
                    totalPageCount,
                    Math.max(1, Number.parseInt(e.target.value || "1", 10) || 1),
                  ),
                })
              }
              aria-label="Målside"
              className="w-20 rounded-lg border border-line bg-bg px-2 py-1 text-right text-sm font-semibold tabular-nums text-fg focus:border-accent focus:outline-none"
            />
          </label>

          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setLinkDraft(null)}
              className="metro-press min-h-9 rounded-lg border border-line bg-surface px-2.5 text-xs font-semibold text-muted hover:text-fg"
            >
              Avbryt
            </button>
            <button
              type="submit"
              className="metro-press min-h-9 rounded-lg bg-accent px-3 text-xs font-bold text-accent-fg"
            >
              Lagre lenke
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
