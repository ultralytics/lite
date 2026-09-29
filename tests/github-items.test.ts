// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { describe, expect, test } from "bun:test";

import { Terminal } from "@xterm/xterm";

import { githubItemReferences, likelyGitHubItems, mergeGitHubItems } from "../src/github-items";
import { appendOutput, clearOutput, readTerminalInput, recordTerminalInput, renderedOutput } from "../src/output-store";

const references = (output: string, remote = "", terminalStream = "", prose = output) => {
  const { explicit, inferred } = githubItemReferences(output, remote, terminalStream, prose);
  return { explicit, inferred };
};
const explicit = (output: string) => references(output).explicit;

describe("output activity", () => {
  test("keeps Claude background activity authoritative across output chunks", () => {
    const bytes = (value: string) => new TextEncoder().encode(value);
    expect(appendOutput("activity", bytes("\x1b]6973;lite-work"))).toMatchObject({
      activityChanged: false,
      backgroundActivity: undefined,
    });
    expect(appendOutput("activity", bytes("ing\x07Lite"))).toMatchObject({
      activity: true,
      activityChanged: true,
      backgroundActivity: true,
    });
    expect(appendOutput("activity", bytes("\x07"))).toMatchObject({
      activity: undefined,
      activityChanged: false,
      backgroundActivity: true,
      notification: true,
    });
    expect(appendOutput("activity", bytes("\x1b]6973;lite-idle\x07Lite"))).toMatchObject({
      activity: false,
      activityChanged: true,
      backgroundActivity: false,
    });
    clearOutput("activity");
  });
});

describe("githubItemReferences", () => {
  test("keeps user prose separate from terminal output for the session lifetime", () => {
    recordTerminalInput("session", "Review PR #112");
    recordTerminalInput("session", "and issue 90");
    expect(readTerminalInput("session")).toBe("Review PR #112\nand issue 90");
    clearOutput("session");
    expect(readTerminalInput("session")).toBe("");
  });

  test("does not assign commands from moved worktrees to the session repository", () => {
    const transcript = `
$ gh pr view 3608 --repo ultralytics/portal --json url
{"url":"https://github.com/ultralytics/portal/pull/3608"}
$ gh pr view 102 --json body,headRefOid,url
{"url":"https://github.com/ultralytics/lite/pull/102"}
$ gh issue view 3052
https://github.com/ultralytics/assistant/pull/3052
Updated Lite PR #102 (https://github.com/ultralytics/lite/pull/102)
`;

    expect(explicit(transcript)).toEqual([
      "https://github.com/ultralytics/portal/pull/3608",
      "https://github.com/ultralytics/lite/pull/102",
      "https://github.com/ultralytics/assistant/pull/3052",
    ]);
  });

  test("recognizes every repository-qualified form", () => {
    const transcript = `
https://github.com/ultralytics/lite/pull/102/files
ultralytics/portal#3608
ultralytics/assistant issue #3052
gh pr checks 97 --repo ultralytics/lite
gh issue close -R=ultralytics/portal 3497
gh pr view --json number -R ultralytics/lite 94
gh api repos/ultralytics/assistant/pulls/3048
`;

    expect(references(transcript)).toEqual({
      explicit: [
        "https://github.com/ultralytics/lite/pull/102",
        "https://github.com/ultralytics/portal/issues/3608",
        "https://github.com/ultralytics/assistant/issues/3052",
        "https://github.com/ultralytics/lite/pull/97",
        "https://github.com/ultralytics/portal/issues/3497",
        "https://github.com/ultralytics/lite/pull/94",
        "https://github.com/ultralytics/assistant/pull/3048",
      ],
      inferred: [],
    });
  });

  test("rejects ambiguous and malformed references", () => {
    const transcript = `
PR #102 and issue 3052
gh pr view 102
gh issue close 3052
gh pr list --repo ultralytics/lite
gh pr create --repo ultralytics/lite
gh pr checks --interval 10 102 --repo ultralytics/lite
Image #1
src/components/ui/button.tsx:102
https://github.com/ultralytics/lite/pull/0
https://github.com/ultralytics/lite/pull/1234567890
https://github.com/ultralytics/lite/pull/102abc
`;

    expect(explicit(transcript)).toEqual([]);
  });

  test("keeps command boundaries and quoted arguments isolated", () => {
    const transcript = `
gh pr edit 12 --body "mention --repo wrong/repo" && gh pr view 13 -R right/repo
gh issue view 14; gh pr view 15 --repo next/repo
gh pr status --repo ignored/repo | gh issue view 16 -R final/repo
`;

    expect(explicit(transcript)).toEqual([
      "https://github.com/right/repo/pull/13",
      "https://github.com/next/repo/pull/15",
      "https://github.com/final/repo/issues/16",
    ]);
  });

  test("deduplicates forms by repository and number using the strongest kind", () => {
    const transcript = `
ultralytics/lite#102
ultralytics/lite issue #102
gh api repos/ultralytics/lite/issues/102
https://github.com/ultralytics/lite/pull/102
gh issue view 102 --repo ULTRALYTICS/LITE
`;

    expect(explicit(transcript)).toEqual(["https://github.com/ultralytics/lite/pull/102"]);
  });

  test("reads links through terminal color and hyperlink sequences", () => {
    const transcript =
      "\u001b[32mhttps://github.com/ultralytics/lite/issues/88\u001b[0m " +
      "\u001b]8;;https://github.com/ultralytics/lite/pull/90\u0007PR\u001b]8;;\u0007";

    expect(references("https://github.com/ultralytics/lite/issues/88 PR", "", transcript).explicit).toEqual([
      "https://github.com/ultralytics/lite/issues/88",
      "https://github.com/ultralytics/lite/pull/90",
    ]);
  });

  test("reads Markdown links but not the Codecov comment footer", () => {
    const comment = `Review [this PR](https://github.com/ultralytics/lite/pull/12)
:loudspeaker: Thoughts on this report? [Let us know!](https://github.com/codecov/feedback/issues/255)
#14 is next`;

    expect(references(comment, "https://github.com/ultralytics/lite", "", "")).toEqual({
      explicit: ["https://github.com/ultralytics/lite/pull/12"],
      inferred: [["https://github.com/ultralytics/lite/pull/14"]],
    });
  });

  test("does not recover incomplete plain URLs from the control stream", () => {
    const stream = "https://github.com/ultralytics/lite/pull/36\u001b[2D12";
    expect(references("", "", stream)).toEqual({ explicit: [], inferred: [] });
  });

  test("separates ambiguous references for recent-activity verification", () => {
    const found = references(
      `
PR #102 and issue #3052
gh pr view 94
gh issue close 88
https://github.com/ultralytics/lite/pull/97
ultralytics/lite PR #102
`,
      "https://github.com/ultralytics/lite",
    );

    expect(found).toEqual({
      explicit: ["https://github.com/ultralytics/lite/pull/97", "https://github.com/ultralytics/lite/pull/102"],
      inferred: [
        ["https://github.com/ultralytics/lite/pull/94"],
        ["https://github.com/ultralytics/lite/issues/88"],
        ["https://github.com/ultralytics/lite/issues/3052"],
      ],
    });
  });

  test("reads bare references in user and agent prose but not logged commits", () => {
    const found = references(
      `https://github.com/ultralytics/lite/pull/111
#57, #56 and #58 are merged
- #59 (palette masks): rewritten smaller
91cec83 Add macOS session notifications and settings workspace (#84)
  ⎿  7da5382 Update zensical (#349)
Merged the docs note (#60)
Please review (PR #61)
The agent also discussed ultralytics/portal PR #3612.`,
      "https://github.com/ultralytics/lite",
      "",
      "Review PR #112 and issue 90 in this session",
    );
    const group = (kind: string, number: number) =>
      ["lite", "portal"].map((name) => `https://github.com/ultralytics/${name}/${kind}/${number}`);

    expect(found).toEqual({
      explicit: ["https://github.com/ultralytics/lite/pull/111", "https://github.com/ultralytics/portal/pull/3612"],
      inferred: [
        group("pull", 57),
        group("pull", 56),
        group("pull", 58),
        group("pull", 59),
        group("pull", 60),
        group("pull", 61),
        group("pull", 112),
        group("issues", 90),
      ],
    });
  });

  test("resolves references a redraw removed as they resolved when seen", () => {
    const output = `#26430 is merged and gh pr view 7
[PR #102: fix crash](https://github.com/ultralytics/ultralytics/pull/102)
https://github.com/ultralytics/portal/pull/999
Portal #192 needs review`;
    const seen = githubItemReferences(output, "", "", "");
    expect(seen.remembered).toEqual({
      mentions: ["pull 7 ", "pull 26430 ", "pull 102 pr", "pull 192 portal"],
      repositories: ["ultralytics/ultralytics", "ultralytics/portal"],
    });
    // The same output remembers nothing new.
    expect(githubItemReferences(output, "", "", "", seen.remembered).remembered).toEqual(seen.remembered);

    // A label's group still holds its linked item, which the panel already lists, and a short name still
    // narrows to its repository.
    const group = (number: number) =>
      ["lite", "ultralytics", "portal"].map((name) => `https://github.com/ultralytics/${name}/pull/${number}`);
    expect(githubItemReferences("", "https://github.com/ultralytics/lite", "", "", seen.remembered).inferred).toEqual([
      group(7),
      group(26430),
      group(102),
      ["https://github.com/ultralytics/portal/pull/192"],
    ]);
  });

  test("uses one named repository to resolve user prose without a Git remote", () => {
    expect(references("See https://github.com/ultralytics/portal. Then review PR 3612.")).toEqual({
      explicit: [],
      inferred: [["https://github.com/ultralytics/portal/pull/3612"]],
    });
  });

  test("keeps inferred items only when GitHub confirms activity in the last 30 days", () => {
    const inferred = [
      "https://github.com/ultralytics/portal/pull/102",
      "https://github.com/ultralytics/portal/issues/3052",
    ];
    const now = Date.parse("2026-08-14T18:00:00Z");
    const items = [
      { url: inferred[0], updatedAt: "2026-07-14T18:00:00Z" },
      { url: inferred[1], updatedAt: "2026-07-16T18:00:00Z" },
      { url: "https://github.com/ultralytics/lite/pull/102", updatedAt: null },
    ];

    expect(
      likelyGitHubItems(
        items,
        inferred.map((url) => [url]),
        now,
      ),
    ).toEqual([items[1], items[2]]);
  });

  test("resolves a bare reference to the session repository GitHub shows active", () => {
    const found = references(
      `gh pr view 16 --json url
gh pr view 77 -R ultralytics/sdk --json title
gh pr merge 347 -R ultralytics/handbook --squash`,
      "https://github.com/ultralytics/skills",
      "",
      "handbook - 3 open PRs\n#349 Update zensical requirement from >=0.0.60 to >=0.0.62",
    );
    const group = ["skills", "sdk", "handbook"].map((name) => `https://github.com/ultralytics/${name}/pull/349`);
    expect(found).toEqual({
      explicit: ["https://github.com/ultralytics/sdk/pull/77", "https://github.com/ultralytics/handbook/pull/347"],
      inferred: [
        ["https://github.com/ultralytics/skills/pull/16", ...group.slice(1).map((url) => url.replace("349", "16"))],
        group,
      ],
    });

    const now = Date.parse("2026-09-22T18:00:00Z");
    const checked = [
      { url: group[1], updatedAt: "2026-09-01T00:00:00Z" },
      { url: group[2], updatedAt: "2026-09-22T17:00:00Z" },
    ];
    expect(likelyGitHubItems(checked, [group], now)).toEqual([checked[1]]);
  });

  test("narrows a reference to a short repository name the session names", () => {
    expect(
      references(
        "ultralytics/portal#4225 merged; Lite #192 is approved; Since #3143 it skips",
        "https://github.com/ultralytics/lite",
        "",
        "",
      ).inferred,
    ).toEqual([
      ["https://github.com/ultralytics/lite/pull/192"],
      ["https://github.com/ultralytics/lite/pull/3143", "https://github.com/ultralytics/portal/pull/3143"],
    ]);
  });

  test("reads an unqualified command number inside Claude Code's Bash(...)", () => {
    expect(references("⏺ Bash(gh pr view 16)", "https://github.com/ultralytics/skills").inferred).toEqual([
      ["https://github.com/ultralytics/skills/pull/16"],
    ]);
  });

  test("finds a command after the word gh earlier on the line", () => {
    expect(
      explicit(`I checked with gh and then ran gh pr view 12 -R ultralytics/lite to confirm.
Using gh auth token for gh pr merge 347 -R ultralytics/handbook`),
    ).toEqual(["https://github.com/ultralytics/lite/pull/12", "https://github.com/ultralytics/handbook/pull/347"]);
  });

  test("names repositories only from a command's own repository flag", () => {
    const found = references(
      `⏺ Bash(gh pr list -R ultralytics/handbook)
gh pr edit 12 --body "mention --repo fake/repo"
for n in 1 2; do gh pr view $n -R ultralytics/sdk; done
gh run view 35765314774 --repo ultralytics/portal --log-failed`,
      "https://github.com/ultralytics/skills",
      "",
      "please look at skills #192 and #349",
    );
    const repositories = ["skills", "handbook", "sdk", "portal"];
    expect(found.inferred).toEqual([
      repositories.map((name) => `https://github.com/ultralytics/${name}/pull/12`),
      ["https://github.com/ultralytics/skills/pull/192"],
      repositories.map((name) => `https://github.com/ultralytics/${name}/pull/349`),
    ]);
  });

  test("keeps session items while refreshing mutable GitHub fields", () => {
    const current = [
      { url: "https://github.com/ultralytics/lite/issues/107", title: "Old", state: "open" },
      { url: "https://github.com/ultralytics/lite/issues/99", title: "Kept", state: "open" },
    ];
    const updates = [
      { url: "https://github.com/ultralytics/lite/pull/107", title: "Updated", state: "merged" },
      { url: "https://github.com/ultralytics/lite/issues/108", title: "Added", state: "open" },
    ];

    expect(mergeGitHubItems(current, updates)).toEqual([updates[0], current[1], updates[1]]);
  });

  test("removes the cross-worktree duplicates from the reported transcript", () => {
    const found = references(
      `
gh pr view 102 --json url
https://github.com/ultralytics/lite/pull/102
gh issue view 3052
https://github.com/ultralytics/assistant/pull/3052
`,
      "https://github.com/ultralytics/portal",
    );
    const checked = [...found.explicit, ...found.inferred.flat()].map((url) => ({
      url,
      updatedAt: url.includes("/portal/") ? "2026-07-01T00:00:00Z" : "2026-08-14T17:00:00Z",
    }));

    expect(likelyGitHubItems(checked, found.inferred, Date.parse("2026-08-14T18:00:00Z"))).toEqual([
      checked[0],
      checked[1],
    ]);
  });
});

describe("renderedOutput", () => {
  const rendered = async (cols: number, rows: string[]) => {
    const terminal = new Terminal({ cols, rows: 10, allowProposedApi: true });
    await new Promise<void>((resolve) => terminal.write(`${rows.join("\r\n")}\r\n`, resolve));
    return renderedOutput(terminal).trimEnd();
  };

  test("joins rows an agent wrapped itself back into the lines a person reads", async () => {
    // Claude continues a wrapped command under deeper indentation, Codex under a gutter, and both cut a
    // token that fills the row.
    expect(
      await rendered(32, [
        "⏺ Bash(gh pr merge 347 --squash",
        "      -R ultralytics/handbook)",
        "• Ran gh pr view 4225 --repo",
        "  │ ultralytics/portal --json url",
        "https://github.com/ultralytics/h",
        "andbook/pull/349",
      ]),
    ).toBe(
      [
        "⏺ Bash(gh pr merge 347 --squash -R ultralytics/handbook)",
        "• Ran gh pr view 4225 --repo ultralytics/portal --json url",
        "https://github.com/ultralytics/handbook/pull/349",
      ].join("\n"),
    );
  });

  test("keeps the space where a full row ends exactly at a word", async () => {
    expect(await rendered(36, ["Merged https://github.com/o/r/pull/1", "  2 follow-ups remain."])).toBe(
      "Merged https://github.com/o/r/pull/1 2 follow-ups remain.",
    );
    expect(await rendered(28, ["I merged ultralytics/lite#12", "and then stopped."])).toBe(
      "I merged ultralytics/lite#12 and then stopped.",
    );
  });

  test("keeps short rows, output markers, and table borders on lines of their own", async () => {
    const rows = [
      "• Ran git log -1 --format=%s",
      "  └ cfba7d30c1 Fix the demo (#4219)",
      "  │ #26273 │ Repeated safe_download │",
      "  ├────────┼────────────────────────┤",
      "  ⎿  7da5382 Update zensical (#349)",
    ];
    expect(await rendered(40, rows)).toBe(rows.join("\n"));
  });
});
