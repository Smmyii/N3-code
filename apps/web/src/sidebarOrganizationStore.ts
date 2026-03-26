import type { ThreadId } from "@t3tools/contracts";
import { Debouncer } from "@tanstack/react-pacer";
import { create } from "zustand";

import {
  createEmptySidebarProjectOrganization,
  deleteFolderAndPromoteChildren,
  moveSidebarNode,
  normalizeSidebarProjectOrganization,
  type SidebarColor,
  type SidebarDropTarget,
  type SidebarNodeRef,
  type SidebarOrganizationState,
  type SidebarProjectOrganization,
} from "./components/Sidebar.organization";

export const SIDEBAR_ORGANIZATION_STORAGE_KEY = "t3code:sidebar-organization:v1";

export function readPersistedSidebarOrganizationState(): SidebarOrganizationState {
  if (typeof window === "undefined") {
    return { projectsByCwd: {} };
  }

  try {
    const raw = window.localStorage.getItem(SIDEBAR_ORGANIZATION_STORAGE_KEY);
    if (!raw) {
      return { projectsByCwd: {} };
    }

    const parsed = JSON.parse(raw) as SidebarOrganizationState;
    return parsed.projectsByCwd ? parsed : { projectsByCwd: {} };
  } catch {
    return { projectsByCwd: {} };
  }
}

function persistSidebarOrganizationState(state: SidebarOrganizationState): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(SIDEBAR_ORGANIZATION_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage errors to keep the sidebar usable.
  }
}

const debouncedPersistSidebarOrganizationState = new Debouncer(persistSidebarOrganizationState, {
  wait: 500,
});

function getProjectRecord(
  projectsByCwd: SidebarOrganizationState["projectsByCwd"],
  cwd: string,
): SidebarProjectOrganization {
  return projectsByCwd[cwd] ?? createEmptySidebarProjectOrganization();
}

function updateProjectRecord(
  projectsByCwd: SidebarOrganizationState["projectsByCwd"],
  cwd: string,
  updater: (project: SidebarProjectOrganization) => SidebarProjectOrganization,
): SidebarOrganizationState["projectsByCwd"] {
  const current = getProjectRecord(projectsByCwd, cwd);
  const next = updater(current);

  if (next === current) {
    return projectsByCwd;
  }

  return {
    ...projectsByCwd,
    [cwd]: next,
  };
}

export interface SidebarOrganizationStore extends SidebarOrganizationState {
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

export const useSidebarOrganizationStore = create<SidebarOrganizationStore>((set) => ({
  ...readPersistedSidebarOrganizationState(),

  hydrateProject: (cwd, orderedThreadIds) =>
    set((state) => ({
      projectsByCwd: updateProjectRecord(state.projectsByCwd, cwd, (project) =>
        normalizeSidebarProjectOrganization({
          organization: project,
          orderedThreadIds,
        }),
      ),
    })),

  createFolder: ({ cwd, parentFolderId, name }) => {
    const folderId = crypto.randomUUID();

    set((state) => ({
      projectsByCwd: updateProjectRecord(state.projectsByCwd, cwd, (project) => {
        const nextProject: SidebarProjectOrganization = {
          ...project,
          rootOrder: [...project.rootOrder],
          foldersById: {
            ...project.foldersById,
            [folderId]: {
              id: folderId,
              parentFolderId,
              name,
              color: null,
              childOrder: [],
            },
          },
          threadMetaById: { ...project.threadMetaById },
          expandedFolderIds: [
            ...new Set([
              ...project.expandedFolderIds,
              folderId,
              ...(parentFolderId === null ? [] : [parentFolderId]),
            ]),
          ],
        };

        if (parentFolderId === null) {
          nextProject.rootOrder = [{ kind: "folder", id: folderId }, ...project.rootOrder];
          return nextProject;
        }

        const parentFolder = nextProject.foldersById[parentFolderId];
        if (!parentFolder) {
          const createdFolder = nextProject.foldersById[folderId]!;
          nextProject.rootOrder = [{ kind: "folder", id: folderId }, ...project.rootOrder];
          nextProject.foldersById[folderId] = {
            ...createdFolder,
            parentFolderId: null,
          };
          return nextProject;
        }

        nextProject.foldersById[parentFolderId] = {
          ...parentFolder,
          childOrder: [{ kind: "folder", id: folderId }, ...parentFolder.childOrder],
        };
        return nextProject;
      }),
    }));

    return folderId;
  },

  renameFolder: ({ cwd, folderId, name }) =>
    set((state) => ({
      projectsByCwd: updateProjectRecord(state.projectsByCwd, cwd, (project) => {
        const folder = project.foldersById[folderId];
        if (!folder) {
          return project;
        }

        return {
          ...project,
          foldersById: {
            ...project.foldersById,
            [folderId]: { ...folder, name },
          },
        };
      }),
    })),

  toggleFolderExpanded: (cwd, folderId) =>
    set((state) => ({
      projectsByCwd: updateProjectRecord(state.projectsByCwd, cwd, (project) => {
        const isExpanded = project.expandedFolderIds.includes(folderId);
        return {
          ...project,
          expandedFolderIds: isExpanded
            ? project.expandedFolderIds.filter((id) => id !== folderId)
            : [...project.expandedFolderIds, folderId],
        };
      }),
    })),

  deleteFolder: (cwd, folderId) =>
    set((state) => ({
      projectsByCwd: updateProjectRecord(state.projectsByCwd, cwd, (project) =>
        deleteFolderAndPromoteChildren(project, folderId),
      ),
    })),

  moveNode: ({ cwd, node, target }) =>
    set((state) => ({
      projectsByCwd: updateProjectRecord(state.projectsByCwd, cwd, (project) =>
        moveSidebarNode(project, { node, target }),
      ),
    })),

  setFolderColor: ({ cwd, folderId, color }) =>
    set((state) => ({
      projectsByCwd: updateProjectRecord(state.projectsByCwd, cwd, (project) => {
        const folder = project.foldersById[folderId];
        if (!folder) {
          return project;
        }

        return {
          ...project,
          foldersById: {
            ...project.foldersById,
            [folderId]: { ...folder, color },
          },
        };
      }),
    })),

  setThreadColorMode: (input) =>
    set((state) => ({
      projectsByCwd: updateProjectRecord(state.projectsByCwd, input.cwd, (project) => ({
        ...project,
        threadMetaById: {
          ...project.threadMetaById,
          [input.threadId]: {
            colorMode: input.colorMode,
            color: input.color,
          },
        },
      })),
    })),
}));

useSidebarOrganizationStore.subscribe((state) => {
  debouncedPersistSidebarOrganizationState.maybeExecute({
    projectsByCwd: state.projectsByCwd,
  });
});

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    debouncedPersistSidebarOrganizationState.flush();
  });
}
