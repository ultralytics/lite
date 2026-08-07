// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

"use client";

import type * as React from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { OVERLAY, Z } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Selector for interactive elements - prevents closing overlay when clicking buttons, links, etc. */
export const INTERACTIVE_SELECTOR =
  'button, a, input, select, textarea, label, [role="button"], [role="link"], [role="menuitem"], [role="switch"], [role="checkbox"], [role="radio"], [role="tab"], [role="option"]';

/** Get the header height for positioning below it */
function getHeaderHeight(): number {
  const inset = document.querySelector('main[data-slot="sidebar-inset"]');
  if (inset) {
    const header = inset.querySelector("header");
    if (header) {
      // getBoundingClientRect().bottom is relative to viewport - can be negative when scrolled
      // Clamp to 0 so overlay never positions above viewport top
      return Math.max(0, header.getBoundingClientRect().bottom);
    }
  }
  return 0;
}

/** Get the target sidebar width based on its state (collapsed or expanded) */
function getSidebarWidth(): number {
  const sidebar = document.querySelector('[data-slot="sidebar"]');
  if (!sidebar) return 0;

  const state = sidebar.getAttribute("data-state");
  const collapsible = sidebar.getAttribute("data-collapsible");

  // Get rem base size for conversion (default 16px)
  const remBase = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

  // Sidebar widths from sidebar.tsx: SIDEBAR_WIDTH = "16rem", SIDEBAR_WIDTH_ICON = "3rem"
  if (state === "collapsed" && collapsible === "icon") {
    return 3 * remBase; // 3rem = 48px at 16px base
  }
  return 16 * remBase; // 16rem = 256px at 16px base
}

/**
 * PageOverlay renders an overlay positioned exactly within the page content area,
 * excluding the sidebar and header.
 *
 * It calculates the exact bounds of the content area and positions itself precisely,
 * ensuring it doesn't cover the sidebar or header.
 *
 * Use this for:
 * - Dialog backdrops (blurred backgrounds)
 * - Dropzone overlays
 * - Fullscreen chart/media viewers
 * - Any modal-like UI that should cover the page but not sidebar/header
 *
 * @example
 * ```tsx
 * <PageOverlay visible={isDragging} variant="dropzone">
 *   <UploadIcon />
 *   <p>Drop files here</p>
 * </PageOverlay>
 * ```
 */
export function PageOverlay({
  visible,
  variant = "default",
  inset = 0,
  children,
  className,
  onClick,
}: {
  /** Whether the overlay is visible */
  visible: boolean;
  /** Visual variant of the overlay */
  variant?: "default" | "blur" | "dropzone" | "fullscreen" | "viewer";
  /** Inset from edges in pixels (default: 0, dropzone default: 16) */
  inset?: number;
  /** Content to display centered in the overlay */
  children?: React.ReactNode;
  /** Additional CSS classes */
  className?: string;
  /** Click handler (e.g., to close on backdrop click) */
  onClick?: () => void;
}) {
  // Apply default inset for dropzone variant
  const effectiveInset = inset || (variant === "dropzone" ? 16 : 0);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [sidebarWidth, setSidebarWidth] = useState(0);
  const [mounted, setMounted] = useState(false);
  const sidebarWidthRef = useRef(sidebarWidth);
  const headerHeightRef = useRef(headerHeight);
  sidebarWidthRef.current = sidebarWidth;
  headerHeightRef.current = headerHeight;

  useIsoLayoutEffect(() => {
    setMounted(true);
  }, []);

  useIsoLayoutEffect(() => {
    if (!visible) return;

    const updateDimensions = () => {
      setHeaderHeight(getHeaderHeight());
      setSidebarWidth(getSidebarWidth());
    };

    // Close on click outside overlay bounds (sidebar, header, etc.)
    const handleOutsideClick = (e: MouseEvent) => {
      if (!onClick) return;

      // Don't close if clicking on an interactive element (buttons, links, etc.)
      if (e.target instanceof HTMLElement && e.target.closest(INTERACTIVE_SELECTOR)) return;

      // Check if click is in the sidebar area (left of the overlay) or header (above)
      const { clientX: x, clientY: y } = e;
      if (x < sidebarWidthRef.current || y < headerHeightRef.current) {
        onClick();
      }
    };

    // Lock body scroll when overlay is visible
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    updateDimensions();
    window.addEventListener("resize", updateDimensions);
    document.addEventListener("mousedown", handleOutsideClick);

    // Watch for sidebar state changes (collapsed/expanded) using MutationObserver
    // This fires immediately when data-state attribute changes, before CSS transition starts
    const sidebar = document.querySelector('[data-slot="sidebar"]');
    const mutationObserver = sidebar
      ? new MutationObserver(() => {
          setSidebarWidth(getSidebarWidth());
        })
      : null;
    if (sidebar && mutationObserver) {
      mutationObserver.observe(sidebar, { attributes: true, attributeFilter: ["data-state"] });
    }

    return () => {
      window.removeEventListener("resize", updateDimensions);
      document.removeEventListener("mousedown", handleOutsideClick);
      mutationObserver?.disconnect();
      document.body.style.overflow = originalOverflow;
    };
  }, [visible, onClick]);

  if (!visible || !mounted) return null;

  const variantStyles = {
    default: OVERLAY.default,
    blur: OVERLAY.blur,
    dropzone: OVERLAY.dropzone,
    fullscreen: OVERLAY.fullscreen,
    viewer: OVERLAY.viewer,
  };

  // Position using calculated sidebar width - updates immediately when sidebar state changes
  // The sidebar animates its width, we animate our left position to match
  const overlay = (
    <div
      className={cn(
        `fixed ${Z.overlay}`,
        variantStyles[variant],
        "animate-in fade-in-0 duration-200",
        // Transition left to match sidebar animation (200ms ease-linear)
        "transition-[left] duration-200 ease-linear",
        className,
      )}
      style={{
        top: headerHeight + effectiveInset,
        left: sidebarWidth + effectiveInset,
        right: effectiveInset,
        bottom: effectiveInset,
      }}
    >
      {onClick && (
        <button
          type="button"
          className="absolute inset-0 z-10 bg-transparent border-none p-0 m-0 cursor-pointer"
          aria-label="Close overlay"
          onClick={onClick}
        />
      )}
      <div className="relative z-20 h-full w-full flex items-center justify-center">{children}</div>
    </div>
  );

  return createPortal(overlay, document.body);
}
