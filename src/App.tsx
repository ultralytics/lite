// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  ClipboardPaste,
  Copy,
  ExternalLink,
  GitBranch,
  KeyRound,
  Link,
  Moon,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Scissors,
  Search,
  SquareTerminal,
  Sun,
  TextSelect,
  Trash2,
  X,
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

import { LiteLogomark, ProviderIcon } from "@/brand-icons";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Item, ItemActions, ItemMedia } from "@/components/ui/item";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import {
  type PanelImperativeHandle,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Toaster, toast } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { clearUsageCache, Inspector } from "@/inspector";
import { NewSessionDialog } from "@/new-session-dialog";
import { appendOutput, clearOutput, subscribeOutput, syncTerminalTheme, writeSession } from "@/output-store";
import { SettingsDialog } from "@/settings-dialog";
import { applyTheme, initialTheme, type Theme } from "@/theme";
import { type Agent, type Session, sessionLabel } from "@/types";
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

type Editable = HTMLInputElement | HTMLTextAreaElement | HTMLElement;
type AppMenuContext = {
  collapseFiles: HTMLButtonElement | null;
  collapsePanel: HTMLButtonElement | null;
  collapseSessions: HTMLButtonElement | null;
  directory: HTMLButtonElement | null;
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
};

const EMPTY_MENU_CONTEXT: AppMenuContext = {
  collapseFiles: null,
  collapsePanel: null,
  collapseSessions: null,
  directory: null,
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
  const session = target.closest<HTMLElement>("[data-context-session]");
  const surface = session ? null : target.closest<HTMLElement>("[data-context-surface]");
  const files = target.closest<HTMLElement>("[data-context-files]");
  const selectedText =
    editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement
      ? inputSelection(editable)
      : (window.getSelection()?.toString() ?? "");
  return {
    collapseFiles: files?.querySelector<HTMLButtonElement>("[data-context-collapse-files]") ?? null,
    collapsePanel: surface?.querySelector<HTMLButtonElement>("[data-context-collapse-panel]") ?? null,
    collapseSessions: surface?.querySelector<HTMLButtonElement>("[data-context-collapse-sessions]") ?? null,
    directory,
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
        {(linkGroup || surfaceGroup || sessionsGroup) && editGroup ? <ContextMenuSeparator /> : null}
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

// Three states the sidebar dot tells apart: the terminal is gone, it is up and quiet, or it is up and
// producing output. Color carries the state when motion is suppressed, and animation only reinforces it.
const SESSION_STATUS = {
  disconnected: { dot: "bg-muted-foreground/40", label: "Disconnected" },
  idle: { dot: "bg-success", label: "Connected, idle" },
  working: { dot: "bg-sky-500 animate-pulse motion-reduce:animate-none", label: "Connected, working" },
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
  agent = session.agent,
  active,
  starting,
  working,
}: {
  session: Session;
  agent?: Agent;
  active: boolean;
  starting: boolean;
  working: boolean;
}) {
  const status = SESSION_STATUS[!session.running ? "disconnected" : working ? "working" : "idle"];
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

// The provider's own mark, at the size a page can be about rather than the size a row can carry.
function SessionMark({ session }: { session: Session }) {
  return (
    <EmptyMedia variant="icon" className="size-16 rounded-2xl">
      <ProviderIcon agent={session.agent} provider={session.provider} className="size-8" />
    </EmptyMedia>
  );
}

function SessionRow({
  session,
  agent,
  active,
  starting,
  working,
  renaming,
  onSelect,
  onRename,
  onRenamingChange,
  onRestart,
  onClose,
}: {
  session: Session;
  agent?: Agent;
  active: boolean;
  starting: boolean;
  working: boolean;
  renaming: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onRenamingChange: (renaming: boolean) => void;
  onRestart: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(session.name);

  function saveName() {
    const next = name.trim();
    if (next) onRename(next);
    else setName(session.name);
    onRenamingChange(false);
  }

  return (
    <Item
      data-context-session={session.id}
      size="xs"
      onClick={onSelect}
      // Never wrapped: Item wraps by default, and a row narrow enough to push the buttons onto a second
      // line takes the tooltip's anchor out from under the pointer that opened it.
      className={`flex-nowrap transition-[color,background-color,opacity] active:opacity-70 ${active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/60"}`}
    >
      <ItemMedia>
        <SessionBadge session={session} agent={agent} active={active} starting={starting} working={working} />
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
          {/* Only the visible title owns rename; its hit area stops where its text stops. */}
          <button
            type="button"
            className="block w-fit max-w-full truncate text-xs font-medium"
            onClick={(event) => {
              event.stopPropagation();
              if (active && session.running) onRenamingChange(true);
              else onSelect();
            }}
            onDoubleClick={() => onRenamingChange(true)}
          >
            {session.name}
          </button>
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
        <ActionIconButton
          size="icon-sm"
          tooltip="Restart"
          aria-label={`Restart ${session.name}`}
          disabled={starting}
          onClick={onRestart}
        >
          <RotateCcw />
        </ActionIconButton>
        <ActionIconButton
          size="icon-sm"
          className="hover:text-destructive"
          tooltip="Close session"
          aria-label={`Close ${session.name}`}
          disabled={starting}
          onClick={onClose}
        >
          <Trash2 />
        </ActionIconButton>
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
    writeSession(sessionId, `${command}\r`);
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
  return executable === "claude" || executable === "codex" || executable === "kimi" ? executable : undefined;
}

function App() {
  const [sessions, setSessions] = useState<Session[]>(loadSessions);
  const [selectedId, setSelectedId] = useState(() => sessions[0]?.id ?? "");
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [closingAll, setClosingAll] = useState(false);
  const [error, setError] = useState("");
  const [startingIds, setStartingIds] = useState<Set<string>>(new Set());
  // Sessions whose terminal has written something recently, which is what separates a connected
  // session that is working from one that is merely connected.
  const [working, setWorking] = useState<Set<string>>(new Set());
  const [shellAgents, setShellAgents] = useState<Map<string, Agent>>(new Map());
  const [query, setQuery] = useState("");
  const [renamingId, setRenamingId] = useState("");
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
  // The tree a local build came from. A release came from no tree anyone here can see, and says so by
  // leaving this empty.
  const [repo, setRepo] = useState("");
  // A rebuild is running, so the button that started it does not start a second one.
  const [rebuilding, setRebuilding] = useState(false);
  const [release, setRelease] = useState<"checking" | "current" | "behind" | "unknown">("checking");
  const [updateOpen, setUpdateOpen] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("checking");
  const [availableVersion, setAvailableVersion] = useState("");
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);
  const [updateError, setUpdateError] = useState("");
  const updateDialog = useRef<HTMLDivElement>(null);
  const runs = useRef(new Map<string, string>());
  const sessionsRef = useRef(sessions);
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
  sessionsRef.current = sessions;
  themeRef.current = theme;
  selectedRef.current = selected;
  closeRef.current = closeSession;
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
  // A sign-in tab says what it is for and is gone as soon as it is done. And not every title is a
  // subject: a program with nothing of its own to say names the window after itself or after the
  // folder it was started in, which the badge and the tab's own name already say, and taking those
  // would undo the subject a tab had already been given.
  const markTitle = useCallback((sessionId: string, title: string) => {
    setSessions((current) => {
      const session = current.find((item) => item.id === sessionId);
      if (!session || session.mode || session.renamed) return current;
      const name = subject(title);
      if (!name || name === session.name || name === sessionLabel(session) || name === folderName(session.cwd)) {
        return current;
      }
      return current.map((item) => (item.id === sessionId ? { ...item, name } : item));
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
    void Promise.all([
      listen<{ sessionId: string; runId: string; data: number[] }>("pty-output", ({ payload }) => {
        if (runs.current.get(payload.sessionId) !== payload.runId) return;
        const { title, path, activity } = appendOutput(payload.sessionId, payload.data);
        if (title) markTitle(payload.sessionId, title);
        if (path) markDirectory(payload.sessionId, path);
        if (activity !== false) markWorking(payload.sessionId);
      }),
      listen<{ sessionId: string; runId: string }>("pty-exit", ({ payload }) => {
        if (runs.current.get(payload.sessionId) !== payload.runId) return;
        runs.current.delete(payload.sessionId);
        setShellAgents((current) => {
          if (!current.has(payload.sessionId)) return current;
          const next = new Map(current);
          next.delete(payload.sessionId);
          return next;
        });
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
    ]).then(([output, exit, agent]) => {
      if (disposed) {
        output();
        exit();
        agent();
        return;
      }
      unlistenOutput = output;
      unlistenExit = exit;
      unlistenAgent = agent;
    });
    const timers = workTimers.current;
    return () => {
      disposed = true;
      unlistenOutput?.();
      unlistenExit?.();
      unlistenAgent?.();
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
  }, [markDirectory, markWorking, markTitle]);

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
      setSessions((current) => current.map((item) => (item.id === session.id ? { ...item, running: false } : item)));
      setError(String(reason));
    } finally {
      setStartingIds((current) => {
        const next = new Set(current);
        next.delete(session.id);
        return next;
      });
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
    resumed.current = session.id;
    setSessions((current) => [...current, session]);
    setSelectedId(session.id);
    void launch(session, false);
  }

  // Restarting keeps the tab and its folder but asks the provider for a conversation of its own, so the
  // session it resumed by id is forgotten first and the tab takes a new one.
  async function restartSession(session: Session, select = true) {
    runs.current.delete(session.id);
    setSessions((current) => current.map((item) => (item.id === session.id ? { ...item, running: false } : item)));
    await invoke("stop_session", { sessionId: session.id });
    try {
      await invoke("delete_session_data", { sessionId: session.id });
    } catch (reason) {
      setError(String(reason));
    }
    clearOutput(session.id);
    clearUsageCache(session.id);
    const fresh: Session = { ...session, id: crypto.randomUUID(), providerSessionId: undefined, running: false };
    setSessions((current) => current.map((item) => (item.id === session.id ? fresh : item)));
    if (select) {
      setSelectedId(fresh.id);
      resumed.current = fresh.id;
    }
    await launch(fresh, false);
    if (fresh.agent === "kimi") startKimiConversation(fresh.id);
  }

  async function restartAllSessions() {
    await Promise.all(sessions.map((session) => restartSession(session, session.id === selectedId)));
  }

  async function cleanupSession(session: Session) {
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
    clearUsageCache(session.id);
    if (cleanupError) setError(`Session closed, but local cleanup failed: ${cleanupError}`);
  }

  // Closing a session is reversible: the row leaves immediately and its PTY stops, while the
  // provider session metadata and directory grant remain until the toast closes without being undone.
  function closeSession(session: Session) {
    const index = sessions.findIndex((item) => item.id === session.id);
    const wasSelected = selectedId === session.id;
    const nextSelectedId = sessions.find((item) => item.id !== session.id)?.id ?? "";
    const runId = runs.current.get(session.id);
    runs.current.delete(session.id);
    if (resumed.current === session.id) resumed.current = "";
    const timer = workTimers.current.get(session.id);
    if (timer) window.clearTimeout(timer);
    workTimers.current.delete(session.id);
    setWorking((current) => {
      const next = new Set(current);
      next.delete(session.id);
      return next;
    });
    setSessions((current) => current.filter((item) => item.id !== session.id));
    if (wasSelected) setSelectedId(nextSelectedId);

    let undone = false;
    let toastId = "";
    function restore(running: boolean) {
      setSessions((current) => {
        if (current.some((item) => item.id === session.id)) return current;
        const restored = [...current];
        restored.splice(Math.min(index, restored.length), 0, { ...session, running });
        return restored;
      });
      if (wasSelected) setSelectedId((current) => (current === nextSelectedId ? session.id : current));
    }
    const stopped = invoke("stop_session", { sessionId: session.id }).then(
      () => true,
      (reason) => {
        undone = true;
        if (runId) {
          runs.current.set(session.id, runId);
          resumed.current = session.id;
        }
        restore(session.running);
        setError(`Session could not be closed: ${String(reason)}`);
        toast.close(toastId);
        return false;
      },
    );
    toastId = toast.add({
      title: `Closed “${session.name}”`,
      type: "success",
      timeout: 8000,
      onClose: async () => {
        if ((await stopped) && !undone) await cleanupSession(session);
      },
      actionProps: {
        children: "Undo",
        onClick: async () => {
          undone = true;
          if (await stopped) restore(false);
        },
      },
    });
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
      runOnStart(session.id, "bun run local");
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
        onRestartAll={() => void restartAllSessions()}
        onCloseAll={() => setClosingAll(true)}
      >
        <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
          {/* The window buttons sit inside this bar on macOS, so it doubles as the title bar and drags the window. */}
          <header
            data-tauri-drag-region
            className="flex h-9 shrink-0 items-center gap-2 border-b bg-sidebar px-3 text-sidebar-foreground in-data-[titlebar=overlay]:pl-[86px]"
          >
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Lite on GitHub"
                    data-context-url="https://github.com/ultralytics/lite"
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
                <ProviderIcon agent={shellAgents.get(selected.id) ?? selected.agent} provider={selected.provider} />
                <span className="min-w-0 truncate text-xs font-medium">{selected.name}</span>
                <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">{selected.cwd}</span>
                {remote ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="sm"
                          className="max-w-56 gap-1.5 text-muted-foreground"
                          data-context-url={remote}
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
              <aside data-context-surface className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
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
                                aria-label={session.name}
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
                      <div className="space-y-0.5 px-2 pb-2">
                        {query && !visible.length ? (
                          <p className="px-2 py-1.5 text-xs text-muted-foreground">No session matches “{query}”.</p>
                        ) : null}
                        {visible.map((session) => (
                          <SessionRow
                            key={session.id}
                            session={session}
                            agent={shellAgents.get(session.id)}
                            active={session.id === selectedId}
                            starting={startingIds.has(session.id)}
                            working={working.has(session.id)}
                            renaming={renamingId === session.id}
                            onSelect={() => openRef.current(session)}
                            onRename={(name) =>
                              setSessions((current) =>
                                current.map((item) =>
                                  item.id === session.id ? { ...item, name, renamed: true } : item,
                                ),
                              )
                            }
                            onRenamingChange={(renaming) => setRenamingId(renaming ? session.id : "")}
                            onRestart={() => void restartSession(session)}
                            onClose={() => closeSession(session)}
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
                              theme={theme}
                              active={selected.running && session.id === selectedId}
                              onPrompt={(text) => {
                                const agent = session.agent === "shell" ? commandAgent(text) : undefined;
                                if (agent)
                                  void invoke("watch_shell_agent", { sessionId: session.id, agent }).catch((reason) =>
                                    console.error(`Lite could not follow the agent in session ${session.id}:`, reason),
                                  );
                                setSessions((current) =>
                                  current.map((item) =>
                                    item.id === session.id && !item.renamed && item.name === folderName(item.cwd)
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
                      <ActionIconButton
                        variant="outline"
                        size="icon-sm"
                        className="absolute top-2 right-2 z-10 hidden bg-background/90 hover:text-destructive"
                        tooltip="Close session"
                        tooltipSide="left"
                        aria-label={`Close ${selected.name}`}
                        data-terminal-action
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => closeSession(selected)}
                      >
                        <Trash2 />
                      </ActionIconButton>
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
                  <aside className="h-full border-l">
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
              className="sm:max-w-lg"
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
                    ? `This build is ${commit} and the tree is now ${availableVersion}. Rebuilding runs bun run local in a shell tab, and replaces this build when it finishes.`
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
                    <ProgressLabel>Downloading update</ProgressLabel>
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
          <Dialog open={closingAll} onOpenChange={setClosingAll}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Close all sessions?</DialogTitle>
                <DialogDescription>
                  This stops every running session and removes all tabs. Providers keep their own conversation history.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setClosingAll(false)}>
                  Keep
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    void Promise.all(
                      sessions.map(async (session) => {
                        runs.current.delete(session.id);
                        await invoke("stop_session", { sessionId: session.id });
                        await cleanupSession(session);
                        setSessions((current) => current.filter((item) => item.id !== session.id));
                        if (selectedId === session.id)
                          setSelectedId(sessions.find((item) => item.id !== session.id)?.id ?? "");
                      }),
                    ).then(() => {
                      setSelectedId("");
                    });
                    setClosingAll(false);
                  }}
                >
                  Close all sessions
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <NewSessionDialog open={newSessionOpen} onOpenChange={setNewSessionOpen} onCreate={createSession} />
          <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} onSignIn={signIn} />
          <Toaster />
        </div>
      </AppContextMenu>
    </TooltipProvider>
  );
}

export default App;
