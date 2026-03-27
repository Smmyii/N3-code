import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { SkillKind, SkillProvider, SkillScope } from "@t3tools/contracts";

export const SKILL_MD = "SKILL.md";
export const SKILLS_SH_HOST = "skills.sh";
export const SKILL_DOWNLOAD_TIMEOUT_MS = 20_000;
export const SKILL_ARCHIVE_MAX_BYTES = 25 * 1024 * 1024;
export const SKILL_SOURCE_FETCH_MAX_BYTES = 2 * 1024 * 1024;

export type SkillProvenanceRecord = {
  readonly installPath: string;
  readonly sourceUrl?: string;
  readonly repoUrl?: string;
  readonly sourceSubpath?: string;
  readonly installedSlug?: string;
  readonly provider?: SkillProvider;
  readonly kind?: SkillKind;
  readonly scope?: SkillScope;
  readonly installedAt?: string;
  readonly installedByAppVersion?: string;
  readonly resolvedRef?: string;
  readonly resolvedDefaultBranch?: string;
  readonly resolvedCommitSha?: string;
  readonly displayNameAtInstall?: string;
  readonly descriptionAtInstall?: string;
  readonly manifestHash?: string;
  readonly lastCheckedAt?: string;
  readonly lastKnownRemoteCommitSha?: string;
  readonly lastUpgradeAt?: string;
};

export type ResolvedGitHubRepository = {
  readonly owner: string;
  readonly repo: string;
  readonly repoUrl: string;
  readonly defaultBranch: string;
  readonly commitSha: string;
};

export type ResolvedSkillSource = {
  readonly sourceUrl: string;
  readonly sourceHost: string;
  readonly repoUrl: string;
  readonly slug: string;
  readonly displayName: string;
  readonly description?: string;
  readonly sourceSubpath?: string;
  readonly defaultBranch: string;
  readonly commitSha: string;
  readonly warnings: string[];
};

export type DiscoveredInstalledSkillEntry = {
  readonly installPath: string;
  readonly entryType: "directory" | "file";
  readonly provider: SkillProvider;
  readonly kind: SkillKind;
  readonly scope: SkillScope;
  readonly markdownPath: string;
  readonly slug: string;
  readonly realPath?: string;
};

export function trimToUndefined(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function decodeHtml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'");
}

export function stripTags(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

export function parseTitleFromSkillMarkdown(markdown: string): string | undefined {
  const titleMatch = /^#\s+(.+)$/m.exec(markdown);
  if (titleMatch?.[1]) {
    return titleMatch[1].trim();
  }
  const frontmatterNameMatch = /^name:\s*["']?(.+?)["']?\s*$/m.exec(markdown);
  return trimToUndefined(frontmatterNameMatch?.[1]);
}

function parseFrontmatter(markdown: string): Record<string, string> {
  const frontmatterMatch = /^---\n([\s\S]*?)\n---/m.exec(markdown);
  if (!frontmatterMatch?.[1]) {
    return {};
  }
  const entries: Record<string, string> = {};
  for (const rawLine of frontmatterMatch[1].split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf(":");
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    const value = trimToUndefined(
      line
        .slice(separatorIndex + 1)
        .trim()
        .replace(/^['"]|['"]$/g, ""),
    );
    if (key && value) {
      entries[key] = value;
    }
  }
  return entries;
}

export function parseFrontmatterName(markdown: string): string | undefined {
  return trimToUndefined(parseFrontmatter(markdown).name);
}

export function parseStandaloneMarkdownTitle(markdown: string): string | undefined {
  const heading = /^#\s+(.+)$/m.exec(markdown);
  if (heading?.[1]) {
    return trimToUndefined(heading[1]);
  }
  return parseFrontmatterName(markdown);
}

export function parseStandaloneMarkdownDescription(markdown: string): string | undefined {
  const frontmatterDescription = trimToUndefined(parseFrontmatter(markdown).description);
  if (frontmatterDescription) {
    return frontmatterDescription;
  }
  const withoutFrontmatter = markdown.replace(/^---\n[\s\S]*?\n---\n?/, "");
  const paragraphMatch = withoutFrontmatter.match(/\n\n([^\n#][\s\S]*?)(?:\n\n|$)/);
  return trimToUndefined(paragraphMatch?.[1]?.replace(/\s+/g, " "));
}

export function parseDescriptionFromSkillMarkdown(markdown: string): string | undefined {
  const frontmatterDescriptionMatch = /^description:\s*["']?(.+?)["']?\s*$/m.exec(markdown);
  if (frontmatterDescriptionMatch?.[1]) {
    return frontmatterDescriptionMatch[1].trim();
  }

  const paragraphMatch = markdown.match(/\n\n([^\n#][\s\S]*?)(?:\n\n|$)/);
  return trimToUndefined(paragraphMatch?.[1]?.replace(/\s+/g, " "));
}

export function sanitizeSlug(input: string): string {
  const lastSegment = input
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .findLast((segment) => segment.length > 0);
  return lastSegment?.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") ?? "skill";
}

export function provenanceFileName(installPath: string): string {
  return `${createHash("sha1").update(installPath).digest("hex")}.json`;
}

export function isWithinDirectory(targetPath: string, directoryPath: string): boolean {
  const relative = path.relative(directoryPath, targetPath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function parseGitHubRepoReference(
  input: string,
): { repoUrl: string; subpath?: string } | null {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (trimmed.startsWith("https://github.com/")) {
    const relative = trimmed.slice("https://github.com/".length);
    const segments = relative.split("/").filter(Boolean);
    if (segments.length < 2) return null;
    const [owner, repo, ...rest] = segments;
    return {
      repoUrl: `https://github.com/${owner}/${repo}`,
      ...(rest.length > 0 ? { subpath: rest.join("/") } : {}),
    };
  }

  const segments = trimmed.split("/").filter(Boolean);
  if (segments.length < 2) return null;
  const [owner, repo, ...rest] = segments;
  return {
    repoUrl: `https://github.com/${owner}/${repo}`,
    ...(rest.length > 0 ? { subpath: rest.join("/") } : {}),
  };
}

export function installDirectoryFor(params: {
  provider: SkillProvider;
  kind: SkillKind;
  scope: SkillScope;
  workspaceRoot?: string;
  codexHomePath?: string;
}): string {
  const scopeRoot =
    params.scope === "project"
      ? (() => {
          if (!params.workspaceRoot) {
            throw new Error("Project-scoped installs require a workspace root.");
          }
          return params.workspaceRoot;
        })()
      : os.homedir();

  if (params.provider === "codex") {
    if (params.scope === "project") {
      return path.join(scopeRoot, ".codex", "skills");
    }
    return path.join(params.codexHomePath ?? path.join(os.homedir(), ".codex"), "skills");
  }

  if (params.kind === "subagent") {
    return path.join(scopeRoot, ".claude", "agents");
  }

  return path.join(scopeRoot, ".claude", "skills");
}

export function compatibleProvidersFor(params: {
  provider: SkillProvider;
  kind: SkillKind;
}): SkillProvider[] {
  if (params.kind === "subagent") {
    return params.provider === "claudeAgent" ? ["claudeAgent"] : [];
  }
  return ["codex", "claudeAgent"];
}

export function listManagedDirectories(params: {
  workspaceRoot?: string;
  codexHomePath?: string;
}): string[] {
  const roots = [
    installDirectoryFor({
      provider: "codex",
      kind: "skill",
      scope: "global",
      ...(params.codexHomePath ? { codexHomePath: params.codexHomePath } : {}),
    }),
    installDirectoryFor({
      provider: "claudeAgent",
      kind: "skill",
      scope: "global",
    }),
    installDirectoryFor({
      provider: "claudeAgent",
      kind: "subagent",
      scope: "global",
    }),
  ];
  if (params.workspaceRoot) {
    roots.push(
      installDirectoryFor({
        provider: "codex",
        kind: "skill",
        scope: "project",
        workspaceRoot: params.workspaceRoot,
        ...(params.codexHomePath ? { codexHomePath: params.codexHomePath } : {}),
      }),
      installDirectoryFor({
        provider: "claudeAgent",
        kind: "skill",
        scope: "project",
        workspaceRoot: params.workspaceRoot,
      }),
      installDirectoryFor({
        provider: "claudeAgent",
        kind: "subagent",
        scope: "project",
        workspaceRoot: params.workspaceRoot,
      }),
    );
  }
  return roots.map((root) => path.resolve(root));
}

export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function findSkillDirectories(root: string): Promise<string[]> {
  if (!(await fileExists(root))) {
    return [];
  }

  const entries = await readdir(root, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    if (await fileExists(path.join(dir, SKILL_MD))) {
      results.push(dir);
    }
  }
  return results;
}

export async function discoverInstalledSkillEntries(params: {
  root: string;
  provider: SkillProvider;
  kind: SkillKind;
  scope: SkillScope;
}): Promise<DiscoveredInstalledSkillEntry[]> {
  if (!(await fileExists(params.root))) {
    return [];
  }

  const entries = await readdir(params.root, { withFileTypes: true });
  const results: DiscoveredInstalledSkillEntry[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const installPath = path.join(params.root, entry.name);
    const entryStat = await lstat(installPath);

    if (params.provider === "claudeAgent" && params.kind === "subagent") {
      const isMarkdownFile =
        entry.isFile() ||
        entryStat.isFile() ||
        (entryStat.isSymbolicLink() && entry.name.endsWith(".md"));
      if (!isMarkdownFile || !entry.name.endsWith(".md")) {
        continue;
      }
      const realPath = entryStat.isSymbolicLink()
        ? await realpath(installPath).catch(() => null)
        : installPath;
      if (!realPath) {
        continue;
      }
      const realStat = await stat(realPath).catch(() => null);
      if (!realStat?.isFile()) {
        continue;
      }
      results.push({
        installPath,
        entryType: "file",
        provider: params.provider,
        kind: params.kind,
        scope: params.scope,
        markdownPath: installPath,
        slug: path.basename(entry.name, ".md"),
        ...(realPath !== installPath ? { realPath } : {}),
      });
      continue;
    }

    const isDirectoryCandidate =
      entry.isDirectory() ||
      (entryStat.isSymbolicLink() &&
        (await realpath(installPath)
          .then((resolvedPath) => stat(resolvedPath))
          .then((resolvedStat) => resolvedStat.isDirectory())
          .catch(() => false)));
    if (!isDirectoryCandidate) {
      continue;
    }
    const realPath = entryStat.isSymbolicLink()
      ? await realpath(installPath).catch(() => null)
      : installPath;
    if (!realPath) {
      continue;
    }
    const markdownPath = path.join(realPath, SKILL_MD);
    if (!(await fileExists(markdownPath))) {
      continue;
    }
    results.push({
      installPath,
      entryType: "directory",
      provider: params.provider,
      kind: params.kind,
      scope: params.scope,
      markdownPath,
      slug: path.basename(installPath),
      ...(realPath !== installPath ? { realPath } : {}),
    });
  }

  return results;
}

/**
 * Discover skills installed via the Claude plugins system (e.g. superpowers,
 * frontend-design).  These live under ~/.claude/plugins/cache/ and are tracked
 * by ~/.claude/plugins/installed_plugins.json.
 */
export async function discoverPluginSkillEntries(): Promise<DiscoveredInstalledSkillEntry[]> {
  const pluginsJsonPath = path.join(os.homedir(), ".claude", "plugins", "installed_plugins.json");
  type InstalledPluginsFile = {
    plugins: Record<string, Array<{ installPath: string }>>;
  };
  const pluginsData = await readJsonFile<InstalledPluginsFile>(pluginsJsonPath);
  if (!pluginsData?.plugins) {
    return [];
  }

  const results: DiscoveredInstalledSkillEntry[] = [];

  for (const entries of Object.values(pluginsData.plugins)) {
    // Use the first (active) entry for each plugin
    const entry = entries[0];
    if (!entry?.installPath) continue;

    const skillsRoot = path.join(entry.installPath, "skills");
    if (!(await fileExists(skillsRoot))) continue;

    let skillDirs: import("node:fs").Dirent[];
    try {
      skillDirs = await readdir(skillsRoot, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const skillDir of skillDirs) {
      if (!skillDir.isDirectory() || skillDir.name.startsWith(".")) continue;
      const skillPath = path.join(skillsRoot, skillDir.name);
      const markdownPath = path.join(skillPath, SKILL_MD);
      if (!(await fileExists(markdownPath))) continue;
      results.push({
        installPath: skillPath,
        entryType: "directory",
        provider: "claudeAgent",
        kind: "skill",
        scope: "global",
        markdownPath,
        slug: skillDir.name,
      });
    }
  }

  return results;
}

export function getSourceHost(sourceUrl?: string): string | undefined {
  if (!sourceUrl) return undefined;
  try {
    return new URL(sourceUrl).host;
  } catch {
    return undefined;
  }
}

export async function computeDirectoryManifestHash(root: string): Promise<string> {
  const hash = createHash("sha256");
  const queue = [root];
  const files: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".git") continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }
  const sortedFiles = files.toSorted();
  for (const filePath of sortedFiles) {
    const relativePath = path.relative(root, filePath);
    hash.update(relativePath);
    hash.update("\0");
    hash.update(await readFile(filePath));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export async function assertNoSymlinkEscape(root: string): Promise<void> {
  const resolvedRoot = await realpath(root);
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const entryStat = await lstat(fullPath);
      if (entryStat.isSymbolicLink()) {
        throw new Error(`Archive contains unsupported symlink: ${fullPath}`);
      }
      if (entry.isDirectory()) {
        const resolvedDir = await realpath(fullPath);
        if (!isWithinDirectory(resolvedDir, resolvedRoot) && resolvedDir !== resolvedRoot) {
          throw new Error(`Archive directory escapes extraction root: ${fullPath}`);
        }
        queue.push(fullPath);
      }
    }
  }
}
