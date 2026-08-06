// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
