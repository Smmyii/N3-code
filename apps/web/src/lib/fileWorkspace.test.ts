import { describe, expect, it } from "vitest";

import { resolveWorkspaceFileCapabilities, toWorkspaceRelativePath } from "./fileWorkspace";

describe("resolveWorkspaceFileCapabilities", () => {
  it("marks markdown, text, and env files editable", () => {
    expect(resolveWorkspaceFileCapabilities("docs/plan.md").canEdit).toBe(true);
    expect(resolveWorkspaceFileCapabilities("notes/todo.txt").canEdit).toBe(true);
    expect(resolveWorkspaceFileCapabilities(".env.production").canEdit).toBe(true);
  });

  it("marks code files viewable but read-only", () => {
    expect(resolveWorkspaceFileCapabilities("src/app.ts").canPreview).toBe(true);
    expect(resolveWorkspaceFileCapabilities("src/app.ts").canEdit).toBe(false);
  });

  it("blocks binary assets", () => {
    expect(resolveWorkspaceFileCapabilities("static/thumbnail.png")).toEqual({
      canPreview: false,
      canEdit: false,
      previewKind: "unsupported",
    });
  });
});

describe("toWorkspaceRelativePath", () => {
  it("strips line-column suffixes and returns a workspace-relative path", () => {
    expect(toWorkspaceRelativePath("/repo/project", "/repo/project/docs/plan.md:42:7")).toBe(
      "docs/plan.md",
    );
  });

  it("returns null when the target escapes the workspace root", () => {
    expect(toWorkspaceRelativePath("/repo/project", "/repo/other/notes.md")).toBeNull();
  });
});
