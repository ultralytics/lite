// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

interface Candidate {
  index: number;
  priority: number;
  url: string;
}

// Only repository-qualified references are actionable. A terminal session can move between folders,
// so its starting repository is not evidence for a bare number or gh command later in the transcript.
// biome-ignore lint/suspicious/noControlCharactersInRegex: a color code has to be named to be removed.
const COLOR = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const GITHUB_ITEM = /\bhttps:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(pull|issues)\/([1-9]\d{0,8})(?!\w)/gi;
const QUALIFIED_ITEM = /(?:^|[^\w./-])(\w[\w.-]*)\/(\w[\w.-]*)#([1-9]\d{0,8})(?!\w)/g;
const ITEM_MENTION =
  /(?:^|[^\w./-])(\w[\w.-]*\/\w[\w.-]*)[ \t]+(pull requests?|PRs?|issues?)[ \t]+#?([1-9]\d{0,8})(?![\w.])/gi;
const GH_ITEM_COMMAND =
  /\bgh\s+(issue|pr)\s+(?!create\b|list\b|status\b)[\w-]+((?:[^;&|'"\\\r\n]|\\.|'[^']*'|"(?:\\.|[^"\\])*")*)/gi;
const GH_REPOSITORY =
  /^((?:[^'"\\]|\\.|'[^']*'|"(?:\\.|[^"\\])*")*?\s)(?:--repo|-R)(?:=|\s+)(?:([\w.-]+\/[\w.-]+)|'([\w.-]+\/[\w.-]+)'|"([\w.-]+\/[\w.-]+)")/i;
const GH_API =
  /\bgh\s+api\s+["']?(?:https:\/\/api\.github\.com\/)?\/?repos\/([\w.-]+)\/([\w.-]+)\/(issues|pulls)\/([1-9]\d{0,8})(?![\w/])/gi;

export function githubItemUrls(output: string): string[] {
  const text = output.replace(COLOR, "");
  const candidates: Candidate[] = [];
  const add = (match: RegExpMatchArray, repository: string, kind: string, number: string, priority: number) => {
    candidates.push({
      index: match.index ?? 0,
      priority,
      url: `https://github.com/${repository}/${kind}/${number}`,
    });
  };

  for (const match of text.matchAll(GITHUB_ITEM))
    add(match, `${match[1]}/${match[2]}`, match[3].toLowerCase(), match[4], 4);
  for (const match of text.matchAll(QUALIFIED_ITEM)) add(match, `${match[1]}/${match[2]}`, "issues", match[3], 1);
  for (const match of text.matchAll(ITEM_MENTION)) {
    add(match, match[1], match[2].toLowerCase().startsWith("issue") ? "issues" : "pull", match[3], 2);
  }
  for (const match of text.matchAll(GH_ITEM_COMMAND)) {
    const repositoryMatch = match[2].match(GH_REPOSITORY);
    const repository = repositoryMatch?.slice(2).find(Boolean);
    const number = match[2].replace(GH_REPOSITORY, "$1").match(/^\s+([1-9]\d{0,8})(?![\w.])/)?.[1];
    if (repository && number) add(match, repository, match[1].toLowerCase() === "pr" ? "pull" : "issues", number, 2);
  }
  for (const match of text.matchAll(GH_API)) {
    add(match, `${match[1]}/${match[2]}`, match[3].toLowerCase() === "pulls" ? "pull" : "issues", match[4], 3);
  }

  candidates.sort((left, right) => left.index - right.index);
  const items = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const [, , , owner, repository, , number] = candidate.url.split("/");
    const key = `${owner}/${repository}#${number}`.toLowerCase();
    const current = items.get(key);
    if (!current || candidate.priority > current.priority) items.set(key, candidate);
  }
  return [...items.values()].map(({ url }) => url);
}
