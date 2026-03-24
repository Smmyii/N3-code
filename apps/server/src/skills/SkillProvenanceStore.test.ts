import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { makeSkillProvenanceStore } from "./SkillProvenanceStore.ts";
import { provenanceFileName } from "./shared.ts";

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("SkillProvenanceStore", () => {
  let provenanceDir: string | null = null;

  afterEach(async () => {
    if (provenanceDir) {
      await fs.rm(provenanceDir, { recursive: true, force: true });
      provenanceDir = null;
    }
  });

  it("writes, reads, and removes provenance records", async () => {
    provenanceDir = await makeTempDir("t3-skill-provenance-");
    const store = makeSkillProvenanceStore(provenanceDir);
    const record = {
      installPath: "/repo/.codex/skills/frontend-design",
      sourceUrl: "https://skills.sh/openai/codex/frontend-design",
      repoUrl: "https://github.com/openai/codex",
      installedSlug: "frontend-design",
      provider: "codex" as const,
      kind: "skill" as const,
      scope: "project" as const,
      installedAt: "2026-03-21T00:00:00.000Z",
      manifestHash: "hash",
    };

    await store.write(record);
    await expect(store.read(record.installPath)).resolves.toEqual(record);

    await store.remove(record.installPath);
    await expect(store.read(record.installPath)).resolves.toBeNull();
  });

  it("fails closed when a provenance file is malformed", async () => {
    provenanceDir = await makeTempDir("t3-skill-provenance-");
    const store = makeSkillProvenanceStore(provenanceDir);
    const installPath = "/repo/.codex/skills/frontend-design";

    await fs.mkdir(provenanceDir, { recursive: true });
    await fs.writeFile(
      path.join(provenanceDir, provenanceFileName(installPath)),
      "{ definitely-not-json",
      "utf8",
    );

    await expect(store.read(installPath)).resolves.toBeNull();
  });
});
