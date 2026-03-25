import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../processRunner.ts", () => ({
  runProcess: vi.fn(),
}));

import { runProcess } from "../processRunner.ts";
import { SKILL_ARCHIVE_MAX_BYTES, type ResolvedSkillSource } from "./shared.ts";
import { installSkillFromResolvedSource } from "./SkillInstaller.ts";

const mockedRunProcess = vi.mocked(runProcess);

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

function listInstallerTempDirs(): Promise<string[]> {
  return fs
    .readdir(os.tmpdir())
    .then((entries) => entries.filter((entry) => entry.startsWith("t3-skill-install-")).sort());
}

function makeResolvedSource(overrides: Partial<ResolvedSkillSource> = {}): ResolvedSkillSource {
  return {
    sourceUrl: "https://skills.sh/openai/codex/frontend-design",
    sourceHost: "skills.sh",
    repoUrl: "https://github.com/openai/codex",
    slug: "frontend-design",
    displayName: "Frontend Design",
    sourceSubpath: "frontend-design",
    defaultBranch: "main",
    commitSha: "commit-sha",
    warnings: [],
    ...overrides,
  };
}

describe("SkillInstaller", () => {
  afterEach(() => {
    mockedRunProcess.mockReset();
    vi.unstubAllGlobals();
  });

  it("installs a resolved skill from an extracted GitHub archive", async () => {
    const installRoot = await makeTempDir("t3-install-target-");
    const installPath = path.join(installRoot, "frontend-design");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("archive-bytes", { status: 200 })),
    );
    mockedRunProcess.mockImplementation(async (_command, args) => {
      const outputDir = args[args.indexOf("-C") + 1];
      if (!outputDir) {
        throw new Error("Missing extraction directory");
      }
      const extractedRoot = path.join(outputDir, "openai-codex-commit");
      const skillRoot = path.join(extractedRoot, "frontend-design");
      await fs.mkdir(skillRoot, { recursive: true });
      await fs.writeFile(path.join(skillRoot, "SKILL.md"), "# Frontend Design\n\npolish\n", "utf8");
      await fs.writeFile(path.join(skillRoot, "notes.txt"), "hello", "utf8");
      return {
        stdout: "",
        stderr: "",
        code: 0,
        signal: null,
        timedOut: false,
      };
    });

    try {
      const result = await installSkillFromResolvedSource({
        source: makeResolvedSource(),
        installPath,
        provider: "codex",
        kind: "skill",
      });

      expect(result.markdown).toContain("# Frontend Design");
      expect(result.manifestHash).toHaveLength(64);
      await expect(fs.readFile(path.join(installPath, "SKILL.md"), "utf8")).resolves.toContain(
        "Frontend Design",
      );
    } finally {
      await fs.rm(installRoot, { recursive: true, force: true });
    }
  });

  it("rejects oversized archive downloads before extraction", async () => {
    const installRoot = await makeTempDir("t3-install-target-");
    const installPath = path.join(installRoot, "frontend-design");

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("archive-bytes", {
            status: 200,
            headers: {
              "content-length": String(SKILL_ARCHIVE_MAX_BYTES + 1),
            },
          }),
      ),
    );

    try {
      await expect(
        installSkillFromResolvedSource({
          source: makeResolvedSource(),
          installPath,
          provider: "codex",
          kind: "skill",
        }),
      ).rejects.toThrow("Skill archive is too large.");
      expect(mockedRunProcess).not.toHaveBeenCalled();
    } finally {
      await fs.rm(installRoot, { recursive: true, force: true });
    }
  });

  it("rejects extracted symlinks and cleans up temp directories", async () => {
    const installRoot = await makeTempDir("t3-install-target-");
    const installPath = path.join(installRoot, "frontend-design");
    const before = await listInstallerTempDirs();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("archive-bytes", { status: 200 })),
    );
    mockedRunProcess.mockImplementation(async (_command, args) => {
      const outputDir = args[args.indexOf("-C") + 1];
      if (!outputDir) {
        throw new Error("Missing extraction directory");
      }
      const extractedRoot = path.join(outputDir, "openai-codex-commit");
      const skillRoot = path.join(extractedRoot, "frontend-design");
      await fs.mkdir(skillRoot, { recursive: true });
      await fs.writeFile(path.join(skillRoot, "SKILL.md"), "# Frontend Design\n", "utf8");
      await fs.symlink("/tmp", path.join(skillRoot, "escape-link"));
      return {
        stdout: "",
        stderr: "",
        code: 0,
        signal: null,
        timedOut: false,
      };
    });

    try {
      await expect(
        installSkillFromResolvedSource({
          source: makeResolvedSource(),
          installPath,
          provider: "codex",
          kind: "skill",
        }),
      ).rejects.toThrow("Archive contains unsupported symlink");
      expect(await listInstallerTempDirs()).toEqual(before);
    } finally {
      await fs.rm(installRoot, { recursive: true, force: true });
    }
  });

  it("requires overwrite before replacing an existing installation", async () => {
    const installRoot = await makeTempDir("t3-install-target-");
    const installPath = path.join(installRoot, "frontend-design");
    await fs.mkdir(installPath, { recursive: true });
    await fs.writeFile(path.join(installPath, "SKILL.md"), "# Existing\n", "utf8");

    try {
      await expect(
        installSkillFromResolvedSource({
          source: makeResolvedSource(),
          installPath,
          provider: "codex",
          kind: "skill",
        }),
      ).rejects.toThrow(`Destination already exists: ${installPath}`);
    } finally {
      await fs.rm(installRoot, { recursive: true, force: true });
    }
  });
});
