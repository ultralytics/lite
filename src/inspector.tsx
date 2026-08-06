// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { invoke } from "@tauri-apps/api/core";
import { ChevronRight, File, Folder, GitBranch, RefreshCw, X } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { DirectoryCursor, DirectoryListing, FileEntry, GitStatus, Session } from "@/types";

const CodePreview = lazy(() => import("@/code-preview"));

// Every optional field arrives from Serde as null, never as a missing key.
interface UsageWindow {
  label: string;
  usedPercent: number;
  resetsAt: number | null;
  windowMinutes: number | null;
}

interface UsageSnapshot {
  contextUsedPercent: number | null;
  contextWindow: number | null;
  contextTokens: number | null;
  costUsd: number | null;
  lifetimeTokens: number | null;
  windows: UsageWindow[];
}

const formatNumber = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

function Loading({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
      <Spinner className="size-3.5" />
      {label}
    </div>
  );
}

function Meter({ value }: { value: number }) {
  const bounded = Math.max(0, Math.min(100, value));
  return (
    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
      <div
        className={`h-full rounded-full transition-[width] ${bounded >= 90 ? "bg-destructive" : "bg-foreground"}`}
        style={{ width: `${bounded}%` }}
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
    if (!listing) return loadingPaths.has(path) ? <Loading label="Reading folder…" /> : null;
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
        <div className="flex h-9 shrink-0 items-center gap-2 border-b px-2">
          <File className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-mono text-xs">{selected.name}</span>
          <Button variant="ghost" size="icon-xs" onClick={() => setSelected(null)} aria-label="Close file">
            <X />
          </Button>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          {error ? (
            <div className="p-3 text-xs text-muted-foreground">{error}</div>
          ) : (
            <Suspense fallback={<Loading label="Opening file…" />}>
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
  const [reading, setReading] = useState(false);

  const refresh = useCallback(async () => {
    setError("");
    setReading(true);
    try {
      setStatus(await invoke<GitStatus | null>("git_status", { rootId }));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setReading(false);
    }
  }, [rootId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b px-3 text-xs">
        <span className="font-medium">Repository</span>
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={reading}
          onClick={() => void refresh()}
          aria-label="Refresh Git status"
        >
          {reading ? <Spinner /> : <RefreshCw />}
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-3 text-xs">
          {error ? (
            <p className="text-destructive">{error}</p>
          ) : status === undefined ? (
            <Loading label="Reading Git status…" />
          ) : status === null ? (
            <p className="text-muted-foreground">This folder is not a Git repository.</p>
          ) : (
            <>
              <div className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <GitBranch className="size-3.5 shrink-0" />
                  <span className="truncate font-mono font-medium">{status.branch}</span>
                </div>
                <p className="truncate font-mono text-muted-foreground" title={status.worktree}>
                  {status.worktree}
                </p>
                <Badge variant={status.changes.length ? "secondary" : "outline"}>
                  {status.changes.length
                    ? `${status.changes.length}${status.changesTruncated ? "+" : ""} changed`
                    : "Clean"}
                </Badge>
              </div>
              {status.changes.length ? (
                <div className="mt-4">
                  <p className="mb-2 font-medium">Changes</p>
                  {status.changes.map((change) => (
                    <div key={change} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted">
                      <span className="w-5 shrink-0 font-mono text-[11px] text-muted-foreground">
                        {change.slice(0, 2).trim()}
                      </span>
                      <span className="truncate font-mono" title={change.slice(3)}>
                        {change.slice(3)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// Each harness and provider reports what it reports; Lite never fills the gap with a number of its own.
function missingUsage(session: Session): string {
  if (session.agent === "shell") return "Shell sessions report no provider usage.";
  if (session.agent === "kimi") return "Kimi Code keeps session usage inside its own terminal view.";
  if (session.agent === "codex" && session.provider === "deepseek")
    return "DeepSeek publishes no account limits locally. Codex reports this session's usage in the terminal.";
  if (session.agent === "claude") return "Usage appears after Claude reports its first update.";
  return "This provider reports no usage locally.";
}

function UsagePanel({ session }: { session: Session }) {
  const [usage, setUsage] = useState<UsageSnapshot | null>();
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);

  const refresh = useCallback(async () => {
    setError("");
    setReading(true);
    try {
      setUsage(
        await invoke<UsageSnapshot | null>("read_usage", {
          agent: session.agent,
          provider: session.provider,
          sessionId: session.id,
        }),
      );
    } catch (reason) {
      setError(String(reason));
    } finally {
      setReading(false);
    }
  }, [session.agent, session.provider, session.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b px-3 text-xs">
        <span className="font-medium">Usage</span>
        {session.agent === "shell" ? null : (
          <Button
            variant="ghost"
            size="icon-xs"
            disabled={reading}
            onClick={() => void refresh()}
            aria-label="Refresh usage"
          >
            {reading ? <Spinner /> : <RefreshCw />}
          </Button>
        )}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 p-3 text-xs">
          {error ? (
            <p className="text-destructive">{error}</p>
          ) : usage === undefined ? (
            <Loading label="Reading provider usage…" />
          ) : usage === null ? (
            <p className="text-muted-foreground">{missingUsage(session)}</p>
          ) : (
            <>
              {usage.contextUsedPercent != null ? (
                <div className="rounded-lg border p-3">
                  <div className="flex justify-between">
                    <span>Session context</span>
                    <span className="tabular-nums">{usage.contextUsedPercent.toFixed(0)}%</span>
                  </div>
                  <Meter value={usage.contextUsedPercent} />
                  {usage.contextTokens != null ? (
                    <p className="mt-2 text-muted-foreground tabular-nums">
                      {formatNumber.format(usage.contextTokens)}
                      {usage.contextWindow ? ` of ${formatNumber.format(usage.contextWindow)}` : ""} tokens
                    </p>
                  ) : null}
                  {usage.costUsd != null ? (
                    <p className="mt-1 text-muted-foreground tabular-nums">${usage.costUsd.toFixed(2)} session cost</p>
                  ) : null}
                </div>
              ) : (
                <p className="text-muted-foreground">
                  {session.agent === "codex" ? "The Codex CLI" : "This provider"} does not report per-session context.
                </p>
              )}
              {usage.windows.map((window) => (
                <div key={`${window.label}-${window.windowMinutes ?? ""}`} className="rounded-lg border p-3">
                  <div className="flex justify-between gap-2">
                    <span className="truncate">{window.label}</span>
                    <span className="tabular-nums">{window.usedPercent.toFixed(0)}%</span>
                  </div>
                  <Meter value={window.usedPercent} />
                  {window.resetsAt != null ? (
                    <p className="mt-2 text-muted-foreground">
                      Resets {new Date(window.resetsAt * 1000).toLocaleString()}
                    </p>
                  ) : null}
                </div>
              ))}
              {usage.lifetimeTokens != null ? (
                <div className="rounded-lg border p-3">
                  <p className="text-muted-foreground">Provider total</p>
                  <p className="mt-1 text-lg font-medium tabular-nums">
                    {formatNumber.format(usage.lifetimeTokens)} tokens
                  </p>
                </div>
              ) : null}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

export function Inspector({ session }: { session: Session }) {
  return (
    <Tabs defaultValue="files" className="h-full min-h-0 gap-0">
      <div className="flex h-11 shrink-0 items-center border-b px-3">
        <TabsList variant="line" className="h-8 gap-4">
          <TabsTrigger value="files" className="px-0 text-xs">
            Files
          </TabsTrigger>
          <TabsTrigger value="git" className="px-0 text-xs">
            Git
          </TabsTrigger>
          <TabsTrigger value="usage" className="px-0 text-xs">
            Usage
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="files" className="min-h-0 overflow-hidden">
        <FilesPanel root={session.cwd} rootId={session.rootId} />
      </TabsContent>
      <TabsContent value="git" className="min-h-0 overflow-hidden">
        <GitPanel rootId={session.rootId} />
      </TabsContent>
      <TabsContent value="usage" className="min-h-0 overflow-hidden">
        <UsagePanel session={session} />
      </TabsContent>
    </Tabs>
  );
}
