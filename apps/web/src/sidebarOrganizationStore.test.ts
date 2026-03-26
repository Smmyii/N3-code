import { ThreadId } from "@t3tools/contracts";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SIDEBAR_ORGANIZATION_STORAGE_KEY,
  readPersistedSidebarOrganizationState,
  useSidebarOrganizationStore,
} from "./sidebarOrganizationStore";

const THREAD_A = ThreadId.makeUnsafe("thread-a");
const THREAD_B = ThreadId.makeUnsafe("thread-b");

beforeAll(() => {
  const storage = new Map<string, string>();

  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
    clear: () => {
      storage.clear();
    },
  });
  vi.stubGlobal("window", {
    localStorage,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
});

describe("sidebarOrganizationStore", () => {
  beforeEach(() => {
    localStorage.clear();
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

    expect(localStorage.getItem(SIDEBAR_ORGANIZATION_STORAGE_KEY)).toContain("/repo/project");
  });

  it("reads persisted records keyed by cwd", () => {
    localStorage.setItem(
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

  it("stores explicit thread color mode by cwd", () => {
    useSidebarOrganizationStore.getState().hydrateProject("/repo/project", [THREAD_A]);
    useSidebarOrganizationStore.getState().setThreadColorMode({
      cwd: "/repo/project",
      threadId: THREAD_A,
      colorMode: "custom",
      color: "teal",
    });

    expect(
      useSidebarOrganizationStore.getState().projectsByCwd["/repo/project"]?.threadMetaById[
        THREAD_A
      ],
    ).toEqual({
      colorMode: "custom",
      color: "teal",
    });
  });
});
