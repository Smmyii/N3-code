import { ChevronRightIcon } from "lucide-react";
import type * as React from "react";

import type { SidebarColor } from "./Sidebar.organization";
import { SidebarMenuSubButton, SidebarMenuSubItem } from "./ui/sidebar";

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
              if (event.key === "Enter") {
                props.onRenameCommit();
              }
              if (event.key === "Escape") {
                props.onRenameCancel();
              }
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
