import { mock } from "node:test";

// A fake Web Audio graph: enough to see which contexts exist, which sources start
// when, and whether a source can still reach the speakers.
export class FakeNode {
  connected: FakeNode[] = [];
  disconnected = false;
  connect(node: FakeNode) {
    this.connected.push(node);
    return node;
  }
  disconnect() {
    this.disconnected = true;
  }
}
class FakeParam {
  value = 1;
  setValueAtTime(value: number) {
    this.value = value;
  }
  exponentialRampToValueAtTime() {}
}
class FakeGain extends FakeNode {
  gain = new FakeParam();
}
export const started: FakeOsc[] = [];
class FakeOsc extends FakeNode {
  frequency = new FakeParam();
  type = "";
  at = -1;
  start(time: number) {
    this.at = time;
    started.push(this);
  }
  stop() {}
}
export const contexts: FakeContext[] = [];
class FakeContext {
  currentTime = 0;
  state = "running";
  destination = new FakeNode();
  constructor() {
    contexts.push(this);
  }
  createGain() {
    return new FakeGain();
  }
  createOscillator() {
    return new FakeOsc();
  }
  resumes = 0;
  resume() {
    this.resumes++;
    this.state = "running";
    return Promise.resolve();
  }
}
const g = globalThis as Record<string, unknown>;
g.AudioContext = FakeContext;
g.window = globalThis;

// A page that can be hidden and shown: document visibility plus window page events.
class FakeDocument extends EventTarget {
  visibilityState: "visible" | "hidden" = "visible";
}
export const fakeDocument = new FakeDocument();
g.document = fakeDocument;
const pageEvents = new EventTarget();
g.addEventListener = pageEvents.addEventListener.bind(pageEvents);
g.removeEventListener = pageEvents.removeEventListener.bind(pageEvents);
g.dispatchEvent = pageEvents.dispatchEvent.bind(pageEvents);

/** Hide or show the page the way a browser does: visibilitychange, then pagehide or pageshow. */
export function setPageVisible(visible: boolean) {
  fakeDocument.visibilityState = visible ? "visible" : "hidden";
  fakeDocument.dispatchEvent(new Event("visibilitychange"));
  pageEvents.dispatchEvent(new Event(visible ? "pageshow" : "pagehide"));
}


/** True while a source still has a connected path to the context's speakers. */
export function audible(node: FakeNode): boolean {
  if (node instanceof FakeNode && node.disconnected) return false;
  if (contexts.some((ctx) => ctx.destination === node)) return true;
  return node.connected.some(audible);
}

export function advance(ms: number) {
  const ctx = contexts[0]!;
  for (let t = 0; t < ms; t += 25) {
    ctx.currentTime += 0.025;
    mock.timers.tick(25);
  }
}

export function clicksBetween(from: number, to: number) {
  return started.filter((osc) => osc.at >= from && osc.at < to).length;
}

