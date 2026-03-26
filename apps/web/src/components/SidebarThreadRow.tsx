import type * as React from "react";

import type { Thread } from "../types";
import { resolveThreadRowClassName } from "./Sidebar.logic";
import type { SidebarColor } from "./Sidebar.organization";
import { SidebarMenuSubButton, SidebarMenuSubItem } from "./ui/sidebar";

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
        <span
          aria-hidden="true"
          className="absolute inset-y-1 left-0 w-px rounded-full bg-current opacity-35"
        />
        <span className="min-w-0 flex-1 truncate text-xs">{props.thread.title}</span>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  );
}
