// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ChevronLeft,
  ChevronRight,
  GitBranch,
  KeyRound,
  Moon,
  MoreHorizontal,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  SquareTerminal,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import { Component, lazy, type ReactNode, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { LiteLogomark, ProviderIcon } from "@/brand-icons";
import { Badge } from "@/components/ui/badge";
import { ActionIconButton, Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  type PanelImperativeHandle,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Inspector } from "@/inspector";
import { NewSessionDialog } from "@/new-session-dialog";
import { appendOutput, clearOutput, subscribeOutput } from "@/output-store";
import { SettingsDialog } from "@/settings-dialog";
import { applyTheme, initialTheme, type Theme } from "@/theme";
import { type Session, sessionLabel } from "@/types";
import "./App.css";

const STORAGE_KEY = "lite.sessions.v1";
// The width each side collapses to: one icon button and the room around it.
const RAIL = 44;
// Where a side stops following the pointer. It has no room to be anything but its rail by here, so it
// becomes one and collapses the rest of the way itself, in one eased step.
const SHUT = 140;
// A side reopens to the share of the window it started with, in the pixels a glide is measured in.
function share(panel: PanelImperativeHandle | null, portion: string) {
  const size = panel?.getSize();
  if (!size || !size.asPercentage) return 0;
  return Math.round((size.inPixels / size.asPercentage) * Number.parseFloat(portion));
}

// How long a side takes to open or close under its own power.
const GLIDE_MS = 200;

// The library reads every size back off the elements it laid out, so a CSS transition on a panel feeds
// its own animation into the next layout and the two fight — measurably: an expanding panel is read as
// one being dragged shut and pulled closed again. The ease is driven here instead, a resize per frame,
// so what the library measures is always what it was last told. A drag owns the panel outright, so a
// glide gets out of the way the moment one starts.
const glides = new WeakMap<PanelImperativeHandle, number>();
function glide(panel: PanelImperativeHandle | null, to: number) {
  if (!panel) return;
  // One glide owns a side at a time. Two would drive the same panel from two captured widths at once,
  // which is what shutting a side and reopening it inside the same fifth of a second asks for.
  const turn = (glides.get(panel) ?? 0) + 1;
  glides.set(panel, turn);
  const from = panel.getSize().inPixels;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || from === to) {
    panel.resize(`${to}px`);
    return;
  }
  const started = performance.now();
  const step = (now: number) => {
    if (glides.get(panel) !== turn || document.querySelector("[data-separator=active]")) return;
    const part = Math.min(1, (now - started) / GLIDE_MS);
    try {
      // Ease out: fastest at the start, so the side answers the click before it settles.
      panel.resize(`${Math.round(from + (to - from) * (1 - (1 - part) ** 3))}px`);
    } catch {
      // A panel that has gone away — the inspector leaving with the last session — cannot be asked
      // whether it is still there, only told to resize, so this is the one way to hear that it is not.
      return;
    }
    if (part < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
const SIDES = {
  sidebar: { size: "20%", max: "30%" },
  inspector: { size: "25%", max: "40%" },
} as const;
const TerminalView = lazy(() => import("@/terminal").then((module) => ({ default: module.TerminalView })));
// The version is known from the start, so the badge shows it throughout and only its color waits on
// the answer: grey while asking, which is quieter than a spinner that would resize a chip this small.
const BADGE_VARIANT = {
  checking: "secondary",
  current: "success",
  behind: "warning",
  unknown: "outline",
} as const;

const RELEASE_NOTE = {
  checking: "",
  current: " · up to date",
  behind: " · an update is available",
  unknown: "",
} as const;

type UpdateStatus = "checking" | "available" | "rebuild" | "current" | "installing" | "error";

// How long a session has to stay quiet before it counts as connected but idle rather than working.
// Long enough that the gaps between an agent's own writes do not flicker the dot.
const QUIET_MS = 1200;

// Three states the sidebar dot tells apart: the terminal is gone, it is up and quiet, or it is up and
// producing output. Each gets its own color, so the state survives a display where the pulse is
// suppressed and the motion only reinforces what green already says.
const SESSION_STATUS = {
  disconnected: { dot: "bg-muted-foreground/40", label: "Disconnected" },
  idle: { dot: "bg-emerald-500", label: "Connected, idle" },
  working: { dot: "bg-blue-500 animate-pulse motion-reduce:animate-none", label: "Connected, working" },
} as const;

// A local build names its commit and is red, so it is never mistaken for the installed copy.
// A release names its version and says at a glance whether it is the current one. The top bar and the
// update dialog render this one badge, so the version, the release date and the link to it are stated
// in exactly one place and cannot drift apart.
function VersionBadge({
  version,
  commit,
  built,
  release,
  onCheck,
}: {
  version: string;
  commit: string | undefined;
  built: string;
  release: keyof typeof BADGE_VARIANT;
  onCheck: () => void;
}) {
  if (!commit && !version) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge
            variant={commit ? "error" : BADGE_VARIANT[release]}
            render={<button type="button" onClick={onCheck} />}
          >
            {commit || version}
          </Badge>
        }
      />
      <TooltipContent>
        {commit ? (
          `Local build${built ? ` from ${built}` : ""} · click to compare with your working tree`
        ) : (
          <span className="flex flex-col gap-0.5">
            <span>
              {`Lite ${version}${RELEASE_NOTE[release]}`}
              {built ? ` · released ${built}` : ""}
            </span>
            <button
              type="button"
              className="underline underline-offset-2"
              onClick={() =>
                void invoke("open_url", {
                  url: `https://github.com/ultralytics/lite/releases/tag/v${version}`,
                })
              }
            >
              View this release on GitHub
            </button>
          </span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

function loadSessions(): Session[] {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as Session[];
    // A session stored before Lite read window titles kept no record of who named it, so a name it did
    // not get from its folder is treated as the user's rather than replaced by the first title to arrive.
    return stored
      .filter((session) => session.rootId)
      .map((session) => ({
        ...session,
        running: false,
        renamed: session.renamed ?? session.name !== folderName(session.cwd),
      }));
  } catch {
    return [];
  }
}

// Keeps a failing panel from taking the whole window down with it.
class PanelBoundary extends Component<{ children: ReactNode }, { message: string }> {
  state = { message: "" };

  static getDerivedStateFromError(error: unknown) {
    return { message: String(error) };
  }

  render() {
    if (!this.state.message) return this.props.children;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-xs font-medium">This panel stopped responding.</p>
        <p className="text-xs text-muted-foreground">{this.state.message}</p>
      </div>
    );
  }
}

// What a session looks like at a glance: who runs it and whether it is up. The sidebar row and the rail
// it collapses to show the same one, so a session is recognizable at either width.
function SessionBadge({
  session,
  active,
  starting,
  working,
}: {
  session: Session;
  active: boolean;
  starting: boolean;
  working: boolean;
}) {
  const status = SESSION_STATUS[!session.running ? "disconnected" : working ? "working" : "idle"];
  const ring = active ? "ring-sidebar-accent" : "ring-sidebar";
  return (
    <span className="relative flex size-7 shrink-0 items-center justify-center rounded-md border bg-background">
      <ProviderIcon agent={session.agent} provider={session.provider} />
      {starting ? (
        <Spinner
          className={`absolute -right-1 -bottom-1 size-3 rounded-full bg-background text-muted-foreground ring-2 ${ring}`}
        />
      ) : (
        <span
          role="img"
          className={`absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ${ring} ${status.dot}`}
          aria-label={status.label}
        />
      )}
    </span>
  );
}

function SessionRow({
  session,
  active,
  starting,
  working,
  onSelect,
  onRename,
  onRestart,
  onClose,
}: {
  session: Session;
  active: boolean;
  starting: boolean;
  working: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onRestart: () => void;
  onClose: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(session.name);

  function saveName() {
    const next = name.trim();
    if (next) onRename(next);
    else setName(session.name);
    setRenaming(false);
  }

  return (
    <div
      className={`group flex items-center rounded-lg pr-1 ${active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/60"}`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5 py-1.5 pl-2">
        <SessionBadge session={session} active={active} starting={starting} working={working} />
        {renaming ? (
          <span className="min-w-0 flex-1 py-0.5">
            <Input
              autoFocus
              value={name}
              className="px-1.5"
              aria-label="Session name"
              onChange={(event) => setName(event.target.value)}
              onBlur={saveName}
              onKeyDown={(event) => {
                if (event.key === "Enter") saveName();
                if (event.key === "Escape") {
                  setName(session.name);
                  setRenaming(false);
                }
              }}
            />
          </span>
        ) : (
          /* Clicking a session opens it, and a stopped one comes back with it. Only the session already
             open and running reads a click as a rename, so a name is still reachable without a menu and
             a click never surprises you with a text field. */
          <button
            type="button"
            className="min-w-0 flex-1 py-0.5 text-left"
            onClick={() => (active && session.running ? setRenaming(true) : onSelect())}
            onDoubleClick={() => setRenaming(true)}
            title={session.cwd}
          >
            <span className="block truncate text-xs font-medium">{session.name}</span>
            <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
              {shortPath(session.cwd)}
            </span>
          </button>
        )}
      </div>
      {/* Hidden rather than transparent, so a name gets the whole row until the pointer arrives. */}
      <span className="hidden shrink-0 items-center group-hover:flex group-focus-within:flex">
        <ActionIconButton
          variant="ghost"
          size="icon-sm"
          tooltip="Restart"
          aria-label={`Restart ${session.name}`}
          disabled={starting}
          onClick={onRestart}
        >
          <RotateCcw />
        </ActionIconButton>
        <ActionIconButton
          variant="ghost"
          size="icon-sm"
          className="hover:text-destructive"
          tooltip="Close session"
          aria-label={`Close ${session.name}`}
          disabled={starting}
          onClick={onClose}
        >
          <Trash2 />
        </ActionIconButton>
      </span>
    </div>
  );
}

// Kimi has no flag for starting a session: launching without an id joins the one the directory already
// has, and only its own /new command makes another. So a restart asks for it the way a person would,
// once the interface has drawn itself and can take the command.
function startKimiConversation(sessionId: string) {
  const decoder = new TextDecoder();
  let seen = "";
  let sent = false;
  const send = () => {
    if (sent) return;
    sent = true;
    unsubscribe();
    clearTimeout(timer);
    void invoke("write_session", { sessionId, data: Array.from(new TextEncoder().encode("/new\r")) });
  };
  const unsubscribe = subscribeOutput(sessionId, (data) => {
    seen += decoder.decode(data, { stream: true });
    if (seen.includes("Welcome to Kimi")) send();
  });
  // Its greeting may change; waiting forever for the words would be worse than asking a little late.
  const timer = setTimeout(send, 15_000);
}

function folderName(cwd: string) {
  return cwd.split(/[\\/]/).filter(Boolean).pop() ?? "Session";
}

// A remote names a repository; the scheme and host that reach it are the tooltip's job.
function repoName(url: string) {
  return url.replace(/^https:\/\/[^/]+\//, "");
}

// Paths truncate from the right, which hides the part that identifies the folder, so only its tail shows.
function shortPath(cwd: string) {
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join("/");
}

// A tab named after its folder says nothing, and several in one folder say the same nothing, so the
// session says what it is about: the window title its program sets, or the first thing asked of a
// program that sets none. A leading glyph is a spinner or a status mark rather than part of the
// subject, and it changes several times a second while saying nothing the badge does not already say,
// so the name is what follows it. A name the user chose is left alone.
// Codex names the window after the thread it is working on, and reports the thread's id until it has
// named it. An id is not a subject.
const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function subject(text: string) {
  const words = text
    .replace(/^[\p{S}\p{P}]\s+/u, "")
    .replace(/\s+/g, " ")
    .trim();
  return words.length > 40 ? `${words.slice(0, 40).trimEnd()}…` : words;
}

function App() {
  const [sessions, setSessions] = useState<Session[]>(loadSessions);
  const [selectedId, setSelectedId] = useState(() => sessions[0]?.id ?? "");
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [closing, setClosing] = useState<Session>();
  const [error, setError] = useState("");
  const [startingIds, setStartingIds] = useState<Set<string>>(new Set());
  // Sessions whose terminal has written something recently, which is what separates a connected
  // session that is working from one that is merely connected.
  const [working, setWorking] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  // Each side collapses to a rail of icons rather than to nothing, so the panel is still there to click
  // or drag back open. Dragging past the minimum is what collapses it; the handle never goes away.
  const [shut, setShut] = useState({ sidebar: false, inspector: false });
  const sidebarPanel = useRef<PanelImperativeHandle>(null);
  const inspectorPanel = useRef<PanelImperativeHandle>(null);
  // The browse URL of the selected folder's origin, empty when it has none or Lite cannot open it.
  const [remote, setRemote] = useState("");
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [version, setVersion] = useState("");
  // Undefined until asked: an empty string is a release, anything else is the commit it was built from.
  const [commit, setCommit] = useState<string>();
  const [built, setBuilt] = useState("");
  const [release, setRelease] = useState<"checking" | "current" | "behind" | "unknown">("checking");
  const [updateOpen, setUpdateOpen] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("checking");
  const [availableVersion, setAvailableVersion] = useState("");
  const [updateError, setUpdateError] = useState("");
  const runs = useRef(new Map<string, string>());
  const workTimers = useRef(new Map<string, number>());
  const resumed = useRef("");
  const themeRef = useRef<Theme>("dark");
  const visibleRef = useRef<Session[]>([]);
  const selectedRef = useRef<Session>(undefined);
  const closeRef = useRef<(session: Session) => void>(() => {});
  const openRef = useRef<(session: Session) => void>(() => {});
  const selected = useMemo(() => sessions.find((session) => session.id === selectedId), [sessions, selectedId]);
  // A session is found by what names it: the subject it was given and the folder it works in.
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return sessions;
    return sessions.filter(
      (session) => session.name.toLowerCase().includes(needle) || session.cwd.toLowerCase().includes(needle),
    );
  }, [sessions, query]);
  visibleRef.current = visible;
  themeRef.current = theme;
  selectedRef.current = selected;
  closeRef.current = setClosing;
  openRef.current = (session) => {
    setSelectedId(session.id);
    if (!session.running) void launch(session, true);
  };

  // A drag reports every frame, so a side changes state only when the answer changes: handing back the
  // same object leaves React with nothing to redraw while the divider moves.
  const rail = useCallback((side: keyof typeof SIDES, size: { inPixels: number }) => {
    const next = size.inPixels < SHUT;
    // A shut sidebar has nowhere to show a search field, so the filter closes with it rather than
    // leaving the rail and the number shortcuts counting two different lists.
    if (side === "sidebar" && next) setQuery("");
    setShut((current) => (current[side] === next ? current : { ...current, [side]: next }));
  }, []);

  // The inspector panel goes away with the last session and comes back at its default width, so what
  // the sides remember about it is reset with it rather than corrected by the first measurement.
  const hasSelection = Boolean(selected);
  useEffect(() => {
    if (!hasSelection) setShut((current) => (current.inspector ? { ...current, inspector: false } : current));
  }, [hasSelection]);

  // A side dragged under the width where it can only be a rail is a side being closed, so it closes
  // the rest of the way once the pointer lets go of it rather than sitting at whatever width the hand
  // happened to stop at. Under the pointer it stays exactly where the pointer put it.
  useEffect(() => {
    const settle = () => {
      for (const panel of [sidebarPanel.current, inspectorPanel.current]) {
        const width = panel?.getSize().inPixels;
        if (panel && width !== undefined && width < SHUT && width > RAIL) glide(panel, RAIL);
      }
    };
    window.addEventListener("pointerup", settle);
    return () => window.removeEventListener("pointerup", settle);
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Fullscreen hides the window buttons, so the room the bar keeps for them goes with them.
  useEffect(() => {
    if (document.documentElement.dataset.titlebar === undefined) return;
    const window = getCurrentWindow();
    const sync = async () => {
      document.documentElement.dataset.titlebar = (await window.isFullscreen()) ? "plain" : "overlay";
    };
    void sync();
    const resized = window.onResized(() => void sync());
    return () => void resized.then((unlisten) => unlisten());
  }, []);

  // The shortcuts a terminal app is expected to answer. The terminal keeps every key Lite does not claim.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!event.metaKey && !event.ctrlKey) return;
      if (event.key === "n") setNewSessionOpen(true);
      else if (event.key === ",") setSettingsOpen(true);
      else if (event.key === "w" && selectedRef.current) closeRef.current(selectedRef.current);
      else if (event.key >= "1" && event.key <= "9") {
        // The numbers count the sessions the sidebar is showing, so a search narrows them with the list.
        const target = visibleRef.current[Number(event.key) - 1];
        if (!target) return;
        // Reaching a session by number is the same act as clicking it, including bringing it back.
        openRef.current(target);
      } else return;
      event.preventDefault();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(sessions.filter((session) => !session.mode).map((session) => ({ ...session, running: false }))),
    );
  }, [sessions]);

  useEffect(() => {
    void getVersion()
      .then(setVersion)
      .catch(() => setVersion(""));
    void invoke<string | null>("build_date")
      .then((value) => setBuilt(value ?? ""))
      .catch(() => setBuilt(""));
    void invoke<string | null>("local_commit")
      .then((value) => setCommit(value ?? ""))
      .catch(() => setCommit(""));
  }, []);

  // One owner for the release question, so the startup check and a manual one cannot contradict each
  // other: the ask that started last is the only one still allowed to answer, and a slow startup reply
  // can no longer land on top of a fresh manual result.
  const releaseAsk = useRef(0);
  const askRelease = useCallback(async () => {
    const ask = ++releaseAsk.current;
    setRelease("checking");
    try {
      const next = await invoke<string | null>("check_update");
      if (ask === releaseAsk.current) setRelease(next ? "behind" : "current");
      return next;
    } catch (reason) {
      if (ask === releaseAsk.current) setRelease("unknown");
      throw reason;
    }
  }, []);

  // Only a release can be behind a release. Asking costs a network round trip that is never worth
  // delaying a paint or a restored session for, so it waits for the window to go idle and is dropped
  // if the window goes away first.
  useEffect(() => {
    if (commit !== "") return;
    let cancelled = false;
    const check = () => {
      if (!cancelled) void askRelease().catch(() => {});
    };
    const idle = typeof window.requestIdleCallback === "function";
    const handle = idle ? window.requestIdleCallback(check, { timeout: 10000 }) : window.setTimeout(check, 3000);
    return () => {
      cancelled = true;
      if (idle) window.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
    };
  }, [commit, askRelease]);

  // Output arrives as a stream of chunks, so this touches React state only on the two edges of a
  // burst: the first chunk marks the session working, and a quiet spell marks it idle again. Between
  // those the timer is just reset, which keeps a busy session from re-rendering the sidebar per chunk.
  const markWorking = useCallback((sessionId: string) => {
    const timers = workTimers.current;
    const pending = timers.get(sessionId);
    if (pending) window.clearTimeout(pending);
    else setWorking((current) => new Set(current).add(sessionId));
    timers.set(
      sessionId,
      window.setTimeout(() => {
        timers.delete(sessionId);
        setWorking((current) => {
          const next = new Set(current);
          next.delete(sessionId);
          return next;
        });
      }, QUIET_MS),
    );
  }, []);

  // A working session retitles itself several times a second, nearly always to what the tab already
  // says, so the list it would re-render is handed back untouched unless the subject really changed.
  // A sign-in tab says what it is for and is gone as soon as it is done, and not every title is a
  // subject: a program with nothing to say yet names the window after itself, which the badge already
  // says and the folder name beats.
  const markTitle = useCallback((sessionId: string, title: string) => {
    setSessions((current) => {
      const session = current.find((item) => item.id === sessionId);
      if (!session || session.mode || session.renamed) return current;
      const name = subject(title);
      if (!name || name === session.name || name === sessionLabel(session) || THREAD_ID.test(name)) return current;
      return current.map((item) => (item.id === sessionId ? { ...item, name } : item));
    });
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlistenOutput: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;
    void Promise.all([
      listen<{ sessionId: string; runId: string; data: number[] }>("pty-output", ({ payload }) => {
        if (runs.current.get(payload.sessionId) !== payload.runId) return;
        const title = appendOutput(payload.sessionId, payload.data);
        if (title) markTitle(payload.sessionId, title);
        markWorking(payload.sessionId);
      }),
      listen<{ sessionId: string; runId: string }>("pty-exit", ({ payload }) => {
        if (runs.current.get(payload.sessionId) !== payload.runId) return;
        runs.current.delete(payload.sessionId);
        setSessions((current) =>
          current.map((session) => (session.id === payload.sessionId ? { ...session, running: false } : session)),
        );
      }),
    ]).then(([output, exit]) => {
      if (disposed) {
        output();
        exit();
        return;
      }
      unlistenOutput = output;
      unlistenExit = exit;
    });
    const timers = workTimers.current;
    return () => {
      disposed = true;
      unlistenOutput?.();
      unlistenExit?.();
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
  }, [markWorking, markTitle]);

  const launch = useCallback(async (session: Session, resume: boolean) => {
    if (runs.current.has(session.id)) return;
    const runId = crypto.randomUUID();
    runs.current.set(session.id, runId);
    setStartingIds((current) => new Set(current).add(session.id));
    setError("");
    try {
      const providerSessionId = await invoke<string | null>("spawn_session", {
        sessionId: session.id,
        runId,
        rootId: session.rootId,
        providerSessionId: session.providerSessionId,
        agent: session.agent,
        provider: session.provider,
        mode: session.mode,
        theme: themeRef.current,
        resume,
        cols: 100,
        rows: 30,
      });
      setStartingIds((current) => {
        const next = new Set(current);
        next.delete(session.id);
        return next;
      });
      if (runs.current.get(session.id) !== runId) return;
      setSessions((current) =>
        current.map((item) =>
          item.id === session.id
            ? {
                ...item,
                running: true,
                providerSessionId: providerSessionId ?? item.providerSessionId,
              }
            : item,
        ),
      );
    } catch (reason) {
      if (runs.current.get(session.id) === runId) runs.current.delete(session.id);
      setStartingIds((current) => {
        const next = new Set(current);
        next.delete(session.id);
        return next;
      });
      setSessions((current) => current.map((item) => (item.id === session.id ? { ...item, running: false } : item)));
      setError(String(reason));
    }
  }, []);

  // Opening the app, or coming back to a session, brings its provider process back on its own.
  useEffect(() => {
    if (!selected || selected.mode || selected.running || resumed.current === selected.id) return;
    resumed.current = selected.id;
    void launch(selected, true);
  }, [selected, launch]);

  // Which repository a folder was cloned from is a fact about the folder, so it is asked for once when
  // the selection changes and never watched.
  const rootId = selected?.rootId ?? "";
  useEffect(() => {
    setRemote("");
    if (!rootId) return;
    let cancelled = false;
    void invoke<string | null>("git_remote", { rootId })
      .then((url) => {
        if (!cancelled) setRemote(url ?? "");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [rootId]);

  async function signIn(agent: Session["agent"]) {
    setSettingsOpen(false);
    try {
      const grant = await invoke<{ id: string; path: string }>("default_directory");
      createSession({
        id: crypto.randomUUID(),
        agent,
        mode: "login",
        cwd: grant.path,
        rootId: grant.id,
        name: `Sign in · ${sessionLabel({ agent })}`,
        running: false,
      });
    } catch (reason) {
      setError(String(reason));
    }
  }

  function createSession(session: Session) {
    resumed.current = session.id;
    setSessions((current) => [...current, session]);
    setSelectedId(session.id);
    void launch(session, false);
  }

  // Restarting keeps the tab and its folder but asks the provider for a conversation of its own, so the
  // session it resumed by id is forgotten first and the tab takes a new one.
  async function restartSession(session: Session) {
    runs.current.delete(session.id);
    setSessions((current) => current.map((item) => (item.id === session.id ? { ...item, running: false } : item)));
    await invoke("stop_session", { sessionId: session.id });
    try {
      await invoke("delete_session_data", { sessionId: session.id });
    } catch (reason) {
      setError(String(reason));
    }
    clearOutput(session.id);
    const fresh: Session = { ...session, id: crypto.randomUUID(), providerSessionId: undefined, running: false };
    setSessions((current) => current.map((item) => (item.id === session.id ? fresh : item)));
    setSelectedId(fresh.id);
    resumed.current = fresh.id;
    await launch(fresh, false);
    if (fresh.agent === "kimi") startKimiConversation(fresh.id);
  }

  async function closeSession(session: Session) {
    runs.current.delete(session.id);
    await invoke("stop_session", { sessionId: session.id });
    let cleanupError = "";
    try {
      await invoke("delete_session_data", { sessionId: session.id });
    } catch (reason) {
      cleanupError = String(reason);
    }
    try {
      await invoke("revoke_directory", { rootId: session.rootId });
    } catch (reason) {
      cleanupError ||= String(reason);
    }
    clearOutput(session.id);
    setSessions((current) => current.filter((item) => item.id !== session.id));
    if (selectedId === session.id) setSelectedId(sessions.find((item) => item.id !== session.id)?.id ?? "");
    if (cleanupError) setError(`Session closed, but local cleanup failed: ${cleanupError}`);
  }

  async function checkForUpdates() {
    // The dialog owns an install once it has started one. Re-entering here would reset it out of
    // sight and offer a second install while the first is still running.
    if (updateOpen && (updateStatus === "checking" || updateStatus === "installing")) return;
    setUpdateOpen(true);
    setUpdateStatus("checking");
    setUpdateError("");
    try {
      // A release would replace this build rather than update it, so a local build asks its own tree.
      const next = commit ? await invoke<string | null>("local_update") : await askRelease();
      setAvailableVersion(next ?? "");
      setUpdateStatus(next ? (commit ? "rebuild" : "available") : "current");
    } catch (reason) {
      setUpdateError(String(reason));
      setUpdateStatus("error");
    }
  }

  async function installUpdate() {
    setUpdateStatus("installing");
    try {
      await invoke("install_update");
    } catch (reason) {
      setUpdateError(String(reason));
      setUpdateStatus("error");
    }
  }

  function changeUpdateOpen(open: boolean) {
    if (!open && (updateStatus === "checking" || updateStatus === "installing")) return;
    setUpdateOpen(open);
    if (!open) setAvailableVersion("");
  }

  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
        {/* The window buttons sit inside this bar on macOS, so it doubles as the title bar and drags the window. */}
        <header
          data-tauri-drag-region
          className="flex h-9 shrink-0 items-center gap-2 border-b bg-sidebar px-3 text-sidebar-foreground in-data-[titlebar=overlay]:pl-[86px]"
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className="shrink-0"
                  aria-label="Lite on GitHub"
                  onClick={() => void invoke("open_url", { url: "https://github.com/ultralytics/lite" })}
                />
              }
            >
              <LiteLogomark className="size-5" />
            </TooltipTrigger>
            <TooltipContent>View Lite on GitHub</TooltipContent>
          </Tooltip>
          <VersionBadge
            version={version}
            commit={commit}
            built={built}
            release={release}
            onCheck={() => void checkForUpdates()}
          />
          {selected ? (
            <>
              <Separator orientation="vertical" className="mx-1 h-4" />
              <ProviderIcon agent={selected.agent} provider={selected.provider} />
              <span className="min-w-0 truncate text-xs font-medium">{selected.name}</span>
              <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">{selected.cwd}</span>
              {remote ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        className="flex max-w-56 shrink-0 items-center gap-1.5 text-muted-foreground hover:text-foreground"
                        onClick={() => void invoke("open_url", { url: remote })}
                      />
                    }
                  >
                    <GitBranch className="size-3.5 shrink-0" />
                    <span className="truncate font-mono text-[11px]">{repoName(remote)}</span>
                  </TooltipTrigger>
                  <TooltipContent>Open {remote}</TooltipContent>
                </Tooltip>
              ) : null}
            </>
          ) : (
            <span className="text-sm font-semibold">Lite</span>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="relative"
                    onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                    aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                  />
                }
              >
                <Sun className="size-4 rotate-0 scale-100 transition-transform motion-reduce:transition-none dark:-rotate-90 dark:scale-0" />
                <Moon className="absolute size-4 rotate-90 scale-0 transition-transform motion-reduce:transition-none dark:rotate-0 dark:scale-100" />
              </TooltipTrigger>
              <TooltipContent>{theme === "dark" ? "Light mode" : "Dark mode"}</TooltipContent>
            </Tooltip>
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Options" />} />
                  }
                >
                  <MoreHorizontal />
                </TooltipTrigger>
                <TooltipContent>Options</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="w-48">
                {version ? (
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>
                      {commit ? `Lite ${version} · local ${commit}` : `Lite ${version}`}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                  </DropdownMenuGroup>
                ) : null}
                <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
                  <KeyRound />
                  API keys
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void checkForUpdates()}>
                  <RefreshCw />
                  Check for updates
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
          <ResizablePanel
            panelRef={sidebarPanel}
            defaultSize={SIDES.sidebar.size}
            minSize={RAIL}
            maxSize={SIDES.sidebar.max}
            onResize={(size) => rail("sidebar", size)}
          >
            <aside className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
              {shut.sidebar ? (
                <ScrollArea className="min-h-0 flex-1">
                  <div className="flex animate-in flex-col items-center gap-0.5 py-1.5 fade-in duration-200">
                    <ActionIconButton
                      variant="ghost"
                      size="icon-sm"
                      tooltip="Expand sessions"
                      tooltipSide="right"
                      aria-label="Expand sessions"
                      onClick={() => glide(sidebarPanel.current, share(sidebarPanel.current, SIDES.sidebar.size))}
                    >
                      <ChevronRight />
                    </ActionIconButton>
                    <ActionIconButton
                      variant="ghost"
                      size="icon-sm"
                      tooltip="New session"
                      tooltipSide="right"
                      aria-label="New session"
                      onClick={() => setNewSessionOpen(true)}
                    >
                      <Plus />
                    </ActionIconButton>
                    {sessions.map((session) => (
                      <Tooltip key={session.id}>
                        <TooltipTrigger
                          render={
                            <button
                              type="button"
                              aria-pressed={session.id === selectedId}
                              className={`rounded-lg p-1 ${session.id === selectedId ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60"}`}
                              onClick={() => openRef.current(session)}
                            />
                          }
                        >
                          <SessionBadge
                            session={session}
                            active={session.id === selectedId}
                            starting={startingIds.has(session.id)}
                            working={working.has(session.id)}
                          />
                        </TooltipTrigger>
                        <TooltipContent side="right">{session.name}</TooltipContent>
                      </Tooltip>
                    ))}
                  </div>
                </ScrollArea>
              ) : (
                <>
                  {/* The search field names the panel and searches it, so the list keeps the row a title would cost. */}
                  <div className="flex h-9 shrink-0 items-center gap-0.5 pr-1.5 pl-2">
                    <span className="relative min-w-0 flex-1">
                      <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={query}
                        className="h-7 pl-7 text-xs md:text-xs"
                        placeholder="Search sessions"
                        aria-label="Search sessions"
                        onChange={(event) => setQuery(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") setQuery("");
                        }}
                      />
                    </span>
                    <ActionIconButton
                      variant="ghost"
                      size="icon-sm"
                      tooltip="New session"
                      aria-label="New session"
                      onClick={() => setNewSessionOpen(true)}
                    >
                      <Plus />
                    </ActionIconButton>
                    <ActionIconButton
                      variant="ghost"
                      size="icon-sm"
                      tooltip="Collapse sessions"
                      aria-label="Collapse sessions"
                      onClick={() => glide(sidebarPanel.current, RAIL)}
                    >
                      <ChevronLeft />
                    </ActionIconButton>
                  </div>
                  <ScrollArea className="min-h-0 flex-1">
                    <div className="space-y-0.5 px-2 pb-2">
                      {query && !visible.length ? (
                        <p className="px-2 py-1.5 text-xs text-muted-foreground">No session matches “{query}”.</p>
                      ) : null}
                      {visible.map((session) => (
                        <SessionRow
                          key={session.id}
                          session={session}
                          active={session.id === selectedId}
                          starting={startingIds.has(session.id)}
                          working={working.has(session.id)}
                          onSelect={() => openRef.current(session)}
                          onRename={(name) =>
                            setSessions((current) =>
                              current.map((item) => (item.id === session.id ? { ...item, name, renamed: true } : item)),
                            )
                          }
                          onRestart={() => void restartSession(session)}
                          onClose={() => setClosing(session)}
                        />
                      ))}
                    </div>
                  </ScrollArea>
                </>
              )}
            </aside>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize="55%" minSize="38%">
            <section className="flex h-full min-w-0 flex-col">
              {selected ? (
                <div className="min-h-0 flex-1">
                  {selected.running ? (
                    <Suspense fallback={<div className="h-full bg-background" />}>
                      <TerminalView
                        sessionId={selected.id}
                        theme={theme}
                        onPrompt={(text) =>
                          setSessions((current) =>
                            current.map((item) =>
                              item.id === selected.id && !item.renamed && item.name === folderName(item.cwd)
                                ? { ...item, name: subject(text) }
                                : item,
                            ),
                          )
                        }
                      />
                    </Suspense>
                  ) : startingIds.has(selected.id) ? (
                    <div className="flex h-full flex-col items-center justify-center gap-3">
                      <Spinner className="size-5 text-muted-foreground" />
                      <p className="text-xs text-muted-foreground">Starting {sessionLabel(selected)}…</p>
                    </div>
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-3">
                      <p className="text-xs text-muted-foreground">This session is not running.</p>
                      <Button variant="outline" size="sm" onClick={() => void launch(selected, true)}>
                        <Play />
                        Resume session
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                  <div className="flex size-12 items-center justify-center rounded-2xl border bg-muted">
                    <SquareTerminal className="size-5" />
                  </div>
                  <div>
                    <h1 className="text-sm font-medium">Start a session</h1>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Pick a project folder, then choose the agent that should work in it.
                    </p>
                  </div>
                  <Button onClick={() => setNewSessionOpen(true)}>
                    <Plus />
                    New session
                  </Button>
                </div>
              )}
              {error ? (
                <div className="flex shrink-0 items-start gap-2 border-t bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  <span className="min-w-0 flex-1">{error}</span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="text-destructive hover:bg-destructive/10"
                    onClick={() => setError("")}
                    aria-label="Dismiss message"
                  >
                    <X />
                  </Button>
                </div>
              ) : null}
            </section>
          </ResizablePanel>
          {selected ? (
            <>
              <ResizableHandle withHandle />
              <ResizablePanel
                panelRef={inspectorPanel}
                defaultSize={SIDES.inspector.size}
                minSize={RAIL}
                maxSize={SIDES.inspector.max}
                onResize={(size) => rail("inspector", size)}
              >
                <aside className="h-full border-l">
                  <PanelBoundary key={selected.id}>
                    <Inspector
                      session={selected}
                      collapsed={shut.inspector}
                      onExpand={() =>
                        glide(inspectorPanel.current, share(inspectorPanel.current, SIDES.inspector.size))
                      }
                      onCollapse={() => glide(inspectorPanel.current, RAIL)}
                    />
                  </PanelBoundary>
                </aside>
              </ResizablePanel>
            </>
          ) : null}
        </ResizablePanelGroup>
        <Dialog open={updateOpen} onOpenChange={changeUpdateOpen}>
          <DialogContent showCloseButton={updateStatus !== "checking" && updateStatus !== "installing"}>
            <DialogHeader>
              <div className="flex items-center gap-2">
                <DialogTitle>Lite updates</DialogTitle>
                <VersionBadge
                  version={version}
                  commit={commit}
                  built={built}
                  release={release}
                  onCheck={() => void checkForUpdates()}
                />
              </div>
              <DialogDescription aria-live="polite">
                {updateStatus === "checking"
                  ? commit
                    ? "Comparing this build with the tree it was built from…"
                    : "Checking GitHub for the latest release…"
                  : null}
                {updateStatus === "available"
                  ? `Lite ${availableVersion} is ready. Updating stops running sessions; their tabs resume after restart.`
                  : null}
                {updateStatus === "rebuild"
                  ? `This build is ${commit} and the tree is now ${availableVersion}. Run bun run local to rebuild.`
                  : null}
                {updateStatus === "current"
                  ? commit
                    ? "This build matches the tree it was built from."
                    : "You have the latest version of Lite."
                  : null}
                {updateStatus === "installing" ? "Downloading and installing the update…" : null}
                {updateStatus === "error" ? `Update failed: ${updateError}` : null}
              </DialogDescription>
            </DialogHeader>
            {updateStatus === "checking" || updateStatus === "installing" ? (
              <DialogBody>
                <Spinner className="mx-auto size-5 text-muted-foreground" />
              </DialogBody>
            ) : null}
            {updateStatus === "available" ? (
              <DialogFooter>
                <Button variant="outline" onClick={() => changeUpdateOpen(false)}>
                  Not now
                </Button>
                <Button onClick={() => void installUpdate()}>Install and restart</Button>
              </DialogFooter>
            ) : null}
            {updateStatus === "current" || updateStatus === "rebuild" ? (
              <DialogFooter>
                <Button onClick={() => changeUpdateOpen(false)}>Done</Button>
              </DialogFooter>
            ) : null}
            {updateStatus === "error" ? (
              <DialogFooter>
                <Button onClick={() => void checkForUpdates()}>Try again</Button>
              </DialogFooter>
            ) : null}
          </DialogContent>
        </Dialog>
        <Dialog open={Boolean(closing)} onOpenChange={(open) => !open && setClosing(undefined)}>
          <DialogContent size="sm">
            <DialogHeader>
              <DialogTitle>Close {closing?.name}?</DialogTitle>
              <DialogDescription>
                {closing?.running
                  ? "This stops the running session and removes the tab. The provider keeps its own conversation history."
                  : "This removes the tab. The provider keeps its own conversation history."}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setClosing(undefined)}>
                Keep
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  if (closing) void closeSession(closing);
                  setClosing(undefined);
                }}
              >
                Close session
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <NewSessionDialog open={newSessionOpen} onOpenChange={setNewSessionOpen} onCreate={createSession} />
        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} onSignIn={signIn} />
      </div>
    </TooltipProvider>
  );
}

export default App;
