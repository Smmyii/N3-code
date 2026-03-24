import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { provenanceFileName, readJsonFile, type SkillProvenanceRecord } from "./shared.ts";

export function makeSkillProvenanceStore(provenanceDir: string) {
  return {
    async read(installPath: string): Promise<SkillProvenanceRecord | null> {
      return readJsonFile<SkillProvenanceRecord>(
        path.join(provenanceDir, provenanceFileName(installPath)),
      );
    },
    async write(record: SkillProvenanceRecord): Promise<void> {
      await mkdir(provenanceDir, { recursive: true });
      await writeFile(
        path.join(provenanceDir, provenanceFileName(record.installPath)),
        JSON.stringify(record, null, 2),
        "utf8",
      );
    },
    async remove(installPath: string): Promise<void> {
      await rm(path.join(provenanceDir, provenanceFileName(installPath)), { force: true });
    },
  };
}
