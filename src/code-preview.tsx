// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

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
import { type RefObject, useMemo, useRef } from "react";
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
      className="sticky left-0 z-10 shrink-0 border-r border-border/60 bg-background py-4 pr-2 pl-3 text-right text-[0.8em] text-muted-foreground/60 tabular-nums select-none"
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
  editorRef,
  onChange,
}: {
  path: string;
  source: string;
  rendered?: boolean;
  editable?: boolean;
  fontSize?: number;
  editorRef?: RefObject<HTMLTextAreaElement | null>;
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
    return (
      <SourceEditor
        path={path}
        source={source}
        language={extensionLanguages[extension]}
        fontSize={fontSize}
        editorRef={editorRef}
        onChange={onChange}
      />
    );
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
  language,
  fontSize,
  editorRef,
  onChange,
}: {
  path: string;
  source: string;
  language?: string;
  fontSize?: number;
  editorRef?: RefObject<HTMLTextAreaElement | null>;
  onChange?: (source: string) => void;
}) {
  const preview = useRef<HTMLPreElement>(null);
  const digits = String(source.split("\n").length).length;

  return (
    <div className="relative size-full overflow-hidden" style={{ fontSize, lineHeight: 1.5 }}>
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <pre ref={preview} className="flex min-h-full font-mono">
          <LineNumbers count={source.split("\n").length} />
          <HighlightedCode source={source} language={language} className="min-w-max !overflow-visible py-4 pr-4 pl-3" />
        </pre>
      </div>
      <textarea
        ref={editorRef}
        name="file-contents"
        aria-label={`Edit ${path.split(/[\\/]/).pop() ?? path}`}
        spellCheck={false}
        value={source}
        className="absolute inset-0 size-full resize-none overflow-auto whitespace-pre bg-transparent py-4 pr-4 font-mono text-transparent caret-foreground outline-none selection:bg-accent selection:text-foreground"
        style={{ paddingLeft: `calc(${digits * 0.8}ch + 2rem)`, lineHeight: "inherit" }}
        onChange={(event) => onChange?.(event.target.value)}
        onScroll={(event) => {
          if (!preview.current) return;
          preview.current.style.transform = `translateY(-${event.currentTarget.scrollTop}px)`;
          const code = preview.current.querySelector("code");
          if (code) code.style.transform = `translateX(-${event.currentTarget.scrollLeft}px)`;
        }}
      />
    </div>
  );
}
