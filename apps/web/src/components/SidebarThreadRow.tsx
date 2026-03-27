import { useDraggable, useDroppable } from "@dnd-kit/core";
import { GitPullRequestIcon, TerminalIcon } from "lucide-react";
import type * as React from "react";

import type { Thread } from "../types";
import { type ThreadStatusPill, resolveThreadRowClassName } from "./Sidebar.logic";
import { SIDEBAR_COLOR_VALUES, type SidebarColor } from "./Sidebar.organization";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { SidebarMenuSubButton, SidebarMenuSubItem } from "./ui/sidebar";

export function SidebarThreadRow(props: {
  thread: Thread;
  depth: number;
  effectiveColor: SidebarColor | null;
  isActive: boolean;
  isSelected: boolean;
  dragId: string;
  dropBeforeId: string;
  threadStatus: ThreadStatusPill | null;
  terminalStatus: { label: string; colorClass: string; pulse: boolean } | null;
  prStatus: { tooltip: string; url: string; colorClass: string } | null;
  relativeTimeLabel: string;
  isRenaming?: boolean;
  renamingValue?: string;
  onClick: (event: React.MouseEvent) => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
  onContextMenu: (event: React.MouseEvent) => void;
  onPrClick?: (event: React.MouseEvent<HTMLElement>, url: string) => void;
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
  const isHighlighted = props.isActive || props.isSelected;

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
            style={{ paddingLeft: `${16 + props.depth * 10}px` }}
            onClick={props.onClick}
            onKeyDown={props.onKeyDown}
            onContextMenu={props.onContextMenu}
          >
            <span
              aria-hidden="true"
              className="absolute inset-y-1 left-0 w-px rounded-full opacity-35"
              style={threadAccent ? { backgroundColor: threadAccent } : undefined}
            />
            <div className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
              {props.prStatus && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-label={props.prStatus.tooltip}
                        className={`inline-flex items-center justify-center ${props.prStatus.colorClass} cursor-pointer rounded-sm outline-hidden focus-visible:ring-1 focus-visible:ring-ring`}
                        onClick={(event) => props.onPrClick?.(event, props.prStatus!.url)}
                      >
                        <GitPullRequestIcon className="size-3" />
                      </button>
                    }
                  />
                  <TooltipPopup side="top">{props.prStatus.tooltip}</TooltipPopup>
                </Tooltip>
              )}
              {props.threadStatus && (
                <span
                  className={`inline-flex items-center gap-1 text-[10px] ${props.threadStatus.colorClass}`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${props.threadStatus.dotClass} ${
                      props.threadStatus.pulse ? "animate-pulse" : ""
                    }`}
                  />
                  <span className="hidden md:inline">{props.threadStatus.label}</span>
                </span>
              )}
              {props.isRenaming ? (
                <input
                  autoFocus
                  value={props.renamingValue ?? ""}
                  onChange={(event) => props.onRenameChange?.(event.target.value)}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    event.stopPropagation();
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
                <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                  {props.thread.title}
                </span>
              )}
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              {props.terminalStatus && (
                <span
                  role="img"
                  aria-label={props.terminalStatus.label}
                  title={props.terminalStatus.label}
                  className={`inline-flex items-center justify-center ${props.terminalStatus.colorClass}`}
                >
                  <TerminalIcon
                    className={`size-3 ${props.terminalStatus.pulse ? "animate-pulse" : ""}`}
                  />
                </span>
              )}
              <span
                className={`text-[10px] ${
                  isHighlighted
                    ? "text-foreground/72 dark:text-foreground/82"
                    : "text-muted-foreground/40"
                }`}
              >
                {props.relativeTimeLabel}
              </span>
            </div>
          </SidebarMenuSubButton>
        </SidebarMenuSubItem>
      </div>
    </div>
  );
}
