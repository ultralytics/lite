// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { useSyncExternalStore } from "react";

import { Kbd, KbdGroup } from "@/components/ui/kbd";

const SHORTCUTS_KEY = "lite.shortcuts.v1";

export const IS_MAC = navigator.platform.includes("Mac");

export type ShortcutId =
  | "newSession"
  | "switchSession"
  | "closeSession"
  | "nextSession"
  | "previousSession"
  | "nextAttention"
  | "settings"
  | "find"
  | "saveFile"
  | "zoomIn"
  | "zoomOut"
  | "zoomReset";

// A shortcut is written "Mod+Shift+P": modifiers in Mod, Alt, Shift order, then one key. Mod is ⌘ on
// macOS and Ctrl elsewhere, so one default reads the same on every keyboard.
export const SHORTCUTS: Record<ShortcutId, { label: string; keys: string }> = {
  newSession: { label: "New session", keys: "Mod+N" },
  switchSession: { label: "Switch session or run a command", keys: IS_MAC ? "Mod+P" : "Mod+Shift+P" },
  closeSession: { label: "Close session or file", keys: "Mod+W" },
  nextSession: { label: "Next session", keys: "Mod+Shift+]" },
  previousSession: { label: "Previous session", keys: "Mod+Shift+[" },
  nextAttention: { label: "Open the next session waiting on you", keys: "Mod+Shift+U" },
  settings: { label: "Open settings", keys: "Mod+," },
  find: { label: "Find in the focused panel", keys: "Mod+F" },
  saveFile: { label: "Save file", keys: "Mod+S" },
  zoomIn: { label: "Zoom in", keys: "Mod+=" },
  zoomOut: { label: "Zoom out", keys: "Mod+-" },
  zoomReset: { label: "Actual size", keys: "Mod+0" },
};

export const SHORTCUT_IDS = Object.keys(SHORTCUTS) as ShortcutId[];

// The keys Lite keeps as they are: they count or point rather than name one action, or they belong
// to the editor, whose keymap is CodeMirror's.
export const FIXED_SHORTCUTS: { title: string; rows: { label: string; keys: string[] }[] }[] = [
  {
    title: "Always",
    rows: [
      { label: "Open a session by its place in the list", keys: ["Mod+1…9"] },
      { label: "Move a session up or down the list", keys: ["Alt+ArrowUp", "Alt+ArrowDown"] },
      { label: "Next or previous match", keys: ["Enter", "Shift+Enter"] },
      { label: "Close a search, preview, or dialog", keys: ["Escape"] },
    ],
  },
  {
    title: "Editor",
    rows: [
      { label: "Go to line", keys: ["Mod+Alt+G"] },
      { label: "Add the next occurrence to the selection", keys: ["Mod+D"] },
      { label: "Add a cursor above or below", keys: ["Mod+Alt+ArrowUp", "Mod+Alt+ArrowDown"] },
      { label: "Move the line up or down", keys: ["Alt+ArrowUp", "Alt+ArrowDown"] },
      { label: "Toggle a comment", keys: ["Mod+/"] },
      { label: "Indent or outdent", keys: ["Tab", "Shift+Tab"] },
      { label: "Fold or unfold", keys: ["Mod+Alt+[", "Mod+Alt+]"] },
    ],
  },
];

function readOverrides(): Partial<Record<ShortcutId, string>> {
  try {
    const saved = JSON.parse(localStorage.getItem(SHORTCUTS_KEY) ?? "{}");
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
}

let overrides = readOverrides();
const listeners = new Set<() => void>();

export function shortcutKeys(id: ShortcutId): string {
  return overrides[id] ?? SHORTCUTS[id].keys;
}

// A change stores only what differs from the defaults, so a reset is a removal and a fresh install
// starts with nothing written.
export function setShortcutKeys(id: ShortcutId, keys: string | null) {
  const next = { ...overrides };
  if (keys === null || keys === SHORTCUTS[id].keys) delete next[id];
  else next[id] = keys;
  overrides = next;
  if (Object.keys(next).length) localStorage.setItem(SHORTCUTS_KEY, JSON.stringify(next));
  else localStorage.removeItem(SHORTCUTS_KEY);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useShortcutKeys(id: ShortcutId): string {
  return useSyncExternalStore(subscribe, () => shortcutKeys(id));
}

interface Combo {
  mod: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

function parse(keys: string): Combo {
  const parts = keys.split("+");
  const key = parts.pop() ?? "";
  return { mod: parts.includes("Mod"), alt: parts.includes("Alt"), shift: parts.includes("Shift"), key };
}

function format(combo: Combo): string {
  const key = combo.key.length === 1 ? combo.key.toUpperCase() : combo.key;
  return [combo.mod && "Mod", combo.alt && "Alt", combo.shift && "Shift", key].filter(Boolean).join("+");
}

// Punctuation is named by its physical key so a chord reads the same whether or not Shift changed the
// character; letters and digits keep the character the layout gives them.
const CODE_KEYS: Record<string, string> = {
  Equal: "=",
  NumpadAdd: "=",
  Minus: "-",
  NumpadSubtract: "-",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  BracketLeft: "[",
  BracketRight: "]",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
};
const MODIFIER_KEYS = new Set(["Meta", "Control", "Alt", "Shift", "CapsLock", "Fn"]);

function eventKey(event: KeyboardEvent | { key: string; code: string }): string {
  const named = CODE_KEYS[event.code];
  if (named) return named;
  if (/^Numpad\d$/.test(event.code)) return event.code.slice(-1);
  return event.key.length === 1 ? event.key.toLowerCase() : event.key;
}

// The combo an event spells, or nothing while only modifiers are down. ⌘+ is ⌘= with Shift held, and
// every app reads it as zoom in, so that one key does not count Shift.
export function eventCombo(event: KeyboardEvent): string | undefined {
  if (MODIFIER_KEYS.has(event.key)) return;
  const key = eventKey(event);
  const mod = IS_MAC ? event.metaKey : event.ctrlKey;
  return format({ mod, alt: event.altKey, shift: event.shiftKey && key !== "=", key });
}

export function matchesShortcut(event: KeyboardEvent, id: ShortcutId): boolean {
  const combo = parse(shortcutKeys(id));
  const mod = IS_MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (combo.mod !== mod || combo.alt !== event.altKey) return false;
  const key = eventKey(event);
  if (key.toLowerCase() !== combo.key.toLowerCase()) return false;
  return combo.shift === (event.shiftKey && key !== "=");
}

const KEY_LABELS: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Escape: "Esc",
  Enter: IS_MAC ? "↩" : "Enter",
  Backspace: IS_MAC ? "⌫" : "Backspace",
  Delete: IS_MAC ? "⌦" : "Del",
  " ": "Space",
  Tab: IS_MAC ? "⇥" : "Tab",
};

// The keys as they are printed on a keycap: glyphs on macOS, words elsewhere. Each entry is one cap.
function shortcutCaps(keys: string): string[] {
  return keys.split("+").map((part) => {
    if (part === "Mod") return IS_MAC ? "⌘" : "Ctrl";
    if (part === "Alt") return IS_MAC ? "⌥" : "Alt";
    if (part === "Shift") return IS_MAC ? "⇧" : "Shift";
    return KEY_LABELS[part] ?? (part.length === 1 ? part.toUpperCase() : part);
  });
}

// The caps as keycaps, one Kbd each.
export function ShortcutCaps({ keys }: { keys: string }) {
  return (
    <KbdGroup>
      {shortcutCaps(keys).map((cap) => (
        <Kbd key={cap}>{cap}</Kbd>
      ))}
    </KbdGroup>
  );
}

// The same keys as one word for a tooltip: "⌘⇧P" on macOS, "Ctrl+Shift+P" elsewhere.
export function shortcutText(id: ShortcutId): string {
  return shortcutCaps(shortcutKeys(id)).join(IS_MAC ? "" : "+");
}

// The keys spelled the way aria-keyshortcuts wants them.
export function shortcutAria(id: ShortcutId): string {
  return shortcutKeys(id)
    .split("+")
    .map((part) => (part === "Mod" ? (IS_MAC ? "Meta" : "Control") : part.length === 1 ? part.toUpperCase() : part))
    .join("+");
}
