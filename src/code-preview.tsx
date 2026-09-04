// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { invoke } from "@tauri-apps/api/core";
import hljs from "highlight.js/lib/core";
import { lazy, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

// The editor is the heavier half of this file's imports and only an open file needs it, so it loads
// when the first file is edited rather than with the first rendered Markdown.
const SourceEditor = lazy(() => import("@/source-editor"));

// Match Portal's CodeBlock: grammars load only when a preview actually uses them. INI also owns
// Highlight.js's TOML alias, which this repository's README needs.
const languageLoaders: Record<string, () => Promise<{ default: (highlighter: typeof hljs) => unknown }>> = {
  bash: () => import("highlight.js/lib/languages/bash"),
  cpp: () => import("highlight.js/lib/languages/cpp"),
  csharp: () => import("highlight.js/lib/languages/csharp"),
  css: () => import("highlight.js/lib/languages/css"),
  diff: () => import("highlight.js/lib/languages/diff"),
  go: () => import("highlight.js/lib/languages/go"),
  ini: () => import("highlight.js/lib/languages/ini"),
  java: () => import("highlight.js/lib/languages/java"),
  javascript: () => import("highlight.js/lib/languages/javascript"),
  json: () => import("highlight.js/lib/languages/json"),
  kotlin: () => import("highlight.js/lib/languages/kotlin"),
  markdown: () => import("highlight.js/lib/languages/markdown"),
  php: () => import("highlight.js/lib/languages/php"),
  python: () => import("highlight.js/lib/languages/python"),
  ruby: () => import("highlight.js/lib/languages/ruby"),
  rust: () => import("highlight.js/lib/languages/rust"),
  sql: () => import("highlight.js/lib/languages/sql"),
  typescript: () => import("highlight.js/lib/languages/typescript"),
  xml: () => import("highlight.js/lib/languages/xml"),
  yaml: () => import("highlight.js/lib/languages/yaml"),
};

const languageAliases: Record<string, string> = {
  c: "cpp",
  cc: "cpp",
  cs: "csharp",
  h: "cpp",
  hpp: "cpp",
  html: "xml",
  htm: "xml",
  js: "javascript",
  jsx: "javascript",
  kt: "kotlin",
  md: "markdown",
  mdx: "markdown",
  py: "python",
  rb: "ruby",
  rs: "rust",
  shell: "bash",
  sh: "bash",
  svg: "xml",
  toml: "ini",
  ts: "typescript",
  tsx: "typescript",
  yml: "yaml",
  zsh: "bash",
};
const pendingLanguages = new Map<string, Promise<void>>();

function loadLanguage(language: string): Promise<void> {
  const requested = language.toLowerCase();
  const name = languageAliases[requested] ?? requested;
  if (hljs.getLanguage(requested)) return Promise.resolve();
  const loader = languageLoaders[name];
  if (!loader) return Promise.resolve();
  const pending = pendingLanguages.get(name);
  if (pending) return pending;
  const task = loader()
    .then(({ default: grammar }) => hljs.registerLanguage(name, grammar as Parameters<typeof hljs.registerLanguage>[1]))
    .catch(() => {
      pendingLanguages.delete(name);
    });
  pendingLanguages.set(name, task);
  return task;
}

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
  ini: "ini",
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
  toml: "toml",
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
  const [ready, setReady] = useState(() => !language || Boolean(hljs.getLanguage(language)));
  useEffect(() => {
    if (!language || hljs.getLanguage(language)) {
      setReady(true);
      return;
    }
    setReady(false);
    let cancelled = false;
    void loadLanguage(language).then(() => {
      if (!cancelled) setReady(Boolean(hljs.getLanguage(language)));
    });
    return () => {
      cancelled = true;
    };
  }, [language]);
  const html = useMemo(() => highlighted(source, ready ? language : undefined), [source, language, ready]);
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
  onOpenPath,
}: {
  source: string;
  className?: string;
  onOpenPath?: (path: string) => void;
}) {
  return (
    <article className={`markdown-viewer max-w-none ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeSanitize]}
        components={{
          a({ href, children }) {
            return href && /^https?:\/\//i.test(href) ? (
              <a
                href={href}
                onClick={(event) => {
                  event.preventDefault();
                  void invoke("open_url", { url: href });
                }}
              >
                {children}
              </a>
            ) : href?.startsWith("#") ? (
              <a href={href}>{children}</a>
            ) : href && onOpenPath ? (
              <a
                href={href}
                onClick={(event) => {
                  event.preventDefault();
                  onOpenPath(href);
                }}
              >
                {children}
              </a>
            ) : (
              <span className="text-[var(--syntax-constant)] underline">{children}</span>
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
          img({ node: _node, alt = "", ...props }) {
            return <img alt={alt} loading="lazy" decoding="async" {...props} />;
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
  baseline,
  fontSize,
  onChange,
  onOpenPath,
}: {
  path: string;
  source: string;
  rendered?: boolean;
  editable?: boolean;
  baseline?: string;
  fontSize?: number;
  onChange?: (source: string) => void;
  onOpenPath?: (path: string) => void;
}) {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  if (rendered && (extension === "md" || extension === "mdx")) {
    return <MarkdownPreview source={source} className="px-6 py-5" onOpenPath={onOpenPath} />;
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
    return <SourceEditor path={path} source={source} baseline={baseline} fontSize={fontSize} onChange={onChange} />;
  }
  return (
    <pre className="flex min-h-full overflow-auto font-mono">
      <LineNumbers count={source.split("\n").length} />
      <HighlightedCode source={source} language={extensionLanguages[extension]} className="py-4 pr-4 pl-3" />
    </pre>
  );
}
