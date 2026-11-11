import { Check, Copy, Laptop, Smartphone, Volume2, VolumeX, Wifi, WifiOff, X } from "lucide-react";
import { useState } from "react";
import { generateRoomCode, loadSyncConfig, saveSyncConfig } from "@/lib/sync/config";
import { useSync } from "@/lib/sync/use-sync";

interface SyncModalProps {
  open: boolean;
  onClose: () => void;
}

export function SyncModal({ open, onClose }: SyncModalProps) {
  const sync = useSync();
  const [roomInput, setRoomInput] = useState(sync.roomCode || "");
  const [copied, setCopied] = useState(false);
  const [showConfig, setShowConfig] = useState(false);

  const config = loadSyncConfig();
  const [supabaseUrl, setSupabaseUrl] = useState(config.supabaseUrl);
  const [supabaseKey, setSupabaseKey] = useState(config.supabaseAnonKey);
  const [configSaved, setConfigSaved] = useState(false);

  if (!open) return null;

  const hasCredentials = Boolean(config.supabaseUrl && config.supabaseAnonKey);

  function handleCreateRoom() {
    if (supabaseUrl.trim() && supabaseKey.trim()) {
      saveSyncConfig({
        supabaseUrl: supabaseUrl.trim(),
        supabaseAnonKey: supabaseKey.trim(),
      });
    }
    const code = generateRoomCode();
    setRoomInput(code);
    void sync.joinRoom(code, sync.role, sync.deviceName);
  }

  function handleJoinRoom(e: React.FormEvent) {
    e.preventDefault();
    if (!roomInput.trim()) return;
    if (supabaseUrl.trim() && supabaseKey.trim()) {
      saveSyncConfig({
        supabaseUrl: supabaseUrl.trim(),
        supabaseAnonKey: supabaseKey.trim(),
      });
    }
    void sync.joinRoom(roomInput.trim(), sync.role, sync.deviceName);
  }

  function handleCopyCode() {
    if (!sync.roomCode) return;
    void navigator.clipboard.writeText(sync.roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleSaveCredentials(e: React.FormEvent) {
    e.preventDefault();
    saveSyncConfig({
      supabaseUrl: supabaseUrl.trim(),
      supabaseAnonKey: supabaseKey.trim(),
    });
    setConfigSaved(true);
    setTimeout(() => setConfigSaved(false), 2500);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sync-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
    >
      <div className="flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-line bg-surface text-fg shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className={sync.connected ? "rounded-full bg-ok/20 p-1.5 text-ok" : "rounded-full bg-header p-1.5 text-muted"}>
              {sync.connected ? <Wifi className="size-4" /> : <WifiOff className="size-4" />}
            </div>
            <h2 id="sync-title" className="text-base font-semibold">
              Skjerm-synkronisering
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Lukk"
            className="metro-press rounded-lg p-1.5 text-muted hover:bg-header hover:text-fg"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {sync.error ? (
            <div className="mb-4 rounded-xl border border-no/30 bg-no/10 p-3 text-xs text-no">
              {sync.error}
            </div>
          ) : null}

          {sync.connected ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-ok/30 bg-ok/10 p-4 text-center">
                <p className="text-xs font-semibold tracking-wider text-ok uppercase">Tilkoblet rom</p>
                <div className="mt-1 flex items-center justify-center gap-2">
                  <span className="text-3xl font-extrabold tracking-widest text-fg tabular-nums">
                    {sync.roomCode}
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyCode}
                    className="metro-press rounded-lg border border-line bg-header p-2 text-muted hover:text-fg"
                    title="Kopier romkode"
                  >
                    {copied ? <Check className="size-4 text-ok" /> : <Copy className="size-4" />}
                  </button>
                </div>
                <p className="mt-2 text-xs text-muted">
                  Tast inn denne koden på den andre enheten for å koble dem sammen.
                </p>
              </div>

              <div>
                <label className="text-xs font-semibold tracking-wide text-muted uppercase">
                  Rolle for denne enheten
                </label>
                <div className="mt-1.5 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void sync.setRole("controller");
                      void sync.setAudioActive(false);
                    }}
                    className={
                      sync.role === "controller"
                        ? "flex min-h-12 flex-col items-center justify-center rounded-xl border-2 border-accent bg-accent/10 p-2 font-semibold text-accent"
                        : "flex min-h-12 flex-col items-center justify-center rounded-xl border border-line bg-header p-2 text-muted"
                    }
                  >
                    <Smartphone className="size-4 mb-1" />
                    <span className="text-xs">Fjernkontroll</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void sync.setRole("display");
                      void sync.setAudioActive(true);
                    }}
                    className={
                      sync.role === "display"
                        ? "flex min-h-12 flex-col items-center justify-center rounded-xl border-2 border-accent bg-accent/10 p-2 font-semibold text-accent"
                        : "flex min-h-12 flex-col items-center justify-center rounded-xl border border-line bg-header p-2 text-muted"
                    }
                  >
                    <Laptop className="size-4 mb-1" />
                    <span className="text-xs">Skjerm (Følger)</span>
                  </button>
                </div>
                <p className="mt-1.5 text-xs text-muted">
                  {sync.role === "controller"
                    ? "Du styrer øveplan og metronom. Skjermen på stativet følger etter."
                    : "Skjermen følger automatisk øvelsene som startes på fjernkontrollen."}
                </p>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-line bg-header p-3">
                <div className="flex items-center gap-2.5">
                  {sync.audioActive ? (
                    <Volume2 className="size-5 text-accent" />
                  ) : (
                    <VolumeX className="size-5 text-muted" />
                  )}
                  <div>
                    <p className="text-xs font-semibold">Lydavspilling her</p>
                    <p className="text-[11px] text-muted">
                      {sync.audioActive ? "Spiller metronom og lyd" : "Lydløs (unngår ekko)"}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void sync.setAudioActive(!sync.audioActive)}
                  className={
                    sync.audioActive
                      ? "metro-press rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-bg"
                      : "metro-press rounded-lg border border-line px-3 py-1.5 text-xs text-muted"
                  }
                >
                  {sync.audioActive ? "På" : "Av"}
                </button>
              </div>

              <div>
                <p className="text-xs font-semibold tracking-wide text-muted uppercase">
                  Tilkoblede enheter ({sync.peers.length + 1})
                </p>
                <div className="mt-1.5 space-y-1.5">
                  <div className="flex items-center justify-between rounded-lg border border-line bg-header px-3 py-2 text-xs">
                    <span className="font-semibold text-fg">
                      {sync.deviceName} <span className="text-muted">(denne)</span>
                    </span>
                    <span className="text-accent">
                      {sync.role === "controller" ? "Fjernkontroll" : "Skjerm"} · {sync.audioActive ? "🔊 Lyd" : "🔇"}
                    </span>
                  </div>
                  {sync.peers.map((peer) => (
                    <div
                      key={peer.id}
                      className="flex items-center justify-between rounded-lg border border-line bg-header px-3 py-2 text-xs"
                    >
                      <span className="text-fg">{peer.name}</span>
                      <span className="text-muted">
                        {peer.role === "controller" ? "Fjernkontroll" : "Skjerm"} · {peer.audioActive ? "🔊 Lyd" : "🔇"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={() => void sync.leaveRoom()}
                className="metro-press w-full rounded-xl border border-line py-2.5 text-xs font-semibold text-muted hover:border-no/50 hover:text-no"
              >
                Koble fra rom
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <form onSubmit={handleJoinRoom} className="space-y-2.5">
                <label className="block text-xs font-semibold tracking-wide text-muted uppercase">
                  Romkode
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={roomInput}
                    onChange={(e) => setRoomInput(e.target.value.toUpperCase())}
                    placeholder="f.eks. NOTE-123"
                    className="metro-field min-h-11 flex-1 rounded-xl border border-line bg-header px-3 text-sm font-semibold tracking-wider text-fg uppercase"
                  />
                  <button
                    type="submit"
                    disabled={!roomInput.trim() || sync.connecting}
                    className="metro-press min-h-11 rounded-xl bg-accent px-4 text-xs font-semibold text-bg disabled:opacity-40"
                  >
                    {sync.connecting ? "Kobler til…" : "Bli med"}
                  </button>
                </div>
              </form>

              <div className="relative flex items-center justify-center">
                <div className="w-full border-t border-line" />
                <span className="absolute bg-surface px-2 text-[11px] text-muted uppercase">eller</span>
              </div>

              <button
                type="button"
                onClick={handleCreateRoom}
                disabled={sync.connecting}
                className="metro-press min-h-11 w-full rounded-xl border border-line bg-header text-xs font-semibold text-fg hover:border-accent"
              >
                Opprett nytt rom
              </button>

              <div className="pt-1">
                <label className="block text-xs font-semibold tracking-wide text-muted uppercase">
                  Enhetsnavn
                </label>
                <input
                  type="text"
                  defaultValue={sync.deviceName}
                  onBlur={(e) => void sync.setDeviceName(e.target.value)}
                  className="metro-field mt-1 min-h-10 w-full rounded-xl border border-line bg-header px-3 text-xs text-fg"
                  placeholder="f.eks. iPad Notestativ"
                />
              </div>

              <div className="border-t border-line pt-3">
                <button
                  type="button"
                  onClick={() => setShowConfig(!showConfig)}
                  className="text-xs text-muted underline underline-offset-2"
                >
                  {showConfig ? "Skjul Supabase-oppsett" : "Supabase-innstillinger"}
                </button>

                {showConfig || !hasCredentials ? (
                  <form onSubmit={handleSaveCredentials} className="mt-3 space-y-2 rounded-xl border border-line bg-header p-3 text-xs">
                    <p className="text-[11px] text-muted">
                      Fyll inn din Supabase URL og Anon Key dersom de ikke er satt i miljøvariabler.
                    </p>
                    <div>
                      <label className="text-[11px] text-muted">Supabase URL</label>
                      <input
                        type="url"
                        value={supabaseUrl}
                        onChange={(e) => setSupabaseUrl(e.target.value)}
                        placeholder="https://xyz.supabase.co"
                        className="metro-field mt-0.5 min-h-9 w-full rounded-lg border border-line bg-surface px-2 text-xs text-fg"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-muted">Supabase Anon Key</label>
                      <input
                        type="text"
                        value={supabaseKey}
                        onChange={(e) => setSupabaseKey(e.target.value)}
                        placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                        className="metro-field mt-0.5 min-h-9 w-full rounded-lg border border-line bg-surface px-2 text-xs text-fg"
                      />
                    </div>
                    <button
                      type="submit"
                      className="metro-press mt-1 min-h-8 w-full rounded-lg bg-accent px-3 text-xs font-semibold text-bg"
                    >
                      {configSaved ? "Lagret!" : "Lagre nøkler"}
                    </button>
                  </form>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
