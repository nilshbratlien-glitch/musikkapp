import { useEffect, useRef, useSyncExternalStore } from "react";
import { getProfile, getProfileVersion, subscribeProfile } from "@/lib/profile";
import "@/lib/pulse";

const ASSET_VER = "v12";
const SCRIPTS = [
  `/malletsight/abcjs.js?${ASSET_VER}`,
  `/malletsight/theory.js?${ASSET_VER}`,
  `/malletsight/generator.js?${ASSET_VER}`,
  `/malletsight/renderer.js?${ASSET_VER}`,
  `/malletsight/audio.js?${ASSET_VER}`,
  `/malletsight/app.js?${ASSET_VER}`,
];

function loadScript(src: string) {
  const existing = document.querySelector(`script[data-ms="${src}"]`);
  if (existing) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.dataset.ms = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(src));
    document.body.appendChild(script);
  });
}

declare global {
  interface Window {
    MalletSight?: {
      mount: (root: HTMLElement) => void;
      unmount: () => void;
      isReady?: () => boolean;
      setProfile?: (profile?: string) => boolean;
      generate?: () => boolean;
      togglePlay?: () => boolean;
      toggleMetro?: () => boolean;
      again?: () => boolean;
      stopAll?: () => void;
      setTempo?: (bpm: number) => boolean;
    };
  }
}

export function Malletsight() {
  const host = useRef<HTMLDivElement>(null);
  useSyncExternalStore(subscribeProfile, getProfileVersion, getProfileVersion);
  const profile = getProfile();

  useEffect(() => {
    window.MalletSight?.setProfile?.(profile);
  }, [profile]);

  useEffect(() => {
    const root = host.current;
    if (!root) return;
    let cancelled = false;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `/malletsight/app.css?${ASSET_VER}`;
    document.head.appendChild(link);
    (async () => {
      const markup = await fetch(`/malletsight/markup.html?${ASSET_VER}`);
      if (!markup.ok) return;
      const html = await markup.text();
      if (cancelled) return;
      root.innerHTML = html;
      for (const src of SCRIPTS) {
        await loadScript(src);
        if (cancelled) return;
      }
      window.MalletSight?.mount(root);
      window.MalletSight?.setProfile?.(profile);
    })();
    return () => {
      cancelled = true;
      window.MalletSight?.unmount();
      link.remove();
      if (root) root.innerHTML = "";
    };
  }, []);

  return <div id="malletsight-root" ref={host} className="h-full min-h-0" />;
}
