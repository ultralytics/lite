// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

export type SemanticTone = "success" | "warning" | "error";

export const SEMANTIC_PROGRESS_CLASSES = {
  success: "[&_[data-slot=progress-indicator]]:bg-success",
  warning: "[&_[data-slot=progress-indicator]]:bg-warning",
  error: "[&_[data-slot=progress-indicator]]:bg-destructive",
} as const satisfies Record<SemanticTone, string>;
