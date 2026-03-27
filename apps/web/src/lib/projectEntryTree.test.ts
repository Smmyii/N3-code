import { describe, expect, it } from "vitest";

import { buildProjectEntryTree } from "./projectEntryTree";

describe("buildProjectEntryTree", () => {
  it("builds nested directory nodes from flat project entries", () => {
    const tree = buildProjectEntryTree([
      { path: "docs", kind: "directory" },
      { path: "docs/superpowers", kind: "directory", parentPath: "docs" },
      {
        path: "docs/superpowers/spec.md",
        kind: "file",
        parentPath: "docs/superpowers",
      },
      { path: ".env", kind: "file" },
    ]);

    expect(tree.map((node) => node.path)).toEqual([".env", "docs"]);
    expect(tree[1]?.kind).toBe("directory");
    expect(
      tree[1]?.kind === "directory" ? tree[1].children.map((child) => child.path) : [],
    ).toEqual(["docs/superpowers"]);
  });
});
