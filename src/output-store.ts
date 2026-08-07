// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

const MAX_BYTES = 1_000_000;

interface Buffer {
  chunks: Uint8Array[];
  size: number;
}

const buffers = new Map<string, Buffer>();
const listeners = new Map<string, Set<(data: Uint8Array) => void>>();

export function appendOutput(sessionId: string, data: number[]) {
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
}
