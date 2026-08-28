// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { indentWithTab } from "@codemirror/commands";
import { HighlightStyle, indentUnit, LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { languages as editorLanguages } from "@codemirror/language-data";
import { Chunk } from "@codemirror/merge";
import {
  closeSearchPanel,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  SearchQuery,
  search,
  setSearchQuery,
} from "@codemirror/search";
import { EditorSelection, EditorState, type Range, RangeSet, StateEffect, StateField } from "@codemirror/state";
import { EditorView, GutterMarker, gutter, keymap, type Panel } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { basicSetup } from "codemirror";
import { CaseSensitive, ChevronDown, ChevronUp, Regex, Replace, Search, WholeWord, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { IS_MAC, matchesShortcut } from "@/shortcuts";

const editorHighlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.bool, tags.null], color: "var(--syntax-keyword)" },
  { tag: [tags.string, tags.regexp, tags.character, tags.attributeValue], color: "var(--syntax-string)" },
  { tag: [tags.number, tags.atom], color: "var(--syntax-constant)" },
  { tag: [tags.comment, tags.docComment], color: "var(--syntax-comment)" },
  { tag: [tags.variableName, tags.operator], color: "var(--syntax-variable)" },
  { tag: [tags.propertyName, tags.typeName, tags.className], color: "var(--syntax-entity)" },
  { tag: [tags.tagName, tags.attributeName], color: "var(--syntax-tag)" },
  { tag: [tags.heading, tags.strong], color: "var(--syntax-entity)", fontWeight: "600" },
  { tag: tags.emphasis, color: "var(--syntax-variable)", fontStyle: "italic" },
  { tag: [tags.monospace, tags.link, tags.url], color: "var(--syntax-string)" },
  { tag: [tags.meta, tags.processingInstruction], color: "var(--syntax-constant)" },
  { tag: [tags.contentSeparator, tags.list, tags.quote], color: "var(--syntax-bullet)" },
]);

// The unit a file already indents by: a tab if any line starts with one, two spaces if any line sits
// at two or six (a four-space file has no such line), four if lines sit at four or eight — so an edit
// continues the file rather than reformatting it. A file with nothing indented takes its language's habit.
function detectIndent(path: string, source: string): string {
  let two = false;
  let four = false;
  for (const line of source.split("\n", 400)) {
    if (line.startsWith("\t")) return "\t";
    const width = line.length - line.trimStart().length;
    if (width === 2 || width === 6) two = true;
    else if (width === 4 || width === 8) four = true;
  }
  if (two) return "  ";
  if (four) return "    ";
  return /\.(m?[jt]sx?|json[c5]?|ya?ml|s?css|html?|vue|svelte|md)$/i.test(path) ? "  " : "    ";
}

const SEARCH_COUNT_LIMIT = 5000;
// The option chords VS Code users already know, held with the platform's command key and Alt.
const OPTION_BY_CODE: Record<string, "caseSensitive" | "wholeWord" | "regexp" | "replace"> = {
  KeyC: "caseSensitive",
  KeyW: "wholeWord",
  KeyR: "regexp",
  KeyF: "replace",
};
const OPTION_KEYS = Object.fromEntries(
  Object.entries(OPTION_BY_CODE).map(([code, option]) => [
    option,
    IS_MAC ? `⌥⌘${code.slice(-1)}` : `Ctrl+Alt+${code.slice(-1)}`,
  ]),
) as Record<"caseSensitive" | "wholeWord" | "regexp" | "replace", string>;
const countFormat = new Intl.NumberFormat();

type ChangeKind = "added" | "modified" | "deleted";

class ChangeMarker extends GutterMarker {
  constructor(
    readonly kind: ChangeKind,
    readonly lines: number,
    readonly roundedStart = true,
    readonly roundedEnd = true,
  ) {
    super();
  }

  eq(other: ChangeMarker) {
    return (
      this.kind === other.kind &&
      this.lines === other.lines &&
      this.roundedStart === other.roundedStart &&
      this.roundedEnd === other.roundedEnd
    );
  }

  toDOM() {
    const marker = document.createElement("div");
    marker.className = `cm-changeMarker cm-changeMarker-${this.kind}`;
    if (this.roundedStart) marker.classList.add("cm-changeMarker-start");
    if (this.roundedEnd) marker.classList.add("cm-changeMarker-end");
    marker.dataset.contextChange = "";
    if (this.lines) marker.style.height = `calc(${this.lines * 1.5}em + 2px)`;
    marker.title = `${this.kind[0].toUpperCase()}${this.kind.slice(1)} lines`;
    return marker;
  }
}

function changeGutter(baseline: string, setRevert: (action: () => void) => void) {
  const original = EditorState.create({ doc: baseline }).doc;
  const diffConfig = { scanLimit: 500, timeout: 250 };
  const chunks = StateField.define<readonly Chunk[]>({
    create: (state) => Chunk.build(original, state.doc, diffConfig),
    update: (value, transaction) =>
      transaction.docChanged
        ? Chunk.updateB(value, original, transaction.state.doc, transaction.changes, diffConfig)
        : value,
  });

  function kind(chunk: Chunk): ChangeKind {
    if (chunk.fromA === chunk.endA) return "added";
    return chunk.fromB === chunk.endB ? "deleted" : "modified";
  }

  function changedChunk(state: EditorState, lineFrom: number) {
    for (const chunk of state.field(chunks)) {
      if (kind(chunk) === "deleted") {
        if (state.doc.lineAt(Math.min(chunk.fromB, state.doc.length)).from === lineFrom) return chunk;
      } else if (lineFrom >= chunk.fromB && lineFrom < Math.min(chunk.toB, state.doc.length + 1)) {
        return chunk;
      }
    }
  }

  return [
    chunks,
    gutter({
      class: "cm-changeGutter",
      markers(view) {
        const ranges: Range<GutterMarker>[] = [];
        for (const chunk of view.state.field(chunks)) {
          const start = view.state.doc.lineAt(Math.min(chunk.fromB, view.state.doc.length));
          if (kind(chunk) === "deleted") {
            ranges.push(new ChangeMarker("deleted", 0).range(start.from));
            continue;
          }
          const end = Math.min(chunk.toB, view.state.doc.length);
          const visibleFrom = Math.max(chunk.fromB, view.viewport.from);
          const visibleTo = Math.min(end, view.viewport.to);
          if (visibleFrom >= visibleTo) continue;
          const firstVisible = view.state.doc.lineAt(visibleFrom);
          const last = view.state.doc.lineAt(Math.max(visibleFrom, visibleTo - 1));
          const lastChanged = view.state.doc.lineAt(Math.max(chunk.fromB, end - 1));
          ranges.push(
            new ChangeMarker(
              kind(chunk),
              last.number - firstVisible.number + 1,
              firstVisible.number === start.number,
              last.number === lastChanged.number,
            ).range(firstVisible.from),
          );
        }
        return RangeSet.of(ranges, true);
      },
      domEventHandlers: {
        contextmenu(view, line) {
          const chunk = changedChunk(view.state, line.from);
          if (!chunk) return false;
          setRevert(() => {
            view.dispatch({
              changes: {
                from: chunk.fromB,
                to: Math.min(chunk.toB, view.state.doc.length),
                insert: original.sliceString(chunk.fromA, Math.min(chunk.toA, original.length)),
              },
              userEvent: "input.revert",
            });
            view.focus();
          });
          return false;
        },
      },
    }),
  ];
}

// Where the selection stands among the matches, counted the way the terminal counts its own.
function countMatches(state: EditorState): { index: number; count: number } {
  const query = getSearchQuery(state);
  if (!query.valid) return { index: -1, count: 0 };
  const { from, to } = state.selection.main;
  let index = -1;
  let count = 0;
  const cursor = query.getCursor(state);
  for (let match = cursor.next(); !match.done && count < SEARCH_COUNT_LIMIT; match = cursor.next()) {
    if (match.value.from === from && match.value.to === to) index = count;
    count++;
  }
  return { index, count };
}

// The editor's find bar, drawn from the same parts as the terminal's so one search reads like the
// other. CodeMirror keeps the query, the matches, and the panel's place; this only shows and edits
// them. Typing lands on the first match past the cursor as the terminal does, Enter and the arrows
// step, and a second row replaces.
function EditorSearch({
  view,
  query,
  matches,
}: {
  view: EditorView;
  query: SearchQuery;
  matches: { index: number; count: number };
}) {
  const input = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const [replacing, setReplacing] = useState(false);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  function commit(
    changes: Partial<Pick<SearchQuery, "search" | "caseSensitive" | "regexp" | "wholeWord" | "replace">>,
  ) {
    const next = new SearchQuery({
      search: query.search,
      caseSensitive: query.caseSensitive,
      regexp: query.regexp,
      wholeWord: query.wholeWord,
      replace: query.replace,
      ...changes,
    });
    view.dispatch({ effects: setSearchQuery.of(next) });
    // Typing lands on the first match from the cursor, as the terminal's incremental find does.
    if (!("replace" in changes) && next.valid && countMatches(view.state).index < 0) step(next, false, true);
  }

  // One step through the matches, forward or back, wrapping at either end — the same move as the
  // terminal's find. CodeMirror's own findNext also selects the field's text, so it is not used.
  function step(of: SearchQuery = query, previous = false, incremental = false) {
    if (!of.valid) return;
    const { from, to } = view.state.selection.main;
    let match: { from: number; to: number } | undefined;
    if (previous) {
      let last: { from: number; to: number } | undefined;
      const cursor = of.getCursor(view.state);
      for (let found = cursor.next(); !found.done; found = cursor.next()) {
        if (found.value.to <= from) match = found.value;
        last = found.value;
      }
      match ??= last;
    } else {
      const start = incremental ? from : to;
      match = [of.getCursor(view.state, start).next(), of.getCursor(view.state, 0).next()].find(
        (found) => !found.done,
      )?.value;
    }
    if (match)
      view.dispatch({
        selection: EditorSelection.single(match.from, match.to),
        effects: EditorView.scrollIntoView(match.from, { y: "nearest" }),
        userEvent: "select.search",
      });
  }

  // Closing forgets the query, as the terminal's does, and returns to the text.
  function close() {
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "" })) });
    closeSearchPanel(view);
  }

  function toggle(field: "caseSensitive" | "regexp" | "wholeWord", label: string, Icon: typeof Regex) {
    return (
      <InputGroupButton
        size="icon-xs"
        tooltip={`${label} · ${OPTION_KEYS[field]}`}
        aria-label={label}
        aria-pressed={query[field]}
        className={`hidden @[18rem]:inline-flex ${query[field] ? "bg-muted text-foreground" : ""}`}
        onClick={() => commit({ [field]: !query[field] })}
      >
        <Icon />
      </InputGroupButton>
    );
  }

  return (
    <search
      // The bar takes the width the pane gives it, and in a narrow pane the counter and the toggles
      // step aside so the field, the arrows, and the close always fit.
      className="@container ml-auto w-full max-w-[26rem] rounded-lg bg-background shadow-lg"
      onKeyDown={(event) => {
        const option =
          event.altKey && (IS_MAC ? event.metaKey : event.ctrlKey) ? OPTION_BY_CODE[event.code] : undefined;
        if (option === "replace") {
          event.preventDefault();
          setReplacing((current) => !current);
        } else if (option) {
          event.preventDefault();
          commit({ [option]: !query[option] });
        } else if (event.key === "Enter" && event.target === replaceInput.current) {
          event.preventDefault();
          replaceNext(view);
        } else if (event.key === "Escape") {
          event.preventDefault();
          close();
        } else if (
          event.key === "Enter" ||
          event.key === "ArrowUp" ||
          event.key === "ArrowDown" ||
          event.key === "F3" ||
          ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "g")
        ) {
          // The terminal's keys, exactly: Enter and F3 step (Shift steps back), the arrows step by name.
          event.preventDefault();
          step(query, event.key === "ArrowUp" || (event.key !== "ArrowDown" && event.shiftKey));
        }
      }}
    >
      <InputGroup>
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          ref={input}
          main-field="true"
          value={query.search}
          placeholder="Find in file"
          aria-label="Find in file"
          aria-invalid={query.search !== "" && !query.valid ? true : undefined}
          onChange={(event) => commit({ search: event.target.value })}
        />
        <InputGroupAddon align="inline-end" className="gap-0 pr-1">
          <span
            className="hidden min-w-14 px-1 text-center text-xs tabular-nums @[22rem]:inline"
            aria-live="polite"
            aria-atomic="true"
          >
            {matches.count ? (matches.index >= 0 ? countFormat.format(matches.index + 1) : "–") : "0"} /{" "}
            {countFormat.format(matches.count)}
            {matches.count >= SEARCH_COUNT_LIMIT ? "+" : ""}
          </span>
          {toggle("caseSensitive", "Match case", CaseSensitive)}
          {toggle("wholeWord", "Match whole word", WholeWord)}
          {toggle("regexp", "Use regular expression", Regex)}
          <InputGroupButton
            size="icon-xs"
            tooltip={`Previous match · ${IS_MAC ? "⇧↩" : "Shift+Enter"}`}
            aria-label="Previous match"
            disabled={!query.valid}
            onClick={() => step(query, true)}
          >
            <ChevronUp />
          </InputGroupButton>
          <InputGroupButton
            size="icon-xs"
            tooltip={`Next match · ${IS_MAC ? "↩" : "Enter"}`}
            aria-label="Next match"
            disabled={!query.valid}
            onClick={() => step()}
          >
            <ChevronDown />
          </InputGroupButton>
          {view.state.readOnly ? null : (
            <InputGroupButton
              size="icon-xs"
              tooltip={`Replace · ${OPTION_KEYS.replace}`}
              aria-label="Replace"
              aria-pressed={replacing}
              className={replacing ? "bg-muted text-foreground" : undefined}
              onClick={() => setReplacing((current) => !current)}
            >
              <Replace />
            </InputGroupButton>
          )}
          <InputGroupButton size="icon-xs" tooltip="Close · Esc" aria-label="Close search" onClick={close}>
            <X />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      {replacing ? (
        <InputGroup className="mt-1">
          <InputGroupAddon>
            <Replace />
          </InputGroupAddon>
          <InputGroupInput
            ref={replaceInput}
            autoFocus
            value={query.replace}
            placeholder="Replace with"
            aria-label="Replace with"
            onChange={(event) => commit({ replace: event.target.value })}
          />
          <InputGroupAddon align="inline-end" className="gap-0 pr-1">
            <InputGroupButton disabled={!query.valid} onClick={() => replaceNext(view)}>
              Replace
            </InputGroupButton>
            <InputGroupButton disabled={!query.valid} onClick={() => replaceAll(view)}>
              All
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      ) : null}
    </search>
  );
}

export default function SourceEditor({
  path,
  source,
  baseline,
  fontSize,
  onChange,
}: {
  path: string;
  source: string;
  baseline?: string;
  fontSize?: number;
  onChange?: (source: string) => void;
}) {
  const parent = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(null);
  const revert = useRef<(() => void) | null>(null);
  const change = useRef(onChange);
  const initialSource = useRef(source);
  const [panel, setPanel] = useState<{ dom: HTMLElement; view: EditorView } | null>(null);
  const [query, setQuery] = useState(() => new SearchQuery({ search: "" }));
  const [matches, setMatches] = useState({ index: -1, count: 0 });
  change.current = onChange;

  useEffect(() => {
    if (!parent.current) return;
    // The search panel is a slot CodeMirror opens and closes; React draws into it through a portal,
    // and the panel reports the query and the match count back whenever the document, the selection,
    // or the query changes.
    function createPanel(editor: EditorView): Panel {
      const dom = document.createElement("div");
      const sync = (state: EditorState) => {
        setQuery(getSearchQuery(state));
        setMatches(countMatches(state));
      };
      sync(editor.state);
      setPanel({ dom, view: editor });
      return {
        dom,
        top: true,
        update(update) {
          if (
            update.docChanged ||
            update.selectionSet ||
            update.transactions.some((tr) => tr.effects.some((effect) => effect.is(setSearchQuery)))
          )
            sync(update.state);
        },
        destroy() {
          setPanel(null);
        },
      };
    }
    const editor = new EditorView({
      parent: parent.current,
      state: EditorState.create({
        doc: initialSource.current,
        extensions: [
          basicSetup,
          search({ top: true, createPanel }),
          keymap.of([indentWithTab]),
          indentUnit.of(detectIndent(path, initialSource.current)),
          syntaxHighlighting(editorHighlight),
          ...(baseline === undefined ? [] : changeGutter(baseline, (action) => (revert.current = action))),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) change.current?.(update.state.doc.toString());
          }),
          EditorView.theme({
            "&": { height: "100%", fontSize: "inherit", backgroundColor: "transparent" },
            ".cm-scroller": { overflow: "auto", fontFamily: "var(--font-mono)", lineHeight: "1.5" },
            ".cm-content": { padding: "1rem 0", caretColor: "var(--foreground)" },
            ".cm-line": { padding: "0 1rem" },
            ".cm-gutters": {
              backgroundColor: "var(--background)",
              color: "color-mix(in oklab, var(--muted-foreground) 60%, transparent)",
              borderRight: "1px solid color-mix(in oklab, var(--border) 60%, transparent)",
            },
            ".cm-lineNumbers .cm-gutterElement": { padding: "0 0.5rem 0 0.75rem" },
            ".cm-changeGutter": { width: "0", overflow: "visible" },
            ".cm-changeGutter .cm-gutterElement": {
              position: "relative",
              minWidth: "0",
              padding: "0",
              cursor: "pointer",
            },
            ".cm-changeMarker": {
              position: "absolute",
              top: "-1px",
              right: "0",
              width: "4px",
              transition: "width 80ms ease",
              zIndex: "1",
            },
            ".cm-changeMarker-start": { borderRadius: "2px 2px 0 0" },
            ".cm-changeMarker-end": { borderRadius: "0 0 2px 2px" },
            ".cm-changeMarker-start.cm-changeMarker-end": { borderRadius: "2px" },
            ".cm-changeMarker-added": { backgroundColor: "var(--success)" },
            ".cm-changeMarker-modified": { backgroundColor: "var(--color-sky-500)" },
            ".cm-changeMarker-deleted": {
              top: "-2px",
              width: "6px",
              height: "3px",
              backgroundColor: "var(--destructive)",
              transition: "width 80ms ease, height 80ms ease",
            },
            ".cm-changeGutter .cm-gutterElement:hover .cm-changeMarker:not(.cm-changeMarker-deleted)": {
              width: "6px",
            },
            ".cm-changeGutter .cm-gutterElement:hover .cm-changeMarker-deleted": {
              width: "8px",
              height: "4px",
            },
            ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "transparent" },
            ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
              backgroundColor: "color-mix(in oklab, var(--ring) 35%, transparent) !important",
            },
            // CodeMirror's base palette is keyed light or dark by a flag; Lite's tokens already follow the
            // theme, so the pieces the base theme colors are told the tokens instead.
            ".cm-selectionMatch": { backgroundColor: "color-mix(in oklab, var(--ring) 20%, transparent)" },
            ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
              backgroundColor: "color-mix(in oklab, var(--ring) 30%, transparent)",
              outline: "none",
            },
            ".cm-foldPlaceholder": {
              backgroundColor: "var(--muted)",
              border: "none",
              color: "var(--muted-foreground)",
              padding: "0 0.375rem",
              borderRadius: "0.25rem",
            },
            ".cm-tooltip": {
              backgroundColor: "var(--popover)",
              color: "var(--popover-foreground)",
              border: "1px solid var(--border)",
              borderRadius: "0.5rem",
              boxShadow: "0 4px 12px rgb(0 0 0 / 0.15)",
              overflow: "hidden",
            },
            ".cm-tooltip.cm-tooltip-autocomplete > ul": { fontFamily: "var(--font-mono)" },
            ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
              backgroundColor: "var(--accent)",
              color: "var(--accent-foreground)",
            },
            ".cm-searchMatch": { backgroundColor: "var(--search-match)" },
            ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--search-match-active)" },
            ".cm-cursor": { borderLeftColor: "var(--foreground)" },
            "&.cm-focused": { outline: "none" },
            // Panels float over the top right corner the way the terminal's find bar does, instead of
            // taking a grey strip across the top of the file.
            ".cm-panels": {
              position: "absolute",
              top: "0.5rem",
              right: "1rem",
              left: "1rem",
              zIndex: "10",
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
              border: "none",
              backgroundColor: "transparent",
              color: "inherit",
            },
            ".cm-panel.cm-dialog": {
              display: "flex",
              alignSelf: "flex-end",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.25rem 0.5rem",
              borderRadius: "0.5rem",
              backgroundColor: "var(--background)",
              boxShadow: "var(--shadow-lg, 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1))",
              border: "1px solid var(--input)",
              fontSize: "0.75rem",
              "& label": { display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "inherit" },
              "& .cm-textfield": {
                height: "1.5rem",
                width: "5rem",
                padding: "0 0.5rem",
                borderRadius: "0.375rem",
                border: "1px solid var(--input)",
                backgroundColor: "transparent",
                font: "inherit",
                color: "inherit",
              },
              "& .cm-button": {
                height: "1.5rem",
                padding: "0 0.5rem",
                borderRadius: "0.375rem",
                border: "none",
                background: "var(--muted)",
                font: "inherit",
                color: "inherit",
                cursor: "pointer",
              },
              "& .cm-dialog-close": { position: "static", padding: "0 0.25rem", color: "var(--muted-foreground)" },
            },
          }),
        ],
      }),
    });
    view.current = editor;
    editor.contentDOM.setAttribute("aria-label", `Edit ${path.split(/[\\/]/).pop() ?? path}`);
    let disposed = false;
    void LanguageDescription.matchFilename(editorLanguages, path)
      ?.load()
      .then((language) => {
        if (!disposed) editor.dispatch({ effects: StateEffect.appendConfig.of(language) });
      });
    editor.focus();
    return () => {
      disposed = true;
      view.current = null;
      editor.destroy();
    };
  }, [path, baseline]);

  useEffect(() => {
    if (fontSize !== undefined) view.current?.requestMeasure();
  }, [fontSize]);

  return (
    <div
      ref={parent}
      className="size-full"
      data-context-editor
      style={{ fontSize }}
      onKeyDownCapture={(event) => {
        if (!view.current || !matchesShortcut(event.nativeEvent, "find")) return;
        event.preventDefault();
        event.stopPropagation();
        // Open, the shortcut takes the field back and selects it, as the terminal's does.
        const field = view.current.dom.querySelector<HTMLInputElement>("[main-field]");
        if (field) {
          field.focus();
          field.select();
        } else openSearchPanel(view.current);
      }}
    >
      <button
        type="button"
        className="hidden"
        data-context-revert
        tabIndex={-1}
        onClick={() => {
          revert.current?.();
          revert.current = null;
        }}
      />
      {panel ? createPortal(<EditorSearch view={panel.view} query={query} matches={matches} />, panel.dom) : null}
    </div>
  );
}
