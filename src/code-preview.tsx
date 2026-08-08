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
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { useMemo } from "react";
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
  html: "xml",
  java: "java",
  js: "javascript",
  json: "json",
  jsx: "javascript",
  kt: "kotlin",
  php: "php",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "bash",
  sql: "sql",
  ts: "typescript",
  tsx: "typescript",
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
      className="sticky left-0 shrink-0 border-r border-border bg-background py-4 pr-3 pl-4 text-right text-muted-foreground tabular-nums select-none"
    >
      {numbers}
    </span>
  );
}

export default function CodePreview({ path, source }: { path: string; source: string }) {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "md" || extension === "mdx") {
    return (
      <article
        className="markdown-viewer max-w-none px-6 py-5 text-sm leading-7"
        onContextMenu={(event) => event.stopPropagation()}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a({ children }) {
              return <span className="text-foreground underline">{children}</span>;
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
  return (
    <pre
      className="flex min-h-full overflow-auto font-mono text-[12.5px] leading-5"
      onContextMenu={(event) => event.stopPropagation()}
    >
      <LineNumbers count={source.split("\n").length} />
      <HighlightedCode source={source} language={extensionLanguages[extension]} className="py-4 pr-4 pl-3" />
    </pre>
  );
}
