import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import ChatMarkdown from "./ChatMarkdown";
import type { DiffWorkspaceFileMode } from "../diffRouteSearch";
import { ensureNativeApi } from "../nativeApi";
import { resolveWorkspaceFileCapabilities, toWorkspaceRelativePath } from "../lib/fileWorkspace";
import { projectQueryKeys } from "../lib/projectReactQuery";
import { providerQueryKeys } from "../lib/providerReactQuery";
import { Button } from "./ui/button";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Textarea } from "./ui/textarea";

export function FocusedFileSurface(props: {
  workspaceRoot: string;
  filePath: string;
  mode: DiffWorkspaceFileMode;
  onChangeMode: (mode: DiffWorkspaceFileMode) => void;
  onBackToChanges: () => void;
}) {
  const api = ensureNativeApi();
  const queryClient = useQueryClient();
  const relativePath = toWorkspaceRelativePath(props.workspaceRoot, props.filePath);
  const capabilities = resolveWorkspaceFileCapabilities(relativePath ?? props.filePath);
  const [draft, setDraft] = useState("");
  const [savedText, setSavedText] = useState("");
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false);

  const fileQuery = useQuery({
    queryKey: ["workspace-file", props.workspaceRoot, relativePath],
    enabled: relativePath !== null,
    queryFn: async () => {
      if (!relativePath) {
        throw new Error("File is outside the active workspace.");
      }
      return api.projects.readFile({ cwd: props.workspaceRoot, relativePath });
    },
  });

  useEffect(() => {
    if (!fileQuery.data?.exists) {
      return;
    }
    setDraft(fileQuery.data.contents);
    setSavedText(fileQuery.data.contents);
  }, [fileQuery.data]);

  const dirty = draft !== savedText;

  const confirmSave = async () => {
    if (!relativePath) {
      return;
    }
    await api.projects.writeFile({
      cwd: props.workspaceRoot,
      relativePath,
      contents: draft,
    });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: providerQueryKeys.all }),
      queryClient.invalidateQueries({ queryKey: projectQueryKeys.all }),
      queryClient.invalidateQueries({
        queryKey: ["workspace-file", props.workspaceRoot, relativePath],
      }),
    ]);
    const refreshed = await api.projects.readFile({ cwd: props.workspaceRoot, relativePath });
    setDraft(refreshed.contents);
    setSavedText(refreshed.contents);
    setSaveConfirmOpen(false);
    props.onChangeMode("preview");
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border/70 px-3 py-2">
        <Button size="xs" variant="ghost" onClick={props.onBackToChanges}>
          Back to diffs
        </Button>
        <div className="flex items-center gap-2">
          {capabilities.canEdit && props.mode === "preview" ? (
            <Button size="xs" variant="outline" onClick={() => props.onChangeMode("edit")}>
              Edit file
            </Button>
          ) : null}
          {capabilities.canEdit && props.mode === "edit" ? (
            <Button
              size="xs"
              variant="default"
              onClick={() => setSaveConfirmOpen(true)}
              disabled={!dirty}
            >
              Save file
            </Button>
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {!relativePath ? (
          <div className="p-4 text-xs text-muted-foreground/70">
            File is outside the active workspace.
          </div>
        ) : fileQuery.isLoading ? (
          <div className="p-4 text-xs text-muted-foreground/70">Loading file...</div>
        ) : fileQuery.error ? (
          <div className="p-4 text-xs text-red-500/80">
            {fileQuery.error instanceof Error ? fileQuery.error.message : "Failed to load file."}
          </div>
        ) : !fileQuery.data?.exists ? (
          <div className="p-4 text-xs text-muted-foreground/70">File not found.</div>
        ) : !capabilities.canPreview ? (
          <div className="p-4 text-xs text-muted-foreground/70">
            This file type is not supported for in-app preview.
          </div>
        ) : props.mode === "edit" ? (
          <div className="h-full p-3">
            <Textarea
              aria-label="File contents"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="h-full min-h-full rounded-none border-0 font-mono text-sm"
              unstyled
            />
          </div>
        ) : capabilities.previewKind === "markdown" ? (
          <div className="p-4">
            <ChatMarkdown text={draft} cwd={props.workspaceRoot} />
          </div>
        ) : (
          <pre className="min-h-0 whitespace-pre-wrap p-4 font-mono text-sm">{draft}</pre>
        )}
      </div>
      <AlertDialog open={saveConfirmOpen} onOpenChange={setSaveConfirmOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Write changes to {relativePath}?</AlertDialogTitle>
            <AlertDialogDescription>
              The file will be updated inside the active workspace and the diff view will refresh.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button onClick={() => void confirmSave()}>Confirm save</Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}
