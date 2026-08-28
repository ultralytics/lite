// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import theme from "jetbrains-file-icon-theme/themes/auto-jetbrains-icon-theme.json";

// The complete off-the-shelf JetBrains theme owns both its associations and artwork. This module is
// lazy-loaded with the file browser, and Vite emits each SVG separately so none enters startup code.
const ICONS = import.meta.glob<string>("/node_modules/jetbrains-file-icon-theme/themes/icons/**/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
});

const names = Object.fromEntries(Object.entries(theme.fileNames).map(([name, icon]) => [name.toLowerCase(), icon]));
const folders = Object.fromEntries(Object.entries(theme.folderNames).map(([name, icon]) => [name.toLowerCase(), icon]));
const lightNames = Object.fromEntries(
  Object.entries(theme.light.fileNames).map(([name, icon]) => [name.toLowerCase(), icon]),
);
const lightFolders = Object.fromEntries(
  Object.entries(theme.light.folderNames).map(([name, icon]) => [name.toLowerCase(), icon]),
);

function associatedIcon(name: string, directory: boolean, light = false) {
  const lower = name.toLowerCase();
  if (directory) return (light ? lightFolders : folders)[lower] ?? (light ? theme.light.folder : theme.folder);
  const named = (light ? lightNames : names)[lower];
  if (named) return named;
  const extensions = light ? theme.light.fileExtensions : theme.fileExtensions;
  const parts = lower.split(".");
  for (let start = 1; start < parts.length; start++) {
    const icon = extensions[parts.slice(start).join(".") as keyof typeof extensions];
    if (icon) return icon;
  }
  return light ? theme.light.file : theme.file;
}

function iconUrl(name: string, directory: boolean, light = false) {
  const definition =
    theme.iconDefinitions[associatedIcon(name, directory, light) as keyof typeof theme.iconDefinitions];
  return ICONS[`/node_modules/jetbrains-file-icon-theme/themes/${definition.iconPath.slice(2)}`];
}

export default function FileIcon({ name, directory = false }: { name: string; directory?: boolean }) {
  const icon = "size-4 shrink-0";
  return (
    <span aria-hidden="true" className={icon}>
      <img src={iconUrl(name, directory, true)} alt="" className={`${icon} dark:hidden`} />
      <img src={iconUrl(name, directory)} alt="" className={`${icon} hidden dark:block`} />
    </span>
  );
}
