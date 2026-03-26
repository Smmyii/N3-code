import type { ThreadId } from "@t3tools/contracts";

import type { Thread } from "../types";

export type SidebarColor =
  | "slate"
  | "blue"
  | "teal"
  | "emerald"
  | "amber"
  | "rose"
  | "violet";

export type SidebarThreadColorMode = "inherit" | "custom" | "none";

export type SidebarNodeRef =
  | { kind: "folder"; id: string }
  | { kind: "thread"; id: ThreadId };

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

export interface SidebarOrganizationState {
  projectsByCwd: Record<string, SidebarProjectOrganization>;
}

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

export function createEmptySidebarProjectOrganization(): SidebarProjectOrganization {
  return {
    rootOrder: [],
    foldersById: {},
    threadMetaById: {},
    expandedFolderIds: [],
  };
}

function isSameNode(left: SidebarNodeRef, right: SidebarNodeRef): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function collectPlacedThreadIds(organization: SidebarProjectOrganization): Set<ThreadId> {
  const threadIds = new Set<ThreadId>();

  for (const node of organization.rootOrder) {
    if (node.kind === "thread") {
      threadIds.add(node.id);
    }
  }

  for (const folder of Object.values(organization.foldersById)) {
    for (const node of folder.childOrder) {
      if (node.kind === "thread") {
        threadIds.add(node.id);
      }
    }
  }

  return threadIds;
}

export function normalizeSidebarProjectOrganization(input: {
  organization: SidebarProjectOrganization;
  orderedThreadIds: readonly ThreadId[];
}): SidebarProjectOrganization {
  const liveThreadIds = new Set(input.orderedThreadIds);
  const foldersById: SidebarProjectOrganization["foldersById"] = {};

  for (const [folderId, folder] of Object.entries(input.organization.foldersById)) {
    foldersById[folderId] = {
      ...folder,
      childOrder: folder.childOrder.filter((node) =>
        node.kind === "folder" ? input.organization.foldersById[node.id] !== undefined : liveThreadIds.has(node.id),
      ),
    };
  }

  const next: SidebarProjectOrganization = {
    rootOrder: input.organization.rootOrder.filter((node) =>
      node.kind === "folder" ? foldersById[node.id] !== undefined : liveThreadIds.has(node.id),
    ),
    foldersById,
    threadMetaById: {} as Record<ThreadId, SidebarThreadMeta>,
    expandedFolderIds: input.organization.expandedFolderIds.filter((folderId) => foldersById[folderId] !== undefined),
  };

  for (const [threadId, meta] of Object.entries(input.organization.threadMetaById)) {
    if (liveThreadIds.has(threadId as ThreadId)) {
      next.threadMetaById[threadId as ThreadId] = meta;
    }
  }

  const placedThreadIds = collectPlacedThreadIds(next);
  for (const threadId of input.orderedThreadIds.toReversed()) {
    if (placedThreadIds.has(threadId)) {
      continue;
    }
    next.rootOrder.unshift({ kind: "thread", id: threadId });
    placedThreadIds.add(threadId);
  }

  return next;
}

function removeNode(order: readonly SidebarNodeRef[], node: SidebarNodeRef): SidebarNodeRef[] {
  return order.filter((entry) => !isSameNode(entry, node));
}

function insertNodeBefore(
  order: readonly SidebarNodeRef[],
  before: SidebarNodeRef | null,
  node: SidebarNodeRef,
): SidebarNodeRef[] {
  if (before === null) {
    return [node, ...order];
  }

  const index = order.findIndex((entry) => isSameNode(entry, before));
  if (index === -1) {
    return [...order, node];
  }

  return [...order.slice(0, index), node, ...order.slice(index)];
}

function isFolderDescendant(
  foldersById: SidebarProjectOrganization["foldersById"],
  folderId: string,
  maybeAncestorId: string,
): boolean {
  let currentFolderId: string | null = folderId;

  while (currentFolderId !== null) {
    if (currentFolderId === maybeAncestorId) {
      return true;
    }
    currentFolderId = foldersById[currentFolderId]?.parentFolderId ?? null;
  }

  return false;
}

export function deleteFolderAndPromoteChildren(
  organization: SidebarProjectOrganization,
  folderId: string,
): SidebarProjectOrganization {
  const folder = organization.foldersById[folderId];
  if (!folder) {
    return organization;
  }

  const parentFolderId = folder.parentFolderId;
  const parentOrder =
    parentFolderId === null
      ? organization.rootOrder
      : organization.foldersById[parentFolderId]?.childOrder ?? [];
  const folderIndex = parentOrder.findIndex(
    (node) => node.kind === "folder" && node.id === folderId,
  );
  if (folderIndex === -1) {
    return organization;
  }

  const promotedChildren = folder.childOrder;
  const nextParentOrder = [
    ...parentOrder.slice(0, folderIndex),
    ...promotedChildren,
    ...parentOrder.slice(folderIndex + 1),
  ];

  const nextFoldersById = { ...organization.foldersById };
  delete nextFoldersById[folderId];

  for (const child of promotedChildren) {
    if (child.kind === "folder") {
      const childFolder = nextFoldersById[child.id];
      if (!childFolder) {
        continue;
      }
      nextFoldersById[child.id] = {
        ...childFolder,
        parentFolderId,
      };
    }
  }

  return {
    ...organization,
    rootOrder: parentFolderId === null ? nextParentOrder : organization.rootOrder,
    foldersById:
      parentFolderId === null
        ? nextFoldersById
        : {
            ...nextFoldersById,
            [parentFolderId]: {
              ...nextFoldersById[parentFolderId]!,
              childOrder: nextParentOrder,
            },
          },
    expandedFolderIds: organization.expandedFolderIds.filter((id) => id !== folderId),
  };
}

export function resolveThreadAccentColor(input: {
  threadMeta?: SidebarThreadMeta;
  inheritedFolderColor?: SidebarColor | null;
}): SidebarColor | null {
  if (input.threadMeta?.colorMode === "custom") {
    return input.threadMeta.color;
  }
  if (input.threadMeta?.colorMode === "none") {
    return null;
  }
  return input.inheritedFolderColor ?? null;
}

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
  ): SidebarDerivedNode[] => {
    const nodes: SidebarDerivedNode[] = [];

    for (const node of order) {
      if (node.kind === "thread") {
        const thread = threadById.get(node.id);
        if (!thread) {
          continue;
        }

        const threadMeta = input.organization.threadMetaById[node.id];
        nodes.push({
          kind: "thread",
          thread,
          depth,
          parentFolderId,
          effectiveColor: resolveThreadAccentColor(
            threadMeta ? { threadMeta, inheritedFolderColor } : { inheritedFolderColor },
          ),
          colorMode: threadMeta?.colorMode ?? "inherit",
        });
        continue;
      }

      const folder = input.organization.foldersById[node.id];
      if (!folder) {
        continue;
      }

      nodes.push({
        kind: "folder",
        folderId: folder.id,
        name: folder.name,
        depth,
        color: folder.color,
        parentFolderId,
        children: visit(folder.childOrder, depth + 1, folder.id, folder.color ?? inheritedFolderColor),
      });
    }

    return nodes;
  };

  return visit(input.organization.rootOrder, 0, null, null);
}

export function moveSidebarNode(
  organization: SidebarProjectOrganization,
  input: { node: SidebarNodeRef; target: SidebarDropTarget },
): SidebarProjectOrganization {
  const next: SidebarProjectOrganization = {
    ...organization,
    rootOrder: [...organization.rootOrder],
    foldersById: Object.fromEntries(
      Object.entries(organization.foldersById).map(([folderId, folder]) => [
        folderId,
        { ...folder, childOrder: [...folder.childOrder] },
      ]),
    ),
  };

  if (
    input.node.kind === "folder" &&
    ((input.target.type === "inside-folder" && isFolderDescendant(next.foldersById, input.target.folderId, input.node.id)) ||
      (input.target.type === "folder-before" && isFolderDescendant(next.foldersById, input.target.folderId, input.node.id)))
  ) {
    return organization;
  }

  next.rootOrder = removeNode(next.rootOrder, input.node);
  for (const folder of Object.values(next.foldersById)) {
    folder.childOrder = removeNode(folder.childOrder, input.node);
  }

  if (input.node.kind === "folder" && next.foldersById[input.node.id]) {
    const movedFolder = next.foldersById[input.node.id]!;
    next.foldersById[input.node.id] = {
      ...movedFolder,
      parentFolderId:
        input.target.type === "inside-folder" || input.target.type === "folder-before"
          ? input.target.folderId
          : null,
    };
  }

  if (input.target.type === "root-start") {
    next.rootOrder = [input.node, ...next.rootOrder];
    return next;
  }

  if (input.target.type === "root-before") {
    next.rootOrder = insertNodeBefore(next.rootOrder, input.target.before, input.node);
    return next;
  }

  const targetFolder = next.foldersById[input.target.folderId];
  if (!targetFolder) {
    return organization;
  }

  if (input.target.type === "folder-before") {
    targetFolder.childOrder = insertNodeBefore(targetFolder.childOrder, input.target.before, input.node);
    return next;
  }

  targetFolder.childOrder = [...targetFolder.childOrder, input.node];
  return next;
}
