// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { invoke } from "@tauri-apps/api/core";

const MAX_BYTES = 1_000_000;

interface Buffer {
  chunks: Uint8Array[];
  size: number;
  // Read as one stream, so neither a character nor a sequence split across two chunks is misread: the
  // decoder holds a character's remaining bytes and the tail holds an unfinished sequence.
  decoder: TextDecoder;
  tail: string;
}

const buffers = new Map<string, Buffer>();
const listeners = new Map<string, Set<(data: Uint8Array) => void>>();

// A program names the window it runs in with OSC 0 or 2, and an agent names it with a short summary of
// what the session is doing. The title arrives in the output whether or not the session is the one on
// screen, so it is read here, where every session's bytes land, rather than from the single terminal
// that happens to be mounted.
// biome-ignore lint/suspicious/noControlCharactersInRegex: a control sequence is defined by them
const TITLE = /\x1b\][02];([^\x07\x1b]*)(?:\x07|\x1b\\)/g;

// The same sequence begun but not yet terminated, which the chunk that ends it completes. A title may
// hold an escape of its own, so the payload ends only at a terminator, and a lone escape is kept
// because the bracket that makes it a title can be the first byte of the next chunk. That last part is
// where this parts company with the rule terminal.tsx applies to what is typed, which deliberately does
// not hold a lone escape back: there it is the Escape key, not the start of anything. Anything longer
// than a title could be is no longer one, so the wait is given up rather than grown.
// biome-ignore lint/suspicious/noControlCharactersInRegex: a control sequence is defined by them
const UNTERMINATED = /\x1b(?:\](?:(?!\x07|\x1b\\)[\s\S])*)?$/;
const MAX_TAIL = 512;

// Returns the last window title the chunk set, empty when it set none.
export function appendOutput(sessionId: string, data: number[]): string {
  const bytes = new Uint8Array(data);
  const buffer = buffers.get(sessionId) ?? { chunks: [], size: 0, decoder: new TextDecoder(), tail: "" };
  buffer.chunks.push(bytes);
  buffer.size += bytes.byteLength;
  while (buffer.size > MAX_BYTES && buffer.chunks.length > 1) {
    const discarded = buffer.chunks.shift();
    if (discarded) buffer.size -= discarded.byteLength;
  }
  buffers.set(sessionId, buffer);
  for (const listener of listeners.get(sessionId) ?? []) listener(bytes);
  const text = buffer.tail + buffer.decoder.decode(bytes, { stream: true });
  let title = "";
  let read = 0;
  TITLE.lastIndex = 0;
  for (let match = TITLE.exec(text); match; match = TITLE.exec(text)) {
    title = match[1];
    read = TITLE.lastIndex;
  }
  const tail = text.slice(read).match(UNTERMINATED)?.[0] ?? "";
  buffer.tail = tail.length > MAX_TAIL ? "" : tail;
  return title;
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

export function clearBufferedOutput(sessionId: string) {
  buffers.delete(sessionId);
}

export function clearOutput(sessionId: string) {
  clearBufferedOutput(sessionId);
  writes.delete(sessionId);
}

// Everything written to a session goes out behind whatever was written before it. Each call across the
// bridge is dispatched on its own task, so two sent together can reach the pty in either order, and
// bytes that arrive out of order are bytes nobody typed. The order is kept per session and kept here,
// beside the buffers, so a terminal, a restart, and a command a tab was opened to run all share one
// queue rather than each holding its own — an order that only covers the keyboard is not an order.
const writes = new Map<string, Promise<unknown>>();

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
