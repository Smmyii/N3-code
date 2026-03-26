import { Fragment, type KeyboardEvent, type MouseEvent } from "react";
import type { ThreadId } from "@t3tools/contracts";
import { useDroppable } from "@dnd-kit/core";

import {
  sidebarDropTargetToId,
  sidebarNodeRefToDragId,
  type SidebarDerivedNode,
} from "./Sidebar.organization";
import type { ThreadStatusPill } from "./Sidebar.logic";
import { SidebarFolderRow } from "./SidebarFolderRow";
import { SidebarThreadRow } from "./SidebarThreadRow";
import { SidebarMenuSub } from "./ui/sidebar";

function SidebarRootDropZone({ dropTargetId }: { dropTargetId: string }) {
  const rootDrop = useDroppable({ id: dropTargetId });

  return (
    <li
      ref={rootDrop.setNodeRef}
      data-testid="sidebar-root-drop-zone"
      className={`list-none rounded-md transition-colors ${
        rootDrop.isOver ? "mb-1 h-3 bg-accent/45 ring-1 ring-primary/35" : "mb-1 h-1 bg-transparent"
      }`}
    />
  );
}

export function SidebarOrganizationTree(props: {
  nodes: readonly SidebarDerivedNode[];
  expandedFolderIds: readonly string[];
  activeThreadId: ThreadId | null;
  selectedThreadIds: ReadonlySet<ThreadId>;
  renamingFolderId?: string | null;
  renamingFolderName?: string;
  renamingThreadId?: ThreadId | null;
  renamingThreadTitle?: string;
  onFolderToggle: (folderId: string) => void;
  onFolderContextMenu: (folderId: string, event: MouseEvent) => void;
  onThreadClick: (threadId: ThreadId, event: MouseEvent) => void;
  onThreadKeyDown: (threadId: ThreadId, event: KeyboardEvent) => void;
  onThreadContextMenu: (threadId: ThreadId, event: MouseEvent) => void;
  threadStatusById: ReadonlyMap<ThreadId, ThreadStatusPill | null>;
  terminalStatusByThreadId: ReadonlyMap<
    ThreadId,
    { label: string; colorClass: string; pulse: boolean } | null
  >;
  prStatusByThreadId: ReadonlyMap<
    ThreadId,
    { tooltip: string; url: string; colorClass: string } | null
  >;
  relativeTimeByThreadId: ReadonlyMap<ThreadId, string>;
  onThreadPrClick: (event: React.MouseEvent<HTMLElement>, url: string) => void;
  rootDropTargetId?: string | undefined;
  onFolderRenameChange?: (value: string) => void;
  onFolderRenameCommit?: () => void;
  onFolderRenameCancel?: () => void;
  onThreadRenameChange?: (value: string) => void;
  onThreadRenameCommit?: () => void;
  onThreadRenameCancel?: () => void;
}) {
  return (
    <SidebarMenuSub className="mx-1 my-0 w-full translate-x-0 gap-0.5 px-1.5 py-0">
      {props.rootDropTargetId ? (
        <SidebarRootDropZone dropTargetId={props.rootDropTargetId} />
      ) : null}
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
              dragId={sidebarNodeRefToDragId({ kind: "folder", id: node.folderId })}
              dropBeforeId={sidebarDropTargetToId(
                node.parentFolderId === null
                  ? { type: "root-before", before: { kind: "folder", id: node.folderId } }
                  : {
                      type: "folder-before",
                      folderId: node.parentFolderId,
                      before: { kind: "folder", id: node.folderId },
                    },
              )}
              dropInsideId={sidebarDropTargetToId({
                type: "inside-folder",
                folderId: node.folderId,
              })}
              onToggle={() => props.onFolderToggle(node.folderId)}
              onContextMenu={(event) => props.onFolderContextMenu(node.folderId, event)}
              onRenameChange={(value) => props.onFolderRenameChange?.(value)}
              onRenameCommit={() => props.onFolderRenameCommit?.()}
              onRenameCancel={() => props.onFolderRenameCancel?.()}
            />
            {props.expandedFolderIds.includes(node.folderId) ? (
              <SidebarOrganizationTree
                {...props}
                nodes={node.children}
                rootDropTargetId={undefined}
              />
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
            dragId={sidebarNodeRefToDragId({ kind: "thread", id: node.thread.id })}
            dropBeforeId={sidebarDropTargetToId(
              node.parentFolderId === null
                ? { type: "root-before", before: { kind: "thread", id: node.thread.id } }
                : {
                    type: "folder-before",
                    folderId: node.parentFolderId,
                    before: { kind: "thread", id: node.thread.id },
                  },
            )}
            threadStatus={props.threadStatusById.get(node.thread.id) ?? null}
            terminalStatus={props.terminalStatusByThreadId.get(node.thread.id) ?? null}
            prStatus={props.prStatusByThreadId.get(node.thread.id) ?? null}
            relativeTimeLabel={props.relativeTimeByThreadId.get(node.thread.id) ?? ""}
            isRenaming={props.renamingThreadId === node.thread.id}
            renamingValue={props.renamingThreadTitle ?? ""}
            onClick={(event) => props.onThreadClick(node.thread.id, event)}
            onKeyDown={(event) => props.onThreadKeyDown(node.thread.id, event)}
            onContextMenu={(event) => props.onThreadContextMenu(node.thread.id, event)}
            onPrClick={props.onThreadPrClick}
            onRenameChange={(value) => props.onThreadRenameChange?.(value)}
            onRenameCommit={() => props.onThreadRenameCommit?.()}
            onRenameCancel={() => props.onThreadRenameCancel?.()}
          />
        ),
      )}
    </SidebarMenuSub>
  );
}
