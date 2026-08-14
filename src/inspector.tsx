// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { invoke } from "@tauri-apps/api/core";
import {
  ArrowLeft,
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
  Save,
  Scale,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  lazy,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
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
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { githubItemReferences, likelyGitHubItems } from "@/github-items";
import { SEMANTIC_PROGRESS_CLASSES, type SemanticTone } from "@/lib/semantic-styles";
import { including, without } from "@/lib/utils";
import { MAX_OUTPUT_BYTES, readOutput, subscribeOutput } from "@/output-store";
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
} from "@/types";

const CodePreview = lazy(() => import("@/code-preview"));

function namedInSession(sessionId: string, remote: string) {
  return githubItemReferences(readOutput(sessionId).slice(-MAX_OUTPUT_BYTES), remote);
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
  updatedAt: string | null;
  additions: number | null;
  deletions: number | null;
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
  changes: GitStatus["changes"];
  changesTruncated: boolean;
  lineDiffs: GitStatus["lineDiffs"];
  items: (GitHubItem & GitHubReference)[];
  name: string;
  path: string | null;
  url: string | null;
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
      lineDiffs: status.lineDiffs,
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
        {items.map(({ url, title, state, occurredAt, additions, deletions, kind, number }) => (
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
                  <ItemDescription className="min-w-0 truncate font-mono">
                    #{number}
                    {occurredAt ? ` · ${relativeAge(occurredAt)}` : ""}
                  </ItemDescription>
                  {additions ? (
                    <span className="shrink-0 font-mono text-xs text-green-600 dark:text-green-400">+{additions}</span>
                  ) : null}
                  {deletions ? (
                    <span className="shrink-0 font-mono text-xs text-red-600 dark:text-red-400">-{deletions}</span>
                  ) : null}
                  {state ? (
                    <Badge className="ml-auto" variant={GITHUB_STATE[state]}>
                      {state}
                    </Badge>
                  ) : null}
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
  {
    icon: FileCog,
    color: "text-violet-500",
    extensions: ["yaml", "yml", "toml", "ini", "cfg", "conf", "editorconfig"],
  },
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

function FileIcon({ name, directory }: { name: string; directory?: boolean }) {
  const lower = name.toLowerCase();
  const kind = FILE_NAMES.get(lower) ?? FILE_TYPES.get(lower.split(".").pop() ?? "");
  const Icon = directory ? Folder : (kind?.icon ?? File);
  return (
    <Icon
      className={`size-4 shrink-0 ${directory ? "fill-current text-muted-foreground" : (kind?.color ?? "text-muted-foreground")}`}
    />
  );
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
    <div className="shrink-0 p-2">
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

// Capacity gets more urgent as it is spent; all consumers share these tones with status badges.
function Meter({ label, value }: { label: string; value: number }) {
  const bounded = Math.max(0, Math.min(100, value));
  const tone: SemanticTone = bounded >= 90 ? "error" : bounded >= 75 ? "warning" : "success";
  return (
    <Progress value={bounded} className={SEMANTIC_PROGRESS_CLASSES[tone]}>
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

  const lowered = query.trim().toLowerCase();

  async function deleteFile() {
    if (!deleting) return;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      await invoke("delete_file", { rootId, path: deleting.path });
      setChildren((current) => {
        const next = { ...current };
        for (const [path, listing] of Object.entries(next)) {
          if (listing.entries.some((entry) => entry.path === deleting.path)) {
            next[path] = { ...listing, entries: listing.entries.filter((entry) => entry.path !== deleting.path) };
          }
        }
        return next;
      });
      setDeleting(undefined);
      setError("");
    } catch (reason) {
      setDeleteError(String(reason));
    } finally {
      setDeleteBusy(false);
    }
  }

  // A search has to see the whole tree, so the first searching keystroke loads it and the next query
  // — not the render a failure causes — retries a walk that failed; one that succeeded is not
  // repeated, and a cleared search forgets the failure so the same query asks again.
  const attempted = useRef("");
  useEffect(() => {
    if (!lowered) attempted.current = "";
    else if (lowered !== attempted.current && !walked.current && !expandingAll) {
      attempted.current = lowered;
      void walk(false);
    }
  });

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
                    if (
                      entry.isDirectory ||
                      (event.key !== "Delete" &&
                        !(navigator.platform.includes("Mac") && event.metaKey && event.key === "Backspace"))
                    )
                      return;
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
                {!entry.isDirectory ? (
                  <button
                    type="button"
                    hidden
                    data-context-delete-file
                    onClick={() => {
                      setDeleteError("");
                      setDeleting(entry);
                    }}
                  />
                ) : null}
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
            <DialogDescription>This permanently deletes the file from your computer.</DialogDescription>
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
            <Button variant="destructive" disabled={deleteBusy} onClick={() => void deleteFile()}>
              {deleteBusy ? <Spinner /> : <Trash2 />}
              {deleteBusy ? "Deleting…" : "Delete File"}
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
      {/* A walk that failed searched a partial tree, so its error shows over whatever it did find. */}
      {lowered && error ? <p className="p-3 text-xs text-destructive">{error}</p> : null}
      {lowered && !error && !expandingAll && children[root] && !matching.has(root) ? (
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
  const command = event.metaKey || (!navigator.platform.includes("Mac") && event.ctrlKey);
  if (!command) return;
  if (onSave && event.key.toLowerCase() === "s") {
    event.preventDefault();
    onSave();
    return;
  }
  if (event.key.toLowerCase() === "w") {
    event.preventDefault();
    onClose();
    return;
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
  error,
  loading,
  fontSize,
  onBack,
  onDraftChange,
  onSave,
}: {
  entry: FileEntry;
  source: string;
  draft: string;
  error: string;
  loading: boolean;
  fontSize: number;
  onBack: () => void;
  onDraftChange: (contents: string) => void;
  onSave: (contents: string) => Promise<void>;
}) {
  const [view, setView] = useState<"source" | "preview">("source");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [discardOpen, setDiscardOpen] = useState(false);
  const dirty = draft !== source;
  const renderable = RENDERED_FILE.test(entry.path);
  const lineEnding = source.includes("\r\n") ? "\r\n" : "\n";
  const viewer = usePreviewViewer<HTMLDivElement>(() => {
    if (dirty) setDiscardOpen(true);
    else onBack();
  });

  async function save() {
    setSaving(true);
    setSaveError("");
    try {
      await onSave(draft);
    } catch (reason) {
      setSaveError(String(reason));
    } finally {
      setSaving(false);
    }
  }

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
      onKeyDown={(event) => previewKeyDown(event, closeFile, () => !saving && dirty && void save())}
    >
      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard changes to “{entry.name}”?</DialogTitle>
            <DialogDescription>Your unsaved edits will be lost.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiscardOpen(false)}>
              Keep Editing
            </Button>
            <Button
              variant="destructive"
              disabled={saving}
              onClick={() => {
                setDiscardOpen(false);
                onBack();
              }}
            >
              Discard Changes
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
        {!error ? (
          <ActionIconButton
            size="icon-sm"
            tooltip={saving ? "Saving file…" : "Save file"}
            aria-label={saving ? "Saving file" : "Save file"}
            disabled={saving || draft === source}
            onClick={() => void save()}
          >
            {saving ? <Spinner aria-hidden="true" /> : <Save aria-hidden="true" />}
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
                editable
                fontSize={fontSize}
                onChange={(contents) =>
                  onDraftChange(lineEnding === "\r\n" ? contents.replace(/\r?\n/g, "\r\n") : contents)
                }
              />
            </Suspense>
          </TabsContent>
          {renderable ? (
            <TabsContent value="preview" keepMounted className="min-h-0 overflow-hidden">
              <ScrollArea className="size-full">
                <div style={contentZoomStyle(fontSize)}>
                  <Suspense fallback={<Loading label="Opening preview…" />}>
                    <CodePreview path={entry.path} source={draft} rendered />
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
}

const fileEditorsBySession = new Map<string, FileEditorState>();

function FilesPanel({
  root,
  rootId,
  sessionId,
  fontSize,
}: {
  root: string;
  rootId: string;
  sessionId: string;
  fontSize: number;
}) {
  const [cached] = useState(() => {
    const current = fileEditorsBySession.get(sessionId);
    if (current?.rootId === rootId) return current;
    fileEditorsBySession.delete(sessionId);
  });
  const [selected, setSelected] = useState<FileEntry | null>(cached?.selected ?? null);
  const [source, setSource] = useState(cached?.source ?? "");
  const [draft, setDraft] = useState(cached?.draft ?? "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const request = useRef(0);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );

  async function openFile(entry: FileEntry) {
    const id = ++request.current;
    selectedRef.current = entry;
    setSelected(entry);
    setSource("");
    setDraft("");
    setError("");
    setLoading(true);
    try {
      const contents = await invoke<string>("read_text_file", { rootId, path: entry.path });
      if (request.current === id) {
        setSource(contents);
        setDraft(contents);
        fileEditorsBySession.set(sessionId, { rootId, selected: entry, source: contents, draft: contents });
      }
    } catch (reason) {
      if (request.current === id) {
        setSource("");
        setError(String(reason));
      }
    } finally {
      if (request.current === id) setLoading(false);
    }
  }

  async function saveFile(contents: string) {
    const entry = selectedRef.current;
    if (!entry) return;
    const id = request.current;
    await invoke("write_text_file", { rootId, path: entry.path, contents });
    if (request.current !== id) return;
    const current = fileEditorsBySession.get(sessionId);
    if (current?.rootId === rootId && current.selected.path === entry.path)
      fileEditorsBySession.set(sessionId, { ...current, source: contents });
    if (selectedRef.current?.path === entry.path) setSource(contents);
  }

  function changeDraft(contents: string) {
    setDraft(contents);
    if (selected) fileEditorsBySession.set(sessionId, { rootId, selected, source, draft: contents });
  }

  function closeFile() {
    request.current++;
    fileEditorsBySession.delete(sessionId);
    selectedRef.current = null;
    setSelected(null);
  }

  // The tree is hidden behind an open file rather than thrown away, so stepping back returns to the
  // folders exactly as they were left — expanded, loaded, and scrolled — without rereading the disk.
  // A new root grant is a different tree, so it starts over the way a first open does; the open file
  // stays, since its content was already read.
  return (
    <div className="flex h-full min-h-0 flex-col">
      {selected ? (
        <FileViewer
          key={selected.path}
          entry={selected}
          source={source}
          draft={draft}
          error={error}
          loading={loading}
          fontSize={fontSize}
          onBack={closeFile}
          onDraftChange={changeDraft}
          onSave={saveFile}
        />
      ) : null}
      <div data-context-files className={`min-h-0 flex-1 flex-col ${selected ? "hidden" : "flex"}`}>
        <SearchInput value={query} placeholder="Search files" onChange={setQuery} />
        <ScrollArea className="min-h-0 flex-1">
          <div style={contentZoomStyle(fontSize)}>
            <FileTree key={rootId} root={root} rootId={rootId} query={query} onOpen={(entry) => void openFile(entry)} />
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

function RepositoryCard({
  repository,
  onOpenDiff,
}: {
  repository: RepositoryGroup;
  onOpenDiff: (path: string) => void;
}) {
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
          {repository.changes.map((change) => {
            const diff = repository.lineDiffs[change.path];
            return (
              <button
                key={`${change.status}:${change.path}`}
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                aria-label={`View diff for ${change.path}`}
                onClick={() => onOpenDiff(change.path)}
              >
                <span
                  className={`${change.status === "??" ? "w-16" : "w-5"} shrink-0 font-mono text-xs text-muted-foreground`}
                >
                  {change.status === "??" ? "Untracked" : change.status.trim()}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs" title={change.path}>
                  {change.path}
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
      ) : null}
      <GitHubItemList label="Pull requests" items={pullRequests} />
      <GitHubItemList label="Issues" items={issues} />
    </section>
  );
}

const usageCache = new Map<string, UsageSnapshot | null>();

export function clearInspectorCache(sessionId: string) {
  usageCache.delete(sessionId);
  fileEditorsBySession.delete(sessionId);
}

function GitPanel({
  rootId,
  sessionId,
  remote,
  active,
  fontSize,
}: {
  rootId: string;
  sessionId: string;
  remote: string;
  active: boolean;
  fontSize: number;
}) {
  const [references, setReferences] = useState(() => namedInSession(sessionId, remote));
  const [status, setStatus] = useState<GitStatus | null>();
  const [items, setItems] = useState<GitHubItem[]>();
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [diffPath, setDiffPath] = useState("");
  const [diffSource, setDiffSource] = useState("");
  const [diffError, setDiffError] = useState("");
  const [diffLoading, setDiffLoading] = useState(false);
  const diffRequest = useRef(0);

  // While Git is visible, follow the output stream it summarizes. Subscribing replays the existing
  // chunks synchronously, so one initial scan replaces rescanning the whole bounded buffer per chunk.
  useEffect(() => {
    if (!active) return;
    let replaying = true;
    let settle = 0;
    const scan = () => {
      const next = namedInSession(sessionId, remote);
      setReferences((current) => {
        const same = (key: keyof typeof next) =>
          current[key].length === next[key].length && current[key].every((url, index) => url === next[key][index]);
        return same("explicit") && same("inferred") ? current : next;
      });
    };
    const unsubscribe = subscribeOutput(sessionId, () => {
      if (replaying) return;
      window.clearTimeout(settle);
      settle = window.setTimeout(scan, 250);
    });
    replaying = false;
    scan();
    return () => {
      window.clearTimeout(settle);
      unsubscribe();
    };
  }, [active, remote, sessionId]);

  // Explicit references always survive the lookup. A bare reference inferred from the session folder
  // survives only when GitHub confirms activity in the last day.
  useEffect(() => {
    const { explicit, inferred } = references;
    const urls = [...explicit, ...inferred];
    if (!urls.length) return setItems([]);
    let disposed = false;
    // A remote that arrives after an empty first pass starts a real check, so the panel goes back to
    // checking rather than staying empty without a word.
    setItems(undefined);
    void invoke<GitHubItem[]>("github_items", { urls })
      .then((checked) => {
        if (!disposed) setItems(likelyGitHubItems(checked, inferred));
      })
      // An explicit link survives an unavailable GitHub; an inference cannot be verified and does not.
      .catch(() => {
        if (!disposed)
          setItems(
            explicit.map((url) => ({
              url,
              title: null,
              state: null,
              occurredAt: null,
              updatedAt: null,
              additions: null,
              deletions: null,
            })),
          );
      });
    return () => {
      disposed = true;
    };
  }, [references]);

  const refresh = useCallback(async () => {
    setError("");
    try {
      setStatus(await invoke<GitStatus | null>("git_status", { rootId }));
    } catch (reason) {
      setError(String(reason));
    }
  }, [rootId]);

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

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const repositories = repositoryGroups(remote, status ?? null, items ?? []);
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
        <SearchInput value={query} placeholder="Search items" onChange={setQuery} />
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-3 p-3" style={contentZoomStyle(fontSize)}>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {!error && status === undefined ? <Loading label="Reading Git status…" /> : null}
            {shown.map((repository) => (
              <RepositoryCard
                key={(repository.url ?? repository.path)?.toLowerCase()}
                repository={repository}
                onOpenDiff={(path) => void openDiff(path)}
              />
            ))}
            {lowered && status !== undefined && items && repositories.length && !shown.length ? (
              <p className="text-sm text-muted-foreground">No matches</p>
            ) : null}
            {items === undefined && (references.explicit.length || references.inferred.length) ? (
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
    </div>
  );
}

// Each harness and provider reports what it reports; Lite never fills the gap with a number of its own.
function missingUsage(session: Session): string {
  if (session.agent === "shell") return "Shell sessions report no provider usage.";
  if (session.agent === "codex" && session.provider && session.provider !== "openai")
    return `${providerLabel(session.provider)} publishes no account limits locally. Session context appears after the first response.`;
  if (session.agent === "claude") return "Account limits appear after any Lite Claude session receives a response.";
  return `${sessionLabel(session)} reports session context after its first response.`;
}

function UsagePanel({ session, fontSize }: { session: Session; fontSize: number }) {
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
        <div className="p-3" style={contentZoomStyle(fontSize)}>
          <div className="mb-3 flex items-center gap-2 text-sm font-medium">
            <ProviderIcon agent={session.agent} provider={session.provider} className="size-5" />
            {session.agent === "codex" && session.provider ? providerLabel(session.provider) : sessionLabel(session)}
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
              {usage.contextUsedPercent != null || usage.contextTokens != null ? (
                <Item variant="outline" className="flex-col items-stretch">
                  {usage.contextUsedPercent != null ? (
                    <Meter label="Session context" value={usage.contextUsedPercent} />
                  ) : (
                    <ItemDescription>Session context</ItemDescription>
                  )}
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
                  Session context appears after this harness reports its first response.
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
  fontSize,
  collapsed,
  onExpand,
  onCollapse,
}: {
  session: Session;
  remote: string;
  fontSize: number;
  collapsed: boolean;
  onExpand: () => void;
  onCollapse: () => void;
}) {
  const [tab, setTab] = useState<string>(TABS[0].value);
  const [visited, setVisited] = useState(() => new Set<string>([TABS[0].value]));
  // A tab already names the panel it shows, so the panel does not name itself again. The refresh button
  // rebuilds whichever is open, and every explicit Files visit rebuilds that disk snapshot as well.
  const [reload, setReload] = useState({ files: 0, git: 0, usage: 0 });

  function visitTab(value: string) {
    setVisited((current) => including(current, value));
  }

  function refreshTab(value: keyof typeof reload) {
    setReload((counts) => ({ ...counts, [value]: counts[value] + 1 }));
  }

  function selectTab(value: string) {
    setTab(value);
    visitTab(value);
    if (value === "files") refreshTab(value);
  }

  // Collapsed, the panel is the strip of tabs it collapsed from: the one you pick is the one it reopens
  // on. Hidden panels retain their state except Files, whose explicit visit requests a fresh disk
  // snapshot. Hovering or focusing Git explicitly asks that panel to prepare before the click.
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
          onPointerEnter={value === "git" ? () => visitTab(value) : undefined}
          onFocus={value === "git" ? () => visitTab(value) : undefined}
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
                  <TooltipTrigger
                    render={
                      <TabsTrigger
                        value={value}
                        aria-label={label}
                        onPointerEnter={value === "git" ? () => visitTab(value) : undefined}
                        onFocus={value === "git" ? () => visitTab(value) : undefined}
                        onClick={value === "files" && tab === "files" ? () => refreshTab("files") : undefined}
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
                tooltip="Refresh"
                aria-label="Refresh"
                data-context-refresh
                onClick={() => refreshTab(tab as keyof typeof reload)}
              >
                <RefreshCw />
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
              />
            </TabsContent>
          ) : null}
          {visited.has("usage") ? (
            <TabsContent value="usage" keepMounted className="min-h-0 overflow-hidden">
              <UsagePanel key={reload.usage} session={session} fontSize={fontSize} />
            </TabsContent>
          ) : null}
        </Tabs>
      </div>
    </>
  );
}
