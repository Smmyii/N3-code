import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SidebarOrganizationTree } from "./SidebarOrganizationTree";
import { SidebarProvider } from "./ui/sidebar";

describe("SidebarOrganizationTree", () => {
  it("renders folders with stronger accents and threads with subtler inherited accents", () => {
    const html = renderToStaticMarkup(
      <SidebarProvider>
        <SidebarOrganizationTree
          nodes={[
            {
              kind: "folder",
              folderId: "folder-1",
              name: "Plans",
              depth: 0,
              color: "teal",
              parentFolderId: null,
              children: [
                {
                  kind: "thread",
                  thread: {
                    id: "thread-1",
                    title: "Roadmap",
                    createdAt: "2026-03-26T00:00:00.000Z",
                  } as never,
                  depth: 1,
                  parentFolderId: "folder-1",
                  effectiveColor: "teal",
                  colorMode: "inherit",
                },
              ],
            },
          ]}
          expandedFolderIds={["folder-1"]}
          activeThreadId={null}
          selectedThreadIds={new Set()}
          onFolderToggle={() => {}}
          onFolderContextMenu={() => {}}
          onThreadClick={() => {}}
          onThreadContextMenu={() => {}}
        />
      </SidebarProvider>,
    );

    expect(html).toContain('data-testid="sidebar-folder-row-folder-1"');
    expect(html).toContain('data-sidebar-color="teal"');
    expect(html).toContain('data-testid="sidebar-thread-row-thread-1"');
    expect(html).toContain('data-sidebar-thread-color="teal"');
  });
});
