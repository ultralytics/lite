// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

export type SemanticTone = "success" | "warning" | "error";

export const SEMANTIC_BADGE_CLASSES = {
  success: "border-transparent bg-success/10 text-success",
  warning: "border-transparent bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400",
  error: "border-transparent bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400",
} as const satisfies Record<SemanticTone, string>;

export const SEMANTIC_PROGRESS_CLASSES = {
  success: "[&_[data-slot=progress-indicator]]:bg-success",
  warning: "[&_[data-slot=progress-indicator]]:bg-amber-500",
  error: "[&_[data-slot=progress-indicator]]:bg-destructive",
} as const satisfies Record<SemanticTone, string>;
