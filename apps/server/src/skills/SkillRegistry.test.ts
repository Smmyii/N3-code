import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ServerConfig } from "../config";
import { SkillRegistry, SkillRegistryLive } from "./Services/SkillRegistry";
import { AnalyticsService } from "../telemetry/Services/AnalyticsService";
import { installDirectoryFor, provenanceFileName } from "./shared";

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

function appStateDir(baseDir: string): string {
  return path.join(baseDir, "userdata");
}

async function createSkillArchive(params: {
  slug: string;
  markdown: string;
  symlinkName?: string;
}): Promise<Buffer> {
  const archiveRoot = await makeTempDir("t3-skill-archive-");

  try {
    const repoRoot = path.join(archiveRoot, "repo-main");
    const skillRoot = path.join(repoRoot, params.slug);
    await fs.mkdir(skillRoot, { recursive: true });
    await fs.writeFile(path.join(skillRoot, "SKILL.md"), params.markdown, "utf8");
    if (params.symlinkName) {
      await fs.symlink("SKILL.md", path.join(skillRoot, params.symlinkName));
    }

    const archivePath = path.join(archiveRoot, "repo.tar.gz");
    const tar = spawnSync("tar", ["-czf", archivePath, "-C", archiveRoot, "repo-main"]);
    if (tar.status !== 0) {
      throw new Error(tar.stderr.toString("utf8") || "Failed to create skill archive.");
    }
    return await fs.readFile(archivePath);
  } finally {
    await fs.rm(archiveRoot, { recursive: true, force: true });
  }
}

describe("SkillRegistry", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects project-scoped install roots without a workspace root", () => {
    expect(() =>
      installDirectoryFor({
        provider: "codex",
        kind: "skill",
        scope: "project",
      }),
    ).toThrow("Project-scoped installs require a workspace root.");
  });

  it("lists installed skills and subagents with metadata and provenance", async () => {
    const workspaceRoot = await makeTempDir("t3-skill-workspace-");
    const stateDir = await makeTempDir("t3-skill-state-");
    const codexHome = await makeTempDir("t3-skill-codex-home-");
    const originalHome = process.env.HOME;
    const fakeHome = await makeTempDir("t3-skill-home-");
    process.env.HOME = fakeHome;

    try {
      const codexSkillDir = path.join(codexHome, "skills", "copywriter");
      const claudeSkillTargetDir = path.join(fakeHome, ".agents", "skills", "reviewer");
      const claudeSkillDir = path.join(workspaceRoot, ".claude", "skills", "reviewer");
      const claudeSubagentFile = path.join(fakeHome, ".claude", "agents", "planner.md");

      await fs.mkdir(codexSkillDir, { recursive: true });
      await fs.mkdir(claudeSkillTargetDir, { recursive: true });
      await fs.mkdir(path.dirname(claudeSkillDir), { recursive: true });
      await fs.mkdir(path.dirname(claudeSubagentFile), { recursive: true });

      await fs.writeFile(
        path.join(codexSkillDir, "SKILL.md"),
        "# Copywriter\n\nWrites sharp product copy.\n",
        "utf8",
      );
      await fs.writeFile(
        path.join(claudeSkillTargetDir, "SKILL.md"),
        "# Reviewer\n\ndescription: Reviews code for defects.\n",
        "utf8",
      );
      await fs.symlink(claudeSkillTargetDir, claudeSkillDir);
      await fs.writeFile(
        claudeSubagentFile,
        [
          "---",
          "name: planner",
          "description: Plans multi-step work.",
          "model: sonnet",
          "---",
          "",
          "# Planner",
          "",
          "Plans multi-step work.",
          "",
        ].join("\n"),
        "utf8",
      );
      await fs.mkdir(path.join(appStateDir(stateDir), "skills"), { recursive: true });

      const runtimeLayer = SkillRegistryLive.pipe(
        Layer.provideMerge(
          ServerConfig.layerTest(workspaceRoot, stateDir).pipe(
            Layer.provideMerge(NodeServices.layer),
          ),
        ),
        Layer.provideMerge(AnalyticsService.layerTest),
      );
      const inventory = await Effect.runPromise(
        Effect.gen(function* () {
          const registry = yield* SkillRegistry;
          return yield* registry.list({
            workspaceRoot,
            codexHomePath: codexHome,
          });
        }).pipe(Effect.provide(runtimeLayer)),
      );

      expect(inventory.warnings).toEqual([]);
      expect(
        inventory.items.map((item) => ({
          provider: item.provider,
          kind: item.kind,
          scope: item.scope,
          slug: item.slug,
          displayName: item.displayName,
        })),
      ).toEqual(
        expect.arrayContaining([
          {
            provider: "codex",
            kind: "skill",
            scope: "global",
            slug: "copywriter",
            displayName: "Copywriter",
          },
          {
            provider: "claudeAgent",
            kind: "skill",
            scope: "project",
            slug: "reviewer",
            displayName: "Reviewer",
          },
          {
            provider: "claudeAgent",
            kind: "subagent",
            scope: "global",
            slug: "planner",
            displayName: "Planner",
          },
        ]),
      );
    } finally {
      process.env.HOME = originalHome;
      await fs.rm(workspaceRoot, { recursive: true, force: true });
      await fs.rm(stateDir, { recursive: true, force: true });
      await fs.rm(codexHome, { recursive: true, force: true });
      await fs.rm(fakeHome, { recursive: true, force: true });
    }
  });

  it("parses install previews from skills.sh pages", async () => {
    const workspaceRoot = await makeTempDir("t3-skill-workspace-");
    const stateDir = await makeTempDir("t3-skill-state-");
    const codexHome = await makeTempDir("t3-skill-codex-home-");

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = input.toString();
        if (url === "https://skills.sh/openai/codex/frontend-design") {
          return new Response(
            [
              '<html><head><link rel="canonical" href="https://skills.sh/openai/codex/frontend-design"></head>',
              "<body><h1>Frontend Design</h1>",
              '<meta name="twitter:description" content="Install the polished UI skill.">',
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
          return new Response(JSON.stringify({ sha: "preview-commit-sha" }), { status: 200 });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    try {
      const runtimeLayer = SkillRegistryLive.pipe(
        Layer.provideMerge(
          ServerConfig.layerTest(workspaceRoot, stateDir).pipe(
            Layer.provideMerge(NodeServices.layer),
          ),
        ),
        Layer.provideMerge(AnalyticsService.layerTest),
      );
      const preview = await Effect.runPromise(
        Effect.gen(function* () {
          const registry = yield* SkillRegistry;
          return yield* registry.previewInstall({
            url: "https://skills.sh/openai/codex/frontend-design",
            provider: "codex",
            kind: "skill",
            scope: "global",
            codexHomePath: codexHome,
          });
        }).pipe(Effect.provide(runtimeLayer)),
      );

      expect(preview.slug).toBe("frontend-design");
      expect(preview.displayName).toBe("Frontend Design");
      expect(preview.repoUrl).toBe("https://github.com/openai/codex");
      expect(preview.sourceSubpath).toBe("frontend-design");
      expect(preview.installPath).toBe(path.join(codexHome, "skills", "frontend-design"));
      expect(preview.exists).toBe(false);
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
      await fs.rm(stateDir, { recursive: true, force: true });
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });

  it("rejects removals outside managed skill directories", async () => {
    const workspaceRoot = await makeTempDir("t3-skill-workspace-");
    const stateDir = await makeTempDir("t3-skill-state-");
    const codexHome = await makeTempDir("t3-skill-codex-home-");

    const rogueSkillDir = await makeTempDir("t3-rogue-skill-");
    await fs.writeFile(path.join(rogueSkillDir, "SKILL.md"), "# Rogue\n", "utf8");

    try {
      const runtimeLayer = SkillRegistryLive.pipe(
        Layer.provideMerge(
          ServerConfig.layerTest(workspaceRoot, stateDir).pipe(
            Layer.provideMerge(NodeServices.layer),
          ),
        ),
        Layer.provideMerge(AnalyticsService.layerTest),
      );
      await expect(
        Effect.runPromise(
          Effect.gen(function* () {
            const registry = yield* SkillRegistry;
            return yield* registry.remove({
              installPath: rogueSkillDir,
              workspaceRoot,
              codexHomePath: codexHome,
            });
          }).pipe(Effect.provide(runtimeLayer)),
        ),
      ).rejects.toThrow("outside managed skill directories");
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
      await fs.rm(stateDir, { recursive: true, force: true });
      await fs.rm(codexHome, { recursive: true, force: true });
      await fs.rm(rogueSkillDir, { recursive: true, force: true });
    }
  });

  it("removes file-based Claude subagents inside managed directories", async () => {
    const workspaceRoot = await makeTempDir("t3-skill-workspace-");
    const stateDir = await makeTempDir("t3-skill-state-");
    const codexHome = await makeTempDir("t3-skill-codex-home-");
    const originalHome = process.env.HOME;
    const fakeHome = await makeTempDir("t3-skill-home-");
    process.env.HOME = fakeHome;

    const subagentPath = path.join(fakeHome, ".claude", "agents", "program-manager.md");
    await fs.mkdir(path.dirname(subagentPath), { recursive: true });
    await fs.writeFile(
      subagentPath,
      [
        "---",
        "name: program-manager",
        "description: Coordinates work.",
        "---",
        "",
        "# Program Manager",
        "",
      ].join("\n"),
      "utf8",
    );

    try {
      const runtimeLayer = SkillRegistryLive.pipe(
        Layer.provideMerge(
          ServerConfig.layerTest(workspaceRoot, stateDir).pipe(
            Layer.provideMerge(NodeServices.layer),
          ),
        ),
        Layer.provideMerge(AnalyticsService.layerTest),
      );
      const removed = await Effect.runPromise(
        Effect.gen(function* () {
          const registry = yield* SkillRegistry;
          return yield* registry.remove({
            installPath: subagentPath,
            workspaceRoot,
            codexHomePath: codexHome,
          });
        }).pipe(Effect.provide(runtimeLayer)),
      );

      expect(removed.removed).toBe(true);
      await expect(fs.stat(subagentPath)).rejects.toThrow();
    } finally {
      process.env.HOME = originalHome;
      await fs.rm(workspaceRoot, { recursive: true, force: true });
      await fs.rm(stateDir, { recursive: true, force: true });
      await fs.rm(codexHome, { recursive: true, force: true });
      await fs.rm(fakeHome, { recursive: true, force: true });
    }
  });

  it("checks for upstream updates and records update metadata", async () => {
    const workspaceRoot = await makeTempDir("t3-skill-workspace-");
    const stateDir = await makeTempDir("t3-skill-state-");
    const codexHome = await makeTempDir("t3-skill-codex-home-");
    const originalHome = process.env.HOME;
    const fakeHome = await makeTempDir("t3-skill-home-");
    process.env.HOME = fakeHome;

    const skillDir = path.join(codexHome, "skills", "copywriter");

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = input.toString();
        if (url === "https://api.github.com/repos/openai/codex") {
          return new Response(JSON.stringify({ default_branch: "main" }), { status: 200 });
        }
        if (url === "https://api.github.com/repos/openai/codex/commits/main") {
          return new Response(JSON.stringify({ sha: "remote-commit-sha" }), { status: 200 });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    try {
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(
        path.join(skillDir, "SKILL.md"),
        "# Copywriter\n\nWrites sharp product copy.\n",
        "utf8",
      );
      await fs.mkdir(path.join(appStateDir(stateDir), "skills"), { recursive: true });
      await fs.writeFile(
        path.join(appStateDir(stateDir), "skills", provenanceFileName(skillDir)),
        JSON.stringify({
          installPath: skillDir,
          sourceUrl: "https://skills.sh/openai/codex/copywriter",
          repoUrl: "https://github.com/openai/codex",
          installedSlug: "copywriter",
          provider: "codex",
          kind: "skill",
          scope: "global",
          installedAt: "2026-03-01T00:00:00.000Z",
          installedByAppVersion: "0.0.0-test",
          resolvedRef: "installed-commit-sha",
          resolvedDefaultBranch: "main",
          resolvedCommitSha: "installed-commit-sha",
          manifestHash: "manifest",
        }),
        "utf8",
      );

      const runtimeLayer = SkillRegistryLive.pipe(
        Layer.provideMerge(
          ServerConfig.layerTest(workspaceRoot, stateDir).pipe(
            Layer.provideMerge(NodeServices.layer),
          ),
        ),
        Layer.provideMerge(AnalyticsService.layerTest),
      );
      const inventory = await Effect.runPromise(
        Effect.gen(function* () {
          const registry = yield* SkillRegistry;
          return yield* registry.checkUpdates({
            workspaceRoot,
            codexHomePath: codexHome,
            installPath: skillDir,
          });
        }).pipe(Effect.provide(runtimeLayer)),
      );

      const copywriter = inventory.items.find((item) => item.installPath === skillDir);
      expect(copywriter?.updateStatus).toBe("update-available");
      expect(copywriter?.lastCheckedAt).toBeTruthy();
      expect(copywriter?.lastKnownRemoteCommitSha).toBe("remote-commit-sha");
    } finally {
      process.env.HOME = originalHome;
      await fs.rm(workspaceRoot, { recursive: true, force: true });
      await fs.rm(stateDir, { recursive: true, force: true });
      await fs.rm(codexHome, { recursive: true, force: true });
      await fs.rm(fakeHome, { recursive: true, force: true });
    }
  });

  it("preserves permission_denied when skills management is disabled", async () => {
    const workspaceRoot = await makeTempDir("t3-skill-workspace-");
    const baseDir = await makeTempDir("t3-skill-disabled-state-");
    const stateDir = appStateDir(baseDir);
    const codexHome = await makeTempDir("t3-skill-codex-home-");

    try {
      const runtimeLayer = SkillRegistryLive.pipe(
        Layer.provideMerge(
          Layer.succeed(ServerConfig, {
            cwd: workspaceRoot,
            baseDir,
            stateDir,
            dbPath: path.join(stateDir, "state.sqlite"),
            keybindingsConfigPath: path.join(stateDir, "keybindings.json"),
            worktreesDir: path.join(baseDir, "worktrees"),
            attachmentsDir: path.join(stateDir, "attachments"),
            logsDir: path.join(stateDir, "logs"),
            serverLogPath: path.join(stateDir, "logs", "server.log"),
            providerLogsDir: path.join(stateDir, "logs", "provider"),
            providerEventLogPath: path.join(stateDir, "logs", "provider", "events.log"),
            terminalLogsDir: path.join(stateDir, "logs", "terminals"),
            anonymousIdPath: path.join(stateDir, "anonymous-id"),
            mode: "web",
            port: 0,
            host: undefined,
            staticDir: undefined,
            devUrl: undefined,
            noBrowser: false,
            authToken: undefined,
            autoBootstrapProjectFromCwd: false,
            logWebSocketEvents: false,
            skillsEnabled: false,
          }),
        ),
        Layer.provideMerge(NodeServices.layer),
        Layer.provideMerge(AnalyticsService.layerTest),
      );

      await expect(
        Effect.runPromise(
          Effect.gen(function* () {
            const registry = yield* SkillRegistry;
            return yield* registry.install({
              url: "https://skills.sh/openai/codex/copywriter",
              provider: "codex",
              kind: "skill",
              scope: "global",
              codexHomePath: codexHome,
            });
          }).pipe(Effect.provide(runtimeLayer)),
        ),
      ).rejects.toMatchObject({ code: "permission_denied" });
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
      await fs.rm(baseDir, { recursive: true, force: true });
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });

  it("classifies symlinked archives as archive_invalid", async () => {
    const workspaceRoot = await makeTempDir("t3-skill-workspace-");
    const stateDir = await makeTempDir("t3-skill-state-");
    const codexHome = await makeTempDir("t3-skill-codex-home-");
    const archive = await createSkillArchive({
      slug: "copywriter",
      markdown: "# Copywriter\n\nWrites sharp product copy.\n",
      symlinkName: "linked-skill.md",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = input.toString();
        if (url === "https://skills.sh/openai/codex/copywriter") {
          return new Response(
            [
              '<html><head><link rel="canonical" href="https://skills.sh/openai/codex/copywriter"></head>',
              "<body><h1>Copywriter</h1>",
              "<code>npx skills add openai/codex --skill copywriter</code>",
              "</body></html>",
            ].join(""),
            { status: 200 },
          );
        }
        if (url === "https://api.github.com/repos/openai/codex") {
          return new Response(JSON.stringify({ default_branch: "main" }), { status: 200 });
        }
        if (url === "https://api.github.com/repos/openai/codex/commits/main") {
          return new Response(JSON.stringify({ sha: "archive-test-sha" }), { status: 200 });
        }
        if (url === "https://api.github.com/repos/openai/codex/tarball/archive-test-sha") {
          return new Response(archive, {
            status: 200,
            headers: { "content-length": String(archive.byteLength) },
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    try {
      const runtimeLayer = SkillRegistryLive.pipe(
        Layer.provideMerge(
          ServerConfig.layerTest(workspaceRoot, stateDir).pipe(
            Layer.provideMerge(NodeServices.layer),
          ),
        ),
        Layer.provideMerge(AnalyticsService.layerTest),
      );

      await expect(
        Effect.runPromise(
          Effect.gen(function* () {
            const registry = yield* SkillRegistry;
            return yield* registry.install({
              url: "https://skills.sh/openai/codex/copywriter",
              provider: "codex",
              kind: "skill",
              scope: "global",
              codexHomePath: codexHome,
            });
          }).pipe(Effect.provide(runtimeLayer)),
        ),
      ).rejects.toMatchObject({ code: "archive_invalid" });
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
      await fs.rm(stateDir, { recursive: true, force: true });
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });

  it("records lastUpgradeAt on the first upgrade", async () => {
    const workspaceRoot = await makeTempDir("t3-skill-workspace-");
    const stateDir = await makeTempDir("t3-skill-state-");
    const codexHome = await makeTempDir("t3-skill-codex-home-");
    const archive = await createSkillArchive({
      slug: "copywriter",
      markdown: "# Copywriter\n\nWrites sharp product copy.\n",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = input.toString();
        if (url === "https://skills.sh/openai/codex/copywriter") {
          return new Response(
            [
              '<html><head><link rel="canonical" href="https://skills.sh/openai/codex/copywriter"></head>',
              "<body><h1>Copywriter</h1>",
              "<code>npx skills add openai/codex --skill copywriter</code>",
              "</body></html>",
            ].join(""),
            { status: 200 },
          );
        }
        if (url === "https://api.github.com/repos/openai/codex") {
          return new Response(JSON.stringify({ default_branch: "main" }), { status: 200 });
        }
        if (url === "https://api.github.com/repos/openai/codex/commits/main") {
          return new Response(JSON.stringify({ sha: "upgrade-test-sha" }), { status: 200 });
        }
        if (url === "https://api.github.com/repos/openai/codex/tarball/upgrade-test-sha") {
          return new Response(archive, {
            status: 200,
            headers: { "content-length": String(archive.byteLength) },
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    try {
      const runtimeLayer = SkillRegistryLive.pipe(
        Layer.provideMerge(
          ServerConfig.layerTest(workspaceRoot, stateDir).pipe(
            Layer.provideMerge(NodeServices.layer),
          ),
        ),
        Layer.provideMerge(AnalyticsService.layerTest),
      );

      const upgraded = await Effect.runPromise(
        Effect.gen(function* () {
          const registry = yield* SkillRegistry;
          const installed = yield* registry.install({
            url: "https://skills.sh/openai/codex/copywriter",
            provider: "codex",
            kind: "skill",
            scope: "global",
            codexHomePath: codexHome,
          });
          return yield* registry.upgrade({
            installPath: installed.item.installPath,
            codexHomePath: codexHome,
          });
        }).pipe(Effect.provide(runtimeLayer)),
      );

      const installPath = path.join(codexHome, "skills", "copywriter");
      const provenancePath = path.join(
        appStateDir(stateDir),
        "skills",
        provenanceFileName(installPath),
      );
      const provenance = JSON.parse(await fs.readFile(provenancePath, "utf8")) as {
        lastUpgradeAt?: string;
      };

      expect(upgraded.item.lastUpgradeAt).toBeTruthy();
      expect(provenance.lastUpgradeAt).toBeTruthy();
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
      await fs.rm(stateDir, { recursive: true, force: true });
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });

  it("adopts an installed skill for sync and exposes owner/link metadata", async () => {
    const workspaceRoot = await makeTempDir("t3-skill-workspace-");
    const stateDir = await makeTempDir("t3-skill-state-");
    const codexHome = await makeTempDir("t3-skill-codex-home-");
    const originalHome = process.env.HOME;
    const fakeHome = await makeTempDir("t3-skill-home-");
    process.env.HOME = fakeHome;

    try {
      const skillDir = path.join(codexHome, "skills", "copywriter");
      const claudeLinkedPath = path.join(fakeHome, ".claude", "skills", "copywriter");
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(
        path.join(skillDir, "SKILL.md"),
        "# Copywriter\n\nWrites sharp product copy.\n",
        "utf8",
      );

      const runtimeLayer = SkillRegistryLive.pipe(
        Layer.provideMerge(
          ServerConfig.layerTest(workspaceRoot, stateDir).pipe(
            Layer.provideMerge(NodeServices.layer),
          ),
        ),
        Layer.provideMerge(AnalyticsService.layerTest),
      );

      const inventory = await Effect.runPromise(
        Effect.gen(function* () {
          const registry = yield* SkillRegistry;
          return yield* registry.adopt({
            installPath: skillDir,
            workspaceRoot,
            codexHomePath: codexHome,
            targetProviders: ["claudeAgent"],
          });
        }).pipe(Effect.provide(runtimeLayer)),
      );

      const owner = inventory.items.find((item) => item.installPath === skillDir);
      const linked = inventory.items.find((item) => item.installPath === claudeLinkedPath);

      expect(owner?.managedStatus).toBe("owner");
      expect(owner?.ownerProvider).toBe("codex");
      expect(owner?.linkedProviders).toEqual(["claudeAgent"]);
      expect(linked?.managedStatus).toBe("linked");
      expect(linked?.ownerProvider).toBe("codex");
      expect((await fs.lstat(claudeLinkedPath)).isSymbolicLink()).toBe(true);
    } finally {
      process.env.HOME = originalHome;
      await fs.rm(workspaceRoot, { recursive: true, force: true });
      await fs.rm(stateDir, { recursive: true, force: true });
      await fs.rm(codexHome, { recursive: true, force: true });
      await fs.rm(fakeHome, { recursive: true, force: true });
    }
  });

  it("disables a linked managed target and keeps a synthetic disabled inventory item", async () => {
    const workspaceRoot = await makeTempDir("t3-skill-workspace-");
    const stateDir = await makeTempDir("t3-skill-state-");
    const codexHome = await makeTempDir("t3-skill-codex-home-");
    const originalHome = process.env.HOME;
    const fakeHome = await makeTempDir("t3-skill-home-");
    process.env.HOME = fakeHome;

    try {
      const skillDir = path.join(codexHome, "skills", "copywriter");
      const claudeLinkedPath = path.join(fakeHome, ".claude", "skills", "copywriter");
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(
        path.join(skillDir, "SKILL.md"),
        "# Copywriter\n\nWrites sharp product copy.\n",
        "utf8",
      );

      const runtimeLayer = SkillRegistryLive.pipe(
        Layer.provideMerge(
          ServerConfig.layerTest(workspaceRoot, stateDir).pipe(
            Layer.provideMerge(NodeServices.layer),
          ),
        ),
        Layer.provideMerge(AnalyticsService.layerTest),
      );

      const inventory = await Effect.runPromise(
        Effect.gen(function* () {
          const registry = yield* SkillRegistry;
          yield* registry.adopt({
            installPath: skillDir,
            workspaceRoot,
            codexHomePath: codexHome,
            targetProviders: ["claudeAgent"],
          });
          return yield* registry.setEnabled({
            installPath: claudeLinkedPath,
            enabled: false,
            scope: "current-provider",
            workspaceRoot,
            codexHomePath: codexHome,
          });
        }).pipe(Effect.provide(runtimeLayer)),
      );

      const linked = inventory.items.find((item) => item.installPath === claudeLinkedPath);
      const owner = inventory.items.find((item) => item.installPath === skillDir);

      expect(linked?.managedStatus).toBe("disabled");
      expect(owner?.managedStatus).toBe("owner");
      await expect(fs.stat(claudeLinkedPath)).rejects.toThrow();
    } finally {
      process.env.HOME = originalHome;
      await fs.rm(workspaceRoot, { recursive: true, force: true });
      await fs.rm(stateDir, { recursive: true, force: true });
      await fs.rm(codexHome, { recursive: true, force: true });
      await fs.rm(fakeHome, { recursive: true, force: true });
    }
  });

  it("stops managing by removing linked installs and leaving the owner untouched", async () => {
    const workspaceRoot = await makeTempDir("t3-skill-workspace-");
    const stateDir = await makeTempDir("t3-skill-state-");
    const codexHome = await makeTempDir("t3-skill-codex-home-");
    const originalHome = process.env.HOME;
    const fakeHome = await makeTempDir("t3-skill-home-");
    process.env.HOME = fakeHome;

    try {
      const skillDir = path.join(codexHome, "skills", "copywriter");
      const claudeLinkedPath = path.join(fakeHome, ".claude", "skills", "copywriter");
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(
        path.join(skillDir, "SKILL.md"),
        "# Copywriter\n\nWrites sharp product copy.\n",
        "utf8",
      );

      const runtimeLayer = SkillRegistryLive.pipe(
        Layer.provideMerge(
          ServerConfig.layerTest(workspaceRoot, stateDir).pipe(
            Layer.provideMerge(NodeServices.layer),
          ),
        ),
        Layer.provideMerge(AnalyticsService.layerTest),
      );

      const inventory = await Effect.runPromise(
        Effect.gen(function* () {
          const registry = yield* SkillRegistry;
          yield* registry.adopt({
            installPath: skillDir,
            workspaceRoot,
            codexHomePath: codexHome,
            targetProviders: ["claudeAgent"],
          });
          return yield* registry.stopManaging({
            installPath: skillDir,
            workspaceRoot,
            codexHomePath: codexHome,
          });
        }).pipe(Effect.provide(runtimeLayer)),
      );

      const owner = inventory.items.find((item) => item.installPath === skillDir);
      const linked = inventory.items.find((item) => item.installPath === claudeLinkedPath);

      expect(owner?.managedStatus).toBe("unmanaged");
      expect(linked).toBeUndefined();
      expect(await fs.readFile(path.join(skillDir, "SKILL.md"), "utf8")).toContain("Copywriter");
      await expect(fs.stat(claudeLinkedPath)).rejects.toThrow();
    } finally {
      process.env.HOME = originalHome;
      await fs.rm(workspaceRoot, { recursive: true, force: true });
      await fs.rm(stateDir, { recursive: true, force: true });
      await fs.rm(codexHome, { recursive: true, force: true });
      await fs.rm(fakeHome, { recursive: true, force: true });
    }
  });

  it("rejects disabling the fixed owner install", async () => {
    const workspaceRoot = await makeTempDir("t3-skill-workspace-");
    const stateDir = await makeTempDir("t3-skill-state-");
    const codexHome = await makeTempDir("t3-skill-codex-home-");
    const originalHome = process.env.HOME;
    const fakeHome = await makeTempDir("t3-skill-home-");
    process.env.HOME = fakeHome;

    try {
      const skillDir = path.join(codexHome, "skills", "copywriter");
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(
        path.join(skillDir, "SKILL.md"),
        "# Copywriter\n\nWrites sharp product copy.\n",
        "utf8",
      );

      const runtimeLayer = SkillRegistryLive.pipe(
        Layer.provideMerge(
          ServerConfig.layerTest(workspaceRoot, stateDir).pipe(
            Layer.provideMerge(NodeServices.layer),
          ),
        ),
        Layer.provideMerge(AnalyticsService.layerTest),
      );

      await expect(
        Effect.runPromise(
          Effect.gen(function* () {
            const registry = yield* SkillRegistry;
            yield* registry.adopt({
              installPath: skillDir,
              workspaceRoot,
              codexHomePath: codexHome,
              targetProviders: ["claudeAgent"],
            });
            return yield* registry.setEnabled({
              installPath: skillDir,
              enabled: false,
              scope: "current-provider",
              workspaceRoot,
              codexHomePath: codexHome,
            });
          }).pipe(Effect.provide(runtimeLayer)),
        ),
      ).rejects.toThrow("Cannot disable the owner install.");
    } finally {
      process.env.HOME = originalHome;
      await fs.rm(workspaceRoot, { recursive: true, force: true });
      await fs.rm(stateDir, { recursive: true, force: true });
      await fs.rm(codexHome, { recursive: true, force: true });
      await fs.rm(fakeHome, { recursive: true, force: true });
    }
  });
});
