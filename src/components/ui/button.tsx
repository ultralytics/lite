// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

"use client";

import { Button as ButtonPrimitive } from "@base-ui/react/button";
import type { VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button-variants";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type ButtonProps = ButtonPrimitive.Props & VariantProps<typeof buttonVariants>;

function Button({ className, variant = "default", size = "default", ...props }: ButtonProps) {
  return <ButtonPrimitive data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

function ActionIconButton({
  tooltip,
  tooltipSide,
  variant = "icon-ghost",
  size = "icon",
  ...props
}: ButtonProps & { tooltip: ReactNode; tooltipSide?: "top" | "right" | "bottom" | "left" }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant={variant} size={size} {...props} />} />
      <TooltipContent side={tooltipSide}>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

export { ActionIconButton, Button, type ButtonProps };
