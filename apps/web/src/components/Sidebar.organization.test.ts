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
