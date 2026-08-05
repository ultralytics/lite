// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { useMemo } from "react";
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
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "highlight.js/styles/github-dark.css";

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
Object.entries(languages).forEach(([name, language]) => hljs.registerLanguage(name, language));

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
  return source.replace(/[&<>]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character]!);
}

function HighlightedCode({ source, language }: { source: string; language?: string }) {
  const html = useMemo(() => highlighted(source, language), [source, language]);
  return <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />;
}

export default function CodePreview({ path, source }: { path: string; source: string }) {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "md" || extension === "mdx") {
    return (
      <article className="markdown-viewer max-w-none px-6 py-5 text-sm leading-7">
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
    <pre className="min-h-full overflow-auto bg-[#0d0d0d] p-5 text-[13px] leading-5 text-zinc-200">
      <HighlightedCode source={source} language={extensionLanguages[extension]} />
    </pre>
  );
}
