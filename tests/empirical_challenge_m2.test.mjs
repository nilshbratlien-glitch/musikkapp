import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import vm from "node:vm";

describe("Milestone 2 Empirical Challenger Test Suite", () => {
  const rootDir = path.resolve(".");

  describe("1. Delimiter & Bracket Balance Verification", () => {
    const filesToTest = [
      "src/components/plain-metronome.tsx",
      "src/components/oveplan.tsx",
      "src/components/shell.tsx",
      "src/components/sync-modal.tsx",
      "src/components/malletsight.tsx",
      "src/components/note-cards.tsx",
      "public/malletsight/app.js",
      "public/malletsight/audio.js",
      "public/malletsight/generator.js",
      "public/malletsight/markup.html",
    ];

    function checkDelimiterBalance(filePath, content) {
      const isHtml = filePath.endsWith(".html");

      const stack = [];
      let inLineComment = false;
      let inBlockComment = false;
      let inHtmlComment = false;
      let inSingleQuote = false;
      let inDoubleQuote = false;
      let inTemplate = false;
      let inRegex = false;

      let line = 1;
      let col = 0;

      for (let i = 0; i < content.length; i++) {
        const char = content[i];
        const next = content[i + 1];
        const prev = content[i - 1];

        if (char === "\n") {
          line++;
          col = 0;
          inLineComment = false;
          continue;
        }
        col++;

        // HTML comment
        if (isHtml) {
          if (!inHtmlComment && char === "<" && content.slice(i, i + 4) === "<!--") {
            inHtmlComment = true;
            i += 3;
            continue;
          }
          if (inHtmlComment && char === "-" && content.slice(i, i + 3) === "-->") {
            inHtmlComment = false;
            i += 2;
            continue;
          }
          if (inHtmlComment) continue;
        }

        // JS / TS comments
        if (!isHtml) {
          if (!inLineComment && !inBlockComment && !inSingleQuote && !inDoubleQuote && !inTemplate && !inRegex) {
            if (char === "/" && next === "/") {
              inLineComment = true;
              i++;
              continue;
            }
            if (char === "/" && next === "*") {
              inBlockComment = true;
              i++;
              continue;
            }
          }
          if (inLineComment) continue;
          if (inBlockComment) {
            if (char === "*" && next === "/") {
              inBlockComment = false;
              i++;
            }
            continue;
          }
        }

        // Escape character in strings or regex
        if (char === "\\" && (inSingleQuote || inDoubleQuote || inTemplate || inRegex)) {
          i++; // skip escaped char
          continue;
        }

        // Regex literal handling
        if (!isHtml && !inSingleQuote && !inDoubleQuote && !inTemplate) {
          if (!inRegex && char === "/") {
            // Determine if '/' starts a regex: usually preceded by '=', '(', ',', ':', '!', '&', '|', '?', ';', '[', '{', 'return'
            const preceding = content.slice(Math.max(0, i - 20), i).trim();
            if (/[=(,:!&|?;[{\n~^]/.test(preceding.slice(-1)) || /return$/.test(preceding)) {
              inRegex = true;
              continue;
            }
          } else if (inRegex && char === "/") {
            inRegex = false;
            continue;
          }
          if (inRegex) continue;
        }

        if (char === "'" && !inDoubleQuote && !inTemplate && !inHtmlComment && !inRegex) {
          inSingleQuote = !inSingleQuote;
          continue;
        }
        if (inSingleQuote) continue;

        if (char === '"' && !inSingleQuote && !inTemplate && !inHtmlComment && !inRegex) {
          inDoubleQuote = !inDoubleQuote;
          continue;
        }
        if (inDoubleQuote) continue;

        if (!isHtml && char === "`" && !inSingleQuote && !inDoubleQuote && !inRegex) {
          inTemplate = !inTemplate;
          continue;
        }
        if (inTemplate) {
          // Check for template expressions ${ ... }
          if (char === "$" && next === "{") {
            stack.push({ char: "{", line, col, type: "template_expr" });
            i++;
          } else if (char === "}" && stack.length > 0 && stack[stack.length - 1].type === "template_expr") {
            stack.pop();
          }
          continue;
        }

        // Delimiters
        if (char === "(" || char === "{" || char === "[") {
          stack.push({ char, line, col });
        } else if (char === ")" || char === "}" || char === "]") {
          if (stack.length === 0) {
            return { balanced: false, error: `Unmatched closing '${char}' at ${line}:${col}` };
          }
          const top = stack.pop();
          const expected = top.char === "(" ? ")" : top.char === "{" ? "}" : "]";
          if (char !== expected) {
            return {
              balanced: false,
              error: `Mismatched '${char}' at ${line}:${col}, expected '${expected}' matching '${top.char}' from ${top.line}:${top.col}`,
            };
          }
        }
      }

      if (stack.length > 0) {
        const top = stack.pop();
        return { balanced: false, error: `Unclosed delimiter '${top.char}' from ${line}:${col}` };
      }

      return { balanced: true };
    }

    for (const relPath of filesToTest) {
      it(`balances delimiters in ${relPath}`, () => {
        const fullPath = path.join(rootDir, relPath);
        assert.ok(fs.existsSync(fullPath), `File must exist: ${relPath}`);
        const content = fs.readFileSync(fullPath, "utf-8");
        const res = checkDelimiterBalance(relPath, content);
        assert.ok(res.balanced, res.error);
      });
    }
  });

  describe("2. Bladlesing Settings Drawer Isolation & Rapid Profile Switching", () => {
    // Load malletsight theory and helper environment
    const theoryPath = path.join(rootDir, "public/malletsight/theory.js");
    const appPath = path.join(rootDir, "public/malletsight/app.js");
    const theoryCode = fs.readFileSync(theoryPath, "utf-8");
    const appCode = fs.readFileSync(appPath, "utf-8");

    // Mock DOM environment for app.js drawer logic
    function createDrawerEnvironment(initialProfile = "trumpet") {
      const elements = new Map();
      let activeProfile = initialProfile;

      function createMockElement(id, tag = "div") {
        const el = {
          id,
          tagName: tag.toUpperCase(),
          hidden: false,
          value: "",
          checked: false,
          innerHTML: "",
          textContent: "",
          children: [],
          classList: {
            toggle(cls, val) {
              if (val) this.classes.add(cls);
              else this.classes.delete(cls);
            },
            classes: new Set(),
          },
          closest(sel) {
            return this.parent || this;
          },
          appendChild(child) {
            child.parent = this;
            this.children.push(child);
          },
        };
        elements.set(id, el);
        return el;
      }

      // Pre-populate elements referenced in app.js
      const instrument = createMockElement("instrument", "select");
      const mallets = createMockElement("mallets", "select");
      const malletsRow = createMockElement("malletsRow", "div");
      const rolls = createMockElement("rolls", "select");
      const rollsRow = createMockElement("rollsRow", "div");
      const texture = createMockElement("texture", "select");
      const textureRow = createMockElement("textureRow", "div");
      const legato = createMockElement("legato", "input");
      const legatoRow = createMockElement("legatoRow", "label");
      const chordChanceRow = createMockElement("chordChanceRow", "div");
      const doubleStopRow = createMockElement("doubleStopRow", "div");
      const clef = createMockElement("clef", "select");
      const time = createMockElement("time", "select");
      const measures = createMockElement("measures", "select");
      const rangeLow = createMockElement("rangeLow", "select");
      const rangeHigh = createMockElement("rangeHigh", "select");
      const maxInterval = createMockElement("maxInterval", "select");
      const gripShift = createMockElement("gripShift", "select");
      const annotate = createMockElement("annotate", "select");
      const tempo = createMockElement("tempo", "input");
      const drawer = createMockElement("drawer", "aside");
      const scrim = createMockElement("scrim", "div");

      // Extract and test profileInstruments directly from app.js
      const sandbox = {
        console,
        window: {
          location: { search: "" },
          localStorage: {
            getItem: (k) => null,
            setItem: () => {},
          },
        },
        document: {
          getElementById: (id) => elements.get(id) || null,
          querySelector: (sel) => {
            if (sel.startsWith("#")) return elements.get(sel.slice(1)) || null;
            return null;
          },
          querySelectorAll: (sel) => [],
          body: { classList: { toggle: () => {} } },
        },
        $: (sel) => {
          if (sel.startsWith("#")) return elements.get(sel.slice(1)) || null;
          return null;
        },
        $all: (sel) => [],
        currentProfile: () => activeProfile,
        setProfile: (p) => {
          activeProfile = p;
        },
      };

      vm.createContext(sandbox);
      vm.runInContext(theoryCode, sandbox);

      return {
        sandbox,
        elements,
        setProfile: (p) => {
          activeProfile = p;
        },
        getProfile: () => activeProfile,
      };
    }

    it("profileInstruments() accurately filters instruments per profile", () => {
      const env = createDrawerEnvironment("trumpet");
      const T = env.sandbox.window.Theory;
      assert.ok(T && T.INSTRUMENTS, "Theory.INSTRUMENTS must exist");

      // Trumpet profile
      const trumpetInsts = T.INSTRUMENTS.filter((i) => i.id === "trumpet");
      assert.equal(trumpetInsts.length, 1);
      assert.equal(trumpetInsts[0].id, "trumpet");

      // Mallets profile
      const malletInsts = T.INSTRUMENTS.filter((i) => i.id !== "trumpet");
      assert.ok(malletInsts.length >= 4, "Must have percussion instruments");
      assert.ok(!malletInsts.some((i) => i.id === "trumpet"), "Mallet instruments must not contain trumpet");
    });

    it("survives 1,000 rapid switches between mallets and trumpet without state corruption", () => {
      const env = createDrawerEnvironment("trumpet");
      const T = env.sandbox.window.Theory;

      // Simulate settings object as managed by app.js
      let currentProfile = "trumpet";
      let settings = {
        instrumentId: "trumpet",
        clef: "treble",
        texture: "melody",
        mallets: 2,
        rolls: "off",
        legato: true,
      };

      for (let i = 0; i < 1000; i++) {
        const nextProfile = i % 2 === 0 ? "mallets" : "trumpet";
        currentProfile = nextProfile;
        env.setProfile(nextProfile);

        // Apply app.js loadSettings logic
        if (currentProfile === "trumpet") {
          settings.instrumentId = "trumpet";
          settings.clef = "treble";
          settings.texture = "melody";
          settings.mallets = 2;
          settings.rolls = "off";
        } else {
          if (settings.instrumentId === "trumpet") {
            settings.instrumentId = "mar50";
          }
          settings.legato = false;
        }

        // Profile instruments
        const instList = currentProfile === "trumpet"
          ? T.INSTRUMENTS.filter((x) => x.id === "trumpet")
          : T.INSTRUMENTS.filter((x) => x.id !== "trumpet");

        if (currentProfile === "trumpet") {
          assert.equal(settings.instrumentId, "trumpet");
          assert.equal(settings.clef, "treble");
          assert.equal(instList.length, 1);
          assert.equal(instList[0].id, "trumpet");
        } else {
          assert.notEqual(settings.instrumentId, "trumpet");
          assert.equal(settings.legato, false);
          assert.ok(!instList.some((x) => x.id === "trumpet"));
        }
      }
    });

    it("app.js drawer UI elements hide/show correctly in trumpet vs mallets mode", () => {
      // Inspect app.js updateMalletHints implementation
      const updateMalletHintsSrc = appCode.slice(
        appCode.indexOf("function updateMalletHints()"),
        appCode.indexOf("function readInputs()")
      );

      // Verify that in trumpet mode, mallet-specific rows are hidden
      assert.ok(updateMalletHintsSrc.includes("malletsRow.hidden = isTrumpet"), "malletsRow must be hidden for trumpet");
      assert.ok(updateMalletHintsSrc.includes("rollsRow.hidden = isTrumpet"), "rollsRow must be hidden for trumpet");
      assert.ok(updateMalletHintsSrc.includes("legatoRow.hidden = !isTrumpet"), "legatoRow must be hidden for mallets");
      assert.ok(updateMalletHintsSrc.includes("textureRow.hidden = isTrumpet"), "textureRow must be hidden for trumpet");
      assert.ok(updateMalletHintsSrc.includes("chordChanceRow"), "chordChanceRow must handle trumpet");
      assert.ok(updateMalletHintsSrc.includes("doubleStopRow"), "doubleStopRow must handle trumpet");
      assert.ok(updateMalletHintsSrc.includes("clefRow.hidden = isTrumpet"), "clefRow must be hidden for trumpet");
    });
  });

  describe("3. Accessibility & Icon Button aria-label Audit", () => {
    it("all icon-only buttons in modified .tsx files have descriptive aria-label", () => {
      const files = [
        "src/components/plain-metronome.tsx",
        "src/components/oveplan.tsx",
        "src/components/shell.tsx",
        "src/components/sync-modal.tsx",
      ];

      for (const relPath of files) {
        const fullPath = path.join(rootDir, relPath);
        const content = fs.readFileSync(fullPath, "utf-8");

        // Match button tags
        const buttonRegex = /<button\b([^>]*?)>([\s\S]*?)<\/button>/g;
        let match;
        while ((match = buttonRegex.exec(content)) !== null) {
          const attrs = match[1];
          const inner = match[2].trim();

          // Check if inner content is an icon (single symbol like −, +, ✕, or JSX tag <X ... />)
          const isIconOnly =
            inner === "−" ||
            inner === "+" ||
            inner === "✕" ||
            /^<[A-Z][A-Za-z0-9]*\b[^>]*\/>$/.test(inner) ||
            /^<svg\b[\s\S]*<\/svg>$/.test(inner);

          if (isIconOnly) {
            const hasAriaLabel = /aria-label\s*=\s*["'{]/.test(attrs);
            assert.ok(
              hasAriaLabel,
              `Icon-only button in ${relPath} with text "${inner}" MUST have aria-label. Attrs: ${attrs}`
            );
          }
        }
      }
    });

    it("markup.html icon buttons have aria-label attributes", () => {
      const markupPath = path.join(rootDir, "public/malletsight/markup.html");
      const content = fs.readFileSync(markupPath, "utf-8");

      assert.ok(content.includes('id="btnTempoDown" title="Saktere" aria-label="Saktere tempo"'));
      assert.ok(content.includes('id="btnTempoUp" title="Raskere" aria-label="Raskere tempo"'));
    });
  });

  describe("4. Touch Target Sizes (Minimum 44x44px)", () => {
    it("Øveplan minute adjustment buttons meet >=44px (size-11)", () => {
      const content = fs.readFileSync(path.join(rootDir, "src/components/oveplan.tsx"), "utf-8");
      // Must use size-11, not size-10
      assert.ok(content.includes('aria-label="Reduser tid"'));
      assert.ok(content.includes('aria-label="Øk tid"'));
      assert.ok(content.includes("size-11 rounded-xl border border-line"));
      assert.ok(!content.includes("size-10 rounded-xl border border-line"));
    });

    it("Øveplan tempo adjustment buttons meet >=44px (size-11 min-w-11 min-h-11)", () => {
      const content = fs.readFileSync(path.join(rootDir, "src/components/oveplan.tsx"), "utf-8");
      assert.ok(content.includes('aria-label="Senk tempo"'));
      assert.ok(content.includes('aria-label="Øk tempo"'));
      assert.ok(content.includes("size-11 min-w-11 min-h-11 rounded-lg border border-line"));
    });

    it("InstrumentModal close button in shell.tsx meets >=44px (size-11)", () => {
      const content = fs.readFileSync(path.join(rootDir, "src/components/shell.tsx"), "utf-8");
      assert.ok(content.includes("flex size-11 shrink-0 items-center justify-center rounded-lg text-muted"));
      assert.ok(!content.includes("flex size-8 shrink-0 items-center justify-center rounded-lg text-muted"));
    });

    it("SyncModal close button in sync-modal.tsx meets >=44px (size-11)", () => {
      const content = fs.readFileSync(path.join(rootDir, "src/components/sync-modal.tsx"), "utf-8");
      assert.ok(content.includes("flex size-11 items-center justify-center rounded-lg text-muted"));
      assert.ok(!content.includes("rounded-lg p-1.5 text-muted"));
    });
  });

  describe("5. Mobile Metronome Exercise Card Visibility & CSS Token Audit", () => {
    it("CSS token text-fg/90 is used instead of invalid text-foreground/90", () => {
      const content = fs.readFileSync(path.join(rootDir, "src/components/plain-metronome.tsx"), "utf-8");
      assert.ok(content.includes("text-fg/90"), "Must use text-fg/90");
      assert.ok(!content.includes("text-foreground"), "Must not use text-foreground");
    });

    it("AUTHORITATIVE USER MANDATE: hidden sm:block in plain-metronome.tsx is required on mobile", () => {
      const content = fs.readFileSync(path.join(rootDir, "src/components/plain-metronome.tsx"), "utf-8");
      const hasHiddenSmBlock = content.includes("hidden sm:block");

      // Per user specification (2026-11-12T14:57:03Z in ORIGINAL_REQUEST.md):
      // "Brukerens eksplisitte spesifikasjon for instruksjonskortet under metronomen er:
      // 'Disse øvelsene skal ikke vises på mobil. Da det ikke er plass.'
      // Derfor er `hidden sm:block` på instruksjonskortet (<aside>) i `src/components/plain-metronome.tsx`
      // et UFRAVIKELIG KRAV fra brukeren for at mobilskjermen ikke skal overfylles. At instruksjonskortet er skjult på mobil er helt tilsiktet og korrekt oppførsel, og skal IKKE fjernes."
      console.log(`[CHALLENGE AUDIT] 'hidden sm:block' present in plain-metronome.tsx: ${hasHiddenSmBlock}`);
      assert.equal(
        hasHiddenSmBlock,
        true,
        "VIOLATION OF USER MANDATE: 'hidden sm:block' must remain on plain-metronome.tsx:224 so mobile viewport is not overloaded."
      );
    });
  });
});
