# Diff Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current diff panel into a shared in-app workspace with `Changes / Files / Editor` tabs, a focused file viewer/editor for `.md`, `.txt`, and `.env*` files, inline file-link `Open in app` actions, compact turn controls, per-file diff collapse, and reliable save-confirm-refresh behavior.

**Architecture:** Keep `DiffPanel` as the host shell, but extract the panel into smaller workspace units: a compact header, a `Changes` tab, a search-first `Files` tab, and a shared `FocusedFileSurface`. Reuse the existing workspace read/write APIs, workspace search/indexing, and diff query infrastructure instead of inventing a new file-access subsystem. Extend route search state so diff rows, `Files` selections, and inline file links all open the same panel state, while keeping diff-file focus and workspace-file focus separate.

**Non-negotiable foundation before UI extraction:** lock the route model first. `diffTab`, `diffFilePath`, `workspaceFilePath`, `workspaceFileMode`, and cross-thread retained-search behavior must be settled before any panel extraction work starts. All in-app file flows must use one canonical workspace root: `activeThread.worktreePath ?? activeProject.cwd`.

**Tech Stack:** React 19, TanStack Router, TanStack Query, Zustand (existing stores only), Base UI alert dialogs/menus, Vitest, Vitest browser tests, Bun, Effect schema contracts.

---

## Planned File Structure

### Modify

- `apps/web/src/diffRouteSearch.ts`
  Add route-search support for workspace tabs, separate diff/workspace file focus, and retained-search semantics.
- `apps/web/src/diffRouteSearch.test.ts`
  Cover new route parsing behavior.
- `apps/web/src/routes/_chat.$threadId.tsx`
  Retain only safe diff-workspace search params across thread navigation.
- `apps/web/src/lib/projectReactQuery.ts`
  Allow search-first Files tab queries to use empty-string lookups without changing existing path-autocomplete behavior.
- `apps/web/src/components/DiffPanel.tsx`
  Convert from monolithic diff renderer into workspace host shell.
- `apps/web/src/components/ChatMarkdown.tsx`
  Add in-app file action support alongside the current external-open behavior.
- `apps/web/src/components/chat/MessagesTimeline.tsx`
  Thread the in-app file open callback into assistant markdown messages.
- `apps/web/src/components/ChatView.tsx`
  Pass workspace open callbacks into `MessagesTimeline` and centralize route updates.
- `apps/web/src/components/ChatView.browser.tsx`
  Add browser integration coverage for the new workspace flows.
- `apps/web/src/markdown-links.test.ts`
  Add coverage for in-app-eligible markdown paths when line suffixes are present.
- `packages/contracts/src/project.ts`
  Widen `projects.searchEntries` query validation so the Files tab can request empty-query indexed listings and larger result sets.
- `apps/server/src/wsServer.ts`
  Invalidate workspace-entry indexing after direct workspace writes.
- `apps/server/src/wsServer.test.ts`
  Cover empty-query Files tab search behavior and cache invalidation after writes.

### Create

- `apps/web/src/lib/fileWorkspace.ts`
  Shared helpers for editable/viewable file capability checks and path normalization from absolute links to workspace-relative paths.
- `apps/web/src/lib/fileWorkspace.test.ts`
  Unit coverage for eligibility and relative-path normalization.
- `apps/web/src/lib/projectEntryTree.ts`
  Client-side directory tree builder for partial `ProjectEntry[]` result sets.
- `apps/web/src/lib/projectEntryTree.test.ts`
  Unit coverage for nested tree construction and stable ordering.
- `apps/web/src/components/DiffWorkspaceHeader.tsx`
  Compact turn rail + workspace tabs.
- `apps/web/src/components/DiffChangesTab.tsx`
  Diff rendering, collapse state, and `Expand`/`Edit` actions.
- `apps/web/src/components/DiffFilesTab.tsx`
  Search-first files tree/picker using workspace entries.
- `apps/web/src/components/FocusedFileSurface.tsx`
  Shared preview/edit/save-confirm UI used by diff rows, Files tab selections, and chat links.

## Task 1: Lock Diff Workspace Route State and Retained Search Behavior

**Files:**

- Modify: `apps/web/src/diffRouteSearch.ts`
- Test: `apps/web/src/diffRouteSearch.test.ts`
- Modify: `apps/web/src/routes/_chat.$threadId.tsx`

This task is mandatory before any UI extraction. It defines the canonical route semantics for:

- `diffTab`
- `diffFilePath` for `Changes`-tab file focus only
- `workspaceFilePath` for the shared viewer/editor only
- `workspaceFileMode` for file-only editor state
- safe retained-search behavior across thread changes

- [ ] **Step 1: Write the failing route-state tests**

```typescript
import { TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  DIFF_ROUTE_RETAINED_SEARCH_PARAMS,
  parseDiffRouteSearch,
  stripDiffSearchParams,
} from "./diffRouteSearch";

describe("parseDiffRouteSearch", () => {
  it("keeps diff-file focus and workspace editor state separate", () => {
    expect(
      parseDiffRouteSearch({
        diff: "1",
        diffTurnId: "turn-12",
        diffFilePath: "docs/plan.md",
        diffTab: "editor",
        workspaceFilePath: "docs/superpowers/specs/2026-03-26-diff-workspace-design.md",
        workspaceFileMode: "edit",
      }),
    ).toEqual({
      diff: "1",
      diffTurnId: TurnId.makeUnsafe("turn-12"),
      diffFilePath: "docs/plan.md",
      diffTab: "editor",
      workspaceFilePath: "docs/superpowers/specs/2026-03-26-diff-workspace-design.md",
      workspaceFileMode: "edit",
    });
  });

  it("keeps file-only editor state without a selected turn", () => {
    expect(
      parseDiffRouteSearch({
        diff: "1",
        diffTab: "editor",
        workspaceFilePath: "docs/plan.md",
        workspaceFileMode: "preview",
      }),
    ).toEqual({
      diff: "1",
      diffTab: "editor",
      workspaceFilePath: "docs/plan.md",
      workspaceFileMode: "preview",
    });
  });

  it("drops invalid tab and workspace file mode values", () => {
    expect(
      parseDiffRouteSearch({
        diff: "1",
        diffTab: "banana",
        diffFilePath: "docs/plan.md",
        workspaceFilePath: "docs/review.md",
        workspaceFileMode: "sideways",
      }),
    ).toEqual({
      diff: "1",
      diffFilePath: "docs/plan.md",
      workspaceFilePath: "docs/review.md",
    });
  });
});

describe("DIFF_ROUTE_RETAINED_SEARCH_PARAMS", () => {
  it("retains only panel-open and active-tab state across thread navigation", () => {
    expect(DIFF_ROUTE_RETAINED_SEARCH_PARAMS).toEqual(["diff", "diffTab"]);
  });
});

describe("stripDiffSearchParams", () => {
  it("removes all diff workspace params", () => {
    expect(
      stripDiffSearchParams({
        diff: "1",
        diffTurnId: "turn-1",
        diffFilePath: "docs/plan.md",
        diffTab: "editor",
        workspaceFilePath: "docs/review.md",
        workspaceFileMode: "edit",
        keep: "value",
      }),
    ).toEqual({ keep: "value" });
  });
});
```

- [ ] **Step 2: Run the route-state test and verify it fails**

Run: `bun --cwd apps/web x vitest run src/diffRouteSearch.test.ts`
Expected: FAIL with missing `diffTab` / `workspaceFileMode` parsing, no retained-search export, and `stripDiffSearchParams` omissions.

- [ ] **Step 3: Implement the expanded diff workspace search model**

```typescript
import { TurnId } from "@t3tools/contracts";

export type DiffWorkspaceTab = "changes" | "files" | "editor";
export type WorkspaceFileMode = "preview" | "edit";
export const DIFF_ROUTE_RETAINED_SEARCH_PARAMS = ["diff", "diffTab"] as const;

export interface DiffRouteSearch {
  diff?: "1" | undefined;
  diffTurnId?: TurnId | undefined;
  diffFilePath?: string | undefined;
  diffTab?: DiffWorkspaceTab | undefined;
  workspaceFilePath?: string | undefined;
  workspaceFileMode?: WorkspaceFileMode | undefined;
}

function normalizeDiffTab(value: unknown): DiffWorkspaceTab | undefined {
  return value === "changes" || value === "files" || value === "editor" ? value : undefined;
}

function normalizeWorkspaceFileMode(value: unknown): WorkspaceFileMode | undefined {
  return value === "preview" || value === "edit" ? value : undefined;
}

export function stripDiffSearchParams<T extends Record<string, unknown>>(
  params: T,
): Omit<
  T,
  "diff" | "diffTurnId" | "diffFilePath" | "diffTab" | "workspaceFilePath" | "workspaceFileMode"
> {
  const {
    diff: _diff,
    diffTurnId: _diffTurnId,
    diffFilePath: _diffFilePath,
    diffTab: _diffTab,
    workspaceFilePath: _workspaceFilePath,
    workspaceFileMode: _workspaceFileMode,
    ...rest
  } = params;
  return rest as Omit<
    T,
    "diff" | "diffTurnId" | "diffFilePath" | "diffTab" | "workspaceFilePath" | "workspaceFileMode"
  >;
}

export function parseDiffRouteSearch(search: Record<string, unknown>): DiffRouteSearch {
  const diff = isDiffOpenValue(search.diff) ? "1" : undefined;
  const diffTurnIdRaw = diff ? normalizeSearchString(search.diffTurnId) : undefined;
  const diffTurnId = diffTurnIdRaw ? TurnId.makeUnsafe(diffTurnIdRaw) : undefined;
  const diffFilePath = diff ? normalizeSearchString(search.diffFilePath) : undefined;
  const diffTab = diff ? normalizeDiffTab(search.diffTab) : undefined;
  const workspaceFilePath = diff ? normalizeSearchString(search.workspaceFilePath) : undefined;
  const workspaceFileMode = workspaceFilePath
    ? normalizeWorkspaceFileMode(search.workspaceFileMode)
    : undefined;

  return {
    ...(diff ? { diff } : {}),
    ...(diffTurnId ? { diffTurnId } : {}),
    ...(diffFilePath ? { diffFilePath } : {}),
    ...(diffTab ? { diffTab } : {}),
    ...(workspaceFilePath ? { workspaceFilePath } : {}),
    ...(workspaceFileMode ? { workspaceFileMode } : {}),
  };
}
```

- [ ] **Step 4: Update thread-route retained search params**

```typescript
export const Route = createFileRoute("/_chat/$threadId")({
  validateSearch: (search) => parseDiffRouteSearch(search),
  search: {
    middlewares: [retainSearchParams<DiffRouteSearch>(DIFF_ROUTE_RETAINED_SEARCH_PARAMS)],
  },
  component: ChatThreadRouteView,
});
```

- [ ] **Step 5: Run the route-state test and verify it passes**

Run: `bun --cwd apps/web x vitest run src/diffRouteSearch.test.ts`
Expected: PASS

- [ ] **Step 6: Commit the route-state foundation**

```bash
git add apps/web/src/diffRouteSearch.ts apps/web/src/diffRouteSearch.test.ts apps/web/src/routes/_chat.$threadId.tsx
git commit -m "feat(web): extend diff workspace route state"
```

## Task 2: Add Shared File Workspace Helpers and Canonical Root Rules

**Files:**

- Create: `apps/web/src/lib/fileWorkspace.ts`
- Test: `apps/web/src/lib/fileWorkspace.test.ts`

Execution rule for every later task: resolve the in-app workspace root once from `activeThread.worktreePath ?? activeProject.cwd` and use that same root for link normalization, file reads, file writes, and Files-tab queries.

- [ ] **Step 1: Write the failing helper tests**

```typescript
import { describe, expect, it } from "vitest";

import { resolveWorkspaceFileCapabilities, toWorkspaceRelativePath } from "./fileWorkspace";

describe("resolveWorkspaceFileCapabilities", () => {
  it("marks markdown, text, and env files editable", () => {
    expect(resolveWorkspaceFileCapabilities("docs/plan.md").canEdit).toBe(true);
    expect(resolveWorkspaceFileCapabilities("notes/todo.txt").canEdit).toBe(true);
    expect(resolveWorkspaceFileCapabilities(".env.production").canEdit).toBe(true);
  });

  it("marks code files viewable but read-only", () => {
    expect(resolveWorkspaceFileCapabilities("src/app.ts").canPreview).toBe(true);
    expect(resolveWorkspaceFileCapabilities("src/app.ts").canEdit).toBe(false);
  });

  it("blocks binary assets", () => {
    expect(resolveWorkspaceFileCapabilities("static/thumbnail.png")).toEqual({
      canPreview: false,
      canEdit: false,
      previewKind: "unsupported",
    });
  });
});

describe("toWorkspaceRelativePath", () => {
  it("strips line-column suffixes and returns a workspace-relative path", () => {
    expect(toWorkspaceRelativePath("/repo/project", "/repo/project/docs/plan.md:42:7")).toBe(
      "docs/plan.md",
    );
  });

  it("returns null when the target escapes the workspace root", () => {
    expect(toWorkspaceRelativePath("/repo/project", "/repo/other/notes.md")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the helper test and verify it fails**

Run: `bun --cwd apps/web x vitest run src/lib/fileWorkspace.test.ts`
Expected: FAIL with missing module exports.

- [ ] **Step 3: Implement file capability and path normalization helpers**

```typescript
export type WorkspacePreviewKind = "markdown" | "text" | "unsupported";

const EDITABLE_PATH_PATTERNS = [/\.md$/i, /\.txt$/i, /(?:^|\/)\.env(?:\.[^/]+)?$/i];

const TEXT_VIEW_PATH_PATTERNS = [
  /\.md$/i,
  /\.txt$/i,
  /(?:^|\/)\.env(?:\.[^/]+)?$/i,
  /\.(ts|tsx|js|jsx|json|css|html|yml|yaml|toml|ini|sh)$/i,
];

const POSITION_SUFFIX_PATTERN = /:\d+(?::\d+)?$/;

function stripLineColumnSuffix(pathValue: string): string {
  return pathValue.replace(POSITION_SUFFIX_PATTERN, "");
}

function normalizeFsPath(value: string): string {
  return value.replaceAll("\\", "/").replace(/\/+$/, "");
}

export function resolveWorkspaceFileCapabilities(pathValue: string): {
  canPreview: boolean;
  canEdit: boolean;
  previewKind: WorkspacePreviewKind;
} {
  const normalized = stripLineColumnSuffix(pathValue).toLowerCase();
  const isEditable = EDITABLE_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
  if (isEditable) {
    return {
      canPreview: true,
      canEdit: true,
      previewKind: normalized.endsWith(".md") ? "markdown" : "text",
    };
  }
  if (TEXT_VIEW_PATH_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { canPreview: true, canEdit: false, previewKind: "text" };
  }
  return { canPreview: false, canEdit: false, previewKind: "unsupported" };
}

export function toWorkspaceRelativePath(
  workspaceRoot: string,
  absolutePath: string,
): string | null {
  const root = normalizeFsPath(workspaceRoot);
  const target = normalizeFsPath(stripLineColumnSuffix(absolutePath));
  if (target === root) return "";
  if (!target.startsWith(`${root}/`)) return null;
  return target.slice(root.length + 1);
}
```

- [ ] **Step 4: Run the helper test and verify it passes**

Run: `bun --cwd apps/web x vitest run src/lib/fileWorkspace.test.ts`
Expected: PASS

- [ ] **Step 5: Commit the file workspace helpers**

```bash
git add apps/web/src/lib/fileWorkspace.ts apps/web/src/lib/fileWorkspace.test.ts
git commit -m "feat(web): add file workspace helpers"
```

## Task 3: Enable Search-First Files Queries and Build the Partial Tree Model

**Files:**

- Modify: `packages/contracts/src/project.ts`
- Modify: `apps/web/src/lib/projectReactQuery.ts`
- Create: `apps/web/src/lib/projectEntryTree.ts`
- Test: `apps/web/src/lib/projectEntryTree.test.ts`
- Test: `apps/server/src/wsServer.test.ts`

- [ ] **Step 1: Write the failing server contract test for empty-query Files-tab requests**

```typescript
it("supports projects.searchEntries with an empty Files-tab query", async () => {
  const workspace = makeTempDir("t3code-ws-files-tab-");
  fs.mkdirSync(path.join(workspace, "docs"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "docs", "plan.md"), "# plan", "utf8");
  fs.writeFileSync(path.join(workspace, ".env"), "FOO=bar\n", "utf8");
  fs.mkdirSync(path.join(workspace, ".git"), { recursive: true });
  fs.writeFileSync(path.join(workspace, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");

  server = await createTestServer({ cwd: "/test" });
  const addr = server.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : 0;

  const [ws] = await connectAndAwaitWelcome(port);
  connections.push(ws);

  const response = await sendRequest(ws, WS_METHODS.projectsSearchEntries, {
    cwd: workspace,
    query: "",
    limit: 2000,
  });

  expect(response.error).toBeUndefined();
  expect(response.result).toEqual({
    entries: expect.arrayContaining([
      expect.objectContaining({ path: "docs", kind: "directory" }),
      expect.objectContaining({ path: "docs/plan.md", kind: "file" }),
      expect.objectContaining({ path: ".env", kind: "file" }),
    ]),
    truncated: false,
  });
});
```

- [ ] **Step 2: Run the server contract test and verify it fails**

Run: `bun --cwd apps/server x vitest run src/wsServer.test.ts -t "supports projects.searchEntries with an empty Files-tab query"`
Expected: FAIL with request schema validation rejecting the empty query and large limit.

- [ ] **Step 3: Widen the Files-tab query contract and preserve existing autocomplete behavior**

```typescript
// packages/contracts/src/project.ts
import { PositiveInt, TrimmedNonEmptyString, TrimmedString } from "./baseSchemas";

const PROJECT_SEARCH_ENTRIES_MAX_LIMIT = 2000;

export const ProjectSearchEntriesInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  query: TrimmedString.check(Schema.isMaxLength(256)),
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(PROJECT_SEARCH_ENTRIES_MAX_LIMIT)),
});
```

```typescript
// apps/web/src/lib/projectReactQuery.ts
export function projectSearchEntriesQueryOptions(input: {
  cwd: string | null;
  query: string;
  enabled?: boolean;
  allowEmptyQuery?: boolean;
  limit?: number;
  staleTime?: number;
}) {
  const limit = input.limit ?? DEFAULT_SEARCH_ENTRIES_LIMIT;
  const query = input.query;

  return queryOptions({
    queryKey: projectQueryKeys.searchEntries(input.cwd, query, limit),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.cwd) {
        throw new Error("Workspace entry search is unavailable.");
      }
      return api.projects.searchEntries({ cwd: input.cwd, query, limit });
    },
    enabled:
      (input.enabled ?? true) &&
      input.cwd !== null &&
      (input.allowEmptyQuery ? true : query.trim().length > 0),
    staleTime: input.staleTime ?? DEFAULT_SEARCH_ENTRIES_STALE_TIME,
    placeholderData: (previous) => previous ?? EMPTY_SEARCH_ENTRIES_RESULT,
  });
}
```

- [ ] **Step 4: Write the failing tree-construction tests**

```typescript
import { describe, expect, it } from "vitest";

import { buildProjectEntryTree } from "./projectEntryTree";

describe("buildProjectEntryTree", () => {
  it("builds nested directory nodes from flat project entries", () => {
    const tree = buildProjectEntryTree([
      { path: "docs", kind: "directory" },
      { path: "docs/superpowers", kind: "directory", parentPath: "docs" },
      {
        path: "docs/superpowers/spec.md",
        kind: "file",
        parentPath: "docs/superpowers",
      },
      { path: ".env", kind: "file" },
    ]);

    expect(tree.map((node) => node.path)).toEqual([".env", "docs"]);
    expect(tree[1]?.children.map((child) => child.path)).toEqual(["docs/superpowers"]);
  });
});
```

- [ ] **Step 5: Run the tree test and verify it fails**

Run: `bun --cwd apps/web x vitest run src/lib/projectEntryTree.test.ts`
Expected: FAIL with missing module exports.

- [ ] **Step 6: Implement the client-side project entry tree helper**

```typescript
import type { ProjectEntry } from "@t3tools/contracts";

export type ProjectEntryTreeNode =
  | { kind: "directory"; name: string; path: string; children: ProjectEntryTreeNode[] }
  | { kind: "file"; name: string; path: string };

function basenameOf(pathValue: string): string {
  const segments = pathValue.split("/");
  return segments[segments.length - 1] ?? pathValue;
}

export function buildProjectEntryTree(entries: readonly ProjectEntry[]): ProjectEntryTreeNode[] {
  const directoryChildren = new Map<string, ProjectEntryTreeNode[]>();
  for (const entry of entries) {
    const parent = entry.parentPath ?? "";
    const siblings = directoryChildren.get(parent) ?? [];
    siblings.push(
      entry.kind === "directory"
        ? { kind: "directory", name: basenameOf(entry.path), path: entry.path, children: [] }
        : { kind: "file", name: basenameOf(entry.path), path: entry.path },
    );
    directoryChildren.set(parent, siblings);
  }

  const attachChildren = (pathValue: string): ProjectEntryTreeNode[] =>
    (directoryChildren.get(pathValue) ?? [])
      .map((node) =>
        node.kind === "directory" ? { ...node, children: attachChildren(node.path) } : node,
      )
      .toSorted((left, right) => {
        if (left.kind !== right.kind) return left.kind === "file" ? -1 : 1;
        return left.path.localeCompare(right.path);
      });

  return attachChildren("");
}
```

- [ ] **Step 7: Run both Files foundation tests and verify they pass**

Run: `bun --cwd apps/server x vitest run src/wsServer.test.ts -t "supports projects.searchEntries with an empty Files-tab query"`
Expected: PASS

Run: `bun --cwd apps/web x vitest run src/lib/projectEntryTree.test.ts`
Expected: PASS

- [ ] **Step 8: Commit the Files-query foundation**

```bash
git add packages/contracts/src/project.ts apps/web/src/lib/projectReactQuery.ts apps/web/src/lib/projectEntryTree.ts apps/web/src/lib/projectEntryTree.test.ts apps/server/src/wsServer.test.ts
git commit -m "feat(workspace): enable files tab entry queries"
```

## Task 4: Invalidate Workspace Entry Cache on Direct Writes

**Files:**

- Modify: `apps/server/src/wsServer.ts`
- Test: `apps/server/src/wsServer.test.ts`

- [ ] **Step 1: Write the failing server test for search-index invalidation after a write**

```typescript
it("invalidates workspace search entries after projects.writeFile creates a file", async () => {
  const workspace = makeTempDir("t3code-ws-write-cache-");
  fs.mkdirSync(path.join(workspace, ".git"), { recursive: true });
  fs.writeFileSync(path.join(workspace, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");

  server = await createTestServer({ cwd: "/test" });
  const addr = server.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : 0;

  const [ws] = await connectAndAwaitWelcome(port);
  connections.push(ws);

  const beforeWrite = await sendRequest(ws, WS_METHODS.projectsSearchEntries, {
    cwd: workspace,
    query: "draft",
    limit: 50,
  });
  expect(beforeWrite.result).toEqual({ entries: [], truncated: false });

  const writeResponse = await sendRequest(ws, WS_METHODS.projectsWriteFile, {
    cwd: workspace,
    relativePath: "docs/draft.md",
    contents: "# Draft\n",
  });
  expect(writeResponse.error).toBeUndefined();

  const afterWrite = await sendRequest(ws, WS_METHODS.projectsSearchEntries, {
    cwd: workspace,
    query: "draft",
    limit: 50,
  });
  expect(afterWrite.result?.entries).toEqual(
    expect.arrayContaining([expect.objectContaining({ path: "docs/draft.md", kind: "file" })]),
  );
});
```

- [ ] **Step 2: Run the cache-invalidation server test and verify it fails**

Run: `bun --cwd apps/server x vitest run src/wsServer.test.ts -t "invalidates workspace search entries after projects.writeFile creates a file"`
Expected: FAIL because the stale workspace-entry index is reused after `projects.writeFile`.

- [ ] **Step 3: Invalidate the workspace index inside `projects.writeFile`**

```typescript
import { clearWorkspaceIndexCache, searchWorkspaceEntries } from "./workspaceEntries";

case WS_METHODS.projectsWriteFile: {
  const body = stripRequestTag(request.body);
  const target = yield* resolveWorkspaceWritePath({
    workspaceRoot: body.cwd,
    relativePath: body.relativePath,
    path,
  });
  yield* fileSystem.makeDirectory(path.dirname(target.absolutePath), { recursive: true }).pipe(...);
  yield* fileSystem.writeFileString(target.absolutePath, body.contents).pipe(...);
  clearWorkspaceIndexCache(body.cwd);
  return { relativePath: target.relativePath };
}
```

- [ ] **Step 4: Run the cache-invalidation server test and verify it passes**

Run: `bun --cwd apps/server x vitest run src/wsServer.test.ts -t "invalidates workspace search entries after projects.writeFile creates a file"`
Expected: PASS

- [ ] **Step 5: Commit the write-cache invalidation fix**

```bash
git add apps/server/src/wsServer.ts apps/server/src/wsServer.test.ts
git commit -m "fix(server): invalidate workspace index after writes"
```

## Task 5: Refactor DiffPanel into a Workspace Shell and Fix Changes Tab UX

**Files:**

- Create: `apps/web/src/components/DiffWorkspaceHeader.tsx`
- Create: `apps/web/src/components/DiffChangesTab.tsx`
- Modify: `apps/web/src/components/DiffPanel.tsx`
- Test: `apps/web/src/components/ChatView.browser.tsx`

- [ ] **Step 1: Write the failing browser test for the compact header and collapsible changes tab**

```typescript
interface TestFixture {
  snapshot: OrchestrationReadModel;
  serverConfig: ServerConfig;
  welcome: WsWelcomePayload;
  skillsInventory: {
    items: InstalledSkillItem[];
    warnings: string[];
  };
  workspaceEntries: ProjectEntry[];
  checkpointDiffByKey: Record<string, string>;
}

function buildSnapshotWithCheckpoint(): OrchestrationReadModel {
  const snapshot = createSnapshotForTargetUser({
    targetMessageId: "msg-user-diff-workspace" as MessageId,
    targetText: "open the diff workspace",
  });
  const [thread, ...rest] = snapshot.threads;
  if (!thread) return snapshot;
  return {
    ...snapshot,
    threads: [
      {
        ...thread,
        checkpoints: [
          {
            turnId: "turn-12",
            checkpointTurnCount: 12,
            checkpointRef: "checkpoint-12",
            status: "ready",
            assistantMessageId: null,
            completedAt: NOW_ISO,
            files: [
              { path: "docs/plan.md", kind: "modified", additions: 12, deletions: 2 },
              { path: "docs/notes.txt", kind: "modified", additions: 4, deletions: 0 },
              { path: "src/app.ts", kind: "modified", additions: 2, deletions: 1 },
            ],
          },
        ],
      },
      ...rest,
    ],
  };
}

if (tag === ORCHESTRATION_WS_METHODS.getTurnDiff) {
  return {
    diff: fixture.checkpointDiffByKey[`turn:${body.fromTurnCount}:${body.toTurnCount}`] ?? "",
  };
}

if (tag === ORCHESTRATION_WS_METHODS.getFullThreadDiff) {
  return {
    diff: fixture.checkpointDiffByKey[`full:${body.toTurnCount}`] ?? "",
  };
}

it("renders compact turn controls and collapsible changed files in the diff workspace", async () => {
  const mounted = await mountChatView({
    viewport: DEFAULT_VIEWPORT,
    snapshot: buildSnapshotWithCheckpoint(),
    configureFixture: (nextFixture) => {
      nextFixture.checkpointDiffByKey = {
        "turn:11:12": [
          "diff --git a/docs/plan.md b/docs/plan.md",
          "--- a/docs/plan.md",
          "+++ b/docs/plan.md",
          "@@ -1,1 +1,2 @@",
          "-# Implementation plan",
          "+# Implementation plan",
          "+- [ ] collapsed work",
        ].join("\n"),
      };
    },
  });

  try {
    await mounted.router.navigate({
      to: "/$threadId",
      params: { threadId: THREAD_ID },
      search: { diff: "1", diffTurnId: "turn-12" },
    });
    await waitForLayout();

    await expect.element(page.getByRole("tab", { name: "Changes" })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "More turns" })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Collapse all files" })).toBeVisible();

    await page.getByRole("button", { name: "Collapse all files" }).click();
    await expect.element(page.getByText("docs/plan.md")).toBeVisible();
    await expect.element(page.getByText("collapsed work")).not.toBeInTheDocument();
  } finally {
    await mounted.cleanup();
  }
});
```

- [ ] **Step 2: Run the browser test and verify it fails**

Run: `bun --cwd apps/web x vitest run --config vitest.browser.config.ts src/components/ChatView.browser.tsx -t "renders compact turn controls and collapsible changed files in the diff workspace"`
Expected: FAIL with missing tabs, missing compact turn header, and missing collapse controls.

- [ ] **Step 3: Extract the header and changes-tab components**

```tsx
// apps/web/src/components/DiffWorkspaceHeader.tsx
export function DiffWorkspaceHeader(props: {
  activeTab: DiffWorkspaceTab;
  quickTurns: ReadonlyArray<TurnDiffSummary>;
  olderTurns: ReadonlyArray<TurnDiffSummary>;
  hasOlderTurns: boolean;
  onSelectTab: (tab: DiffWorkspaceTab) => void;
  onSelectTurn: (turnId: TurnId | null) => void;
  onStepTurn: (direction: "previous" | "next") => void;
  changesActions?: React.ReactNode;
  filesActions?: React.ReactNode;
  editorActions?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <div className="flex min-w-0 items-center gap-1">
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Previous turn"
          onClick={() => props.onStepTurn("previous")}
        >
          <ChevronLeftIcon className="size-3.5" />
        </Button>
        <Button size="sm" variant="outline" onClick={() => props.onSelectTurn(null)}>
          All turns
        </Button>
        {props.quickTurns.map((turn) => (
          <Button
            key={turn.turnId}
            size="sm"
            variant="outline"
            onClick={() => props.onSelectTurn(turn.turnId)}
          >
            Turn {turn.checkpointTurnCount ?? "?"}
          </Button>
        ))}
        <Menu>
          <MenuTrigger render={<Button size="sm" variant="ghost" aria-label="More turns" />}>
            More
          </MenuTrigger>
          <MenuPopup align="start">
            {props.hasOlderTurns ? (
              props.olderTurns.map((turn) => (
                <MenuItem key={turn.turnId} onClick={() => props.onSelectTurn(turn.turnId)}>
                  Turn {turn.checkpointTurnCount ?? "?"}
                </MenuItem>
              ))
            ) : (
              <MenuItem disabled>No older turns</MenuItem>
            )}
          </MenuPopup>
        </Menu>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Next turn"
          onClick={() => props.onStepTurn("next")}
        >
          <ChevronRightIcon className="size-3.5" />
        </Button>
      </div>
      <Tabs
        value={props.activeTab}
        onValueChange={(value) => props.onSelectTab(value as DiffWorkspaceTab)}
      >
        <TabsList>
          <TabsTrigger value="changes">Changes</TabsTrigger>
          <TabsTrigger value="files">Files</TabsTrigger>
          <TabsTrigger value="editor">Editor</TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}
```

```tsx
// apps/web/src/components/DiffChangesTab.tsx
export function DiffChangesTab(props: {
  renderableFiles: readonly FileDiffMetadata[];
  diffRenderMode: "stacked" | "split";
  diffWordWrap: boolean;
  resolvedTheme: "light" | "dark";
  collapsedFiles: ReadonlySet<string>;
  onToggleFile: (path: string) => void;
  onCollapseAll: () => void;
  onExpandAll: () => void;
  onExpandFile: (path: string) => void;
  onEditFile: (path: string) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between px-2 pb-2">
        <div className="flex items-center gap-2">
          <Button
            size="xs"
            variant="outline"
            onClick={props.onCollapseAll}
            aria-label="Collapse all files"
          >
            Collapse all
          </Button>
          <Button size="xs" variant="outline" onClick={props.onExpandAll}>
            Expand all
          </Button>
        </div>
      </div>
      <Virtualizer className="h-full min-h-0 overflow-auto px-2 pb-2">
        {props.renderableFiles.map((fileDiff) => {
          const filePath = resolveFileDiffPath(fileDiff);
          const collapsed = props.collapsedFiles.has(filePath);
          return (
            <div key={filePath} className="mb-2 rounded-md border border-border/70 bg-card/25">
              <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
                <button
                  type="button"
                  className="flex min-w-0 items-center gap-2 text-left"
                  onClick={() => props.onToggleFile(filePath)}
                >
                  <ChevronRightIcon
                    className={cn("size-3.5 transition-transform", !collapsed && "rotate-90")}
                  />
                  <span className="truncate font-mono text-xs">{filePath}</span>
                </button>
                <div className="flex items-center gap-2">
                  <Button
                    size="xs"
                    variant="outline"
                    aria-label={`Expand ${filePath}`}
                    onClick={() => props.onExpandFile(filePath)}
                  >
                    Expand
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    aria-label={`Edit ${filePath}`}
                    onClick={() => props.onEditFile(filePath)}
                  >
                    Edit
                  </Button>
                </div>
              </div>
              {!collapsed && (
                <div className="overflow-x-auto">
                  <div className="min-w-max">
                    <FileDiff
                      fileDiff={fileDiff}
                      options={{
                        diffStyle: props.diffRenderMode === "split" ? "split" : "unified",
                        lineDiffType: "none",
                        overflow: props.diffWordWrap ? "wrap" : "scroll",
                        theme: resolveDiffThemeName(props.resolvedTheme),
                        themeType: props.resolvedTheme as DiffThemeType,
                        unsafeCSS: DIFF_PANEL_UNSAFE_CSS,
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </Virtualizer>
    </div>
  );
}
```

- [ ] **Step 4: Wire the new workspace shell into `DiffPanel` and rerun the browser test**

Run: `bun --cwd apps/web x vitest run --config vitest.browser.config.ts src/components/ChatView.browser.tsx -t "renders compact turn controls and collapsible changed files in the diff workspace"`
Expected: PASS

- [ ] **Step 5: Commit the workspace shell refactor**

```bash
git add apps/web/src/components/DiffWorkspaceHeader.tsx apps/web/src/components/DiffChangesTab.tsx apps/web/src/components/DiffPanel.tsx apps/web/src/components/ChatView.browser.tsx
git commit -m "feat(web): refactor diff panel into workspace shell"
```

## Task 6: Build the Focused File Surface with Confirmed Saves

**Files:**

- Create: `apps/web/src/components/FocusedFileSurface.tsx`
- Modify: `apps/web/src/components/DiffPanel.tsx`
- Test: `apps/web/src/components/ChatView.browser.tsx`

- [ ] **Step 1: Write the failing browser test for preview, edit, confirm-save, and refresh**

```typescript
interface TestFixture {
  snapshot: OrchestrationReadModel;
  serverConfig: ServerConfig;
  welcome: WsWelcomePayload;
  skillsInventory: {
    items: InstalledSkillItem[];
    warnings: string[];
  };
  workspaceEntries: ProjectEntry[];
  checkpointDiffByKey: Record<string, string>;
  workspaceFilesByPath: Record<string, string>;
}

if (tag === WS_METHODS.projectsReadFile) {
  const relativePath = String(body.relativePath ?? "");
  const contents = fixture.workspaceFilesByPath[relativePath];
  return {
    contents: contents ?? "",
    exists: contents !== undefined,
  };
}

if (tag === WS_METHODS.projectsWriteFile) {
  const relativePath = String(body.relativePath ?? "");
  const contents = String(body.contents ?? "");
  fixture.workspaceFilesByPath[relativePath] = contents;
  return { relativePath };
}

it("opens a markdown file in the focused editor and confirms before saving", async () => {
  const snapshot = createSnapshotForTargetUser({
    targetMessageId: "msg-user-diff-editor" as MessageId,
    targetText: "edit a diff file",
  });
  const [thread, ...rest] = snapshot.threads;
  const mounted = await mountChatView({
    viewport: DEFAULT_VIEWPORT,
    snapshot: thread
      ? {
          ...snapshot,
          threads: [
            {
              ...thread,
              checkpoints: [
                {
                  turnId: "turn-12",
                  checkpointTurnCount: 12,
                  checkpointRef: "checkpoint-12",
                  status: "ready",
                  assistantMessageId: null,
                  completedAt: NOW_ISO,
                  files: [{ path: "docs/plan.md", kind: "modified", additions: 12, deletions: 2 }],
                },
              ],
            },
            ...rest,
          ],
        }
      : snapshot,
    configureFixture: (nextFixture) => {
      nextFixture.checkpointDiffByKey = {
        "turn:11:12": [
          "diff --git a/docs/plan.md b/docs/plan.md",
          "--- a/docs/plan.md",
          "+++ b/docs/plan.md",
          "@@ -1,1 +1,2 @@",
          "-# Plan",
          "+# Plan",
          "+- [ ] original step",
        ].join("\n"),
      };
      nextFixture.workspaceFilesByPath = {
        "docs/plan.md": "# Plan\n\n- [ ] original step\n",
      };
    },
  });

  try {
    await mounted.router.navigate({
      to: "/$threadId",
      params: { threadId: THREAD_ID },
      search: { diff: "1", diffTurnId: "turn-12" },
    });
    await waitForLayout();

    await page.getByRole("button", { name: "Expand docs/plan.md" }).click();
    await expect
      .element(page.getByRole("tab", { name: "Editor" }))
      .toHaveAttribute("data-state", "active");
    await page.getByRole("button", { name: "Edit file" }).click();
    await page
      .getByRole("textbox", { name: "File contents" })
      .fill("# Plan\n\n- [ ] updated step\n");
    await page.getByRole("button", { name: "Save file" }).click();
    await expect.element(page.getByRole("dialog")).toContainText("Write changes to docs/plan.md?");
    await page.getByRole("button", { name: "Confirm save" }).click();
    await expect.element(page.getByText("updated step")).toBeVisible();
  } finally {
    await mounted.cleanup();
  }
});
```

- [ ] **Step 2: Run the browser test and verify it fails**

Run: `bun --cwd apps/web x vitest run --config vitest.browser.config.ts src/components/ChatView.browser.tsx -t "opens a markdown file in the focused editor and confirms before saving"`
Expected: FAIL with missing focused editor surface and save-confirm flow.

- [ ] **Step 3: Implement the focused file surface and save-confirm flow**

```tsx
export function FocusedFileSurface(props: {
  workspaceRoot: string;
  relativePath: string;
  initialMode: WorkspaceFileMode;
  onChangeMode: (mode: WorkspaceFileMode) => void;
  onBackToChanges: () => void;
}) {
  const api = ensureNativeApi();
  const queryClient = useQueryClient();
  const capabilities = resolveWorkspaceFileCapabilities(props.relativePath);
  const [draft, setDraft] = useState("");
  const [savedText, setSavedText] = useState("");
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false);

  const fileQuery = useQuery({
    queryKey: ["workspace-file", props.workspaceRoot, props.relativePath],
    enabled: true,
    queryFn: async () => {
      return api.projects.readFile({ cwd: props.workspaceRoot, relativePath: props.relativePath });
    },
  });

  useEffect(() => {
    if (fileQuery.data?.exists) {
      setDraft(fileQuery.data.contents);
      setSavedText(fileQuery.data.contents);
    }
  }, [fileQuery.data]);

  const dirty = draft !== savedText;

  const confirmSave = async () => {
    await api.projects.writeFile({
      cwd: props.workspaceRoot,
      relativePath: props.relativePath,
      contents: draft,
    });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: providerQueryKeys.all }),
      queryClient.invalidateQueries({ queryKey: projectQueryKeys.all }),
      queryClient.invalidateQueries({
        queryKey: ["workspace-file", props.workspaceRoot, props.relativePath],
      }),
    ]);
    const refreshed = await api.projects.readFile({
      cwd: props.workspaceRoot,
      relativePath: props.relativePath,
    });
    setDraft(refreshed.contents);
    setSavedText(refreshed.contents);
    setSaveConfirmOpen(false);
    props.onChangeMode("preview");
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border/70 px-3 py-2">
        <Button size="xs" variant="ghost" onClick={props.onBackToChanges}>
          Back to diffs
        </Button>
        <div className="flex items-center gap-2">
          {capabilities.canEdit && props.initialMode === "preview" && (
            <Button size="xs" variant="outline" onClick={() => props.onChangeMode("edit")}>
              Edit file
            </Button>
          )}
          {capabilities.canEdit && props.initialMode === "edit" && (
            <Button
              size="xs"
              variant="default"
              onClick={() => setSaveConfirmOpen(true)}
              disabled={!dirty}
            >
              Save file
            </Button>
          )}
        </div>
      </div>
      {props.initialMode === "edit" ? (
        <Textarea
          aria-label="File contents"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="min-h-0 flex-1 rounded-none border-0 font-mono text-sm"
        />
      ) : (
        <pre className="min-h-0 flex-1 overflow-auto p-4 font-mono text-sm">{draft}</pre>
      )}
      <AlertDialog open={saveConfirmOpen} onOpenChange={setSaveConfirmOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Write changes to {props.relativePath}?</AlertDialogTitle>
            <AlertDialogDescription>
              The file will be updated inside the active workspace and the diff view will refresh.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button onClick={() => void confirmSave()}>Confirm save</Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}
```

- [ ] **Step 4: Run the focused-editor browser test and verify it passes**

Run: `bun --cwd apps/web x vitest run --config vitest.browser.config.ts src/components/ChatView.browser.tsx -t "opens a markdown file in the focused editor and confirms before saving"`
Expected: PASS

- [ ] **Step 5: Commit the focused file surface**

```bash
git add apps/web/src/components/FocusedFileSurface.tsx apps/web/src/components/DiffPanel.tsx apps/web/src/components/ChatView.browser.tsx
git commit -m "feat(web): add focused file surface"
```

## Task 7: Add the Search-First Files Tab

**Files:**

- Create: `apps/web/src/components/DiffFilesTab.tsx`
- Modify: `apps/web/src/components/DiffPanel.tsx`
- Test: `apps/web/src/components/ChatView.browser.tsx`

- [ ] **Step 1: Write the failing browser test for the `Files` tab**

```typescript
it("opens workspace files from the search-first Files tab", async () => {
  const snapshot = createSnapshotForTargetUser({
    targetMessageId: "msg-user-files-tab" as MessageId,
    targetText: "open files tab",
  });
  const [thread, ...rest] = snapshot.threads;
  const mounted = await mountChatView({
    viewport: DEFAULT_VIEWPORT,
    snapshot: thread
      ? {
          ...snapshot,
          threads: [
            {
              ...thread,
              checkpoints: [
                {
                  turnId: "turn-12",
                  checkpointTurnCount: 12,
                  checkpointRef: "checkpoint-12",
                  status: "ready",
                  assistantMessageId: null,
                  completedAt: NOW_ISO,
                  files: [{ path: "docs/plan.md", kind: "modified", additions: 12, deletions: 2 }],
                },
              ],
            },
            ...rest,
          ],
        }
      : snapshot,
    configureFixture: (nextFixture) => {
      nextFixture.workspaceEntries = [
        { path: "docs", kind: "directory" },
        { path: "docs/plan.md", kind: "file", parentPath: "docs" },
        { path: ".env", kind: "file" },
      ];
      nextFixture.workspaceFilesByPath = {
        "docs/plan.md": "# Plan\n\n- [ ] from files tab\n",
      };
    },
  });

  try {
    await mounted.router.navigate({
      to: "/$threadId",
      params: { threadId: THREAD_ID },
      search: { diff: "1", diffTab: "files" },
    });
    await waitForLayout();

    await page.getByRole("tab", { name: "Files" }).click();
    await expect.element(page.getByRole("textbox", { name: "Filter files" })).toBeVisible();
    await page.getByRole("button", { name: "docs/plan.md" }).click();
    await expect
      .element(page.getByRole("tab", { name: "Editor" }))
      .toHaveAttribute("data-state", "active");
    await expect.element(page.getByText("# Plan")).toBeVisible();
  } finally {
    await mounted.cleanup();
  }
});
```

- [ ] **Step 2: Run the Files-tab browser test and verify it fails**

Run: `bun --cwd apps/web x vitest run --config vitest.browser.config.ts src/components/ChatView.browser.tsx -t "opens workspace files from the search-first Files tab"`
Expected: FAIL with missing `Files` tab content.

- [ ] **Step 3: Implement the search-first Files tab**

```tsx
export function DiffFilesTab(props: {
  workspaceRoot: string | null;
  onOpenFile: (relativePath: string) => void;
}) {
  const [query, setQuery] = useState("");
  const entriesQuery = useQuery(
    projectSearchEntriesQueryOptions({
      cwd: props.workspaceRoot,
      query,
      allowEmptyQuery: true,
      limit: 2000,
      staleTime: 30_000,
    }),
  );
  const tree = useMemo(
    () => buildProjectEntryTree(entriesQuery.data?.entries ?? []),
    [entriesQuery.data?.entries],
  );
  const renderNode = (node: ProjectEntryTreeNode, depth: number): React.ReactNode => {
    const paddingLeft = 8 + depth * 14;
    if (node.kind === "directory") {
      return (
        <div key={node.path}>
          <div
            className="px-2 py-1 text-[11px] font-medium text-muted-foreground"
            style={{ paddingLeft }}
          >
            {node.name}
          </div>
          {node.children.map((child) => renderNode(child, depth + 1))}
        </div>
      );
    }
    return (
      <button
        key={node.path}
        type="button"
        className="flex w-full items-center rounded-md px-2 py-1 text-left text-xs hover:bg-accent"
        style={{ paddingLeft }}
        aria-label={node.path}
        onClick={() => props.onOpenFile(node.path)}
      >
        {node.path}
      </button>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border/70 px-3 py-2">
        <Input
          aria-label="Filter files"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter files"
        />
      </div>
      {entriesQuery.data?.truncated ? (
        <div className="border-b border-border/70 px-3 py-2 text-xs text-muted-foreground">
          Showing partial indexed results. Refine the filter for a narrower file set.
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
        {tree.map((node) => renderNode(node, 0))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the Files-tab browser test and verify it passes**

Run: `bun --cwd apps/web x vitest run --config vitest.browser.config.ts src/components/ChatView.browser.tsx -t "opens workspace files from the search-first Files tab"`
Expected: PASS

- [ ] **Step 5: Commit the Files-tab UI**

```bash
git add apps/web/src/components/DiffFilesTab.tsx apps/web/src/components/DiffPanel.tsx apps/web/src/components/ChatView.browser.tsx
git commit -m "feat(web): add diff workspace files tab"
```

## Task 8: Add Inline File-Link `Open in App` Actions

**Files:**

- Modify: `apps/web/src/components/ChatMarkdown.tsx`
- Modify: `apps/web/src/components/chat/MessagesTimeline.tsx`
- Modify: `apps/web/src/components/ChatView.tsx`
- Test: `apps/web/src/components/ChatView.browser.tsx`
- Test: `apps/web/src/markdown-links.test.ts`

- [ ] **Step 1: Add the failing markdown-link unit test for line-suffixed workspace links**

```typescript
it("preserves workspace file links with line suffixes for in-app routing", () => {
  expect(resolveMarkdownFileLinkTarget("docs/plan.md#L12", "/repo/project")).toBe(
    "/repo/project/docs/plan.md:12",
  );
});
```

- [ ] **Step 2: Add the failing browser test for the in-app link action**

```typescript
it("opens assistant file links in the diff workspace without replacing external open", async () => {
  const snapshot = createSnapshotForTargetUser({
    targetMessageId: "msg-user-inline-open" as MessageId,
    targetText: "open inline file links",
  });
  const [thread, ...rest] = snapshot.threads;
  const mounted = await mountChatView({
    viewport: DEFAULT_VIEWPORT,
    snapshot: {
      ...snapshot,
      threads: thread
        ? [
            {
              ...thread,
              messages: [
                ...thread.messages,
                createAssistantMessage({
                  id: "msg-assistant-inline-open" as MessageId,
                  text: "The review is saved to [review-round-1.md](/repo/project/review-round-1.md).",
                  offsetSeconds: 999,
                }),
              ],
            },
            ...rest,
          ]
        : snapshot.threads,
    },
    configureFixture: (nextFixture) => {
      nextFixture.workspaceFilesByPath = {
        "review-round-1.md": "# Review\n\n10 critical and 6 minor issues.\n",
      };
    },
  });

  try {
    await page.getByRole("button", { name: "Open review-round-1.md in app" }).click();
    await expect
      .element(page.getByRole("tab", { name: "Editor" }))
      .toHaveAttribute("data-state", "active");
    await expect.element(page.getByText("10 critical and 6 minor issues.")).toBeVisible();
  } finally {
    await mounted.cleanup();
  }
});
```

- [ ] **Step 3: Run the unit and browser tests and verify they fail**

Run: `bun --cwd apps/web x vitest run src/markdown-links.test.ts`
Expected: PASS for path resolution, but no in-app UI exists yet.

Run: `bun --cwd apps/web x vitest run --config vitest.browser.config.ts src/components/ChatView.browser.tsx -t "opens assistant file links in the diff workspace without replacing external open"`
Expected: FAIL with missing in-app link action.

- [ ] **Step 4: Thread an in-app open callback from `ChatView` into `ChatMarkdown`**

```tsx
// apps/web/src/components/ChatMarkdown.tsx
interface ChatMarkdownProps {
  text: string;
  cwd: string | undefined;
  isStreaming?: boolean;
  onOpenWorkspaceFile?: ((absolutePath: string) => void) | undefined;
}

function ChatMarkdown({ text, cwd, isStreaming = false, onOpenWorkspaceFile }: ChatMarkdownProps) {
  const markdownComponents = useMemo<Components>(
    () => ({
      a({ node: _node, href, children, ...props }) {
        const targetPath = resolveMarkdownFileLinkTarget(href, cwd);
        if (!targetPath) {
          return <a {...props} href={href} target="_blank" rel="noreferrer" />;
        }

        return (
          <span className="inline-flex items-center gap-1">
            <a
              {...props}
              href={href}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const api = readNativeApi();
                if (api) {
                  void openInPreferredEditor(api, targetPath);
                }
              }}
            >
              {children}
            </a>
            {onOpenWorkspaceFile ? (
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label={`Open ${nodeToPlainText(children)} in app`}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onOpenWorkspaceFile(targetPath);
                }}
              >
                <PanelRightOpenIcon className="size-3" />
              </Button>
            ) : null}
          </span>
        );
      },
    }),
    [cwd, diffThemeName, isStreaming, onOpenWorkspaceFile],
  );
}
```

```tsx
// apps/web/src/components/ChatView.tsx
const workspaceRoot = activeThread.worktreePath ?? activeProject.cwd;

const onOpenWorkspaceFile = useCallback(
  (absolutePath: string) => {
    const relativePath = toWorkspaceRelativePath(workspaceRoot, absolutePath);
    if (!relativePath) {
      return;
    }
    void navigate({
      to: "/$threadId",
      params: { threadId: activeThread.id },
      search: (previous) => {
        const rest = stripDiffSearchParams(previous);
        return {
          ...rest,
          diff: "1",
          diffTab: "editor",
          workspaceFilePath: relativePath,
          workspaceFileMode: "preview",
        };
      },
    });
  },
  [activeThread.id, navigate, workspaceRoot],
);
```

- [ ] **Step 5: Run the browser test and verify it passes**

Run: `bun --cwd apps/web x vitest run --config vitest.browser.config.ts src/components/ChatView.browser.tsx -t "opens assistant file links in the diff workspace without replacing external open"`
Expected: PASS

- [ ] **Step 6: Commit the inline file-link action**

```bash
git add apps/web/src/components/ChatMarkdown.tsx apps/web/src/components/chat/MessagesTimeline.tsx apps/web/src/components/ChatView.tsx apps/web/src/components/ChatView.browser.tsx apps/web/src/markdown-links.test.ts
git commit -m "feat(web): add open-in-app file link action"
```

## Task 9: Final Verification

**Files:**

- Verify: `apps/web/src/diffRouteSearch.test.ts`
- Verify: `apps/web/src/lib/fileWorkspace.test.ts`
- Verify: `apps/web/src/lib/projectEntryTree.test.ts`
- Verify: `apps/server/src/wsServer.test.ts`
- Verify: `apps/web/src/components/ChatView.browser.tsx`
- Verify: repository build

- [ ] **Step 1: Run focused web unit tests**

Run: `bun --cwd apps/web x vitest run src/diffRouteSearch.test.ts src/lib/fileWorkspace.test.ts src/lib/projectEntryTree.test.ts src/markdown-links.test.ts`
Expected: PASS

- [ ] **Step 2: Run the focused server test**

Run: `bun --cwd apps/server x vitest run src/wsServer.test.ts -t "projects.searchEntries"`
Expected: PASS

- [ ] **Step 3: Run the diff workspace browser tests**

Run: `bun --cwd apps/web x vitest run --config vitest.browser.config.ts src/components/ChatView.browser.tsx -t "diff workspace|focused editor|search-first Files tab|assistant file links"`
Expected: PASS

- [ ] **Step 4: Run package-level tests**

Run: `bun --cwd apps/web test`
Expected: PASS

Run: `bun --cwd apps/server test`
Expected: PASS

- [ ] **Step 5: Run the full build**

Run: `bun run build`
Expected: PASS with all workspace build tasks succeeding.

- [ ] **Step 6: Commit the verified implementation**

```bash
git add apps/web/src packages/contracts/src/project.ts apps/server/src/wsServer.test.ts
git commit -m "feat(web): add diff workspace"
```
