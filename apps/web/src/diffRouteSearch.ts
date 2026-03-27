import { TurnId } from "@t3tools/contracts";

export type DiffWorkspaceTab = "changes" | "files" | "editor";
export type DiffWorkspaceFileMode = "preview" | "edit";

export interface DiffRouteSearch {
  diff?: "1" | undefined;
  diffTurnId?: TurnId | undefined;
  diffFilePath?: string | undefined;
  diffTab?: DiffWorkspaceTab | undefined;
  diffFileMode?: DiffWorkspaceFileMode | undefined;
}

function isDiffOpenValue(value: unknown): boolean {
  return value === "1" || value === 1 || value === true;
}

function normalizeSearchString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeDiffTab(value: unknown): DiffWorkspaceTab | undefined {
  return value === "changes" || value === "files" || value === "editor" ? value : undefined;
}

function normalizeDiffFileMode(value: unknown): DiffWorkspaceFileMode | undefined {
  return value === "preview" || value === "edit" ? value : undefined;
}

export function stripDiffSearchParams<T extends Record<string, unknown>>(
  params: T,
): Omit<T, "diff" | "diffTurnId" | "diffFilePath" | "diffTab" | "diffFileMode"> {
  const {
    diff: _diff,
    diffTurnId: _diffTurnId,
    diffFilePath: _diffFilePath,
    diffTab: _diffTab,
    diffFileMode: _diffFileMode,
    ...rest
  } = params;
  return rest as Omit<T, "diff" | "diffTurnId" | "diffFilePath" | "diffTab" | "diffFileMode">;
}

export function parseDiffRouteSearch(search: Record<string, unknown>): DiffRouteSearch {
  const diff = isDiffOpenValue(search.diff) ? "1" : undefined;
  const diffTurnIdRaw = diff ? normalizeSearchString(search.diffTurnId) : undefined;
  const diffTurnId = diffTurnIdRaw ? TurnId.makeUnsafe(diffTurnIdRaw) : undefined;
  const diffFilePath = diff ? normalizeSearchString(search.diffFilePath) : undefined;
  const diffTab = diff ? normalizeDiffTab(search.diffTab) : undefined;
  const diffFileMode = diffFilePath ? normalizeDiffFileMode(search.diffFileMode) : undefined;

  return {
    ...(diff ? { diff } : {}),
    ...(diffTurnId ? { diffTurnId } : {}),
    ...(diffFilePath ? { diffFilePath } : {}),
    ...(diffTab ? { diffTab } : {}),
    ...(diffFileMode ? { diffFileMode } : {}),
  };
}
