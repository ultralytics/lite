// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { invoke } from "@tauri-apps/api/core";
import {
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Download,
  FolderOpen,
  GitBranch,
  Lock,
  RefreshCw,
  Server,
  TriangleAlert,
  X,
} from "lucide-react";
import { type FormEvent, type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";

import { GitHubLogomark, GitLogomark, ProviderIcon } from "@/brand-icons";
import { ActionIconButton, Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { relativeAge, SearchInput } from "@/inspector";
import { cn } from "@/lib/utils";
import {
  ApiKeyDialog,
  AUTH_PROVIDERS,
  type KeyProvider,
  type ProviderAuth,
  ProviderAuthDescription,
  providerName,
} from "@/provider-auth";
import { IS_MAC } from "@/shortcuts";
import { type Agent, agentLabel, defaultSessionName, folderName, type Session, sessionLabel, tilde } from "@/types";

export const SESSION_CHOICES = [
  ...Object.values(AUTH_PROVIDERS),
  { id: "shell", agent: "shell" as const, provider: undefined, label: "Your login shell" },
];
type Choice = (typeof SESSION_CHOICES)[number];
// One row per harness, in a fixed order so its number key never moves. Codex is one row whatever
// provider it runs against; the provider is a choice inside the row.
const HARNESSES: Agent[] = [...new Set(SESSION_CHOICES.map((option) => option.agent))];
const CODEX_CHOICES = SESSION_CHOICES.filter((option) => option.agent === "codex");
const CHOICE_KEY = "lite.newSession.choice.v1";
const CODEX_KEY = "lite.newSession.codexProvider.v1";
const SOURCE_KEY = "lite.newSession.source.v1";
const WORKTREE_KEY = "lite.newSession.worktree.v1";
const FLAGS_KEY = "lite.newSession.flags.v1";
const SSH_HOST_KEY = "lite.newSession.sshHost.v1";
// A Codex provider serving several models offers the choice here, remembered per provider so each keeps
// its own model and thinking level. Rust owns which models and levels exist, because the catalog it hands
// Codex is built from the same list; this side only remembers which of them was picked.
interface CodexPicker {
  id: string;
  // The provider's models, its default first, each with the name to show.
  models: [slug: string, label: string][];
  levels: string[];
  modelChoice: boolean;
}
const modelKey = (id: string) => `lite.newSession.${id}Model.v1`;
const levelKey = (id: string) => `lite.newSession.${id}Reasoning.v1`;

function storedCodexChoice(key: string, values: readonly string[], fallback: string) {
  const stored = localStorage.getItem(key);
  return stored && values.includes(stored) ? stored : fallback;
}

function remoteUnsupported(remote: boolean, choice: Choice) {
  return remote && choice.agent === "codex" && choice.provider !== "openai";
}

let updateChecks: Promise<Record<string, boolean | null>> | undefined;

// The last repository list GitHub answered with. A reopened dialog shows it at once while it asks again,
// so the list is only ever waited for on the first opening.
let lastRepositories: GitHubRepositories | undefined;

function checkAgentUpdates() {
  updateChecks ??= Promise.all(
    HARNESSES.filter((agent) => agent !== "shell").map(async (agent) => {
      try {
        return [agent, await invoke<boolean>("agent_update_available", { agent })] as const;
      } catch {
        return [agent, null] as const;
      }
    }),
  )
    .then(Object.fromEntries)
    .finally(() => {
      updateChecks = undefined;
    });
  return updateChecks;
}

// The quiet heading that separates the dialog's groups, in the sidebar's own label style.
const SECTION = "text-[11px] font-medium tracking-wide text-muted-foreground uppercase";

interface DirectoryGrant {
  id: string;
  path: string;
  host: string | null;
}

interface Repository {
  branch: string;
  root: string;
  worktree: string;
  remote: string | null;
}

interface DirectoryProbe {
  exists: boolean;
  isDirectory: boolean;
  repository: Repository | null;
}

interface Availability {
  available: boolean;
  installable: boolean;
  detail: string;
}

interface GitHubRepository {
  owner: string;
  name: string;
  private: boolean;
  pushedAt: string | null;
  language: string | null;
  color: string | null;
  // A clone Lite already knows, which a session uses instead of cloning again.
  local: string | null;
}

interface GitHubRepositories {
  signedIn: boolean;
  repositories: GitHubRepository[];
}

type Source = "github" | "local" | "ssh";

const fullName = (repository: { owner: string; name: string }) => `${repository.owner}/${repository.name}`;

function Tile({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background/60", className)}
    >
      {children}
    </span>
  );
}

// The vendor whose mark a harness carries: OpenAI's for Codex, the harness's own otherwise.
const harnessVendor = (agent: Agent) => (agent === "codex" ? "openai" : undefined);

// The line under a harness: its provider's name, then what the row has to say about it. The provider's
// mark joins the name only when it is not the harness's own, which the row's main mark already shows. The
// tone colors the status's check mark alone.
function ProviderLine({ choice, tone, children }: { choice: Choice; tone?: string; children: ReactNode }) {
  const provider = providerName(choice);
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      {provider ? (
        <>
          {choice.provider !== harnessVendor(choice.agent) ? (
            <ProviderIcon agent={choice.agent} provider={choice.provider} className="size-3 shrink-0" />
          ) : null}
          <span className="shrink-0 text-foreground/75">{provider}</span>
          <span aria-hidden="true">·</span>
        </>
      ) : null}
      <span className={cn("min-w-0 truncate [&_svg]:size-3", tone)}>{children}</span>
    </span>
  );
}

// A repository or folder the user can pick. The picked one turns green once Lite has confirmed a session
// can start there, the same green the folder field shows when its folder exists.
const pickRow = (active: boolean, ready: boolean) =>
  cn(
    "flex w-full items-center gap-3 rounded-lg border px-2 py-1.5 text-left transition-colors duration-300 outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
    active && ready
      ? "border-success/40 bg-success/10"
      : active
        ? "border-foreground/15 bg-accent"
        : "border-transparent hover:bg-accent/60",
  );

// A row scrolls into view as it becomes the picked one, so the arrow keys never pick a row out of sight.
const reveal = (row: HTMLButtonElement | null) => row?.scrollIntoView({ block: "nearest" });

export function NewSessionDialog({
  open: isOpen,
  choice: chosen,
  initialPath,
  remoteSsh,
  sessions,
  recentFolders,
  onOpenChange,
  onCreate,
  onGitHubSignIn,
  onApiKeys,
}: {
  open: boolean;
  // A choice made outside the dialog — a welcome tile — which the dialog opens on.
  choice?: string;
  initialPath?: string;
  remoteSsh: boolean;
  sessions: Session[];
  // The local folders sessions ran in, the latest first, including sessions since closed.
  recentFolders: string[];
  onOpenChange: (open: boolean) => void;
  onCreate: (session: Session) => void;
  onGitHubSignIn: () => void;
  // Settings, opened where API keys are kept.
  onApiKeys: () => void;
}) {
  const [choiceId, setChoiceId] = useState(() => {
    const stored = localStorage.getItem(CHOICE_KEY);
    return SESSION_CHOICES.find((option) => option.id === stored)?.id ?? SESSION_CHOICES[0].id;
  });
  const [codexId, setCodexId] = useState<string>(() => {
    const stored = localStorage.getItem(CODEX_KEY);
    return CODEX_CHOICES.find((option) => option.id === stored)?.id ?? CODEX_CHOICES[0].id;
  });
  const [pickers, setPickers] = useState<CodexPicker[]>([]);
  const [codexChoices, setCodexChoices] = useState<Record<string, string>>({});
  function chooseCodex(key: string, value: string) {
    localStorage.setItem(key, value);
    setCodexChoices((current) => ({ ...current, [key]: value }));
  }
  const [sourceSelected, setSourceSelected] = useState<Source>(() => {
    const stored = localStorage.getItem(SOURCE_KEY);
    return stored === "local" || stored === "ssh" ? stored : "github";
  });
  const source: Source = sourceSelected === "ssh" && !remoteSsh ? "local" : sourceSelected;
  const opensOnSsh = useRef(false);
  opensOnSsh.current = source === "ssh";
  const remote = source === "ssh";
  const [directory, setDirectory] = useState<DirectoryGrant>();
  const [path, setPath] = useState("");
  const [host, setHost] = useState(() => localStorage.getItem(SSH_HOST_KEY) ?? "");
  const [availability, setAvailability] = useState<Record<string, Availability | null>>({});
  const [auth, setAuth] = useState<ProviderAuth[]>();
  const [installing, setInstalling] = useState("");
  // Undefined while checking, null when the registry could not answer, otherwise whether an update exists.
  const [updates, setUpdates] = useState<Record<string, boolean | null>>({});
  // What creation is doing right now. Creation runs commands against the dialog's grant, so closing
  // must wait for it: a Cancel mid-command would revoke the grant the command is still using.
  // The launch under way: the harness, where it runs, each step as it reads while running and once done,
  // and how many are done.
  const [launching, setLaunching] = useState<{
    choice: Choice;
    place: string;
    steps: [running: string, done: string][];
    done: number;
    // Why the step after the done ones failed; the card stays up with it until the user goes back.
    error?: string;
  }>();
  const advance = () => setLaunching((current) => current && { ...current, done: current.done + 1 });
  const [error, setError] = useState("");
  // Undefined while checking, null outside a repository, otherwise the repository's main checkout.
  const [repo, setRepo] = useState<string | null>();
  const [folder, setFolder] = useState<"checking" | "missing" | "directory" | "other">("checking");
  const [worktree, setWorktree] = useState("");
  const [worktreeOn, setWorktreeOn] = useState(() => localStorage.getItem(WORKTREE_KEY) === "true");
  // The branch the worktree would get if the field stays empty; Rust picks the same one.
  const [suggestedBranch, setSuggestedBranch] = useState("");
  const [branch, setBranch] = useState("");
  const [title, setTitle] = useState("");
  const [flags, setFlags] = useState("");
  const [flagsOn, setFlagsOn] = useState(() => localStorage.getItem(FLAGS_KEY) === "true");
  const [repositoriesRoot, setRepositoriesRoot] = useState("");
  const [github, setGitHub] = useState<GitHubRepositories>();
  const [query, setQuery] = useState("");
  // GitHub's own matches for the query, beyond the repositories already listed.
  const [found, setFound] = useState<{ query: string; repositories: GitHubRepository[] }>();
  const [selectedName, setSelectedName] = useState("");
  // The provider whose missing API key the user is supplying.
  const [keyFor, setKeyFor] = useState<KeyProvider>();
  const searchRef = useRef<HTMLInputElement>(null);
  // The folders Lite's local sessions ran in, recently or now, which GitHub's list is matched against for
  // existing clones.
  const knownRef = useRef<string[]>([]);
  knownRef.current = [
    ...new Set([
      ...recentFolders,
      ...sessions.flatMap((session) => (session.host || session.mode ? [] : [session.repo ?? session.cwd])),
    ]),
  ];
  const folderRef = useRef<HTMLInputElement>(null);
  const [folderProbes, setFolderProbes] = useState<Record<string, DirectoryProbe | null>>({});
  const codexChoice = CODEX_CHOICES.find((option) => option.id === codexId) ?? CODEX_CHOICES[0];
  const harnessChoice = (agent: Agent) =>
    agent === "codex" ? codexChoice : (SESSION_CHOICES.find((option) => option.agent === agent) ?? codexChoice);
  const lastChoice = SESSION_CHOICES.find((option) => option.id === choiceId) ?? SESSION_CHOICES[0];
  const lastAgent = lastChoice.agent;
  useEffect(() => {
    if (isOpen && chosen) {
      const option = SESSION_CHOICES.find((entry) => entry.id === chosen);
      setChoiceId(chosen);
      if (option?.agent === "codex") setCodexId(chosen);
    }
  }, [isOpen, chosen]);

  // Each explicit open asks every harness in parallel. Concurrent opens share the same work, while a
  // later open checks again so a newly published version or a failed registry request does not stay stale.
  useEffect(() => {
    if (!isOpen || remote) return;
    let disposed = false;
    setUpdates({});
    void checkAgentUpdates().then((result) => {
      if (!disposed) setUpdates(result);
    });
    return () => {
      disposed = true;
    };
  }, [isOpen, remote]);

  useEffect(() => {
    if (!isOpen) return;
    let disposed = false;
    setError("");
    setAvailability({});
    setAuth(undefined);
    setFound(undefined);
    setQuery("");
    void invoke<string>("repositories_directory")
      .then((root) => {
        if (!disposed) setRepositoriesRoot(root);
      })
      .catch((reason) => {
        if (!disposed) setError(String(reason));
      });
    // A local folder is no default for an SSH host, so the SSH tab opens with its field empty, even if a
    // folder was left from an opening that fell back to the Local tab.
    if (opensOnSsh.current) setPath("");
    else
      void invoke<DirectoryGrant | null>("default_directory", { path: initialPath ?? null })
        .then((selected) => {
          if (disposed && selected) void invoke("revoke_directory", { rootId: selected.id });
          else if (selected) {
            setDirectory(selected);
            setPath(selected.path);
          }
        })
        .catch((reason) => {
          if (!disposed) setError(String(reason));
        });
    void invoke<CodexPicker[]>("codex_pickers")
      .then((result) => {
        if (disposed) return;
        setPickers(result);
        setCodexChoices(
          Object.fromEntries(
            result.flatMap((picker) => [
              [
                modelKey(picker.id),
                storedCodexChoice(
                  modelKey(picker.id),
                  picker.models.map(([slug]) => slug),
                  picker.models[0][0],
                ),
              ],
              [levelKey(picker.id), storedCodexChoice(levelKey(picker.id), picker.levels, "high")],
            ]),
          ),
        );
      })
      .catch((reason) => {
        if (!disposed) setError(String(reason));
      });
    void invoke<ProviderAuth[]>("provider_auth")
      .then((result) => {
        if (!disposed) setAuth(result);
      })
      .catch((reason) => {
        if (!disposed) setError(String(reason));
      });
    // Installation and provider setup can change while the app runs, so refresh them on each open.
    for (const option of SESSION_CHOICES) {
      void invoke<Availability>("agent_availability", { agent: option.agent, provider: option.provider })
        .then((result) => {
          if (!disposed) setAvailability((current) => ({ ...current, [option.id]: result }));
        })
        .catch((reason) => {
          if (!disposed) {
            setAvailability((current) => ({ ...current, [option.id]: null }));
            setError(`Could not check ${sessionLabel(option)}: ${reason}`);
          }
        });
    }
    return () => {
      disposed = true;
    };
  }, [initialPath, isOpen]);

  // GitHub is asked for the list only while its tab shows. A reopened dialog shows the last list at once
  // while it asks again.
  const onGitHub = source === "github";
  useEffect(() => {
    if (!isOpen || !onGitHub) return;
    let disposed = false;
    setGitHub(lastRepositories);
    void invoke<GitHubRepositories>("github_repositories", { query: "", known: knownRef.current })
      .then((result) => {
        lastRepositories = result;
        if (!disposed) setGitHub(result);
      })
      .catch((reason) => {
        if (!disposed) {
          setGitHub(lastRepositories ?? { signedIn: true, repositories: [] });
          setError(String(reason));
        }
      });
    return () => {
      disposed = true;
    };
  }, [isOpen, onGitHub]);

  // GitHub is searched once typing pauses, for repositories the user's own list does not hold.
  const search = query.trim();
  useEffect(() => {
    if (!isOpen || source !== "github" || !github?.signedIn || search.length < 2) return;
    let disposed = false;
    const timer = window.setTimeout(() => {
      void invoke<GitHubRepositories>("github_repositories", { query: search, known: knownRef.current })
        .then((result) => {
          if (!disposed) setFound({ query: search, repositories: result.repositories });
        })
        .catch(() => {
          if (!disposed) setFound({ query: search, repositories: [] });
        });
    }, 350);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [github?.signedIn, isOpen, search, source]);

  // Each recent folder is asked once per opening which kind it is.
  useEffect(() => {
    if (!isOpen || source !== "local") return;
    let disposed = false;
    for (const place of recentFolders)
      void invoke<DirectoryProbe>("directory_probe", { path: place })
        .then((probe) => {
          if (!disposed) setFolderProbes((current) => ({ ...current, [place]: probe }));
        })
        .catch(() => {
          if (!disposed) setFolderProbes((current) => ({ ...current, [place]: null }));
        });
    return () => {
      disposed = true;
    };
  }, [isOpen, recentFolders, source]);

  // The recent folders still on disk; one deleted since is not offered to be created again.
  const folders = recentFolders.filter((place) => folderProbes[place]?.exists !== false);

  const separator = repositoriesRoot.includes("\\") ? "\\" : "/";
  // Where a repository's clone is or will be: the one Lite knows, else its own under the repositories folder.
  const clonePath = (repository: GitHubRepository) =>
    repository.local ?? [repositoriesRoot, repository.name].join(separator);
  const listed = github?.repositories ?? [];
  // The repositories of the recent folders, in the same order, wherever their clones are.
  const recent = recentFolders.flatMap((place) => listed.find((entry) => entry.local === place) ?? []);
  const known = new Map<string, GitHubRepository>();
  for (const repository of [...listed, ...(found?.repositories ?? [])])
    if (!known.has(fullName(repository).toLowerCase())) known.set(fullName(repository).toLowerCase(), repository);
  const needle = search.toLowerCase();
  const matches = (repository: GitHubRepository) => !needle || fullName(repository).toLowerCase().includes(needle);
  const recentNames = new Set(recent.map((repository) => fullName(repository).toLowerCase()));
  const groups: { label: string; repositories: GitHubRepository[] }[] = needle
    ? [
        {
          label: "Matches",
          repositories: [...known.values()].filter(
            (repository) =>
              matches(repository) && !found?.repositories.some((entry) => fullName(entry) === fullName(repository)),
          ),
        },
        { label: "On GitHub", repositories: found?.query === search ? found.repositories : [] },
      ]
    : [
        {
          label: "Recent",
          repositories: recent,
        },
        {
          label: "All",
          repositories: listed.filter((repository) => !recentNames.has(fullName(repository).toLowerCase())),
        },
      ];
  const visible = groups.flatMap((group) => group.repositories);
  // Only a repository on screen can be the one a click starts in.
  const selected = visible.find((repository) => fullName(repository) === selectedName) ?? visible[0];

  // The folder a session would start from: the Local tab's path, or the GitHub tab's repository where
  // Lite already knows a clone of it. Both tabs ask it the same question, so a clone shows the same
  // worktree, branch, and name on either. A typed path settles for a moment before it is probed, so a
  // folder is never looked up once per keystroke. The probe is read-only and needs no grant.
  const probePath = source === "local" ? path.trim() : source === "github" ? (selected?.local ?? "") : "";
  useEffect(() => {
    setFolder("checking");
    setWorktree("");
    if (!isOpen || !probePath) {
      setRepo(null);
      return;
    }
    setRepo(undefined);
    let disposed = false;
    const probe = window.setTimeout(() => {
      void invoke<DirectoryProbe>("directory_probe", { path: probePath })
        .then(({ exists, isDirectory, repository }) => {
          if (disposed) return;
          setFolder(isDirectory ? "directory" : exists ? "other" : "missing");
          setRepo(repository?.root ?? null);
          setWorktree(repository?.worktree ?? "");
          setSuggestedBranch(repository?.branch ?? "");
        })
        .catch(() => {
          if (!disposed) {
            setRepo(null);
            setFolder("other");
            setWorktree("");
          }
        });
    }, 250);
    return () => {
      disposed = true;
      window.clearTimeout(probe);
    };
  }, [isOpen, probePath]);
  const running = (repository: GitHubRepository) =>
    sessions.filter((session) => !session.host && session.repo === clonePath(repository)).length;

  async function chooseFolder() {
    setError("");
    try {
      const picked = await invoke<DirectoryGrant | null>("choose_directory");
      if (picked) {
        if (directory) void invoke("revoke_directory", { rootId: directory.id });
        setDirectory(picked);
        setPath(picked.path);
      }
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function grant(): Promise<DirectoryGrant> {
    if (directory && directory.path === path.trim() && directory.host === (remote ? host.trim() : null))
      return directory;
    const granted = await invoke<DirectoryGrant>(remote ? "use_ssh_directory" : "use_directory", {
      path,
      ...(remote ? { host: host.trim() } : {}),
    });
    if (directory) void invoke("revoke_directory", { rootId: directory.id });
    setDirectory(granted);
    setPath(granted.path);
    return granted;
  }

  function changeSource(next: Source) {
    localStorage.setItem(SOURCE_KEY, next);
    // A folder granted for one place must not follow the user to another.
    if (directory && (next === "ssh") !== remote) {
      void invoke("revoke_directory", { rootId: directory.id });
      setDirectory(undefined);
      setPath("");
    }
    setError("");
    setSourceSelected(next);
  }

  function changeOpen(open: boolean) {
    if (!open && (installing || (launching && !launching.error))) return;
    if (!open) setLaunching(undefined);
    if (!open && directory) {
      void invoke("revoke_directory", { rootId: directory.id });
      setDirectory(undefined);
    }
    // A cancelled dialog stays mounted, so a name typed into it must not wait for the next session.
    if (!open) {
      setTitle("");
      setBranch("");
      setFlags("");
    }
    onOpenChange(open);
  }

  async function create(choice: Choice) {
    setError("");
    const sessionFlags = (flagsOn && flags.trim()) || undefined;
    // Checked once the dialog is busy but before anything is cloned or created, so a refused flag fails its
    // own step and is fixed after Back rather than left in a session that cannot start.
    const checking = sessionFlags ? [["Checking flags", "Checked flags"] as [string, string]] : [];
    const checkFlags = async () => {
      if (!sessionFlags) return;
      await invoke("check_session_flags", { agent: choice.agent, flags: sessionFlags });
      advance();
    };
    try {
      let place: DirectoryGrant;
      let worktree = false;
      let root: string | null = null;
      let fallbackName: string;
      if (source === "github") {
        if (!selected) return;
        const repository = selected;
        setLaunching({
          choice,
          place: fullName(repository),
          // A clone that exists is used as it is; only a repository with none is cloned first.
          steps: [
            ...checking,
            ...(repository.local
              ? []
              : [[`Cloning ${fullName(repository)}`, `Cloned ${fullName(repository)}`] as [string, string]]),
            ...(worktreeOn ? [["Creating worktree", "Created worktree"] as [string, string]] : []),
            [`Starting ${agentLabel(choice.agent)}`, `Started ${agentLabel(choice.agent)}`],
          ],
          done: 0,
        });
        await checkFlags();
        const main = await invoke<DirectoryGrant>("prepare_repository", {
          owner: repository.owner,
          name: repository.name,
          local: repository.local,
        });
        if (!repository.local) advance();
        place = main;
        if (worktreeOn) {
          try {
            place = await invoke<DirectoryGrant>("create_worktree", {
              rootId: main.id,
              branch: branch.trim(),
              upstream: true,
            });
          } catch (reason) {
            void invoke("revoke_directory", { rootId: main.id });
            throw reason;
          }
          advance();
          worktree = true;
        }
        // The clone catches up with GitHub once the session is under way, for the next worktree.
        void invoke("refresh_repository", { rootId: place.id }).catch(() => {});
        root = main.path;
        fallbackName = defaultSessionName(place.path);
        // The Local tab's folder was granted for a session that is not this one.
        if (directory) void invoke("revoke_directory", { rootId: directory.id });
        setSelectedName(fullName(repository));
      } else {
        const making = !remote && Boolean(repo) && worktreeOn;
        setLaunching({
          choice,
          place: placeLabel,
          steps: [
            ...checking,
            ...(making ? [["Creating worktree", "Created worktree"] as [string, string]] : []),
            [`Starting ${agentLabel(choice.agent)}`, `Started ${agentLabel(choice.agent)}`],
          ],
          done: 0,
        });
        await checkFlags();
        place = await grant();
        // The probe's answer can lag the folder field, so the granted folder is asked directly:
        // the worktree and the recorded repository always describe where the session will run.
        if (!remote)
          root = (await invoke<DirectoryProbe>("directory_probe", { path: place.path })).repository?.root ?? null;
        // The switch must still describe this folder: root === repo fails when the folder changed
        // after the probe that enabled the option, and a worktree is never made on a stale answer.
        if (root && root === repo && worktreeOn) {
          place = await invoke<DirectoryGrant>("create_worktree", {
            rootId: place.id,
            branch: branch.trim(),
            upstream: false,
          });
          advance();
          worktree = true;
        }
        fallbackName = defaultSessionName(place.path);
      }
      const name = title.trim();
      const panel = pickers.find((picker) => picker.id === choice.id);
      onCreate({
        id: crypto.randomUUID(),
        agent: choice.agent,
        provider: choice.provider,
        model: panel && codexChoices[modelKey(panel.id)],
        reasoningEffort: panel && codexChoices[levelKey(panel.id)],
        flags: sessionFlags,
        cwd: place.path,
        host: place.host ?? undefined,
        rootId: place.id,
        name: name || fallbackName,
        running: false,
        renamed: Boolean(name),
        worktree,
        repo: root || undefined,
      });
      localStorage.setItem(CHOICE_KEY, choice.id);
      setChoiceId(choice.id);
      setDirectory(undefined);
      setTitle("");
      setBranch("");
      setFlags("");
      onOpenChange(false);
      setLaunching(undefined);
    } catch (reason) {
      setLaunching((current) => (current ? { ...current, error: String(reason) } : current));
    }
  }

  async function install(option: Choice) {
    const updating = !availability[option.id]?.installable;
    const label = sessionLabel({ agent: option.agent });
    setInstalling(option.id);
    setError("");
    try {
      const version = await invoke<string | null>("install_agent", { agent: option.agent }).catch((reason) => {
        toast.add({
          title: `${label} ${updating ? "update" : "installation"} failed`,
          description: String(reason),
          type: "error",
        });
        throw reason;
      });
      if (version === null) return;
      toast.add({
        title: `${label} ${updating ? "update" : "installation"} complete`,
        description: `${version ? `${version}. ` : ""}New sessions will use this version.`,
        type: "success",
      });
      const results = await Promise.all(
        SESSION_CHOICES.filter((candidate) => candidate.agent === option.agent).map(
          async (candidate) =>
            [
              candidate.id,
              await invoke<Availability>("agent_availability", {
                agent: candidate.agent,
                provider: candidate.provider,
              }),
            ] as const,
        ),
      );
      setAvailability((current) => ({ ...current, ...Object.fromEntries(results) }));
      const result = results.find(([id]) => id === option.id)?.[1];
      if (result && !result.available && result.installable) setError(`Could not refresh ${label}: ${result.detail}`);
      else setUpdates((current) => ({ ...current, [option.agent]: false }));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setInstalling("");
    }
  }

  // Where the session would run is settled: a repository chosen, a folder that can be one, or a host
  // and path. Only then does an agent row start anything.
  const placeReady =
    source === "github"
      ? Boolean(selected && github?.signedIn)
      : remote
        ? Boolean(host.trim() && path.trim())
        : Boolean(path.trim() && folder !== "other" && repo !== undefined);
  // Green is kept for a place Lite has confirmed: a repository it can clone or fetch, or a folder that
  // exists. A folder about to be created stays amber and an SSH host is only checked once a session starts.
  const confirmed = placeReady && (source === "github" || folder === "directory");
  const busy = Boolean(installing || launching);
  // The session the user asked for starts once the provider answers that its new key makes it ready.
  async function keySaved(choice?: Choice) {
    if (!choice) return;
    const status = await invoke<Availability>("agent_availability", {
      agent: choice.agent,
      provider: choice.provider,
    });
    setAvailability((current) => ({ ...current, [choice.id]: status }));
    if (status.available) await create(choice);
    else setError(status.detail);
  }

  function launch(agent: Agent) {
    const choice = harnessChoice(agent);
    const status = availability[choice.id];
    // Locally an agent starts only once its check answered that it can; SSH checks on the host.
    if (busy || !placeReady || remoteUnsupported(remote, choice) || (!remote && !status)) return;
    if (!remote && status && !status.available) setUp(choice);
    else void create(choice);
  }

  // What an agent that is not ready needs, wherever the session would run: its install, its API key, or
  // its setup guide.
  function setUp(choice: Choice) {
    if (availability[choice.id]?.installable) void install(choice);
    else if ("variable" in choice && !choice.signIn) setKeyFor(choice);
    else
      void invoke("open_setup_docs", { agent: choice.agent, provider: choice.provider }).catch((reason) =>
        setError(String(reason)),
      );
  }

  // Enter anywhere in the dialog starts the agent used last; the number keys start the others.
  function submit(event: FormEvent) {
    event.preventDefault();
    launch(lastAgent);
  }
  function numberKey(event: KeyboardEvent) {
    if (!(IS_MAC ? event.metaKey : event.ctrlKey) || event.altKey || event.key < "1" || event.key > "9") return;
    const agent = HARNESSES[Number(event.key) - 1];
    if (!agent) return;
    event.preventDefault();
    launch(agent);
  }
  // The arrow keys move through the list under the field: GitHub's repositories, or the recent folders.
  function moveSelection(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const names = source === "github" ? visible.map(fullName) : folders;
    const at = names.indexOf(source === "github" ? (selected ? fullName(selected) : "") : path.trim());
    const next = names[Math.min(names.length - 1, Math.max(0, at + (event.key === "ArrowDown" ? 1 : -1)))];
    if (next && source === "github") setSelectedName(next);
    else if (next) pickFolder(next);
  }
  // A picked folder fills the field, which keeps the focus so the arrow keys and Enter still work there.
  function pickFolder(place: string) {
    setPath(place);
    folderRef.current?.focus({ preventScroll: true });
  }

  const worktreeHere = worktreeOn && (source === "github" || (source === "local" && Boolean(repo)));
  // The worktree a session would get and its branch: what the probe named for a clone that exists, or
  // the first of each beside a clone about to be made.
  const planned =
    source === "github" && selected && !selected.local
      ? { worktree: `${clonePath(selected)}-worktree-1`, branch: "lite/worktree-1" }
      : { worktree, branch: suggestedBranch };
  const defaultBranch = planned.branch;
  const defaultName = worktreeHere
    ? folderName(planned.worktree)
    : source === "github"
      ? (selected?.name ?? "")
      : path.trim()
        ? defaultSessionName(path.trim())
        : "";
  const whereLine =
    source === "github"
      ? !selected
        ? ""
        : worktreeOn
          ? `${selected.local ? "New" : "Clones, then new"} worktree in ${tilde(planned.worktree)}`
          : selected.local
            ? `Runs directly in ${tilde(clonePath(selected))}`
            : `Clones to ${tilde(clonePath(selected))}, then runs there`
      : remote
        ? host.trim() && path.trim()
          ? `Runs on ${host.trim()} in ${path.trim()}`
          : ""
        : worktreeHere
          ? worktree && `New worktree in ${tilde(worktree)}`
          : folder === "missing"
            ? `Creates and runs in ${tilde(path.trim())}`
            : path.trim() && folder === "directory"
              ? `Runs directly in ${tilde(path.trim())}`
              : "";
  const placeLabel =
    source === "github" ? (selected ? fullName(selected) : "") : remote ? host.trim() : folderName(path.trim());
  const mod = IS_MAC ? "⌘" : "Ctrl+";

  function agentRow(agent: Agent, index: number) {
    const choice = harnessChoice(agent);
    const state = availability[choice.id];
    const unsupported = remoteUnsupported(remote, choice);
    const panel = pickers.find((picker) => picker.id === choice.id);
    const authProvider = "signIn" in choice ? choice : undefined;
    const authStatus = authProvider ? auth?.find((entry) => entry.name === authProvider.id) : undefined;
    const update = updates[agent];
    const managed = agent !== "shell" && state && !state.installable;
    // A registry that could not answer knows of no update, so only one it reported is offered.
    const updatable = !remote && managed && update === true;
    // The check mark carries the harness's version: grey while checking, amber when an update waits,
    // green when it is current.
    const tone =
      !remote && managed && update === false
        ? "[&_svg]:text-green-600 dark:[&_svg]:text-green-400"
        : updatable
          ? "[&_svg]:text-amber-600 dark:[&_svg]:text-amber-400"
          : undefined;
    const status = unsupported ? (
      "Local workspace only"
    ) : remote ? (
      `Runs on ${host.trim() || "SSH host"}`
    ) : state === null ? (
      "Check failed"
    ) : state && !state.available ? (
      "variable" in choice && !choice.signIn ? (
        "Add an API key"
      ) : (
        "Setup required"
      )
    ) : panel && state ? (
      <span className="flex items-center gap-1.5">
        <Check className="size-3.5 shrink-0" />
        {panel.models.find(([slug]) => slug === codexChoices[modelKey(panel.id)])?.[1]} ·{" "}
        {codexChoices[levelKey(panel.id)]} thinking
      </span>
    ) : authProvider ? (
      <ProviderAuthDescription provider={authProvider} status={authStatus} />
    ) : state ? (
      "Available"
    ) : (
      "Checking…"
    );
    const disabled = busy || !placeReady || unsupported || (!remote && !state);
    return (
      <div
        key={agent}
        className={`group flex items-center gap-1 rounded-xl border pr-2 transition-colors ${agent === lastAgent ? "border-foreground/20 bg-accent/60" : "bg-card"} ${disabled ? "opacity-60" : "hover:border-foreground/25 hover:bg-accent"}`}
      >
        <button
          type="button"
          disabled={disabled}
          onClick={() => launch(agent)}
          aria-label={`Start ${agentLabel(agent)}${placeLabel ? ` in ${placeLabel}` : ""}`}
          className="flex h-14 min-w-0 flex-1 items-center gap-3 rounded-xl pl-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed"
        >
          <Tile>
            <ProviderIcon agent={agent} provider={harnessVendor(agent)} className="size-5" />
          </Tile>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex items-center gap-2 text-sm font-medium">
              {agentLabel(agent)}
              {agent === lastAgent ? (
                <span className="rounded-full border px-1.5 text-[10px] font-medium text-muted-foreground">
                  Last used
                </span>
              ) : null}
            </span>
            <ProviderLine choice={choice} tone={tone}>
              {status}
            </ProviderLine>
          </span>
          <Kbd className="hidden opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 sm:inline-flex">
            {mod}
            {index + 1}
          </Kbd>
        </button>
        {updatable ? (
          <Button
            type="button"
            size="xs"
            variant="outline"
            className="text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300"
            aria-label={`Update ${agentLabel(agent)} to the latest version`}
            disabled={busy}
            onClick={() => void install(choice)}
          >
            <RefreshCw className={installing === choice.id ? "animate-spin" : undefined} />
            {installing === choice.id ? "Updating…" : "Update"}
          </Button>
        ) : null}
        {agent === "codex" ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label="Codex provider, model and thinking"
                  disabled={busy}
                >
                  <ChevronDown aria-hidden="true" />
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Provider</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={codexChoice.id}
                  onValueChange={(id) => {
                    localStorage.setItem(CODEX_KEY, id as string);
                    setCodexId(id as string);
                  }}
                >
                  {CODEX_CHOICES.map((option) => (
                    <DropdownMenuRadioItem
                      key={option.id}
                      value={option.id}
                      disabled={remoteUnsupported(remote, option)}
                    >
                      <ProviderIcon agent={option.agent} provider={option.provider} className="size-4" />
                      <span className="flex-1">{providerName(option)}</span>
                      {availability[option.id] && !availability[option.id]?.available ? (
                        <span className="text-xs text-amber-600 dark:text-amber-400">Add key</span>
                      ) : null}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
              {panel ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Model</DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                      value={codexChoices[modelKey(panel.id)]}
                      onValueChange={(slug) => chooseCodex(modelKey(panel.id), slug as string)}
                    >
                      {panel.models.map(([slug, label]) => (
                        <DropdownMenuRadioItem key={slug} value={slug} disabled={!panel.modelChoice}>
                          {label}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Thinking</DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                      value={codexChoices[levelKey(panel.id)]}
                      onValueChange={(level) => chooseCodex(levelKey(panel.id), level as string)}
                    >
                      {panel.levels.map((level) => (
                        <DropdownMenuRadioItem key={level} value={level} className="capitalize">
                          {level}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuGroup>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    );
  }

  function setupRow(agent: Agent) {
    const choice = harnessChoice(agent);
    const state = availability[choice.id];
    const installable = Boolean(state?.installable);
    return (
      <div key={agent} className="flex h-12 items-center gap-3 rounded-xl border border-dashed pr-2 pl-3">
        <Tile className="size-8 opacity-60 grayscale-[60%]">
          <ProviderIcon agent={agent} provider={harnessVendor(agent)} className="size-4" />
        </Tile>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium text-muted-foreground">{agentLabel(agent)}</span>
          <ProviderLine choice={choice}>{installable ? "Not installed" : "Setup required"}</ProviderLine>
        </span>
        {installable ? (
          <ActionIconButton
            type="button"
            variant="outline"
            size="icon-sm"
            tooltip={installing === choice.id ? `Installing ${agentLabel(agent)}…` : `Install ${agentLabel(agent)}`}
            aria-label={`Install ${agentLabel(agent)}`}
            disabled={busy}
            onClick={() => void install(choice)}
          >
            {installing === choice.id ? <Spinner /> : <Download />}
          </ActionIconButton>
        ) : (
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setUp(choice)}>
            Set up
          </Button>
        )}
      </div>
    );
  }

  // A harness needs setup when the harness itself does. A Codex provider without its key stays in the
  // Codex row, where the menu can still switch to a provider that is ready.
  const needsSetup = (agent: Agent) => {
    const state = availability[SESSION_CHOICES.find((option) => option.agent === agent)?.id ?? ""];
    return !remote && Boolean(state && !state.available);
  };

  return (
    <Dialog open={isOpen} onOpenChange={changeOpen}>
      <DialogContent
        initialFocus={() => searchRef.current ?? folderRef.current ?? true}
        showCloseButton={!launching || Boolean(launching.error)}
        className={launching ? "gap-0 p-5 sm:max-w-xs" : "gap-0 p-0 sm:h-[min(45rem,calc(100dvh-2rem))] sm:max-w-4xl"}
      >
        {/* While a session starts, the dialog becomes its progress card. The choices stay mounted, so a
            failed step brings them back as they were, with the error. */}
        <form
          onSubmit={submit}
          onKeyDown={numberKey}
          className={cn("flex min-h-0 min-w-0 flex-1 flex-col", launching && "hidden")}
        >
          <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true" />
          <DialogHeader className="px-5 pt-4 pb-3">
            <DialogTitle>New session</DialogTitle>
            <DialogDescription className="sr-only">
              Choose where the session runs, then the agent that starts it.
            </DialogDescription>
          </DialogHeader>
          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto border-t sm:grid-cols-2 sm:overflow-hidden">
            <div className="flex min-h-0 min-w-0 flex-col border-b sm:border-r sm:border-b-0">
              <Tabs value={source} onValueChange={(value) => changeSource(value as Source)} className="px-3 pt-3 pb-2">
                <TabsList className="w-full">
                  <TabsTrigger value="github" disabled={busy}>
                    <GitHubLogomark className="size-3.5" />
                    GitHub
                  </TabsTrigger>
                  <TabsTrigger value="local" disabled={busy}>
                    <FolderOpen />
                    Local
                  </TabsTrigger>
                  {remoteSsh ? (
                    <TabsTrigger value="ssh" disabled={busy}>
                      <Server />
                      SSH
                    </TabsTrigger>
                  ) : null}
                </TabsList>
              </Tabs>
              {source === "github" ? (
                github && !github.signedIn ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
                    <span className="flex size-12 items-center justify-center rounded-xl border bg-card">
                      <GitHubLogomark className="size-6" />
                    </span>
                    <p className="text-sm font-medium">Connect GitHub</p>
                    <p className="max-w-72 text-xs text-muted-foreground">
                      Lite lists and clones your repositories through the GitHub CLI’s own sign-in. Lite never sees your
                      token.
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        changeOpen(false);
                        onGitHubSignIn();
                      }}
                    >
                      Sign in with GitHub CLI
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => changeSource("local")}>
                      Use a local folder instead
                    </Button>
                  </div>
                ) : (
                  <>
                    <SearchInput
                      className="px-3 pb-1"
                      inputRef={searchRef}
                      value={query}
                      placeholder="Search your repositories and GitHub…"
                      onKeyDown={moveSelection}
                      onChange={(value) => {
                        setQuery(value);
                        const first = [...known.values()].find((repository) =>
                          fullName(repository).toLowerCase().includes(value.trim().toLowerCase()),
                        );
                        if (first) setSelectedName(fullName(first));
                      }}
                    />
                    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                      {!github ? (
                        <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
                          <Spinner /> Loading your repositories…
                        </div>
                      ) : null}
                      {groups.map((group) =>
                        group.repositories.length ? (
                          <div key={group.label} className="pt-2">
                            <p className={`px-2 pb-1 ${SECTION}`}>{group.label}</p>
                            {group.repositories.map((repository) => {
                              const active = Boolean(selected) && fullName(repository) === fullName(selected);
                              const count = running(repository);
                              return (
                                <button
                                  key={fullName(repository)}
                                  type="button"
                                  ref={active ? reveal : undefined}
                                  aria-pressed={active}
                                  disabled={busy}
                                  onClick={() => {
                                    setSelectedName(fullName(repository));
                                    searchRef.current?.focus();
                                  }}
                                  className={pickRow(active, confirmed)}
                                >
                                  <Tile>
                                    <GitHubLogomark className="size-4.5" />
                                  </Tile>
                                  <span className="flex min-w-0 flex-1 flex-col">
                                    <span className="flex min-w-0 items-center gap-1 text-sm">
                                      <span className="truncate">
                                        <span className="text-muted-foreground">{repository.owner}/</span>
                                        <span className="font-medium">{repository.name}</span>
                                      </span>
                                      {repository.private ? (
                                        <Lock aria-label="Private" className="size-3 shrink-0 text-muted-foreground" />
                                      ) : null}
                                    </span>
                                    <span className="flex min-w-0 items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground">
                                      {repository.language ? (
                                        <>
                                          <span
                                            className="size-2 rounded-full"
                                            style={{ background: repository.color ?? "currentColor" }}
                                          />
                                          {repository.language}
                                        </>
                                      ) : null}
                                      {repository.language && repository.pushedAt ? <span>·</span> : null}
                                      {repository.pushedAt ? relativeAge(repository.pushedAt) : null}
                                      {repository.local ? (
                                        <>
                                          <span>·</span>
                                          <span className="min-w-0 truncate font-mono" title={repository.local}>
                                            {tilde(repository.local)}
                                          </span>
                                        </>
                                      ) : null}
                                    </span>
                                  </span>
                                  {count ? (
                                    <span className="flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] text-success">
                                      <span className="size-1.5 rounded-full bg-success" />
                                      {count} running
                                    </span>
                                  ) : null}
                                </button>
                              );
                            })}
                          </div>
                        ) : null,
                      )}
                      {search.length >= 2 && found?.query !== search ? (
                        <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
                          <Spinner /> Searching GitHub for “{search}”…
                        </div>
                      ) : null}
                      {github && !visible.length && !(search.length >= 2 && found?.query !== search) ? (
                        <p className="px-2 py-3 text-xs text-muted-foreground">
                          {search ? "No repositories match." : "No repositories yet."}
                        </p>
                      ) : null}
                    </div>
                  </>
                )
              ) : (
                <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-2">
                  {remote ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="ssh-host">SSH host</Label>
                      <Input
                        id="ssh-host"
                        value={host}
                        className="font-mono"
                        placeholder="user@server or SSH config name"
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(event) => {
                          setHost(event.target.value);
                          localStorage.setItem(SSH_HOST_KEY, event.target.value);
                        }}
                      />
                    </div>
                  ) : null}
                  <div className="space-y-1.5">
                    {remote ? <Label htmlFor="project-folder">Folder on host</Label> : null}
                    <div className="flex gap-2">
                      <div className="relative min-w-0 flex-1">
                        <Input
                          ref={folderRef}
                          id="project-folder"
                          value={path}
                          className={`pr-8 font-mono ${folder === "directory" ? "border-success focus-visible:border-success focus-visible:ring-success/20" : folder === "missing" ? "border-amber-500 focus-visible:border-amber-500 focus-visible:ring-amber-500/20" : ""}`}
                          placeholder={remote ? "/home/user/project" : "Type or choose a project folder…"}
                          aria-label={remote ? undefined : "Project folder"}
                          autoComplete="off"
                          spellCheck={false}
                          aria-invalid={folder === "other" || undefined}
                          aria-describedby={
                            folder === "missing" || folder === "other" ? "project-folder-status" : undefined
                          }
                          onKeyDown={remote ? undefined : moveSelection}
                          onChange={(event) => setPath(event.target.value)}
                        />
                        {folder === "directory" ? (
                          <Check
                            className="absolute top-1/2 right-2 size-4 -translate-y-1/2 text-success"
                            aria-hidden="true"
                          />
                        ) : folder === "missing" ? (
                          <TriangleAlert
                            className="absolute top-1/2 right-2 size-4 -translate-y-1/2 text-amber-500"
                            aria-hidden="true"
                          />
                        ) : folder === "other" ? (
                          <CircleAlert
                            className="absolute top-1/2 right-2 size-4 -translate-y-1/2 text-destructive"
                            aria-hidden="true"
                          />
                        ) : null}
                      </div>
                      {remote ? null : (
                        <ActionIconButton
                          type="button"
                          variant="outline"
                          size="icon"
                          tooltip="Browse"
                          aria-label="Browse for a folder"
                          onClick={() => void chooseFolder()}
                        >
                          <FolderOpen />
                        </ActionIconButton>
                      )}
                    </div>
                    {remote ? (
                      <p className="text-xs text-muted-foreground">
                        Uses your SSH config and agent sign-in on the Linux server. Connect once from a terminal first;
                        key authentication must be non-interactive.
                      </p>
                    ) : folder === "missing" ? (
                      <p id="project-folder-status" className="text-xs text-amber-600 dark:text-amber-400">
                        This folder does not exist and will be created.
                      </p>
                    ) : folder === "other" ? (
                      <p id="project-folder-status" className="text-xs text-destructive">
                        This path is not a folder.
                      </p>
                    ) : null}
                  </div>
                  {!remote && folders.length ? (
                    <div className="-mx-1 min-h-0 overflow-y-auto px-1">
                      <p className={`px-1 pb-1 ${SECTION}`}>Recent folders</p>
                      {folders.map((place) => {
                        const probe = folderProbes[place];
                        const active = place === path.trim();
                        const remoteName = probe?.repository?.remote?.replace(/^https:\/\/[^/]+\//, "");
                        return (
                          <button
                            key={place}
                            type="button"
                            ref={active ? reveal : undefined}
                            aria-pressed={active}
                            disabled={busy}
                            onClick={() => pickFolder(place)}
                            className={pickRow(active, confirmed)}
                          >
                            <Tile>
                              {/* A GitHub clone, any other repository, or a plain folder. */}
                              {probe?.repository?.remote?.startsWith("https://github.com/") ? (
                                <GitHubLogomark className="size-4.5" />
                              ) : probe?.repository ? (
                                <GitLogomark className="size-4.5" />
                              ) : (
                                <FolderOpen className="size-4.5 text-muted-foreground" />
                              )}
                            </Tile>
                            <span className="flex min-w-0 flex-1 flex-col">
                              <span className="truncate text-sm font-medium">{folderName(place) || place}</span>
                              <span className="truncate font-mono text-xs text-muted-foreground">{tilde(place)}</span>
                            </span>
                            {remoteName ? (
                              <span className="max-w-40 shrink-0 truncate rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                                {remoteName}
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              )}
              {github?.signedIn || source !== "github" ? (
                <div
                  className={cn(
                    "m-3 mt-1 space-y-2 rounded-xl border bg-card/60 p-3 transition-colors duration-300",
                    confirmed && "border-success/40",
                  )}
                >
                  <div className="flex items-center gap-3">
                    <Label htmlFor="session-title" className="w-12 shrink-0 text-xs text-muted-foreground">
                      Name
                    </Label>
                    <Input
                      id="session-title"
                      value={title}
                      className="h-8"
                      placeholder={defaultName || "Session name"}
                      autoComplete="off"
                      onChange={(event) => setTitle(event.target.value)}
                    />
                    <div className="flex shrink-0 items-center gap-2">
                      <Label htmlFor="session-flags-on" className="text-xs text-muted-foreground">
                        Flags
                      </Label>
                      <Switch
                        id="session-flags-on"
                        checked={flagsOn}
                        onCheckedChange={(checked) => {
                          localStorage.setItem(FLAGS_KEY, String(checked));
                          setFlagsOn(checked);
                        }}
                      />
                    </div>
                  </div>
                  {flagsOn ? (
                    <div className="flex items-center gap-3">
                      <Label htmlFor="session-flags" className="w-12 shrink-0 text-xs text-muted-foreground">
                        Flags
                      </Label>
                      <Input
                        id="session-flags"
                        value={flags}
                        className="h-8 font-mono text-xs"
                        placeholder="Extra CLI flags"
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(event) => setFlags(event.target.value)}
                      />
                    </div>
                  ) : null}
                  {worktreeHere ? (
                    <div className="flex items-center gap-3">
                      <Label htmlFor="worktree-branch" className="w-12 shrink-0 text-xs text-muted-foreground">
                        Branch
                      </Label>
                      <Input
                        id="worktree-branch"
                        value={branch}
                        className="h-8 font-mono text-xs"
                        placeholder={defaultBranch || "New branch"}
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(event) => setBranch(event.target.value)}
                      />
                    </div>
                  ) : null}
                  <div
                    className={cn(
                      "flex min-h-5 items-center gap-2 text-xs transition-colors duration-300",
                      confirmed && whereLine ? "text-foreground/80" : "text-muted-foreground",
                    )}
                  >
                    {confirmed && whereLine ? (
                      <CircleCheck aria-label="Ready" className="size-3.5 shrink-0 text-success" />
                    ) : worktreeHere ? (
                      <GitBranch aria-hidden="true" className="size-3.5 shrink-0" />
                    ) : (
                      <FolderOpen aria-hidden="true" className="size-3.5 shrink-0" />
                    )}
                    <span className="min-w-0 flex-1 truncate font-mono" title={whereLine}>
                      {whereLine}
                    </span>
                    {(source === "github" && selected) || (source === "local" && repo) ? (
                      <>
                        <Label htmlFor="new-worktree" className="text-xs text-muted-foreground">
                          Worktree
                        </Label>
                        <Switch
                          id="new-worktree"
                          checked={worktreeOn}
                          onCheckedChange={(checked) => {
                            localStorage.setItem(WORKTREE_KEY, String(checked));
                            setWorktreeOn(checked);
                          }}
                        />
                      </>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="flex min-h-0 min-w-0 flex-col bg-muted/20">
              <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-2">
                <p className={SECTION}>Start with</p>
                <p className="truncate text-xs text-muted-foreground">
                  {placeReady ? (
                    <span className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          confirmed ? "bg-success" : "bg-muted-foreground",
                        )}
                      />
                      in {placeLabel}
                    </span>
                  ) : source === "github" && !github?.signedIn ? (
                    "Connect GitHub first"
                  ) : (
                    "Choose where it runs"
                  )}
                </p>
              </div>
              <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 pb-3">
                {HARNESSES.map((agent, index) => (needsSetup(agent) ? null : agentRow(agent, index)))}
                {HARNESSES.some(needsSetup) ? (
                  <>
                    <div className={`flex items-center gap-2 px-1 pt-2 ${SECTION}`}>
                      Needs setup
                      <span className="h-px flex-1 bg-border" />
                    </div>
                    {HARNESSES.filter(needsSetup).map(setupRow)}
                  </>
                ) : null}
                {error ? <p className="px-1 pt-1 text-xs text-destructive">{error}</p> : null}
              </div>
            </div>
          </div>
          <div className="hidden items-center gap-4 border-t px-5 py-2.5 text-xs text-muted-foreground sm:flex">
            <span className="flex items-center gap-1.5">
              <Kbd>↑↓</Kbd> Choose
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd>↵</Kbd> Start {agentLabel(lastAgent)}
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd>
                {mod}1–{HARNESSES.length}
              </Kbd>{" "}
              Start an agent
            </span>
          </div>
        </form>
        {launching ? (
          <div role="status" aria-live="polite" className="space-y-4">
            <div className="flex items-center gap-3">
              <Tile className="size-10">
                <ProviderIcon
                  agent={launching.choice.agent}
                  provider={harnessVendor(launching.choice.agent)}
                  className="size-5"
                />
              </Tile>
              <div className="min-w-0">
                <p className="text-sm font-medium">Starting {agentLabel(launching.choice.agent)}</p>
                <p className="truncate text-xs text-muted-foreground">in {launching.place}</p>
              </div>
            </div>
            <ol className="space-y-2.5 text-sm">
              {launching.steps.map(([running, done], index) => (
                <li
                  key={running}
                  className={cn("flex items-center gap-2.5", index > launching.done && "text-muted-foreground")}
                >
                  {index < launching.done ? (
                    <Check aria-label="Done" className="size-4 shrink-0 text-success" />
                  ) : index === launching.done && launching.error ? (
                    <X aria-label="Failed" className="size-4 shrink-0 text-destructive" />
                  ) : index === launching.done ? (
                    <Spinner className="size-4 shrink-0" />
                  ) : (
                    <span className="size-4 shrink-0 rounded-full border" />
                  )}
                  {index < launching.done
                    ? done
                    : index === launching.done && !launching.error
                      ? `${running}…`
                      : running}
                </li>
              ))}
            </ol>
            {launching.error ? (
              <>
                <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs break-words text-destructive">
                  {launching.error}
                </p>
                <Button type="button" variant="outline" className="w-full" onClick={() => setLaunching(undefined)}>
                  Back
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
        <ApiKeyDialog
          provider={keyFor}
          replacing={false}
          saveLabel="Save and start"
          footer={
            <Button
              type="button"
              variant="link"
              className="px-0"
              onClick={() => {
                setKeyFor(undefined);
                changeOpen(false);
                onApiKeys();
              }}
            >
              Manage keys in Settings
            </Button>
          }
          onClose={() => setKeyFor(undefined)}
          onSaved={() => keySaved(keyFor)}
        />
      </DialogContent>
    </Dialog>
  );
}
