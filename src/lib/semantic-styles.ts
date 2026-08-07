// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

export type SemanticTone = "neutral" | "success" | "warning" | "error" | "info" | "purple";

export const SEMANTIC_SURFACE_CLASSES = {
  neutral: "border-border bg-muted/40 text-foreground",
  success: "border-success/20 bg-success/10 text-success",
  warning:
    "border-amber-400/50 bg-amber-50/60 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400",
  error: "border-destructive/30 bg-destructive/10 text-destructive dark:border-destructive/20",
  info: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:border-sky-500/20 dark:text-sky-400",
  purple: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:border-violet-500/20 dark:text-violet-400",
} as const satisfies Record<SemanticTone, string>;

export const SEMANTIC_CARD_TONE_CLASSES = {
  neutral: "",
  success: "border-success/20 bg-success/5 dark:bg-success/10",
  warning:
    "border-amber-400/50 bg-amber-50/60 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100",
  error: "border-destructive/30 bg-destructive/5 dark:border-destructive/20 dark:bg-destructive/10",
  info: "border-sky-500/30 bg-sky-500/5 dark:border-sky-500/20 dark:bg-sky-500/10",
  purple: "border-violet-500/30 bg-violet-500/5 dark:border-violet-500/20 dark:bg-violet-500/10",
} as const satisfies Record<SemanticTone, string>;

export const SEMANTIC_TEXT_CLASSES = {
  neutral: "text-muted-foreground",
  success: "text-success",
  warning: "text-amber-600 dark:text-amber-400",
  error: "text-destructive",
  info: "text-sky-600 dark:text-sky-400",
  purple: "text-violet-600 dark:text-violet-400",
} as const satisfies Record<SemanticTone, string>;

export const SEMANTIC_ICON_SURFACE_CLASSES = {
  neutral: "bg-muted text-muted-foreground",
  success: "bg-success/15 text-success",
  warning: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  error: "bg-destructive/15 text-destructive",
  info: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  purple: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
} as const satisfies Record<SemanticTone, string>;

export const SEMANTIC_BADGE_CLASSES = {
  neutral: "border-transparent bg-secondary text-secondary-foreground",
  success: "border-transparent bg-success/10 text-success",
  warning: "border-transparent bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400",
  error: "border-transparent bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400",
  info: "border-transparent bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-400",
  purple: "border-transparent bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-400",
} as const satisfies Record<SemanticTone, string>;

export const SEMANTIC_BADGE_VARIANTS = {
  neutral: "secondary",
  success: "success",
  warning: "warning",
  error: "error",
  info: "info",
  purple: "purple",
} as const satisfies Record<SemanticTone, "secondary" | "success" | "warning" | "error" | "info" | "purple">;

const ACTIVITY_ACTION_TONES = {
  cancelled: "error",
  completed: "success",
  created: "success",
  deleted: "error",
  failed: "error",
  granted: "purple",
  invited: "info",
  joined: "info",
  removed: "error",
  restored: "success",
  revoked: "warning",
  shared: "info",
  started: "info",
  trashed: "error",
  updated: "info",
  uploaded: "success",
} as const satisfies Record<string, SemanticTone>;

export function getActivityActionTone(action: string): SemanticTone {
  return ACTIVITY_ACTION_TONES[action as keyof typeof ACTIVITY_ACTION_TONES] ?? "neutral";
}
