// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { invoke } from "@tauri-apps/api/core";
import {
  ArrowLeft,
  Brain,
  ChartNoAxesColumn,
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleCheck,
  CircleDot,
  FileDiff,
  Folder,
  GitBranch,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  RefreshCw,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  lazy,
  memo,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type Ref,
  Suspense,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";

import { GitHubLogomark, ProviderIcon } from "@/brand-icons";
import { Badge } from "@/components/ui/badge";
import { ActionIconButton, Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  type GitHubReferences,
  githubItemReferences,
  itemKey,
  likelyGitHubItems,
  mergeGitHubItems,
  type RememberedReferences,
} from "@/github-items";
import { SEMANTIC_PROGRESS_CLASSES, type SemanticTone } from "@/lib/semantic-styles";
import { cn, including, without } from "@/lib/utils";
import {
  readTerminalInput,
  readTerminalOutput,
  readTerminalStream,
  subscribeNotifications,
  subscribeTerminalOutput,
} from "@/output-store";
import { IS_MAC, matchesShortcut } from "@/shortcuts";
import { contentZoomStyle } from "@/theme";
import {
  type DirectoryCursor,
  type DirectoryListing,
  type FileEntry,
  folderName,
  type GitStatus,
  providerLabel,
  repoName,
  type Session,
  sessionLabel,
  tilde,
} from "@/types";

const CodePreview = lazy(() => import("@/code-preview"));
// The icon table is the file browser's, so it loads with the first tree rather than with the app; a
// row keeps its icon's place while it does.
const Icon = lazy(() => import("@/file-icons"));
function FileIcon(props: { name: string; directory?: boolean }) {
  return (
    <Suspense fallback={<span className="size-4 shrink-0" />}>
      <Icon {...props} />
    </Suspense>
  );
}

function namedInSession(sessionId: string, remote: string) {
  return githubItemReferences(
    readTerminalOutput(sessionId),
    remote,
    readTerminalStream(sessionId),
    readTerminalInput(sessionId),
    rememberedReferences(sessionId),
  );
}

interface GitHubReference {
  kind: "issue" | "pull request";
  number: string;
  repository: string;
  repositoryUrl: string;
}

// GitHub work items are known by their repository, kind and number; that is also all the grouped UI needs.
function githubReference(url: string): GitHubReference {
  const [owner, repository, kind, number] = url.split("/").slice(3);
  return {
    kind: kind === "pull" ? "pull request" : "issue",
    number,
    repository: `${owner}/${repository}`,
    repositoryUrl: `https://github.com/${owner}/${repository}`,
  };
}

function githubRepositoryKey(url: string) {
  return url.split("/").slice(3, 5).join("/").toLowerCase();
}

// Every optional field arrives from Serde as null, never as a missing key. A state of null is a link
// GitHub could not be asked about rather than one it disowned; those are dropped before they arrive.
interface GitHubItem {
  url: string;
  title: string | null;
  state: keyof typeof GITHUB_STATE_ICON | null;
  occurredAt: string | null;
  updatedAt: string | null;
  additions: number | null;
  deletions: number | null;
  headBranch: string | null;
}

function pendingGitHubItem(url: string): GitHubItem {
  return {
    url,
    title: null,
    state: null,
    occurredAt: null,
    updatedAt: null,
    additions: null,
    deletions: null,
    headBranch: null,
  };
}

const GITHUB_ITEMS_KEY = "lite.github-items";
const REMOVED_GITHUB_ITEMS_KEY = "lite.github-items.removed";
const REMEMBERED_REFERENCES_KEY = "lite.github-items.remembered";
// A session keeps its latest ambiguous references and its first repositories; each panel visit asks GitHub
// about every candidate they make.
const MAX_MENTIONS = 500;
const MAX_REPOSITORIES = 50;

// The mentions each session's last render showed. A new mention is kept only once two renders in a row show
// it, so a number still streaming in, such as #10 on its way to #102, is not kept. A repository is kept when
// first seen, because a mention kept later may depend on it.
const lastRendered = new Map<string, string[]>();

function rememberedReferences(sessionId: string): RememberedReferences {
  const sessions = JSON.parse(localStorage.getItem(REMEMBERED_REFERENCES_KEY) ?? "{}") as Record<
    string,
    RememberedReferences
  >;
  return sessions[sessionId] ?? { mentions: [], repositories: [] };
}

function removedGitHubItems(sessionId: string) {
  const sessions = JSON.parse(localStorage.getItem(REMOVED_GITHUB_ITEMS_KEY) ?? "{}") as Record<string, string[]>;
  return new Set(sessions[sessionId] ?? []);
}

function setGitHubItemsRemoved(sessionId: string, urls: string[], removed: boolean) {
  const sessions = JSON.parse(localStorage.getItem(REMOVED_GITHUB_ITEMS_KEY) ?? "{}") as Record<string, string[]>;
  const items = new Set(sessions[sessionId] ?? []);
  for (const url of urls) {
    if (removed) items.add(itemKey(url));
    else items.delete(itemKey(url));
  }
  if (items.size) sessions[sessionId] = [...items];
  else delete sessions[sessionId];
  localStorage.setItem(REMOVED_GITHUB_ITEMS_KEY, JSON.stringify(sessions));
}

function sessionGitHubItems(sessionId: string) {
  const sessions = JSON.parse(localStorage.getItem(GITHUB_ITEMS_KEY) ?? "{}") as Record<string, GitHubItem[]>;
  const removed = removedGitHubItems(sessionId);
  return (sessions[sessionId] ?? []).filter((item) => !removed.has(itemKey(item.url)));
}

function retainGitHubItems(sessionId: string, updates: GitHubItem[], disowned = new Set<string>()) {
  const sessions = JSON.parse(localStorage.getItem(GITHUB_ITEMS_KEY) ?? "{}") as Record<string, GitHubItem[]>;
  const current = (sessions[sessionId] ?? []).filter((item) => !disowned.has(itemKey(item.url)));
  const items = mergeGitHubItems(current, updates);
  sessions[sessionId] = items;
  localStorage.setItem(GITHUB_ITEMS_KEY, JSON.stringify(sessions));
  return sessionGitHubItems(sessionId);
}

// Full-screen terminals and long sessions can redraw or scroll a reference away before the Git panel is
// opened. Remember references when xterm renders them; the panel resolves ambiguous ones against the
// session's repositories and fills in current GitHub metadata when it is visited.
export function rememberGitHubReferences(sessionId: string, output: string, terminalStream: string) {
  const current = rememberedReferences(sessionId);
  const { explicit, remembered } = githubItemReferences(output, "", terminalStream, "", current);
  const settled = new Set([...current.mentions, ...(lastRendered.get(sessionId) ?? [])]);
  lastRendered.set(sessionId, remembered.mentions);
  // What the terminal still shows comes last, so the same output always keeps the same, newest mentions, and
  // the first repositories a session names stay named.
  const next = {
    mentions: remembered.mentions.filter((mention) => settled.has(mention)).slice(-MAX_MENTIONS),
    repositories: remembered.repositories.slice(0, MAX_REPOSITORIES),
  };
  if (JSON.stringify(next) !== JSON.stringify(current)) {
    const sessions = JSON.parse(localStorage.getItem(REMEMBERED_REFERENCES_KEY) ?? "{}") as Record<
      string,
      RememberedReferences
    >;
    sessions[sessionId] = next;
    localStorage.setItem(REMEMBERED_REFERENCES_KEY, JSON.stringify(sessions));
  }
  rememberGitHubItems(sessionId, explicit);
}

function rememberGitHubItems(sessionId: string, explicit: string[]) {
  if (!explicit.length) return;
  const current = sessionGitHubItems(sessionId);
  const known = new Set(current.map((item) => itemKey(item.url)));
  const additions = explicit.filter((url) => !known.has(itemKey(url))).map(pendingGitHubItem);
  if (additions.length) retainGitHubItems(sessionId, additions);
}

// The colors GitHub itself answers in, so a glance here reads the same as a glance there.
const GITHUB_STATE_ICON = {
  open: "text-success",
  draft: "text-muted-foreground",
  merged: "text-violet-700 dark:text-violet-400",
  closed: "text-red-700 dark:text-red-400",
} as const;

const GITHUB_STATE_BAR = {
  open: "bg-success",
  draft: "bg-muted-foreground/40",
  merged: "bg-violet-500",
  closed: "bg-destructive",
} as const satisfies Record<keyof typeof GITHUB_STATE_ICON, string>;

interface RepositoryGroup {
  branch: string | null;
  changes: GitStatus["changes"];
  changesTruncated: boolean;
  lineDiffs: GitStatus["lineDiffs"];
  sync: GitStatus["sync"];
  lastCommit: GitStatus["lastCommit"];
  items: (GitHubItem & GitHubReference)[];
  name: string;
  path: string | null;
  url: string | null;
}

export function relativeAge(timestamp: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(timestamp)) / 1000));
  if (seconds < 60) return seconds < 10 ? "just now" : `${seconds} sec ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} mo ago`;
  const years = Math.floor(days / 365);
  return `${years} yr ago`;
}

function GitHubItemIcon({ kind, state }: Pick<GitHubReference, "kind"> & Pick<GitHubItem, "state">) {
  if (kind === "issue") return state === "closed" ? <CircleCheck /> : <CircleDot />;
  if (state === "merged") return <GitMerge />;
  if (state === "closed") return <GitPullRequestClosed />;
  if (state === "draft") return <GitPullRequestDraft />;
  return <GitPullRequest />;
}

// The current worktree is the first repository. Links then join it or create one group in the order
// the session printed them, so neither a repeated URL nor a repeated repository repeats context.
function repositoryGroups(remote: string, status: GitStatus | null, items: GitHubItem[]): RepositoryGroup[] {
  const groups = new Map<string, RepositoryGroup>();
  if (status) {
    groups.set((remote || status.worktree).toLowerCase(), {
      branch: status.branch,
      changes: status.changes,
      changesTruncated: status.changesTruncated,
      lineDiffs: status.lineDiffs,
      sync: status.sync,
      lastCommit: status.lastCommit,
      items: [],
      name: remote ? repoName(remote) : folderName(status.worktree) || status.worktree,
      path: status.worktree,
      url: remote || null,
    });
  }
  for (const item of items) {
    const reference = githubReference(item.url);
    const key = reference.repositoryUrl.toLowerCase();
    const group = groups.get(key) ?? {
      branch: null,
      changes: [],
      changesTruncated: false,
      lineDiffs: {},
      sync: null,
      lastCommit: null,
      items: [],
      name: reference.repository,
      path: null,
      url: reference.repositoryUrl,
    };
    group.items.push({ ...item, ...reference });
    groups.set(key, group);
  }
  for (const group of groups.values()) group.items.sort((left, right) => Number(right.number) - Number(left.number));
  return [...groups.values()];
}

// A quiet two-line row: the icon's color carries the state, so the line beneath can say when it happened.
function GitHubItemList({ items }: { items: RepositoryGroup["items"] }) {
  return (
    <ItemGroup className="-mx-1.5 w-auto has-data-[size=xs]:gap-0">
      {items.map(({ url, title, state, occurredAt, additions, deletions, kind, number }) => (
        <Item
          key={url}
          size="xs"
          className="flex-nowrap items-start px-1.5 py-1.5 text-left hover:bg-foreground/5"
          render={
            <button type="button" title={url} data-context-url={url} onClick={() => void invoke("open_url", { url })} />
          }
        >
          <ItemMedia variant="icon" className={state ? GITHUB_STATE_ICON[state] : "text-muted-foreground"}>
            <GitHubItemIcon kind={kind} state={state} />
          </ItemMedia>
          <ItemContent className="min-w-0">
            <ItemTitle className="block w-full truncate font-normal">{title ?? `#${number}`}</ItemTitle>
            {title ? (
              <div className="flex min-w-0 items-center gap-2">
                <ItemDescription className="min-w-0 truncate">
                  #{number}
                  {state ? ` · ${state === "open" ? "opened" : state === "draft" ? "drafted" : state}` : ""}
                  {occurredAt ? ` ${relativeAge(occurredAt)}` : ""}
                </ItemDescription>
                {additions ? (
                  <span className="ml-auto shrink-0 font-mono text-xs text-green-600 dark:text-green-400">
                    +{additions}
                  </span>
                ) : null}
                {deletions ? (
                  <span
                    className={cn("shrink-0 font-mono text-xs text-red-600 dark:text-red-400", !additions && "ml-auto")}
                  >
                    -{deletions}
                  </span>
                ) : null}
              </div>
            ) : null}
          </ItemContent>
        </Item>
      ))}
    </ItemGroup>
  );
}

// One list so a tab, its icon and the name every surface calls it by cannot drift apart, including the
// rail the panel collapses to.
const TABS = [
  { value: "files", label: "Files", icon: Folder },
  { value: "git", label: "Git", icon: GitBranch },
  { value: "usage", label: "Usage", icon: ChartNoAxesColumn },
] as const;
type InspectorTab = (typeof TABS)[number]["value"];
// One choice for every session: switching sessions keeps the panel on the tab you last picked, Git until then.
let inspectorTab: InspectorTab = "git";

// Every optional field arrives from Serde as null, never as a missing key.
interface UsageWindow {
  label: string;
  usedPercent: number;
  resetsAt: number | null;
  windowMinutes: number | null;
}

interface UsageSnapshot {
  model: string | null;
  reasoning: string | null;
  contextUsedPercent: number | null;
  contextWindow: number | null;
  contextTokens: number | null;
  costUsd: number | null;
  lifetimeTokens: number | null;
  bankedResets: number | null;
  bankedResetExpiries: (number | null)[];
  windows: UsageWindow[];
}

const formatNumber = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

const formatClock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const formatWeekday = new Intl.DateTimeFormat(undefined, { weekday: "long" });
const formatDay = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

// How long until a moment ahead — "3 hr 20 min", "4 days" — or nothing once it has passed.
function waitUntil(seconds: number) {
  const left = seconds * 1000 - Date.now();
  const minutes = Math.round(left / 60000);
  const hours = Math.floor(minutes / 60);
  if (left <= 0) return undefined;
  return minutes < 1
    ? "under a minute"
    : minutes < 60
      ? `${minutes} min`
      : hours < 48
        ? `${hours} hr${hours < 10 && minutes % 60 ? ` ${minutes % 60} min` : ""}`
        : `${Math.round(hours / 24)} days`;
}

// Which day and time a moment ahead falls on — "today 8:40 PM", "Tuesday 5:20 PM".
function dayAndTime(seconds: number) {
  const at = new Date(seconds * 1000);
  const midnight = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((midnight(at) - midnight(new Date())) / 86_400_000);
  const day =
    days === 0 ? "today" : days === 1 ? "tomorrow" : days < 7 ? formatWeekday.format(at) : formatDay.format(at);
  return `${day} ${formatClock.format(at)}`;
}

// A moment ahead as someone planning around it asks about it: how long until then, and which day and time
// that is — "in 3 hr 20 min · today 8:40 PM", "in 4 days · Tuesday 5:20 PM". The counterpart of relativeAge.
function timeUntil(seconds: number) {
  const wait = waitUntil(seconds);
  return `${wait ? `in ${wait}` : "now"} · ${dayAndTime(seconds)}`;
}

function Loading({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
      <Spinner />
      {label}
    </div>
  );
}

// The one field every panel narrows itself with: it names the panel and Escape empties it. The
// sidebar places it in its own header row; the inspector panels give it a row of its own.
export function SearchInput({
  value,
  placeholder,
  onChange,
  inputRef,
  onKeyDown,
  className = "shrink-0 p-2",
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  inputRef?: Ref<HTMLInputElement>;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  className?: string;
}) {
  return (
    <div className={className}>
      <InputGroup>
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          ref={inputRef}
          value={value}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onChange("");
            onKeyDown?.(event);
          }}
        />
      </InputGroup>
    </div>
  );
}

// Capacity gets more urgent as it is spent; all consumers share these tones with status badges.
function Meter({ label, value, className }: { label: string; value: number; className?: string }) {
  const bounded = Math.max(0, Math.min(100, value));
  const tone: SemanticTone = bounded >= 90 ? "error" : bounded >= 75 ? "warning" : "success";
  return <Progress value={bounded} aria-label={label} className={cn(SEMANTIC_PROGRESS_CLASSES[tone], className)} />;
}

function FileTree({
  root,
  rootId,
  query,
  onOpen,
  onLoad,
}: {
  root: string;
  rootId: string;
  query: string;
  onOpen: (entry: FileEntry) => void;
  onLoad: (tab: InspectorTab) => void;
}) {
  const [children, setChildren] = useState<Record<string, DirectoryListing & { after: DirectoryCursor | null }>>({});
  // The root is the folder the session works in; showing it shut asks for a click to say what the
  // panel is already for, so it opens with the tree it was asked to show.
  const [expanded, setExpanded] = useState(() => new Set<string>());
  const loading = useRef(new Set<string>());
  const [loadingPaths, setLoadingPaths] = useState(() => new Set<string>());
  const [expandingAll, setExpandingAll] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<FileEntry>();
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const load = useCallback(
    async (path: string, after: DirectoryCursor | null = null) => {
      if (loading.current.has(path)) return;
      loading.current.add(path);
      setLoadingPaths((current) => including(current, path));
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
        setLoadingPaths((current) => without(current, path));
      }
    },
    [rootId],
  );

  useEffect(() => {
    let mounted = true;
    setExpanded((current) => including(current, root));
    void load(root).finally(() => {
      if (mounted) onLoad("files");
    });
    return () => {
      mounted = false;
    };
  }, [load, onLoad, root]);

  async function toggle(path: string) {
    const next = new Set(expanded);
    if (next.has(path)) next.delete(path);
    else {
      next.add(path);
      if (!children[path]) await load(path);
    }
    setExpanded(next);
  }

  const walkController = useRef<AbortController | null>(null);
  const [limited, setLimited] = useState(false);
  async function walk(expand: boolean) {
    walkController.current?.abort();
    const controller = new AbortController();
    walkController.current = controller;
    const { signal } = controller;
    setExpandingAll(true);
    setLimited(false);
    const nextChildren: typeof children = {};
    const directories = new Set<string>();
    const pending = [root];
    const limit = 10_000;
    let count = 0;
    try {
      for (let index = 0; index < pending.length && count < limit; index++) {
        const path = pending[index];
        if (directories.has(path)) continue;
        directories.add(path);
        let listing = children[path];
        if (!listing || listing.after || listing.nextCursor) {
          const entries: FileEntry[] = [];
          let cursor: DirectoryCursor | null = null;
          do {
            signal.throwIfAborted();
            const page: DirectoryListing = await invoke("list_directory", { rootId, path, after: cursor });
            signal.throwIfAborted();
            const loaded = page.entries.slice(0, limit - count - entries.length);
            entries.push(...loaded);
            cursor = loaded.length < page.entries.length ? (loaded[loaded.length - 1] ?? null) : page.nextCursor;
          } while (cursor && count + entries.length < limit);
          listing = { entries, nextCursor: cursor, after: null };
        }
        const entries = listing.entries.slice(0, limit - count);
        count += entries.length;
        nextChildren[path] =
          entries.length < listing.entries.length
            ? { ...listing, entries, nextCursor: entries[entries.length - 1] }
            : listing;
        pending.push(...entries.filter((entry) => entry.isDirectory && !entry.isSymlink).map((entry) => entry.path));
      }
      setChildren((current) => ({ ...current, ...nextChildren }));
      if (expand) setExpanded(directories);
      setLimited(count >= limit);
      setError("");
    } catch (reason) {
      if (!signal.aborted) setError(String(reason));
    } finally {
      if (!signal.aborted) setExpandingAll(false);
    }
  }

  const lowered = query.trim().toLowerCase();

  async function deleteEntry() {
    if (!deleting) return;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      await invoke("delete_entry", { rootId, path: deleting.path });
      setChildren((current) => {
        const next = { ...current };
        for (const [path, listing] of Object.entries(next)) {
          if (path === deleting.path || path.startsWith(`${deleting.path}/`) || path.startsWith(`${deleting.path}\\`))
            delete next[path];
          else if (listing.entries.some((entry) => entry.path === deleting.path))
            next[path] = { ...listing, entries: listing.entries.filter((entry) => entry.path !== deleting.path) };
        }
        return next;
      });
      setExpanded(
        (current) =>
          new Set(
            [...current].filter(
              (path) =>
                path !== deleting.path &&
                !path.startsWith(`${deleting.path}/`) &&
                !path.startsWith(`${deleting.path}\\`),
            ),
          ),
      );
      setDeleting(undefined);
      setError("");
    } catch (reason) {
      setDeleteError(String(reason));
    } finally {
      setDeleteBusy(false);
    }
  }

  const searchFiles = useEffectEvent(() => void walk(false));
  useEffect(() => {
    if (!lowered) {
      setExpandingAll(false);
      setLimited(false);
    }
    const timer = lowered ? window.setTimeout(searchFiles, 150) : undefined;
    return () => {
      window.clearTimeout(timer);
      walkController.current?.abort();
    };
  }, [lowered]);

  // A folder is worth showing while searching if anything under it matches; only loaded listings can
  // answer, which is what the walk above is for. One pass marks every such folder, because the answer
  // is asked for twice per row drawn — once to keep the folder and once to open it — and a folder deep
  // in a tree would otherwise have its whole subtree rescanned once for every ancestor above it.
  const matching = useMemo(() => {
    const found = new Set<string>();
    if (!lowered) return found;
    const visit = (path: string): boolean => {
      let inside = false;
      for (const entry of children[path]?.entries ?? []) {
        // Always descend: a folder is marked for its own sake, not only for its parent's answer.
        if ((entry.isDirectory && visit(entry.path)) || entry.name.toLowerCase().includes(lowered)) inside = true;
      }
      if (inside) found.add(path);
      return inside;
    };
    visit(root);
    return found;
  }, [children, lowered, root]);

  function rows(path: string, depth = 0): React.ReactNode {
    const listing = children[path];
    if (!listing) {
      if (loadingPaths.has(path)) return <Loading label="Reading folder…" />;
      return error ? <p className="p-3 text-xs text-destructive">{error}</p> : null;
    }
    const entries = lowered
      ? listing.entries.filter(
          (entry) => entry.name.toLowerCase().includes(lowered) || (entry.isDirectory && matching.has(entry.path)),
        )
      : listing.entries;
    return (
      <>
        {entries.map((entry) => {
          const open = entry.isDirectory && (expanded.has(entry.path) || matching.has(entry.path));
          return (
            <div key={entry.path}>
              <div data-context-file-row>
                <button
                  type="button"
                  className="flex h-6 w-full items-center gap-1 rounded-sm pr-2 text-left text-[13px] hover:bg-muted"
                  style={{ paddingLeft: `${6 + depth * 12}px` }}
                  data-context-value={entry.path}
                  data-context-label="Copy path"
                  data-context-directory={entry.isDirectory ? "" : undefined}
                  data-context-expanded={entry.isDirectory ? expanded.has(entry.path) : undefined}
                  onClick={() => (entry.isDirectory ? void toggle(entry.path) : onOpen(entry))}
                  onKeyDown={(event) => {
                    if (event.key !== "Delete" && !(IS_MAC && event.metaKey && event.key === "Backspace")) return;
                    event.preventDefault();
                    setDeleteError("");
                    setDeleting(entry);
                  }}
                >
                  {entry.isDirectory ? (
                    <>
                      <ChevronRight
                        className={`size-3 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
                      />
                      <FileIcon name={entry.name} directory />
                    </>
                  ) : (
                    <>
                      <span className="w-3" />
                      <FileIcon name={entry.name} />
                    </>
                  )}
                  <span className="truncate">{entry.name}</span>
                </button>
                <button
                  type="button"
                  hidden
                  data-context-delete-entry
                  onClick={() => {
                    setDeleteError("");
                    setDeleting(entry);
                  }}
                />
              </div>
              {open ? rows(entry.path, depth + 1) : null}
            </div>
          );
        })}
        {listing.after || listing.nextCursor ? (
          <div className="flex h-6 items-center gap-3 pr-2 text-[13px]" style={{ paddingLeft: `${42 + depth * 12}px` }}>
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

  const name = folderName(root) || root;
  const rootOpen = !!lowered || expanded.has(root);
  return (
    <div className="py-1">
      <Dialog open={Boolean(deleting)} onOpenChange={(open) => !open && !deleteBusy && setDeleting(undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{deleting?.name}”?</DialogTitle>
            <DialogDescription>
              This permanently deletes the {deleting?.isDirectory ? "folder and its contents" : "file"} from your
              computer.
            </DialogDescription>
            {deleteError ? (
              <p role="alert" className="text-sm text-destructive">
                {deleteError}
              </p>
            ) : null}
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={deleteBusy} onClick={() => setDeleting(undefined)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={deleteBusy} onClick={() => void deleteEntry()}>
              {deleteBusy ? <Spinner /> : <Trash2 />}
              {deleteBusy ? "Deleting…" : `Delete ${deleting?.isDirectory ? "Folder" : "File"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <div className="flex items-center pr-1">
        <button
          type="button"
          className="flex h-6 min-w-0 flex-1 items-center gap-1 rounded-sm px-1.5 text-left text-[13px] font-medium hover:bg-muted"
          data-context-value={root}
          data-context-label="Copy path"
          data-context-directory
          data-context-expanded={expanded.has(root)}
          onClick={() => void toggle(root)}
        >
          <ChevronRight
            className={`size-3 text-muted-foreground transition-transform ${rootOpen ? "rotate-90" : ""}`}
          />
          <FileIcon name={name} directory />
          <span className="truncate">{name}</span>
        </button>
        <ActionIconButton
          size="icon-xs"
          tooltip="Expand all"
          aria-label="Expand all folders"
          data-context-expand-files
          disabled={expandingAll}
          onClick={() => void walk(true)}
        >
          {expandingAll ? <Spinner /> : <ChevronsUpDown />}
        </ActionIconButton>
        <ActionIconButton
          size="icon-xs"
          tooltip="Collapse all"
          aria-label="Collapse all folders"
          data-context-collapse-files
          disabled={expandingAll}
          onClick={() => setExpanded(new Set())}
        >
          <ChevronsDownUp />
        </ActionIconButton>
      </div>
      {limited ? (
        <p className="p-3 text-xs text-muted-foreground">
          Showing up to 10,000 entries. Open a smaller folder to search further.
        </p>
      ) : null}
      {lowered && error ? <p className="p-3 text-xs text-destructive">{error}</p> : null}
      {lowered && !limited && !error && !expandingAll && children[root] && !matching.has(root) ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">No matches</p>
      ) : null}
      {rootOpen ? rows(root, 1) : null}
    </div>
  );
}

const RENDERED_FILE = /\.(?:html?|mdx?|svg)$/i;

function usePreviewViewer<T extends HTMLElement>(onBack: () => void) {
  const viewer = useRef<T>(null);

  useEffect(() => viewer.current?.focus(), []);
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!viewer.current || viewer.current.offsetParent === null) return;
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (event.key !== "Escape" && event.key !== "ArrowLeft") return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest("input, textarea, [contenteditable=true], [role=dialog], [role=menu], [data-context-session]")
      )
        return;
      event.preventDefault();
      onBack();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onBack]);

  return viewer;
}

function previewKeyDown(event: ReactKeyboardEvent<HTMLElement>, onClose: () => void, onSave?: () => void) {
  if (onSave && matchesShortcut(event.nativeEvent, "saveFile")) {
    event.preventDefault();
    onSave();
  } else if (matchesShortcut(event.nativeEvent, "closeSession")) {
    event.preventDefault();
    onClose();
  }
}

function PreviewHeader({
  path,
  backLabel,
  closeLabel,
  icon,
  title,
  disabled,
  showClose = true,
  onClose,
  children,
}: {
  path: string;
  backLabel: string;
  closeLabel: string;
  icon: ReactNode;
  title: ReactNode;
  disabled?: boolean;
  showClose?: boolean;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <div
      className="flex h-9 shrink-0 items-center gap-2 border-b px-2 text-[13px]"
      data-context-value={path}
      data-context-label="Copy path"
    >
      <ActionIconButton size="icon-sm" tooltip={backLabel} aria-label={backLabel} disabled={disabled} onClick={onClose}>
        <ArrowLeft />
      </ActionIconButton>
      {icon}
      {title}
      {children}
      {showClose ? (
        <ActionIconButton
          size="icon-sm"
          tooltip={closeLabel}
          aria-label={closeLabel}
          disabled={disabled}
          onClick={onClose}
        >
          <X />
        </ActionIconButton>
      ) : null}
    </div>
  );
}

function FileViewer({
  entry,
  source,
  draft,
  baseline,
  error,
  loading,
  saving,
  saveError,
  fontSize,
  onBack,
  onOpenPath,
  rootId,
  onDraftChange,
  onSave,
}: {
  entry: FileEntry;
  source: string;
  draft: string;
  baseline: string | null;
  error: string;
  loading: boolean;
  saving: boolean;
  saveError: string;
  fontSize: number;
  onBack: () => void;
  onOpenPath: (path: string) => void;
  rootId: string;
  onDraftChange: (contents: string) => void;
  onSave: () => Promise<void>;
}) {
  const [view, setView] = useState<"source" | "preview">("source");
  const [discardOpen, setDiscardOpen] = useState(false);
  const dirty = draft !== source;
  const renderable = RENDERED_FILE.test(entry.path);
  const lineEnding = source.includes("\r\n") ? "\r\n" : "\n";
  const viewer = usePreviewViewer<HTMLDivElement>(closeFile);

  function closeFile() {
    if (saving) return;
    if (dirty) setDiscardOpen(true);
    else onBack();
  }

  return (
    <Tabs
      ref={viewer}
      value={view}
      onValueChange={(value) => setView(value as "source" | "preview")}
      aria-label={entry.name}
      tabIndex={-1}
      className="flex min-h-0 flex-1 flex-col gap-0 outline-none"
      onKeyDown={(event) => previewKeyDown(event, closeFile, () => !saving && dirty && void onSave())}
    >
      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard changes to “{entry.name}”?</DialogTitle>
            <DialogDescription>Your unsaved edits will be lost.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiscardOpen(false)}>
              Keep editing
            </Button>
            <Button
              variant="destructive"
              disabled={saving}
              onClick={() => {
                setDiscardOpen(false);
                onBack();
              }}
            >
              Discard changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <PreviewHeader
        path={entry.path}
        backLabel="Back to files"
        closeLabel="Close file"
        icon={<FileIcon name={entry.name} />}
        title={
          <span className="min-w-0 flex-1 truncate font-medium">
            {entry.name}
            {dirty ? " •" : ""}
          </span>
        }
        disabled={saving}
        showClose
        onClose={closeFile}
      >
        {renderable && !error ? (
          <TabsList aria-label="File view" className="h-7 shrink-0">
            <TabsTrigger value="source" className="text-xs">
              Source
            </TabsTrigger>
            <TabsTrigger value="preview" className="text-xs">
              Preview
            </TabsTrigger>
          </TabsList>
        ) : null}
        {!error && !loading ? (
          <ActionIconButton
            size="icon-sm"
            tooltip={saving ? "Saving file…" : saveError ? "Save failed" : dirty ? "Save file" : "Saved to disk"}
            aria-label={saving ? "Saving file" : saveError ? "Save failed" : dirty ? "Save file" : "Saved to disk"}
            disabled={saving || draft === source}
            onClick={() => void onSave()}
          >
            {saving ? (
              <Spinner aria-hidden="true" />
            ) : dirty || saveError ? (
              <Save aria-hidden="true" />
            ) : (
              <CircleCheck aria-hidden="true" />
            )}
          </ActionIconButton>
        ) : null}
      </PreviewHeader>
      {loading ? (
        <Loading label="Opening file…" />
      ) : error ? (
        <div className="p-3 text-xs text-muted-foreground">{error}</div>
      ) : (
        <>
          <TabsContent value="source" keepMounted className="min-h-0 overflow-hidden">
            <Suspense fallback={<Loading label="Highlighting source…" />}>
              <CodePreview
                path={entry.path}
                source={draft}
                baseline={baseline ?? undefined}
                editable
                fontSize={fontSize}
                onChange={(contents) => {
                  onDraftChange(lineEnding === "\r\n" ? contents.replace(/\r?\n/g, "\r\n") : contents);
                  if (!saveError) void onSave();
                }}
              />
            </Suspense>
          </TabsContent>
          {renderable ? (
            <TabsContent value="preview" className="min-h-0 overflow-hidden">
              <ScrollArea className="size-full">
                <div style={contentZoomStyle(fontSize)}>
                  <Suspense fallback={<Loading label="Opening preview…" />}>
                    <CodePreview
                      path={entry.path}
                      source={draft}
                      rendered
                      onOpenPath={dirty || saving ? undefined : onOpenPath}
                      rootId={rootId}
                    />
                  </Suspense>
                </div>
              </ScrollArea>
            </TabsContent>
          ) : null}
        </>
      )}
      {saveError ? (
        <p role="alert" className="shrink-0 border-t p-2 text-xs text-destructive">
          {saveError}
        </p>
      ) : null}
    </Tabs>
  );
}

interface FileEditorState {
  rootId: string;
  selected: FileEntry;
  source: string;
  draft: string;
  baseline: string | null;
  saving?: Promise<void>;
  saveError?: string;
}

interface TextFile {
  contents: string;
  baseline: string | null;
}

const fileEditorsBySession = new Map<string, FileEditorState>();

export function unsavedFile(sessionId?: string) {
  for (const [id, editor] of fileEditorsBySession)
    if ((!sessionId || id === sessionId) && (editor.saving || editor.draft !== editor.source))
      return editor.selected.path;
}

function FilesPanel({
  root,
  rootId,
  sessionId,
  fontSize,
  fileBrowserVersion,
  searchRef,
  onLoad,
}: {
  root: string;
  rootId: string;
  sessionId: string;
  fontSize: number;
  fileBrowserVersion: number;
  searchRef: Ref<HTMLInputElement>;
  onLoad: (tab: InspectorTab) => void;
}) {
  const [cached] = useState(() => {
    const current = fileEditorsBySession.get(sessionId);
    if (current?.rootId === rootId) return current;
    fileEditorsBySession.delete(sessionId);
  });
  const [selected, setSelected] = useState<FileEntry | null>(cached?.selected ?? null);
  const [source, setSource] = useState(cached?.source ?? "");
  const [draft, setDraft] = useState(cached?.draft ?? "");
  const [baseline, setBaseline] = useState<string | null>(cached?.baseline ?? null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(cached && !cached.saving && cached.draft === cached.source));
  const [saving, setSaving] = useState(Boolean(cached?.saving));
  const [saveError, setSaveError] = useState(cached?.saveError ?? "");
  const [query, setQuery] = useState("");
  const request = useRef(0);

  const openFile = useCallback(
    async (entry: FileEntry) => {
      const id = ++request.current;
      setSelected(entry);
      setSource("");
      setDraft("");
      setBaseline(null);
      setError("");
      setSaveError("");
      setLoading(true);
      try {
        const { contents, baseline } = await invoke<TextFile>("read_text_file", { rootId, path: entry.path });
        if (request.current === id) {
          setSource(contents);
          setDraft(contents);
          setBaseline(baseline);
          fileEditorsBySession.set(sessionId, { rootId, selected: entry, source: contents, draft: contents, baseline });
        }
      } catch (reason) {
        if (request.current === id) {
          setSource("");
          setError(String(reason));
        }
      } finally {
        if (request.current === id) setLoading(false);
      }
    },
    [rootId, sessionId],
  );

  useEffect(() => {
    const id = request.current;
    const sync = () => {
      if (cached && request.current === id) {
        setSource(cached.source);
        setSaving(false);
        setSaveError(cached.saveError ?? "");
      }
    };
    if (cached?.saving) void cached.saving.then(sync);
    else {
      sync();
      if (cached && cached.draft === cached.source) void openFile(cached.selected);
    }
    return () => {
      request.current++;
    };
  }, [cached, openFile]);

  async function saveFile() {
    const editor = fileEditorsBySession.get(sessionId);
    if (!editor) return;
    const id = request.current;
    setSaving(true);
    setSaveError("");
    editor.saveError = undefined;
    // The cached editor owns the write so switching sessions cannot interrupt it or start a second one.
    editor.saving ??= (async () => {
      try {
        while (editor.draft !== editor.source) {
          const contents = editor.draft;
          await invoke("write_text_file", {
            rootId: editor.rootId,
            path: editor.selected.path,
            contents,
            original: editor.source,
          });
          editor.source = contents;
        }
      } catch (reason) {
        editor.saveError = String(reason);
        toast.add({ title: `Could not save ${editor.selected.name}`, description: editor.saveError, type: "error" });
      }
    })().finally(() => {
      editor.saving = undefined;
    });
    await editor.saving;
    if (request.current === id) {
      setSource(editor.source);
      setSaving(false);
      setSaveError(editor.saveError ?? "");
    }
  }

  function changeDraft(contents: string) {
    setDraft(contents);
    const editor = fileEditorsBySession.get(sessionId);
    if (editor) editor.draft = contents;
  }

  function closeFile() {
    request.current++;
    fileEditorsBySession.delete(sessionId);
    setSelected(null);
  }

  // The tree is hidden behind an open file rather than thrown away, so stepping back returns to the
  // folders exactly as they were left — expanded, loaded, and scrolled — without rereading the disk.
  // Revisiting Files refreshes the tree and clean open files; pending drafts stay in their session.
  return (
    <div className="flex h-full min-h-0 flex-col">
      {selected ? (
        <FileViewer
          key={selected.path}
          entry={selected}
          source={source}
          draft={draft}
          baseline={baseline}
          error={error}
          loading={loading}
          saving={saving}
          saveError={saveError}
          fontSize={fontSize}
          onBack={closeFile}
          onOpenPath={(path) => void openFile({ name: folderName(path), path, isDirectory: false, isSymlink: false })}
          rootId={rootId}
          onDraftChange={changeDraft}
          onSave={saveFile}
        />
      ) : null}
      <div data-context-files className={`min-h-0 flex-1 flex-col ${selected ? "hidden" : "flex"}`}>
        <SearchInput inputRef={searchRef} value={query} placeholder="Search files" onChange={setQuery} />
        <ScrollArea className="min-h-0 flex-1">
          <div style={contentZoomStyle(fontSize)}>
            <FileTree
              key={`${rootId}:${fileBrowserVersion}`}
              root={root}
              rootId={rootId}
              query={query}
              onOpen={(entry) => void openFile(entry)}
              onLoad={onLoad}
            />
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

function DiffViewer({
  path,
  source,
  error,
  loading,
  fontSize,
  onBack,
}: {
  path: string;
  source: string;
  error: string;
  loading: boolean;
  fontSize: number;
  onBack: () => void;
}) {
  const viewer = usePreviewViewer<HTMLElement>(onBack);

  return (
    <section
      ref={viewer}
      aria-label={`Diff for ${path}`}
      tabIndex={-1}
      className="flex h-full min-h-0 flex-col outline-none"
      onKeyDown={(event) => previewKeyDown(event, onBack)}
    >
      <PreviewHeader
        path={path}
        backLabel="Back to Git"
        closeLabel="Close diff"
        icon={<FileDiff aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />}
        title={
          <span className="min-w-0 flex-1 truncate font-mono font-medium" title={path}>
            {path}
          </span>
        }
        onClose={onBack}
      />
      <ScrollArea className="min-h-0 flex-1">
        <div style={contentZoomStyle(fontSize)}>
          {loading ? (
            <Loading label="Reading diff…" />
          ) : error ? (
            <p role="alert" className="p-3 text-xs text-destructive">
              {error}
            </p>
          ) : source ? (
            <Suspense fallback={<Loading label="Opening diff…" />}>
              <CodePreview path={`${path}.diff`} source={source} />
            </Suspense>
          ) : (
            <p className="p-3 text-xs text-muted-foreground">This file has no text diff.</p>
          )}
        </div>
      </ScrollArea>
    </section>
  );
}

// What a porcelain status means to someone deciding what to commit, in the letters and colors editors use.
const CHANGE_KIND = {
  conflicted: { letter: "!", className: "text-red-700 dark:text-red-400" },
  modified: { letter: "M", className: "text-amber-700 dark:text-amber-400" },
  added: { letter: "A", className: "text-success" },
  deleted: { letter: "D", className: "text-red-700 dark:text-red-400" },
  untracked: { letter: "U", className: "text-success" },
} as const;

function changeKind(status: string): keyof typeof CHANGE_KIND {
  if (status === "??") return "untracked";
  if (status.includes("U") || status === "AA" || status === "DD") return "conflicted";
  if (status.includes("D")) return "deleted";
  if (status.includes("A")) return "added";
  return "modified";
}

// Each list opens with its first few entries, so the tab reads as a summary first, as Usage does.
const LIST_PREVIEW = { changes: 3, "pull requests": 5, issues: 5 } as const;
type ListName = keyof typeof LIST_PREVIEW;

// Pull requests and issues each sit in a card that opens with where they stand, as each of Usage's limits
// opens with its meter: the count in each state, and one bar split the same way across the whole list.
function GitHubItemsCard({
  label,
  items,
  loading,
  children,
}: {
  label: string;
  items: RepositoryGroup["items"];
  loading: boolean;
  children: ReactNode;
}) {
  const counts = (Object.keys(GITHUB_STATE_BAR) as (keyof typeof GITHUB_STATE_BAR)[])
    .map((state) => [state, items.filter((item) => item.state === state).length] as const)
    .filter(([, count]) => count);
  const summary = counts.map(([state, count]) => `${count} ${state}`).join(" · ");
  return (
    <section className="rounded-lg bg-muted/60 p-3">
      <h3 className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {label}
        {loading ? <Spinner className="size-3" aria-label={`Loading ${label.toLowerCase()}`} /> : null}
        <span className="ml-auto truncate font-normal tabular-nums">{summary}</span>
      </h3>
      {counts.length ? (
        <div role="img" aria-label={summary} className="mt-2 flex h-1.5 gap-0.5 overflow-hidden rounded-full">
          {counts.map(([state, count]) => (
            <span key={state} className={GITHUB_STATE_BAR[state]} style={{ flexGrow: count }} />
          ))}
        </div>
      ) : null}
      <div className="mt-2">{children}</div>
    </section>
  );
}

function RepositorySection({
  repository,
  loadingUrls,
  searching,
  onOpenDiff,
  onRemove,
}: {
  repository: RepositoryGroup;
  loadingUrls: string[];
  searching: boolean;
  onOpenDiff: (path: string) => void;
  onRemove?: () => void;
}) {
  const [expanded, setExpanded] = useState(() => new Set<string>());
  const allPullRequests = repository.items.filter((item) => item.kind === "pull request");
  const issues = repository.items.filter((item) => item.kind === "issue");
  // The newest pull request opened from the checked-out branch is the one this work is up for review in.
  const branchPullRequest =
    repository.path && repository.branch && !searching
      ? allPullRequests.find((item) => item.headBranch === repository.branch)
      : undefined;
  const pullRequests = allPullRequests.filter((item) => item !== branchPullRequest);
  const loadingKinds = new Set(
    loadingUrls
      .filter((url) => repository.url && githubRepositoryKey(url) === githubRepositoryKey(repository.url))
      .map((url) => githubReference(url).kind),
  );
  let additions = 0;
  let deletions = 0;
  for (const change of repository.changes) {
    additions += repository.lineDiffs[change.path]?.additions ?? 0;
    deletions += repository.lineDiffs[change.path]?.deletions ?? 0;
  }
  // Git counts lines only in files it tracks, so the totals say what they leave out.
  const untracked = repository.changes.filter((change) => change.status === "??").length;
  const lineScope = `Lines changed in tracked files${untracked ? `; ${untracked} untracked ${untracked === 1 ? "file is" : "files are"} not counted` : ""}`;
  const { sync, lastCommit } = repository;
  const shown = <T,>(name: ListName, list: T[]) =>
    searching || expanded.has(name) ? list : list.slice(0, LIST_PREVIEW[name]);
  const more = (name: ListName, count: number) =>
    !searching && count > LIST_PREVIEW[name] ? (
      <button
        type="button"
        className="-mx-1.5 flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-expanded={expanded.has(name)}
        onClick={() =>
          setExpanded((current) => (current.has(name) ? without(current, name) : including(current, name)))
        }
      >
        <ChevronRight className={cn("size-3", expanded.has(name) && "-rotate-90")} />
        {expanded.has(name) ? "Show fewer" : `${count - LIST_PREVIEW[name]} more`}
      </button>
    ) : null;
  const identity = (
    <>
      <GitHubLogomark className="size-5 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{repository.name}</span>
        {repository.path ? (
          <span className="block truncate text-xs text-muted-foreground" title={repository.path}>
            {tilde(repository.path)}
          </span>
        ) : null}
      </span>
    </>
  );

  return (
    <div className="flex flex-col gap-5 not-first:border-t not-first:pt-5">
      <div className="group/repository flex items-center gap-2">
        {repository.url ? (
          <button
            type="button"
            className="-m-1.5 flex min-w-0 flex-1 items-center gap-2.5 rounded-md p-1.5 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            title={`Open ${repository.url}`}
            data-context-url={repository.url}
            onClick={() => void invoke("open_url", { url: repository.url })}
          >
            {identity}
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2.5">{identity}</div>
        )}
        {repository.branch ? (
          <Badge variant="secondary" className="max-w-1/2" title={repository.branch}>
            <GitBranch />
            <span className="truncate">{repository.branch}</span>
          </Badge>
        ) : null}
        {/* Keeps its place while unseen, and gives back the height a one-line header lacks, so revealing it
            on hover moves nothing. */}
        {onRemove ? (
          <ActionIconButton
            size="icon-sm"
            className="invisible -my-1 text-muted-foreground group-focus-within/repository:visible group-hover/repository:visible hover:text-destructive"
            tooltip="Remove repository"
            aria-label={`Remove ${repository.name}`}
            onClick={onRemove}
          >
            <Trash2 />
          </ActionIconButton>
        ) : null}
      </div>
      {/* The working tree is what the session is changing right now, so it leads, as context leads Usage:
          what is uncommitted, whether it is pushed, and the pull request it is up for review in. */}
      {repository.path && !searching ? (
        <section className="rounded-lg bg-muted/60 p-3">
          <p className="text-xs text-muted-foreground">Uncommitted changes</p>
          {repository.changes.length ? (
            <>
              <p className="mt-1 flex items-baseline gap-1.5">
                <span className="text-3xl font-semibold tracking-tight tabular-nums">
                  {formatNumber.format(repository.changes.length)}
                  {repository.changesTruncated ? "+" : ""}
                </span>
                <span className="text-sm text-muted-foreground">
                  {repository.changes.length === 1 ? "file" : "files"}
                </span>
                <span className="ml-auto flex gap-1.5 font-mono text-sm font-medium" title={lineScope}>
                  <span className="text-green-600 dark:text-green-400">+{formatNumber.format(additions)}</span>
                  <span className="text-red-600 dark:text-red-400">-{formatNumber.format(deletions)}</span>
                </span>
              </p>
              {additions + deletions ? (
                <Progress
                  value={(additions / (additions + deletions)) * 100}
                  aria-label={`${additions} lines added, ${deletions} removed`}
                  className="mt-3 [&_[data-slot=progress-indicator]]:bg-success [&_[data-slot=progress-track]]:h-2 [&_[data-slot=progress-track]]:bg-destructive"
                />
              ) : null}
            </>
          ) : (
            <p className="mt-1 flex items-center gap-2 text-xl font-semibold tracking-tight">
              <CircleCheck className="size-5 text-success" />
              Clean
            </p>
          )}
          {sync || lastCommit ? (
            <p className="mt-2 flex gap-3 text-xs text-muted-foreground tabular-nums">
              {sync ? (
                <span className="truncate" title={sync.upstream ?? undefined}>
                  {sync.upstream
                    ? [sync.ahead && `${sync.ahead} to push`, sync.behind && `${sync.behind} to pull`]
                        .filter(Boolean)
                        .join(" · ") || "Up to date"
                    : "Not pushed"}
                </span>
              ) : null}
              {lastCommit ? (
                <span className="ml-auto shrink-0" title={lastCommit.subject}>
                  committed {relativeAge(lastCommit.committedAt)}
                </span>
              ) : null}
            </p>
          ) : null}
          {branchPullRequest ? (
            <div className="mt-3 border-t pt-2">
              <p className="text-xs text-muted-foreground">This branch's pull request</p>
              <GitHubItemList items={[branchPullRequest]} />
            </div>
          ) : null}
        </section>
      ) : null}
      {repository.changes.length ? (
        <section>
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">Changes</h3>
          <div className="-mx-1.5">
            {shown("changes", repository.changes).map((change) => {
              const diff = repository.lineDiffs[change.path];
              const kind = changeKind(change.status);
              const slash = change.path.lastIndexOf("/");
              return (
                <button
                  key={`${change.status}:${change.path}`}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  aria-label={`View diff for ${change.path}`}
                  title={change.path}
                  onClick={() => onOpenDiff(change.path)}
                >
                  <span
                    className={cn(
                      "w-3 shrink-0 text-center font-mono text-xs font-semibold",
                      CHANGE_KIND[kind].className,
                    )}
                    title={kind}
                  >
                    {CHANGE_KIND[kind].letter}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs">
                    {change.path.slice(slash + 1)}
                    {slash > 0 ? (
                      <span className="ml-1.5 text-muted-foreground">{change.path.slice(0, slash)}</span>
                    ) : null}
                  </span>
                  {diff?.additions ? (
                    <span className="shrink-0 font-mono text-xs text-green-600 dark:text-green-400">
                      +{diff.additions}
                    </span>
                  ) : null}
                  {diff?.deletions ? (
                    <span className="shrink-0 font-mono text-xs text-red-600 dark:text-red-400">-{diff.deletions}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
          {more("changes", repository.changes.length)}
        </section>
      ) : null}
      {pullRequests.length || loadingKinds.has("pull request") ? (
        <GitHubItemsCard
          label={branchPullRequest ? "Other pull requests" : "Pull requests"}
          items={pullRequests}
          loading={loadingKinds.has("pull request")}
        >
          <GitHubItemList items={shown("pull requests", pullRequests)} />
          {more("pull requests", pullRequests.length)}
        </GitHubItemsCard>
      ) : null}
      {issues.length || loadingKinds.has("issue") ? (
        <GitHubItemsCard label="Issues" items={issues} loading={loadingKinds.has("issue")}>
          <GitHubItemList items={shown("issues", issues)} />
          {more("issues", issues.length)}
        </GitHubItemsCard>
      ) : null}
    </div>
  );
}

const usageCache = new Map<string, UsageSnapshot | null>();

export function clearInspectorCache(sessionId: string) {
  usageCache.delete(sessionId);
  fileEditorsBySession.delete(sessionId);
  const sessions = JSON.parse(localStorage.getItem(GITHUB_ITEMS_KEY) ?? "{}") as Record<string, GitHubItem[]>;
  delete sessions[sessionId];
  localStorage.setItem(GITHUB_ITEMS_KEY, JSON.stringify(sessions));
  const removed = JSON.parse(localStorage.getItem(REMOVED_GITHUB_ITEMS_KEY) ?? "{}") as Record<string, string[]>;
  delete removed[sessionId];
  localStorage.setItem(REMOVED_GITHUB_ITEMS_KEY, JSON.stringify(removed));
  const remembered = JSON.parse(localStorage.getItem(REMEMBERED_REFERENCES_KEY) ?? "{}") as Record<
    string,
    RememberedReferences
  >;
  delete remembered[sessionId];
  localStorage.setItem(REMEMBERED_REFERENCES_KEY, JSON.stringify(remembered));
  lastRendered.delete(sessionId);
}

function GitPanel({
  rootId,
  sessionId,
  remote,
  active,
  fontSize,
  searchRef,
  onLoad,
}: {
  rootId: string;
  sessionId: string;
  remote: string;
  active: boolean;
  fontSize: number;
  searchRef: Ref<HTMLInputElement>;
  onLoad: (tab: InspectorTab) => void;
}) {
  const [references, setReferences] = useState(() => namedInSession(sessionId, remote));
  const [status, setStatus] = useState<GitStatus | null>();
  const [items, setItems] = useState<GitHubItem[]>(() => sessionGitHubItems(sessionId));
  const [loadingUrls, setLoadingUrls] = useState(() =>
    mergeGitHubItems(
      items,
      references.explicit.map((url) => ({ url })),
    ).map((item) => item.url),
  );
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [diffPath, setDiffPath] = useState("");
  const [diffSource, setDiffSource] = useState("");
  const [diffError, setDiffError] = useState("");
  const [diffLoading, setDiffLoading] = useState(false);
  const diffRequest = useRef(0);

  // While Git is visible, follow the terminal text it summarizes after xterm has applied redraws.
  useEffect(() => {
    if (!active) return;
    let settle = 0;
    const scan = () => {
      const next = namedInSession(sessionId, remote);
      setReferences((current) => {
        // Alternate-screen redraws can hide earlier conversation text, so an observed reference stays
        // with this session until the user explicitly refreshes the panel. An ambiguous reference is
        // re-read instead: every repository named since widens its candidates, and each one was
        // already asked about when it was seen.
        const explicit = [...new Set([...current.explicit, ...next.explicit])];
        const certain = new Set(explicit.map(itemKey));
        const inferred = next.inferred.filter((group) => !group.some((url) => certain.has(itemKey(url))));
        const groups = (references: string[][]) => references.map((group) => group.join(" ")).join("\n");
        return explicit.length === current.explicit.length && groups(inferred) === groups(current.inferred)
          ? current
          : { explicit, inferred, remembered: next.remembered };
      });
    };
    const unsubscribe = subscribeTerminalOutput(sessionId, () => {
      window.clearTimeout(settle);
      settle = window.setTimeout(scan, 250);
    });
    scan();
    return () => {
      window.clearTimeout(settle);
      unsubscribe();
    };
  }, [active, remote, sessionId]);

  // GitHub's answers since the panel was last opened or refreshed, by item, with the reference set each
  // answered: what GitHub said, or null for an item it says does not exist. A listed item is asked again
  // whenever the references change; a candidate for an ambiguous reference only once. Nothing being asked
  // is asked again, so a busy session never overlaps its checks, and opening the panel asks afresh.
  const [answers, setAnswers] = useState(
    () => new Map<string, { item: GitHubItem | null; references: GitHubReferences }>(),
  );
  const asking = useRef(new Set<string>());
  useEffect(() => {
    if (active) setAnswers(new Map());
  }, [active]);

  // A named item belongs to the session once. Later checks update its GitHub state, but never remove it.
  // A bare reference or an unqualified command first has to be confirmed as recent activity, and every
  // candidate is asked about, so a repository named later can still hold the most active one.
  useEffect(() => {
    const visible = sessionGitHubItems(sessionId);
    const known = new Set(visible.map((item) => itemKey(item.url)));
    const shown = mergeGitHubItems(
      visible,
      references.explicit.map((url) => ({ url })),
    ).map((item) => item.url);
    // A bare reference to an item the session already lists, or listed until the user removed it, is that
    // item, not a new question.
    const listed = new Set([...shown.map(itemKey), ...removedGitHubItems(sessionId)]);
    const inferred = references.inferred.filter((group) => !group.some((url) => listed.has(itemKey(url))));
    const urls = [...shown, ...inferred.flat()];
    const keys = [...new Set(urls.map(itemKey))];
    const stale = (key: string) => {
      const answer = answers.get(key);
      return !answer || (listed.has(key) && answer.references !== references);
    };
    const missing = urls.filter((url) => stale(itemKey(url)) && !asking.current.has(itemKey(url)));
    if (missing.length) {
      for (const url of missing) asking.current.add(itemKey(url));
      // A check that never answered is not evidence against a link, which then shows as printed.
      void invoke<GitHubItem[]>("github_items", { urls: missing })
        .catch(() => missing.map(pendingGitHubItem))
        .then((checked) => {
          const found = new Map(checked.map((item) => [itemKey(item.url), item]));
          for (const url of missing) asking.current.delete(itemKey(url));
          setAnswers((current) => {
            const next = new Map(current);
            for (const url of missing) next.set(itemKey(url), { item: found.get(itemKey(url)) ?? null, references });
            return next;
          });
        });
    }
    const pending = new Set(keys.filter((key) => !answers.has(key)));
    if (pending.size) {
      setItems(visible);
      setLoadingUrls(shown.filter((url) => pending.has(itemKey(url))));
      return;
    }
    const checked = keys.map((key) => answers.get(key)?.item).filter((item): item is GitHubItem => !!item);
    const likely = new Set(likelyGitHubItems(checked, inferred));
    const updates = checked.filter((item) => (known.has(itemKey(item.url)) ? item.title !== null : likely.has(item)));
    // An item GitHub says does not exist, such as a link a redraw clipped, is forgotten rather than kept
    // as printed.
    const disowned = new Set(keys.filter((key) => answers.get(key)?.item === null));
    setItems(retainGitHubItems(sessionId, updates, disowned));
    setLoadingUrls([]);
  }, [answers, references, sessionId]);

  async function openDiff(path: string) {
    const request = ++diffRequest.current;
    setDiffPath(path);
    setDiffSource("");
    setDiffError("");
    setDiffLoading(true);
    try {
      const source = await invoke<string>("git_diff", { rootId, path });
      if (diffRequest.current === request) setDiffSource(source);
    } catch (reason) {
      if (diffRequest.current === request) setDiffError(String(reason));
    } finally {
      if (diffRequest.current === request) setDiffLoading(false);
    }
  }

  const closeDiff = useCallback(() => {
    diffRequest.current++;
    setDiffPath("");
  }, []);

  function removeRepository(repository: RepositoryGroup) {
    const url = repository.url;
    if (!url) return;
    const urls = items
      .filter((item) => githubRepositoryKey(item.url) === githubRepositoryKey(url))
      .map((item) => item.url);
    if (!urls.length) return;
    setGitHubItemsRemoved(sessionId, urls, true);
    setItems(sessionGitHubItems(sessionId));
    let toastId = "";
    toastId = toast.add({
      title: "Removed repository",
      description: repository.name,
      type: "success",
      timeout: 8000,
      actionProps: {
        children: "Undo",
        onClick: () => {
          setGitHubItemsRemoved(sessionId, urls, false);
          setItems(sessionGitHubItems(sessionId));
          toast.close(toastId);
        },
      },
    });
  }

  const refreshDiff = useEffectEvent(() => {
    if (diffPath) void openDiff(diffPath);
  });
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    setError("");
    void invoke<GitStatus | null>("git_status", { rootId })
      .then((status) => {
        if (!disposed) setStatus(status);
      })
      .catch((reason) => {
        if (!disposed) setError(String(reason));
      });
    refreshDiff();
    return () => {
      disposed = true;
    };
  }, [active, rootId]);

  useEffect(() => {
    if (status !== undefined || error) onLoad("git");
  }, [error, onLoad, status]);

  const removedRepositories = new Set(
    [...removedGitHubItems(sessionId)].map((item) => item.slice(0, item.lastIndexOf("#"))),
  );
  // A link waits for its GitHub check before it is shown; only one GitHub could not answer shows as printed.
  const checking = new Set(loadingUrls.map(itemKey));
  const repositories = repositoryGroups(
    remote,
    status ?? null,
    items.filter((item) => item.state !== null || !checking.has(itemKey(item.url))),
  ).filter((repository) => !repository.url || !removedRepositories.has(githubRepositoryKey(repository.url)));
  const itemRepositories = new Set(items.map((item) => githubRepositoryKey(item.url)));
  // Searching narrows each card to what matches — a changed path, an item's title or number, or the
  // repository's own name — and drops the cards left holding nothing.
  const lowered = query.trim().toLowerCase();
  const shown = lowered
    ? repositories
        .map((repository) => ({
          ...repository,
          changes: repository.changes.filter((change) => change.path.toLowerCase().includes(lowered)),
          items: repository.items.filter(
            (item) => `#${item.number}`.includes(lowered) || item.title?.toLowerCase().includes(lowered),
          ),
        }))
        .filter(
          (repository) =>
            repository.name.toLowerCase().includes(lowered) || repository.changes.length || repository.items.length,
        )
    : repositories;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {diffPath ? (
        <DiffViewer
          path={diffPath}
          source={diffSource}
          error={diffError}
          loading={diffLoading}
          fontSize={fontSize}
          onBack={closeDiff}
        />
      ) : null}
      <div className={`min-h-0 flex-1 flex-col ${diffPath ? "hidden" : "flex"}`}>
        <SearchInput inputRef={searchRef} value={query} placeholder="Search items" onChange={setQuery} />
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-5 p-3" style={contentZoomStyle(fontSize)}>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {shown.map((repository) => (
              <RepositorySection
                key={(repository.url ?? repository.path)?.toLowerCase()}
                repository={repository}
                loadingUrls={loadingUrls}
                searching={Boolean(lowered)}
                onOpenDiff={(path) => void openDiff(path)}
                onRemove={
                  repository.url && itemRepositories.has(githubRepositoryKey(repository.url))
                    ? () => removeRepository(repository)
                    : undefined
                }
              />
            ))}
            {lowered && status !== undefined && repositories.length && !shown.length ? (
              <p className="text-sm text-muted-foreground">No matches</p>
            ) : null}
            {status === null && !repositories.length ? (
              <Empty>
                <EmptyHeader>
                  <EmptyDescription>
                    This folder is not a Git repository, and this session has not named a GitHub pull request or issue.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : null}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

// Each harness and provider reports what it reports; Lite never fills the gap with a number of its own.
function missingUsage(session: Session): string {
  if (session.host) return "Remote sessions report no provider usage.";
  if (session.agent === "shell") return "Shell sessions report no provider usage.";
  if (session.agent === "codex" && session.provider && session.provider !== "openai")
    return `${providerLabel(session.provider)} publishes no account limits locally. Session context appears after the first response.`;
  if (session.agent === "claude") return "Account limits appear after any Lite Claude session receives a response.";
  return `${sessionLabel(session)} reports session context after its first response.`;
}

function UsagePanel({
  session,
  fontSize,
  active,
  onLoad,
}: {
  session: Session;
  fontSize: number;
  active: boolean;
  onLoad: (tab: InspectorTab) => void;
}) {
  const [usage, setUsage] = useState<UsageSnapshot | null | undefined>(() => usageCache.get(session.id));
  const [error, setError] = useState("");

  // Usage is read while it is visible, and again a second after each turn ends, when the harness has
  // written it. Claude can also switch models mid-turn, and its status line rewrites the local snapshot
  // 300 ms later, so for Claude any output starts that second; the other harnesses are read once per
  // finished turn, which Codex marks with a notification and whose read starts an app server.
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let settle = 0;
    const read = () => {
      setError("");
      void invoke<UsageSnapshot | null>("read_usage", {
        agent: session.agent,
        provider: session.provider,
        sessionId: session.id,
        host: session.host,
      })
        .then((next) => {
          if (!disposed) {
            usageCache.set(session.id, next);
            setUsage(next);
          }
        })
        .catch((reason) => {
          if (!disposed) setError(String(reason));
        })
        .finally(() => {
          if (!disposed) onLoad("usage");
        });
    };
    read();
    const settled = () => {
      window.clearTimeout(settle);
      settle = window.setTimeout(read, 1000);
    };
    const unsubscribe =
      session.agent === "claude"
        ? subscribeTerminalOutput(session.id, settled)
        : subscribeNotifications(session.id, settled);
    return () => {
      disposed = true;
      window.clearTimeout(settle);
      unsubscribe();
    };
  }, [active, onLoad, session.agent, session.provider, session.id, session.host]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-3" style={contentZoomStyle(fontSize)}>
          <div className="mb-3 flex items-center gap-2.5">
            <ProviderIcon agent={session.agent} provider={session.provider} className="size-5 shrink-0" />
            <span className="min-w-0 flex-1">
              {usage?.model ? (
                <span className="block truncate text-sm font-medium" title={usage.model}>
                  {usage.model}
                </span>
              ) : null}
              <span className={usage?.model ? "block truncate text-xs text-muted-foreground" : "text-sm font-medium"}>
                {session.agent === "codex" && session.provider
                  ? providerLabel(session.provider)
                  : sessionLabel(session)}
              </span>
            </span>
            {usage?.reasoning ? (
              <Badge variant="secondary" title="Reasoning">
                <Brain />
                {usage.reasoning}
              </Badge>
            ) : null}
          </div>
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : usage === undefined ? (
            <Loading label="Reading provider usage…" />
          ) : usage === null ? (
            <Empty>
              <EmptyHeader>
                <EmptyDescription>{missingUsage(session)}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="flex flex-col gap-5">
              {/* This conversation's context is the number a session acts on, so it leads. */}
              {usage.contextUsedPercent != null || usage.contextTokens != null ? (
                <section className="rounded-lg bg-muted/60 p-3">
                  <p className="text-xs text-muted-foreground">Context used</p>
                  <p className="mt-1 flex items-baseline gap-1.5">
                    {usage.contextTokens != null ? (
                      <span className="text-3xl font-semibold tracking-tight tabular-nums">
                        {formatNumber.format(usage.contextTokens)}
                      </span>
                    ) : null}
                    {usage.contextWindow ? (
                      <span className="text-sm text-muted-foreground">
                        of {formatNumber.format(usage.contextWindow)}
                      </span>
                    ) : null}
                    {usage.contextUsedPercent != null ? (
                      <span className="ml-auto text-sm font-medium tabular-nums">
                        {Math.round(usage.contextUsedPercent)}%
                      </span>
                    ) : null}
                  </p>
                  {usage.contextUsedPercent != null ? (
                    <Meter
                      label="Context used"
                      value={usage.contextUsedPercent}
                      className="mt-3 [&_[data-slot=progress-track]]:h-2"
                    />
                  ) : null}
                  <p className="mt-2 flex text-xs text-muted-foreground tabular-nums">
                    {usage.contextWindow && usage.contextTokens != null ? (
                      <span>{formatNumber.format(Math.max(0, usage.contextWindow - usage.contextTokens))} left</span>
                    ) : null}
                    {usage.costUsd != null ? <span className="ml-auto">${usage.costUsd.toFixed(2)} so far</span> : null}
                  </p>
                </section>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Session context appears after this harness reports its first response.
                </p>
              )}
              {usage.windows.length || usage.bankedResets != null || usage.lifetimeTokens != null ? (
                <section className="flex flex-col gap-4">
                  <h3 className="text-xs font-medium text-muted-foreground">Plan limits</h3>
                  {usage.windows.map((window) => {
                    const wait = window.resetsAt == null ? undefined : waitUntil(window.resetsAt);
                    return (
                      <div key={`${window.label}-${window.windowMinutes ?? ""}`} className="flex flex-col gap-1.5">
                        <p className="flex items-baseline gap-2 text-sm">
                          <span className="truncate">{window.label}</span>
                          <span className="text-muted-foreground tabular-nums">{Math.round(window.usedPercent)}%</span>
                          {wait ? (
                            <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                              {wait} left
                            </span>
                          ) : null}
                        </p>
                        <Meter label={window.label} value={window.usedPercent} />
                        {window.resetsAt != null ? (
                          <p className="text-right text-xs text-muted-foreground first-letter:uppercase">
                            {dayAndTime(window.resetsAt)}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                  {usage.bankedResets != null ? (
                    <div className="flex flex-col gap-1">
                      <p className="flex items-baseline gap-2 text-sm">
                        Banked resets
                        <span className="ml-auto text-muted-foreground tabular-nums">
                          {usage.bankedResets} available
                        </span>
                      </p>
                      {usage.bankedResetExpiries.map((expiresAt, index) => (
                        <p key={index} className="text-xs text-muted-foreground">
                          Reset {index + 1}: {expiresAt == null ? "No expiry" : `Expires ${timeUntil(expiresAt)}`}
                        </p>
                      ))}
                      {usage.bankedResets > usage.bankedResetExpiries.length ? (
                        <p className="text-xs text-muted-foreground">Expiry dates unavailable for remaining resets.</p>
                      ) : null}
                    </div>
                  ) : null}
                  {usage.lifetimeTokens != null ? (
                    <p className="flex items-baseline gap-2 text-sm">
                      Provider total
                      <span className="ml-auto text-muted-foreground tabular-nums">
                        {formatNumber.format(usage.lifetimeTokens)} tokens
                      </span>
                    </p>
                  ) : null}
                </section>
              ) : null}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

export const Inspector = memo(function Inspector({
  session,
  remote,
  fontSize,
  fileBrowserVersion,
  collapsed,
  onExpand,
  onCollapse,
}: {
  session: Session;
  remote: string;
  fontSize: number;
  fileBrowserVersion: number;
  collapsed: boolean;
  onExpand: () => void;
  onCollapse: () => void;
}) {
  const [tab, setTab] = useState<InspectorTab>(inspectorTab);
  const fileSearch = useRef<HTMLInputElement>(null);
  const gitSearch = useRef<HTMLInputElement>(null);
  const [visited, setVisited] = useState(() => new Set<string>([tab]));
  // A tab already names the panel it shows, so the panel does not name itself again. The refresh button
  // rebuilds whichever is open, and every explicit tab visit requests a fresh snapshot as well.
  const [reload, setReload] = useState({ files: 0, git: 0, usage: 0 });
  const [refreshing, setRefreshing] = useState<InspectorTab | undefined>(tab);

  const finishRefresh = useCallback((value: InspectorTab) => {
    setRefreshing((current) => (current === value ? undefined : current));
  }, []);

  function refreshTab(value: InspectorTab) {
    setRefreshing(value);
    setReload((counts) => ({ ...counts, [value]: counts[value] + 1 }));
  }

  function selectTab(value: string) {
    const next = value as InspectorTab;
    inspectorTab = next;
    setTab(next);
    setVisited((current) => including(current, next));
    if (next !== "git") refreshTab(next);
  }

  // Collapsed, the panel is the strip of tabs it collapsed from: the one you pick is the one it reopens
  // on. Returning to a tab reads its current state without polling while it is hidden.
  const rail = (
    <div
      data-context-surface
      className="flex h-full animate-in flex-col items-center gap-0.5 py-1.5 fade-in duration-200"
    >
      <ActionIconButton
        size="icon-sm"
        tooltip="Expand panel"
        tooltipSide="left"
        aria-label="Expand panel"
        data-context-expand-panel
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
            selectTab(value);
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
      <div
        data-context-surface
        className={collapsed ? "hidden" : "h-full"}
        onKeyDownCapture={(event) => {
          if (matchesShortcut(event.nativeEvent, "find")) {
            const input = tab === "files" ? fileSearch.current : tab === "git" ? gitSearch.current : null;
            if (!input?.offsetParent) return;
            event.preventDefault();
            input.focus();
            input.select();
          }
        }}
      >
        <Tabs value={tab} onValueChange={selectTab} className="h-full min-h-0 gap-0">
          <div className="flex h-11 shrink-0 items-center gap-0.5 border-b pr-3 pl-1.5">
            <ActionIconButton
              size="icon-sm"
              tooltip="Collapse panel"
              aria-label="Collapse panel"
              data-context-collapse-panel
              onClick={onCollapse}
            >
              <ChevronRight />
            </ActionIconButton>
            <TabsList variant="line">
              {TABS.map(({ value, label, icon: Icon }) => (
                <Tooltip key={value}>
                  <TooltipTrigger
                    render={
                      <TabsTrigger
                        value={value}
                        aria-label={label}
                        onClick={tab === value ? () => refreshTab(value) : undefined}
                      />
                    }
                  >
                    <Icon />
                  </TooltipTrigger>
                  <TooltipContent>{label}</TooltipContent>
                </Tooltip>
              ))}
            </TabsList>
            {tab === "usage" && session.agent === "shell" ? null : (
              <ActionIconButton
                size="icon-sm"
                className="ml-auto"
                tooltip={refreshing === tab ? "Refreshing…" : "Refresh"}
                aria-label={refreshing === tab ? "Refreshing" : "Refresh"}
                data-context-refresh
                disabled={refreshing === tab}
                onClick={() => refreshTab(tab as keyof typeof reload)}
              >
                <RefreshCw className={refreshing === tab ? "animate-spin" : undefined} />
              </ActionIconButton>
            )}
          </div>
          {visited.has("files") ? (
            <TabsContent value="files" keepMounted className="min-h-0 overflow-hidden">
              <FilesPanel
                key={`${session.rootId}:${reload.files}`}
                root={session.cwd}
                rootId={session.rootId}
                sessionId={session.id}
                fontSize={fontSize}
                fileBrowserVersion={fileBrowserVersion}
                searchRef={fileSearch}
                onLoad={finishRefresh}
              />
            </TabsContent>
          ) : null}
          {visited.has("git") ? (
            <TabsContent value="git" keepMounted className="min-h-0 overflow-hidden">
              <GitPanel
                key={`${session.rootId}:${reload.git}`}
                rootId={session.rootId}
                sessionId={session.id}
                remote={remote}
                active={tab === "git" && !collapsed}
                fontSize={fontSize}
                searchRef={gitSearch}
                onLoad={finishRefresh}
              />
            </TabsContent>
          ) : null}
          {visited.has("usage") ? (
            <TabsContent value="usage" keepMounted className="min-h-0 overflow-hidden">
              <UsagePanel
                key={reload.usage}
                session={session}
                fontSize={fontSize}
                active={tab === "usage" && !collapsed}
                onLoad={finishRefresh}
              />
            </TabsContent>
          ) : null}
        </Tabs>
      </div>
    </>
  );
});
