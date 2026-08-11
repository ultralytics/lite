// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// A key leaving a set of them. The set comes back untouched when it never held the key, so the panel
// or the session list behind it is not redrawn for a removal that had already happened.
export function without(current: Set<string>, key: string): Set<string> {
  if (!current.has(key)) return current;
  const next = new Set(current);
  next.delete(key);
  return next;
}

// One key taking another's place, which is what a session does to the one it replaces: the tab that
// was starting stops, and the tab standing in for it starts, in the one change the list redraws for.
export function swapped(current: Set<string>, from: string, to: string): Set<string> {
  const next = new Set(current);
  next.delete(from);
  next.add(to);
  return next;
}
