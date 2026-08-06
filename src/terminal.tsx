// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { invoke } from "@tauri-apps/api/core";
import { FitAddon } from "@xterm/addon-fit";
import { type ITheme, Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";

import { subscribeOutput } from "@/output-store";
import type { Theme } from "@/theme";

// Surface colors follow the app tokens; ANSI colors follow GitHub light and dark, matching the code preview.
const themes: Record<Theme, ITheme> = {
  light: {
    background: "#ffffff",
    foreground: "#0a0a0a",
    cursor: "#0a0a0a",
    cursorAccent: "#ffffff",
    selectionBackground: "#0969da33",
    black: "#24292f",
    red: "#cf222e",
    green: "#116329",
    yellow: "#4d2d00",
    blue: "#0969da",
    magenta: "#8250df",
    cyan: "#1b7c83",
    white: "#6e7781",
    brightBlack: "#57606a",
    brightRed: "#a40e26",
    brightGreen: "#1a7f37",
    brightYellow: "#633c01",
    brightBlue: "#218bff",
    brightMagenta: "#a475f9",
    brightCyan: "#3192aa",
    brightWhite: "#8c959f",
  },
  dark: {
    background: "#0a0a0a",
    foreground: "#fafafa",
    cursor: "#fafafa",
    cursorAccent: "#0a0a0a",
    selectionBackground: "#58a6ff40",
    black: "#484f58",
    red: "#ff7b72",
    green: "#3fb950",
    yellow: "#d29922",
    blue: "#58a6ff",
    magenta: "#bc8cff",
    cyan: "#39c5cf",
    white: "#b1bac4",
    brightBlack: "#6e7681",
    brightRed: "#ffa198",
    brightGreen: "#56d364",
    brightYellow: "#e3b341",
    brightBlue: "#79c0ff",
    brightMagenta: "#d2a8ff",
    brightCyan: "#56d4dd",
    brightWhite: "#ffffff",
  },
};

export function TerminalView({ sessionId, theme }: { sessionId: string; theme: Theme }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.25,
      scrollback: 5000,
    });
    terminalRef.current = terminal;
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container);
    const unsubscribe = subscribeOutput(sessionId, (data) => terminal.write(data));
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
      terminalRef.current = null;
    };
  }, [sessionId]);

  // Applied in the same commit as the effect above, so a new terminal is painted with the current theme.
  useEffect(() => {
    if (terminalRef.current) terminalRef.current.options.theme = themes[theme];
  }, [theme]);

  return <div ref={containerRef} className="h-full w-full bg-background p-3" />;
}
