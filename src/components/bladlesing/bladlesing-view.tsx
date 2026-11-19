import {
  Activity,
  Minus,
  Play,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Square,
  Users,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useRef, useState } from "react";
import { BladlesingFlowPopover } from "@/components/bladlesing/bladlesing-flow-popover";
import { BladlesingScoreStage } from "@/components/bladlesing/bladlesing-score-stage";
import { BladlesingSettingsDrawer } from "@/components/bladlesing/bladlesing-settings-drawer";
import { matchActiveRecipeId, recipesForProfile } from "@/lib/bladlesing-config";
import { useBladlesingController } from "@/lib/bladlesing-controller";

export function BladlesingView() {
  const scoreHostRef = useRef<HTMLDivElement>(null);
  const { state, actions } = useBladlesingController(scoreHostRef);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [flowOpen, setFlowOpen] = useState(false);

  const recipes = recipesForProfile(state.profile);
  const activeRecipeId = matchActiveRecipeId(state.settings, state.profile);
  const flowActive = state.settings.flowAutoNext || state.settings.flowDisappearing;

  return (
    <div id="malletsight-root" className="relative flex h-full min-h-0 flex-col overflow-hidden bg-bg text-fg">
      {flowOpen ? (
        <div
          className="fixed inset-0 z-20"
          onClick={() => setFlowOpen(false)}
          aria-hidden="true"
        />
      ) : null}

      {/* Compact frosted top toolbar + Quick Practice Recipes */}
      <div className="relative z-30 shrink-0 border-b border-line bg-[rgb(var(--color-chrome-rgb)/0.88)] backdrop-blur-md">
        <div className="flex items-center justify-between gap-1.5 px-2.5 py-2 sm:px-4">
          {/* Quick Practice Recipes on >= md, compact title/level on mobile */}
          <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto">
            {recipes.map((recipe) => {
              const active = activeRecipeId === recipe.id;
              return (
                <button
                  key={recipe.id}
                  type="button"
                  onClick={() => actions.applyRecipe(recipe)}
                  title={recipe.description}
                  className={
                    active
                      ? "metro-press hidden min-h-9 shrink-0 items-center rounded-full border border-accent bg-[rgb(var(--color-accent-rgb)/0.12)] px-3 text-xs font-semibold text-accent md:inline-flex"
                      : "metro-press hidden min-h-9 shrink-0 items-center rounded-full border border-line bg-header px-3 text-xs font-medium text-muted hover:text-fg md:inline-flex"
                  }
                >
                  {recipe.label}
                </button>
              );
            })}

            <button
              id="btnDuetToggle"
              type="button"
              title="Samspill / duett"
              onClick={() =>
                actions.updateSettings({ duetEnabled: !state.settings.duetEnabled }, { regenerate: true })
              }
              className={
                state.settings.duetEnabled
                  ? "on metro-press inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-xl border border-ok bg-[rgb(var(--color-ok-rgb)/0.15)] px-2.5 text-xs font-semibold text-ok"
                  : "metro-press inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-xl border border-line bg-header px-2.5 text-xs font-medium text-muted hover:text-fg"
              }
            >
              <Users className="size-3.5" aria-hidden="true" />
              <span>Duett</span>
            </button>
          </div>

          <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
            {/* Level stepper */}
            <div
              className="inline-flex items-center gap-0.5 rounded-xl border border-line bg-header p-0.5"
              title="Nivå"
            >
              <button
                id="btnLevelDown"
                type="button"
                disabled={state.levelIndex === 0}
                onClick={() => actions.stepLevel(-1)}
                aria-label="Lettere nivå"
                title="Lettere"
                className="metro-press flex size-8 items-center justify-center rounded-lg text-fg hover:bg-surface disabled:opacity-40"
              >
                <Minus className="size-3.5" aria-hidden="true" />
              </button>
              <span
                id="levelRead"
                className="min-w-6 text-center text-xs font-bold text-fg tabular-nums"
              >
                {state.levelIndex >= 0 ? state.levelIndex + 1 : "–"}
              </span>
              <button
                id="btnLevelUp"
                type="button"
                disabled={state.levelIndex === 9}
                onClick={() => actions.stepLevel(1)}
                aria-label="Vanskeligere nivå"
                title="Vanskeligere"
                className="metro-press flex size-8 items-center justify-center rounded-lg text-fg hover:bg-surface disabled:opacity-40"
              >
                <Plus className="size-3.5" aria-hidden="true" />
              </button>
            </div>

            {/* Sight-Reading Flow Mode popover trigger */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setFlowOpen((o) => !o)}
                aria-expanded={flowOpen}
                aria-label="Bladlesingsflyt"
                title="Bladlesingsflyt: 1 takt opptelling, automatisk neste etyde, og «Les forover»"
                className={
                  flowActive
                    ? "metro-press inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-accent bg-[rgb(var(--color-accent-rgb)/0.12)] px-2.5 text-xs font-semibold text-accent"
                    : "metro-press inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-line bg-header px-2.5 text-xs font-medium text-muted hover:text-fg"
                }
              >
                <Sparkles className="size-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Flyt</span>
              </button>
              <BladlesingFlowPopover
                open={flowOpen}
                settings={state.settings}
                onUpdate={(patch) => actions.updateSettings(patch)}
                onClose={() => setFlowOpen(false)}
              />
            </div>

            {/* Compact Zoom controls */}
            <div className="hidden items-center gap-0.5 rounded-xl border border-line bg-header p-0.5 sm:inline-flex">
              <button
                id="btnZoomOut"
                type="button"
                onClick={() => actions.setZoom(state.settings.zoom - 0.1)}
                aria-label="Zoom ut"
                title="Zoom ut"
                className="metro-press flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface hover:text-fg"
              >
                <ZoomOut className="size-3.5" aria-hidden="true" />
              </button>
              <span className="min-w-10 text-center text-[11px] font-semibold text-muted tabular-nums">
                {Math.round(state.settings.zoom * 100)}%
              </span>
              <button
                id="btnZoomIn"
                type="button"
                onClick={() => actions.setZoom(state.settings.zoom + 0.1)}
                aria-label="Zoom inn"
                title="Zoom inn"
                className="metro-press flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface hover:text-fg"
              >
                <ZoomIn className="size-3.5" aria-hidden="true" />
              </button>
            </div>

            {/* Settings button */}
            <button
              id="btnSettings"
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="metro-press inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-line bg-surface px-2.5 text-xs font-semibold text-fg shadow-xs hover:border-[rgb(var(--color-accent-rgb)/0.6)] sm:px-3"
            >
              <SlidersHorizontal className="size-3.5 text-muted" aria-hidden="true" />
              <span>Innstillinger</span>
            </button>
          </div>
        </div>

        {/* Mobile Quick Practice Recipes strip */}
        <div className="flex items-center gap-1.5 overflow-x-auto border-t border-line px-2.5 py-1.5 md:hidden">
          {recipes.map((recipe) => {
            const active = activeRecipeId === recipe.id;
            return (
              <button
                key={recipe.id}
                type="button"
                onClick={() => actions.applyRecipe(recipe)}
                className={
                  active
                    ? "metro-press min-h-7 shrink-0 rounded-full border border-accent bg-[rgb(var(--color-accent-rgb)/0.12)] px-2.5 text-[11px] font-semibold text-accent"
                    : "metro-press min-h-7 shrink-0 rounded-full border border-line bg-header px-2.5 text-[11px] font-medium text-muted"
                }
              >
                {recipe.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main score stage */}
      <BladlesingScoreStage
        scoreHostRef={scoreHostRef}
        ready={state.ready}
        error={state.error}
        settings={state.settings}
        practiceLine={state.practiceLine}
        yielded={state.yielded}
        yieldColor={state.yieldColor}
        countInBeat={state.countInBeat}
        beatsPerBar={state.beatsPerBar}
        autoNextLeft={state.autoNextLeft}
        duetPaired={state.duetPaired}
        onZoomChange={actions.setZoom}
        onSwipeNext={() => actions.generate()}
        onSwipeAgain={() => actions.again()}
        onCancelAutoNext={actions.cancelAutoNext}
        onSetDuetViewPart={actions.setDuetViewPart}
        onToggleDuetPaired={actions.toggleDuetPaired}
        onUpdateSettings={actions.updateSettings}
      />

      {/* Modern frosted bottom transport bar */}
      <footer className="shrink-0 border-t border-line bg-[rgb(var(--color-chrome-rgb)/0.9)] px-2.5 py-2 backdrop-blur-md sm:px-4">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              id="btnPlay"
              type="button"
              onClick={actions.togglePlay}
              className={
                state.playing
                  ? "on metro-press inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-ok bg-[rgb(var(--color-ok-rgb)/0.15)] px-3 text-xs font-semibold text-ok sm:px-3.5 sm:text-sm"
                  : state.yielded
                    ? "yielded metro-press inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-dashed border-[rgb(var(--color-accent-rgb)/0.6)] bg-surface px-3 text-xs font-semibold text-muted sm:px-3.5 sm:text-sm"
                    : "metro-press inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-xs font-semibold text-fg hover:border-[rgb(var(--color-accent-rgb)/0.6)] sm:px-3.5 sm:text-sm"
              }
            >
              {state.playing ? (
                <Square className="size-3.5 fill-current" aria-hidden="true" />
              ) : (
                <Play className="size-3.5 fill-current" aria-hidden="true" />
              )}
              <span>{state.playing ? "Stopp" : "Spill"}</span>
            </button>

            <button
              id="btnMetro"
              type="button"
              onClick={actions.toggleMetro}
              className={
                state.metroOn
                  ? "on metro-press inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-ok bg-[rgb(var(--color-ok-rgb)/0.15)] px-2.5 text-xs font-semibold text-ok sm:px-3 sm:text-sm"
                  : state.yielded
                    ? "yielded metro-press inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-dashed border-[rgb(var(--color-accent-rgb)/0.6)] bg-surface px-2.5 text-xs font-semibold text-muted sm:px-3 sm:text-sm"
                    : "metro-press inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-line bg-surface px-2.5 text-xs font-semibold text-fg hover:border-[rgb(var(--color-accent-rgb)/0.6)] sm:px-3 sm:text-sm"
              }
            >
              <Activity className="size-3.5" aria-hidden="true" />
              <span>{state.metroLabel}</span>
            </button>

            <button
              id="btnSubdiv"
              type="button"
              title="Underdeling"
              onClick={actions.cycleSubdiv}
              className={
                state.subdiv > 1
                  ? "on metro-press hidden min-h-10 min-w-10 items-center justify-center rounded-xl border border-accent bg-[rgb(var(--color-accent-rgb)/0.12)] text-sm font-bold text-accent sm:inline-flex"
                  : "metro-press hidden min-h-10 min-w-10 items-center justify-center rounded-xl border border-line bg-surface text-sm font-semibold text-muted hover:text-fg sm:inline-flex"
              }
            >
              {state.subdiv === 1 ? "♩" : state.subdiv === 2 ? "♪" : "♬"}
            </button>

            {/* Tempo stepper with live beat lamps */}
            <div className="inline-flex items-center gap-1 rounded-xl border border-line bg-header p-0.5">
              <button
                id="btnTempoDown"
                type="button"
                title="Saktere"
                aria-label="Saktere tempo"
                onClick={() => actions.setTempo(state.settings.tempo - 4)}
                className="metro-press flex size-9 items-center justify-center rounded-lg text-fg hover:bg-surface"
              >
                <Minus className="size-3.5" aria-hidden="true" />
              </button>
              <div className="flex min-w-12 flex-col items-center justify-center px-1">
                <div id="beatLamps" className="mb-0.5 flex items-center gap-1">
                  {Array.from({ length: state.beatsPerBar }, (_, i) => {
                    const isOn = i === state.activeBeat;
                    const isDown = isOn && i === 0;
                    return (
                      <span
                        key={i}
                        className={
                          isDown
                            ? "on down size-2 rounded-full bg-fg shadow-xs transition-colors"
                            : isOn
                              ? "on size-2 rounded-full bg-accent shadow-xs transition-colors"
                              : "size-2 rounded-full bg-line transition-colors"
                        }
                      />
                    );
                  })}
                </div>
                <span id="tempoRead" className="text-xs font-bold text-fg tabular-nums sm:text-sm">
                  {state.settings.tempo}
                </span>
              </div>
              <button
                id="btnTempoUp"
                type="button"
                title="Raskere"
                aria-label="Raskere tempo"
                onClick={() => actions.setTempo(state.settings.tempo + 4)}
                className="metro-press flex size-9 items-center justify-center rounded-lg text-fg hover:bg-surface"
              >
                <Plus className="size-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              id="btnAgain"
              type="button"
              title="Samme etyde, litt saktere"
              onClick={actions.again}
              className="metro-press inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-line bg-surface px-2.5 text-xs font-semibold text-fg hover:border-[rgb(var(--color-accent-rgb)/0.6)] sm:px-3.5 sm:text-sm"
            >
              <RotateCcw className="size-3.5 text-muted" aria-hidden="true" />
              <span>Igjen</span>
            </button>
            <button
              id="btnGenerate"
              type="button"
              onClick={() => actions.generate()}
              className="metro-press inline-flex min-h-10 items-center justify-center rounded-xl bg-accent px-3.5 text-xs font-bold whitespace-nowrap text-accent-fg shadow-xs sm:px-4 sm:text-sm"
            >
              Ny etyde
            </button>
          </div>
        </div>
      </footer>

      <BladlesingSettingsDrawer
        open={settingsOpen}
        engine={state.engine}
        profile={state.profile}
        settings={state.settings}
        levelIndex={state.levelIndex}
        onClose={() => setSettingsOpen(false)}
        onApply={() => actions.generate()}
        onApplyLevel={actions.applyLevel}
        onUpdateSettings={actions.updateSettings}
        onResetDefaults={actions.resetDefaults}
      />
    </div>
  );
}
