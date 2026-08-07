// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import * as ResizablePrimitive from "react-resizable-panels";

import { cn } from "@/lib/utils";

function ResizablePanelGroup({ className, ...props }: ResizablePrimitive.GroupProps) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn("group/panels flex h-full w-full aria-[orientation=vertical]:flex-col", className)}
      {...props}
    />
  );
}

// Width is carried by flex-grow, so a panel eases into every size it is given: collapsing, expanding,
// and the jump a collapse makes. The one exception is a held separator, which has to track the pointer
// exactly — easing there would leave the panel trailing the hand that moves it. The library
// publishes that on data-separator, which a keyboard resize sets too and :active never would.
function ResizablePanel({ className, ...props }: ResizablePrimitive.PanelProps) {
  return (
    <ResizablePrimitive.Panel
      data-slot="resizable-panel"
      className={cn(
        "transition-[flex-grow] duration-200 ease-out group-has-[[data-separator=active]]/panels:transition-none motion-reduce:transition-none",
        className,
      )}
      {...props}
    />
  );
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: ResizablePrimitive.SeparatorProps & {
  withHandle?: boolean;
}) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        "relative flex w-px items-center justify-center bg-border ring-offset-background transition-colors after:absolute after:inset-y-0 after:left-1/2 after:w-2 after:-translate-x-1/2 hover:bg-ring focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden data-[separator=active]:bg-ring aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-2 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2 hover:[&>div]:bg-ring data-[separator=active]:[&>div]:bg-ring [&[aria-orientation=horizontal]>div]:rotate-90",
        className,
      )}
      {...props}
    >
      {withHandle && (
        <div className="z-10 flex h-6 w-1 shrink-0 rounded-lg bg-border transition-all duration-150 motion-reduce:transition-none" />
      )}
    </ResizablePrimitive.Separator>
  );
}

export type { PanelImperativeHandle } from "react-resizable-panels";
export { ResizableHandle, ResizablePanel, ResizablePanelGroup };
