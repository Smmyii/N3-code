import { FileDiff, type FileDiffMetadata, Virtualizer } from "@pierre/diffs/react";
import { ChevronRightIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { Button } from "./ui/button";
import { resolveDiffThemeName } from "../lib/diffRendering";

type DiffThemeType = "light" | "dark";

export function DiffChangesTab(props: {
  renderableFiles: readonly FileDiffMetadata[];
  diffRenderMode: "stacked" | "split";
  diffWordWrap: boolean;
  resolvedTheme: "light" | "dark";
  collapsedFiles: ReadonlySet<string>;
  onToggleFile: (path: string) => void;
  onCollapseAll: () => void;
  onExpandAll: () => void;
  onExpandFile: (path: string) => void;
  onEditFile: (path: string) => void;
  resolveFilePath: (fileDiff: FileDiffMetadata) => string;
  buildFileKey: (fileDiff: FileDiffMetadata) => string;
  unsafeCss: string;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between px-2 py-2">
        <div className="flex items-center gap-2">
          <Button
            size="xs"
            variant="outline"
            onClick={props.onCollapseAll}
            aria-label="Collapse all files"
          >
            Collapse all files
          </Button>
          <Button size="xs" variant="outline" onClick={props.onExpandAll}>
            Expand all files
          </Button>
        </div>
      </div>
      <Virtualizer
        className="h-full min-h-0 overflow-auto px-2 pb-2"
        config={{ overscrollSize: 600, intersectionObserverMargin: 1200 }}
      >
        {props.renderableFiles.map((fileDiff) => {
          const filePath = props.resolveFilePath(fileDiff);
          const collapsed = props.collapsedFiles.has(filePath);
          return (
            <div
              key={`${props.buildFileKey(fileDiff)}:${props.resolvedTheme}`}
              data-diff-file-path={filePath}
              className="mb-2 overflow-hidden rounded-md border border-border/70 bg-card/25"
            >
              <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
                <button
                  type="button"
                  className="flex min-w-0 items-center gap-2 text-left"
                  onClick={() => props.onToggleFile(filePath)}
                >
                  <ChevronRightIcon
                    className={cn("size-3.5 transition-transform", !collapsed && "rotate-90")}
                  />
                  <span className="truncate font-mono text-xs">{filePath}</span>
                </button>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    size="xs"
                    variant="outline"
                    aria-label={`Expand ${filePath}`}
                    onClick={() => props.onExpandFile(filePath)}
                  >
                    Expand
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    aria-label={`Edit ${filePath}`}
                    onClick={() => props.onEditFile(filePath)}
                  >
                    Edit
                  </Button>
                </div>
              </div>
              {!collapsed ? (
                <div className="overflow-x-auto">
                  <div className="min-w-max">
                    <FileDiff
                      fileDiff={fileDiff}
                      options={{
                        diffStyle: props.diffRenderMode === "split" ? "split" : "unified",
                        lineDiffType: "none",
                        overflow: props.diffWordWrap ? "wrap" : "scroll",
                        theme: resolveDiffThemeName(props.resolvedTheme),
                        themeType: props.resolvedTheme as DiffThemeType,
                        unsafeCSS: props.unsafeCss,
                      }}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </Virtualizer>
    </div>
  );
}
