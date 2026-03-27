import { useDraggable, useDroppable } from "@dnd-kit/core";
import { ChevronRightIcon } from "lucide-react";
import type * as React from "react";

import { SIDEBAR_COLOR_VALUES, type SidebarColor } from "./Sidebar.organization";
import { SidebarMenuSubButton, SidebarMenuSubItem } from "./ui/sidebar";

export function SidebarFolderRow(props: {
  folderId: string;
  name: string;
  depth: number;
  color: SidebarColor | null;
  expanded: boolean;
  isRenaming: boolean;
  renamingValue: string;
  dragId: string;
  dropBeforeId: string;
  dropInsideId: string;
  onToggle: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
  onRenameChange: (value: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: props.dragId,
  });
  const beforeDrop = useDroppable({ id: props.dropBeforeId });
  const insideDrop = useDroppable({ id: props.dropInsideId });
  const folderAccent = props.color ? SIDEBAR_COLOR_VALUES[props.color].folderAccent : null;

  return (
    <div className="w-full">
      <div
        ref={beforeDrop.setNodeRef}
        data-testid={`sidebar-drop-before-folder-${props.folderId}`}
        className={beforeDrop.isOver ? "mb-1 h-1 rounded-full bg-primary/45" : "mb-1 h-1"}
      />
      <div
        ref={insideDrop.setNodeRef}
        className={insideDrop.isOver ? "rounded-md bg-accent/35" : ""}
      >
        <div ref={setNodeRef}>
          <SidebarMenuSubItem className="w-full">
            <SidebarMenuSubButton
              render={<div role="button" tabIndex={0} />}
              {...attributes}
              {...listeners}
              data-testid={`sidebar-folder-row-${props.folderId}`}
              data-sidebar-color={props.color ?? "none"}
              data-sidebar-depth={props.depth}
              className={`group/sidebar-folder relative h-8 w-full translate-x-0 justify-start rounded-md px-2 text-left ${
                isDragging ? "opacity-70" : ""
              }`}
              style={{
                paddingLeft: `${12 + props.depth * 10}px`,
                ...(folderAccent ? { color: folderAccent } : {}),
              }}
              onClick={props.onToggle}
              onContextMenu={props.onContextMenu}
            >
              <span
                aria-hidden="true"
                className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-current opacity-70"
              />
              <ChevronRightIcon className={props.expanded ? "size-3.5 rotate-90" : "size-3.5"} />
              {props.isRenaming ? (
                <input
                  autoFocus
                  value={props.renamingValue}
                  onChange={(event) => props.onRenameChange(event.target.value)}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === "Enter") {
                      props.onRenameCommit();
                    }
                    if (event.key === "Escape") {
                      props.onRenameCancel();
                    }
                  }}
                  onBlur={props.onRenameCommit}
                  className="min-w-0 flex-1 rounded border border-ring bg-transparent px-1 text-xs text-foreground outline-none"
                />
              ) : (
                <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground/90">
                  {props.name}
                </span>
              )}
            </SidebarMenuSubButton>
          </SidebarMenuSubItem>
        </div>
      </div>
    </div>
  );
}
