// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { invoke } from "@tauri-apps/api/core";
import {
  ChartNoAxesColumn,
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleCheck,
  CircleDot,
  Container,
  Database,
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileCog,
  FileDiff,
  FileImage,
  FileJson,
  FileKey,
  FileLock,
  FileSpreadsheet,
  FileTerminal,
  FileText,
  FileType,
  FileVideo,
  Folder,
  GitBranch,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  Hammer,
  type LucideIcon,
  RefreshCw,
  Scale,
  Search,
  X,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { GitHubLogomark, ProviderIcon } from "@/brand-icons";
import { Badge } from "@/components/ui/badge";
import { ActionIconButton } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { readOutput } from "@/output-store";
import {
  type DirectoryCursor,
  type DirectoryListing,
  type FileEntry,
  type GitStatus,
  type Session,
  sessionLabel,
} from "@/types";

const CodePreview = lazy(() => import("@/code-preview"));

// A session's terminal is the only record of what it worked on, so what it named is read back out of
// the output Lite already keeps: every whole pull request or issue link GitHub prints verbatim, and
// every bare "#12" the conversation names one by. A bare number is a guess — it is as easily a line
// number — so it is sent separately and only shown once GitHub confirms it names real work in the
// session's own repository, which is the only repository a bare number can mean.
// Only CSI is stripped, so a link inside an OSC hyperlink survives being uncoloured.
// biome-ignore lint/suspicious/noControlCharactersInRegex: a color code has to be named to be removed.
const COLOR = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const GITHUB_ITEM = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(?:pull|issues)\/\d+/g;
const BARE_ITEM = /(?:^|[^\w#])#([1-9]\d{0,8})(?!\w)/g;

function namedInSession(sessionId: string, remote: string) {
  const text = readOutput(sessionId).replace(COLOR, "");
  const urls = [...new Set(text.match(GITHUB_ITEM) ?? [])];
  // A guess is spelled with the lowercase host the checker strips, however the remote cased it.
  const prefix = "https://github.com/";
  const base = remote.toLowerCase().startsWith(prefix) ? prefix + remote.slice(prefix.length) : "";
  const numbers = new Set(base ? [...text.matchAll(BARE_ITEM)].map((match) => match[1]) : []);
  for (const url of urls) {
    if (url.toLowerCase().startsWith(`${base.toLowerCase()}/`)) numbers.delete(url.split("/").pop() ?? "");
  }
  return { urls, guessed: [...numbers].map((number) => `${base}/issues/${number}`) };
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

// Every optional field arrives from Serde as null, never as a missing key. A state of null is a link
// GitHub could not be asked about rather than one it disowned; those are dropped before they arrive.
interface GitHubItem {
  url: string;
  title: string | null;
  state: keyof typeof GITHUB_STATE | null;
  occurredAt: string | null;
}

// The colors GitHub itself answers in, so a glance here reads the same as a glance there.
const GITHUB_STATE = {
  open: "success",
  draft: "secondary",
  merged: "purple",
  closed: "error",
} as const;

const GITHUB_STATE_ICON = {
  open: "text-success",
  draft: "text-muted-foreground",
  merged: "text-violet-700 dark:text-violet-400",
  closed: "text-red-700 dark:text-red-400",
} as const;

interface RepositoryGroup {
  branch: string | null;
  changes: string[];
  changesTruncated: boolean;
  items: (GitHubItem & GitHubReference)[];
  name: string;
  path: string | null;
  url: string | null;
}

function repositoryName(url: string) {
  return url.replace(/^https:\/\/[^/]+\//, "");
}

function relativeAge(timestamp: string) {
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
      items: [],
      name: remote ? repositoryName(remote) : status.worktree.split(/[\\/]/).filter(Boolean).pop() || status.worktree,
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

function GitHubItemList({ label, items }: { label: string; items: RepositoryGroup["items"] }) {
  if (!items.length) return null;
  return (
    <div className="border-t">
      <p className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground">{label}</p>
      <ItemGroup className="has-data-[size=xs]:gap-0">
        {items.map(({ url, title, state, occurredAt, kind, number }) => (
          <Item
            key={url}
            size="xs"
            className="flex-nowrap items-start rounded-none px-3 text-left hover:bg-muted"
            render={
              <button
                type="button"
                title={url}
                data-context-url={url}
                onClick={() => void invoke("open_url", { url })}
              />
            }
          >
            <ItemMedia variant="icon" className={state ? GITHUB_STATE_ICON[state] : "text-muted-foreground"}>
              <GitHubItemIcon kind={kind} state={state} />
            </ItemMedia>
            <ItemContent>
              <ItemTitle className="w-full">{title ?? `#${number}`}</ItemTitle>
              {title ? (
                <div className="flex min-w-0 items-center gap-2">
                  <ItemDescription className="min-w-0 flex-1 truncate font-mono">
                    #{number}
                    {occurredAt ? ` · ${relativeAge(occurredAt)}` : ""}
                  </ItemDescription>
                  {state ? <Badge variant={GITHUB_STATE[state]}>{state}</Badge> : null}
                </div>
              ) : null}
            </ItemContent>
          </Item>
        ))}
      </ItemGroup>
    </div>
  );
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

// A quota window turns over on the minute as far as anyone using it is concerned, so it is named to
// the minute; the seconds only ever changed the width of the line.
const formatTime = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

// A tree is read by shape before it is read by name, so each family of file gets its own icon and its
// own color and the plain sheet is left for the types nothing here recognizes. Languages are colored
// the way their own ecosystems are, which is what makes a folder scannable at a glance.
type FileKind = { icon: LucideIcon; color: string };

const FILE_FAMILIES: (FileKind & { extensions: string[] })[] = [
  { icon: FileCode, color: "text-sky-500", extensions: ["py", "pyi", "pyw"] },
  { icon: FileCode, color: "text-amber-500", extensions: ["js", "jsx", "mjs", "cjs"] },
  { icon: FileCode, color: "text-blue-500", extensions: ["ts", "tsx", "mts", "cts"] },
  { icon: FileCode, color: "text-orange-600", extensions: ["rs"] },
  { icon: FileCode, color: "text-cyan-500", extensions: ["go"] },
  { icon: FileCode, color: "text-violet-500", extensions: ["c", "cc", "cpp", "cxx", "h", "hpp", "cs", "java", "kt"] },
  { icon: FileCode, color: "text-rose-500", extensions: ["rb", "php", "swift"] },
  { icon: FileCode, color: "text-orange-500", extensions: ["html", "htm", "xml", "vue", "svelte"] },
  { icon: FileCode, color: "text-fuchsia-500", extensions: ["css", "scss", "sass", "less"] },
  { icon: FileJson, color: "text-amber-500", extensions: ["json", "jsonc", "json5"] },
  { icon: FileCog, color: "text-stone-500", extensions: ["yaml", "yml", "toml", "ini", "cfg", "conf", "editorconfig"] },
  { icon: FileCog, color: "text-stone-500", extensions: ["gitignore", "gitattributes", "dockerignore"] },
  { icon: FileKey, color: "text-amber-600", extensions: ["env", "pem", "key", "crt", "cert"] },
  { icon: FileLock, color: "text-stone-500", extensions: ["lock", "lockb"] },
  { icon: FileTerminal, color: "text-emerald-500", extensions: ["sh", "bash", "zsh", "fish", "ps1", "bat", "cmd"] },
  { icon: FileImage, color: "text-pink-500", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "avif"] },
  { icon: FileAudio, color: "text-purple-500", extensions: ["mp3", "wav", "flac", "ogg", "m4a"] },
  { icon: FileVideo, color: "text-purple-500", extensions: ["mp4", "mov", "mkv", "webm", "avi"] },
  { icon: FileSpreadsheet, color: "text-green-600", extensions: ["csv", "tsv", "xls", "xlsx", "parquet"] },
  { icon: FileArchive, color: "text-stone-500", extensions: ["zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar"] },
  { icon: Database, color: "text-indigo-500", extensions: ["sql", "db", "sqlite", "sqlite3"] },
  { icon: FileType, color: "text-muted-foreground", extensions: ["woff", "woff2", "ttf", "otf"] },
  { icon: FileDiff, color: "text-muted-foreground", extensions: ["diff", "patch"] },
  { icon: FileText, color: "text-muted-foreground", extensions: ["md", "mdx", "rst", "txt", "adoc"] },
];

const FILE_TYPES = new Map<string, FileKind>(
  FILE_FAMILIES.flatMap(({ icon, color, extensions }) => extensions.map((extension) => [extension, { icon, color }])),
);

// The few files a project names rather than extends, which say more than the extension they lack.
const FILE_NAMES = new Map<string, FileKind>([
  ["dockerfile", { icon: Container, color: "text-blue-500" }],
  ["makefile", { icon: Hammer, color: "text-stone-500" }],
  ["cmakelists.txt", { icon: Hammer, color: "text-stone-500" }],
  ["license", { icon: Scale, color: "text-muted-foreground" }],
]);

function FileIcon({ name }: { name: string }) {
  const lower = name.toLowerCase();
  const kind = FILE_NAMES.get(lower) ?? FILE_TYPES.get(lower.split(".").pop() ?? "");
  const Icon = kind?.icon ?? File;
  return <Icon className={`size-3.5 shrink-0 ${kind?.color ?? "text-muted-foreground"}`} />;
}

function Loading({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
      <Spinner />
      {label}
    </div>
  );
}

// The same field the sidebar searches sessions with, placed the same way: it names the panel it
// narrows, and Escape empties it.
function SearchInput({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="shrink-0 border-b p-2">
      <InputGroup>
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          value={value}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onChange("");
          }}
        />
      </InputGroup>
    </div>
  );
}

// A window that is nearly spent is the one thing here worth a color, so it recolors the bar it fills.
function Meter({ label, value }: { label: string; value: number }) {
  const bounded = Math.max(0, Math.min(100, value));
  return (
    <Progress
      value={bounded}
      className={bounded >= 90 ? "[&_[data-slot=progress-indicator]]:bg-destructive" : undefined}
    >
      <ProgressLabel className="truncate">{label}</ProgressLabel>
      <ProgressValue />
    </Progress>
  );
}

function FileTree({
  root,
  rootId,
  query,
  onOpen,
}: {
  root: string;
  rootId: string;
  query: string;
  onOpen: (entry: FileEntry) => void;
}) {
  const [children, setChildren] = useState<Record<string, DirectoryListing & { after: DirectoryCursor | null }>>({});
  // The root is the folder the session works in; showing it shut asks for a click to say what the
  // panel is already for, so it opens with the tree it was asked to show.
  const [expanded, setExpanded] = useState(() => new Set<string>([root]));
  const loading = useRef(new Set<string>());
  const [loadingPaths, setLoadingPaths] = useState(() => new Set<string>());
  const [expandingAll, setExpandingAll] = useState(false);
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

  // "Expand all" and search walk the same tree: the one loads it to open it, the other to look
  // through it, and neither disturbs which folders were open once a search is cleared.
  const walked = useRef(false);
  async function walk(expand: boolean) {
    setExpandingAll(true);
    const nextChildren = { ...children };
    const directories = new Set<string>();
    const pending = [root];
    try {
      while (pending.length) {
        const path = pending.shift();
        if (!path || directories.has(path)) continue;
        directories.add(path);
        // A directory is walked through every page it has: a walk that silently stopped at the first
        // 250 entries would answer "No matches" about a file that exists.
        let listing = nextChildren[path];
        if (!listing || listing.after || listing.nextCursor) {
          let entries: FileEntry[] = [];
          let cursor: DirectoryCursor | null = null;
          do {
            const page: DirectoryListing = await invoke("list_directory", { rootId, path, after: cursor });
            entries = entries.concat(page.entries);
            cursor = page.nextCursor;
          } while (cursor);
          listing = { entries, nextCursor: null, after: null };
          nextChildren[path] = listing;
        }
        pending.push(
          ...listing.entries.filter((entry) => entry.isDirectory && !entry.isSymlink).map((entry) => entry.path),
        );
      }
      setChildren(nextChildren);
      if (expand) setExpanded(directories);
      walked.current = true;
      setError("");
    } catch (reason) {
      setError(String(reason));
    } finally {
      setExpandingAll(false);
    }
  }

  // A search has to see the whole tree, so the first keystroke loads it and the next query — not the
  // render a failure causes — retries a walk that failed; one that succeeded is not repeated, and a
  // cleared search forgets the failure so the same query asks again.
  const attempted = useRef("");
  useEffect(() => {
    if (!query) attempted.current = "";
    else if (query !== attempted.current && !walked.current && !expandingAll) {
      attempted.current = query;
      void walk(false);
    }
  });

  const lowered = query.trim().toLowerCase();

  // A folder is worth showing while searching if anything under it matches; only loaded listings can
  // answer, which is what the walk above is for.
  function subtreeMatches(path: string): boolean {
    const listing = children[path];
    return !!listing?.entries.some(
      (entry) => entry.name.toLowerCase().includes(lowered) || (entry.isDirectory && subtreeMatches(entry.path)),
    );
  }

  function rows(path: string, depth = 0): React.ReactNode {
    const listing = children[path];
    if (!listing) {
      if (loadingPaths.has(path)) return <Loading label="Reading folder…" />;
      return error ? <p className="p-3 text-xs text-destructive">{error}</p> : null;
    }
    const entries = lowered
      ? listing.entries.filter(
          (entry) => entry.name.toLowerCase().includes(lowered) || (entry.isDirectory && subtreeMatches(entry.path)),
        )
      : listing.entries;
    return (
      <>
        {entries.map((entry) => {
          const open = entry.isDirectory && (expanded.has(entry.path) || (!!lowered && subtreeMatches(entry.path)));
          return (
            <div key={entry.path}>
              <button
                type="button"
                className="flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-left text-xs hover:bg-muted"
                style={{ paddingLeft: `${8 + depth * 14}px` }}
                data-context-value={entry.path}
                data-context-label="Copy path"
                data-context-directory={entry.isDirectory ? "" : undefined}
                data-context-expanded={entry.isDirectory ? expanded.has(entry.path) : undefined}
                onClick={() => (entry.isDirectory ? void toggle(entry.path) : onOpen(entry))}
              >
                {entry.isDirectory ? (
                  <>
                    <ChevronRight
                      className={`size-3.5 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
                    />
                    <Folder className="size-3.5 fill-current text-muted-foreground" />
                  </>
                ) : (
                  <>
                    <span className="w-3.5" />
                    <FileIcon name={entry.name} />
                  </>
                )}
                <span className="truncate">{entry.name}</span>
              </button>
              {open ? rows(entry.path, depth + 1) : null}
            </div>
          );
        })}
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
  const rootOpen = !!lowered || expanded.has(root);
  return (
    <div className="py-2">
      <div className="flex items-center pr-1">
        <button
          type="button"
          className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 text-left text-xs font-medium hover:bg-muted"
          data-context-value={root}
          data-context-label="Copy path"
          data-context-directory
          data-context-expanded={expanded.has(root)}
          onClick={() => void toggle(root)}
        >
          <ChevronRight
            className={`size-3.5 text-muted-foreground transition-transform ${rootOpen ? "rotate-90" : ""}`}
          />
          <Folder className="size-3.5 fill-current text-muted-foreground" />
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
      {/* A walk that failed searched a partial tree, so its error shows over whatever it did find. */}
      {lowered && error ? <p className="p-3 text-xs text-destructive">{error}</p> : null}
      {lowered && !error && !expandingAll && children[root] && !subtreeMatches(root) ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">No matches</p>
      ) : null}
      {rootOpen ? rows(root, 1) : null}
    </div>
  );
}

function FilesPanel({ root, rootId }: { root: string; rootId: string }) {
  const [selected, setSelected] = useState<FileEntry | null>(null);
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

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
          <FileIcon name={selected.name} />
          <span className="min-w-0 flex-1 truncate font-mono text-xs">{selected.name}</span>
          <ActionIconButton
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
    <div data-context-files className="flex h-full min-h-0 flex-col">
      <SearchInput value={query} placeholder="Search files" onChange={setQuery} />
      <ScrollArea className="min-h-0 flex-1">
        <FileTree root={root} rootId={rootId} query={query} onOpen={(entry) => void openFile(entry)} />
      </ScrollArea>
    </div>
  );
}

function RepositoryCard({ repository }: { repository: RepositoryGroup }) {
  const pullRequests = repository.items.filter((item) => item.kind === "pull request");
  const issues = repository.items.filter((item) => item.kind === "issue");
  const header = (
    <>
      <span className="flex min-w-0 w-full items-center gap-2.5">
        <GitHubLogomark className="size-5 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{repository.name}</span>
          {repository.path ? (
            <span className="block truncate font-mono text-xs text-muted-foreground" title={repository.path}>
              {repository.path}
            </span>
          ) : null}
        </span>
      </span>
      {repository.branch ? (
        <span className="flex min-w-0 w-full items-center gap-1.5 pl-8">
          <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate font-mono text-xs">{repository.branch}</span>
          {repository.changes.length ? (
            <Badge variant="secondary">
              {repository.changes.length}
              {repository.changesTruncated ? "+" : ""} changed
            </Badge>
          ) : null}
        </span>
      ) : null}
    </>
  );

  return (
    <section className="overflow-hidden rounded-lg border">
      {repository.url ? (
        <button
          type="button"
          className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5 text-left hover:bg-muted"
          title={`Open ${repository.url}`}
          data-context-url={repository.url}
          onClick={() => void invoke("open_url", { url: repository.url })}
        >
          {header}
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5">{header}</div>
      )}
      {repository.changes.length ? (
        <div className="border-t px-2.5 py-2">
          <p className="mb-1 px-0.5 text-xs font-medium">Changes</p>
          {repository.changes.map((change) => (
            <div key={change} className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted">
              <span className="w-5 shrink-0 font-mono text-xs text-muted-foreground">{change.slice(0, 2).trim()}</span>
              <span className="min-w-0 truncate font-mono text-xs" title={change.slice(3)}>
                {change.slice(3)}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      <GitHubItemList label="Pull requests" items={pullRequests} />
      <GitHubItemList label="Issues" items={issues} />
    </section>
  );
}

// Revisiting a session paints its last small metadata snapshot immediately, then the mounted panel
// rereads the owner in the background. File contents stay out of these caches.
const gitStatusCache = new Map<string, GitStatus | null>();
const githubItemsCache = new Map<string, GitHubItem[]>();
const usageCache = new Map<string, UsageSnapshot | null>();

export function clearInspectorCache(sessionId: string, rootId: string) {
  gitStatusCache.delete(rootId);
  githubItemsCache.delete(sessionId);
  usageCache.delete(sessionId);
}

function GitPanel({ rootId, sessionId, remote }: { rootId: string; sessionId: string; remote: string }) {
  // A mount revalidates the cached snapshot, and the refresh button mounts the panel again. Nothing
  // watches Git or GitHub between those explicit reads.
  const named = useMemo(() => namedInSession(sessionId, remote), [sessionId, remote]);
  const [status, setStatus] = useState<GitStatus | null | undefined>(() => gitStatusCache.get(rootId));
  const [items, setItems] = useState<GitHubItem[] | undefined>(() => githubItemsCache.get(sessionId));
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  // Asking GitHub on mount updates the stale snapshot already painted above.
  useEffect(() => {
    if (!named.urls.length && !named.guessed.length) {
      githubItemsCache.set(sessionId, []);
      return setItems([]);
    }
    let disposed = false;
    void invoke<GitHubItem[]>("github_items", { urls: named.urls, guessed: named.guessed })
      .then((checked) => {
        if (!disposed) {
          githubItemsCache.set(sessionId, checked);
          setItems(checked);
        }
      })
      // A link that could not be checked is still a link, so it is shown the way it was printed; a
      // guessed number without GitHub's confirmation is not.
      .catch(() => {
        if (!disposed) {
          const unchecked = named.urls.map((url) => ({ url, title: null, state: null, occurredAt: null }));
          githubItemsCache.set(sessionId, unchecked);
          setItems(unchecked);
        }
      });
    return () => {
      disposed = true;
    };
  }, [named, sessionId]);

  useEffect(() => {
    let disposed = false;
    setError("");
    void invoke<GitStatus | null>("git_status", { rootId })
      .then((next) => {
        if (!disposed) {
          gitStatusCache.set(rootId, next);
          setStatus(next);
        }
      })
      .catch((reason) => {
        if (!disposed) setError(String(reason));
      });
    return () => {
      disposed = true;
    };
  }, [rootId]);

  const repositories = repositoryGroups(remote, status ?? null, items ?? []);
  // Searching narrows each card to what matches — a changed path, an item's title or number, or the
  // repository's own name — and drops the cards left holding nothing.
  const lowered = query.trim().toLowerCase();
  const shown = lowered
    ? repositories
        .map((repository) => ({
          ...repository,
          changes: repository.changes.filter((change) => change.slice(3).toLowerCase().includes(lowered)),
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
      <SearchInput value={query} placeholder="Search changes and items" onChange={setQuery} />
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 p-3">
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {!error && status === undefined ? <Loading label="Reading Git status…" /> : null}
          {shown.map((repository) => (
            <RepositoryCard key={(repository.url ?? repository.path)?.toLowerCase()} repository={repository} />
          ))}
          {lowered && status !== undefined && items && repositories.length && !shown.length ? (
            <p className="text-sm text-muted-foreground">No matches</p>
          ) : null}
          {items === undefined && (named.urls.length || named.guessed.length) ? (
            <Loading label="Checking GitHub links…" />
          ) : null}
          {status === null && items && !repositories.length ? (
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
  );
}

// Each harness and provider reports what it reports; Lite never fills the gap with a number of its own.
function missingUsage(session: Session): string {
  if (session.agent === "shell") return "Shell sessions report no provider usage.";
  if (session.agent === "kimi") return "Kimi Code keeps session usage inside its own terminal view.";
  if (session.agent === "codex" && session.provider === "deepseek")
    return "DeepSeek publishes no account limits locally. Codex reports this session's usage in the terminal.";
  if (session.agent === "claude") return "Account limits appear after any Lite Claude session receives a response.";
  return "This provider reports no usage locally.";
}

function UsagePanel({ session }: { session: Session }) {
  const [usage, setUsage] = useState<UsageSnapshot | null | undefined>(() => usageCache.get(session.id));
  const [error, setError] = useState("");

  useEffect(() => {
    let disposed = false;
    setError("");
    void invoke<UsageSnapshot | null>("read_usage", {
      agent: session.agent,
      provider: session.provider,
      sessionId: session.id,
    })
      .then((next) => {
        if (!disposed) {
          usageCache.set(session.id, next);
          setUsage(next);
        }
      })
      .catch((reason) => {
        if (!disposed) setError(String(reason));
      });
    return () => {
      disposed = true;
    };
  }, [session.agent, session.provider, session.id]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-3">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium">
            <ProviderIcon agent={session.agent} provider={session.provider} className="size-5" />
            {session.agent === "codex"
              ? session.provider === "deepseek"
                ? "DeepSeek"
                : "OpenAI"
              : sessionLabel(session)}
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
            <ItemGroup>
              {usage.contextUsedPercent != null ? (
                <Item variant="outline" className="flex-col items-stretch">
                  <Meter label="Session context" value={usage.contextUsedPercent} />
                  {usage.contextTokens != null ? (
                    <ItemDescription className="tabular-nums">
                      {formatNumber.format(usage.contextTokens)}
                      {usage.contextWindow ? ` of ${formatNumber.format(usage.contextWindow)}` : ""} tokens
                    </ItemDescription>
                  ) : null}
                  {usage.costUsd != null ? (
                    <ItemDescription className="tabular-nums">${usage.costUsd.toFixed(2)} session cost</ItemDescription>
                  ) : null}
                </Item>
              ) : (
                <ItemDescription>
                  {session.agent === "codex" ? "The Codex CLI" : "This provider"} does not report per-session context.
                </ItemDescription>
              )}
              {usage.windows.map((window) => (
                <Item
                  key={`${window.label}-${window.windowMinutes ?? ""}`}
                  variant="outline"
                  className="flex-col items-stretch"
                >
                  <Meter label={window.label} value={window.usedPercent} />
                  {window.resetsAt != null ? (
                    <ItemDescription>Resets {formatTime.format(window.resetsAt * 1000)}</ItemDescription>
                  ) : null}
                </Item>
              ))}
              {usage.lifetimeTokens != null ? (
                <Item variant="outline">
                  <ItemContent>
                    <ItemDescription>Provider total</ItemDescription>
                    <ItemTitle className="text-lg tabular-nums">
                      {formatNumber.format(usage.lifetimeTokens)} tokens
                    </ItemTitle>
                  </ItemContent>
                </Item>
              ) : null}
            </ItemGroup>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

export function Inspector({
  session,
  remote,
  collapsed,
  onExpand,
  onCollapse,
}: {
  session: Session;
  remote: string;
  collapsed: boolean;
  onExpand: () => void;
  onCollapse: () => void;
}) {
  const [tab, setTab] = useState<string>(TABS[0].value);
  const [visited, setVisited] = useState(() => new Set<string>([TABS[0].value]));
  // A tab already names the panel it shows, so the panel does not name itself again. One button beside
  // the tabs rereads whichever is open, by rebuilding it, and only that one ever reads the disk.
  const [reload, setReload] = useState({ files: 0, git: 0, usage: 0 });

  function selectTab(value: string) {
    setTab(value);
    setVisited((current) => {
      if (current.has(value)) return current;
      const next = new Set(current);
      next.add(value);
      return next;
    });
  }

  // Collapsed, the panel is the strip of tabs it collapsed from: the one you pick is the one it reopens
  // on. What it was showing is hidden rather than thrown away, so the file you had open is still open
  // when it comes back, and a hidden panel reads nothing because nothing here reads without being asked.
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
      <div data-context-surface className={collapsed ? "hidden" : "h-full"}>
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
                  size="icon-sm"
                  tooltip="Refresh"
                  aria-label="Refresh"
                  data-context-refresh
                  onClick={() => setReload((counts) => ({ ...counts, [tab]: counts[tab as keyof typeof counts] + 1 }))}
                >
                  <RefreshCw />
                </ActionIconButton>
              )}
            </span>
          </div>
          {visited.has("files") ? (
            <TabsContent value="files" keepMounted className="min-h-0 overflow-hidden">
              <FilesPanel key={reload.files} root={session.cwd} rootId={session.rootId} />
            </TabsContent>
          ) : null}
          {visited.has("git") ? (
            <TabsContent value="git" keepMounted className="min-h-0 overflow-hidden">
              <GitPanel key={reload.git} rootId={session.rootId} sessionId={session.id} remote={remote} />
            </TabsContent>
          ) : null}
          {visited.has("usage") ? (
            <TabsContent value="usage" keepMounted className="min-h-0 overflow-hidden">
              <UsagePanel key={reload.usage} session={session} />
            </TabsContent>
          ) : null}
        </Tabs>
      </div>
    </>
  );
}
