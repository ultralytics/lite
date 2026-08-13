// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { HighlightStyle, LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { languages as editorLanguages } from "@codemirror/language-data";
import { EditorState, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
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
import { useEffect, useMemo, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
  change.current = onChange;

  useEffect(() => {
    if (!parent.current) return;
    const editor = new EditorView({
      parent: parent.current,
      state: EditorState.create({
        doc: initialSource.current,
        extensions: [
          basicSetup,
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
            ".cm-cursor": { borderLeftColor: "var(--foreground)" },
            "&.cm-focused": { outline: "none" },
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

  return <div ref={parent} className="size-full" style={{ fontSize }} />;
}
