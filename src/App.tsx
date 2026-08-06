// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  KeyRound,
  Moon,
  MoreHorizontal,
  Plus,
  RefreshCw,
  RotateCcw,
  SquareTerminal,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import { Component, lazy, type ReactNode, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { LiteLogomark, ProviderIcon } from "@/brand-icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
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
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Inspector } from "@/inspector";
import { NewSessionDialog } from "@/new-session-dialog";
import { appendOutput, clearOutput } from "@/output-store";
import { SettingsDialog } from "@/settings-dialog";
import { applyTheme, initialTheme, type Theme } from "@/theme";
import { type Session, sessionLabel } from "@/types";
import "./App.css";

const STORAGE_KEY = "lite.sessions.v1";
const TerminalView = lazy(() => import("@/terminal").then((module) => ({ default: module.TerminalView })));
type UpdateStatus = "checking" | "available" | "current" | "installing" | "error";

function loadSessions(): Session[] {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as Session[];
    return stored.filter((session) => session.rootId).map((session) => ({ ...session, running: false }));
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

function SessionRow({
  session,
  active,
  starting,
  onSelect,
  onRename,
  onRestart,
  onClose,
}: {
  session: Session;
  active: boolean;
  starting: boolean;
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
        <span className="relative flex size-7 shrink-0 items-center justify-center rounded-md border bg-background">
          <ProviderIcon agent={session.agent} provider={session.provider} />
          {starting ? (
            <Spinner
              className={`absolute -right-1 -bottom-1 size-3 rounded-full bg-background text-muted-foreground ring-2 ${active ? "ring-sidebar-accent" : "ring-sidebar"}`}
            />
          ) : (
            <span
              role="img"
              className={`absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ${active ? "ring-sidebar-accent" : "ring-sidebar"} ${session.running ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
              aria-label={session.running ? "Running" : "Not running"}
            />
          )}
        </span>
        {renaming ? (
          <span className="min-w-0 flex-1 py-0.5">
            <Input
              autoFocus
              value={name}
              className="h-6 px-1.5 text-xs"
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
          <button
            type="button"
            className="min-w-0 flex-1 py-0.5 text-left"
            onClick={onSelect}
            onDoubleClick={() => setRenaming(true)}
            title={session.cwd}
          >
            <span className="block truncate text-xs font-medium">{session.name}</span>
            <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">{session.cwd}</span>
          </button>
        )}
      </div>
      <span className="flex shrink-0 items-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={starting}
                onClick={onRestart}
                aria-label={`Restart ${session.name}`}
              />
            }
          >
            <RotateCcw />
          </TooltipTrigger>
          <TooltipContent>Restart</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={starting}
                className="hover:text-destructive"
                onClick={onClose}
                aria-label={`Close ${session.name}`}
              />
            }
          >
            <Trash2 />
          </TooltipTrigger>
          <TooltipContent>Close session</TooltipContent>
        </Tooltip>
      </span>
    </div>
  );
}

function App() {
  const [sessions, setSessions] = useState<Session[]>(loadSessions);
  const [selectedId, setSelectedId] = useState(() => sessions[0]?.id ?? "");
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState("");
  const [startingIds, setStartingIds] = useState<Set<string>>(new Set());
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [version, setVersion] = useState("");
  const [updateOpen, setUpdateOpen] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("checking");
  const [availableVersion, setAvailableVersion] = useState("");
  const [updateError, setUpdateError] = useState("");
  const runs = useRef(new Map<string, string>());
  const resumed = useRef("");
  const themeRef = useRef<Theme>("dark");
  const sessionsRef = useRef<Session[]>([]);
  const selectedRef = useRef<Session>(undefined);
  const closeRef = useRef<(session: Session) => void>(() => {});
  const selected = useMemo(() => sessions.find((session) => session.id === selectedId), [sessions, selectedId]);
  sessionsRef.current = sessions;
  themeRef.current = theme;
  selectedRef.current = selected;
  closeRef.current = (session) => void closeSession(session);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // The shortcuts a terminal app is expected to answer. The terminal keeps every key Lite does not claim.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!event.metaKey && !event.ctrlKey) return;
      if (event.key === "n") setNewSessionOpen(true);
      else if (event.key === ",") setSettingsOpen(true);
      else if (event.key === "w" && selectedRef.current) closeRef.current(selectedRef.current);
      else if (event.key >= "1" && event.key <= "9") {
        const target = sessionsRef.current[Number(event.key) - 1];
        if (!target) return;
        setSelectedId(target.id);
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
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlistenOutput: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;
    void Promise.all([
      listen<{ sessionId: string; runId: string; data: number[] }>("pty-output", ({ payload }) => {
        if (runs.current.get(payload.sessionId) === payload.runId) appendOutput(payload.sessionId, payload.data);
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
    return () => {
      disposed = true;
      unlistenOutput?.();
      unlistenExit?.();
    };
  }, []);

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
        name: session.name,
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

  async function restartSession(session: Session) {
    runs.current.delete(session.id);
    setSessions((current) => current.map((item) => (item.id === session.id ? { ...item, running: false } : item)));
    await invoke("stop_session", { sessionId: session.id });
    clearOutput(session.id);
    await launch({ ...session, running: false }, session.agent !== "codex" || Boolean(session.providerSessionId));
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
    setUpdateOpen(true);
    setUpdateStatus("checking");
    setUpdateError("");
    try {
      const next = await invoke<string | null>("check_update");
      setAvailableVersion(next ?? "");
      setUpdateStatus(next ? "available" : "current");
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
          className="flex h-11 shrink-0 items-center gap-2 border-b bg-sidebar px-3 text-sidebar-foreground in-data-[platform=macos]:pl-[86px]"
        >
          <LiteLogomark className="size-5" />
          {selected ? (
            <>
              <Separator orientation="vertical" className="mx-1 h-4" />
              <ProviderIcon agent={selected.agent} provider={selected.provider} />
              <span className="min-w-0 truncate text-xs font-medium">{selected.name}</span>
              <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">{selected.cwd}</span>
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
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Lite menu" />}>
                <MoreHorizontal />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {version ? (
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Lite {version}</DropdownMenuLabel>
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
          <ResizablePanel defaultSize="20%" minSize="15%" maxSize="30%" collapsible collapsedSize="0%">
            <aside className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
              <div className="flex h-9 shrink-0 items-center justify-between pr-1.5 pl-3">
                <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Sessions</span>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => setNewSessionOpen(true)}
                        aria-label="New session"
                      />
                    }
                  >
                    <Plus />
                  </TooltipTrigger>
                  <TooltipContent>New session</TooltipContent>
                </Tooltip>
              </div>
              <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-0.5 px-2 pb-2">
                  {sessions.map((session) => (
                    <SessionRow
                      key={session.id}
                      session={session}
                      active={session.id === selectedId}
                      starting={startingIds.has(session.id)}
                      onSelect={() => setSelectedId(session.id)}
                      onRename={(name) =>
                        setSessions((current) =>
                          current.map((item) => (item.id === session.id ? { ...item, name } : item)),
                        )
                      }
                      onRestart={() => void restartSession(session)}
                      onClose={() => void closeSession(session)}
                    />
                  ))}
                </div>
              </ScrollArea>
            </aside>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize="55%" minSize="38%">
            <section className="flex h-full min-w-0 flex-col">
              {selected ? (
                <div className="min-h-0 flex-1">
                  {selected.running ? (
                    <Suspense fallback={<div className="h-full bg-background" />}>
                      <TerminalView sessionId={selected.id} theme={theme} />
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
                        <RotateCcw />
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
                      Pick a project folder and open Claude Code, Codex, or your shell.
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
              <ResizableHandle />
              <ResizablePanel defaultSize="25%" minSize="18%" maxSize="40%">
                <aside className="h-full border-l">
                  <PanelBoundary key={selected.id}>
                    <Inspector session={selected} />
                  </PanelBoundary>
                </aside>
              </ResizablePanel>
            </>
          ) : null}
        </ResizablePanelGroup>
        <Dialog open={updateOpen} onOpenChange={changeUpdateOpen}>
          <DialogContent showCloseButton={updateStatus !== "checking" && updateStatus !== "installing"}>
            <DialogHeader>
              <DialogTitle>Lite updates</DialogTitle>
              <DialogDescription aria-live="polite">
                {updateStatus === "checking" ? "Checking GitHub for the latest release…" : null}
                {updateStatus === "available"
                  ? `Lite ${availableVersion} is ready. Updating stops running sessions; their tabs resume after restart.`
                  : null}
                {updateStatus === "current" ? "You have the latest version of Lite." : null}
                {updateStatus === "installing" ? "Downloading and installing the update…" : null}
                {updateStatus === "error" ? `Update failed: ${updateError}` : null}
              </DialogDescription>
            </DialogHeader>
            {updateStatus === "checking" || updateStatus === "installing" ? (
              <Spinner className="mx-auto size-5 text-muted-foreground" />
            ) : null}
            {updateStatus === "available" ? (
              <DialogFooter>
                <Button variant="outline" onClick={() => changeUpdateOpen(false)}>
                  Not now
                </Button>
                <Button onClick={() => void installUpdate()}>Install and restart</Button>
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
        <NewSessionDialog open={newSessionOpen} onOpenChange={setNewSessionOpen} onCreate={createSession} />
        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} onSignIn={signIn} />
      </div>
    </TooltipProvider>
  );
}

export default App;
