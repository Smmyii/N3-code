import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SkillKind, SkillProvider } from "@t3tools/contracts";

import { createLogger } from "../logger.ts";
import { runProcess } from "../processRunner.ts";
import {
  SKILL_ARCHIVE_MAX_BYTES,
  SKILL_DOWNLOAD_TIMEOUT_MS,
  SKILL_MD,
  assertNoSymlinkEscape,
  computeDirectoryManifestHash,
  fileExists,
  parseFrontmatterName,
  type ResolvedSkillSource,
} from "./shared.ts";

const logger = createLogger("skills-installer");

async function extractTarball(archivePath: string, outputDir: string): Promise<void> {
  await runProcess("tar", ["-xzf", archivePath, "-C", outputDir]);
}

async function findCandidateSkillRoot(params: {
  repoRoot: string;
  slug: string;
  sourceSubpath?: string;
}): Promise<string | null> {
  if (params.sourceSubpath) {
    const explicit = path.join(params.repoRoot, params.sourceSubpath);
    if (await fileExists(path.join(explicit, SKILL_MD))) {
      return explicit;
    }
  }

  const queue = [params.repoRoot];
  const matches: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.name.startsWith(".git")) continue;
      if (entry.name === params.slug && (await fileExists(path.join(fullPath, SKILL_MD)))) {
        matches.push(fullPath);
      }
      queue.push(fullPath);
    }
  }
  return matches.toSorted((left, right) => left.length - right.length)[0] ?? null;
}

async function downloadArchive(url: string, destination: string): Promise<void> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(SKILL_DOWNLOAD_TIMEOUT_MS),
    headers: {
      Accept: "application/octet-stream",
      "User-Agent": "t3-code-skills/1.0",
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to download skill archive (${response.status}).`);
  }
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > SKILL_ARCHIVE_MAX_BYTES) {
    throw new Error("Skill archive is too large.");
  }
  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > SKILL_ARCHIVE_MAX_BYTES) {
    throw new Error("Skill archive is too large.");
  }
  await writeFile(destination, Buffer.from(arrayBuffer));
}

async function copyDirectoryRecursive(source: string, destination: string): Promise<void> {
  const sourceStat = await stat(source);
  if (!sourceStat.isDirectory()) {
    throw new Error(`Source is not a directory: ${source}`);
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true, force: true });
}

async function copyFile(source: string, destination: string): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { force: true });
}

async function findCandidateSubagentFile(params: {
  repoRoot: string;
  slug: string;
  sourceSubpath?: string;
}): Promise<string | null> {
  if (params.sourceSubpath) {
    const explicit = path.join(params.repoRoot, params.sourceSubpath);
    const explicitStat = await stat(explicit).catch(() => null);
    if (explicitStat?.isFile() && explicit.endsWith(".md")) {
      return explicit;
    }
    if (explicitStat?.isDirectory()) {
      const entries = await readdir(explicit, { withFileTypes: true });
      const candidates = entries
        .filter(
          (entry) => entry.isFile() && entry.name.endsWith(".md") && !entry.name.startsWith("."),
        )
        .map((entry) => path.join(explicit, entry.name));
      if (candidates.length === 1) {
        return candidates[0]!;
      }
      if (candidates.length > 1) {
        throw new Error("Resolved subagent source is ambiguous.");
      }
    }
  }

  const queue = [params.repoRoot];
  const matches: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".git")) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const markdown = await readFile(fullPath, "utf8");
      const parsedSlug = parseFrontmatterName(markdown) ?? path.basename(entry.name, ".md");
      if (parsedSlug === params.slug) {
        matches.push(fullPath);
      }
    }
  }
  return matches.toSorted((left, right) => left.length - right.length)[0] ?? null;
}

export async function installSkillFromResolvedSource(params: {
  source: ResolvedSkillSource;
  installPath: string;
  provider: SkillProvider;
  kind: SkillKind;
  overwrite?: boolean;
}): Promise<{
  markdown: string;
  manifestHash: string;
}> {
  const exists = await fileExists(params.installPath);
  if (exists && params.overwrite !== true) {
    throw new Error(`Destination already exists: ${params.installPath}`);
  }

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "t3-skill-install-"));
  try {
    const archivePath = path.join(tempRoot, "repo.tar.gz");
    await downloadArchive(
      `https://api.github.com/repos/${new URL(params.source.repoUrl).pathname.split("/").filter(Boolean).join("/")}/tarball/${params.source.commitSha}`,
      archivePath,
    );

    const extractedDir = path.join(tempRoot, "repo");
    await mkdir(extractedDir, { recursive: true });
    await extractTarball(archivePath, extractedDir);
    await assertNoSymlinkEscape(extractedDir);
    const [topLevelEntry] = await readdir(extractedDir);
    if (!topLevelEntry) {
      throw new Error("Downloaded repository archive is empty.");
    }

    const repoRoot = path.join(extractedDir, topLevelEntry);
    if (exists) {
      await rm(params.installPath, { recursive: true, force: true });
    }
    let markdown: string;
    let manifestHash: string;
    if (params.provider === "claudeAgent" && params.kind === "subagent") {
      const sourceFile = await findCandidateSubagentFile({
        repoRoot,
        slug: params.source.slug,
        ...(params.source.sourceSubpath ? { sourceSubpath: params.source.sourceSubpath } : {}),
      });
      if (!sourceFile) {
        throw new Error(`Could not locate subagent '${params.source.slug}' in repository.`);
      }
      await copyFile(sourceFile, params.installPath);
      markdown = await readFile(params.installPath, "utf8");
      manifestHash = createHash("sha256").update(markdown).digest("hex");
    } else {
      const sourceSkillRoot = await findCandidateSkillRoot({
        repoRoot,
        slug: params.source.slug,
        ...(params.source.sourceSubpath ? { sourceSubpath: params.source.sourceSubpath } : {}),
      });
      if (!sourceSkillRoot) {
        throw new Error(`Could not locate skill '${params.source.slug}' in repository.`);
      }
      if (!(await fileExists(path.join(sourceSkillRoot, SKILL_MD)))) {
        throw new Error("Resolved skill root does not contain SKILL.md.");
      }
      await copyDirectoryRecursive(sourceSkillRoot, params.installPath);
      markdown = await readFile(path.join(params.installPath, SKILL_MD), "utf8");
      manifestHash = await computeDirectoryManifestHash(params.installPath);
    }
    return { markdown, manifestHash };
  } finally {
    try {
      await rm(tempRoot, { recursive: true, force: true });
      logger.event("skill installer cleanup succeeded", { tempRoot });
    } catch (cleanupError) {
      logger.warn("skill installer cleanup failed", {
        tempRoot,
        error: String(cleanupError),
      });
    }
  }
}
