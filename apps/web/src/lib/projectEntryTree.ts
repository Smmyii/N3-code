import type { ProjectEntry } from "@t3tools/contracts";

export type ProjectEntryTreeNode =
  | { kind: "directory"; name: string; path: string; children: ProjectEntryTreeNode[] }
  | { kind: "file"; name: string; path: string };

function basenameOf(pathValue: string): string {
  const segments = pathValue.split("/");
  return segments[segments.length - 1] ?? pathValue;
}

export function buildProjectEntryTree(entries: readonly ProjectEntry[]): ProjectEntryTreeNode[] {
  const directoryChildren = new Map<string, ProjectEntryTreeNode[]>();

  for (const entry of entries) {
    const parentPath = entry.parentPath ?? "";
    const siblings = directoryChildren.get(parentPath) ?? [];
    siblings.push(
      entry.kind === "directory"
        ? {
            kind: "directory",
            name: basenameOf(entry.path),
            path: entry.path,
            children: [],
          }
        : {
            kind: "file",
            name: basenameOf(entry.path),
            path: entry.path,
          },
    );
    directoryChildren.set(parentPath, siblings);
  }

  const attachChildren = (parentPath: string): ProjectEntryTreeNode[] =>
    (directoryChildren.get(parentPath) ?? [])
      .map((node) =>
        node.kind === "directory" ? { ...node, children: attachChildren(node.path) } : node,
      )
      .toSorted((left, right) => {
        if (left.kind !== right.kind) {
          return left.kind === "file" ? -1 : 1;
        }
        return left.path.localeCompare(right.path);
      });

  return attachChildren("");
}
