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
    buffer.size -= buffer.chunks.shift()!.byteLength;
  }
  buffers.set(sessionId, buffer);
  listeners.get(sessionId)?.forEach((listener) => listener(bytes));
}

export function replayOutput(
  sessionId: string,
  write: (data: Uint8Array) => void,
) {
  buffers.get(sessionId)?.chunks.forEach(write);
}

export function subscribeOutput(
  sessionId: string,
  listener: (data: Uint8Array) => void,
) {
  const sessionListeners = listeners.get(sessionId) ?? new Set();
  sessionListeners.add(listener);
  listeners.set(sessionId, sessionListeners);
  return () => sessionListeners.delete(listener);
}

export function clearOutput(sessionId: string) {
  buffers.delete(sessionId);
}
