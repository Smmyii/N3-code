import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { SkillKind, SkillProvider, SkillScope } from "@t3tools/contracts";

import { readJsonFile } from "./shared.ts";

export type ManagedSkillTargetRecord = {
  readonly provider: SkillProvider;
  readonly installPath: string;
  readonly role: "owner" | "linked";
  readonly enabled: boolean;
};

export type ManagedSkillRecord = {
  readonly id: string;
  readonly slug: string;
  readonly kind: SkillKind;
  readonly scope: SkillScope;
  readonly displayName: string;
  readonly description?: string;
  readonly sourceUrl?: string;
  readonly repoUrl?: string;
  readonly sourceHost?: string;
  readonly sourceSubpath?: string;
  readonly installedAt?: string;
  readonly resolvedRef?: string;
  readonly resolvedDefaultBranch?: string;
  readonly resolvedCommitSha?: string;
  readonly isAdopted: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly targets: ReadonlyArray<ManagedSkillTargetRecord>;
};

function fileNameFor(id: string): string {
  const trimmed = id.trim();
  if (!/^[A-Za-z0-9_.-]+$/.test(trimmed) || trimmed.includes("..")) {
    throw new Error(`Invalid managed skill id: ${id}`);
  }
  return `${trimmed}.json`;
}

export function makeSkillManagementStore(storeDir: string) {
  return {
    async list(): Promise<ManagedSkillRecord[]> {
      try {
        const entries = await readdir(storeDir, { withFileTypes: true });
        const records = await Promise.all(
          entries
            .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
            .map((entry) =>
              readJsonFile<ManagedSkillRecord>(path.join(storeDir, entry.name)).then(
                (record) => record,
              ),
            ),
        );
        return records.filter((record): record is ManagedSkillRecord => record !== null);
      } catch {
        return [];
      }
    },
    async write(record: ManagedSkillRecord): Promise<void> {
      await mkdir(storeDir, { recursive: true });
      await writeFile(
        path.join(storeDir, fileNameFor(record.id)),
        JSON.stringify(record, null, 2),
        "utf8",
      );
    },
    async remove(id: string): Promise<void> {
      await rm(path.join(storeDir, fileNameFor(id)), { force: true });
    },
  };
}
