// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { invoke } from "@tauri-apps/api/core";

import type { Theme } from "@/theme";

export const MAX_OUTPUT_BYTES = 1_000_000;

interface Buffer {
  chunks: Uint8Array[];
  size: number;
  // Read as one stream, so neither a character nor a sequence split across two chunks is misread: the
  // decoder holds a character's remaining bytes and the tail holds an unfinished sequence.
  decoder: TextDecoder;
  tail: string;
  controlTail: string;
  themeReporting: boolean;
}

const buffers = new Map<string, Buffer>();
const listeners = new Map<string, Set<(data: Uint8Array) => void>>();

// Titles and working directories arrive whether or not the session is visible, so their shared OSC
// owner lives here where every session's output arrives rather than in the mounted terminal. Lite's
// Claude status line reports work that produces no terminal output — a parent waiting for subagents,
// a quiet shell command — through a private OSC of its own, which stays invisible and reaches the
// same owner. One pass reads both: every byte a session prints comes through here, so a second
// pattern would be a second reading of all of it.
// biome-ignore lint/suspicious/noControlCharactersInRegex: a control sequence is defined by them
const METADATA = /\x1b\](0|2|7|6973);([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
// Common terminal notification protocols share the OSC owner with titles and working directories.
// Lite needs only the signal for its in-app attention state; the terminal still owns rendering and
// the notification payload is not retained separately from the bounded output buffer.
// biome-ignore lint/suspicious/noControlCharactersInRegex: a terminal notification is defined by them
const NOTIFICATION = /\x1b\](?:9;(?!4;)[^\x07\x1b]*|99;[^\x07\x1b]*|777;notify;[^\x07\x1b]*)(?:\x07|\x1b\\)/;
// A bare bell is the portable fallback used by agent harnesses and shells. Remove completed OSC first
// because their bell terminator is framing, not a notification of its own.
// biome-ignore lint/suspicious/noControlCharactersInRegex: a control sequence is defined by them
const OSC_OR_BELL = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|(\x07)/g;

// The same sequence begun but not yet terminated, which the chunk that ends it completes. A title may
// hold an escape of its own, so the payload ends only at a terminator, and a lone escape is kept
// because the bracket that makes it a title can be the first byte of the next chunk. That last part is
// where this parts company with the rule terminal.tsx applies to what is typed, which deliberately does
// not hold a lone escape back: there it is the Escape key, not the start of anything. Anything longer
// than a title could be is no longer one, so the wait is given up rather than grown.
// biome-ignore lint/suspicious/noControlCharactersInRegex: a control sequence is defined by them
const UNTERMINATED = /\x1b(?:\](?:(?!\x07|\x1b\\)[\s\S])*)?$/;
const MAX_TAIL = 512;
// Modern TUIs request a report whenever the terminal switches between dark and light. This state is
// read here, where every session's output arrives, so background sessions and trimmed buffers keep it.
// biome-ignore lint/suspicious/noControlCharactersInRegex: these are terminal control sequences
const THEME_CONTROL = /\x1b\[\?(2031([hl])|996n)/g;
const CONTROL_TAIL = 7;
let terminalTheme: Theme = "dark";

function themeReport(theme: Theme) {
  return theme === "dark" ? "\x1b[?997;1n" : "\x1b[?997;2n";
}

export function syncTerminalTheme(theme: Theme) {
  terminalTheme = theme;
  for (const [sessionId, buffer] of buffers) {
    if (buffer.themeReporting) writeSession(sessionId, themeReport(theme));
  }
}

// Returns the last title and directory the chunk set, empty when it set neither.
export function appendOutput(sessionId: string, data: number[]) {
  const bytes = new Uint8Array(data);
  const buffer = buffers.get(sessionId) ?? {
    chunks: [],
    size: 0,
    decoder: new TextDecoder(),
    tail: "",
    controlTail: "",
    themeReporting: false,
  };
  buffer.chunks.push(bytes);
  buffer.size += bytes.byteLength;
  while (buffer.size > MAX_OUTPUT_BYTES && buffer.chunks.length > 1) {
    const discarded = buffer.chunks.shift();
    if (discarded) buffer.size -= discarded.byteLength;
  }
  buffers.set(sessionId, buffer);
  for (const listener of listeners.get(sessionId) ?? []) listener(bytes);
  const decoded = buffer.decoder.decode(bytes, { stream: true });
  const controls = buffer.controlTail + decoded;
  const previous = buffer.controlTail.length;
  THEME_CONTROL.lastIndex = 0;
  for (let match = THEME_CONTROL.exec(controls); match; match = THEME_CONTROL.exec(controls)) {
    if (THEME_CONTROL.lastIndex <= previous) continue;
    if (match[1] === "996n") writeSession(sessionId, themeReport(terminalTheme));
    else buffer.themeReporting = match[2] === "h";
  }
  buffer.controlTail = controls.slice(-CONTROL_TAIL);

  const text = buffer.tail + decoded;
  let title = "";
  let path = "";
  let activity: boolean | undefined;
  let notification = NOTIFICATION.test(text);
  OSC_OR_BELL.lastIndex = 0;
  for (let match = OSC_OR_BELL.exec(text); !notification && match; match = OSC_OR_BELL.exec(text))
    notification = Boolean(match[1]);
  METADATA.lastIndex = 0;
  for (let match = METADATA.exec(text); match; match = METADATA.exec(text)) {
    if (match[1] === "7") {
      if (match[2].startsWith("file://"))
        path = decodeURIComponent(new URL(match[2]).pathname).replace(/^\/([A-Za-z]:\/)/, "$1");
    } else if (match[1] === "6973") {
      if (match[2] === "lite-working" || match[2] === "lite-idle") activity = match[2] === "lite-working";
    } else title = match[2];
  }
  const tail = text.match(UNTERMINATED)?.[0] ?? "";
  if (activity === undefined && tail.startsWith("\x1b]6973;lite-")) activity = false;
  buffer.tail = tail.length > MAX_TAIL ? "" : tail;
  return { title, path, activity, notification };
}

export function subscribeOutput(sessionId: string, listener: (data: Uint8Array) => void) {
  const sessionListeners = listeners.get(sessionId) ?? new Set();
  sessionListeners.add(listener);
  listeners.set(sessionId, sessionListeners);
  buffers.get(sessionId)?.chunks.forEach(listener);
  return () => {
    sessionListeners.delete(listener);
  };
}

// The buffer is bytes because a terminal is bytes. Anything that wants to read back what a session
// said needs the same bytes as text, decoded as one stream so a character split across two chunks
// survives the join.
export function readOutput(sessionId: string) {
  const buffer = buffers.get(sessionId);
  if (!buffer) return "";
  const decoder = new TextDecoder();
  return buffer.chunks.map((chunk) => decoder.decode(chunk, { stream: true })).join("") + decoder.decode();
}

export function clearOutput(sessionId: string) {
  buffers.delete(sessionId);
  writes.delete(sessionId);
}

// Everything written to a session goes out behind whatever was written before it. Each call across the
// bridge is dispatched on its own task, so two sent together can reach the pty in either order, and
// bytes that arrive out of order are bytes nobody typed. The order is kept per session and kept here,
// beside the buffers, so a terminal, a restart, and a command a tab was opened to run all share one
// queue rather than each holding its own — an order that only covers the keyboard is not an order.
const writes = new Map<string, Promise<unknown>>();

// Recovery replaces a process behind the same session id. Input arriving while it does waits in the
// existing per-session queue, and a failed replacement releases later writes instead of jamming it.
export function holdSessionWrites(sessionId: string, wait: Promise<unknown>) {
  writes.set(
    sessionId,
    (writes.get(sessionId) ?? Promise.resolve())
      .then(() => wait)
      .catch((reason) => console.error(`Lite could not recover session ${sessionId}:`, reason)),
  );
}

export function writeSession(sessionId: string, text: string) {
  const data = Array.from(new TextEncoder().encode(text));
  writes.set(
    sessionId,
    (writes.get(sessionId) ?? Promise.resolve()).then(() =>
      // A write that fails must not take the writes queued behind it with it, and a session whose pty
      // has gone is reported by the session itself; this is the only record that a keystroke was lost.
      invoke("write_session", { sessionId, data }).catch((reason) =>
        console.error(`Lite could not write to session ${sessionId}:`, reason),
      ),
    ),
  );
}
