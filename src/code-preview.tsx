// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { indentWithTab } from "@codemirror/commands";
import { HighlightStyle, indentUnit, LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { languages as editorLanguages } from "@codemirror/language-data";
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  SearchQuery,
  search,
  setSearchQuery,
} from "@codemirror/search";
import { EditorState, StateEffect } from "@codemirror/state";
import { EditorView, keymap, type Panel, runScopeHandlers } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { basicSetup } from "codemirror";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { CaseSensitive, ChevronDown, ChevronUp, Regex, Replace, Search, WholeWord, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { matchesShortcut } from "@/shortcuts";

const languages = {
  bash,
  cpp,
  csharp,
  css,
  diff,
  go,
  java,
  javascript,
  json,
  kotlin,
  markdown,
  php,
  python,
  ruby,
  rust,
  sql,
  typescript,
  xml,
  yaml,
};
for (const [name, language] of Object.entries(languages)) hljs.registerLanguage(name, language);

const extensionLanguages: Record<string, string> = {
  bash: "bash",
  c: "cpp",
  cc: "cpp",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  diff: "diff",
  go: "go",
  h: "cpp",
  hpp: "cpp",
  htm: "xml",
  html: "xml",
  java: "java",
  js: "javascript",
  json: "json",
  jsx: "javascript",
  kt: "kotlin",
  md: "markdown",
  mdx: "markdown",
  php: "php",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "bash",
  sql: "sql",
  ts: "typescript",
  tsx: "typescript",
  svg: "xml",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "bash",
};

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

function highlighted(source: string, language?: string) {
  if (source.length <= 200_000 && language && hljs.getLanguage(language))
    return hljs.highlight(source, { language }).value;
  return source.replace(/[&<>]/g, (character) => (character === "&" ? "&amp;" : character === "<" ? "&lt;" : "&gt;"));
}

function HighlightedCode({ source, language, className }: { source: string; language?: string; className?: string }) {
  const html = useMemo(() => highlighted(source, language), [source, language]);
  return <code className={`hljs ${className ?? ""}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

// A gutter beside the source rather than a number on each line: a highlighted span may open on one line
// and close on another, so the markup cannot be cut per line without tearing. Nothing here wraps, so a
// column of numbers on the same leading stays level with the code, and it is skipped by a copy and by a
// screen reader because it belongs to neither.
function LineNumbers({ count }: { count: number }) {
  const numbers = useMemo(() => Array.from({ length: count }, (_, index) => index + 1).join("\n"), [count]);
  return (
    <span
      aria-hidden="true"
      className="sticky left-0 z-10 shrink-0 border-r border-border/60 bg-background py-4 pr-2 pl-3 text-right text-muted-foreground/60 tabular-nums select-none"
    >
      {numbers}
    </span>
  );
}

export function MarkdownPreview({
  source,
  className = "",
  onOpenLink,
}: {
  source: string;
  className?: string;
  onOpenLink?: (url: string) => void;
}) {
  return (
    <article className={`markdown-viewer max-w-none ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href, children }) {
            return href && onOpenLink ? (
              <a
                href={href}
                onClick={(event) => {
                  event.preventDefault();
                  onOpenLink(href);
                }}
              >
                {children}
              </a>
            ) : (
              <span className="text-foreground underline">{children}</span>
            );
          },
          code({ className, children, ...props }) {
            const language = /language-([\w-]+)/.exec(className ?? "")?.[1];
            const source = String(children).replace(/\n$/, "");
            return language ? (
              <HighlightedCode source={source} language={language} />
            ) : (
              <code {...props}>{children}</code>
            );
          },
          img({ alt }) {
            return <span className="text-muted-foreground">[Image: {alt}]</span>;
          },
        }}
      >
        {source}
      </ReactMarkdown>
    </article>
  );
}

export default function CodePreview({
  path,
  source,
  rendered = false,
  editable = false,
  fontSize,
  onChange,
}: {
  path: string;
  source: string;
  rendered?: boolean;
  editable?: boolean;
  fontSize?: number;
  onChange?: (source: string) => void;
}) {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  if (rendered && (extension === "md" || extension === "mdx")) {
    return <MarkdownPreview source={source} className="px-6 py-5" />;
  }
  if (rendered && ["htm", "html", "svg"].includes(extension)) {
    return (
      <iframe
        title={`Preview of ${path.split(/[\\/]/).pop() ?? path}`}
        sandbox=""
        srcDoc={source}
        className="min-h-[calc(100vh-8rem)] w-full border-0 bg-white"
      />
    );
  }
  if (editable) {
    return <SourceEditor path={path} source={source} fontSize={fontSize} onChange={onChange} />;
  }
  return (
    <pre className="flex min-h-full overflow-auto font-mono">
      <LineNumbers count={source.split("\n").length} />
      <HighlightedCode source={source} language={extensionLanguages[extension]} className="py-4 pr-4 pl-3" />
    </pre>
  );
}

// The unit a file already indents by: a tab if any line starts with one, otherwise two spaces when
// enough lines sit at two or six, four otherwise — so an edit continues the file rather than
// reformatting it. A file with nothing indented yet takes its language's habit.
function detectIndent(path: string, source: string): string {
  let two = 0;
  let four = 0;
  for (const line of source.split("\n", 400)) {
    if (line.startsWith("\t")) return "\t";
    const width = line.length - line.trimStart().length;
    if (width === 2 || width === 6) two++;
    else if (width === 4 || width === 8) four++;
  }
  if (!two && !four) return /\.(m?[jt]sx?|json[c5]?|ya?ml|s?css|html?|vue|svelte|md)$/i.test(path) ? "  " : "    ";
  return two > four / 4 ? "  " : "    ";
}

const SEARCH_COUNT_LIMIT = 5000;
const countFormat = new Intl.NumberFormat();

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
    if (!("replace" in changes) && next.valid && countMatches(view.state).index < 0) findNext(view);
  }

  function toggle(field: "caseSensitive" | "regexp" | "wholeWord", label: string, Icon: typeof Regex) {
    return (
      <InputGroupButton
        size="icon-xs"
        aria-label={label}
        aria-pressed={query[field]}
        className={query[field] ? "bg-muted text-foreground" : undefined}
        onClick={() => commit({ [field]: !query[field] })}
      >
        <Icon />
      </InputGroupButton>
    );
  }

  return (
    <search
      className="w-[26rem] max-w-full rounded-lg bg-background shadow-lg"
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target === replaceInput.current) {
          event.preventDefault();
          replaceNext(view);
        } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          (event.key === "ArrowUp" ? findPrevious : findNext)(view);
        } else if (runScopeHandlers(view, event.nativeEvent, "search-panel")) event.preventDefault();
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
          <span className="min-w-14 px-1 text-center text-xs tabular-nums" aria-live="polite" aria-atomic="true">
            {matches.count ? (matches.index >= 0 ? countFormat.format(matches.index + 1) : "–") : "0"} /{" "}
            {countFormat.format(matches.count)}
            {matches.count >= SEARCH_COUNT_LIMIT ? "+" : ""}
          </span>
          {toggle("caseSensitive", "Match case", CaseSensitive)}
          {toggle("wholeWord", "Match whole word", WholeWord)}
          {toggle("regexp", "Use regular expression", Regex)}
          <InputGroupButton
            size="icon-xs"
            aria-label="Previous match"
            disabled={!query.valid}
            onClick={() => findPrevious(view)}
          >
            <ChevronUp />
          </InputGroupButton>
          <InputGroupButton
            size="icon-xs"
            aria-label="Next match"
            disabled={!query.valid}
            onClick={() => findNext(view)}
          >
            <ChevronDown />
          </InputGroupButton>
          {view.state.readOnly ? null : (
            <InputGroupButton
              size="icon-xs"
              aria-label="Replace"
              aria-pressed={replacing}
              className={replacing ? "bg-muted text-foreground" : undefined}
              onClick={() => setReplacing((current) => !current)}
            >
              <Replace />
            </InputGroupButton>
          )}
          <InputGroupButton size="icon-xs" aria-label="Close search" onClick={() => closeSearchPanel(view)}>
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

function SourceEditor({
  path,
  source,
  fontSize,
  onChange,
}: {
  path: string;
  source: string;
  fontSize?: number;
  onChange?: (source: string) => void;
}) {
  const parent = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(null);
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
            ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "transparent" },
            ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
              backgroundColor: "color-mix(in oklab, var(--ring) 35%, transparent) !important",
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
              left: "auto",
              zIndex: "10",
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              gap: "0.5rem",
              maxWidth: "calc(100% - 2rem)",
              border: "none",
              backgroundColor: "transparent",
              color: "inherit",
            },
            ".cm-panel.cm-dialog": {
              display: "flex",
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
  }, [path]);

  useEffect(() => {
    if (fontSize !== undefined) view.current?.requestMeasure();
  }, [fontSize]);

  return (
    <div
      ref={parent}
      className="size-full"
      style={{ fontSize }}
      onKeyDownCapture={(event) => {
        if (!view.current || !matchesShortcut(event.nativeEvent, "find")) return;
        event.preventDefault();
        event.stopPropagation();
        openSearchPanel(view.current);
      }}
    >
      {panel ? createPortal(<EditorSearch view={panel.view} query={query} matches={matches} />, panel.dom) : null}
    </div>
  );
}
