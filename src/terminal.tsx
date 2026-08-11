// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { invoke } from "@tauri-apps/api/core";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { type ITheme, Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";

import { subscribeOutput, writeSession } from "@/output-store";
import { storedFontSize, type Theme, zoomedFontSize } from "@/theme";
import type { Agent } from "@/types";

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

// A control sequence is an escape followed by a string terminator for OSC and DCS, a final byte for
// CSI and SS3, or a single byte for the rest.
// biome-ignore lint/suspicious/noControlCharactersInRegex: a control sequence is defined by them
const SEQUENCES = /\x1b(?:[\]P][\s\S]*?(?:\x07|\x1b\\)|\[[\x30-\x3f]*[ -/]*[@-~]|O[@-~]|[\s\S])/g;

// The same sequence introduced but not yet terminated. A lone escape is deliberately not one of these:
// it is the Escape key, and holding it back would swallow the next character typed.
// biome-ignore lint/suspicious/noControlCharactersInRegex: a control sequence is defined by them
const PARTIAL = /\x1b(?:[\]P](?:(?!\x07|\x1b\\)[\s\S])*|\[[\x30-\x3f]*[ -/]*|O)$/;

const FONT_SIZE_KEY = "lite.terminal.fontSize";

export function TerminalView({
  sessionId,
  agent,
  theme,
  active,
  working,
  starting,
  onPrompt,
  onRecover,
}: {
  sessionId: string;
  agent: Agent;
  theme: Theme;
  active: boolean;
  working: boolean;
  starting: boolean;
  onPrompt: (text: string) => void;
  onRecover: () => Promise<void>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Held in a ref so a new prompt handler never rebuilds the terminal underneath the session.
  const promptRef = useRef(onPrompt);
  promptRef.current = onPrompt;
  const recoverRef = useRef(onRecover);
  recoverRef.current = onRecover;
  const terminalRef = useRef<Terminal | null>(null);
  const zoomRef = useRef<(step: -1 | 0 | 1) => void>(() => undefined);
  const resizeRef = useRef<() => void>(() => undefined);
  const checkRef = useRef(true);
  const workingRef = useRef(working);
  if (workingRef.current && !working) checkRef.current = true;
  workingRef.current = working;
  // Read when a terminal is built, so switching sessions paints the new one in the current theme
  // without rebuilding it every time the theme changes.
  const themeRef = useRef(theme);
  themeRef.current = theme;
  // Followed without a rebuild, so a shell that starts an agent is picked up.
  const agentRef = useRef(agent);
  agentRef.current = agent;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Held here as well as on the terminal, so a zoom step reads the size it last set rather than
    // asking an option that is typed as though it might never have been given one.
    let fontSize = storedFontSize(FONT_SIZE_KEY);
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize,
      lineHeight: 1.25,
      linkHandler: {
        activate: (event, url) => {
          event.preventDefault();
          void invoke("open_url", { url });
        },
      },
      scrollback: 5000,
      theme: themes[themeRef.current],
    });
    terminalRef.current = terminal;
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    // Links go to the system browser, the way every other terminal handles them.
    terminal.loadAddon(
      new WebLinksAddon((event, url) => {
        event.preventDefault();
        void invoke("open_url", { url });
      }),
    );
    terminal.open(container);
    const unsubscribe = subscribeOutput(sessionId, (data) => terminal.write(data));
    // What the user types before the first Enter is the closest thing a session has to a subject.
    // Typing, pasting, and the terminal's own answers to the program's cursor, focus, and color
    // queries all arrive here, and an answer is printable once its escape is dropped, so the escape
    // sequences are removed and only what a person actually typed is left to read.
    let typed = "";
    // An event can end mid-sequence, so an unfinished tail waits for the rest instead of being read.
    let pending = "";
    const input = terminal.onData((data) => {
      if (checkRef.current) {
        checkRef.current = false;
        void recoverRef.current().catch(() => {});
      }
      const buffer = pending + data;
      const partial = buffer.match(PARTIAL);
      pending = partial?.[0] ?? "";
      for (const character of buffer.slice(0, partial?.index ?? buffer.length).replace(SEQUENCES, "")) {
        if (character === "\r" || character === "\n") {
          const line = typed.trim();
          typed = "";
          if (line) promptRef.current(line);
        } else if (character === "\u007f") typed = typed.slice(0, -1);
        else if (character >= " ") typed += character;
      }
      writeSession(sessionId, data);
    });
    const resize = () => {
      fit.fit();
      void invoke("resize_session", {
        sessionId,
        cols: terminal.cols,
        rows: terminal.rows,
      });
    };
    resizeRef.current = resize;
    zoomRef.current = (step) => {
      fontSize = zoomedFontSize(FONT_SIZE_KEY, fontSize, step);
      terminal.options.fontSize = fontSize;
      requestAnimationFrame(resize);
    };
    // A width change arrives as a stream of frames: a drag, or the ease a collapsing panel runs
    // through. Fitting on each one rewraps the scrollback and hands the child a window size it is
    // never shown at, so the terminal is fitted once the size has settled.
    let settle = 0;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(settle);
      settle = window.setTimeout(resize, 100);
    });
    observer.observe(container);
    // Command and the zoom keys resize the type, as they do in a terminal app.
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      // Without the kitty keyboard protocol, Escape+Return is the newline the agent CLIs read.
      if (
        agentRef.current !== "shell" &&
        event.key === "Enter" &&
        event.shiftKey &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        // Returning false leaves the keypress to follow and send a bare carriage return.
        event.preventDefault();
        terminal.input("\x1b\r");
        return false;
      }
      // xterm defers ASCII capitals to keypress for macOS IMEs. WKWebView also emits text input for
      // Shift and Caps Lock capitals, so that path can forward one physical key more than once.
      if (
        !event.isComposing &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        event.keyCode !== 229 &&
        event.key.length === 1 &&
        event.key >= "A" &&
        event.key <= "Z"
      ) {
        event.preventDefault();
        event.stopPropagation();
        terminal.input(event.key);
        return false;
      }
      if (!(event.metaKey || event.ctrlKey)) return true;
      const step = event.key === "+" || event.key === "=" ? 1 : event.key === "-" ? -1 : 0;
      if (!step && event.key !== "0") return true;
      zoomRef.current(step);
      return false;
    });
    resize();

    return () => {
      window.clearTimeout(settle);
      observer.disconnect();
      input.dispose();
      unsubscribe();
      terminal.dispose();
      terminalRef.current = null;
      zoomRef.current = () => undefined;
      resizeRef.current = () => undefined;
    };
  }, [sessionId]);

  useEffect(() => {
    if (active) terminalRef.current?.focus();
  }, [active]);

  useEffect(() => {
    if (!starting) requestAnimationFrame(() => resizeRef.current());
  }, [starting]);

  useEffect(() => {
    if (terminalRef.current) terminalRef.current.options.theme = themes[theme];
  }, [theme]);

  // The padding belongs on the wrapper, never on the element the terminal is opened in. The fit addon
  // sizes the terminal from getComputedStyle(parent).height, which WebKit reports as the border box,
  // and it only subtracts padding declared on the terminal's own element. Padding here would be
  // counted as usable space, so the terminal laid out a row and three columns more than fit and hung
  // them past the edge, which also left the last row below the viewport where the scrollbar could
  // neither show nor reach it.
  return (
    <div data-context-session={sessionId} data-context-zoom className="h-full w-full bg-background p-3">
      <button type="button" hidden data-context-zoom-in onClick={() => zoomRef.current(1)} />
      <button type="button" hidden data-context-zoom-out onClick={() => zoomRef.current(-1)} />
      <button type="button" hidden data-context-zoom-reset onClick={() => zoomRef.current(0)} />
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
