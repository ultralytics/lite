// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  ClipboardPaste,
  Copy,
  ExternalLink,
  Folder,
  GitBranch,
  Link,
  Moon,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Scissors,
  Search,
  Settings as SettingsIcon,
  SlidersHorizontal,
  SquareTerminal,
  Sun,
  TextSelect,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  Component,
  lazy,
  type ReactElement,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ProviderIcon, UltralyticsLogomark } from "@/brand-icons";
import { Badge } from "@/components/ui/badge";
import { ActionIconButton, Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import {
  type PanelImperativeHandle,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { Toaster, toast } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { clearInspectorCache, Inspector } from "@/inspector";
import { swapped, without } from "@/lib/utils";
import { NewSessionDialog } from "@/new-session-dialog";
import {
  appendOutput,
  clearOutput,
  holdSessionWrites,
  subscribeOutput,
  syncTerminalTheme,
  writeSession,
} from "@/output-store";
import { SettingsDialog } from "@/settings-dialog";
import { applyTheme, initialTheme, storedFontSize, type Theme, zoomedFontSize, zoomStep } from "@/theme";
import { type Agent, defaultSessionName, folderName, repoName, type Session, sessionLabel } from "@/types";
import "./App.css";

const STORAGE_KEY = "lite.sessions.v1";
const WORKING_KEY = "lite.working.v1";
const SESSION_VIEW_KEY = "lite.sessionView.v1";
type SessionGrouping = "none" | "repository" | "directory" | "state";
type SessionSort = "newest" | "oldest" | "name-asc" | "name-desc" | "manual";
const SESSION_GROUPINGS: { value: SessionGrouping; label: string }[] = [
  { value: "none", label: "None" },
  { value: "repository", label: "Repository" },
  { value: "directory", label: "Directory" },
  { value: "state", label: "State" },
];
const SESSION_SORTS: {
  value: string;
  label: string;
  ascValue?: SessionSort;
  descValue?: SessionSort;
  defaultDirection?: "asc" | "desc";
}[] = [
  { value: "created", label: "Created", ascValue: "oldest", descValue: "newest", defaultDirection: "desc" as const },
  { value: "name", label: "Name", ascValue: "name-asc", descValue: "name-desc", defaultDirection: "asc" as const },
  { value: "manual", label: "Manual" },
];
const SESSION_SORT_LABELS: Record<SessionSort, string> = {
  newest: "Newest",
  oldest: "Oldest",
  "name-asc": "Name A–Z",
  "name-desc": "Name Z–A",
  manual: "Manual",
};

function loadSessionView(): { grouping: SessionGrouping; sort: SessionSort } {
  try {
    const stored = JSON.parse(localStorage.getItem(SESSION_VIEW_KEY) ?? "{}") as {
      grouping?: SessionGrouping;
      sort?: SessionSort;
    };
    const grouping = SESSION_GROUPINGS.find(({ value }) => value === stored.grouping)?.value ?? "none";
    const sort = stored.sort && stored.sort in SESSION_SORT_LABELS ? stored.sort : "newest";
    return { grouping, sort };
  } catch {
    return { grouping: "none", sort: "newest" };
  }
}

function SessionViewOptions({
  view,
  onChange,
}: {
  view: { grouping: SessionGrouping; sort: SessionSort };
  onChange: (view: { grouping: SessionGrouping; sort: SessionSort }) => void;
}) {
  const label = `${SESSION_SORT_LABELS[view.sort]} · ${SESSION_GROUPINGS.find(({ value }) => value === view.grouping)?.label}`;
  const trigger = (
    <DropdownMenuTrigger
      render={
        <Button variant="ghost" size="icon-sm" aria-label={`Session view: ${label}`}>
          <SlidersHorizontal aria-hidden="true" />
        </Button>
      }
    />
  );
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger render={<span className="inline-flex">{trigger}</span>} />
        <TooltipContent>Session view: {label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Sort by</DropdownMenuLabel>
          {SESSION_SORTS.map((option) => {
            const direction =
              option.ascValue === view.sort ? "asc" : option.descValue === view.sort ? "desc" : undefined;
            const nextSort =
              direction === "asc"
                ? option.descValue
                : direction === "desc"
                  ? option.ascValue
                  : (option[option.defaultDirection === "asc" ? "ascValue" : "descValue"] ?? option.value);
            return (
              <DropdownMenuItem
                key={option.value}
                className={direction || view.sort === option.value ? "bg-accent" : undefined}
                onClick={() => onChange({ ...view, sort: nextSort as SessionSort })}
              >
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  {option.label}
                  {direction === "asc" ? <ArrowUp aria-hidden="true" className="ml-auto size-3.5" /> : null}
                  {direction === "desc" ? <ArrowDown aria-hidden="true" className="ml-auto size-3.5" /> : null}
                </span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Group by</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={view.grouping}
            onValueChange={(grouping) => onChange({ ...view, grouping: grouping as SessionGrouping })}
          >
            {SESSION_GROUPINGS.map(({ value, label }) => (
              <DropdownMenuRadioItem key={value} value={value}>
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
// The width each side collapses to: one icon button and the room around it.
const RAIL = 44;
// Where a side stops following the pointer. It has no room to be anything but its rail by here, so it
// becomes one and collapses the rest of the way itself, in one eased step.
const SHUT = 140;
// A side reopens to the share of the window it started with, in the pixels a glide is measured in.
function share(panel: PanelImperativeHandle | null, portion: string) {
  const size = panel?.getSize();
  if (!size?.asPercentage) return 0;
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
const ReleaseNotes = lazy(() => import("@/code-preview").then((module) => ({ default: module.MarkdownPreview })));
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

const NOTIFICATIONS_KEY = "lite.notifications";
const KEEP_AWAKE_KEY = "lite.keep-awake";
const SIDEBAR_FONT_KEY = "lite.sidebar.fontSize";
const INSPECTOR_FONT_KEY = "lite.inspector.fontSize";

type UpdateStatus = "checking" | "available" | "rebuild" | "current" | "installing" | "error";
type ReleaseInfo = { version: string; notes: string; available: boolean };

function friendlyReleaseNotes(notes: string) {
  return notes.replace(
    /^(\* .+?) by @([A-Za-z0-9-]+(?:\[bot\])?) in (https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+))$/gm,
    (_line, title: string, author: string, pull: string, number: string) => {
      const profile = author.endsWith("[bot]")
        ? `https://github.com/apps/${author.slice(0, -5)}`
        : `https://github.com/${author}`;
      return `${title} by [@${author}](${profile}) in [#${number}](${pull})`;
    },
  );
}

function zoomPanelStyle(fontSize: number) {
  const scale = fontSize / 13;
  return {
    width: `${100 / scale}%`,
    height: `${100 / scale}%`,
    transform: `scale(${scale})`,
    transformOrigin: "top left",
  };
}

type Editable = HTMLInputElement | HTMLTextAreaElement | HTMLElement;
type AppMenuContext = {
  collapseFiles: HTMLButtonElement | null;
  collapsePanel: HTMLButtonElement | null;
  collapseSessions: HTMLButtonElement | null;
  directory: HTMLButtonElement | null;
  deleteFile: HTMLButtonElement | null;
  editable: Editable | null;
  expandFiles: HTMLButtonElement | null;
  expandPanel: HTMLButtonElement | null;
  expandSessions: HTMLButtonElement | null;
  newSession: HTMLButtonElement | null;
  refresh: HTMLButtonElement | null;
  selectedText: string;
  sessionId: string;
  url: string;
  value: string;
  valueLabel: string;
  zoomIn: HTMLButtonElement | null;
  zoomOut: HTMLButtonElement | null;
  zoomReset: HTMLButtonElement | null;
};

const EMPTY_MENU_CONTEXT: AppMenuContext = {
  collapseFiles: null,
  collapsePanel: null,
  collapseSessions: null,
  directory: null,
  deleteFile: null,
  editable: null,
  expandFiles: null,
  expandPanel: null,
  expandSessions: null,
  newSession: null,
  refresh: null,
  selectedText: "",
  sessionId: "",
  url: "",
  value: "",
  valueLabel: "",
  zoomIn: null,
  zoomOut: null,
  zoomReset: null,
};

function inputSelection(element: HTMLInputElement | HTMLTextAreaElement): string {
  const start = element.selectionStart ?? 0;
  const end = element.selectionEnd ?? 0;
  return element.value.slice(start, end);
}

function menuContext(target: EventTarget | null): AppMenuContext {
  if (!(target instanceof Element)) return EMPTY_MENU_CONTEXT;
  const editable = target.closest<HTMLElement>("input, textarea, [contenteditable=true]");
  const link = target.closest<HTMLElement>("a[href], [data-context-url]");
  const value = target.closest<HTMLElement>("[data-context-value]");
  const directory = target.closest<HTMLButtonElement>("[data-context-directory]");
  const fileRow = target.closest<HTMLElement>("[data-context-file-row]");
  const session = target.closest<HTMLElement>("[data-context-session]");
  const surface = session ? null : target.closest<HTMLElement>("[data-context-surface]");
  const files = target.closest<HTMLElement>("[data-context-files]");
  // The terminal and the file viewer each zoom their own type, so the menu offers whichever owns the click.
  const zoom = target.closest<HTMLElement>("[data-context-zoom]");
  const selectedText =
    editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement
      ? inputSelection(editable)
      : (window.getSelection()?.toString() ?? "");
  return {
    collapseFiles: files?.querySelector<HTMLButtonElement>("[data-context-collapse-files]") ?? null,
    collapsePanel: surface?.querySelector<HTMLButtonElement>("[data-context-collapse-panel]") ?? null,
    collapseSessions: surface?.querySelector<HTMLButtonElement>("[data-context-collapse-sessions]") ?? null,
    directory,
    deleteFile: fileRow?.querySelector<HTMLButtonElement>("[data-context-delete-file]") ?? null,
    editable,
    expandFiles: files?.querySelector<HTMLButtonElement>("[data-context-expand-files]") ?? null,
    expandPanel: surface?.querySelector<HTMLButtonElement>("[data-context-expand-panel]") ?? null,
    expandSessions: surface?.querySelector<HTMLButtonElement>("[data-context-expand-sessions]") ?? null,
    newSession: surface?.querySelector<HTMLButtonElement>("[data-context-new-session]") ?? null,
    refresh: surface?.querySelector<HTMLButtonElement>("[data-context-refresh]") ?? null,
    selectedText,
    sessionId: session?.dataset.contextSession ?? "",
    url: link instanceof HTMLAnchorElement ? link.href : (link?.dataset.contextUrl ?? ""),
    value: value?.dataset.contextValue ?? "",
    valueLabel: value?.dataset.contextLabel ?? "Copy",
    zoomIn: zoom?.querySelector<HTMLButtonElement>("[data-context-zoom-in]") ?? null,
    zoomOut: zoom?.querySelector<HTMLButtonElement>("[data-context-zoom-out]") ?? null,
    zoomReset: zoom?.querySelector<HTMLButtonElement>("[data-context-zoom-reset]") ?? null,
  };
}

function hasMenuItems(context: AppMenuContext): boolean {
  return [
    context.collapseFiles || context.collapsePanel || context.collapseSessions,
    context.editable,
    context.directory || context.expandFiles || context.expandPanel || context.expandSessions,
    context.newSession || context.refresh,
    context.selectedText,
    context.sessionId,
    context.url || context.value,
    context.zoomIn,
  ].some(Boolean);
}

function writeClipboard(text: string) {
  void navigator.clipboard.writeText(text).catch(() => undefined);
}

function edit(context: AppMenuContext, command: "cut" | "paste" | "selectAll") {
  const element = context.editable;
  if (!element) return;
  element.focus();
  if (document.execCommand(command)) return;
  if (command !== "paste") return;
  void navigator.clipboard
    .readText()
    .then((text) => {
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        element.setRangeText(text, element.selectionStart ?? 0, element.selectionEnd ?? 0, "end");
        element.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertFromPaste" }));
      } else document.execCommand("insertText", false, text);
    })
    .catch(() => undefined);
}

function AppContextMenu({
  children,
  sessions,
  selectedId,
  startingIds,
  onSelectSession,
  onRenameSession,
  onRestartSession,
  onCloseSession,
  onRestartAll,
  onCloseAll,
}: {
  children: ReactElement;
  sessions: Session[];
  selectedId: string;
  startingIds: Set<string>;
  onSelectSession: (session: Session) => void;
  onRenameSession: (session: Session) => void;
  onRestartSession: (session: Session) => void;
  onCloseSession: (session: Session) => void;
  onRestartAll: () => void;
  onCloseAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState(EMPTY_MENU_CONTEXT);
  const shortcut = navigator.platform.includes("Mac") ? "⌘" : "Ctrl+";
  const readonly =
    context.editable instanceof HTMLInputElement || context.editable instanceof HTMLTextAreaElement
      ? context.editable.readOnly || context.editable.disabled
      : false;
  const session = sessions.find((item) => item.id === context.sessionId);
  const linkGroup = Boolean(context.url || context.value);
  const surfaceGroup = [
    context.collapseFiles || context.collapsePanel || context.collapseSessions,
    context.expandFiles || context.expandPanel || context.expandSessions,
    context.newSession || context.refresh,
  ].some(Boolean);
  const editGroup = Boolean(context.editable || context.selectedText);
  const sessionsGroup = Boolean(session || context.newSession);

  return (
    <ContextMenu
      open={open}
      onOpenChange={(next, details) => {
        if (!next) return setOpen(false);
        const nextContext = menuContext(details.event.target);
        setContext(nextContext);
        setOpen(hasMenuItems(nextContext));
      }}
    >
      <ContextMenuTrigger render={children} />
      <ContextMenuContent className="w-44">
        {session ? (
          <>
            {session.id !== selectedId || !session.running ? (
              <ContextMenuItem onClick={() => onSelectSession(session)}>
                <Play />
                {session.running ? "Open session" : "Resume session"}
              </ContextMenuItem>
            ) : null}
            <ContextMenuItem onClick={() => onRenameSession(session)}>
              <Pencil />
              Rename
            </ContextMenuItem>
            <ContextMenuItem onClick={() => writeClipboard(session.cwd)}>
              <Copy />
              Copy path
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem disabled={startingIds.has(session.id)} onClick={() => onRestartSession(session)}>
              <RotateCcw />
              Restart
            </ContextMenuItem>
            <ContextMenuItem
              variant="destructive"
              disabled={startingIds.has(session.id)}
              onClick={() => onCloseSession(session)}
            >
              <Trash2 />
              Close session
            </ContextMenuItem>
          </>
        ) : null}
        {context.zoomIn ? (
          <>
            {session ? <ContextMenuSeparator /> : null}
            <ContextMenuItem onClick={() => context.zoomIn?.click()}>
              <ZoomIn />
              Zoom in
              <ContextMenuShortcut>{shortcut}+</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onClick={() => context.zoomOut?.click()}>
              <ZoomOut />
              Zoom out
              <ContextMenuShortcut>{shortcut}-</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onClick={() => context.zoomReset?.click()}>
              <RotateCcw />
              Actual size
              <ContextMenuShortcut>{shortcut}0</ContextMenuShortcut>
            </ContextMenuItem>
            {!session && (linkGroup || surfaceGroup) ? <ContextMenuSeparator /> : null}
          </>
        ) : null}
        {context.url ? (
          <>
            <ContextMenuItem onClick={() => void invoke("open_url", { url: context.url })}>
              <ExternalLink />
              Open link
            </ContextMenuItem>
            <ContextMenuItem onClick={() => writeClipboard(context.url)}>
              <Link />
              Copy link
            </ContextMenuItem>
          </>
        ) : null}
        {context.directory ? (
          <ContextMenuItem onClick={() => context.directory?.click()}>
            <ChevronRight className={context.directory.dataset.contextExpanded === "true" ? "rotate-90" : undefined} />
            {context.directory.dataset.contextExpanded === "true" ? "Collapse folder" : "Expand folder"}
          </ContextMenuItem>
        ) : null}
        {context.value ? (
          <ContextMenuItem onClick={() => writeClipboard(context.value)}>
            <Copy />
            {context.valueLabel}
          </ContextMenuItem>
        ) : null}
        {context.deleteFile ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onClick={() => context.deleteFile?.click()}>
              <Trash2 />
              Delete File
            </ContextMenuItem>
          </>
        ) : null}
        {linkGroup && surfaceGroup ? <ContextMenuSeparator /> : null}
        {context.refresh ? (
          <ContextMenuItem onClick={() => context.refresh?.click()}>
            <RefreshCw />
            Refresh
          </ContextMenuItem>
        ) : null}
        {context.expandFiles ? (
          <ContextMenuItem disabled={context.expandFiles.disabled} onClick={() => context.expandFiles?.click()}>
            <ChevronsUpDown />
            Expand all
          </ContextMenuItem>
        ) : null}
        {context.collapseFiles ? (
          <ContextMenuItem disabled={context.collapseFiles.disabled} onClick={() => context.collapseFiles?.click()}>
            <ChevronsDownUp />
            Collapse all
          </ContextMenuItem>
        ) : null}
        {context.newSession ? (
          <ContextMenuItem onClick={() => context.newSession?.click()}>
            <Plus />
            New session
          </ContextMenuItem>
        ) : null}
        {context.expandSessions ? (
          <ContextMenuItem onClick={() => context.expandSessions?.click()}>
            <ChevronRight />
            Expand sessions
          </ContextMenuItem>
        ) : null}
        {context.collapseSessions ? (
          <ContextMenuItem onClick={() => context.collapseSessions?.click()}>
            <ChevronLeft />
            Collapse sessions
          </ContextMenuItem>
        ) : null}
        {context.expandPanel ? (
          <ContextMenuItem onClick={() => context.expandPanel?.click()}>
            <ChevronLeft />
            Expand panel
          </ContextMenuItem>
        ) : null}
        {context.collapsePanel ? (
          <ContextMenuItem onClick={() => context.collapsePanel?.click()}>
            <ChevronRight />
            Collapse panel
          </ContextMenuItem>
        ) : null}
        {sessionsGroup && sessions.length ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem disabled={startingIds.size > 0} onClick={onRestartAll}>
              <RotateCcw />
              Restart all
            </ContextMenuItem>
            <ContextMenuItem variant="destructive" disabled={startingIds.size > 0} onClick={onCloseAll}>
              <Trash2 />
              Close all sessions
            </ContextMenuItem>
          </>
        ) : null}
        {(linkGroup || surfaceGroup || sessionsGroup || context.zoomIn) && editGroup ? <ContextMenuSeparator /> : null}
        {context.editable ? (
          <>
            <ContextMenuItem disabled={!context.selectedText || readonly} onClick={() => edit(context, "cut")}>
              <Scissors />
              Cut
              <ContextMenuShortcut>{shortcut}X</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem disabled={!context.selectedText} onClick={() => writeClipboard(context.selectedText)}>
              <Copy />
              Copy
              <ContextMenuShortcut>{shortcut}C</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem disabled={readonly} onClick={() => edit(context, "paste")}>
              <ClipboardPaste />
              Paste
              <ContextMenuShortcut>{shortcut}V</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => edit(context, "selectAll")}>
              <TextSelect />
              Select all
              <ContextMenuShortcut>{shortcut}A</ContextMenuShortcut>
            </ContextMenuItem>
          </>
        ) : context.selectedText ? (
          <ContextMenuItem onClick={() => writeClipboard(context.selectedText)}>
            <Copy />
            Copy
            <ContextMenuShortcut>{shortcut}C</ContextMenuShortcut>
          </ContextMenuItem>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}

// How long a session has to stay quiet before it counts as connected but idle rather than working.
// Long enough that the gaps between an agent's own writes do not flicker the dot.
const QUIET_MS = 1200;

// Four states the sidebar dot tells apart: the terminal is gone, it is up and quiet, it is producing
// output, or it needs the user. Color carries the state when motion is suppressed, and animation only
// reinforces it.
const SESSION_STATUS = {
  disconnected: { dot: "bg-muted-foreground/40", label: "Disconnected" },
  idle: { dot: "bg-success", label: "Connected, idle" },
  working: { dot: "bg-sky-500 animate-pulse motion-reduce:animate-none", label: "Connected, working" },
  attention: {
    dot: "bg-amber-500 animate-attention motion-reduce:animate-none",
    label: "Connected, ready",
  },
} as const;
const SESSION_STATE_LABELS = {
  attention: "Ready",
  working: "Working",
  idle: "Idle",
  disconnected: "Disconnected",
} as const;

function sessionStatus(session: Session, attention: boolean, working: boolean) {
  return SESSION_STATUS[!session.running ? "disconnected" : attention ? "attention" : working ? "working" : "idle"];
}

interface SessionGroup {
  name: string;
  key: string;
  title: string;
  sessions: Session[];
}

function sessionGroupKey(session: Session, grouping: SessionGrouping, attention: Set<string>, working: Set<string>) {
  if (grouping === "repository") return session.repo ?? session.cwd;
  if (grouping === "directory") return session.cwd;
  if (grouping === "state") {
    if (!session.running) return "disconnected";
    if (attention.has(session.id)) return "attention";
    return working.has(session.id) ? "working" : "idle";
  }
  return "all";
}

// Grouping is presentation only. First appearance preserves manual session order for paths, while
// state follows the same stable urgency order as the status badges.
function groupSessions(
  sessions: Session[],
  grouping: SessionGrouping,
  attention: Set<string>,
  working: Set<string>,
): SessionGroup[] {
  if (grouping === "none") return [{ name: "", key: "none:all", title: "", sessions }];
  const groups = new Map<string, SessionGroup>();
  for (const session of sessions) {
    const value = sessionGroupKey(session, grouping, attention, working);
    const status = grouping === "state" ? SESSION_STATUS[value as keyof typeof SESSION_STATUS] : undefined;
    const group = groups.get(value) ?? {
      name:
        grouping === "state"
          ? SESSION_STATE_LABELS[value as keyof typeof SESSION_STATE_LABELS]
          : folderName(value) || value,
      key: `${grouping}:${value}`,
      title: status?.label ?? value,
      sessions: [],
    };
    group.sessions.push(session);
    groups.set(value, group);
  }
  if (grouping === "state")
    return ["attention", "working", "idle", "disconnected"].flatMap((state) => groups.get(state) ?? []);
  return [...groups.values()];
}

function sortSessions(sessions: Session[], sort: SessionSort) {
  if (sort === "manual") return sessions;
  return [...sessions].sort((a, b) => {
    if (sort === "name-asc" || sort === "name-desc") {
      const order = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      return sort === "name-asc" ? order : -order;
    }
    const order = (b.createdAt ?? 0) - (a.createdAt ?? 0);
    return sort === "newest" ? order : -order;
  });
}

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
  className,
}: {
  version: string;
  commit: string | undefined;
  built: string;
  release: keyof typeof BADGE_VARIANT;
  onCheck: () => void;
  className?: string;
}) {
  if (!commit && !version) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge
            className={className}
            variant={commit ? "error" : BADGE_VARIANT[release]}
            render={<button type="button" onClick={onCheck} />}
          >
            {!commit && release === "checking" ? <Spinner aria-hidden="true" /> : null}
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
    const loadedAt = Date.now();
    // A session stored before Lite read window titles kept no record of who named it, so a name it did
    // not get from its folder is treated as the user's rather than replaced by the first title to arrive.
    return stored
      .filter((session) => session.rootId)
      .map((session, index) => ({
        ...session,
        createdAt: session.createdAt ?? loadedAt - index,
        running: false,
        renamed: session.renamed ?? session.name !== defaultSessionName(session.cwd),
      }));
  } catch {
    return [];
  }
}

function loadWorking(): Set<string> {
  try {
    const stored = JSON.parse(localStorage.getItem(WORKING_KEY) ?? "[]");
    return new Set(Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
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
  agent = session.agent,
  active,
  attention,
  starting,
  working,
}: {
  session: Session;
  agent?: Agent;
  active: boolean;
  attention: boolean;
  starting: boolean;
  working: boolean;
}) {
  const status = sessionStatus(session, attention, working);
  const ring = active ? "ring-sidebar-accent" : "ring-sidebar";
  return (
    <span className="relative flex size-7 shrink-0 items-center justify-center rounded-md border bg-background">
      <ProviderIcon agent={agent} provider={session.provider} />
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

function SessionSwitcher({
  open,
  sessions,
  selectedId,
  attention,
  working,
  startingIds,
  shellAgents,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  sessions: Session[];
  selectedId: string;
  attention: string[];
  working: Set<string>;
  startingIds: Set<string>;
  shellAgents: Map<string, Agent>;
  onOpenChange: (open: boolean) => void;
  onSelect: (session: Session) => void;
}) {
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState(selectedId);
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return sessions;
    return sessions.filter((session) => {
      const status = sessionStatus(session, attention.includes(session.id), working.has(session.id)).label;
      return [session.name, session.cwd, session.repo, sessionLabel(session), status].some((value) =>
        value?.toLowerCase().includes(needle),
      );
    });
  }, [attention, query, sessions, working]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveId(selectedId);
  }, [open, selectedId]);

  useEffect(() => {
    if (open && !matches.some((session) => session.id === activeId)) setActiveId(matches[0]?.id ?? "");
  }, [activeId, matches, open]);

  function move(direction: -1 | 1) {
    if (!matches.length) return;
    const index = matches.findIndex((session) => session.id === activeId);
    const next =
      index < 0 ? (direction > 0 ? 0 : matches.length - 1) : (index + direction + matches.length) % matches.length;
    const id = matches[next].id;
    setActiveId(id);
    requestAnimationFrame(() => document.getElementById(`switch-session-${id}`)?.scrollIntoView({ block: "nearest" }));
  }

  function select(session: Session) {
    onOpenChange(false);
    onSelect(session);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-2 p-2 sm:max-w-xl" showCloseButton={false}>
        <DialogHeader className="sr-only">
          <DialogTitle>Switch session</DialogTitle>
          <DialogDescription>Search open sessions by name, folder, agent, repository, or status.</DialogDescription>
        </DialogHeader>
        <InputGroup>
          <InputGroupAddon>
            <Search aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            autoFocus
            value={query}
            placeholder="Switch session…"
            aria-label="Switch session"
            aria-keyshortcuts={navigator.platform.includes("Mac") ? "Meta+P" : "Control+Shift+P"}
            role="combobox"
            aria-expanded="true"
            aria-controls="session-switcher-list"
            aria-autocomplete="list"
            aria-activedescendant={activeId ? `switch-session-${activeId}` : undefined}
            name="session-switcher"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                move(event.key === "ArrowDown" ? 1 : -1);
              } else if (event.key === "Enter") {
                const session = matches.find((item) => item.id === activeId) ?? matches[0];
                if (session) select(session);
              }
            }}
          />
        </InputGroup>
        <DialogBody className="max-h-[min(28rem,60dvh)] overscroll-contain">
          <div id="session-switcher-list" role="listbox" className="space-y-0.5">
            {matches.map((session) => {
              const needsAttention = attention.includes(session.id);
              return (
                <Item
                  key={session.id}
                  id={`switch-session-${session.id}`}
                  size="xs"
                  className={`flex-nowrap text-left ${session.id === activeId ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"}`}
                  render={<button type="button" role="option" aria-selected={session.id === activeId} />}
                  onPointerMove={() => setActiveId(session.id)}
                  onClick={() => select(session)}
                >
                  <ItemMedia>
                    <SessionBadge
                      session={session}
                      agent={shellAgents.get(session.id)}
                      active={session.id === selectedId}
                      attention={needsAttention}
                      starting={startingIds.has(session.id)}
                      working={working.has(session.id)}
                    />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle className="w-full text-xs">{session.name}</ItemTitle>
                    <ItemDescription className="truncate font-mono text-[10px]">
                      {shortPath(session.cwd)} · {sessionLabel(session)}
                    </ItemDescription>
                  </ItemContent>
                </Item>
              );
            })}
            {!matches.length ? (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">No sessions found</p>
            ) : null}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

// The provider's own mark, at the size a page can be about rather than the size a row can carry.
function SessionMark({ session }: { session: Session }) {
  return (
    <EmptyMedia variant="icon" className="size-16 rounded-2xl">
      <ProviderIcon agent={session.agent} provider={session.provider} className="size-8" />
    </EmptyMedia>
  );
}

function SessionActionButtons({
  name,
  disabled = false,
  onRestart,
  onClose,
}: {
  name: string;
  disabled?: boolean;
  onRestart: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <ActionIconButton
        size="icon-sm"
        tooltip="Restart"
        aria-label={`Restart ${name}`}
        disabled={disabled}
        onClick={onRestart}
      >
        <RotateCcw />
      </ActionIconButton>
      <ActionIconButton
        size="icon-sm"
        className="hover:text-destructive"
        tooltip="Close session"
        aria-label={`Close ${name}`}
        disabled={disabled}
        onClick={onClose}
      >
        <Trash2 />
      </ActionIconButton>
    </>
  );
}

function SessionRow({
  session,
  agent,
  active,
  attention,
  starting,
  working,
  renaming,
  reorderable,
  groupBounded,
  onSelect,
  onRename,
  onRenamingChange,
  onReorder,
  onMove,
  onRestart,
  onClose,
}: {
  session: Session;
  agent?: Agent;
  active: boolean;
  attention: boolean;
  starting: boolean;
  working: boolean;
  renaming: boolean;
  reorderable: boolean;
  groupBounded: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onRenamingChange: (renaming: boolean) => void;
  onReorder: (targetId: string, after: boolean) => void;
  onMove: (direction: -1 | 1) => void;
  onRestart: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(session.name);
  const drag = useRef<{ id: number; x: number; y: number; row: HTMLElement } | undefined>(undefined);
  const drop = useRef<{ row: HTMLElement; after: boolean } | undefined>(undefined);
  const shifted = useRef<HTMLElement[]>([]);
  const dragging = useRef(false);

  function saveName() {
    const next = name.trim();
    if (next) onRename(next);
    else setName(session.name);
    onRenamingChange(false);
  }

  function clearDrop() {
    if (drop.current) delete drop.current.row.dataset.drop;
    for (const row of shifted.current) {
      row.style.removeProperty("transform");
      delete row.dataset.shifted;
    }
    drop.current = undefined;
    shifted.current = [];
  }

  function clearDrag(row: HTMLElement) {
    delete document.documentElement.dataset.sessionDragging;
    for (const property of [
      "background-color",
      "box-shadow",
      "opacity",
      "pointer-events",
      "transform",
      "will-change",
      "z-index",
    ])
      row.style.removeProperty(property);
    clearDrop();
  }

  return (
    <Item
      data-context-session={session.id}
      size="xs"
      onClick={onSelect}
      onClickCapture={(event) => {
        if (!dragging.current) return;
        dragging.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
      onPointerDown={(event) => {
        if (
          !reorderable ||
          event.pointerType === "touch" ||
          event.button !== 0 ||
          renaming ||
          (event.target as Element).closest("button,input,[data-slot=item-actions]")
        )
          return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, row: event.currentTarget };
      }}
      onPointerMove={(event) => {
        const pointer = drag.current;
        if (!pointer || pointer.id !== event.pointerId) return;
        if (!dragging.current) {
          if (Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) < 6) return;
          dragging.current = true;
          document.documentElement.dataset.sessionDragging = "";
          Object.assign(pointer.row.style, {
            backgroundColor: "var(--sidebar)",
            boxShadow: "0 6px 18px rgb(0 0 0 / 0.18)",
            opacity: "0.96",
            pointerEvents: "none",
            willChange: "transform",
            zIndex: "20",
          });
        }
        event.preventDefault();
        const list = pointer.row.closest("[data-session-list]");
        const rows = [
          ...((groupBounded ? pointer.row.parentElement : list)?.querySelectorAll<HTMLElement>(
            "[data-context-session]",
          ) ?? []),
        ];
        const before = rows.find(
          (row) => row !== pointer.row && event.clientY < row.getBoundingClientRect().top + row.offsetHeight / 2,
        );
        const last = rows[rows.length - 1];
        let row = before ?? (last === pointer.row ? rows[rows.length - 2] : last);
        let after = !before;
        pointer.row.style.transform = `translate3d(0, ${event.clientY - pointer.y}px, 0)`;
        if (!row) return clearDrop();
        if (row.parentElement !== pointer.row.parentElement) {
          const targetRows = [...(row.parentElement?.querySelectorAll<HTMLElement>("[data-context-session]") ?? [])];
          const targetRect = row.parentElement?.getBoundingClientRect();
          after = Boolean(targetRect && event.clientY >= targetRect.top + targetRect.height / 2);
          row = targetRows[after ? targetRows.length - 1 : 0];
        }
        if (drop.current?.row === row && drop.current?.after === after) return;
        const sourceIndex = rows.indexOf(pointer.row);
        const targetIndex = rows.indexOf(row);
        const start = sourceIndex < targetIndex ? sourceIndex + 1 : targetIndex + Number(after);
        const end = sourceIndex < targetIndex ? targetIndex + Number(after) : sourceIndex;
        const shifts: [HTMLElement, number][] = [];
        // Group headers do not move during a drag, so cross-group drops use the insertion marker
        // without pretending the rows can close a gap that includes a header.
        if (pointer.row.parentElement === row.parentElement) {
          for (let index = start; index < end; index++) {
            const shiftedRow = rows[index];
            const neighbor = rows[index + (sourceIndex < targetIndex ? -1 : 1)];
            shifts.push([shiftedRow, neighbor.offsetTop - shiftedRow.offsetTop]);
          }
        }
        clearDrop();
        row.dataset.drop = after ? "after" : "before";
        drop.current = { row, after };
        for (const [shiftedRow, distance] of shifts) {
          shiftedRow.dataset.shifted = "";
          shiftedRow.style.transform = `translate3d(0, ${distance}px, 0)`;
          shifted.current.push(shiftedRow);
        }
      }}
      onPointerUp={(event) => {
        const pointer = drag.current;
        if (!pointer || pointer.id !== event.pointerId) return;
        pointer.row.releasePointerCapture(pointer.id);
        drag.current = undefined;
        const targetId = drop.current?.row.dataset.contextSession;
        const after = drop.current?.after;
        clearDrag(pointer.row);
        if (dragging.current && targetId && after !== undefined) onReorder(targetId, after);
        window.setTimeout(() => {
          dragging.current = false;
        });
      }}
      onPointerCancel={() => {
        if (drag.current) clearDrag(drag.current.row);
        drag.current = undefined;
        dragging.current = false;
      }}
      // Never wrapped: Item wraps by default, and a row narrow enough to push the buttons onto a second
      // line takes the tooltip's anchor out from under the pointer that opened it.
      className={`relative cursor-pointer flex-nowrap transition-[color,background-color,opacity] data-[shifted]:transition-transform data-[shifted]:duration-150 data-[shifted]:ease-out motion-reduce:data-[shifted]:transition-none after:pointer-events-none after:absolute after:inset-x-1 after:z-10 after:hidden after:h-0.5 after:rounded-full after:bg-primary data-[drop=before]:after:-top-0.5 data-[drop=before]:after:block data-[drop=after]:after:-bottom-0.5 data-[drop=after]:after:block active:opacity-70 ${reorderable ? "select-none active:cursor-grabbing" : ""} ${active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/60"}`}
    >
      <ItemMedia>
        <SessionBadge
          session={session}
          agent={agent}
          active={active}
          attention={attention}
          starting={starting}
          working={working}
        />
      </ItemMedia>
      {renaming ? (
        <Input
          autoFocus
          value={name}
          className="min-w-0 flex-1"
          aria-label="Session name"
          onChange={(event) => setName(event.target.value)}
          onBlur={saveName}
          onKeyDown={(event) => {
            if (event.key === "Enter") saveName();
            if (event.key === "Escape") {
              setName(session.name);
              onRenamingChange(false);
            }
          }}
        />
      ) : (
        <div className="min-w-0 flex-1 text-left">
          <div className="group/title flex w-fit max-w-full items-center gap-1 text-xs font-medium">
            <span className="truncate">{session.name}</span>
            <ActionIconButton
              size="icon-xs"
              className="size-4 rounded-sm opacity-0 transition-opacity group-hover/title:opacity-100 focus-visible:opacity-100"
              tooltip="Rename"
              aria-label={`Rename ${session.name}`}
              aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
              onClick={(event) => {
                event.stopPropagation();
                onRenamingChange(true);
              }}
              onKeyDown={(event) => {
                if (!reorderable || !event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
                event.preventDefault();
                onMove(event.key === "ArrowUp" ? -1 : 1);
              }}
            >
              <Pencil />
            </ActionIconButton>
          </div>
          <div
            className="mt-0.5 block w-fit max-w-full truncate font-mono text-[10px] text-muted-foreground"
            title={session.cwd}
          >
            {shortPath(session.cwd)}
          </div>
        </div>
      )}
      {/* Hidden rather than transparent, so the text gets the whole row until the actions appear. */}
      <ItemActions
        className="hidden shrink-0 gap-0.5 group-hover/item:flex group-focus-within/item:flex"
        onClick={(event) => event.stopPropagation()}
      >
        <SessionActionButtons name={session.name} disabled={starting} onRestart={onRestart} onClose={onClose} />
      </ItemActions>
    </Item>
  );
}

// Kimi has no flag for starting a session: launching without an id joins the one the directory already
// has, and only its own /new command makes another. So a restart asks for it the way a person would,
// once the interface has drawn itself and can take the command.
function startKimiConversation(sessionId: string) {
  const decoder = new TextDecoder();
  let seen = "";
  let sent = false;
  // Subscribing replays everything the session has already said, so the greeting can arrive inside the
  // subscribe call itself — before it has returned the way to undo it, and before there is a wait to
  // call off. Both are named here so that asking early is a thing this can do rather than a crash.
  let unsubscribe: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const send = () => {
    if (sent) return;
    sent = true;
    unsubscribe?.();
    clearTimeout(timer);
    writeSession(sessionId, "/new\r");
  };
  unsubscribe = subscribeOutput(sessionId, (data) => {
    seen += decoder.decode(data, { stream: true });
    if (seen.includes("Welcome to Kimi")) send();
  });
  // Already greeted: the listener is undone now, since there was nothing to undo when it ran, and no
  // wait is started for a greeting that has been and gone.
  if (sent) unsubscribe();
  // Its greeting may change; waiting forever for the words would be worse than asking a little late.
  else timer = setTimeout(send, 15_000);
}

// A session opened to run one command is sent it once the program in it has finished arriving. A shell
// drains whatever was typed while it was still setting itself up — a prompt framework rebuilding its
// line editor throws the queue away — so the command waits for output to start and then to stop, rather
// than for the first byte, which is the tty settling and not the prompt. A shell that prints nothing at
// all is still sent the command rather than left holding it.
const SETTLE_MS = 300;
const GIVE_UP_MS = 5000;

function runOnStart(sessionId: string, command: string) {
  let sent = false;
  let settle = 0;
  const send = () => {
    if (sent) return;
    sent = true;
    window.clearTimeout(settle);
    window.clearTimeout(patience);
    unsubscribe();
    // Submit exactly as the terminal does: the text and Enter are separate input events. Interactive
    // agents may treat one combined write as pasted text and leave it sitting in the composer.
    writeSession(sessionId, command);
    writeSession(sessionId, "\r");
  };
  // This waits rather than sends, which is also what keeps it safe: subscribing replays what the
  // session has already said, so a listener that sent from here would be sending before the two lines
  // below had run and before either of the things send() reaches for existed.
  const unsubscribe = subscribeOutput(sessionId, () => {
    window.clearTimeout(settle);
    settle = window.setTimeout(send, SETTLE_MS);
  });
  const patience = window.setTimeout(send, GIVE_UP_MS);
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
function subject(text: string) {
  const words = text
    .replace(/^[\p{S}\p{P}]\s+/u, "")
    .replace(/\s+/g, " ")
    .trim();
  return words.length > 40 ? `${words.slice(0, 40).trimEnd()}…` : words;
}

function commandAgent(command: string): Agent | undefined {
  const executable = command
    .trim()
    .split(/\s+/, 1)[0]
    ?.split(/[\\/]/)
    .pop()
    ?.replace(/\.exe$/i, "")
    .toLowerCase();
  return executable === "claude" ||
    executable === "codex" ||
    executable === "gemini" ||
    executable === "kimi" ||
    executable === "qwen"
    ? executable
    : undefined;
}

function App() {
  const [sessions, setSessions] = useState<Session[]>(loadSessions);
  const [sessionView, setSessionView] = useState(loadSessionView);
  const [selectedId, setSelectedId] = useState(() => sessions[0]?.id ?? "");
  const [attention, setAttention] = useState<string[]>([]);
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notifications, setNotifications] = useState(() => localStorage.getItem(NOTIFICATIONS_KEY) !== "false");
  const [keepAwake, setKeepAwake] = useState(() => localStorage.getItem(KEEP_AWAKE_KEY) === "true");
  const [closingAll, setClosingAll] = useState(false);
  // Bulk close is running: the dialog stays up and sessions stay untouched until every stop and
  // cleanup has settled, so nothing can be reopened under its own cleanup.
  const [closingAllRunning, setClosingAllRunning] = useState(false);
  const closingAllRef = useRef(false);
  // The worktree session waiting on the close dialog's answer, with what its tree looked like when asked.
  const [closingWorktree, setClosingWorktree] = useState<{
    session: Session;
    branch: string;
    force: boolean;
    changes: number;
    changesTruncated: boolean;
    // The recorded removal target, which is what the dialog must name — session.cwd may have moved.
    folder: string;
    // The folder is already gone; the dialog then asks about the branch and record instead.
    gone: boolean;
    // The folder's git data could not be read; the dialog offers keep, and delete without force.
    damaged: boolean;
  }>();
  const [error, setError] = useState("");
  const [startingIds, setStartingIds] = useState<Set<string>>(new Set());
  // Sessions whose terminal has written something recently, which is what separates a connected
  // session that is working from one that is merely connected.
  const [working, setWorking] = useState(loadWorking);
  // Work that was live when the previous process disappeared is resumed once in this process.
  const interrupted = useRef(new Set(working));
  const [shellAgents, setShellAgents] = useState<Map<string, Agent>>(new Map());
  const [query, setQuery] = useState("");
  const [sessionSwitcherOpen, setSessionSwitcherOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState("");
  // Each side collapses to a rail of icons rather than to nothing, so the panel is still there to click
  // or drag back open. Dragging past the minimum is what collapses it; the handle never goes away.
  const [shut, setShut] = useState({ sidebar: false, inspector: false });
  const [sidebarFontSize, setSidebarFontSize] = useState(() => storedFontSize(SIDEBAR_FONT_KEY));
  const [inspectorFontSize, setInspectorFontSize] = useState(() => storedFontSize(INSPECTOR_FONT_KEY));
  const layout = useRef<HTMLDivElement>(null);
  const sidebarPanel = useRef<PanelImperativeHandle>(null);
  const inspectorPanel = useRef<PanelImperativeHandle>(null);
  // The browse URL of the selected folder's origin, empty when it has none or Lite cannot open it.
  const [remote, setRemote] = useState("");
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [version, setVersion] = useState("");
  // Undefined until asked: an empty string is a release, anything else is the commit it was built from.
  const [commit, setCommit] = useState<string>();
  const [built, setBuilt] = useState("");
  // The tree a local build came from. A release came from no tree anyone here can see, and says so by
  // leaving this empty.
  const [repo, setRepo] = useState("");
  // A rebuild is running, so the button that started it does not start a second one.
  const [rebuilding, setRebuilding] = useState(false);
  const [release, setRelease] = useState<"checking" | "current" | "behind" | "unknown">("checking");
  const [updateOpen, setUpdateOpen] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("checking");
  const [availableVersion, setAvailableVersion] = useState("");
  const [releaseNotes, setReleaseNotes] = useState("");
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);
  const [updateError, setUpdateError] = useState("");
  const updateDialog = useRef<HTMLDivElement>(null);
  const runs = useRef(new Map<string, string>());
  const recoveries = useRef(new Map<string, Promise<void>>());
  const recoveryFailures = useRef(new Set<string>());
  // Sessions whose worktree the user agreed to force-remove, mapped to whether the approval
  // covered real changes (true) or only ignored files and submodules (false); read at cleanup.
  const forceWorktree = useRef(new Map<string, boolean>());
  // Sessions whose worktree the user chose to keep; cleanup forgets Lite's record instead of removing.
  const keptWorktrees = useRef(new Set<string>());
  const recentSessions = useRef(sessions.map((session) => session.id));
  // Sessions with a close flow in flight: the dialog is singular, so from probe to answer only
  // one worktree session may be closing at all.
  const closingIds = useRef(new Set<string>());
  // Worktree cleanup runs one at a time app-wide: two removals in flight would contend over the
  // same repository's git locks and turn a valid close into a failed cleanup.
  const cleanupQueue = useRef<Promise<unknown>>(Promise.resolve());
  const sessionsRef = useRef(sessions);
  const attentionRef = useRef<string[]>([]);
  const workTimers = useRef(new Map<string, number>());
  const pendingCleanups = useRef(new Set<() => Promise<void>>());
  const resumed = useRef("");
  const themeRef = useRef<Theme>("dark");
  const visibleRef = useRef<Session[]>([]);
  const selectedRef = useRef<Session>(undefined);
  const notificationsRef = useRef(notifications);
  const closeRef = useRef<(session: Session) => void>(() => {});
  const openRef = useRef<(session: Session) => void>(() => {});
  const recoverRef = useRef<(session: Session) => Promise<void>>(() => Promise.resolve());
  const markAttention = useCallback((sessionId: string) => {
    const current = attentionRef.current;
    if (current[current.length - 1] === sessionId) return false;
    const next = current.filter((id) => id !== sessionId);
    next.push(sessionId);
    attentionRef.current = next;
    setAttention(next);
    return true;
  }, []);
  const clearAttention = useCallback((sessionId: string) => {
    const current = attentionRef.current;
    if (!current.includes(sessionId)) return;
    const next = current.filter((id) => id !== sessionId);
    attentionRef.current = next;
    setAttention(next);
  }, []);
  const selected = useMemo(() => sessions.find((session) => session.id === selectedId), [sessions, selectedId]);
  const selectedStarting = selected ? startingIds.has(selected.id) : false;
  const sessionShortcut = navigator.platform.includes("Mac") ? "⌘P" : "Ctrl+Shift+P";
  // A session is found by what names it: the subject it was given and the folder it works in.
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return sessions;
    return sessions.filter(
      (session) => session.name.toLowerCase().includes(needle) || session.cwd.toLowerCase().includes(needle),
    );
  }, [sessions, query]);
  const attentionIds = useMemo(() => new Set(attention), [attention]);
  const sortedVisible = useMemo(() => {
    return sortSessions(visible, sessionView.sort);
  }, [sessionView.sort, visible]);
  const visibleGroups = useMemo(
    () => groupSessions(sortedVisible, sessionView.grouping, attentionIds, working),
    [attentionIds, sessionView.grouping, sortedVisible, working],
  );
  const selectedGroupKey = selected
    ? `${sessionView.grouping}:${sessionGroupKey(selected, sessionView.grouping, attentionIds, working)}`
    : "";
  useEffect(() => {
    if (!selectedGroupKey) return;
    setCollapsedGroups((current) => {
      if (!current.has(selectedGroupKey)) return current;
      const next = new Set(current);
      next.delete(selectedGroupKey);
      return next;
    });
  }, [selectedGroupKey]);
  const displayed = visibleGroups.flatMap((group) =>
    query.trim() || !collapsedGroups.has(group.key) ? group.sessions : [],
  );
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  recentSessions.current = recentSessions.current.filter((id) => sessionsById.has(id));
  const recentIds = new Set(recentSessions.current);
  const switcherSessions = recentSessions.current.flatMap((id) => sessionsById.get(id) ?? []);
  for (const session of sessions) {
    if (!recentIds.has(session.id)) switcherSessions.push(session);
  }
  visibleRef.current = shut.sidebar ? sessions : displayed;
  sessionsRef.current = sessions;
  themeRef.current = theme;
  selectedRef.current = selected;
  notificationsRef.current = notifications;
  closeRef.current = closeSession;
  openRef.current = (session) => {
    recentSessions.current = [session.id, ...recentSessions.current.filter((id) => id !== session.id)];
    clearAttention(session.id);
    setSelectedId(session.id);
    if (session.running) {
      recoveryFailures.current.delete(session.id);
      void recoverRef.current(session).catch(() => {});
    } else if (!startingIds.has(session.id)) void resumeSession(session);
  };

  // A drag reports every frame, so a side changes state only when the answer changes: handing back the
  // same object leaves React with nothing to redraw while the divider moves.
  const rail = useCallback((side: keyof typeof SIDES, size: { inPixels: number }) => {
    layout.current?.style.setProperty(`--${side}-width`, `${size.inPixels}px`);
    const next = size.inPixels < SHUT;
    // A shut sidebar has nowhere to show a search field, so the filter closes with it rather than
    // leaving the rail and the number shortcuts counting two different lists.
    if (side === "sidebar" && next) setQuery("");
    setShut((current) => (current[side] === next ? current : { ...current, [side]: next }));
  }, []);

  // The inspector panel goes away with the last session and comes back at its default width, so what
  // the sides remember about it is reset with it rather than corrected by the first measurement.
  const hasSelection = Boolean(selected);
  // The workspace starts hidden behind the splash. A committed App is ready to replace it, while
  // restored sessions and the update check remain deliberately non-blocking.
  useEffect(() => {
    void invoke("startup_ready");
  }, []);

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
    syncTerminalTheme(theme);
  }, [theme]);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setTheme(preference.matches ? "dark" : "light");
    preference.addEventListener("change", sync);
    return () => preference.removeEventListener("change", sync);
  }, []);

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

  useEffect(() => {
    const window = getCurrentWindow();
    const closing = window.onCloseRequested(async (event) => {
      const cleanups = [...pendingCleanups.current];
      if (!cleanups.length) return;
      event.preventDefault();
      await Promise.all(cleanups.map((cleanup) => cleanup()));
      await window.destroy();
    });
    return () => void closing.then((unlisten) => unlisten());
  }, []);

  // Opening a session reads its current notifications. A later notification remains highlighted until
  // the user returns to that session.
  useEffect(() => {
    if (selectedId && document.hasFocus()) clearAttention(selectedId);
  }, [selectedId, clearAttention]);

  useEffect(() => {
    const readSelected = () => {
      const session = selectedRef.current;
      if (!session) return;
      clearAttention(session.id);
      if (session.running) void recoverRef.current(session).catch(() => {});
    };
    window.addEventListener("focus", readSelected);
    return () => window.removeEventListener("focus", readSelected);
  }, [clearAttention]);

  // The shortcuts a terminal app is expected to answer. The terminal keeps every key Lite does not claim.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || (!event.metaKey && !event.ctrlKey)) return;
      if (event.target instanceof Element && event.target.closest('[role="dialog"]')) return;
      const panel = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-zoom-panel]") : null;
      const step = zoomStep(event.key);
      if (panel && step !== undefined) {
        const sidebar = panel.dataset.zoomPanel === "sidebar";
        const key = sidebar ? SIDEBAR_FONT_KEY : INSPECTOR_FONT_KEY;
        const setFontSize = sidebar ? setSidebarFontSize : setInspectorFontSize;
        setFontSize((current) => zoomedFontSize(key, current, step));
        event.preventDefault();
        return;
      }
      const switchSession = event.key.toLowerCase() === "p" && (event.metaKey || (event.ctrlKey && event.shiftKey));
      if (switchSession) setSessionSwitcherOpen(true);
      else if (event.key === "n") setNewSessionOpen(true);
      else if (event.key === ",") setSettingsOpen(true);
      else if (event.key === "w" && selectedRef.current) closeRef.current(selectedRef.current);
      else if (event.shiftKey && event.key.toLowerCase() === "u") {
        const target = [...attentionRef.current]
          .reverse()
          .map((id) => sessionsRef.current.find((session) => session.id === id))
          .find((session) => session !== undefined);
        if (!target) return;
        openRef.current(target);
      } else if (event.key >= "1" && event.key <= "9") {
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

  // This is written while work changes rather than at shutdown, so a power loss still leaves the
  // next Lite process an exact list. An install freezes the last state before it stops the PTYs.
  useEffect(() => {
    if (updateStatus !== "installing") localStorage.setItem(WORKING_KEY, JSON.stringify([...working]));
  }, [updateStatus, working]);

  const hasActiveSessions = sessions.some((session) => session.running);
  useEffect(() => {
    let current = true;
    void invoke("set_keep_awake", { enabled: keepAwake && hasActiveSessions }).catch((reason) => {
      if (!current) return;
      localStorage.setItem(KEEP_AWAKE_KEY, "false");
      setKeepAwake(false);
      setError(String(reason));
    });
    return () => {
      current = false;
    };
  }, [hasActiveSessions, keepAwake]);

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
    void invoke<string | null>("local_repo")
      .then((value) => setRepo(value ?? ""))
      .catch(() => setRepo(""));
  }, []);

  // One owner for the release question, so the startup check and a manual one cannot contradict each
  // other: the ask that started last is the only one still allowed to answer, and a slow startup reply
  // can no longer land on top of a fresh manual result.
  const releaseAsk = useRef(0);
  const askRelease = useCallback(async () => {
    const ask = ++releaseAsk.current;
    setRelease("checking");
    try {
      const next = await invoke<ReleaseInfo | null>("check_update");
      if (ask === releaseAsk.current) setRelease(next?.available ? "behind" : "current");
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
        setWorking((current) => without(current, sessionId));
      }, QUIET_MS),
    );
  }, []);

  // A working session retitles itself several times a second, nearly always to what the tab already
  // says, so the list it would re-render is handed back untouched unless the subject really changed.
  // A sign-in tab says what it is for and is gone as soon as it is done. And not every title is a
  // subject: a program with nothing of its own to say names the window after itself or after the
  // folder it was started in, which the badge and the tab's own name already say, and taking those
  // would undo the subject a tab had already been given.
  const markTitle = useCallback((sessionId: string, title: string) => {
    setSessions((current) => {
      const session = current.find((item) => item.id === sessionId);
      if (!session || session.mode || session.renamed) return current;
      const name = subject(title);
      if (
        !name ||
        name === session.name ||
        name === sessionLabel(session) ||
        name === defaultSessionName(session.cwd)
      ) {
        return current;
      }
      return current.map((item) => (item.id === sessionId ? { ...item, name } : item));
    });
  }, []);

  // A shell is only running an agent for as long as that agent is running: the badge goes back to the
  // shell's own when the process ends, and when the session it ran in ends with it.
  const forgetShellAgent = useCallback((sessionId: string) => {
    setShellAgents((current) => {
      if (!current.has(sessionId)) return current;
      const next = new Map(current);
      next.delete(sessionId);
      return next;
    });
  }, []);

  const markDirectory = useCallback((sessionId: string, path: string) => {
    const session = sessionsRef.current.find((item) => item.id === sessionId);
    if (session?.agent !== "shell" || session.cwd === path) return;
    void invoke<{ id: string; path: string }>("follow_directory", { rootId: session.rootId, path })
      .then((grant) => {
        setSessions((current) =>
          current.map((item) => (item.id === sessionId ? { ...item, cwd: grant.path, rootId: grant.id } : item)),
        );
      })
      .catch((reason) => setError(String(reason)));
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlistenOutput: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;
    let unlistenAgent: (() => void) | undefined;
    let unlistenNotification: (() => void) | undefined;
    const openNotification = () =>
      invoke<string | null>("notification_session").then((sessionId) => {
        const session = sessionsRef.current.find((item) => item.id === sessionId);
        if (session) openRef.current(session);
      });
    void Promise.all([
      listen<{ sessionId: string; runId: string; data: number[] }>("pty-output", ({ payload }) => {
        if (runs.current.get(payload.sessionId) !== payload.runId) return;
        const { title, path, activity, notification } = appendOutput(payload.sessionId, payload.data);
        if (title) markTitle(payload.sessionId, title);
        if (path) markDirectory(payload.sessionId, path);
        if (
          notification &&
          (selectedRef.current?.id !== payload.sessionId || !document.hasFocus()) &&
          markAttention(payload.sessionId)
        ) {
          const session = sessionsRef.current.find((item) => item.id === payload.sessionId);
          if (notificationsRef.current && session)
            void invoke("send_notification", { title: session.name, sessionId: session.id }).catch(() => {});
        }
        if (activity !== false) markWorking(payload.sessionId);
      }),
      listen<{ sessionId: string; runId: string }>("pty-exit", ({ payload }) => {
        if (runs.current.get(payload.sessionId) !== payload.runId) return;
        runs.current.delete(payload.sessionId);
        forgetShellAgent(payload.sessionId);
        const timer = workTimers.current.get(payload.sessionId);
        if (timer) window.clearTimeout(timer);
        workTimers.current.delete(payload.sessionId);
        setWorking((current) => without(current, payload.sessionId));
        setSessions((current) =>
          current.map((session) => (session.id === payload.sessionId ? { ...session, running: false } : session)),
        );
      }),
      listen<{ sessionId: string; runId: string; agent: Agent | null }>("shell-agent", ({ payload }) => {
        if (runs.current.get(payload.sessionId) !== payload.runId) return;
        setShellAgents((current) => {
          if (payload.agent === current.get(payload.sessionId)) return current;
          const next = new Map(current);
          if (payload.agent) next.set(payload.sessionId, payload.agent);
          else next.delete(payload.sessionId);
          return next;
        });
      }),
      listen("notification-clicked", () => void openNotification()),
    ]).then(([output, exit, agent, notification]) => {
      if (disposed) {
        output();
        exit();
        agent();
        notification();
        return;
      }
      unlistenOutput = output;
      unlistenExit = exit;
      unlistenAgent = agent;
      unlistenNotification = notification;
      void openNotification();
    });
    const timers = workTimers.current;
    return () => {
      disposed = true;
      unlistenOutput?.();
      unlistenExit?.();
      unlistenAgent?.();
      unlistenNotification?.();
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
  }, [forgetShellAgent, markAttention, markDirectory, markWorking, markTitle]);

  const changeNotifications = useCallback(async (enabled: boolean) => {
    const stored = localStorage.getItem(NOTIFICATIONS_KEY);
    if (enabled && !(await invoke<boolean>("request_notification_permission")))
      throw new Error("Allow notifications for Lite in macOS System Settings.");
    if (localStorage.getItem(NOTIFICATIONS_KEY) !== stored) return;
    localStorage.setItem(NOTIFICATIONS_KEY, String(enabled));
    notificationsRef.current = enabled;
    setNotifications(enabled);
  }, []);

  useEffect(() => {
    if (localStorage.getItem(NOTIFICATIONS_KEY) !== null) return;
    void invoke<boolean>("notifications_supported")
      .then((supported) =>
        supported && localStorage.getItem(NOTIFICATIONS_KEY) === null ? changeNotifications(true) : undefined,
      )
      .catch(() => {
        localStorage.setItem(NOTIFICATIONS_KEY, "false");
        notificationsRef.current = false;
        setNotifications(false);
      });
  }, [changeNotifications]);

  const changeKeepAwake = useCallback((enabled: boolean) => {
    localStorage.setItem(KEEP_AWAKE_KEY, String(enabled));
    setKeepAwake(enabled);
  }, []);

  const launch = useCallback(async (session: Session, resume: boolean) => {
    if (runs.current.has(session.id)) return true;
    recoveryFailures.current.delete(session.id);
    const runId = crypto.randomUUID();
    runs.current.set(session.id, runId);
    setStartingIds((current) => new Set(current).add(session.id));
    setError("");
    try {
      if (session.worktree) {
        const folder = await invoke<{ id: string; path: string } | null>("restore_worktree", {
          rootId: session.rootId,
          ownedOnly: false,
        });
        if (folder) {
          setSessions((current) =>
            current.map((item) => (item.id === session.id ? { ...item, cwd: folder.path } : item)),
          );
        }
      }
      const providerSessionId = await invoke<string | null>("spawn_session", {
        sessionId: session.id,
        runId,
        rootId: session.rootId,
        cwd: session.cwd,
        providerSessionId: session.providerSessionId,
        agent: session.agent,
        provider: session.provider,
        mode: session.mode,
        theme: themeRef.current,
        resume,
        cols: 100,
        rows: 30,
      });
      if (runs.current.get(session.id) !== runId) return false;
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
      return true;
    } catch (reason) {
      if (runs.current.get(session.id) === runId) runs.current.delete(session.id);
      setSessions((current) => current.map((item) => (item.id === session.id ? { ...item, running: false } : item)));
      setError(String(reason));
      return false;
    } finally {
      setStartingIds((current) => without(current, session.id));
    }
  }, []);

  const resumeSession = useCallback(
    async (session: Session) => {
      // Taking the marker before launch makes this caller the sole owner of the continuation even
      // when another mount effect or click reaches the same in-flight process.
      const shouldContinue = session.agent !== "shell" && interrupted.current.delete(session.id);
      const launched = await launch(session, true);
      if (shouldContinue) {
        if (launched) runOnStart(session.id, "continue");
        else interrupted.current.add(session.id);
      }
      return launched;
    },
    [launch],
  );

  // Busy sessions belong back where they were without waiting for each tab to be visited. Idle tabs
  // keep their existing lazy resume behavior, and a shell never receives an agent prompt as a command.
  useEffect(() => {
    const pending = sessionsRef.current.filter(
      (session) => !session.mode && session.agent !== "shell" && interrupted.current.has(session.id),
    );
    if (pending.some((session) => session.id === selectedRef.current?.id))
      resumed.current = selectedRef.current?.id ?? "";
    for (const session of pending) void resumeSession(session);
  }, [resumeSession]);

  function recoverSession(session: Session): Promise<void> {
    const pending = recoveries.current.get(session.id);
    if (pending) return pending;
    if (recoveryFailures.current.has(session.id)) return Promise.resolve();
    if (
      !session.worktree ||
      startingIds.has(session.id) ||
      closingIds.current.has(session.id) ||
      closingAllRef.current
    ) {
      return Promise.resolve();
    }
    let stopped = false;
    let cleanup = () => Promise.resolve();
    const recovery = (async () => {
      try {
        const folder = await invoke<{ id: string; path: string } | null>("restore_worktree", {
          rootId: session.rootId,
          ownedOnly: true,
        });
        const live = sessionsRef.current.find((item) => item.id === session.id);
        if (!folder || !live?.running || closingIds.current.has(session.id) || closingAllRef.current) return;
        setStartingIds((current) => new Set(current).add(session.id));
        await invoke("stop_session", { sessionId: session.id });
        stopped = true;
        runs.current.delete(session.id);
        forgetShellAgent(session.id);
        const current = sessionsRef.current.find((item) => item.id === session.id) ?? live;
        // Keep the terminal mounted while its write queue holds later keystrokes behind recovery;
        // launch marks it disconnected if the replacement process cannot start.
        const restored = { ...current, cwd: folder.path, running: true };
        setSessions((current) => current.map((item) => (item.id === session.id ? restored : item)));
        resumed.current = session.id;
        await launch(restored, true);
      } catch (reason) {
        if (stopped) {
          setSessions((current) =>
            current.map((item) => (item.id === session.id ? { ...item, running: false } : item)),
          );
        }
        recoveryFailures.current.add(session.id);
        setError(`Session could not be recovered: ${String(reason)}`);
        throw reason;
      } finally {
        recoveries.current.delete(session.id);
        pendingCleanups.current.delete(cleanup);
        setStartingIds((current) => without(current, session.id));
      }
    })();
    cleanup = () => recovery.catch(() => {});
    recoveries.current.set(session.id, recovery);
    pendingCleanups.current.add(cleanup);
    holdSessionWrites(session.id, recovery);
    return recovery;
  }
  recoverRef.current = recoverSession;

  // Opening the app, or coming back to an idle session, brings its provider process back on its own.
  useEffect(() => {
    if (!selected || selected.mode || selected.running || selectedStarting || resumed.current === selected.id) return;
    resumed.current = selected.id;
    void resumeSession(selected);
  }, [selected, selectedStarting, resumeSession]);

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
      const grant =
        (await invoke<{ id: string; path: string } | null>("default_directory")) ??
        (await invoke<{ id: string; path: string } | null>("choose_directory"));
      if (!grant) return;
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
    session = { ...session, createdAt: session.createdAt ?? Date.now() };
    resumed.current = session.id;
    recentSessions.current = [session.id, ...recentSessions.current];
    setSessions((current) => [session, ...current]);
    setSelectedId(session.id);
    void launch(session, false);
  }

  function reorderSession(draggedId: string, targetId: string, after: boolean) {
    if (sessionView.sort !== "manual") {
      const view = { ...sessionView, sort: "manual" as const };
      localStorage.setItem(SESSION_VIEW_KEY, JSON.stringify(view));
      setSessionView(view);
    }
    setSessions((current) => {
      const ordered = groupSessions(
        sortSessions(current, sessionView.sort),
        sessionView.grouping,
        attentionIds,
        working,
      ).flatMap((group) => group.sessions);
      const draggedIndex = ordered.findIndex((session) => session.id === draggedId);
      const targetIndex = ordered.findIndex((session) => session.id === targetId);
      if (draggedIndex < 0 || targetIndex < 0 || draggedIndex === targetIndex) return current;
      const dragged = ordered[draggedIndex];
      const target = ordered[targetIndex];
      const draggedGroup = sessionGroupKey(dragged, sessionView.grouping, attentionIds, working);
      const targetGroup = sessionGroupKey(target, sessionView.grouping, attentionIds, working);
      if (draggedGroup !== targetGroup) {
        const moved = ordered.filter(
          (session) => sessionGroupKey(session, sessionView.grouping, attentionIds, working) === draggedGroup,
        );
        const next = ordered.filter(
          (session) => sessionGroupKey(session, sessionView.grouping, attentionIds, working) !== draggedGroup,
        );
        const targets = next.flatMap((session, index) =>
          sessionGroupKey(session, sessionView.grouping, attentionIds, working) === targetGroup ? [index] : [],
        );
        const destination = after ? targets[targets.length - 1] + 1 : targets[0];
        next.splice(destination, 0, ...moved);
        return next;
      }
      const next = [...ordered];
      const [moved] = next.splice(draggedIndex, 1);
      const destination = next.findIndex((session) => session.id === targetId) + Number(after);
      next.splice(destination, 0, moved);
      return next;
    });
  }

  function sessionUndoToast(
    session: Session,
    action: "Closed" | "Restarted",
    completed: Promise<boolean>,
    undo: () => Promise<void> | void,
    cleanup: () => Promise<void>,
  ) {
    let undone = false;
    let toastId = "";
    let finishing: Promise<void> | undefined;
    const finish = () => (finishing ??= completed.then((successful) => (successful ? cleanup() : undefined)));
    pendingCleanups.current.add(finish);
    void completed.then((successful) => {
      if (!successful) {
        pendingCleanups.current.delete(finish);
        toast.close(toastId);
      }
    });
    toastId = toast.add({
      title: `${action} “${session.name}”`,
      type: "success",
      timeout: 8000,
      onClose: async () => {
        if (!undone) await finish();
        pendingCleanups.current.delete(finish);
      },
      actionProps: {
        children: "Undo",
        onClick: () => {
          undone = true;
          pendingCleanups.current.delete(finish);
          toast.close(toastId);
          const recovery = Promise.resolve(undo());
          const finishRecovery = () => recovery;
          pendingCleanups.current.add(finishRecovery);
          void recovery.finally(() => pendingCleanups.current.delete(finishRecovery));
        },
      },
    });
  }

  // Restarting keeps the tab and its folder but asks the provider for a conversation of its own, so the
  // session it resumed by id is retained only until the shared Undo window expires.
  function replaceRecentSession(from: string, to: string) {
    recentSessions.current = recentSessions.current.map((id) => (id === from ? to : id));
  }

  function restartSession(session: Session, select = true, recovered = false) {
    // A close in flight owns this session's fate: restarting now would inherit a worktree the
    // close dialog is about to take away.
    const recovering = recoveries.current.get(session.id);
    if (recovering) {
      const restart = () => {
        const current = sessionsRef.current.find((item) => item.id === session.id);
        if (current) restartSession(current, select, true);
      };
      void recovering.then(restart, restart);
      return;
    }
    if ((!recovered && startingIds.has(session.id)) || closingIds.current.has(session.id)) return;
    recoveryFailures.current.delete(session.id);
    clearAttention(session.id);
    const fresh: Session = {
      ...session,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      providerSessionId: undefined,
      running: false,
    };
    const restarted = restartSessionNow(session, fresh, select);
    sessionUndoToast(
      session,
      "Restarted",
      restarted,
      () => {
        const restored = { ...session, running: false };
        replaceRecentSession(fresh.id, session.id);
        setStartingIds((current) => swapped(current, fresh.id, session.id));
        setSessions((current) => current.map((item) => (item.id === fresh.id ? restored : item)));
        setSelectedId((current) => (current === fresh.id ? session.id : current));
        resumed.current = session.id;
        return restarted.then(async (successful) => {
          if (!successful) return;
          runs.current.delete(fresh.id);
          try {
            await invoke("stop_session", { sessionId: fresh.id });
          } catch (reason) {
            replaceRecentSession(session.id, fresh.id);
            setStartingIds((current) => swapped(current, session.id, fresh.id));
            const relaunched = { ...fresh, running: false };
            setSessions((current) => current.map((item) => (item.id === session.id ? relaunched : item)));
            setSelectedId((current) => (current === session.id ? fresh.id : current));
            resumed.current = fresh.id;
            if (await launch(relaunched, true)) {
              setError(`Restart could not be undone; the restarted session was restored: ${String(reason)}`);
            }
            await invoke("delete_session_data", { sessionId: session.id }).catch(() => {});
            clearOutput(session.id);
            clearInspectorCache(session.id);
            return;
          }
          await invoke("delete_session_data", { sessionId: fresh.id }).catch(() => {});
          clearOutput(fresh.id);
          clearInspectorCache(fresh.id);
          await launch(restored, true);
        });
      },
      async () => {
        await invoke("delete_session_data", { sessionId: session.id }).catch((reason) =>
          setError(`Session restarted, but local cleanup failed: ${String(reason)}`),
        );
        clearOutput(session.id);
        clearInspectorCache(session.id);
      },
    );
  }

  async function restartSessionNow(session: Session, fresh: Session, select: boolean): Promise<boolean> {
    runs.current.delete(session.id);
    replaceRecentSession(session.id, fresh.id);
    setStartingIds((current) => new Set(current).add(fresh.id));
    setSessions((current) => current.map((item) => (item.id === session.id ? fresh : item)));
    if (select) {
      setSelectedId(fresh.id);
      resumed.current = fresh.id;
    }
    try {
      await invoke("stop_session", { sessionId: session.id });
    } catch (reason) {
      replaceRecentSession(fresh.id, session.id);
      const restored = { ...session, running: false };
      setStartingIds((current) => swapped(current, fresh.id, session.id));
      setSessions((current) => current.map((item) => (item.id === fresh.id ? restored : item)));
      setSelectedId((current) => (current === fresh.id ? session.id : current));
      resumed.current = session.id;
      if (await launch(restored, true)) {
        setError(`Session could not be restarted; the original session was restored: ${String(reason)}`);
      }
      return false;
    }
    if (!(await launch(fresh, false))) {
      replaceRecentSession(fresh.id, session.id);
      await invoke("delete_session_data", { sessionId: fresh.id }).catch(() => {});
      clearOutput(fresh.id);
      clearInspectorCache(fresh.id);
      const restored = { ...session, running: false };
      setSessions((current) => current.map((item) => (item.id === fresh.id ? restored : item)));
      setSelectedId((current) => (current === fresh.id ? session.id : current));
      resumed.current = session.id;
      if (await launch(restored, true)) setError("Restart failed; the original session was restored.");
      return false;
    }
    if (fresh.agent === "kimi") startKimiConversation(fresh.id);
    return true;
  }

  function restartAllSessions() {
    for (const session of sessions) restartSession(session, session.id === selectedId);
  }

  // Runs one worktree cleanup operation after another: the caller gets its own result, the
  // queue never jams on a failure.
  function enqueueCleanup<T>(operation: () => Promise<T>): Promise<T> {
    const run = cleanupQueue.current.then(operation, operation);
    cleanupQueue.current = run.catch(() => undefined);
    return run;
  }

  // Worktree cleanup runs first so a failed removal can restore a session whose provider metadata
  // and folder grant are still intact.
  async function cleanupSession(session: Session): Promise<{ error: string; restorable: boolean }> {
    recoveryFailures.current.delete(session.id);
    let error = "";
    let restorable = false;
    if (session.worktree) {
      const keep = keptWorktrees.current.delete(session.id);
      try {
        if (keep) {
          // Kept at the user's choice: Lite forgets it made the worktree; the folder is the user's now.
          await enqueueCleanup(() => invoke("forget_worktree", { rootId: session.rootId }));
        } else {
          // The grant is still needed for this, so the worktree goes before it does. Force and
          // its scope were the user's answer at close time; the backend re-reads the tree
          // immediately before removing, so nothing written since the confirmation is taken
          // against a narrower approval.
          const approved = forceWorktree.current.delete(session.id);
          await enqueueCleanup(() =>
            invoke("remove_worktree", {
              rootId: session.rootId,
              force: approved !== undefined,
              dirtyCovered: approved ?? false,
            }),
          );
        }
      } catch (reason) {
        error ||= String(reason);
        // Restorable while Lite's record exists: a restored tab retries — through the dialog
        // while the folder stands, through the gone path once it does not, and through the same
        // keep choice after a failed forget. A failure with no record left (or an unknown state)
        // is only reported, and the record is never erased for the user by a failure.
        restorable = await invoke<{ recorded: boolean }>("worktree_state", {
          rootId: session.rootId,
        })
          .then((state) => state.recorded)
          .catch(() => false);
      }
    }
    if (restorable) {
      setError(`Session closed, but local cleanup failed: ${error}`);
      return { error, restorable };
    }
    try {
      await invoke("delete_session_data", { sessionId: session.id });
    } catch (reason) {
      error ||= String(reason);
    }
    try {
      await invoke("revoke_directory", { rootId: session.rootId });
    } catch (reason) {
      error ||= String(reason);
    }
    clearOutput(session.id);
    clearInspectorCache(session.id);
    if (error) setError(`Session closed, but local cleanup failed: ${error}`);
    return { error, restorable };
  }

  // A worktree session owns the folder it runs in, so closing one first asks whether the folder
  // and its branch go with the tab. Everything else closes directly.
  function closeSession(session: Session, recovered = false) {
    const recovering = recoveries.current.get(session.id);
    if (recovering) {
      const close = () => {
        const current = sessionsRef.current.find((item) => item.id === session.id);
        if (current) closeSession(current, true);
      };
      void recovering.then(close, close);
      return;
    }
    if (!recovered && startingIds.has(session.id)) return;
    if (!session.worktree) return closeSessionNow(session);
    // One close flow across the app at a time: the dialog is singular, so from probe to answer
    // only one worktree session may be closing at all — a second would overwrite the dialog and
    // strand the first in closingIds.
    if (closingIds.current.size !== 0) return;
    closingIds.current.add(session.id);
    // A close that reaches here makes its own keep/force decision; anything left by an undone
    // close is void, and the gone and damaged paths below never re-ask.
    keptWorktrees.current.delete(session.id);
    forceWorktree.current.delete(session.id);
    void invoke<{
      recorded: boolean;
      gone: boolean;
      force: boolean;
      changes: number;
      changesTruncated: boolean;
      damaged: boolean;
      branch: string;
      path: string;
    }>("worktree_state", { rootId: session.rootId })
      .then((state) => {
        // No record means nothing Lite can clean up: the folder is the user's, the tab just closes.
        if (!state.recorded) {
          closingIds.current.delete(session.id);
          return closeSessionNow({ ...session, worktree: false });
        }
        // A folder already gone leaves the branch and the record, and losing those is still the
        // user's call — not least because a branch that cannot be deleted needs a keep route out.
        if (state.gone) {
          if (!state.branch) {
            closingIds.current.delete(session.id);
            return closeSessionNow(session);
          }
          return setClosingWorktree({
            session,
            branch: state.branch,
            force: false,
            changes: 0,
            changesTruncated: false,
            folder: state.path,
            gone: true,
            damaged: false,
          });
        }
        // A folder whose git data cannot be read still gets its keep route: keeping needs no git,
        // and deletion then runs without force so git's own checks are the gate.
        if (state.damaged) {
          return setClosingWorktree({
            session,
            branch: state.branch,
            force: false,
            changes: 0,
            changesTruncated: false,
            folder: state.path,
            gone: false,
            damaged: true,
          });
        }
        setClosingWorktree({
          session,
          branch: state.branch,
          force: state.force,
          changes: state.changes,
          changesTruncated: state.changesTruncated,
          folder: state.path,
          gone: false,
          damaged: false,
        });
      })
      // The state could not be read, so nothing is known about what closing would delete: the
      // session stays and the error says why, so closing can be tried again.
      .catch((reason) => {
        closingIds.current.delete(session.id);
        setError(String(reason));
      });
  }

  function confirmCloseWorktree(remove: boolean) {
    if (!closingWorktree) return;
    const { session, force, changes } = closingWorktree;
    closingIds.current.delete(session.id);
    setClosingWorktree(undefined);
    // Keep-or-delete travels beside the session, not in it: Undo restores the session exactly as
    // it was, worktree flag included, and cleanup reads the choice from here.
    if (remove) {
      if (force) forceWorktree.current.set(session.id, changes > 0);
    } else {
      keptWorktrees.current.add(session.id);
    }
    closeSessionNow(session, false);
  }

  // Ordinary closing is reversible: the row leaves immediately and its PTY stops, while the provider
  // metadata and directory grant remain until the toast closes. A worktree's explicit keep/delete
  // choice instead runs cleanup as soon as the PTY stops, while the confirmation is still current.
  function closeSessionNow(session: Session, reversible = true) {
    if (startingIds.has(session.id)) return;
    clearAttention(session.id);
    const index = sessions.findIndex((item) => item.id === session.id);
    const recentIndex = recentSessions.current.indexOf(session.id);
    const wasSelected = selectedId === session.id;
    const nextSelectedId = sessions.find((item) => item.id !== session.id)?.id ?? "";
    runs.current.delete(session.id);
    if (resumed.current === session.id) resumed.current = "";
    const timer = workTimers.current.get(session.id);
    if (timer) window.clearTimeout(timer);
    workTimers.current.delete(session.id);
    setWorking((current) => without(current, session.id));
    setSessions((current) => current.filter((item) => item.id !== session.id));
    if (wasSelected) setSelectedId(nextSelectedId);

    function restore(running: boolean) {
      keptWorktrees.current.delete(session.id);
      forceWorktree.current.delete(session.id);
      if (!recentSessions.current.includes(session.id)) {
        recentSessions.current.splice(Math.min(Math.max(recentIndex, 0), recentSessions.current.length), 0, session.id);
      }
      setSessions((current) => {
        if (current.some((item) => item.id === session.id)) {
          return current.map((item) => (item.id === session.id ? { ...item, running } : item));
        }
        const restored = [...current];
        restored.splice(Math.min(index, restored.length), 0, { ...session, running });
        return restored;
      });
      if (wasSelected) setSelectedId((current) => (current === nextSelectedId ? session.id : current));
    }
    const stopped = invoke("stop_session", { sessionId: session.id }).then(
      () => true,
      async (reason) => {
        const restored = { ...session, running: false };
        setStartingIds((current) => new Set(current).add(session.id));
        resumed.current = session.id;
        restore(false);
        if (await launch(restored, true)) {
          setError(`Session could not be closed; it was restored: ${String(reason)}`);
        }
        return false;
      },
    );
    if (!reversible) {
      const cleanup = async () => {
        const successful = await stopped;
        if (!successful) return;
        const { error, restorable } = await cleanupSession(session);
        if (error && restorable) restore(false);
      };
      pendingCleanups.current.add(cleanup);
      void cleanup().finally(() => pendingCleanups.current.delete(cleanup));
      return;
    }
    sessionUndoToast(
      session,
      "Closed",
      stopped,
      () => {
        const restored = { ...session, running: false };
        setStartingIds((current) => new Set(current).add(session.id));
        resumed.current = session.id;
        restore(false);
        return stopped.then(async (successful) => {
          if (successful) {
            await launch(restored, true);
          }
        });
      },
      async () => {
        // Only a cleanup whose destructive part failed restores the session: there is still
        // something to retry, and nothing was lost by bringing the tab back.
        const { error, restorable } = await cleanupSession(session);
        if (error && restorable) restore(false);
      },
    );
  }

  async function checkForUpdates() {
    // The dialog owns an install once it has started one. Re-entering here would reset it out of
    // sight and offer a second install while the first is still running.
    if (updateOpen && (updateStatus === "checking" || updateStatus === "installing")) return;
    setUpdateOpen(true);
    setUpdateStatus("checking");
    setUpdateError("");
    setReleaseNotes("");
    try {
      // A release would replace this build rather than update it, so a local build asks its own tree.
      if (commit) {
        const next = await invoke<string | null>("local_update");
        setAvailableVersion(next ?? "");
        setUpdateStatus(next ? "rebuild" : "current");
      } else {
        const next = await askRelease();
        setAvailableVersion(next?.version ?? "");
        setReleaseNotes(next?.notes ?? "");
        setUpdateStatus(next?.available ? "available" : "current");
      }
    } catch (reason) {
      setUpdateError(String(reason));
      setUpdateStatus("error");
    }
  }

  // A local build is rebuilt by running one command in the tree it came from, so Lite opens that tree
  // in a shell and runs it there rather than building out of sight: a build that fails says why, in the
  // place its output belongs, and the tab stays afterwards like any other.
  async function rebuild() {
    // One build at a time: the dialog closes on the click, but checking again reopens it still behind
    // its tree, and a second build would contend with the first over the same target and dist folders.
    if (rebuilding) return;
    setRebuilding(true);
    try {
      const folder = await invoke<{ id: string; path: string }>("grant_repo");
      const session: Session = {
        id: crypto.randomUUID(),
        agent: "shell",
        cwd: folder.path,
        rootId: folder.id,
        name: "Rebuild Lite",
        renamed: true,
        running: false,
      };
      setUpdateOpen(false);
      createSession(session);
      runOnStart(session.id, "git pull --ff-only origin main && bun run local");
    } catch (reason) {
      setRebuilding(false);
      setUpdateError(String(reason));
      setUpdateStatus("error");
    }
  }

  async function installUpdate() {
    setUpdateProgress(null);
    setUpdateStatus("installing");
    // A download only reports itself while it is running, so it is heard for exactly that long. A
    // successful install restarts Lite from underneath this, and the failures it can return come
    // back here to be shown.
    const stop = await listen<number>("update-progress", ({ payload }) => setUpdateProgress(payload));
    try {
      await invoke("install_update");
    } catch (reason) {
      setUpdateError(String(reason));
      setUpdateStatus("error");
    } finally {
      stop();
    }
  }

  function changeUpdateOpen(open: boolean) {
    if (!open && (updateStatus === "checking" || updateStatus === "installing")) return;
    setUpdateOpen(open);
    if (!open) setAvailableVersion("");
  }

  return (
    <TooltipProvider>
      <AppContextMenu
        sessions={sessions}
        selectedId={selectedId}
        startingIds={startingIds}
        onSelectSession={(session) => openRef.current(session)}
        onRenameSession={(session) => {
          openRef.current(session);
          setRenamingId(session.id);
          if (shut.sidebar) glide(sidebarPanel.current, share(sidebarPanel.current, SIDES.sidebar.size));
        }}
        onRestartSession={(session) => void restartSession(session)}
        onCloseSession={closeSession}
        onRestartAll={restartAllSessions}
        onCloseAll={() => setClosingAll(true)}
      >
        <div ref={layout} className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
          {/* The window buttons sit inside this bar on macOS, so it doubles as the title bar and drags the window. */}
          <header
            data-tauri-drag-region="deep"
            className="relative flex h-9 shrink-0 items-center border-b bg-sidebar text-sidebar-foreground"
          >
            <div
              className={`flex h-full shrink-0 items-center gap-[3px] overflow-hidden ${shut.sidebar ? "p-0" : "px-[13px] in-data-[titlebar=overlay]:pl-[86px]"}`}
              style={{ width: shut.sidebar ? 0 : "var(--sidebar-width, 20%)" }}
            >
              {shut.sidebar ? null : (
                <>
                  <ActionIconButton
                    size="icon-sm"
                    tooltip="View Lite on GitHub"
                    aria-label="Lite on GitHub"
                    data-context-url="https://github.com/ultralytics/lite"
                    onClick={() => void invoke("open_url", { url: "https://github.com/ultralytics/lite" })}
                  >
                    <UltralyticsLogomark className="size-[18px]" />
                  </ActionIconButton>
                  <VersionBadge
                    className="h-[18px] px-1.5 text-[11px]"
                    version={version}
                    commit={commit}
                    built={built}
                    release={release}
                    onCheck={() => void checkForUpdates()}
                  />
                </>
              )}
            </div>
            <div
              className={`flex h-full min-w-0 flex-1 items-center gap-2 pr-3 pl-[13px] ${shut.sidebar ? "in-data-[titlebar=overlay]:pl-[86px]" : ""}`}
            >
              {selected ? (
                <>
                  <ProviderIcon
                    agent={shellAgents.get(selected.id) ?? selected.agent}
                    provider={selected.provider}
                    className="size-4 shrink-0"
                  />
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          className="min-w-0 truncate rounded-sm text-xs font-medium hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                          aria-label="Switch session"
                          aria-keyshortcuts={navigator.platform.includes("Mac") ? "Meta+P" : "Control+Shift+P"}
                          onClick={() => setSessionSwitcherOpen(true)}
                        />
                      }
                    >
                      {selected.name}
                    </TooltipTrigger>
                    <TooltipContent>Switch session · {sessionShortcut}</TooltipContent>
                  </Tooltip>
                  <button
                    type="button"
                    className="min-w-0 max-w-full overflow-hidden text-left font-mono text-[11px] text-muted-foreground hover:text-foreground"
                    aria-label={`Open ${selected.cwd} in file browser`}
                    onClick={() => void invoke("open_directory", { rootId: selected.rootId })}
                  >
                    <Tooltip>
                      <TooltipTrigger render={<span className="block w-fit max-w-full truncate" />}>
                        {selected.cwd}
                      </TooltipTrigger>
                      <TooltipContent>Open {selected.cwd} in file browser</TooltipContent>
                    </Tooltip>
                  </button>
                </>
              ) : (
                <span className="text-sm font-semibold">Lite</span>
              )}
            </div>
            {selected ? (
              <div className="relative h-full shrink-0" style={{ width: "var(--inspector-width, 25%)" }}>
                {remote ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`absolute top-0.5 right-20 min-w-0 gap-1.5 text-muted-foreground ${shut.inspector ? "max-w-56" : "max-w-[calc(100%-5.75rem)]"}`}
                    data-context-url={remote}
                    aria-label={`Open ${remote}`}
                    onClick={() => void invoke("open_url", { url: remote })}
                  >
                    <GitBranch className="size-3.5 shrink-0" />
                    <Tooltip>
                      <TooltipTrigger render={<span className="min-w-0 truncate font-mono text-[11px]" />}>
                        {repoName(remote)}
                      </TooltipTrigger>
                      <TooltipContent>Open {remote}</TooltipContent>
                    </Tooltip>
                  </Button>
                ) : null}
              </div>
            ) : null}
            <div className="absolute right-3 flex shrink-0 items-center gap-0.5">
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
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Settings"
                      onClick={() => setSettingsOpen(true)}
                    />
                  }
                >
                  <SettingsIcon />
                </TooltipTrigger>
                <TooltipContent>Settings</TooltipContent>
              </Tooltip>
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
              <aside
                data-context-surface
                data-zoom-panel="sidebar"
                className="flex h-full w-full flex-col bg-sidebar text-sidebar-foreground"
                style={zoomPanelStyle(sidebarFontSize)}
              >
                {shut.sidebar ? (
                  <ScrollArea className="min-h-0 flex-1">
                    <div className="flex animate-in flex-col items-center gap-0.5 py-1.5 fade-in duration-200">
                      <ActionIconButton
                        size="icon-sm"
                        tooltip="Expand sessions"
                        tooltipSide="right"
                        aria-label="Expand sessions"
                        data-context-expand-sessions
                        onClick={() => glide(sidebarPanel.current, share(sidebarPanel.current, SIDES.sidebar.size))}
                      >
                        <ChevronRight />
                      </ActionIconButton>
                      <ActionIconButton
                        size="icon-sm"
                        tooltip="New session"
                        tooltipSide="right"
                        aria-label="New session"
                        data-context-new-session
                        onClick={() => setNewSessionOpen(true)}
                      >
                        <Plus />
                      </ActionIconButton>
                      {sessions.map((session) => (
                        <Tooltip key={session.id}>
                          <TooltipTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-pressed={session.id === selectedId}
                                aria-label={attention.includes(session.id) ? `${session.name}; ready` : session.name}
                                data-context-session={session.id}
                                className={
                                  session.id === selectedId ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60"
                                }
                                onClick={() => openRef.current(session)}
                              />
                            }
                          >
                            <SessionBadge
                              session={session}
                              agent={shellAgents.get(session.id)}
                              active={session.id === selectedId}
                              attention={attention.includes(session.id)}
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
                    <div className="flex h-11 shrink-0 items-center gap-0.5 pr-1.5 pl-2">
                      <InputGroup>
                        <InputGroupAddon>
                          <Search />
                        </InputGroupAddon>
                        <InputGroupInput
                          value={query}
                          placeholder="Search sessions"
                          aria-label="Search sessions"
                          onChange={(event) => setQuery(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") setQuery("");
                          }}
                        />
                      </InputGroup>
                      <ActionIconButton
                        size="icon-sm"
                        tooltip="New session"
                        aria-label="New session"
                        data-context-new-session
                        onClick={() => setNewSessionOpen(true)}
                      >
                        <Plus />
                      </ActionIconButton>
                      <SessionViewOptions
                        view={sessionView}
                        onChange={(view) => {
                          localStorage.setItem(SESSION_VIEW_KEY, JSON.stringify(view));
                          if (view.grouping !== sessionView.grouping) setCollapsedGroups(new Set());
                          setSessionView(view);
                        }}
                      />
                      <ActionIconButton
                        size="icon-sm"
                        tooltip="Collapse sessions"
                        aria-label="Collapse sessions"
                        data-context-collapse-sessions
                        onClick={() => glide(sidebarPanel.current, RAIL)}
                      >
                        <ChevronLeft />
                      </ActionIconButton>
                    </div>
                    <ScrollArea className="min-h-0 flex-1">
                      <div className="space-y-0.5 px-2 pb-2" data-session-list>
                        {query && !visible.length ? (
                          <p className="px-2 py-1.5 text-xs text-muted-foreground">No session matches “{query}”.</p>
                        ) : null}
                        {visibleGroups.map((group) => {
                          const open =
                            sessionView.grouping === "none" || Boolean(query.trim()) || !collapsedGroups.has(group.key);
                          return (
                            <section key={group.key}>
                              {sessionView.grouping === "none" ? null : (
                                <button
                                  type="button"
                                  className="flex h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-left text-[10px] font-medium text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
                                  title={group.title}
                                  aria-label={`${group.name}, ${group.sessions.length} session${group.sessions.length === 1 ? "" : "s"}`}
                                  aria-expanded={open}
                                  onClick={() =>
                                    setCollapsedGroups((current) => {
                                      const next = new Set(current);
                                      if (next.has(group.key)) next.delete(group.key);
                                      else next.add(group.key);
                                      return next;
                                    })
                                  }
                                >
                                  <ChevronRight
                                    aria-hidden="true"
                                    className={`size-3 transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
                                  />
                                  {sessionView.grouping === "state" ? (
                                    <span
                                      aria-hidden="true"
                                      className={`size-2 rounded-full ${SESSION_STATUS[group.key.slice("state:".length) as keyof typeof SESSION_STATUS].dot}`}
                                    />
                                  ) : sessionView.grouping === "repository" ? (
                                    <GitBranch aria-hidden="true" className="size-3" />
                                  ) : (
                                    <Folder aria-hidden="true" className="size-3" />
                                  )}
                                  <span className="min-w-0 flex-1 truncate">{group.name}</span>
                                  <span className="tabular-nums">{group.sessions.length}</span>
                                </button>
                              )}
                              {open ? (
                                <div className="space-y-0.5">
                                  {group.sessions.map((session) => (
                                    <SessionRow
                                      key={session.id}
                                      session={session}
                                      agent={shellAgents.get(session.id)}
                                      active={session.id === selectedId}
                                      attention={attention.includes(session.id)}
                                      starting={startingIds.has(session.id)}
                                      working={working.has(session.id)}
                                      renaming={renamingId === session.id}
                                      reorderable
                                      groupBounded={sessionView.grouping === "state"}
                                      onSelect={() => openRef.current(session)}
                                      onRename={(name) =>
                                        setSessions((current) =>
                                          current.map((item) =>
                                            item.id === session.id ? { ...item, name, renamed: true } : item,
                                          ),
                                        )
                                      }
                                      onRenamingChange={(renaming) => setRenamingId(renaming ? session.id : "")}
                                      onReorder={(targetId, after) => reorderSession(session.id, targetId, after)}
                                      onMove={(direction) => {
                                        const index = displayed.findIndex((item) => item.id === session.id);
                                        const target = displayed[index + direction];
                                        if (target) reorderSession(session.id, target.id, direction > 0);
                                      }}
                                      onRestart={() => void restartSession(session)}
                                      onClose={() => closeSession(session)}
                                    />
                                  ))}
                                </div>
                              ) : null}
                            </section>
                          );
                        })}
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
                  <div data-terminal-surface className="relative min-h-0 flex-1">
                    <Suspense fallback={<div className="absolute inset-0 bg-background" />}>
                      {sessions.map((session) =>
                        session.running ? (
                          <div
                            key={session.id}
                            aria-hidden={!selected.running || session.id !== selectedId}
                            className={`absolute inset-0 ${selected.running && session.id === selectedId ? "visible" : "invisible"}`}
                          >
                            <TerminalView
                              sessionId={session.id}
                              agent={shellAgents.get(session.id) ?? session.agent}
                              theme={theme}
                              active={selected.running && session.id === selectedId}
                              working={working.has(session.id)}
                              starting={startingIds.has(session.id)}
                              onRecover={() => recoverSession(session)}
                              onPrompt={(text) => {
                                const agent = session.agent === "shell" ? commandAgent(text) : undefined;
                                if (agent)
                                  void invoke("watch_shell_agent", { sessionId: session.id, agent }).catch((reason) =>
                                    console.error(`Lite could not follow the agent in session ${session.id}:`, reason),
                                  );
                                setSessions((current) =>
                                  current.map((item) =>
                                    item.id === session.id &&
                                    !item.renamed &&
                                    item.name === defaultSessionName(item.cwd)
                                      ? { ...item, name: subject(text) }
                                      : item,
                                  ),
                                );
                              }}
                            />
                          </div>
                        ) : null,
                      )}
                    </Suspense>
                    {selected.running ? (
                      <fieldset
                        aria-label="Session actions"
                        className="absolute top-2 right-2 z-20 hidden items-center gap-0.5 rounded-lg bg-background/90 p-0.5 shadow-sm"
                        data-terminal-action
                        onMouseDown={(event) => event.preventDefault()}
                      >
                        <ActionIconButton
                          size="icon-sm"
                          tooltip="Scroll to bottom"
                          aria-label="Scroll to bottom"
                          onClick={() =>
                            document
                              .querySelector<HTMLElement>(
                                `[data-context-session="${CSS.escape(selected.id)}"] [data-terminal-scroll-bottom]`,
                              )
                              ?.click()
                          }
                        >
                          <ArrowDownToLine />
                        </ActionIconButton>
                        <SessionActionButtons
                          name={selected.name}
                          onRestart={() => void restartSession(selected)}
                          onClose={() => closeSession(selected)}
                        />
                      </fieldset>
                    ) : null}
                    {selected.running ? null : startingIds.has(selected.id) ? (
                      <Empty className="h-full">
                        <EmptyHeader>
                          <SessionMark session={selected} />
                          <EmptyTitle className="flex items-center gap-2">
                            <Spinner className="size-4 text-muted-foreground" aria-hidden="true" />
                            Starting {sessionLabel(selected)}…
                          </EmptyTitle>
                          <EmptyDescription>{shortPath(selected.cwd)}</EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    ) : (
                      <Empty className="h-full">
                        <EmptyHeader>
                          <SessionMark session={selected} />
                          <EmptyTitle>This session is not running</EmptyTitle>
                          <EmptyDescription>Resuming reopens it in the folder it was started in.</EmptyDescription>
                        </EmptyHeader>
                        <EmptyContent>
                          <Button variant="outline" onClick={() => void launch(selected, true)}>
                            <Play />
                            Resume session
                          </Button>
                        </EmptyContent>
                      </Empty>
                    )}
                  </div>
                ) : (
                  <Empty className="h-full">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <SquareTerminal />
                      </EmptyMedia>
                      <EmptyTitle>Start a session</EmptyTitle>
                      <EmptyDescription>
                        Pick a project folder, then choose the agent that should work in it.
                      </EmptyDescription>
                    </EmptyHeader>
                    <EmptyContent>
                      <Button onClick={() => setNewSessionOpen(true)}>
                        <Plus />
                        New session
                      </Button>
                    </EmptyContent>
                  </Empty>
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
                  <aside
                    data-zoom-panel="inspector"
                    className="h-full w-full border-l"
                    style={zoomPanelStyle(inspectorFontSize)}
                  >
                    <PanelBoundary key={selected.id}>
                      <Inspector
                        session={selected}
                        remote={remote}
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
            <DialogContent
              ref={updateDialog}
              initialFocus={updateDialog}
              className="sm:max-w-2xl"
              showCloseButton={updateStatus !== "checking" && updateStatus !== "installing"}
            >
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
                    ? `This build is ${commit} and main is now ${availableVersion}. Rebuilding fast-forwards from origin/main in a shell tab, then replaces this build.`
                    : null}
                  {updateStatus === "current" ? (
                    <span className="flex items-center gap-1.5">
                      <Check className="size-4 shrink-0 text-success" />
                      {commit
                        ? "This build matches the tree it was built from."
                        : "You have the latest version of Lite."}
                    </span>
                  ) : null}
                  {updateStatus === "installing" ? "Downloading and installing the update…" : null}
                  {updateStatus === "error" ? `Update failed: ${updateError}` : null}
                </DialogDescription>
              </DialogHeader>
              <DialogBody>
                {/* A bar only once the download has a percent to put in it: an update whose size the
                  server never gave has none to give, and an empty bar would say less than the spinner
                  it replaced. */}
                {updateStatus === "installing" && updateProgress !== null ? (
                  <Progress value={updateProgress}>
                    <ProgressLabel className="flex items-center gap-1.5">
                      <Spinner aria-hidden="true" />
                      Downloading update
                    </ProgressLabel>
                    <ProgressValue />
                  </Progress>
                ) : updateStatus === "checking" || updateStatus === "installing" ? (
                  <Spinner className="mx-auto size-5 text-muted-foreground" />
                ) : (
                  // What this copy of Lite actually is, which is the first thing worth knowing when it and
                  // the tree disagree. A release has no tree to name and leaves those rows out.
                  <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
                    <dt className="text-muted-foreground">Version</dt>
                    <dd className="truncate font-mono">{version || "—"}</dd>
                    {commit ? (
                      <>
                        <dt className="text-muted-foreground">Build</dt>
                        <dd className="truncate font-mono">{commit}</dd>
                      </>
                    ) : null}
                    {built ? (
                      <>
                        <dt className="text-muted-foreground">{commit ? "Built" : "Released"}</dt>
                        <dd className="truncate">{built}</dd>
                      </>
                    ) : null}
                    {repo ? (
                      <>
                        <dt className="text-muted-foreground">Source</dt>
                        <dd className="truncate font-mono" title={repo}>
                          {repo}
                        </dd>
                      </>
                    ) : null}
                  </dl>
                )}
                {releaseNotes && updateStatus !== "checking" && updateStatus !== "installing" ? (
                  <Suspense fallback={<Spinner className="mx-auto mt-4 size-5 text-muted-foreground" />}>
                    <ReleaseNotes
                      source={friendlyReleaseNotes(releaseNotes)}
                      className="mt-4 border-t pt-3 text-sm [&>h2:first-child]:mt-0"
                      onOpenLink={(url) => void invoke("open_url", { url })}
                    />
                  </Suspense>
                ) : null}
              </DialogBody>

              {updateStatus === "available" ? (
                <DialogFooter>
                  <Button variant="outline" onClick={() => changeUpdateOpen(false)}>
                    Not now
                  </Button>
                  <Button onClick={() => void installUpdate()}>Install and restart</Button>
                </DialogFooter>
              ) : null}
              {updateStatus === "rebuild" ? (
                <DialogFooter>
                  <Button variant="outline" onClick={() => changeUpdateOpen(false)}>
                    Not now
                  </Button>
                  <Button disabled={rebuilding} onClick={() => void rebuild()}>
                    <Play />
                    Rebuild
                  </Button>
                </DialogFooter>
              ) : null}
              {updateStatus === "current" ? (
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
          <Dialog
            open={closingAll}
            onOpenChange={(open) => {
              if (!open && closingAllRunning) return;
              setClosingAll(open);
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Close all sessions?</DialogTitle>
                <DialogDescription>
                  This stops every running session and removes all tabs. Providers keep their own conversation history.
                  {sessions.some((session) => session.worktree)
                    ? " Lite-created worktree folders and branches are kept."
                    : null}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" disabled={closingAllRunning} onClick={() => setClosingAll(false)}>
                  Keep
                </Button>
                <Button
                  variant="destructive"
                  disabled={closingAllRunning}
                  onClick={() => {
                    attentionRef.current = [];
                    setAttention([]);
                    for (const session of sessions) {
                      if (session.worktree) keptWorktrees.current.add(session.id);
                    }
                    // A session whose cleanup failed but is restorable keeps its tab: the record
                    // and grant survive for a retry, and they need a row to be retried from.
                    const failed = new Set<string>();
                    closingAllRef.current = true;
                    setClosingAllRunning(true);
                    // Registered like every other cleanup: closing the app mid-run waits for this
                    // instead of abandoning stops and cleanups half-done.
                    const close = async () => {
                      await Promise.allSettled([...recoveries.current.values()]);
                      await Promise.all(
                        sessions.map(async (session) => {
                          // A session that cannot be stopped is left alone, still live and still
                          // hearing its PTY; every promise settles, so the dialog always comes back.
                          const stopped = await invoke("stop_session", { sessionId: session.id }).then(
                            () => true,
                            () => false,
                          );
                          if (!stopped) {
                            failed.add(session.id);
                            return;
                          }
                          runs.current.delete(session.id);
                          const { error, restorable } = await cleanupSession(session);
                          if (error && restorable) {
                            failed.add(session.id);
                            // The PTY is already stopped; the retained tab must not look live.
                            setSessions((current) =>
                              current.map((item) => (item.id === session.id ? { ...item, running: false } : item)),
                            );
                            return;
                          }
                          setSessions((current) => current.filter((item) => item.id !== session.id));
                        }),
                      );
                      setSelectedId(sessions.find((session) => failed.has(session.id))?.id ?? "");
                      closingAllRef.current = false;
                      setClosingAllRunning(false);
                      setClosingAll(false);
                    };
                    pendingCleanups.current.add(close);
                    void close().finally(() => pendingCleanups.current.delete(close));
                  }}
                >
                  {closingAllRunning ? <Spinner /> : null}
                  {closingAllRunning ? "Closing…" : "Close all sessions"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog
            open={Boolean(closingWorktree)}
            onOpenChange={(open) => {
              if (open) return;
              if (closingWorktree) closingIds.current.delete(closingWorktree.session.id);
              setClosingWorktree(undefined);
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Close “{closingWorktree?.session.name}”?</DialogTitle>
                <DialogDescription>
                  {closingWorktree?.gone ? (
                    <>
                      The worktree folder{" "}
                      <span className="break-all font-mono">{shortPath(closingWorktree.folder)}</span> is already gone.
                      Closing the session can also delete its branch{" "}
                      <span className="break-all font-mono">{closingWorktree.branch}</span> and Lite's record of it.
                    </>
                  ) : closingWorktree?.damaged ? (
                    <>
                      The git data of worktree folder{" "}
                      <span className="break-all font-mono">{shortPath(closingWorktree.folder)}</span> could not be read
                      — it may be damaged. It can be kept as it is, or deletion tried without force: git itself will
                      refuse if the folder has changes.
                    </>
                  ) : (
                    <>
                      This session works in its own git worktree. Closing it can also delete the folder{" "}
                      <span className="break-all font-mono">
                        {closingWorktree ? shortPath(closingWorktree.folder) : ""}
                      </span>
                      {closingWorktree?.branch ? (
                        <>
                          {" "}
                          and its branch <span className="break-all font-mono">{closingWorktree.branch}</span>
                        </>
                      ) : (
                        <>. Its branch will be kept because Lite cannot verify ownership</>
                      )}
                      .
                    </>
                  )}
                </DialogDescription>
              </DialogHeader>
              {closingWorktree?.changes ? (
                <DialogBody>
                  <p className="text-xs text-destructive">
                    The worktree has {closingWorktree.changes}
                    {closingWorktree.changesTruncated ? "+" : ""} uncommitted{" "}
                    {!closingWorktree.changesTruncated && closingWorktree.changes === 1 ? "change" : "changes"} that
                    will be lost.
                  </p>
                </DialogBody>
              ) : closingWorktree?.force && !closingWorktree?.gone && !closingWorktree?.damaged ? (
                <DialogBody>
                  <p className="text-xs text-muted-foreground">
                    The worktree holds ignored files or submodules, so removing it needs force.
                  </p>
                </DialogBody>
              ) : null}
              <DialogFooter>
                <Button variant="outline" onClick={() => confirmCloseWorktree(false)}>
                  {closingWorktree?.gone ? "Keep branch" : "Keep worktree"}
                </Button>
                <Button variant="destructive" onClick={() => confirmCloseWorktree(true)}>
                  {closingWorktree?.gone
                    ? "Delete branch"
                    : closingWorktree?.force
                      ? "Force delete worktree"
                      : "Delete worktree"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <NewSessionDialog
            open={newSessionOpen}
            onOpenChange={setNewSessionOpen}
            onCreate={createSession}
            sessions={sessions}
          />
          <SessionSwitcher
            open={sessionSwitcherOpen}
            sessions={switcherSessions}
            selectedId={selectedId}
            attention={attention}
            working={working}
            startingIds={startingIds}
            shellAgents={shellAgents}
            onOpenChange={setSessionSwitcherOpen}
            onSelect={(session) => openRef.current(session)}
          />
          <SettingsDialog
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            onSignIn={signIn}
            notifications={notifications}
            onNotificationsChange={changeNotifications}
            keepAwake={keepAwake}
            onKeepAwakeChange={changeKeepAwake}
            theme={theme}
            onThemeChange={setTheme}
            versionBadge={
              <VersionBadge
                version={version}
                commit={commit}
                built={built}
                release={release}
                onCheck={() => {
                  setSettingsOpen(false);
                  void checkForUpdates();
                }}
              />
            }
            commit={commit}
            built={built}
            repo={repo}
            onCheckForUpdates={() => void checkForUpdates()}
          />
          <Toaster />
        </div>
      </AppContextMenu>
    </TooltipProvider>
  );
}

export default App;
