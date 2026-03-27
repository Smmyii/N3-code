# Sidebar Thread Organization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add project-local nested sidebar folders, subtle folder/thread color accents, and single-item drag/drop organization that persists locally by project `cwd`.

**Architecture:** Keep the existing server-backed `projects`/`threads` read model in the main app store and layer a separate client-only Zustand store on top for sidebar-only organization metadata. Put all folder placement, promotion, ordering, and color inheritance rules in a pure helper module, then have [Sidebar.tsx](/home/sammy/Documents/T3-code/t3code/apps/web/src/components/Sidebar.tsx) swap its flat per-project thread list for a mixed folder/thread tree rendered by focused child components.

**Tech Stack:** React 19, Zustand, `@dnd-kit/core`, `@dnd-kit/sortable`, TanStack Router, Vitest, Vitest Browser, `localStorage`

---

## File Structure

- Create: `apps/web/src/components/Sidebar.organization.ts`
  Pure sidebar-organization types and helpers: normalization, derivation, folder deletion promotion, move rules, drag/drop target parsing, color inheritance.

- Create: `apps/web/src/components/Sidebar.organization.test.ts`
  Unit coverage for pure organization behavior.

- Create: `apps/web/src/sidebarOrganizationStore.ts`
  Client-only persisted Zustand store keyed by project `cwd`, with folder/thread actions and debounced `localStorage` persistence.

- Create: `apps/web/src/sidebarOrganizationStore.test.ts`
  Unit coverage for persistence, lazy project hydration, and store actions.

- Create: `apps/web/src/components/SidebarFolderRow.tsx`
  Folder row UI with subtle section styling, inline rename input, expand/collapse affordance, and folder-only drag/drop affordances.

- Create: `apps/web/src/components/SidebarThreadRow.tsx`
  Thread row UI that preserves current status/selection behavior while adding subtle inherited/custom/no-color accents.

- Create: `apps/web/src/components/SidebarOrganizationTree.tsx`
  Recursive mixed tree renderer for one project, with stable `data-testid` hooks for browser coverage.

- Create: `apps/web/src/components/SidebarOrganizationTree.test.tsx`
  Static/render tests for folder/thread accent rendering, nesting, and rename presentation.

- Modify: `apps/web/src/components/Sidebar.tsx`
  Replace the flat `visibleThreads` block with the mixed organization tree, wire project/folder/thread context menus, integrate the organization store, and add per-project nested drag/drop.

- Modify: `apps/web/src/components/ChatView.browser.tsx`
  Add browser integration tests for folder creation, nested subfolders, inline rename, delete-folder promotion, drag/drop, and subtle color rendering in the actual shell.

## Shared Decisions To Honor During Implementation

- Key all organization data by `project.cwd`, not project ID.
- Do not delete project organization records when projects disappear from the current read model; keep them for remove/re-add flows.
- New unseen threads must appear at the top of project root order.
- Do not introduce an `Ungrouped` bucket.
- Treat root folders and root threads as reorderable peers.
- Folder color is visible but subtle. Thread color is much fainter and defaults to `inherit`.
- Context menu API is flat only, so `Set color` must open a second flat palette menu instead of a nested native submenu.
- The current `THREAD_PREVIEW_LIMIT`/`Show more` behavior should be removed for organized project trees; project collapse is the coarse density control now.

### Task 1: Pure Sidebar Organization Model

**Files:**

- Create: `apps/web/src/components/Sidebar.organization.ts`
- Test: `apps/web/src/components/Sidebar.organization.test.ts`

- [ ] **Step 1: Write the failing pure-logic tests**

```ts
import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  createEmptySidebarProjectOrganization,
  deleteFolderAndPromoteChildren,
  deriveSidebarNodes,
  moveSidebarNode,
  normalizeSidebarProjectOrganization,
  resolveThreadAccentColor,
  type SidebarProjectOrganization,
} from "./Sidebar.organization";

const THREAD_A = ThreadId.makeUnsafe("thread-a");
const THREAD_B = ThreadId.makeUnsafe("thread-b");
const THREAD_C = ThreadId.makeUnsafe("thread-c");

function makeOrganization(): SidebarProjectOrganization {
  return createEmptySidebarProjectOrganization();
}

describe("normalizeSidebarProjectOrganization", () => {
  it("adds unseen threads to the top of root order", () => {
    const organization = makeOrganization();
    organization.rootOrder = [{ kind: "thread", id: THREAD_C }];

    const next = normalizeSidebarProjectOrganization({
      organization,
      orderedThreadIds: [THREAD_A, THREAD_B, THREAD_C],
    });

    expect(next.rootOrder).toEqual([
      { kind: "thread", id: THREAD_A },
      { kind: "thread", id: THREAD_B },
      { kind: "thread", id: THREAD_C },
    ]);
  });

  it("prunes dead thread references and thread color metadata", () => {
    const organization = makeOrganization();
    organization.rootOrder = [{ kind: "thread", id: THREAD_A }];
    organization.threadMetaById[THREAD_A] = { colorMode: "custom", color: "emerald" };

    const next = normalizeSidebarProjectOrganization({
      organization,
      orderedThreadIds: [],
    });

    expect(next.rootOrder).toEqual([]);
    expect(next.threadMetaById[THREAD_A]).toBeUndefined();
  });
});

describe("deleteFolderAndPromoteChildren", () => {
  it("promotes children into the deleted folder's parent at the same position", () => {
    const organization = makeOrganization();
    organization.rootOrder = [
      { kind: "thread", id: THREAD_A },
      { kind: "folder", id: "folder-1" },
      { kind: "thread", id: THREAD_C },
    ];
    organization.foldersById["folder-1"] = {
      id: "folder-1",
      parentFolderId: null,
      name: "Docs",
      color: "teal",
      childOrder: [{ kind: "thread", id: THREAD_B }],
    };

    const next = deleteFolderAndPromoteChildren(organization, "folder-1");
    expect(next.rootOrder).toEqual([
      { kind: "thread", id: THREAD_A },
      { kind: "thread", id: THREAD_B },
      { kind: "thread", id: THREAD_C },
    ]);
  });
});

describe("moveSidebarNode", () => {
  it("moves a root thread inside a folder", () => {
    const organization = makeOrganization();
    organization.rootOrder = [
      { kind: "thread", id: THREAD_A },
      { kind: "folder", id: "folder-1" },
    ];
    organization.foldersById["folder-1"] = {
      id: "folder-1",
      parentFolderId: null,
      name: "Inbox",
      color: null,
      childOrder: [],
    };

    const next = moveSidebarNode(organization, {
      node: { kind: "thread", id: THREAD_A },
      target: { type: "inside-folder", folderId: "folder-1" },
    });

    expect(next.rootOrder).toEqual([{ kind: "folder", id: "folder-1" }]);
    expect(next.foldersById["folder-1"]?.childOrder).toEqual([{ kind: "thread", id: THREAD_A }]);
  });
});

describe("resolveThreadAccentColor", () => {
  it("prefers explicit thread color, then none, then inherited folder color", () => {
    expect(resolveThreadAccentColor({ threadMeta: { colorMode: "custom", color: "rose" } })).toBe(
      "rose",
    );
    expect(resolveThreadAccentColor({ threadMeta: { colorMode: "none", color: null } })).toBe(null);
    expect(
      resolveThreadAccentColor({
        threadMeta: { colorMode: "inherit", color: null },
        inheritedFolderColor: "amber",
      }),
    ).toBe("amber");
  });
});

describe("deriveSidebarNodes", () => {
  it("keeps empty folders visible after derivation", () => {
    const organization = makeOrganization();
    organization.rootOrder = [{ kind: "folder", id: "folder-empty" }];
    organization.foldersById["folder-empty"] = {
      id: "folder-empty",
      parentFolderId: null,
      name: "Plans",
      color: "blue",
      childOrder: [],
    };

    const nodes = deriveSidebarNodes({
      orderedThreads: [],
      organization,
    });

    expect(nodes[0]).toMatchObject({ kind: "folder", folderId: "folder-empty", name: "Plans" });
  });
});
```

Run: `bun --cwd /home/sammy/Documents/T3-code/t3code/apps/web run test -- src/components/Sidebar.organization.test.ts`

Expected: FAIL with module-not-found / missing-export errors.

- [ ] **Step 2: Add organization types and normalization helpers**

```ts
import type { ThreadId } from "@t3tools/contracts";
import type { Thread } from "../types";

export type SidebarColor = "slate" | "blue" | "teal" | "emerald" | "amber" | "rose" | "violet";

export type SidebarThreadColorMode = "inherit" | "custom" | "none";

export type SidebarNodeRef = { kind: "folder"; id: string } | { kind: "thread"; id: ThreadId };

export interface SidebarFolder {
  id: string;
  parentFolderId: string | null;
  name: string;
  color: SidebarColor | null;
  childOrder: SidebarNodeRef[];
}

export interface SidebarThreadMeta {
  colorMode: SidebarThreadColorMode;
  color: SidebarColor | null;
}

export interface SidebarProjectOrganization {
  rootOrder: SidebarNodeRef[];
  foldersById: Record<string, SidebarFolder>;
  threadMetaById: Record<ThreadId, SidebarThreadMeta>;
  expandedFolderIds: string[];
}

export function createEmptySidebarProjectOrganization(): SidebarProjectOrganization {
  return {
    rootOrder: [],
    foldersById: {},
    threadMetaById: {},
    expandedFolderIds: [],
  };
}

export function normalizeSidebarProjectOrganization(input: {
  organization: SidebarProjectOrganization;
  orderedThreadIds: readonly ThreadId[];
}): SidebarProjectOrganization {
  const liveThreadIds = new Set(input.orderedThreadIds);
  const next: SidebarProjectOrganization = {
    rootOrder: [],
    foldersById: {},
    threadMetaById: {},
    expandedFolderIds: input.organization.expandedFolderIds.filter(
      (folderId) => input.organization.foldersById[folderId] !== undefined,
    ),
  };

  for (const [folderId, folder] of Object.entries(input.organization.foldersById)) {
    next.foldersById[folderId] = {
      ...folder,
      childOrder: folder.childOrder.filter(
        (node) => node.kind === "folder" || liveThreadIds.has(node.id),
      ),
    };
  }

  for (const node of input.organization.rootOrder) {
    if (node.kind === "folder" || liveThreadIds.has(node.id)) {
      next.rootOrder.push(node);
    }
  }

  for (const threadId of input.orderedThreadIds.toReversed()) {
    const alreadyPlaced =
      next.rootOrder.some((node) => node.kind === "thread" && node.id === threadId) ||
      Object.values(next.foldersById).some((folder) =>
        folder.childOrder.some((node) => node.kind === "thread" && node.id === threadId),
      );
    if (!alreadyPlaced) {
      next.rootOrder.unshift({ kind: "thread", id: threadId });
    }
  }

  for (const [threadId, meta] of Object.entries(input.organization.threadMetaById)) {
    if (liveThreadIds.has(threadId as ThreadId)) {
      next.threadMetaById[threadId as ThreadId] = meta;
    }
  }

  return next;
}
```

- [ ] **Step 3: Add derivation, delete-promotion, move, and accent helpers**

```ts
export interface SidebarDerivedFolderNode {
  kind: "folder";
  folderId: string;
  name: string;
  depth: number;
  color: SidebarColor | null;
  parentFolderId: string | null;
  children: SidebarDerivedNode[];
}

export interface SidebarDerivedThreadNode {
  kind: "thread";
  thread: Thread;
  depth: number;
  parentFolderId: string | null;
  effectiveColor: SidebarColor | null;
  colorMode: SidebarThreadColorMode;
}

export type SidebarDerivedNode = SidebarDerivedFolderNode | SidebarDerivedThreadNode;

export type SidebarDropTarget =
  | { type: "root-start" }
  | { type: "root-before"; before: SidebarNodeRef | null }
  | { type: "folder-before"; folderId: string; before: SidebarNodeRef | null }
  | { type: "inside-folder"; folderId: string };

export function deleteFolderAndPromoteChildren(
  organization: SidebarProjectOrganization,
  folderId: string,
): SidebarProjectOrganization {
  const folder = organization.foldersById[folderId];
  if (!folder) return organization;

  const parentOrder =
    folder.parentFolderId === null
      ? organization.rootOrder
      : (organization.foldersById[folder.parentFolderId]?.childOrder ?? []);
  const folderIndex = parentOrder.findIndex(
    (node) => node.kind === "folder" && node.id === folderId,
  );
  const promoted = folder.childOrder;
  const nextParentOrder = parentOrder.flatMap((node, index) =>
    index === folderIndex ? promoted : [node],
  );

  const nextFoldersById = { ...organization.foldersById };
  delete nextFoldersById[folderId];
  for (const child of promoted) {
    if (child.kind === "folder") {
      nextFoldersById[child.id] = {
        ...nextFoldersById[child.id],
        parentFolderId: folder.parentFolderId,
      };
    }
  }

  return {
    ...organization,
    rootOrder: folder.parentFolderId === null ? nextParentOrder : organization.rootOrder,
    foldersById: nextFoldersById,
    expandedFolderIds: organization.expandedFolderIds.filter((id) => id !== folderId),
  };
}

export function resolveThreadAccentColor(input: {
  threadMeta?: SidebarThreadMeta;
  inheritedFolderColor?: SidebarColor | null;
}): SidebarColor | null {
  if (input.threadMeta?.colorMode === "custom") return input.threadMeta.color;
  if (input.threadMeta?.colorMode === "none") return null;
  return input.inheritedFolderColor ?? null;
}
```

```ts
export function deriveSidebarNodes(input: {
  orderedThreads: readonly Thread[];
  organization: SidebarProjectOrganization;
}): SidebarDerivedNode[] {
  const threadById = new Map(input.orderedThreads.map((thread) => [thread.id, thread] as const));

  const visit = (
    order: readonly SidebarNodeRef[],
    depth: number,
    parentFolderId: string | null,
    inheritedFolderColor: SidebarColor | null,
  ): SidebarDerivedNode[] =>
    order.flatMap((node) => {
      if (node.kind === "thread") {
        const thread = threadById.get(node.id);
        if (!thread) return [];
        const threadMeta = input.organization.threadMetaById[node.id];
        return [
          {
            kind: "thread",
            thread,
            depth,
            parentFolderId,
            effectiveColor: resolveThreadAccentColor({ threadMeta, inheritedFolderColor }),
            colorMode: threadMeta?.colorMode ?? "inherit",
          },
        ];
      }

      const folder = input.organization.foldersById[node.id];
      if (!folder) return [];
      return [
        {
          kind: "folder",
          folderId: folder.id,
          name: folder.name,
          depth,
          color: folder.color,
          parentFolderId,
          children: visit(
            folder.childOrder,
            depth + 1,
            folder.id,
            folder.color ?? inheritedFolderColor,
          ),
        },
      ];
    });

  return visit(input.organization.rootOrder, 0, null, null);
}
```

- [ ] **Step 4: Add `moveSidebarNode` with stable root/folder ordering semantics**

```ts
function removeNode(order: readonly SidebarNodeRef[], node: SidebarNodeRef): SidebarNodeRef[] {
  return order.filter((entry) => !(entry.kind === node.kind && entry.id === node.id));
}

function insertNodeBefore(
  order: readonly SidebarNodeRef[],
  before: SidebarNodeRef | null,
  node: SidebarNodeRef,
): SidebarNodeRef[] {
  if (!before) return [node, ...order];
  const index = order.findIndex((entry) => entry.kind === before.kind && entry.id === before.id);
  if (index === -1) return [...order, node];
  return [...order.slice(0, index), node, ...order.slice(index)];
}

export function moveSidebarNode(
  organization: SidebarProjectOrganization,
  input: { node: SidebarNodeRef; target: SidebarDropTarget },
): SidebarProjectOrganization {
  const next: SidebarProjectOrganization = {
    ...organization,
    rootOrder: [...organization.rootOrder],
    foldersById: Object.fromEntries(
      Object.entries(organization.foldersById).map(([id, folder]) => [
        id,
        { ...folder, childOrder: [...folder.childOrder] },
      ]),
    ),
  };

  next.rootOrder = removeNode(next.rootOrder, input.node);
  for (const folder of Object.values(next.foldersById)) {
    folder.childOrder = removeNode(folder.childOrder, input.node);
  }

  if (input.target.type === "root-start") {
    next.rootOrder = [input.node, ...next.rootOrder];
  } else if (input.target.type === "root-before") {
    next.rootOrder = insertNodeBefore(next.rootOrder, input.target.before, input.node);
  } else if (input.target.type === "folder-before") {
    const folder = next.foldersById[input.target.folderId];
    if (!folder) return organization;
    folder.childOrder = insertNodeBefore(folder.childOrder, input.target.before, input.node);
  } else {
    const folder = next.foldersById[input.target.folderId];
    if (!folder) return organization;
    folder.childOrder = [...folder.childOrder, input.node];
    if (input.node.kind === "folder") {
      next.foldersById[input.node.id] = {
        ...next.foldersById[input.node.id],
        parentFolderId: input.target.folderId,
      };
    }
  }

  return next;
}
```

- [ ] **Step 5: Run the pure logic tests**

Run: `bun --cwd /home/sammy/Documents/T3-code/t3code/apps/web run test -- src/components/Sidebar.organization.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/Sidebar.organization.ts \
  apps/web/src/components/Sidebar.organization.test.ts
git commit -m "feat: add sidebar organization model"
```

### Task 2: Persisted Sidebar Organization Store

**Files:**

- Create: `apps/web/src/sidebarOrganizationStore.ts`
- Test: `apps/web/src/sidebarOrganizationStore.test.ts`

- [ ] **Step 1: Write the failing store tests**

```ts
import { ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  SIDEBAR_ORGANIZATION_STORAGE_KEY,
  readPersistedSidebarOrganizationState,
  useSidebarOrganizationStore,
} from "./sidebarOrganizationStore";

const THREAD_A = ThreadId.makeUnsafe("thread-a");
const THREAD_B = ThreadId.makeUnsafe("thread-b");

describe("sidebarOrganizationStore", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useSidebarOrganizationStore.setState({ projectsByCwd: {} });
    vi.useFakeTimers();
  });

  it("hydrates a new project lazily from ordered thread ids", () => {
    useSidebarOrganizationStore.getState().hydrateProject("/repo/project", [THREAD_A, THREAD_B]);

    expect(
      useSidebarOrganizationStore.getState().projectsByCwd["/repo/project"]?.rootOrder,
    ).toEqual([
      { kind: "thread", id: THREAD_A },
      { kind: "thread", id: THREAD_B },
    ]);
  });

  it("creates a root folder at the top and expands it", () => {
    const folderId = useSidebarOrganizationStore
      .getState()
      .createFolder({ cwd: "/repo/project", parentFolderId: null, name: "Plans" });

    const project = useSidebarOrganizationStore.getState().projectsByCwd["/repo/project"];
    expect(project?.rootOrder[0]).toEqual({ kind: "folder", id: folderId });
    expect(project?.expandedFolderIds).toContain(folderId);
  });

  it("persists organization state under the versioned key", () => {
    useSidebarOrganizationStore.getState().hydrateProject("/repo/project", [THREAD_A]);
    vi.advanceTimersByTime(500);

    expect(window.localStorage.getItem(SIDEBAR_ORGANIZATION_STORAGE_KEY)).toContain(
      "/repo/project",
    );
  });

  it("reads persisted records keyed by cwd", () => {
    window.localStorage.setItem(
      SIDEBAR_ORGANIZATION_STORAGE_KEY,
      JSON.stringify({
        projectsByCwd: {
          "/repo/project": {
            rootOrder: [{ kind: "thread", id: THREAD_A }],
            foldersById: {},
            threadMetaById: {},
            expandedFolderIds: [],
          },
        },
      }),
    );

    const state = readPersistedSidebarOrganizationState();
    expect(state.projectsByCwd["/repo/project"]?.rootOrder).toHaveLength(1);
  });
});
```

Run: `bun --cwd /home/sammy/Documents/T3-code/t3code/apps/web run test -- src/sidebarOrganizationStore.test.ts`

Expected: FAIL with module-not-found / missing-export errors.

- [ ] **Step 2: Add persisted store state and read/write helpers**

```ts
import { Debouncer } from "@tanstack/react-pacer";
import { create } from "zustand";

import {
  createEmptySidebarProjectOrganization,
  deleteFolderAndPromoteChildren,
  moveSidebarNode,
  normalizeSidebarProjectOrganization,
  type SidebarColor,
  type SidebarNodeRef,
  type SidebarOrganizationState,
  type SidebarProjectOrganization,
} from "./components/Sidebar.organization";

export const SIDEBAR_ORGANIZATION_STORAGE_KEY = "t3code:sidebar-organization:v1";

export function readPersistedSidebarOrganizationState(): SidebarOrganizationState {
  if (typeof window === "undefined") return { projectsByCwd: {} };
  try {
    const raw = window.localStorage.getItem(SIDEBAR_ORGANIZATION_STORAGE_KEY);
    if (!raw) return { projectsByCwd: {} };
    const parsed = JSON.parse(raw) as SidebarOrganizationState;
    return parsed.projectsByCwd ? parsed : { projectsByCwd: {} };
  } catch {
    return { projectsByCwd: {} };
  }
}

function persistSidebarOrganizationState(state: SidebarOrganizationState): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SIDEBAR_ORGANIZATION_STORAGE_KEY, JSON.stringify(state));
}

const debouncedPersistSidebarOrganizationState = new Debouncer(persistSidebarOrganizationState, {
  wait: 500,
});
```

- [ ] **Step 3: Add store actions keyed by `cwd`**

```ts
interface SidebarOrganizationStore extends SidebarOrganizationState {
  hydrateProject: (cwd: string, orderedThreadIds: readonly ThreadId[]) => void;
  createFolder: (input: { cwd: string; parentFolderId: string | null; name: string }) => string;
  renameFolder: (input: { cwd: string; folderId: string; name: string }) => void;
  toggleFolderExpanded: (cwd: string, folderId: string) => void;
  deleteFolder: (cwd: string, folderId: string) => void;
  moveNode: (input: { cwd: string; node: SidebarNodeRef; target: SidebarDropTarget }) => void;
  setFolderColor: (input: { cwd: string; folderId: string; color: SidebarColor | null }) => void;
  setThreadColorMode: (
    input:
      | { cwd: string; threadId: ThreadId; colorMode: "inherit"; color: null }
      | { cwd: string; threadId: ThreadId; colorMode: "none"; color: null }
      | { cwd: string; threadId: ThreadId; colorMode: "custom"; color: SidebarColor }
  ) => void;
}

function getProjectRecord(
  projectsByCwd: SidebarOrganizationState["projectsByCwd"],
  cwd: string,
): SidebarProjectOrganization {
  return projectsByCwd[cwd] ?? createEmptySidebarProjectOrganization();
}

export const useSidebarOrganizationStore = create<SidebarOrganizationStore>((set, get) => ({
  ...readPersistedSidebarOrganizationState(),

  hydrateProject: (cwd, orderedThreadIds) =>
    set((state) => ({
      projectsByCwd: {
        ...state.projectsByCwd,
        [cwd]: normalizeSidebarProjectOrganization({
          organization: getProjectRecord(state.projectsByCwd, cwd),
          orderedThreadIds,
        }),
      },
    })),

  createFolder: ({ cwd, parentFolderId, name }) => {
    const folderId = crypto.randomUUID();
    set((state) => {
      const project = getProjectRecord(state.projectsByCwd, cwd);
      const nextProject = {
        ...project,
        foldersById: {
          ...project.foldersById,
          [folderId]: { id: folderId, parentFolderId, name, color: null, childOrder: [] },
        },
        expandedFolderIds: [...new Set([...project.expandedFolderIds, folderId, ...(parentFolderId ? [parentFolderId] : [])])],
      };
      if (parentFolderId === null) {
        nextProject.rootOrder = [{ kind: "folder", id: folderId }, ...project.rootOrder];
      } else {
        nextProject.foldersById[parentFolderId] = {
          ...nextProject.foldersById[parentFolderId],
          childOrder: [{ kind: "folder", id: folderId }, ...nextProject.foldersById[parentFolderId]!.childOrder],
        };
      }
      return { projectsByCwd: { ...state.projectsByCwd, [cwd]: nextProject } };
    });
    return folderId;
  },
```

```ts
  renameFolder: ({ cwd, folderId, name }) =>
    set((state) => {
      const project = state.projectsByCwd[cwd];
      const folder = project?.foldersById[folderId];
      if (!project || !folder) return state;
      return {
        projectsByCwd: {
          ...state.projectsByCwd,
          [cwd]: {
            ...project,
            foldersById: {
              ...project.foldersById,
              [folderId]: { ...folder, name },
            },
          },
        },
      };
    }),

  deleteFolder: (cwd, folderId) =>
    set((state) => {
      const project = state.projectsByCwd[cwd];
      if (!project) return state;
      return {
        projectsByCwd: {
          ...state.projectsByCwd,
          [cwd]: deleteFolderAndPromoteChildren(project, folderId),
        },
      };
    }),
}));

useSidebarOrganizationStore.subscribe((state) =>
  debouncedPersistSidebarOrganizationState.maybeExecute({ projectsByCwd: state.projectsByCwd }),
);
```

- [ ] **Step 4: Run the store tests**

Run: `bun --cwd /home/sammy/Documents/T3-code/t3code/apps/web run test -- src/sidebarOrganizationStore.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/sidebarOrganizationStore.ts \
  apps/web/src/sidebarOrganizationStore.test.ts
git commit -m "feat: add persisted sidebar organization store"
```

### Task 3: Sidebar Organization Tree Components

**Files:**

- Create: `apps/web/src/components/SidebarFolderRow.tsx`
- Create: `apps/web/src/components/SidebarThreadRow.tsx`
- Create: `apps/web/src/components/SidebarOrganizationTree.tsx`
- Create: `apps/web/src/components/SidebarOrganizationTree.test.tsx`

- [ ] **Step 1: Write the failing render tests**

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SidebarProvider } from "./ui/sidebar";
import { SidebarOrganizationTree } from "./SidebarOrganizationTree";

describe("SidebarOrganizationTree", () => {
  it("renders folders with stronger accents and threads with subtler inherited accents", () => {
    const html = renderToStaticMarkup(
      <SidebarProvider>
        <SidebarOrganizationTree
          nodes={[
            {
              kind: "folder",
              folderId: "folder-1",
              name: "Plans",
              depth: 0,
              color: "teal",
              parentFolderId: null,
              children: [
                {
                  kind: "thread",
                  thread: {
                    id: "thread-1",
                    title: "Roadmap",
                    createdAt: "2026-03-26T00:00:00.000Z",
                  } as never,
                  depth: 1,
                  parentFolderId: "folder-1",
                  effectiveColor: "teal",
                  colorMode: "inherit",
                },
              ],
            },
          ]}
          expandedFolderIds={["folder-1"]}
          activeThreadId={null}
          selectedThreadIds={new Set()}
          onFolderToggle={() => {}}
          onFolderContextMenu={() => {}}
          onThreadClick={() => {}}
          onThreadContextMenu={() => {}}
        />
      </SidebarProvider>,
    );

    expect(html).toContain('data-testid="sidebar-folder-row-folder-1"');
    expect(html).toContain('data-sidebar-color="teal"');
    expect(html).toContain('data-testid="sidebar-thread-row-thread-1"');
    expect(html).toContain('data-sidebar-thread-color="teal"');
  });
});
```

Run: `bun --cwd /home/sammy/Documents/T3-code/t3code/apps/web run test -- src/components/SidebarOrganizationTree.test.tsx`

Expected: FAIL with module-not-found / missing-export errors.

- [ ] **Step 2: Add focused folder and thread row components with stable test hooks**

```tsx
export function SidebarFolderRow(props: {
  folderId: string;
  name: string;
  depth: number;
  color: SidebarColor | null;
  expanded: boolean;
  isRenaming: boolean;
  renamingValue: string;
  onToggle: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
  onRenameChange: (value: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
}) {
  return (
    <SidebarMenuSubItem className="w-full">
      <SidebarMenuSubButton
        render={<div role="button" tabIndex={0} />}
        data-testid={`sidebar-folder-row-${props.folderId}`}
        data-sidebar-color={props.color ?? "none"}
        data-sidebar-depth={props.depth}
        className="group/sidebar-folder relative h-8 w-full translate-x-0 justify-start rounded-md px-2 text-left"
        style={{ paddingLeft: `${12 + props.depth * 10}px` }}
        onContextMenu={props.onContextMenu}
      >
        <span
          aria-hidden="true"
          className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-current opacity-70"
        />
        <ChevronRightIcon className={props.expanded ? "size-3.5 rotate-90" : "size-3.5"} />
        {props.isRenaming ? (
          <input
            value={props.renamingValue}
            onChange={(event) => props.onRenameChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") props.onRenameCommit();
              if (event.key === "Escape") props.onRenameCancel();
            }}
            onBlur={props.onRenameCommit}
            className="min-w-0 flex-1 rounded border border-ring bg-transparent px-1 text-xs outline-none"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground/90">
            {props.name}
          </span>
        )}
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  );
}
```

```tsx
export function SidebarThreadRow(props: {
  thread: Thread;
  depth: number;
  effectiveColor: SidebarColor | null;
  isActive: boolean;
  isSelected: boolean;
  onClick: (event: React.MouseEvent) => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
  onContextMenu: (event: React.MouseEvent) => void;
}) {
  return (
    <SidebarMenuSubItem className="w-full" data-thread-item>
      <SidebarMenuSubButton
        render={<div role="button" tabIndex={0} />}
        data-testid={`sidebar-thread-row-${props.thread.id}`}
        data-sidebar-thread-color={props.effectiveColor ?? "none"}
        className={resolveThreadRowClassName({
          isActive: props.isActive,
          isSelected: props.isSelected,
        })}
        style={{ paddingLeft: `${16 + props.depth * 10}px` }}
        onClick={props.onClick}
        onKeyDown={props.onKeyDown}
        onContextMenu={props.onContextMenu}
      >
        <span className="absolute inset-y-1 left-0 w-px rounded-full bg-current opacity-35" />
        <span className="min-w-0 flex-1 truncate text-xs">{props.thread.title}</span>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  );
}
```

- [ ] **Step 3: Add the recursive tree renderer**

```tsx
export function SidebarOrganizationTree(props: {
  nodes: readonly SidebarDerivedNode[];
  expandedFolderIds: readonly string[];
  activeThreadId: ThreadId | null;
  selectedThreadIds: ReadonlySet<ThreadId>;
  renamingFolderId?: string | null;
  renamingFolderName?: string;
  onFolderToggle: (folderId: string) => void;
  onFolderContextMenu: (folderId: string, event: React.MouseEvent) => void;
  onThreadClick: (threadId: ThreadId, event: React.MouseEvent) => void;
  onThreadContextMenu: (threadId: ThreadId, event: React.MouseEvent) => void;
}) {
  return (
    <SidebarMenuSub className="mx-1 my-0 w-full translate-x-0 gap-0.5 px-1.5 py-0">
      {props.nodes.map((node) =>
        node.kind === "folder" ? (
          <Fragment key={node.folderId}>
            <SidebarFolderRow
              folderId={node.folderId}
              name={node.name}
              depth={node.depth}
              color={node.color}
              expanded={props.expandedFolderIds.includes(node.folderId)}
              isRenaming={props.renamingFolderId === node.folderId}
              renamingValue={props.renamingFolderName ?? ""}
              onToggle={() => props.onFolderToggle(node.folderId)}
              onContextMenu={(event) => props.onFolderContextMenu(node.folderId, event)}
              onRenameChange={() => {}}
              onRenameCommit={() => {}}
              onRenameCancel={() => {}}
            />
            {props.expandedFolderIds.includes(node.folderId) ? (
              <SidebarOrganizationTree {...props} nodes={node.children} />
            ) : null}
          </Fragment>
        ) : (
          <SidebarThreadRow
            key={node.thread.id}
            thread={node.thread}
            depth={node.depth}
            effectiveColor={node.effectiveColor}
            isActive={props.activeThreadId === node.thread.id}
            isSelected={props.selectedThreadIds.has(node.thread.id)}
            onClick={(event) => props.onThreadClick(node.thread.id, event)}
            onKeyDown={() => {}}
            onContextMenu={(event) => props.onThreadContextMenu(node.thread.id, event)}
          />
        ),
      )}
    </SidebarMenuSub>
  );
}
```

- [ ] **Step 4: Run the render tests**

Run: `bun --cwd /home/sammy/Documents/T3-code/t3code/apps/web run test -- src/components/SidebarOrganizationTree.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/SidebarFolderRow.tsx \
  apps/web/src/components/SidebarThreadRow.tsx \
  apps/web/src/components/SidebarOrganizationTree.tsx \
  apps/web/src/components/SidebarOrganizationTree.test.tsx
git commit -m "feat: add sidebar organization tree components"
```

### Task 4: Sidebar Host Integration and Folder Lifecycle

**Files:**

- Modify: `apps/web/src/components/Sidebar.tsx`

- [ ] **Step 1: Add the failing integration assertions to the browser harness**

```tsx
it("creates a root folder from the project context menu and starts inline rename", async () => {
  const mounted = await mountChatView({
    viewport: DEFAULT_VIEWPORT,
    snapshot: createUnlockedSnapshot({
      targetMessageId: "msg-user-sidebar-folder-create" as MessageId,
      targetText: "sidebar folders",
    }),
  });

  try {
    const projectButton = page.getByText("Project", { exact: true });
    await projectButton.click({ button: "right" });
    await page.getByText("New folder").click();

    await expect.element(page.getByRole("textbox")).toBeInTheDocument();
  } finally {
    await mounted.cleanup();
  }
});
```

Run: `bun --cwd /home/sammy/Documents/T3-code/t3code/apps/web run test:browser -- src/components/ChatView.browser.tsx --testNamePattern "creates a root folder"`

Expected: FAIL because the project menu does not expose `New folder` yet.

- [ ] **Step 2: Replace the flat per-project thread list with the derived mixed tree**

```tsx
const organizationByCwd = useSidebarOrganizationStore((state) => state.projectsByCwd);
const hydrateSidebarProject = useSidebarOrganizationStore((state) => state.hydrateProject);
const createSidebarFolder = useSidebarOrganizationStore((state) => state.createFolder);
const renameSidebarFolder = useSidebarOrganizationStore((state) => state.renameFolder);
const toggleSidebarFolderExpanded = useSidebarOrganizationStore(
  (state) => state.toggleFolderExpanded,
);
const deleteSidebarFolder = useSidebarOrganizationStore((state) => state.deleteFolder);

const [renamingFolder, setRenamingFolder] = useState<{ cwd: string; folderId: string } | null>(
  null,
);
const [renamingFolderName, setRenamingFolderName] = useState("");

useEffect(() => {
  for (const project of projects) {
    const orderedThreadIds = threads
      .filter((thread) => thread.projectId === project.id)
      .toSorted((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((thread) => thread.id);
    hydrateSidebarProject(project.cwd, orderedThreadIds);
  }
}, [hydrateSidebarProject, projects, threads]);
```

```tsx
const derivedNodes = deriveSidebarNodes({
  orderedThreads: projectThreads,
  organization: organizationByCwd[project.cwd] ?? createEmptySidebarProjectOrganization(),
});

<SidebarOrganizationTree
  nodes={derivedNodes}
  expandedFolderIds={organizationByCwd[project.cwd]?.expandedFolderIds ?? []}
  activeThreadId={routeThreadId}
  selectedThreadIds={selectedThreadIds}
  renamingFolderId={renamingFolder?.cwd === project.cwd ? renamingFolder.folderId : null}
  renamingFolderName={renamingFolder?.cwd === project.cwd ? renamingFolderName : ""}
  onFolderToggle={(folderId) => toggleSidebarFolderExpanded(project.cwd, folderId)}
  onFolderContextMenu={(folderId, event) => {
    event.preventDefault();
    void handleFolderContextMenu(project.cwd, folderId, {
      x: event.clientX,
      y: event.clientY,
    });
  }}
  onThreadClick={(threadId, event) => handleThreadClick(event, threadId, orderedProjectThreadIds)}
  onThreadContextMenu={(threadId, event) => {
    event.preventDefault();
    void handleThreadContextMenu(threadId, { x: event.clientX, y: event.clientY });
  }}
/>;
```

- [ ] **Step 3: Add project and folder context-menu flows**

```tsx
const handleProjectContextMenu = useCallback(
  async (projectId: ProjectId, position: { x: number; y: number }) => {
    const api = readNativeApi();
    if (!api) return;

    const clicked = await api.contextMenu.show(
      [
        { id: "new-folder", label: "New folder" },
        { id: "delete", label: "Remove project", destructive: true },
      ],
      position,
    );

    const project = projects.find((entry) => entry.id === projectId);
    if (!project) return;

    if (clicked === "new-folder") {
      const folderId = createSidebarFolder({
        cwd: project.cwd,
        parentFolderId: null,
        name: "Untitled folder",
      });
      setRenamingFolder({ cwd: project.cwd, folderId });
      setRenamingFolderName("Untitled folder");
      return;
    }

    if (clicked !== "delete") return;
    // keep existing project-delete behavior below
  },
  [createSidebarFolder, projects],
);
```

```tsx
const handleFolderContextMenu = useCallback(
  async (cwd: string, folderId: string, position: { x: number; y: number }) => {
    const api = readNativeApi();
    if (!api) return;

    const clicked = await api.contextMenu.show(
      [
        { id: "new-subfolder", label: "New subfolder" },
        { id: "rename", label: "Rename folder" },
        { id: "set-color", label: "Set color" },
        { id: "clear-color", label: "Clear color" },
        { id: "delete", label: "Delete folder", destructive: true },
      ],
      position,
    );

    if (clicked === "new-subfolder") {
      const childId = createSidebarFolder({
        cwd,
        parentFolderId: folderId,
        name: "Untitled folder",
      });
      setRenamingFolder({ cwd, folderId: childId });
      setRenamingFolderName("Untitled folder");
      return;
    }
    if (clicked === "rename") {
      const folder = organizationByCwd[cwd]?.foldersById[folderId];
      if (!folder) return;
      setRenamingFolder({ cwd, folderId });
      setRenamingFolderName(folder.name);
      return;
    }
    if (clicked === "delete") {
      deleteSidebarFolder(cwd, folderId);
    }
  },
  [createSidebarFolder, deleteSidebarFolder, organizationByCwd],
);
```

- [ ] **Step 4: Wire inline folder rename commit/cancel**

```tsx
const commitFolderRename = useCallback(() => {
  if (!renamingFolder) return;
  const trimmed = renamingFolderName.trim();
  if (trimmed.length === 0) {
    setRenamingFolder(null);
    setRenamingFolderName("");
    return;
  }
  renameSidebarFolder({
    cwd: renamingFolder.cwd,
    folderId: renamingFolder.folderId,
    name: trimmed,
  });
  setRenamingFolder(null);
  setRenamingFolderName("");
}, [renameSidebarFolder, renamingFolder, renamingFolderName]);
```

- [ ] **Step 5: Run the targeted browser assertion**

Run: `bun --cwd /home/sammy/Documents/T3-code/t3code/apps/web run test:browser -- src/components/ChatView.browser.tsx --testNamePattern "creates a root folder"`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/Sidebar.tsx \
  apps/web/src/components/ChatView.browser.tsx
git commit -m "feat: integrate sidebar folder organization"
```

### Task 5: Thread Colors and Mixed Drag/Drop

**Files:**

- Modify: `apps/web/src/components/Sidebar.organization.ts`
- Modify: `apps/web/src/sidebarOrganizationStore.ts`
- Modify: `apps/web/src/components/SidebarFolderRow.tsx`
- Modify: `apps/web/src/components/SidebarThreadRow.tsx`
- Modify: `apps/web/src/components/SidebarOrganizationTree.tsx`
- Modify: `apps/web/src/components/Sidebar.tsx`
- Modify: `apps/web/src/components/ChatView.browser.tsx`

- [ ] **Step 1: Extend the failing browser coverage for color actions and drag/drop**

```tsx
it("lets a thread inherit folder color and move into a nested folder", async () => {
  const mounted = await mountChatView({
    viewport: DEFAULT_VIEWPORT,
    snapshot: createUnlockedSnapshot({
      targetMessageId: "msg-user-sidebar-dnd" as MessageId,
      targetText: "sidebar dnd",
    }),
  });

  try {
    const projectButton = page.getByText("Project", { exact: true });
    await projectButton.click({ button: "right" });
    await page.getByText("New folder").click();
    const rename = page.getByRole("textbox");
    await rename.fill("Plans");
    await rename.press("Enter");

    const folderRow = page.getByText("Plans", { exact: true });
    await folderRow.click({ button: "right" });
    await page.getByText("Set color").click();
    await page.getByText("Teal").click();

    const threadRow = page.getByTestId("sidebar-thread-row-thread-browser-test");
    await dragSidebarRow(threadRow, folderRow);

    await expect.element(threadRow).toHaveAttribute("data-sidebar-thread-color", "teal");
  } finally {
    await mounted.cleanup();
  }
});
```

Run: `bun --cwd /home/sammy/Documents/T3-code/t3code/apps/web run test:browser -- src/components/ChatView.browser.tsx --testNamePattern "inherit folder color"`

Expected: FAIL because color menus and inner DnD are not wired yet.

- [ ] **Step 2: Add flat palette menus and thread color-mode actions**

```ts
export const SIDEBAR_COLOR_OPTIONS: ReadonlyArray<{ id: SidebarColor; label: string }> = [
  { id: "slate", label: "Slate" },
  { id: "blue", label: "Blue" },
  { id: "teal", label: "Teal" },
  { id: "emerald", label: "Emerald" },
  { id: "amber", label: "Amber" },
  { id: "rose", label: "Rose" },
  { id: "violet", label: "Violet" },
] as const;
```

```tsx
async function showSidebarColorMenu(position: {
  x: number;
  y: number;
}): Promise<SidebarColor | null> {
  const api = readNativeApi();
  if (!api) return null;
  const clicked = await api.contextMenu.show(
    SIDEBAR_COLOR_OPTIONS.map((entry) => ({ id: entry.id, label: entry.label })),
    position,
  );
  return clicked;
}

const handleThreadContextMenu = useCallback(
  async (threadId: ThreadId, position: { x: number; y: number }) => {
    const thread = threads.find((entry) => entry.id === threadId);
    const threadProjectCwd = thread ? (projectCwdById.get(thread.projectId) ?? null) : null;
    if (!thread || !threadProjectCwd) return;

    const clicked = await api.contextMenu.show(
      [
        { id: "rename", label: "Rename thread" },
        { id: "mark-unread", label: "Mark unread" },
        { id: "use-folder-color", label: "Use folder color" },
        { id: "set-color", label: "Set color" },
        { id: "no-color", label: "No color" },
        { id: "copy-path", label: "Copy Path" },
        { id: "copy-thread-id", label: "Copy Thread ID" },
        { id: "delete", label: "Delete", destructive: true },
      ],
      position,
    );

    if (clicked === "use-folder-color") {
      setSidebarThreadColorMode({
        cwd: threadProjectCwd,
        threadId,
        colorMode: "inherit",
        color: null,
      });
      return;
    }
    if (clicked === "no-color") {
      setSidebarThreadColorMode({
        cwd: threadProjectCwd,
        threadId,
        colorMode: "none",
        color: null,
      });
      return;
    }
    if (clicked === "set-color") {
      const color = await showSidebarColorMenu(position);
      if (color) {
        setSidebarThreadColorMode({ cwd: threadProjectCwd, threadId, colorMode: "custom", color });
      }
      return;
    }
  },
  [],
);
```

```tsx
if (clicked === "set-color") {
  const color = await showSidebarColorMenu(position);
  if (color) {
    setSidebarFolderColor({ cwd, folderId, color });
  }
  return;
}

if (clicked === "clear-color") {
  setSidebarFolderColor({ cwd, folderId, color: null });
  return;
}
```

- [ ] **Step 3: Add per-project nested DnD with explicit drop targets**

```tsx
const sidebarDnDSensors = useSensors(
  useSensor(PointerSensor, {
    activationConstraint: { distance: 6 },
  }),
);

<DndContext
  sensors={sidebarDnDSensors}
  collisionDetection={pointerWithin}
  modifiers={[restrictToVerticalAxis, restrictToFirstScrollableAncestor]}
  onDragEnd={(event) => {
    const node = parseSidebarNodeRef(event.active.id);
    const target = parseSidebarDropTarget(event.over?.id ?? null);
    if (!node || !target) return;
    moveSidebarNodeInStore({ cwd: project.cwd, node, target });
  }}
>
  <SidebarOrganizationTree
    nodes={derivedNodes}
    expandedFolderIds={organizationByCwd[project.cwd]?.expandedFolderIds ?? []}
    activeThreadId={routeThreadId}
    selectedThreadIds={selectedThreadIds}
    renamingFolderId={renamingFolder?.cwd === project.cwd ? renamingFolder.folderId : null}
    renamingFolderName={renamingFolder?.cwd === project.cwd ? renamingFolderName : ""}
    onFolderToggle={(folderId) => toggleSidebarFolderExpanded(project.cwd, folderId)}
    onFolderContextMenu={(folderId, event) => {
      event.preventDefault();
      void handleFolderContextMenu(project.cwd, folderId, {
        x: event.clientX,
        y: event.clientY,
      });
    }}
    onThreadClick={(threadId, event) => handleThreadClick(event, threadId, orderedProjectThreadIds)}
    onThreadContextMenu={(threadId, event) => {
      event.preventDefault();
      void handleThreadContextMenu(threadId, { x: event.clientX, y: event.clientY });
    }}
    activeDragId={activeSidebarDragId}
    activeDropTargetId={activeSidebarDropTargetId}
  />
</DndContext>;
```

```tsx
export function SidebarFolderRow(props: {
  folderId: string;
  name: string;
  depth: number;
  color: SidebarColor | null;
  expanded: boolean;
  isRenaming: boolean;
  renamingValue: string;
  dragId?: string;
  dropBeforeId?: string;
  dropInsideId?: string;
  onToggle: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
  onRenameChange: (value: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: props.dragId ?? `folder:${props.folderId}`,
  });
  const beforeDrop = useDroppable({ id: props.dropBeforeId ?? `before:folder:${props.folderId}` });
  const insideDrop = useDroppable({ id: props.dropInsideId ?? `inside:${props.folderId}` });

  return (
    <div ref={beforeDrop.setNodeRef} data-testid={`sidebar-drop-before-folder-${props.folderId}`}>
      <div ref={insideDrop.setNodeRef} className={insideDrop.isOver ? "bg-accent/30" : ""}>
        <SidebarMenuSubButton
          ref={setNodeRef}
          {...attributes}
          {...listeners}
          data-testid={`sidebar-folder-row-${props.folderId}`}
          className={isDragging ? "opacity-70" : ""}
        >
```

- [ ] **Step 4: Add move-rule regression coverage to the pure tests**

```ts
it("moves a nested folder back to project root", () => {
  const organization = createEmptySidebarProjectOrganization();
  organization.rootOrder = [{ kind: "folder", id: "root-folder" }];
  organization.foldersById["root-folder"] = {
    id: "root-folder",
    parentFolderId: null,
    name: "Root",
    color: null,
    childOrder: [{ kind: "folder", id: "nested-folder" }],
  };
  organization.foldersById["nested-folder"] = {
    id: "nested-folder",
    parentFolderId: "root-folder",
    name: "Nested",
    color: null,
    childOrder: [],
  };

  const next = moveSidebarNode(organization, {
    node: { kind: "folder", id: "nested-folder" },
    target: { type: "root-start" },
  });

  expect(next.rootOrder[0]).toEqual({ kind: "folder", id: "nested-folder" });
  expect(next.foldersById["nested-folder"]?.parentFolderId).toBeNull();
});
```

Run: `bun --cwd /home/sammy/Documents/T3-code/t3code/apps/web run test -- src/components/Sidebar.organization.test.ts`

Expected: PASS.

- [ ] **Step 5: Run the targeted browser tests**

Run: `bun --cwd /home/sammy/Documents/T3-code/t3code/apps/web run test:browser -- src/components/ChatView.browser.tsx --testNamePattern "sidebar"`

Expected: PASS for the new sidebar organization scenarios.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/Sidebar.organization.ts \
  apps/web/src/sidebarOrganizationStore.ts \
  apps/web/src/components/SidebarFolderRow.tsx \
  apps/web/src/components/SidebarThreadRow.tsx \
  apps/web/src/components/SidebarOrganizationTree.tsx \
  apps/web/src/components/Sidebar.tsx \
  apps/web/src/components/ChatView.browser.tsx
git commit -m "feat: add sidebar organization drag and color controls"
```

### Task 6: Full Regression Pass and Build Verification

**Files:**

- Modify: `apps/web/src/components/ChatView.browser.tsx`
- Modify: `apps/web/src/components/Sidebar.organization.test.ts`
- Modify: `apps/web/src/sidebarOrganizationStore.test.ts`

- [ ] **Step 1: Fill out the remaining browser cases from the spec**

```tsx
it("creates a nested subfolder and renames it inline", async () => {
  const mounted = await mountChatView({
    viewport: DEFAULT_VIEWPORT,
    snapshot: createUnlockedSnapshot({
      targetMessageId: "msg-user-sidebar-subfolder" as MessageId,
      targetText: "sidebar subfolder",
    }),
  });

  try {
    const projectButton = page.getByText("Project", { exact: true });
    await projectButton.click({ button: "right" });
    await page.getByText("New folder").click();
    const rootRename = page.getByRole("textbox");
    await rootRename.fill("Client");
    await rootRename.press("Enter");

    await page.getByText("Client", { exact: true }).click({ button: "right" });
    await page.getByText("New subfolder").click();
    const childRename = page.getByRole("textbox");
    await childRename.fill("Briefs");
    await childRename.press("Enter");

    await expect.element(page.getByText("Briefs", { exact: true })).toBeInTheDocument();
  } finally {
    await mounted.cleanup();
  }
});

it("deletes a folder while preserving its children in place", async () => {
  const mounted = await mountChatView({
    viewport: DEFAULT_VIEWPORT,
    snapshot: createUnlockedSnapshot({
      targetMessageId: "msg-user-sidebar-delete-folder" as MessageId,
      targetText: "sidebar delete folder",
    }),
  });

  try {
    const projectButton = page.getByText("Project", { exact: true });
    await projectButton.click({ button: "right" });
    await page.getByText("New folder").click();
    const rename = page.getByRole("textbox");
    await rename.fill("Archive");
    await rename.press("Enter");

    const folderRow = page.getByText("Archive", { exact: true });
    const threadRow = page.getByTestId("sidebar-thread-row-thread-browser-test");
    await dragSidebarRow(threadRow, folderRow);

    await folderRow.click({ button: "right" });
    await page.getByText("Delete folder").click();

    await expect
      .element(page.getByTestId("sidebar-thread-row-thread-browser-test"))
      .toBeInTheDocument();
    await expect.element(page.getByText("Archive", { exact: true })).not.toBeInTheDocument();
  } finally {
    await mounted.cleanup();
  }
});

it("renders folder accents stronger than thread accents", async () => {
  const mounted = await mountChatView({
    viewport: DEFAULT_VIEWPORT,
    snapshot: createUnlockedSnapshot({
      targetMessageId: "msg-user-sidebar-accents" as MessageId,
      targetText: "sidebar accents",
    }),
  });

  try {
    const projectButton = page.getByText("Project", { exact: true });
    await projectButton.click({ button: "right" });
    await page.getByText("New folder").click();
    const rename = page.getByRole("textbox");
    await rename.fill("Plans");
    await rename.press("Enter");

    const folderRow = page.getByText("Plans", { exact: true });
    await folderRow.click({ button: "right" });
    await page.getByText("Set color").click();
    await page.getByText("Teal").click();

    const threadRow = page.getByTestId("sidebar-thread-row-thread-browser-test");
    await dragSidebarRow(threadRow, folderRow);

    const folderAccentRow = page
      .getByText("Plans", { exact: true })
      .locator("xpath=ancestor::*[@data-sidebar-color][1]");
    await expect.element(folderAccentRow).toHaveAttribute("data-sidebar-color", "teal");
    await expect.element(threadRow).toHaveAttribute("data-sidebar-thread-color", "teal");
  } finally {
    await mounted.cleanup();
  }
});
```

- [ ] **Step 2: Run the focused unit suites**

Run: `bun --cwd /home/sammy/Documents/T3-code/t3code/apps/web run test -- src/components/Sidebar.organization.test.ts src/sidebarOrganizationStore.test.ts src/components/SidebarOrganizationTree.test.tsx`

Expected: PASS.

- [ ] **Step 3: Run the browser suite for sidebar scenarios**

Run: `bun --cwd /home/sammy/Documents/T3-code/t3code/apps/web run test:browser -- src/components/ChatView.browser.tsx --testNamePattern "sidebar"`

Expected: PASS.

- [ ] **Step 4: Run the app build required by the brief**

Run: `cd /home/sammy/Documents/T3-code/t3code && bun run build`

Expected: PASS with the full monorepo build succeeding.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ChatView.browser.tsx \
  apps/web/src/components/Sidebar.organization.test.ts \
  apps/web/src/sidebarOrganizationStore.test.ts \
  apps/web/src/components/SidebarOrganizationTree.test.tsx
git commit -m "test: verify sidebar organization feature"
```

## Self-Review

- Spec coverage: this plan covers project-local folders, nested subfolders, cwd-keyed persistence, new-thread insertion at root, folder delete promotion, subtle folder/thread color rules, flat palette menus, single-item drag/drop, and browser coverage for the main sidebar flows.
- Placeholder scan: no `TBD`, `TODO`, or “implement later” markers remain.
- Type consistency: the plan uses one shared type vocabulary throughout: `SidebarProjectOrganization`, `SidebarNodeRef`, `SidebarDropTarget`, `SidebarThreadColorMode`, `SidebarColor`, `deriveSidebarNodes`, `moveSidebarNode`, and `useSidebarOrganizationStore`.
