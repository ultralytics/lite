// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { invoke } from "@tauri-apps/api/core";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
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
import { type ImgHTMLAttributes, lazy, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

// The editor is the heavier half of this file's imports and only an open file needs it, so it loads
// when the first file is edited rather than with the first rendered Markdown.
const SourceEditor = lazy(() => import("@/source-editor"));

const languages = {
  bash,
  cpp,
  csharp,
  css,
  diff,
  go,
  ini,
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
  c: "cpp",
  cc: "cpp",
  cs: "csharp",
  h: "cpp",
  hpp: "cpp",
  htm: "xml",
  html: "xml",
  js: "javascript",
  jsx: "javascript",
  kt: "kotlin",
  md: "markdown",
  mdx: "markdown",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "bash",
  shell: "bash",
  ts: "typescript",
  tsx: "typescript",
  svg: "xml",
  yml: "yaml",
  zsh: "bash",
};

function highlighted(source: string, language?: string) {
  language = language && (extensionLanguages[language.toLowerCase()] ?? language.toLowerCase());
  if (source.length <= 200_000 && language && hljs.getLanguage(language))
    return hljs.highlight(source, { language }).value;
  return source.replace(/[&<>]/g, (character) => (character === "&" ? "&amp;" : character === "<" ? "&lt;" : "&gt;"));
}

function HighlightedCode({ source, language, className }: { source: string; language?: string; className?: string }) {
  const html = useMemo(() => highlighted(source, language), [source, language]);
  return <code className={`hljs ${className ?? ""}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

function linkedFilePath(currentPath: string, href: string) {
  try {
    const current = currentPath.replace(/\\/g, "/");
    const encoded = current.split("/").map(encodeURIComponent).join("/");
    const target = new URL(href, `file://${current.startsWith("/") ? "" : "/"}${encoded}`);
    if (target.protocol === "file:") return decodeURIComponent(target.pathname).replace(/^\/([A-Za-z]:\/)/, "$1");
  } catch {
    // A malformed link is shown as authored but cannot name a local file.
  }
}

function PreviewImage({
  src,
  alt = "",
  path,
  rootId,
  ...props
}: ImgHTMLAttributes<HTMLImageElement> & { path: string; rootId?: string }) {
  const local = Boolean(src && rootId && path && !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(src));
  const image = useRef<HTMLImageElement>(null);
  const [resolved, setResolved] = useState<string>();
  useEffect(() => {
    setResolved(undefined);
    if (!local || !src || !rootId) return;
    let active = true;
    let objectUrl: string | undefined;
    const observer = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting) return;
      observer.disconnect();
      void invoke<ArrayBuffer | number[]>("read_image_file", { rootId, path: linkedFilePath(path, src) })
        .then((bytes) => {
          if (!active) return;
          objectUrl = URL.createObjectURL(
            new Blob([bytes instanceof ArrayBuffer ? bytes : Uint8Array.from(bytes)], {
              type: /\.svg(?:[?#]|$)/i.test(src) ? "image/svg+xml" : "",
            }),
          );
          setResolved(objectUrl);
        })
        .catch(() => {});
    });
    if (image.current) observer.observe(image.current);
    return () => {
      active = false;
      observer.disconnect();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [local, path, rootId, src]);
  return <img ref={image} src={local ? resolved : src} alt={alt} loading="lazy" decoding="async" {...props} />;
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
  path = "",
  onOpenPath,
  rootId,
}: {
  source: string;
  className?: string;
  path?: string;
  onOpenPath?: (path: string) => void;
  rootId?: string;
}) {
  return (
    <article className={`markdown-viewer max-w-none ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeSanitize]}
        components={{
          a({ href, children }) {
            if (!href) return <span>{children}</span>;
            const external = /^(?:https?:)?\/\//i.test(href);
            const local = !/^(?:[a-z][a-z\d+.-]*:|[?#])/i.test(href) && !external;
            if (local && !onOpenPath)
              return <span className="text-[var(--syntax-constant)] underline">{children}</span>;
            return (
              <a
                href={href}
                onClick={(event) => {
                  if (href.startsWith("?")) event.preventDefault();
                  if (!external && !local) return;
                  event.preventDefault();
                  if (external) {
                    const url = href.startsWith("//")
                      ? `https:${href}`
                      : href.replace(/^https?:/i, (scheme) => scheme.toLowerCase());
                    void invoke("open_url", { url });
                  } else {
                    const target = linkedFilePath(path, href);
                    if (target) onOpenPath?.(target);
                  }
                }}
              >
                {children}
              </a>
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
            return <PreviewImage alt={alt} rootId={rootId} path={path} {...props} />;
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
  rootId,
}: {
  path: string;
  source: string;
  rendered?: boolean;
  editable?: boolean;
  baseline?: string;
  fontSize?: number;
  onChange?: (source: string) => void;
  onOpenPath?: (path: string) => void;
  rootId?: string;
}) {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  if (rendered && (extension === "md" || extension === "mdx")) {
    return (
      <MarkdownPreview source={source} className="px-6 py-5" onOpenPath={onOpenPath} rootId={rootId} path={path} />
    );
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
      <HighlightedCode
        source={source}
        language={extensionLanguages[extension] ?? extension}
        className="py-4 pr-4 pl-3"
      />
    </pre>
  );
}
