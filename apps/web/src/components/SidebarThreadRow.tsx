import { useDraggable, useDroppable } from "@dnd-kit/core";
import type * as React from "react";

import type { Thread } from "../types";
import { resolveThreadRowClassName } from "./Sidebar.logic";
import { SIDEBAR_COLOR_VALUES, type SidebarColor } from "./Sidebar.organization";
import { SidebarMenuSubButton, SidebarMenuSubItem } from "./ui/sidebar";

export function SidebarThreadRow(props: {
  thread: Thread;
  depth: number;
  effectiveColor: SidebarColor | null;
  isActive: boolean;
  isSelected: boolean;
  dragId: string;
  dropBeforeId: string;
  isRenaming?: boolean;
  renamingValue?: string;
  onClick: (event: React.MouseEvent) => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
  onContextMenu: (event: React.MouseEvent) => void;
  onRenameChange?: (value: string) => void;
  onRenameCommit?: () => void;
  onRenameCancel?: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: props.dragId,
  });
  const beforeDrop = useDroppable({ id: props.dropBeforeId });
  const threadAccent = props.effectiveColor
    ? SIDEBAR_COLOR_VALUES[props.effectiveColor].threadAccent
    : null;

  return (
    <div className="w-full">
      <div
        ref={beforeDrop.setNodeRef}
        data-testid={`sidebar-drop-before-thread-${props.thread.id}`}
        className={beforeDrop.isOver ? "mb-1 h-1 rounded-full bg-primary/45" : "mb-1 h-1"}
      />
      <div ref={setNodeRef}>
        <SidebarMenuSubItem className="w-full" data-thread-item>
          <SidebarMenuSubButton
            render={<div role="button" tabIndex={0} />}
            {...attributes}
            {...listeners}
            data-testid={`sidebar-thread-row-${props.thread.id}`}
            data-sidebar-thread-color={props.effectiveColor ?? "none"}
            className={`${resolveThreadRowClassName({
              isActive: props.isActive,
              isSelected: props.isSelected,
            })} ${isDragging ? "opacity-70" : ""}`}
            style={{
              paddingLeft: `${16 + props.depth * 10}px`,
              ...(threadAccent ? { color: threadAccent } : {}),
            }}
            onClick={props.onClick}
            onKeyDown={props.onKeyDown}
            onContextMenu={props.onContextMenu}
          >
            <span
              aria-hidden="true"
              className="absolute inset-y-1 left-0 w-px rounded-full bg-current opacity-35"
            />
            {props.isRenaming ? (
              <input
                autoFocus
                value={props.renamingValue ?? ""}
                onChange={(event) => props.onRenameChange?.(event.target.value)}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    props.onRenameCommit?.();
                  }
                  if (event.key === "Escape") {
                    props.onRenameCancel?.();
                  }
                }}
                onBlur={() => props.onRenameCommit?.()}
                className="min-w-0 flex-1 rounded border border-ring bg-transparent px-1 text-xs text-foreground outline-none"
              />
            ) : (
              <span className="min-w-0 flex-1 truncate text-xs">{props.thread.title}</span>
            )}
          </SidebarMenuSubButton>
        </SidebarMenuSubItem>
      </div>
    </div>
  );
}
