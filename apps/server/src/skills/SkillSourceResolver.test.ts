import { SKILL_SOURCE_FETCH_MAX_BYTES } from "./shared.ts";
import { resolveGitHubRepository, resolveSkillSource } from "./SkillSourceResolver.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("SkillSourceResolver", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects non-skills.sh URLs", async () => {
    await expect(resolveSkillSource("https://example.com/skill")).rejects.toThrow(
      "Only skills.sh URLs are supported.",
    );
  });

  it("fails closed when the skills page does not expose a supported install command", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html><body><h1>No install command</h1></body></html>")),
    );

    await expect(resolveSkillSource("https://skills.sh/example/missing-command")).rejects.toThrow(
      "Could not find a supported install command",
    );
  });

  it("rejects oversized skills pages before parsing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("too big", {
            status: 200,
            headers: {
              "content-length": String(SKILL_SOURCE_FETCH_MAX_BYTES + 1),
            },
          }),
      ),
    );

    await expect(resolveSkillSource("https://skills.sh/example/too-large")).rejects.toThrow(
      "Remote skills page is too large.",
    );
  });

  it("parses supported GitHub-backed skills.sh pages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = input.toString();
        if (url === "https://skills.sh/openai/codex/frontend-design") {
          return new Response(
            [
              '<html><head><link rel="canonical" href="https://skills.sh/openai/codex/frontend-design"></head>',
              "<body><h1>Frontend Design</h1>",
              '<meta property="og:description" content="Install the polished UI skill.">',
              "<code>npx skills add openai/codex/frontend-design --skill frontend-design</code>",
              "</body></html>",
            ].join(""),
            { status: 200 },
          );
        }
        if (url === "https://api.github.com/repos/openai/codex") {
          return new Response(JSON.stringify({ default_branch: "main" }), { status: 200 });
        }
        if (url === "https://api.github.com/repos/openai/codex/commits/main") {
          return new Response(JSON.stringify({ sha: "commit-sha" }), { status: 200 });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    await expect(
      resolveSkillSource("https://skills.sh/openai/codex/frontend-design"),
    ).resolves.toMatchObject({
      sourceUrl: "https://skills.sh/openai/codex/frontend-design",
      sourceHost: "skills.sh",
      repoUrl: "https://github.com/openai/codex",
      slug: "frontend-design",
      displayName: "Frontend Design",
      description: "polished UI skill.",
      sourceSubpath: "frontend-design",
      defaultBranch: "main",
      commitSha: "commit-sha",
    });
  });

  it("surfaces GitHub repository resolution failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 404 })),
    );

    await expect(resolveGitHubRepository("https://github.com/openai/missing")).rejects.toThrow(
      "Failed to resolve GitHub repository (404).",
    );
  });
});
