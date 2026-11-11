import { useEffect, useRef } from "react";
import "@/lib/pulse";

const SCRIPTS = [
  "/malletsight/abcjs.js",
  "/malletsight/theory.js",
  "/malletsight/generator.js",
  "/malletsight/renderer.js",
  "/malletsight/audio.js",
  "/malletsight/app.js",
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
      generate?: () => void;
      togglePlay?: () => void;
      setTempo?: (bpm: number) => void;
    };
  }
}

export function Malletsight() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = host.current;
    if (!root) return;
    let cancelled = false;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/malletsight/app.css";
    document.head.appendChild(link);
    (async () => {
      const markup = await fetch("/malletsight/markup.html");
      if (!markup.ok) return;
      const html = await markup.text();
      if (cancelled) return;
      root.innerHTML = html;
      for (const src of SCRIPTS) {
        await loadScript(src);
        if (cancelled) return;
      }
      window.MalletSight?.mount(root);
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
