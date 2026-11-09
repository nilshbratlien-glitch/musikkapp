// Helpers for the Safari 15.6 checks (iPadOS 15.8). Safari 15.6 has oklch() and @layer (15.4),
// but not color-mix() (16.2), @property (16.4) or media query range syntax (16.4).

/** Each `@supports (...) { ... }` block in `css`, with its condition, body and offsets. */
export function supportsBlocks(css) {
  const blocks = [];
  let from = 0;
  for (;;) {
    const at = css.indexOf("@supports", from);
    if (at < 0) return blocks;
    const open = css.indexOf("{", at);
    let depth = 0;
    let end = open;
    for (; end < css.length; end++) {
      if (css[end] === "{") depth++;
      else if (css[end] === "}" && --depth === 0) break;
    }
    blocks.push({ start: at, end: end + 1, condition: css.slice(at + 9, open).trim(), body: css.slice(open + 1, end) });
    from = open + 1;
  }
}

/** A colour that is only a custom property, e.g. `var(--block)`: as a color-mix fallback it drops the mix's transparency. */
const BARE_VAR = /^var\(--[\w-]+(,\s*(#[0-9a-f]{3,8}|var\(--[\w-]+\)))?\)$/i;

/**
 * Problems in a stylesheet that Safari 15.6 would show wrong. Every color-mix() has to sit in an
 * `@supports (color: color-mix(...))` block whose rule has a fallback before it that keeps the
 * transparency (not the unmixed `var(--x)`), and no media query may use range syntax.
 */
export function safari15Problems(source, name) {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const problems = [];
  const guarded = supportsBlocks(css).filter((b) => /color-mix/.test(b.condition));
  const inGuard = (i) => guarded.some((b) => i > b.start && i < b.end);
  for (let i = css.indexOf("color-mix("); i >= 0; i = css.indexOf("color-mix(", i + 1)) {
    if (!inGuard(i)) problems.push(`${name}: color-mix() outside @supports near «${css.slice(Math.max(0, i - 60), i + 40)}»`);
  }
  for (const block of guarded) {
    for (const rule of block.body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = rule[1].trim();
      for (const decl of rule[2].split(";").filter((d) => d.includes("color-mix("))) {
        const prop = decl.slice(0, decl.indexOf(":")).trim();
        const before = css.slice(0, block.start);
        const heads = [...before.matchAll(/([^{}]+)\{/g)].filter((m) => m[1].trim() === selector);
        const head = heads.at(-1);
        const at = head ? head.index + head[0].length : -1;
        const body = at >= 0 ? before.slice(at, before.indexOf("}", at)) : "";
        const fallback = body
          .split(";")
          .map((d) => d.trim())
          .filter((d) => d.startsWith(`${prop}:`))
          .at(-1);
        if (!fallback) {
          problems.push(`${name}: ${selector} has no ${prop} fallback before its color-mix()`);
          continue;
        }
        const value = fallback.slice(prop.length + 1).trim();
        const colour = value.replace(/^\d+px solid /, "");
        if (BARE_VAR.test(colour)) problems.push(`${name}: ${selector} falls back to an opaque ${prop}: ${value}`);
      }
    }
  }
  for (const m of css.matchAll(/@media[^{]*\((width|height)\s*[<>]=?/g)) problems.push(`${name}: media range syntax «${m[0]}»`);
  if (css.includes("@property") && !/@layer properties\{@supports \(\(\(-webkit-hyphens:none\)\)/.test(css)) {
    problems.push(`${name}: @property without Tailwind's @layer properties fallback for Safari`);
  }
  return problems;
}

/**
 * The stylesheet as Safari 15.6 sees it: color-mix() unsupported, @property ignored, and
 * Tailwind's WebKit-only `@layer properties` fallback switched on.
 */
export function asSafari15(css) {
  let out = css;
  for (const block of supportsBlocks(out).filter((b) => /color-mix/.test(b.condition)).reverse()) {
    out = out.slice(0, block.start) + out.slice(block.end);
  }
  out = out.replace(/@property\s+[\w-]+\s*\{[^}]*\}/g, "");
  out = out.replace(/@supports \(\(\(-webkit-hyphens:none\)\)[^{]*\{/g, "@supports (display:block){");
  // A color-mix() left outside @supports: a value with var() is invalid at computed time (unset), one without is dropped.
  out = out.replace(/([\w-]+)\s*:\s*([^;{}]*color-mix\([^;{}]*)/g, (_, prop, value) => (value.includes("var(") ? `${prop}:unset` : ""));
  return out;
}

/** In the page: WCAG contrast of an element's text against what is painted behind it. */
export function contrastInPage(el) {
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const rgba = (css) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000";
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return { r, g, b, a: a / 255 };
  };
  const over = (top, bottom) => ({
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  });
  const layers = [];
  for (let node = el; node; node = node.parentElement) {
    const c = rgba(getComputedStyle(node).backgroundColor);
    if (c.a > 0) layers.push(c);
    if (c.a === 1) break;
  }
  let back = { r: 0, g: 0, b: 0, a: 1 };
  for (const layer of layers.reverse()) back = over(layer, back);
  const text = over(rgba(getComputedStyle(el).color), back);
  const lum = ({ r, g, b }) => {
    const ch = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
  };
  const [hi, lo] = [lum(text), lum(back)].sort((x, y) => y - x);
  const hex = (c) => "#" + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  return { ratio: (hi + 0.05) / (lo + 0.05), text: hex(text), back: hex(back) };
}
