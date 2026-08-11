// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// The terminal and the file preview zoom the same way and hold each other to the same sizes, so the
// bounds are stated once. Each remembers its own size under its own key: prose and code are read at
// different sizes than a terminal, by different people.
const MIN_FONT_SIZE = 9;
const MAX_FONT_SIZE = 24;
const DEFAULT_FONT_SIZE = 13;

export function storedFontSize(key: string): number {
  const saved = Number(localStorage.getItem(key));
  return saved >= MIN_FONT_SIZE && saved <= MAX_FONT_SIZE ? saved : DEFAULT_FONT_SIZE;
}

// One zoom step from the size showing now; a step of 0 is actual size. The step is taken inside the
// bounds, never past them, so the smallest size stays a size the reader above will take back.
export function zoomedFontSize(key: string, from: number, step: -1 | 0 | 1): number {
  const size = step ? Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, from + step)) : DEFAULT_FONT_SIZE;
  localStorage.setItem(key, String(size));
  return size;
}

// A key leaving a set of them. The set comes back untouched when it never held the key, so the panel
// or the session list behind it is not redrawn for a removal that had already happened.
export function without(current: Set<string>, key: string): Set<string> {
  if (!current.has(key)) return current;
  const next = new Set(current);
  next.delete(key);
  return next;
}
