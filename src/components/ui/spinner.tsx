// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { Loader2Icon } from "lucide-react";

import { OVERLAY } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";

const SPINNER_SIZES = {
  sm: "h-4 w-4",
  md: "h-6 w-6",
  lg: "h-8 w-8",
  xl: "h-12 w-12",
} as const;

type SpinnerSize = keyof typeof SPINNER_SIZES;

type SpinnerProps = {
  /** Size of the spinner icon */
  size?: SpinnerSize;
  /** Label text below spinner (pass null to hide) */
  label?: string | null;
  /** Description text below label */
  description?: string;
  /** Additional className for the container */
  className?: string;
  /** Show as overlay with backdrop */
  overlay?: boolean;
  /** Use fixed positioning for full-screen overlay */
  fullScreen?: boolean;
  /** Conditionally show/hide the spinner */
  show?: boolean;
  /** Center in container with padding (for page/section loading states) */
  centered?: boolean;
};

/**
 * Unified loading spinner component.
 *
 * @example
 * // Simple centered spinner (page loading)
 * <Spinner centered />
 *
 * // With label
 * <Spinner label="Loading data..." />
 *
 * // Small inline spinner
 * <Spinner size="sm" />
 *
 * // Full-screen overlay
 * <Spinner overlay fullScreen label="Processing..." />
 */
export function Spinner({
  size = "lg",
  label,
  description,
  className,
  overlay,
  fullScreen,
  show = true,
  centered = false,
}: SpinnerProps) {
  if (!show) return null;

  const content = (
    <div className={cn("flex flex-col items-center gap-3 text-center", className)}>
      <Loader2Icon
        data-slot="spinner"
        role="status"
        aria-label="Loading"
        className={cn("animate-spin text-muted-foreground", SPINNER_SIZES[size])}
      />
      {(label || description) && (
        <div className="space-y-1">
          {label ? <p className="text-base font-semibold text-primary">{label}</p> : null}
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
      )}
    </div>
  );

  if (centered) {
    return <div className="flex items-center justify-center py-12">{content}</div>;
  }

  if (!overlay) return content;

  const overlayClass = fullScreen ? "fixed inset-0 z-50" : "absolute inset-x-0 top-0 z-30 h-screen max-h-full";

  return <div className={cn(overlayClass, "flex items-center justify-center", OVERLAY.dialog)}>{content}</div>;
}
