// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

// JetBrains' own file and folder icons. The file browser lazy-loads this module, and the bounded
// glob keeps the rest of the icon package out of Lite's startup bundle.
const ICONS = import.meta.glob<string>(
  "/node_modules/@jetbrains/icons/{file,folder,image,file-archive,file-css,file-go,file-gql,file-html,file-java,file-js,file-json,file-kotlin,file-properties,file-python,file-ts,file-tsx,file-xml,file-yaml}.js",
  { eager: true, import: "default" },
);

const FILE_TYPES: Record<string, string> = {
  "7z": "file-archive",
  css: "file-css",
  gif: "image",
  go: "file-go",
  gql: "file-gql",
  graphql: "file-gql",
  gz: "file-archive",
  htm: "file-html",
  html: "file-html",
  ico: "image",
  java: "file-java",
  jpeg: "image",
  jpg: "image",
  js: "file-js",
  json: "file-json",
  json5: "file-json",
  jsonc: "file-json",
  jsx: "file-js",
  kt: "file-kotlin",
  kts: "file-kotlin",
  png: "image",
  properties: "file-properties",
  py: "file-python",
  pyi: "file-python",
  tar: "file-archive",
  ts: "file-ts",
  tsx: "file-tsx",
  webp: "image",
  xml: "file-xml",
  yaml: "file-yaml",
  yml: "file-yaml",
  zip: "file-archive",
};

function icon(name: string) {
  return ICONS[`/node_modules/@jetbrains/icons/${name}.js`] ?? ICONS["/node_modules/@jetbrains/icons/file.js"];
}

export default function FileIcon({ name, directory }: { name: string; directory?: boolean }) {
  const extension = name.toLowerCase().split(".").pop() ?? "";
  // The package's documented JS imports are trusted, static SVG strings from JetBrains.
  return (
    <span
      aria-hidden="true"
      className="size-4 shrink-0 [&>svg]:size-4"
      dangerouslySetInnerHTML={{ __html: icon(directory ? "folder" : (FILE_TYPES[extension] ?? "file")) }}
    />
  );
}
