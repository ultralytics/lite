// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { invoke } from "@tauri-apps/api/core";
import {
  ChartNoAxesColumn,
  ChevronLeft,
  ChevronRight,
  File,
  Folder,
  GitBranch,
  GitPullRequest,
  RefreshCw,
  X,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { ActionIconButton } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { readOutput } from "@/output-store";
import type { DirectoryCursor, DirectoryListing, FileEntry, GitStatus, Session } from "@/types";

const CodePreview = lazy(() => import("@/code-preview"));

// A session's terminal is the only record of what it worked on, so what it named is read back out of
// the output Lite already keeps. Only what Git and GitHub print verbatim counts: a whole pull request
// link, and the two sentences Git answers a checkout with. A bare "#12" is as often a line number.
// Only CSI is stripped, so a link inside an OSC hyperlink survives being uncoloured.
// biome-ignore lint/suspicious/noControlCharactersInRegex: a color code has to be named to be removed.
const COLOR = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const PULL_REQUEST = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/g;
const BRANCH = /(?:On branch|Switched to(?: a new)? branch) '?([\w./-]+)'?/g;

function namedInSession(sessionId: string) {
  const text = readOutput(sessionId).replace(COLOR, "");
  return {
    branches: [...new Set([...text.matchAll(BRANCH)].map((match) => match[1]))],
    pulls: [...new Set(text.match(PULL_REQUEST) ?? [])],
  };
}

// A pull request is known by its number and the repository it belongs to, not by the URL that reaches it.
function pullLabel(url: string) {
  const [owner, repository, , number] = url.split("/").slice(3);
  return `${owner}/${repository} #${number}`;
}

// One list so a tab, its icon and the name every surface calls it by cannot drift apart, including the
// rail the panel collapses to.
const TABS = [
  { value: "files", label: "Files", icon: Folder },
  { value: "git", label: "Git", icon: GitBranch },
  { value: "usage", label: "Usage", icon: ChartNoAxesColumn },
] as const;

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
  // The root is the folder the session works in; showing it shut asks for a click to say what the
  // panel is already for, so it opens with the tree it was asked to show.
  const [expanded, setExpanded] = useState(() => new Set<string>([root]));
  const loading = useRef(new Set<string>());
  const [loadingPaths, setLoadingPaths] = useState(() => new Set<string>());
  const [error, setError] = useState("");

  const load = useCallback(
    async (path: string, after: DirectoryCursor | null = null) => {
      if (loading.current.has(path)) return;
      loading.current.add(path);
      setLoadingPaths((current) => new Set(current).add(path));
      try {
        const listing = await invoke<DirectoryListing>("list_directory", { rootId, path, after });
        setChildren((current) => ({ ...current, [path]: { ...listing, after } }));
        setError("");
      } catch (reason) {
        // The panel opens its own root now, so a folder that has moved since the session was made says
        // so rather than drawing an empty tree nobody asked for.
        setError(String(reason));
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

  useEffect(() => {
    void load(root);
  }, [load, root]);

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
    if (!listing) {
      if (loadingPaths.has(path)) return <Loading label="Reading folder…" />;
      return error ? <p className="p-3 text-xs text-destructive">{error}</p> : null;
    }
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
          <ActionIconButton
            variant="ghost"
            size="icon-sm"
            tooltip="Close file"
            aria-label="Close file"
            onClick={() => setSelected(null)}
          >
            <X />
          </ActionIconButton>
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
    <div className="flex h-full min-h-0 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <FileTree root={root} rootId={rootId} onOpen={(entry) => void openFile(entry)} />
      </ScrollArea>
    </div>
  );
}

function GitPanel({ rootId, sessionId }: { rootId: string; sessionId: string }) {
  // Read once when the panel is built, like every other thing this panel shows: the refresh button
  // rebuilds it, and nothing here watches the session between those two moments.
  const named = useMemo(() => namedInSession(sessionId), [sessionId]);
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
    <div className="flex h-full min-h-0 flex-col">
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
              <div className="mt-4">
                <p className="mb-2 font-medium">Named in this session</p>
                {named.branches.map((branch) => (
                  <div key={branch} className="flex items-center gap-2 rounded-md px-2 py-1.5">
                    <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate font-mono">{branch}</span>
                  </div>
                ))}
                {named.pulls.map((url) => (
                  <button
                    key={url}
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
                    title={url}
                    onClick={() => void invoke("open_url", { url })}
                  >
                    <GitPullRequest className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate font-mono underline-offset-2 hover:underline">{pullLabel(url)}</span>
                  </button>
                ))}
                {named.branches.length || named.pulls.length ? null : (
                  <p className="px-2 text-muted-foreground">
                    Branches this session checked out and pull request links it printed appear here.
                  </p>
                )}
              </div>
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

  const refresh = useCallback(async () => {
    setError("");
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
    }
  }, [session.agent, session.provider, session.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex h-full min-h-0 flex-col">
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

export function Inspector({
  session,
  collapsed,
  onExpand,
  onCollapse,
}: {
  session: Session;
  collapsed: boolean;
  onExpand: () => void;
  onCollapse: () => void;
}) {
  const [tab, setTab] = useState<string>(TABS[0].value);
  // A tab already names the panel it shows, so the panel does not name itself again. One button beside
  // the tabs rereads whichever is open, by rebuilding it, and only that one ever reads the disk.
  const [reload, setReload] = useState({ files: 0, git: 0, usage: 0 });

  // Collapsed, the panel is the strip of tabs it collapsed from: the one you pick is the one it reopens
  // on. What it was showing is hidden rather than thrown away, so the file you had open is still open
  // when it comes back, and a hidden panel reads nothing because nothing here reads without being asked.
  const rail = (
    <div className="flex animate-in flex-col items-center gap-0.5 py-1.5 fade-in duration-200">
      <ActionIconButton
        variant="ghost"
        size="icon-sm"
        tooltip="Expand panel"
        tooltipSide="left"
        aria-label="Expand panel"
        onClick={onExpand}
      >
        <ChevronLeft />
      </ActionIconButton>
      {TABS.map(({ value, label, icon: Icon }) => (
        <ActionIconButton
          key={value}
          variant="ghost"
          size="icon-sm"
          tooltip={label}
          tooltipSide="left"
          aria-label={label}
          onClick={() => {
            setTab(value);
            onExpand();
          }}
        >
          <Icon />
        </ActionIconButton>
      ))}
    </div>
  );

  return (
    <>
      {collapsed ? rail : null}
      <div className={collapsed ? "hidden" : "h-full"}>
        <Tabs value={tab} onValueChange={setTab} className="h-full min-h-0 gap-0">
          <div className="flex h-11 shrink-0 items-center gap-0.5 border-b pr-3 pl-1.5">
            <ActionIconButton
              variant="ghost"
              size="icon-sm"
              tooltip="Collapse panel"
              aria-label="Collapse panel"
              onClick={onCollapse}
            >
              <ChevronRight />
            </ActionIconButton>
            <TabsList variant="line">
              {TABS.map(({ value, label, icon: Icon }) => (
                <Tooltip key={value}>
                  <TooltipTrigger render={<TabsTrigger value={value} aria-label={label} />}>
                    <Icon />
                  </TooltipTrigger>
                  <TooltipContent>{label}</TooltipContent>
                </Tooltip>
              ))}
            </TabsList>
            <span className="ml-auto flex items-center">
              {tab === "usage" && session.agent === "shell" ? null : (
                <ActionIconButton
                  variant="ghost"
                  size="icon-sm"
                  tooltip="Refresh"
                  aria-label="Refresh"
                  onClick={() => setReload((counts) => ({ ...counts, [tab]: counts[tab as keyof typeof counts] + 1 }))}
                >
                  <RefreshCw />
                </ActionIconButton>
              )}
            </span>
          </div>
          <TabsContent value="files" className="min-h-0 overflow-hidden">
            <FilesPanel key={reload.files} root={session.cwd} rootId={session.rootId} />
          </TabsContent>
          <TabsContent value="git" className="min-h-0 overflow-hidden">
            <GitPanel key={reload.git} rootId={session.rootId} sessionId={session.id} />
          </TabsContent>
          <TabsContent value="usage" className="min-h-0 overflow-hidden">
            <UsagePanel key={reload.usage} session={session} />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
