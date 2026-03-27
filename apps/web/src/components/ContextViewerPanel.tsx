import { memo, useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import ChatMarkdown from "./ChatMarkdown";
import { readNativeApi } from "../nativeApi";

interface ContextFileSection {
  label: string;
  relativePath: string;
  renderAs: "markdown" | "json";
}

const CONTEXT_FILES: ContextFileSection[] = [
  { label: "CLAUDE.md", relativePath: "CLAUDE.md", renderAs: "markdown" },
  { label: ".claude/settings.json", relativePath: ".claude/settings.json", renderAs: "json" },
  {
    label: ".claude/settings.local.json",
    relativePath: ".claude/settings.local.json",
    renderAs: "json",
  },
];

interface FileState {
  contents: string;
  exists: boolean;
  loading: boolean;
  error: string | null;
}

interface ContextViewerPanelProps {
  cwd: string;
}

function ContextViewerPanel({ cwd }: ContextViewerPanelProps) {
  const [fileStates, setFileStates] = useState<Record<string, FileState>>({});
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const fetchFile = useCallback(
    async (relativePath: string) => {
      const api = readNativeApi();
      if (!api) return;

      setFileStates((prev) => ({
        ...prev,
        [relativePath]: {
          contents: prev[relativePath]?.contents ?? "",
          exists: prev[relativePath]?.exists ?? false,
          loading: true,
          error: null,
        },
      }));

      try {
        const result = await api.projects.readFile({ cwd, relativePath });
        setFileStates((prev) => ({
          ...prev,
          [relativePath]: {
            contents: result.contents,
            exists: result.exists,
            loading: false,
            error: null,
          },
        }));
      } catch (err) {
        setFileStates((prev) => ({
          ...prev,
          [relativePath]: {
            contents: "",
            exists: false,
            loading: false,
            error: err instanceof Error ? err.message : "Failed to load file",
          },
        }));
      }
    },
    [cwd],
  );

  const fetchAll = useCallback(() => {
    for (const file of CONTEXT_FILES) {
      fetchFile(file.relativePath);
    }
  }, [fetchFile]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const toggleCollapse = useCallback((relativePath: string) => {
    setCollapsed((prev) => ({ ...prev, [relativePath]: !prev[relativePath] }));
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/80 px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Project Context
        </span>
        <button
          type="button"
          className="inline-flex items-center justify-center rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={fetchAll}
          aria-label="Refresh all context files"
        >
          <RefreshCw className="size-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {CONTEXT_FILES.map((file) => {
          const state = fileStates[file.relativePath];
          const isCollapsed = collapsed[file.relativePath] ?? false;

          return (
            <div key={file.relativePath} className="border-b border-border/50">
              <button
                type="button"
                className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs font-medium text-foreground/90 transition-colors hover:bg-accent/50"
                onClick={() => toggleCollapse(file.relativePath)}
              >
                {isCollapsed ? (
                  <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
                )}
                <span className="font-mono">{file.label}</span>
                {state && !state.loading && !state.exists && (
                  <span className="ml-auto text-[10px] text-muted-foreground/60">not found</span>
                )}
              </button>

              {!isCollapsed && (
                <div className="px-3 pb-3">
                  {!state || state.loading ? (
                    <div className="text-xs text-muted-foreground/60 italic">Loading...</div>
                  ) : state.error ? (
                    <div className="text-xs text-red-400">{state.error}</div>
                  ) : !state.exists ? (
                    <div className="text-xs text-muted-foreground/50 italic">File not found</div>
                  ) : file.renderAs === "markdown" ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none text-xs [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-xs [&_p]:text-xs [&_li]:text-xs [&_pre]:text-[11px] [&_code]:text-[11px]">
                      <ChatMarkdown text={state.contents} cwd={cwd} />
                    </div>
                  ) : (
                    <pre className="overflow-x-auto rounded bg-muted/30 p-2 text-[11px] leading-relaxed text-foreground/80 font-mono">
                      {formatJsonSafe(state.contents)}
                    </pre>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default memo(ContextViewerPanel);

function formatJsonSafe(contents: string): string {
  try {
    return JSON.stringify(JSON.parse(contents), null, 2);
  } catch {
    return contents;
  }
}
