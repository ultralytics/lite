// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

const THEME_KEY = "lite.theme";

export type Theme = "light" | "dark";

export function initialTheme(): Theme {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
  localStorage.setItem(THEME_KEY, theme);
}

// The other thing Lite remembers about how it looks. The terminal and the file preview zoom the same
// way and hold each other to the same sizes, so the bounds are stated once; each keeps its own size
// under its own key, because prose and code are read at different sizes than a terminal is.
const MIN_FONT_SIZE = 9;
const MAX_FONT_SIZE = 24;
const DEFAULT_FONT_SIZE = 13;

export function storedFontSize(key: string): number {
  const saved = Number(localStorage.getItem(key));
  return saved >= MIN_FONT_SIZE && saved <= MAX_FONT_SIZE ? saved : DEFAULT_FONT_SIZE;
}

// One zoom step from the size showing now; a step of 0 is actual size. The step is taken inside the
// bounds rather than past them, so the smallest size stays a size the reader above will take back —
// and a step that reaches the size already showing, as held keys at either end do, writes nothing.
export function zoomedFontSize(key: string, from: number, step: -1 | 0 | 1): number {
  const size = step ? Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, from + step)) : DEFAULT_FONT_SIZE;
  if (size !== from) localStorage.setItem(key, String(size));
  return size;
}

export function zoomStep(key: string): -1 | 0 | 1 | undefined {
  if (key === "+" || key === "=") return 1;
  if (key === "-") return -1;
  if (key === "0") return 0;
}
