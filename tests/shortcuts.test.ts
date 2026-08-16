// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { describe, expect, test } from "bun:test";

const stored = new Map<string, string>();
globalThis.localStorage = {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => void stored.set(key, value),
  removeItem: (key: string) => void stored.delete(key),
} as Storage;

import { eventCombo, fixedShortcut, IS_MAC, matchesShortcut, setShortcutKeys } from "../src/shortcuts";

const key = (init: Partial<KeyboardEvent> & { key: string; code: string }) =>
  ({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...init }) as KeyboardEvent;
const mod = IS_MAC ? { metaKey: true } : { ctrlKey: true };

describe("shortcuts", () => {
  test("defaults match their chords and nothing else", () => {
    expect(matchesShortcut(key({ key: "n", code: "KeyN", ...mod }), "newSession")).toBe(true);
    expect(matchesShortcut(key({ key: "N", code: "KeyN", shiftKey: true, ...mod }), "newSession")).toBe(false);
    expect(matchesShortcut(key({ key: "n", code: "KeyN" }), "newSession")).toBe(false);
    expect(matchesShortcut(key({ key: "U", code: "KeyU", shiftKey: true, ...mod }), "nextAttention")).toBe(true);
  });

  test("zoom in reads ⌘= and ⌘+ alike, from the main keys or the keypad", () => {
    expect(matchesShortcut(key({ key: "=", code: "Equal", ...mod }), "zoomIn")).toBe(true);
    expect(matchesShortcut(key({ key: "+", code: "Equal", shiftKey: true, ...mod }), "zoomIn")).toBe(true);
    expect(matchesShortcut(key({ key: "+", code: "NumpadAdd", ...mod }), "zoomIn")).toBe(true);
    expect(matchesShortcut(key({ key: "-", code: "Minus", ...mod }), "zoomOut")).toBe(true);
    expect(matchesShortcut(key({ key: "0", code: "Numpad0", ...mod }), "zoomReset")).toBe(true);
  });

  test("a recorded chord is spelled the way a default is, and then matched", () => {
    expect(eventCombo(key({ key: "Meta", code: "MetaLeft", metaKey: true }))).toBeUndefined();
    const combo = eventCombo(key({ key: "k", code: "KeyK", altKey: true, ...mod }));
    expect(combo).toBe("Mod+Alt+K");
    setShortcutKeys("settings", combo ?? null);
    expect(matchesShortcut(key({ key: "k", code: "KeyK", altKey: true, ...mod }), "settings")).toBe(true);
    expect(matchesShortcut(key({ key: ",", code: "Comma", ...mod }), "settings")).toBe(false);
    setShortcutKeys("settings", null);
    expect(matchesShortcut(key({ key: ",", code: "Comma", ...mod }), "settings")).toBe(true);
  });

  test("the other platform modifier cannot alter or trigger a binding", () => {
    const opposite = IS_MAC ? { ctrlKey: true } : { metaKey: true };
    expect(eventCombo(key({ key: "k", code: "KeyK", altKey: true, ...opposite }))).toBeUndefined();
    setShortcutKeys("settings", "Alt+K");
    expect(matchesShortcut(key({ key: "k", code: "KeyK", altKey: true, ...opposite }), "settings")).toBe(false);
    setShortcutKeys("settings", null);
  });

  test("recording keeps native and platform editor chords reserved", () => {
    expect(fixedShortcut("Mod+C")?.label).toContain("copy");
    expect(fixedShortcut("Mod+Z")?.label).toContain("Undo");
    expect(fixedShortcut(IS_MAC ? "Mod+Alt+[" : "Mod+Shift+[")?.label).toContain("Fold");
    expect(fixedShortcut("Mod+1")?.label).toContain("place");
  });
});
