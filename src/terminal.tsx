// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { invoke } from "@tauri-apps/api/core";
import { FitAddon } from "@xterm/addon-fit";
import { type ISearchOptions, SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { type ITheme, Terminal } from "@xterm/xterm";
import { ArrowDownToLine, ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";

import { ActionIconButton } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import {
  connectTerminalOutput,
  MAX_OUTPUT_BYTES,
  notifyTerminalOutput,
  readTerminalStream,
  recordTerminalInput,
  subscribeOutput,
  writeSession,
} from "@/output-store";
import { IS_MAC, matchesShortcut } from "@/shortcuts";
import type { Theme } from "@/theme";
import type { Agent } from "@/types";

const SEARCH_HIGHLIGHT_LIMIT = 5000;
const countFormat = new Intl.NumberFormat();
const searchHighlights: Record<Theme, { match: string; active: string }> = {
  light: { match: "#fff8c5", active: "#d4a72c" },
  dark: { match: "#5a4314", active: "#9e6a03" },
};

function searchOptions(theme: Theme): ISearchOptions {
  const highlights = searchHighlights[theme];
  return {
    decorations: {
      matchBackground: highlights.match,
      matchOverviewRuler: "#d4a72c",
      activeMatchBackground: highlights.active,
      activeMatchColorOverviewRuler: "#9a6700",
    },
  };
}

// Surface colors follow the app tokens; ANSI colors follow GitHub light and dark, matching the code preview.
const themes: Record<Theme, ITheme> = {
  light: {
    background: "#ffffff",
    foreground: "#0a0a0a",
    scrollbarSliderBackground: "#6e778166",
    scrollbarSliderHoverBackground: "#6e778199",
    scrollbarSliderActiveBackground: "#6e7781cc",
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
    scrollbarSliderBackground: "#8b949e66",
    scrollbarSliderHoverBackground: "#8b949e99",
    scrollbarSliderActiveBackground: "#8b949ecc",
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

function renderedOutput(terminal: Terminal) {
  let text = "";
  const { active, normal } = terminal.buffer;
  for (const buffer of active.type === "normal" ? [active] : [normal, active]) {
    if (text) text += "\n";
    let inputStart = -1;
    let inputEnd = -1;
    if (buffer === active) {
      inputStart = buffer.baseY + buffer.cursorY;
      inputEnd = inputStart;
      while (inputStart > 0 && buffer.getLine(inputStart)?.isWrapped) inputStart--;
      while (inputEnd + 1 < buffer.length && buffer.getLine(inputEnd + 1)?.isWrapped) inputEnd++;
    }
    for (let index = 0; index < buffer.length; index++) {
      // The cursor's logical line is still being typed or streamed. It becomes readable history only
      // after the terminal advances, which keeps partial URLs and PR numbers out of the inspector.
      if (index >= inputStart && index <= inputEnd) continue;
      const line = buffer.getLine(index);
      if (!line) continue;
      if (index && !line.isWrapped) text += "\n";
      text += line.translateToString(true, 0, Math.min(line.length, terminal.cols));
    }
  }
  return text.slice(-MAX_OUTPUT_BYTES);
}

export function TerminalView({
  sessionId,
  agent,
  theme,
  fontSize,
  active,
  working,
  starting,
  onZoom,
  onPrompt,
  onOutput,
  onRecover,
}: {
  sessionId: string;
  agent: Agent;
  theme: Theme;
  fontSize: number;
  active: boolean;
  working: boolean;
  starting: boolean;
  onZoom: (step: -1 | 0 | 1) => void;
  onPrompt: (text: string) => void;
  onOutput: (output: string, terminalStream: string) => void;
  onRecover: () => Promise<void>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Held in a ref so a new prompt handler never rebuilds the terminal underneath the session.
  const promptRef = useRef(onPrompt);
  promptRef.current = onPrompt;
  const outputRef = useRef(onOutput);
  outputRef.current = onOutput;
  const recoverRef = useRef(onRecover);
  recoverRef.current = onRecover;
  const zoomRef = useRef(onZoom);
  zoomRef.current = onZoom;
  const terminalRef = useRef<Terminal | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResult, setSearchResult] = useState({ resultIndex: -1, resultCount: 0 });
  const [scrolledUp, setScrolledUp] = useState(false);
  const searchQueryRef = useRef("");
  const resizeRef = useRef<() => void>(() => undefined);
  const checkRef = useRef(true);
  const workingRef = useRef(working);
  if (workingRef.current && !working) checkRef.current = true;
  workingRef.current = working;
  // Read when a terminal is built, so switching sessions paints the new one in the current theme
  // without rebuilding it every time the theme changes.
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const fontSizeRef = useRef(fontSize);
  fontSizeRef.current = fontSize;
  // Followed without a rebuild, so a shell that starts an agent is picked up.
  const agentRef = useRef(agent);
  agentRef.current = agent;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const terminal = new Terminal({
      // The official search addon uses xterm decorations to count and mark every match.
      allowProposedApi: true,
      cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: fontSizeRef.current,
      lineHeight: 1.25,
      overviewRuler: { width: 6 },
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
    const searchAddon = new SearchAddon({ highlightLimit: SEARCH_HIGHLIGHT_LIMIT });
    searchAddonRef.current = searchAddon;
    terminal.loadAddon(searchAddon);
    const searchResults = searchAddon.onDidChangeResults((result) => {
      setSearchResult(result);
    });
    // Links go to the system browser, the way every other terminal handles them.
    terminal.loadAddon(
      new WebLinksAddon((event, url) => {
        event.preventDefault();
        void invoke("open_url", { url });
      }),
    );
    terminal.open(container);
    const scroll = terminal.onScroll((viewportY) => setScrolledUp(viewportY < terminal.buffer.active.baseY));
    const disconnectTerminalOutput = connectTerminalOutput(sessionId, () => renderedOutput(terminal));
    // The addon waits for output to go quiet before rebuilding its result map, which a live TUI may
    // never do. Refresh at a bounded rate while it writes; the addon's own timer handles the final pass.
    let searchRefresh = 0;
    let outputRefresh = 0;
    const refreshSearch = () => {
      const query = searchQueryRef.current;
      if (!query) return;
      // Clearing decorations leaves xterm's selection in place, so the addon rebuilds highlights and
      // reselects that same match directly instead of replaying every earlier match.
      searchAddon.clearDecorations();
      searchAddon.findNext(query, { ...searchOptions(themeRef.current), incremental: true });
    };
    const rememberOutput = () => outputRef.current(renderedOutput(terminal), readTerminalStream(sessionId));
    const parsed = terminal.onWriteParsed(() => {
      notifyTerminalOutput(sessionId);
      if (!outputRefresh) {
        rememberOutput();
        outputRefresh = window.setTimeout(() => {
          outputRefresh = 0;
          rememberOutput();
        }, 250);
      }
      if (!searchQueryRef.current) return;
      if (!searchRefresh)
        searchRefresh = window.setTimeout(() => {
          searchRefresh = 0;
          refreshSearch();
        }, 200);
    });
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
          if (line) {
            recordTerminalInput(sessionId, line);
            promptRef.current(line);
          }
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
      const step = matchesShortcut(event, "zoomIn")
        ? 1
        : matchesShortcut(event, "zoomOut")
          ? -1
          : matchesShortcut(event, "zoomReset")
            ? 0
            : undefined;
      if (step === undefined) return true;
      zoomRef.current(step);
      return false;
    });
    resize();

    return () => {
      window.clearTimeout(settle);
      window.clearTimeout(searchRefresh);
      window.clearTimeout(outputRefresh);
      observer.disconnect();
      searchResults.dispose();
      scroll.dispose();
      input.dispose();
      unsubscribe();
      parsed.dispose();
      disconnectTerminalOutput();
      terminal.dispose();
      terminalRef.current = null;
      searchAddonRef.current = null;
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
    const terminal = terminalRef.current;
    if (!terminal) return;
    const query = searchQueryRef.current;
    terminal.options.theme = query
      ? { ...themes[theme], selectionBackground: searchHighlights[theme].active }
      : themes[theme];
    const searchAddon = searchAddonRef.current;
    if (query && searchAddon) {
      searchAddon.clearDecorations();
      searchAddon.findNext(query, { ...searchOptions(theme), incremental: true });
    }
  }, [theme]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || terminal.options.fontSize === fontSize) return;
    terminal.options.fontSize = fontSize;
    requestAnimationFrame(() => resizeRef.current());
  }, [fontSize]);

  useEffect(() => {
    if (!searchOpen) return;
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, [searchOpen]);

  function find(term: string, previous = false, incremental = false) {
    const searchAddon = searchAddonRef.current;
    if (!searchAddon) return;
    const terminal = terminalRef.current;
    if (!term) {
      searchAddon.clearDecorations();
      if (terminal) terminal.options.theme = themes[themeRef.current];
      const result = { resultIndex: -1, resultCount: 0 };
      setSearchResult(result);
      return;
    }
    if (terminal && terminal.options.theme?.selectionBackground === themes[themeRef.current].selectionBackground)
      terminal.options.theme = {
        ...themes[themeRef.current],
        selectionBackground: searchHighlights[themeRef.current].active,
      };
    searchAddon[previous ? "findPrevious" : "findNext"](term, { ...searchOptions(themeRef.current), incremental });
  }

  function closeSearch() {
    searchAddonRef.current?.clearDecorations();
    if (terminalRef.current) terminalRef.current.options.theme = themes[themeRef.current];
    setSearchOpen(false);
    setSearchQuery("");
    searchQueryRef.current = "";
    const result = { resultIndex: -1, resultCount: 0 };
    setSearchResult(result);
    terminalRef.current?.focus();
  }

  // Opening on a selection searches for it, as the editor's find does; the field is then selected so
  // typing replaces it.
  function openSearch() {
    const selection = terminalRef.current?.getSelection().trim() ?? "";
    if (selection && !selection.includes("\n") && selection.length <= 100) {
      searchQueryRef.current = selection;
      setSearchQuery(selection);
      find(selection, false, true);
    }
    if (searchOpen) {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    } else setSearchOpen(true);
  }

  function scrollToBottom() {
    terminalRef.current?.scrollToBottom();
    terminalRef.current?.focus();
  }

  // The padding belongs on the wrapper, never on the element the terminal is opened in. The fit addon
  // sizes the terminal from getComputedStyle(parent).height, which WebKit reports as the border box,
  // and it only subtracts padding declared on the terminal's own element. Padding here would be
  // counted as usable space, so the terminal laid out a row and three columns more than fit and hung
  // them past the edge, which also left the last row below the viewport where the scrollbar could
  // neither show nor reach it.
  return (
    <div
      data-context-session={sessionId}
      data-context-zoom
      className="relative h-full w-full bg-background p-3 pr-1.5"
      onKeyDownCapture={(event) => {
        if (searchOpen && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          closeSearch();
          return;
        }
        if (
          searchOpen &&
          (event.key === "F3" || ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "g"))
        ) {
          event.preventDefault();
          event.stopPropagation();
          find(searchQuery, event.shiftKey);
          return;
        }
        if (matchesShortcut(event.nativeEvent, "find")) {
          event.preventDefault();
          event.stopPropagation();
          openSearch();
        }
      }}
    >
      <button type="button" hidden data-context-zoom-in onClick={() => zoomRef.current(1)} />
      <button type="button" hidden data-context-zoom-out onClick={() => zoomRef.current(-1)} />
      <button type="button" hidden data-context-zoom-reset onClick={() => zoomRef.current(0)} />
      <button type="button" hidden data-terminal-search onClick={openSearch} />
      <button type="button" hidden data-terminal-scroll-bottom onClick={scrollToBottom} />
      {searchOpen ? (
        <div className="absolute top-2 right-[8.5rem] z-10 w-72 max-w-[calc(100%-9rem)] rounded-lg bg-background shadow-lg">
          <InputGroup>
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              ref={searchInputRef}
              value={searchQuery}
              placeholder="Find in terminal"
              aria-label="Find in terminal"
              onChange={(event) => {
                searchQueryRef.current = event.target.value;
                setSearchQuery(event.target.value);
                find(event.target.value, false, true);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                  event.preventDefault();
                  find(searchQuery, event.key === "ArrowUp");
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  find(searchQuery, event.shiftKey);
                }
              }}
            />
            <InputGroupAddon align="inline-end" className="gap-0 pr-1">
              <span className="min-w-14 px-1 text-center text-xs tabular-nums" aria-live="polite" aria-atomic="true">
                {searchResult.resultCount
                  ? searchResult.resultIndex >= 0
                    ? countFormat.format(searchResult.resultIndex + 1)
                    : "–"
                  : "0"}{" "}
                / {countFormat.format(searchResult.resultCount)}
                {searchResult.resultCount >= SEARCH_HIGHLIGHT_LIMIT ? "+" : ""}
              </span>
              <InputGroupButton
                size="icon-xs"
                tooltip={`Previous match · ${IS_MAC ? "⇧↩" : "Shift+Enter"}`}
                aria-label="Previous match"
                disabled={!searchQuery}
                onClick={() => find(searchQuery, true)}
              >
                <ChevronUp />
              </InputGroupButton>
              <InputGroupButton
                size="icon-xs"
                tooltip={`Next match · ${IS_MAC ? "↩" : "Enter"}`}
                aria-label="Next match"
                disabled={!searchQuery}
                onClick={() => find(searchQuery)}
              >
                <ChevronDown />
              </InputGroupButton>
              <InputGroupButton size="icon-xs" tooltip="Close · Esc" aria-label="Close search" onClick={closeSearch}>
                <X />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </div>
      ) : null}
      {scrolledUp ? (
        <ActionIconButton
          size="icon-sm"
          className="absolute bottom-5 left-1/2 z-10 -translate-x-1/2 rounded-full bg-background/90 text-muted-foreground shadow-sm"
          tooltip="Scroll to bottom"
          tooltipSide="top"
          aria-label="Scroll to bottom"
          onMouseDown={(event) => event.preventDefault()}
          onClick={scrollToBottom}
        >
          <ArrowDownToLine />
        </ActionIconButton>
      ) : null}
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
