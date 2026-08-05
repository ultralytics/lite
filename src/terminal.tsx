import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import { replayOutput, subscribeOutput } from "@/output-store";

export function TerminalView({ sessionId }: { sessionId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.25,
      scrollback: 5000,
      theme: {
        background: "#0d0d0d",
        foreground: "#e5e5e5",
        cursor: "#f5f5f5",
        selectionBackground: "#3f3f46",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container);
    replayOutput(sessionId, (data) => terminal.write(data));
    const unsubscribe = subscribeOutput(sessionId, (data) =>
      terminal.write(data),
    );
    const input = terminal.onData((data) => {
      void invoke("write_session", {
        sessionId,
        data: Array.from(new TextEncoder().encode(data)),
      });
    });
    const resize = () => {
      fit.fit();
      void invoke("resize_session", {
        sessionId,
        cols: terminal.cols,
        rows: terminal.rows,
      });
    };
    const observer = new ResizeObserver(() => requestAnimationFrame(resize));
    observer.observe(container);
    resize();
    terminal.focus();

    return () => {
      observer.disconnect();
      input.dispose();
      unsubscribe();
      terminal.dispose();
    };
  }, [sessionId]);

  return <div ref={containerRef} className="h-full w-full bg-[#0d0d0d] p-3" />;
}
