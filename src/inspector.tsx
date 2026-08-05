// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronRight, File, FileCode2, Folder, FolderTree, Gauge, GitBranch, RefreshCw, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DirectoryCursor, DirectoryListing, FileEntry, GitStatus, Session } from "@/types";

const CodePreview = lazy(() => import("@/code-preview"));

interface UsageWindow {
  label: string;
  usedPercent: number;
  resetsAt?: number;
  windowMinutes?: number;
}

interface UsageSnapshot {
  contextUsedPercent?: number;
  contextWindow?: number;
  contextTokens?: number;
  costUsd?: number;
  lifetimeTokens?: number;
  windows: UsageWindow[];
}

const formatNumber = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

function Meter({ value }: { value: number }) {
  return (
    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-foreground transition-[width]"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

function FileTree({ root, rootId, onOpen }: { root: string; rootId: string; onOpen: (entry: FileEntry) => void }) {
  const [children, setChildren] = useState<Record<string, DirectoryListing & { after: DirectoryCursor | null }>>({});
  const [expanded, setExpanded] = useState(() => new Set<string>());
  const loading = useRef(new Set<string>());
  const [loadingPaths, setLoadingPaths] = useState(() => new Set<string>());

  const load = useCallback(
    async (path: string, after: DirectoryCursor | null = null) => {
      if (loading.current.has(path)) return;
      loading.current.add(path);
      setLoadingPaths((current) => new Set(current).add(path));
      try {
        const listing = await invoke<DirectoryListing>("list_directory", { rootId, path, after });
        setChildren((current) => ({ ...current, [path]: { ...listing, after } }));
      } finally {
        loading.current.delete(path);
        setLoadingPaths((current) => {
          const next = new Set(current);
          next.delete(path);
          return next;
        });
      }
    },
    [rootId],
  );

  async function toggle(path: string) {
    const next = new Set(expanded);
    if (next.has(path)) next.delete(path);
    else {
      next.add(path);
      if (!children[path]) await load(path);
    }
    setExpanded(next);
  }

  function rows(path: string, depth = 0): React.ReactNode {
    const listing = children[path];
    if (!listing) return null;
    return (
      <>
        {listing.entries.map((entry) => (
          <div key={entry.path}>
            <button
              type="button"
              className="flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-left text-xs hover:bg-muted"
              style={{ paddingLeft: `${8 + depth * 14}px` }}
              onClick={() => (entry.isDirectory ? void toggle(entry.path) : onOpen(entry))}
            >
              {entry.isDirectory ? (
                <>
                  <ChevronRight
                    className={`size-3.5 text-muted-foreground transition-transform ${expanded.has(entry.path) ? "rotate-90" : ""}`}
                  />
                  <Folder className="size-3.5 fill-current text-muted-foreground" />
                </>
              ) : (
                <>
                  <span className="w-3.5" />
                  <File className="size-3.5 text-muted-foreground" />
                </>
              )}
              <span className="truncate">{entry.name}</span>
            </button>
            {entry.isDirectory && expanded.has(entry.path) ? rows(entry.path, depth + 1) : null}
          </div>
        ))}
        {listing.after || listing.nextCursor ? (
          <div className="flex h-7 items-center gap-3 pr-2 text-xs" style={{ paddingLeft: `${30 + depth * 14}px` }}>
            {listing.after ? (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => void load(path)}
              >
                First page
              </button>
            ) : null}
            {listing.nextCursor ? (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                disabled={loadingPaths.has(path)}
                onClick={() => void load(path, listing.nextCursor)}
              >
                Next 250…
              </button>
            ) : null}
          </div>
        ) : null}
      </>
    );
  }

  const parts = root.split(/[\\/]/).filter(Boolean);
  const name = parts[parts.length - 1] ?? root;
  return (
    <div className="py-2">
      <button
        type="button"
        className="flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-xs font-medium hover:bg-muted"
        onClick={() => void toggle(root)}
      >
        <ChevronRight
          className={`size-3.5 text-muted-foreground transition-transform ${expanded.has(root) ? "rotate-90" : ""}`}
        />
        <Folder className="size-3.5 fill-current text-muted-foreground" />
        <span className="truncate">{name}</span>
      </button>
      {expanded.has(root) ? rows(root, 1) : null}
    </div>
  );
}

function FilesPanel({ root, rootId }: { root: string; rootId: string }) {
  const [selected, setSelected] = useState<FileEntry | null>(null);
  const [source, setSource] = useState("");
  const [error, setError] = useState("");

  async function openFile(entry: FileEntry) {
    setSelected(entry);
    setError("");
    try {
      setSource(await invoke<string>("read_text_file", { rootId, path: entry.path }));
    } catch (reason) {
      setSource("");
      setError(String(reason));
    }
  }

  if (selected) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b px-2">
          <FileCode2 className="size-4 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-xs font-medium">{selected.name}</span>
          <Button variant="ghost" size="icon-xs" onClick={() => setSelected(null)} aria-label="Close file">
            <X />
          </Button>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          {error ? (
            <div className="p-4 text-xs text-muted-foreground">{error}</div>
          ) : (
            <Suspense fallback={<div className="p-4 text-xs text-muted-foreground">Opening file…</div>}>
              <CodePreview path={selected.path} source={source} />
            </Suspense>
          )}
        </ScrollArea>
      </div>
    );
  }
  return (
    <ScrollArea className="h-full">
      <FileTree root={root} rootId={rootId} onOpen={(entry) => void openFile(entry)} />
    </ScrollArea>
  );
}

function GitPanel({ rootId }: { rootId: string }) {
  const [status, setStatus] = useState<GitStatus | null>();
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    try {
      setStatus(await invoke<GitStatus | null>("git_status", { rootId }));
    } catch (reason) {
      setError(String(reason));
    }
  }, [rootId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="h-full overflow-auto p-3 text-xs">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-medium">Repository</span>
        <Button variant="ghost" size="icon-xs" onClick={() => void refresh()} aria-label="Refresh Git status">
          <RefreshCw />
        </Button>
      </div>
      {error ? (
        <p className="text-destructive">{error}</p>
      ) : status === null ? (
        <p className="text-muted-foreground">This folder is not a Git repository.</p>
      ) : status === undefined ? (
        <p className="text-muted-foreground">Reading Git status…</p>
      ) : (
        <>
          <div className="space-y-2 rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <GitBranch className="size-3.5" />
              <span className="truncate font-medium">{status.branch}</span>
            </div>
            <p className="truncate text-muted-foreground" title={status.worktree}>
              {status.worktree}
            </p>
            <Badge variant={status.changes.length ? "secondary" : "outline"}>
              {status.changes.length
                ? `${status.changes.length}${status.changesTruncated ? "+" : ""} changed`
                : "Clean"}
            </Badge>
          </div>
          {status.changes.length ? (
            <div className="mt-4 space-y-1">
              <p className="mb-2 font-medium">Changes</p>
              {status.changes.map((change) => (
                <div key={change} className="truncate rounded-md px-2 py-1.5 hover:bg-muted">
                  {change}
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function UsagePanel({ session }: { session: Session }) {
  const [usage, setUsage] = useState<UsageSnapshot | null>();
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    if (session.agent === "shell") {
      setUsage(null);
      return;
    }
    try {
      setUsage(
        await invoke<UsageSnapshot | null>("read_usage", {
          agent: session.agent,
          sessionId: session.id,
        }),
      );
    } catch (reason) {
      setError(String(reason));
    }
  }, [session.agent, session.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="space-y-4 p-3 text-xs">
      <div className="flex items-center justify-between">
        <p className="font-medium">Usage</p>
        {session.agent !== "shell" ? (
          <Button variant="ghost" size="icon-xs" onClick={() => void refresh()} aria-label="Refresh usage">
            <RefreshCw />
          </Button>
        ) : null}
      </div>
      {error ? (
        <p className="text-destructive">{error}</p>
      ) : session.agent === "shell" ? (
        <div className="rounded-lg border p-3 text-muted-foreground">Usage is not available for shell sessions.</div>
      ) : usage === undefined ? (
        <p className="text-muted-foreground">Reading provider usage…</p>
      ) : usage === null ? (
        <div className="rounded-lg border p-3 text-muted-foreground">
          Available after the first {session.agent === "claude" ? "Claude response" : "provider update"}.
        </div>
      ) : (
        <>
          {usage.contextUsedPercent !== undefined ? (
            <div className="rounded-lg border p-3">
              <div className="flex justify-between">
                <span>Session context</span>
                <span className="tabular-nums">{usage.contextUsedPercent.toFixed(0)}%</span>
              </div>
              <Meter value={usage.contextUsedPercent} />
              {usage.contextTokens !== undefined ? (
                <p className="mt-2 text-muted-foreground">
                  {formatNumber.format(usage.contextTokens)}
                  {usage.contextWindow ? ` of ${formatNumber.format(usage.contextWindow)}` : ""} tokens
                </p>
              ) : null}
              {usage.costUsd !== undefined ? (
                <p className="mt-1 text-muted-foreground">${usage.costUsd.toFixed(2)} session cost</p>
              ) : null}
            </div>
          ) : (
            <div className="rounded-lg border p-3 text-muted-foreground">
              Per-session context is not reported by the {session.agent === "codex" ? "Codex CLI" : "provider yet"}.
            </div>
          )}
          {usage.lifetimeTokens !== undefined ? (
            <div className="rounded-lg border p-3">
              <p>Provider total</p>
              <p className="mt-1 text-lg font-medium tabular-nums">
                {formatNumber.format(usage.lifetimeTokens)} tokens
              </p>
            </div>
          ) : null}
          {usage.windows.map((window) => (
            <div key={`${window.label}-${window.windowMinutes ?? ""}`} className="rounded-lg border p-3">
              <div className="flex justify-between gap-2">
                <span className="truncate">{window.label}</span>
                <span className="tabular-nums">{window.usedPercent.toFixed(0)}%</span>
              </div>
              <Meter value={window.usedPercent} />
              {window.resetsAt ? (
                <p className="mt-2 text-muted-foreground">Resets {new Date(window.resetsAt * 1000).toLocaleString()}</p>
              ) : null}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export function Inspector({ session }: { session: Session }) {
  return (
    <Tabs defaultValue="files" className="h-full gap-0">
      <div className="flex h-11 shrink-0 items-center border-b px-2">
        <TabsList variant="line" className="h-8">
          <Tooltip>
            <TooltipTrigger render={<TabsTrigger value="files" className="size-8" aria-label="Files" />}>
              <FolderTree />
            </TooltipTrigger>
            <TooltipContent>Files and code preview</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger render={<TabsTrigger value="git" className="size-8" aria-label="Git" />}>
              <GitBranch />
            </TooltipTrigger>
            <TooltipContent>Git branch and changes</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger render={<TabsTrigger value="usage" className="size-8" aria-label="Usage" />}>
              <Gauge />
            </TooltipTrigger>
            <TooltipContent>Context and usage limits</TooltipContent>
          </Tooltip>
        </TabsList>
      </div>
      <TabsContent value="files" className="min-h-0 overflow-hidden">
        <FilesPanel root={session.cwd} rootId={session.rootId} />
      </TabsContent>
      <TabsContent value="git" className="min-h-0 overflow-hidden">
        <GitPanel rootId={session.rootId} />
      </TabsContent>
      <TabsContent value="usage" className="min-h-0 overflow-auto">
        <UsagePanel session={session} />
      </TabsContent>
    </Tabs>
  );
}
