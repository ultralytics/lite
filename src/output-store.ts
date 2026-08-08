// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

const MAX_BYTES = 1_000_000;

interface Buffer {
  chunks: Uint8Array[];
  size: number;
}

const buffers = new Map<string, Buffer>();
const listeners = new Map<string, Set<(data: Uint8Array) => void>>();

// A program names the window it runs in with OSC 0 or 2, and an agent names it with a short summary of
// what the session is doing. The title arrives in the output whether or not the session is the one on
// screen, so it is read here, where every session's bytes land, rather than from the single terminal
// that happens to be mounted.
// biome-ignore lint/suspicious/noControlCharactersInRegex: a control sequence is defined by them
const TITLE = /\x1b\][02];([^\x07\x1b]*)(?:\x07|\x1b\\)/g;

// The same sequence begun but not yet terminated, which the chunk that ends it completes. Anything
// longer than a title could be is no longer one, so the wait is given up rather than grown.
// biome-ignore lint/suspicious/noControlCharactersInRegex: a control sequence is defined by them
const PARTIAL = /\x1b(?:\][^\x07\x1b]*)?$/;
const MAX_PARTIAL = 512;

interface Stream {
  decoder: TextDecoder;
  partial: string;
}

const streams = new Map<string, Stream>();

// Returns the last window title the chunk set, empty when it set none.
export function appendOutput(sessionId: string, data: number[]): string {
  const bytes = new Uint8Array(data);
  const buffer = buffers.get(sessionId) ?? { chunks: [], size: 0 };
  buffer.chunks.push(bytes);
  buffer.size += bytes.byteLength;
  while (buffer.size > MAX_BYTES && buffer.chunks.length > 1) {
    const discarded = buffer.chunks.shift();
    if (discarded) buffer.size -= discarded.byteLength;
  }
  buffers.set(sessionId, buffer);
  for (const listener of listeners.get(sessionId) ?? []) listener(bytes);
  // Decoded as one stream, so neither a character nor a sequence split across two chunks is misread.
  const stream = streams.get(sessionId) ?? { decoder: new TextDecoder(), partial: "" };
  streams.set(sessionId, stream);
  const text = stream.partial + stream.decoder.decode(bytes, { stream: true });
  let title = "";
  let read = 0;
  TITLE.lastIndex = 0;
  for (let match = TITLE.exec(text); match; match = TITLE.exec(text)) {
    title = match[1];
    read = TITLE.lastIndex;
  }
  const partial = text.slice(read).match(PARTIAL)?.[0] ?? "";
  stream.partial = partial.length > MAX_PARTIAL ? "" : partial;
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

export function clearOutput(sessionId: string) {
  buffers.delete(sessionId);
  streams.delete(sessionId);
}
