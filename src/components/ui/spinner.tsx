// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

"use client";

import { Loader2Icon } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin motion-reduce:animate-none", className)}
      {...props}
    />
  );
}

export { Spinner };
