import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { type ProjectEntry } from "@t3tools/contracts";
import { buildProjectEntryTree, type ProjectEntryTreeNode } from "../lib/projectEntryTree";
import { projectSearchEntriesQueryOptions } from "../lib/projectReactQuery";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function DiffFilesTab(props: {
  workspaceRoot: string | null;
  onOpenFile: (relativePath: string) => void;
}) {
  const [query, setQuery] = useState("");
  const entriesQuery = useQuery(
    projectSearchEntriesQueryOptions({
      cwd: props.workspaceRoot,
      query,
      allowEmptyQuery: true,
      limit: 2000,
      staleTime: 30_000,
    }),
  );
  const tree = useMemo(
    () => buildProjectEntryTree((entriesQuery.data?.entries ?? []) as readonly ProjectEntry[]),
    [entriesQuery.data?.entries],
  );

  const renderNode = (node: ProjectEntryTreeNode, depth: number): React.ReactNode => {
    const paddingLeft = 8 + depth * 14;
    if (node.kind === "directory") {
      return (
        <div key={node.path}>
          <div
            className="px-2 py-1 text-[11px] font-medium text-muted-foreground"
            style={{ paddingLeft }}
          >
            {node.name}
          </div>
          {node.children.map((child) => renderNode(child, depth + 1))}
        </div>
      );
    }

    return (
      <Button
        key={node.path}
        type="button"
        size="xs"
        variant="ghost"
        className="flex w-full justify-start rounded-md font-mono text-xs"
        style={{ paddingLeft }}
        aria-label={node.path}
        onClick={() => props.onOpenFile(node.path)}
      >
        {node.path}
      </Button>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border/70 px-3 py-2">
        <Input
          aria-label="Filter files"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter files"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
        {!props.workspaceRoot ? (
          <p className="px-2 py-4 text-xs text-muted-foreground/70">
            Workspace files are unavailable.
          </p>
        ) : tree.length > 0 ? (
          tree.map((node) => renderNode(node, 0))
        ) : (
          <p className="px-2 py-4 text-xs text-muted-foreground/70">
            {entriesQuery.isLoading ? "Loading files..." : "No matching files."}
          </p>
        )}
        {entriesQuery.data?.truncated ? (
          <p className="px-2 py-3 text-[11px] text-muted-foreground/70">
            Results truncated. Refine the filter to narrow the file list.
          </p>
        ) : null}
      </div>
    </div>
  );
}
