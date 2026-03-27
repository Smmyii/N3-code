import { type TurnId } from "@t3tools/contracts";
import { ChevronLeftIcon, ChevronRightIcon, EllipsisIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { TurnDiffSummary } from "../types";
import { Button } from "./ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { cn } from "~/lib/utils";
import type { DiffWorkspaceTab } from "../diffRouteSearch";

interface DiffWorkspaceHeaderProps {
  activeTab: DiffWorkspaceTab;
  quickTurns: ReadonlyArray<TurnDiffSummary>;
  olderTurns: ReadonlyArray<TurnDiffSummary>;
  selectedTurnId: TurnId | null;
  onSelectTab: (tab: DiffWorkspaceTab) => void;
  onSelectTurn: (turnId: TurnId | null) => void;
  onStepTurn: (direction: "previous" | "next") => void;
  actions?: ReactNode;
}

function turnLabel(turn: TurnDiffSummary): string {
  return `Turn ${turn.checkpointTurnCount ?? "?"}`;
}

export function DiffWorkspaceHeader(props: DiffWorkspaceHeaderProps) {
  return (
    <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Previous turn"
            onClick={() => props.onStepTurn("previous")}
          >
            <ChevronLeftIcon className="size-3.5" />
          </Button>
          <Button
            size="xs"
            variant={props.selectedTurnId === null ? "default" : "outline"}
            onClick={() => props.onSelectTurn(null)}
          >
            All turns
          </Button>
          {props.quickTurns.map((turn) => (
            <Button
              key={turn.turnId}
              size="xs"
              variant={props.selectedTurnId === turn.turnId ? "default" : "outline"}
              className={cn("hidden md:inline-flex")}
              onClick={() => props.onSelectTurn(turn.turnId)}
            >
              {turnLabel(turn)}
            </Button>
          ))}
          <Menu>
            <MenuTrigger
              render={
                <Button size="xs" variant="ghost" aria-label="More turns">
                  <EllipsisIcon className="size-3.5" />
                  More
                </Button>
              }
            />
            <MenuPopup align="start">
              <MenuItem onClick={() => props.onSelectTurn(null)}>All turns</MenuItem>
              {props.quickTurns.map((turn) => (
                <MenuItem key={turn.turnId} onClick={() => props.onSelectTurn(turn.turnId)}>
                  {turnLabel(turn)}
                </MenuItem>
              ))}
              {props.olderTurns.map((turn) => (
                <MenuItem key={turn.turnId} onClick={() => props.onSelectTurn(turn.turnId)}>
                  {turnLabel(turn)}
                </MenuItem>
              ))}
              {props.quickTurns.length === 0 && props.olderTurns.length === 0 ? (
                <MenuItem disabled>No turns</MenuItem>
              ) : null}
            </MenuPopup>
          </Menu>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Next turn"
            onClick={() => props.onStepTurn("next")}
          >
            <ChevronRightIcon className="size-3.5" />
          </Button>
        </div>
        <Tabs
          value={props.activeTab}
          onValueChange={(value) => props.onSelectTab(value as DiffWorkspaceTab)}
        >
          <TabsList className="border-b-0">
            <TabsTrigger value="changes">Changes</TabsTrigger>
            <TabsTrigger value="files">Files</TabsTrigger>
            <TabsTrigger value="editor">Editor</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {props.actions ? (
        <div className="flex shrink-0 items-center gap-1">{props.actions}</div>
      ) : null}
    </div>
  );
}
