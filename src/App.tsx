// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Moon, MoreHorizontal, Plus, RotateCcw, SquareTerminal, Sun, X } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";

import { ClaudeLogomark, LiteLogomark, OpenAILogomark } from "@/brand-icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Inspector } from "@/inspector";
import { NewSessionDialog } from "@/new-session-dialog";
import { appendOutput, clearOutput } from "@/output-store";
import type { Session } from "@/types";
import "./App.css";

const STORAGE_KEY = "lite.sessions.v1";
const THEME_KEY = "lite.theme";
const TerminalView = lazy(() => import("@/terminal").then((module) => ({ default: module.TerminalView })));

function loadSessions(): Session[] {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as Session[];
    return stored.filter((session) => session.rootId).map((session) => ({ ...session, running: false }));
  } catch {
    return [];
  }
}

function ProviderIcon({ agent }: Pick<Session, "agent">) {
  if (agent === "claude") return <ClaudeLogomark className="size-4" />;
  if (agent === "codex") return <OpenAILogomark className="size-4" />;
  return <SquareTerminal className="size-4" />;
}

export function initialTheme(): "light" | "dark" {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
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
      className={`group flex items-center gap-1 rounded-lg pr-1 ${active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/70"}`}
    >
      {renaming ? (
        <div className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-2">
          <span className="relative flex size-7 shrink-0 items-center justify-center rounded-md border bg-background">
            <ProviderIcon agent={session.agent} />
          </span>
          <span className="min-w-0 flex-1">
            <Input
              autoFocus
              value={name}
              className="h-6 px-1.5 text-xs"
              onChange={(event) => setName(event.target.value)}
              onBlur={saveName}
              onKeyDown={(event) => {
                if (event.key === "Enter") saveName();
              }}
            />
            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{session.cwd}</span>
          </span>
        </div>
      ) : (
        <button
          type="button"
          onClick={onSelect}
          className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-2 text-left"
        >
          <span className="relative flex size-7 shrink-0 items-center justify-center rounded-md border bg-background">
            <ProviderIcon agent={session.agent} />
            <span
              className={`absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-sidebar ${session.running ? "bg-emerald-500" : "bg-muted-foreground/50"}`}
            />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium">{session.name}</span>
            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{session.cwd}</span>
          </span>
        </button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={starting}
              className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
              aria-label="Session actions"
            />
          }
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-36">
          <DropdownMenuItem onClick={() => setRenaming(true)}>Rename</DropdownMenuItem>
          <DropdownMenuItem onClick={onRestart}>
            <RotateCcw />
            Restart
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={onClose}>
            <X />
            Close
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function App() {
  const [sessions, setSessions] = useState<Session[]>(loadSessions);
  const [selectedId, setSelectedId] = useState(() => sessions[0]?.id ?? "");
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [error, setError] = useState("");
  const [startingIds, setStartingIds] = useState<Set<string>>(new Set());
  const [theme, setTheme] = useState<"light" | "dark">(initialTheme);
  const runs = useRef(new Map<string, string>());
  const selected = useMemo(() => sessions.find((session) => session.id === selectedId), [sessions, selectedId]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.map((session) => ({ ...session, running: false }))));
  }, [sessions]);

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

  async function launch(session: Session, resume: boolean) {
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
  }

  function createSession(session: Session) {
    setSessions((current) => [...current, session]);
    setSelectedId(session.id);
    void launch(session, false);
  }

  function selectSession(session: Session) {
    setSelectedId(session.id);
    if (!session.running) void launch(session, true);
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

  return (
    <TooltipProvider>
      <main className="h-screen overflow-hidden bg-background text-foreground">
        <ResizablePanelGroup orientation="horizontal">
          <ResizablePanel defaultSize="18%" minSize="14%" maxSize="26%">
            <aside className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
              <div className="flex h-12 items-center gap-2 border-b border-sidebar-border px-3">
                <LiteLogomark className="size-6" />
                <span className="text-sm font-semibold">Lite</span>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="relative ml-auto"
                        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                        aria-label="Toggle theme"
                      />
                    }
                  >
                    <Sun className="size-4 rotate-0 scale-100 transition-transform motion-reduce:transition-none dark:-rotate-90 dark:scale-0" />
                    <Moon className="absolute size-4 rotate-90 scale-0 transition-transform motion-reduce:transition-none dark:rotate-0 dark:scale-100" />
                  </TooltipTrigger>
                  <TooltipContent>{theme === "dark" ? "Light mode" : "Dark mode"}</TooltipContent>
                </Tooltip>
              </div>
              <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-1 p-2">
                  {sessions.map((session) => (
                    <SessionRow
                      key={session.id}
                      session={session}
                      active={session.id === selectedId}
                      starting={startingIds.has(session.id)}
                      onSelect={() => selectSession(session)}
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
              <div className="border-t border-sidebar-border p-2">
                <Button variant="ghost" className="w-full justify-start" onClick={() => setNewSessionOpen(true)}>
                  <Plus />
                  New session
                </Button>
              </div>
            </aside>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize="57%" minSize="38%">
            <section className="flex h-full min-w-0 flex-col">
              {selected ? (
                <>
                  <header className="flex h-11 shrink-0 items-center gap-3 border-b px-3">
                    <ProviderIcon agent={selected.agent} />
                    <span className="truncate text-xs font-medium">{selected.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{selected.cwd}</span>
                  </header>
                  <div className="min-h-0 flex-1 bg-[#0d0d0d]">
                    {selected.running ? (
                      <Suspense fallback={<div className="h-full bg-[#0d0d0d]" />}>
                        <TerminalView sessionId={selected.id} />
                      </Suspense>
                    ) : startingIds.has(selected.id) ? (
                      <div className="flex h-full items-center justify-center text-sm text-zinc-400">Starting…</div>
                    ) : (
                      <button
                        type="button"
                        className="flex h-full w-full flex-col items-center justify-center gap-3 text-zinc-400"
                        onClick={() => void launch(selected, true)}
                      >
                        <RotateCcw className="size-5" />
                        <span className="text-sm">Resume session</span>
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                  <div className="flex size-12 items-center justify-center rounded-2xl border bg-muted">
                    <SquareTerminal className="size-5" />
                  </div>
                  <div>
                    <h1 className="text-sm font-medium">Start light</h1>
                    <p className="mt-1 text-xs text-muted-foreground">Choose a folder and open your first session.</p>
                  </div>
                  <Button onClick={() => setNewSessionOpen(true)}>
                    <Plus />
                    New session
                  </Button>
                </div>
              )}
              {error ? (
                <div className="border-t bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>
              ) : null}
            </section>
          </ResizablePanel>
          {selected ? (
            <>
              <ResizableHandle />
              <ResizablePanel defaultSize="25%" minSize="18%" maxSize="40%">
                <aside className="h-full">
                  <Inspector key={selected.id} session={selected} />
                </aside>
              </ResizablePanel>
            </>
          ) : null}
        </ResizablePanelGroup>
        <NewSessionDialog open={newSessionOpen} onOpenChange={setNewSessionOpen} onCreate={createSession} />
      </main>
    </TooltipProvider>
  );
}

export default App;
