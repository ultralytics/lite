// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { interpolateHexColor } from "./color-utils";

/**
 * Convert hex color to RGB string for use in rgba().
 * @param hex - Hex color string (with or without #)
 * @param fallback - Fallback RGB values if parsing fails (default: slate gray)
 * @returns RGB values as comma-separated string (e.g., "100, 116, 139")
 */
export function hexToRgb(hex: string, fallback = "100, 116, 139"): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return fallback;
  return `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`;
}

export type ThemeColor = { light: string; dark: string };

// 20 colors from Tailwind palette to support charts with many series (MAX_PIE_ITEMS=20)
export const THEME_COLORS = {
  // Primary colors (Tailwind palette)
  indigo: { light: "#6366f1", dark: "#a5b4ff" },
  green: { light: "#22c55e", dark: "#86efac" },
  orange: { light: "#f97316", dark: "#fdba74" },
  cyan: { light: "#06b6d4", dark: "#67e8f9" },
  yellow: { light: "#eab308", dark: "#fde047" },
  red: { light: "#ef4444", dark: "#fca5a5" },
  violet: { light: "#8b5cf6", dark: "#c4b5fd" },
  sky: { light: "#0ea5e9", dark: "#7dd3fc" },
  pink: { light: "#f472b6", dark: "#f9a8d4" },
  teal: { light: "#14b8a6", dark: "#5eead4" },
  blue: { light: "#3b82f6", dark: "#60a5fa" },
  emerald: { light: "#10b981", dark: "#34d399" },
  amber: { light: "#f59e0b", dark: "#fbbf24" },
  rose: { light: "#f43f5e", dark: "#fb7185" },
  purple: { light: "#a855f7", dark: "#c084fc" },
  fuchsia: { light: "#c026d3", dark: "#e879f9" },
  lime: { light: "#84cc16", dark: "#a3e635" },
  slate: { light: "#64748b", dark: "#94a3b8" },
  stone: { light: "#78716c", dark: "#a8a29e" },
  zinc: { light: "#71717a", dark: "#a1a1aa" },
} as const;

export const PROJECT_ICON_COLORS = [
  "red",
  "orange",
  "yellow",
  "lime",
  "green",
  "teal",
  "cyan",
  "blue",
  "indigo",
  "violet",
  "purple",
  "pink",
  "fuchsia",
  "rose",
  "slate",
] as const;

export const PROJECT_ICON_DEFAULT_COLOR = "slate" as const;

export function getProjectIconFallbackColor(name: string) {
  return name
    ? PROJECT_ICON_COLORS[[...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % PROJECT_ICON_COLORS.length]
    : PROJECT_ICON_DEFAULT_COLOR;
}

// Official Ultralytics brand colors (from ultralytics.com/brand)
export const BRAND_COLORS = {
  // Primary
  darkBlue: "#111F68",
  brightBlue: "#042AFF",
  neonYellow: "#E1FF25",
  neonPink: "#FF64DA",
  lightGrey: "#F3F3F3",
  white: "#FFFFFF",
  black: "#0b0b0f", // Near black for text
  // Secondary
  aquaBlue: "#00FFFF",
  lightBlue: "#ACF9FF",
  neonGreen: "#76FFD6",
  grey: "#CCCCCC",
  darkGrey: "#9E9E9E",
  // Logo
  cyan: "#63D7EB",
  logoDarkBlue: "#1323A5",
  logoGrey: "#EAEDF4",
  // Bounding box palette (for visualizations)
  bbox: ["#0BDBEB", "#00DFB7", "#FF6FDD", "#CCED00", "#00F344", "#BD00FF", "#00B4FF", "#DD00BA"],
} as const;

// Official brand gradient — used by gradient CTAs on every public app.
export const BRAND_GRADIENT = `linear-gradient(105deg, ${BRAND_COLORS.darkBlue} 0%, ${BRAND_COLORS.brightBlue} 45%, ${BRAND_COLORS.neonGreen} 100%)`;

// Stops of BRAND_GRADIENT, used to sample a per-item accent color along the brand gradient
// (e.g. timeline nodes/pills on the /yolo and /roadmap pages).
const BRAND_GRADIENT_STOPS = [
  { color: BRAND_COLORS.darkBlue, position: 0 },
  { color: BRAND_COLORS.brightBlue, position: 0.45 },
  { color: BRAND_COLORS.neonGreen, position: 1 },
] as const;

// Sample the brand gradient at `index / (count - 1)`, returning a hex accent for that position.
export function brandGradientColor(index: number, count: number): string {
  const position = count <= 1 ? 0 : index / (count - 1);
  const endIndex = BRAND_GRADIENT_STOPS.findIndex((stop) => stop.position >= position);
  const end = BRAND_GRADIENT_STOPS[endIndex === -1 ? BRAND_GRADIENT_STOPS.length - 1 : endIndex];
  const start = BRAND_GRADIENT_STOPS[Math.max(0, (endIndex === -1 ? BRAND_GRADIENT_STOPS.length - 1 : endIndex) - 1)];
  const span = end.position - start.position;
  return interpolateHexColor(start.color, end.color, span ? (position - start.position) / span : 0);
}

// Soft pastel hero gradient — used on www marketing hero sections (home, brand, license, customers, partners, about).
export const BRAND_HERO_GRADIENT = `radial-gradient(at 0% 100%, ${BRAND_COLORS.aquaBlue}55 0%, transparent 45%), radial-gradient(at 100% 0%, ${BRAND_COLORS.neonPink}55 0%, transparent 45%), radial-gradient(at 50% 50%, ${BRAND_COLORS.lightBlue}66 0%, transparent 60%)`;

// Horizontal brand background gradient (aqua → bright blue → neon pink) — used on www brand/design-system banners.
export const BRAND_BACKGROUND_GRADIENT = `linear-gradient(90deg, ${BRAND_COLORS.aquaBlue} 0%, ${BRAND_COLORS.brightBlue} 50%, ${BRAND_COLORS.neonPink} 100%)`;

const ULTRALYTICS_CLASS_COLORS = [
  "#042aff",
  "#0bdbeb",
  "#f3f3f3",
  "#00dfb7",
  "#111f68",
  "#ff6fdd",
  "#ff444f",
  "#cced00",
  "#00f344",
  "#bd00ff",
  "#00b4ff",
  "#dd00ba",
  "#00ffff",
  "#26c000",
  "#01ffb3",
  "#7d24ff",
  "#7b0068",
  "#ff1b6c",
  "#fc6d2f",
  "#a2ff0b",
] as const;

const ULTRALYTICS_POSE_COLORS = [
  "#ff8000",
  "#ff9933",
  "#ffb266",
  "#e6e600",
  "#ff99ff",
  "#99ccff",
  "#ff66ff",
  "#ff33ff",
  "#66b2ff",
  "#3399ff",
  "#ff9999",
  "#ff6666",
  "#ff3333",
  "#99ff99",
  "#66ff66",
  "#33ff33",
  "#00ff00",
  "#0000ff",
  "#ff0000",
  "#ffffff",
] as const;

export const ULTRALYTICS_CLASS_PALETTE = {
  colors: ULTRALYTICS_CLASS_COLORS,
  get: (index: number) => ULTRALYTICS_CLASS_COLORS[index % ULTRALYTICS_CLASS_COLORS.length],
} as const;

export const ULTRALYTICS_POSE_PALETTE = {
  colors: ULTRALYTICS_POSE_COLORS,
  get: (index: number) => ULTRALYTICS_POSE_COLORS[index % ULTRALYTICS_POSE_COLORS.length],
} as const;

// UI colors for text, borders, and backgrounds (Tailwind gray/slate palette)
export const UI_COLORS = {
  // Text colors
  text: { light: "#1f2937", dark: "#f9fafb" }, // gray-800 / gray-50
  textMuted: { light: "#6b7280", dark: "#9ca3af" }, // gray-500 / gray-400
  // Border/line colors
  border: { light: "#e5e7eb", dark: "#374151" }, // gray-200 / gray-700
  borderStrong: { light: "#d1d5db", dark: "#4b5563" }, // gray-300 / gray-600
  // Background colors
  bg: { light: "#ffffff", dark: "#1f2937" }, // white / gray-800
  bgMuted: { light: "#f9fafb", dark: "#111827" }, // gray-50 / gray-900
  bgDeep: { light: "#f1f5f9", dark: "#020617" }, // slate-100 / slate-950 (Tailwind dark mode)
  // ECharts tooltip overlay colors (dark background, always used regardless of app theme)
  tooltip: {
    bg: "rgba(0, 0, 0, 0.85)",
    text: "rgba(255, 255, 255, 1)",
    textMuted: "rgba(255, 255, 255, 0.7)",
    textFaint: "rgba(255, 255, 255, 0.5)",
  },
} as const;

// Chart color palettes derived from THEME_COLORS (20 colors)
const PALETTE_ORDER = [
  "indigo",
  "green",
  "orange",
  "cyan",
  "yellow",
  "red",
  "violet",
  "sky",
  "pink",
  "teal",
  "blue",
  "emerald",
  "amber",
  "rose",
  "purple",
  "fuchsia",
  "lime",
  "slate",
  "stone",
  "zinc",
] as const;

export const CHART_COLORS = {
  // Default palette (alias for paletteLight, used by ECharts)
  palette: PALETTE_ORDER.map((key) => THEME_COLORS[key].light),

  // Light mode palette (20 colors from THEME_COLORS)
  paletteLight: PALETTE_ORDER.map((key) => THEME_COLORS[key].light),

  // Dark mode palette (20 colors from THEME_COLORS)
  paletteDark: PALETTE_ORDER.map((key) => THEME_COLORS[key].dark),

  // Full ThemeColor objects (for Recharts components needing light/dark theming)
  paletteTheme: PALETTE_ORDER.map((key) => THEME_COLORS[key]),

  // Semantic colors for specific data types
  primary: THEME_COLORS.indigo.light,
  success: THEME_COLORS.green.light,
  warning: THEME_COLORS.amber.light,
  danger: THEME_COLORS.red.light,
  info: THEME_COLORS.cyan.light,

  // Dashboard-specific colors (analytics) - ThemeColor objects for Recharts
  signups: THEME_COLORS.cyan,
  models: THEME_COLORS.pink,
  datasets: THEME_COLORS.emerald,
  projects: THEME_COLORS.violet,
  plans: THEME_COLORS.amber,

  // Highlight/emphasis color
  highlight: THEME_COLORS.amber.light,
  highlightBorder: THEME_COLORS.amber.dark,

  // Equity/compensation chart colors
  salary: THEME_COLORS.blue,
  signingBonus: THEME_COLORS.amber,
  equityGain: THEME_COLORS.green,
  vestedValue: THEME_COLORS.indigo,
  selectedBar: THEME_COLORS.green.light,

  // Reference line colors
  referenceLine: { stroke: "#94a3b8", fill: "#475569" },

  // System metrics colors (status dashboard)
  cpu: THEME_COLORS.indigo,
  ram: THEME_COLORS.green,
  gpuUsage: THEME_COLORS.cyan,
  gpuMemory: THEME_COLORS.violet,
  gpuTemp: THEME_COLORS.orange,
  networkRecv: THEME_COLORS.green,
  networkSent: THEME_COLORS.indigo,
  diskRead: THEME_COLORS.cyan,
  diskWrite: THEME_COLORS.orange,

  // Analytics colors
  messages: THEME_COLORS.indigo,
  threads: THEME_COLORS.green,
  calls: THEME_COLORS.cyan,
  minutes: THEME_COLORS.green,
  count: THEME_COLORS.indigo,
} as const;

/** Get chart palette based on theme */
export const getChartPalette = (isDark: boolean) => (isDark ? CHART_COLORS.paletteDark : CHART_COLORS.paletteLight);

/** Convert ThemeColor to ChartConfig theme format */
export const chartTheme = (color: ThemeColor) => ({ theme: color });

/**
 * Pre-built chart series configs for common metrics.
 * Use in ChartContainer config: { cpu: CHART_SERIES.cpu }
 */
export const CHART_SERIES = {
  // System metrics (status dashboard)
  cpu: { label: "CPU", ...chartTheme(THEME_COLORS.indigo) },
  ram: { label: "RAM", ...chartTheme(THEME_COLORS.green) },
  gpuUsage: { label: "GPU Compute", ...chartTheme(THEME_COLORS.cyan) },
  gpuMemory: { label: "GPU Memory", ...chartTheme(THEME_COLORS.violet) },
  gpuTemp: { label: "GPU Temp", ...chartTheme(THEME_COLORS.orange) },
  networkRecv: { label: "Download", ...chartTheme(THEME_COLORS.green) },
  networkSent: { label: "Upload", ...chartTheme(THEME_COLORS.indigo) },
  diskRead: { label: "Read", ...chartTheme(THEME_COLORS.cyan) },
  diskWrite: { label: "Write", ...chartTheme(THEME_COLORS.orange) },
  // Analytics metrics (chat, gong dashboards)
  messages: { label: "Messages", ...chartTheme(THEME_COLORS.indigo) },
  threads: { label: "Threads", ...chartTheme(THEME_COLORS.green) },
  count: { label: "Count", ...chartTheme(THEME_COLORS.indigo) },
  calls: { label: "Calls", ...chartTheme(THEME_COLORS.cyan) },
  minutes: { label: "Minutes", ...chartTheme(THEME_COLORS.green) },
  // Time-based patterns
  hourly: { label: "Calls", ...chartTheme(THEME_COLORS.cyan) },
  weekday: { label: "Calls", ...chartTheme(THEME_COLORS.orange) },
  duration: { label: "Calls", ...chartTheme(THEME_COLORS.yellow) },
} as const;

// Chart styling constants
export const CHART_STYLE = {
  radius: 6,
  barRadius: 6,
  barRadiusStart: [0, 6, 6, 0] as [number, number, number, number],
  pieCornerRadius: 6,
  animationDuration: 500,
  animationDurationUpdate: 500,
} as const;

/**
 * Model chart line colors - 20 visually distinct colors ordered for maximum differentiation.
 * First 2-3 colors (blue/red/green) are maximally different for common 2-3 model comparisons.
 */
export const MODEL_CHART_PALETTE = {
  colors: [
    "#2563eb", // blue
    "#dc2626", // red
    "#16a34a", // green
    "#9333ea", // purple
    "#ea580c", // orange
    "#0891b2", // cyan
    "#be123c", // rose
    "#4f46e5", // indigo
    "#ca8a04", // yellow
    "#0d9488", // teal
    "#7c3aed", // violet
    "#db2777", // pink
    "#65a30d", // lime
    "#0284c7", // sky
    "#c2410c", // burnt orange
    "#7e22ce", // deep purple
    "#059669", // emerald
    "#b91c1c", // dark red
    "#1d4ed8", // royal blue
    "#a16207", // amber
  ] as const,
  get: (index: number) =>
    MODEL_CHART_PALETTE.colors[
      index % MODEL_CHART_PALETTE.colors.length
    ] as (typeof MODEL_CHART_PALETTE.colors)[number],
} as const;

// Text colors for charts
export const CHART_TEXT = {
  default: "#808080",
  light: "#0f172a",
  dark: "#e5e7eb",
} as const;

// Chart.js specific theme colors
export const CHARTJS_THEME = {
  light: { title: "#1f2937", axis: "#6b7280", grid: "rgba(209, 213, 219, 0.4)" },
  dark: { title: "#f9fafb", axis: "#9ca3af", grid: "rgba(55, 65, 81, 0.25)" },
  crosshair: "rgba(107, 114, 128, 0.5)",
} as const;

// Tooltip theme based on dark mode
export const getTooltipTheme = (isDark: boolean) => ({
  backgroundColor: isDark ? UI_COLORS.bgDeep.dark : UI_COLORS.bgMuted.light,
  borderColor: isDark ? UI_COLORS.bg.dark : UI_COLORS.border.light,
  textStyle: {
    color: CHART_TEXT.default,
    textBorderColor: "transparent",
    textBorderWidth: 0,
    textShadowColor: "transparent",
  },
});

// Common ECharts base config
export const ECHART_COMMON = {
  backgroundColor: "transparent",
  animationDuration: CHART_STYLE.animationDuration,
  animationDurationUpdate: CHART_STYLE.animationDurationUpdate,
} as const;

// Base text style for ECharts
export const getBaseTextStyle = (color: string = CHART_TEXT.default) => ({
  color,
  textBorderColor: "transparent",
  textBorderWidth: 0,
  textShadowColor: "transparent",
});

// ============================================================================
// Component Tokens
// ============================================================================

// StatCard variant styles
export const STAT_CARD_VARIANTS = {
  default: {
    card: "border-primary/10 bg-gradient-to-br from-primary/5 via-background to-background",
    beforeCircle:
      "before:pointer-events-none before:absolute before:right-[-20%] before:top-[-40%] before:size-52 before:rounded-full before:bg-primary/10",
    afterCircle:
      "after:pointer-events-none after:absolute after:right-[-5%] after:top-[-10%] after:size-32 after:rounded-full after:bg-primary/10",
  },
  warning: {
    card: "border-amber-500/50 bg-amber-500/5 dark:bg-amber-500/10",
  },
  error: {
    card: "border-red-500/50 bg-red-500/5 dark:bg-red-500/10",
  },
} as const;

// Grid layout defaults
export const GRID_DEFAULTS = {
  columns: 6,
  cellHeight: 175,
  gap: 8,
} as const;

// ============================================================================
// Z-Index Layers
// ============================================================================

/**
 * Z-index layers (Tailwind classes) — one ascending scale so stacking is reason-about-able:
 * overlay (50) < sidebar (60) < cookieBanner (65) < banner (80) < chatWidget (85) <
 * popover (90) < tooltip (95) < lightbox (100) < toast (110).
 * Use these instead of raw z-* classes on layered chrome.
 */
export const Z = {
  /** Dialogs, sheets, page overlays */
  overlay: "z-50",
  /** Sticky app sidebar */
  sidebar: "z-[60]",
  /** Cookie-consent banner */
  cookieBanner: "z-[65]",
  /** Announcement banner */
  banner: "z-[80]",
  /** Ask-AI chat launcher pill, drag ghost, and floating panel */
  chatWidget: "z-[85]",
  /** Popovers, dropdown menus, context menus, hover cards — portaled to the body, so they must
      out-rank every piece of page chrome they can open from (banner, sidebar, chat panel) */
  popover: "z-[90]",
  /** Tooltips — always on top of page chrome */
  tooltip: "z-[95]",
  /** Image-lightbox chrome (close/nav/zoom/metadata) layered over its own media inside a PageOverlay */
  lightbox: "z-[100]",
  /** Toast notifications — above overlays and all floating page chrome */
  toast: "z-[110]",
} as const;

// ============================================================================
// Blur & Overlay Tokens
// ============================================================================

/**
 * Unified glass blur effect — backdrop blur with saturation boost.
 * Use this instead of inline backdrop-blur-* classes.
 * CSS equivalent: `backdrop-filter: blur(8px) saturate(120%) brightness(1.01);`
 */
export const BLUR = "backdrop-blur backdrop-saturate-[1.2] backdrop-brightness-[1.01]";

/**
 * Pre-built overlay styles combining background + blur.
 * Use these for common overlay patterns.
 */
export const OVERLAY = {
  /** Default semi-transparent overlay */
  default: "bg-background/60",
  /** Blur overlay — semi-transparent with glass effect */
  blur: `bg-background/60 ${BLUR}`,
  /** Standard dialog/modal backdrop */
  dialog: `bg-background/80 ${BLUR}`,
  /** Dropzone overlay — uses glass effect */
  get dropzone() {
    return this.glass;
  },
  /** Fullscreen content overlay */
  fullscreen: `bg-background/70 ${BLUR}`,
  /** Processing/loading overlay with blurred content */
  processing: "blur-sm opacity-60 pointer-events-none",
  /** Dark viewer backdrop (for images/media) */
  viewer: `bg-black/85 ${BLUR}`,
  /** Directional dark overlay for readable text on hero photography */
  hero: "bg-gradient-to-r from-black/75 via-black/50 to-black/25",
  /** Floating UI elements (tooltips, popovers) */
  floating: `bg-background/95 ${BLUR}`,
  /** Semi-transparent header/footer bars */
  bar: `bg-background/90 ${BLUR}`,
  /** Frosted glass panels (sidebars, dropdowns over images) */
  glass: `bg-background/60 ${BLUR} border border-border/50`,
} as const;

// ============================================================================
// OpenGraph Image Tokens
// ============================================================================

/**
 * Centralized colors for OpenGraph (social sharing) images.
 * OG images render with a fixed palette for consistent appearance across platforms.
 * Use these instead of hardcoded hex colors in opengraph-image.tsx files.
 */
export const OG_COLORS = {
  /** Standard gradient for all OG images */
  gradient: "linear-gradient(135deg, #FF64DA 0%, #042AFF 50%, #0BDBEB 100%)",
  /** Gradual directional overlay keeps OG text readable without obscuring photography on the right */
  photoOverlay:
    "linear-gradient(90deg, rgba(0, 0, 0, 0.82) 0%, rgba(0, 0, 0, 0.58) 38%, rgba(0, 0, 0, 0.24) 68%, rgba(0, 0, 0, 0.08) 100%)",

  // Text colors
  /** Primary text color (white) */
  text: "#ffffff",
  /** Secondary text color (white 70%) */
  textMuted: "rgba(255, 255, 255, 0.7)",
  /** Label/subtitle text (white 80%) */
  textLabel: "rgba(255, 255, 255, 0.8)",
  /** Footnote text (white 60%) */
  textFaint: "rgba(255, 255, 255, 0.6)",

  // Surfaces and borders
  surface: "rgba(255, 255, 255, 0.1)",
  surfaceStrong: "rgba(255, 255, 255, 0.15)",
  surfaceSolid: "rgba(255, 255, 255, 0.2)",
  border: "rgba(255, 255, 255, 0.3)",
  strokeMuted: "rgba(255, 255, 255, 0.6)",
  strokeStrong: "rgba(255, 255, 255, 0.8)",
  strokeFaint: "rgba(255, 255, 255, 0.5)",
} as const;
