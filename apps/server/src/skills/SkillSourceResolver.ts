import { Buffer } from "node:buffer";

import {
  SKILL_DOWNLOAD_TIMEOUT_MS,
  SKILLS_SH_HOST,
  SKILL_SOURCE_FETCH_MAX_BYTES,
  type ResolvedGitHubRepository,
  type ResolvedSkillSource,
  decodeHtml,
  parseGitHubRepoReference,
  sanitizeSlug,
  stripTags,
  trimToUndefined,
} from "./shared.ts";

async function fetchTextWithLimit(url: string, maxBytes: number): Promise<string> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(SKILL_DOWNLOAD_TIMEOUT_MS),
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "t3-code-skills/1.0",
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to load skills page (${response.status}).`);
  }
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new Error("Remote skills page is too large.");
  }
  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > maxBytes) {
    throw new Error("Remote skills page is too large.");
  }
  return Buffer.from(arrayBuffer).toString("utf8");
}

function parseGitHubRepoUrl(repoUrl: string): { owner: string; repo: string } {
  const parsed = new URL(repoUrl);
  if (parsed.host !== "github.com") {
    throw new Error("Only GitHub-backed skill sources are supported.");
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length < 2) {
    throw new Error("Could not resolve GitHub repository from source.");
  }
  return { owner: segments[0]!, repo: segments[1]! };
}

export async function resolveGitHubRepository(repoUrl: string): Promise<ResolvedGitHubRepository> {
  const { owner, repo } = parseGitHubRepoUrl(repoUrl);
  const repoResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    signal: AbortSignal.timeout(SKILL_DOWNLOAD_TIMEOUT_MS),
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "t3-code-skills/1.0",
    },
  });
  if (!repoResponse.ok) {
    throw new Error(`Failed to resolve GitHub repository (${repoResponse.status}).`);
  }
  const repoJson = (await repoResponse.json()) as {
    default_branch?: string;
  };
  const defaultBranch = trimToUndefined(repoJson.default_branch);
  if (!defaultBranch) {
    throw new Error("GitHub repository did not return a default branch.");
  }

  const commitResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(defaultBranch)}`,
    {
      signal: AbortSignal.timeout(SKILL_DOWNLOAD_TIMEOUT_MS),
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "t3-code-skills/1.0",
      },
    },
  );
  if (!commitResponse.ok) {
    throw new Error(`Failed to resolve GitHub repository commit (${commitResponse.status}).`);
  }
  const commitJson = (await commitResponse.json()) as {
    sha?: string;
  };
  const commitSha = trimToUndefined(commitJson.sha);
  if (!commitSha) {
    throw new Error("GitHub repository did not return a commit SHA.");
  }

  return {
    owner,
    repo,
    repoUrl: `https://github.com/${owner}/${repo}`,
    defaultBranch,
    commitSha,
  };
}

export async function resolveSkillSource(url: string): Promise<ResolvedSkillSource> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("Skill source must be a valid URL.");
  }
  if (parsedUrl.host !== SKILLS_SH_HOST) {
    throw new Error("Only skills.sh URLs are supported.");
  }

  const html = await fetchTextWithLimit(url, SKILL_SOURCE_FETCH_MAX_BYTES);
  const commandMatch =
    html.match(/npx skills add ([^<\s]+)(?:\s+--skill\s+([^<\s]+))?/) ??
    html.match(/npx skills add ([^"\s]+)(?:\s+--skill\s+([^"\s]+))?/);
  if (!commandMatch?.[1]) {
    throw new Error("Could not find a supported install command on this skills.sh page.");
  }

  const repoReference = parseGitHubRepoReference(decodeHtml(commandMatch[1]));
  if (!repoReference) {
    throw new Error("Could not resolve a GitHub repository from this skills.sh page.");
  }

  const canonicalMatch = html.match(/<link rel="canonical" href="([^"]+)"/i);
  const sourceUrl = trimToUndefined(canonicalMatch?.[1]) ?? parsedUrl.toString();
  const sourceHost = new URL(sourceUrl).host;

  const titleMatch = html.match(/<h1[^>]*>(.*?)<\/h1>/i);
  const displayName =
    trimToUndefined(stripTags(titleMatch?.[1] ?? "")) ??
    trimToUndefined(commandMatch[2]) ??
    sanitizeSlug(parsedUrl.pathname) ??
    "skill";
  const slug = sanitizeSlug(commandMatch[2] ?? displayName);

  const descriptionMatch =
    html.match(/<meta name="twitter:description" content="([^"]+)"/i) ??
    html.match(/<meta property="og:description" content="([^"]+)"/i);
  const description = trimToUndefined(descriptionMatch?.[1]?.replace(/^Install the /, ""));

  const repository = await resolveGitHubRepository(repoReference.repoUrl);

  return {
    sourceUrl,
    sourceHost,
    repoUrl: repository.repoUrl,
    slug,
    displayName,
    ...(description ? { description } : {}),
    ...(repoReference.subpath ? { sourceSubpath: repoReference.subpath } : {}),
    defaultBranch: repository.defaultBranch,
    commitSha: repository.commitSha,
    warnings: [],
  };
}
