// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

/**
 * Color conversion utilities for the ColorPicker component.
 * Provides HSV/RGB/Hex conversions for spectrum-based color selection.
 */

// ============================================================================
// Types
// ============================================================================

export type RGB = { r: number; g: number; b: number };
export type HSV = { h: number; s: number; v: number };

// ============================================================================
// Hex Utilities
// ============================================================================

/**
 * Parse hex color to RGB object.
 * @param hex - Hex color string (with or without #)
 * @returns RGB object or null if invalid
 */
export function hexToRgbObject(hex: string): RGB | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return null;
  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  };
}

/**
 * Convert RGB values to hex string.
 * @returns Hex string with # prefix (e.g., "#6366f1")
 */
export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) =>
    Math.round(Math.max(0, Math.min(255, n)))
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Linearly interpolate between two hex colors.
 * @param ratio - 0 returns `from`, 1 returns `to`
 */
export function interpolateHexColor(from: string, to: string, ratio: number): string {
  const start = hexToRgbObject(from);
  const end = hexToRgbObject(to);
  if (!start || !end) return from;
  return rgbToHex(
    start.r + (end.r - start.r) * ratio,
    start.g + (end.g - start.g) * ratio,
    start.b + (end.b - start.b) * ratio,
  );
}

/**
 * Validate hex color format.
 * @param hex - Hex color string to validate
 * @returns True if valid 3 or 6 character hex color
 */
export function isValidHex(hex: string): boolean {
  return /^#?([a-f\d]{3}|[a-f\d]{6})$/i.test(hex);
}

/**
 * Normalize hex color (add # prefix, expand 3-char to 6-char).
 * @param hex - Hex color string
 * @returns Normalized hex string with # prefix
 */
export function normalizeHex(hex: string): string {
  let h = hex.replace("#", "");
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  return `#${h.toLowerCase()}`;
}

// ============================================================================
// HSV/RGB Conversions
// ============================================================================

/**
 * Convert RGB to HSV.
 * @returns HSV object with h: 0-360, s: 0-100, v: 0-100
 */
export function rgbToHsv(r: number, g: number, b: number): HSV {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;

  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;

  if (max !== min) {
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return { h: h * 360, s: s * 100, v: v * 100 };
}

/**
 * Convert HSV to RGB.
 * @param h - Hue (0-360)
 * @param s - Saturation (0-100)
 * @param v - Value/Brightness (0-100)
 * @returns RGB object with values 0-255
 */
export function hsvToRgb(h: number, s: number, v: number): RGB {
  h /= 360;
  s /= 100;
  v /= 100;

  let r = 0;
  let g = 0;
  let b = 0;

  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);

  switch (i % 6) {
    case 0:
      r = v;
      g = t;
      b = p;
      break;
    case 1:
      r = q;
      g = v;
      b = p;
      break;
    case 2:
      r = p;
      g = v;
      b = t;
      break;
    case 3:
      r = p;
      g = q;
      b = v;
      break;
    case 4:
      r = t;
      g = p;
      b = v;
      break;
    case 5:
      r = v;
      g = p;
      b = q;
      break;
  }

  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
  };
}

// ============================================================================
// Contrast Utilities
// ============================================================================

/**
 * Calculate relative luminance for contrast calculation.
 * @returns Luminance value 0-1
 */
function getLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/**
 * Determine if white text should be used on a color background.
 * @param hex - Background color as hex string
 * @returns True if white text provides better contrast
 */
export function shouldUseWhiteText(hex: string): boolean {
  const rgb = hexToRgbObject(hex);
  if (!rgb) return true;
  return getLuminance(rgb.r, rgb.g, rgb.b) < 0.5;
}
