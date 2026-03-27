export type WorkspacePreviewKind = "markdown" | "text" | "unsupported";

export interface WorkspaceFileCapabilities {
  canPreview: boolean;
  canEdit: boolean;
  previewKind: WorkspacePreviewKind;
}

const EDITABLE_PATH_PATTERNS = [/\.md$/i, /\.txt$/i, /(?:^|\/)\.env(?:\.[^/]+)?$/i];
const TEXT_VIEW_PATH_PATTERNS = [
  /\.md$/i,
  /\.txt$/i,
  /(?:^|\/)\.env(?:\.[^/]+)?$/i,
  /\.(c|cc|cpp|css|go|html|ini|java|js|json|jsx|mjs|mts|sh|sql|svg|toml|ts|tsx|yaml|yml)$/i,
];

function normalizeSlashes(value: string): string {
  return value.replaceAll("\\", "/");
}

function stripLineColumnSuffix(value: string): string {
  return value.replace(/:\d+(?::\d+)?$/, "");
}

function normalizeRelativePath(value: string): string {
  return value.replace(/^\.\/+/, "").replace(/^\/+/, "");
}

function looksLikeMarkdown(path: string): boolean {
  return /\.md$/i.test(path);
}

function isEditablePath(path: string): boolean {
  return EDITABLE_PATH_PATTERNS.some((pattern) => pattern.test(path));
}

function isTextPreviewPath(path: string): boolean {
  return TEXT_VIEW_PATH_PATTERNS.some((pattern) => pattern.test(path));
}

export function resolveWorkspaceFileCapabilities(path: string): WorkspaceFileCapabilities {
  const normalizedPath = normalizeSlashes(path.trim());
  if (isEditablePath(normalizedPath)) {
    return {
      canPreview: true,
      canEdit: true,
      previewKind: looksLikeMarkdown(normalizedPath) ? "markdown" : "text",
    };
  }
  if (isTextPreviewPath(normalizedPath)) {
    return {
      canPreview: true,
      canEdit: false,
      previewKind: looksLikeMarkdown(normalizedPath) ? "markdown" : "text",
    };
  }
  return {
    canPreview: false,
    canEdit: false,
    previewKind: "unsupported",
  };
}

export function toWorkspaceRelativePath(workspaceRoot: string, targetPath: string): string | null {
  const normalizedRoot = normalizeSlashes(workspaceRoot.trim()).replace(/\/+$/, "");
  const normalizedTarget = normalizeSlashes(stripLineColumnSuffix(targetPath.trim()));

  if (!normalizedRoot || !normalizedTarget) {
    return null;
  }

  if (!normalizedTarget.startsWith("/")) {
    const relativePath = normalizeRelativePath(normalizedTarget);
    if (!relativePath || relativePath === "." || relativePath.startsWith("../")) {
      return null;
    }
    return relativePath;
  }

  if (normalizedTarget === normalizedRoot) {
    return null;
  }

  const rootPrefix = `${normalizedRoot}/`;
  if (!normalizedTarget.startsWith(rootPrefix)) {
    return null;
  }

  const relativePath = normalizedTarget.slice(rootPrefix.length);
  if (!relativePath || relativePath === "." || relativePath.startsWith("../")) {
    return null;
  }

  return relativePath;
}
