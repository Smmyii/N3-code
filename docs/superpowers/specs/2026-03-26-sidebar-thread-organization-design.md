# Sidebar Thread Organization Design

## Scope

This spec covers the sidebar organization sub-project only:

- project-local thread folders inside the existing sidebar
- nested subfolders
- subtle color coding for folders and threads
- single-item drag and drop for folders and threads
- local-only persistence that works the same in the desktop AppImage

This spec does not cover:

- multi-project folders
- cloud sync or cross-device sync
- automatic grouping rules
- multi-select drag and drop
- changes to the server orchestration model

## Goal

Turn each project's sidebar thread list into an organization surface that lets the user manually structure threads into nested folders, reorder both folders and threads freely, and apply restrained color accents that improve scanning without making the sidebar noisy.

The result should feel like a durable local workspace layer on top of the existing project/thread model, not a second source of truth for actual thread data.

## User Outcomes

The user can:

- create folders from a project context menu
- create nested subfolders from folder context menus
- rename folders inline
- reorder root-level folders and root-level threads as peers
- drag threads into folders
- drag folders into other folders
- drag items back to project root
- color folders with a subtle but visible accent
- let threads inherit a much fainter folder accent
- override a thread color or remove thread color entirely
- remove a folder without deleting its children
- keep the same organization when the same project `cwd` is removed and later re-added

The user cannot, in V1:

- create folders spanning multiple projects
- sync organization across devices
- drag multiple selected threads together
- auto-group threads by status, date, branch, or other rules

## Product Shape

The existing project sections in the sidebar stay intact.

Inside each expanded project, the flat thread list becomes a mixed organization tree of:

- folders
- threads

Root-level folders and root-level threads are peers. There is no forced `Ungrouped` section.

Visually, folders should follow the user's preferred "section" feel more than a full file-explorer look:

- folder rows read as stronger section blocks
- nested folders still indent, but less aggressively than a code tree
- thread rows remain lightweight
- drag/drop cues may borrow from a more explicit tree style only while dragging

## Architecture

The correct boundary is a separate client-only sidebar organization store layered on top of the existing app store.

### Why this boundary

The actual source of truth for projects and threads already lives in [store.ts](/home/sammy/Documents/T3-code/t3code/apps/web/src/store.ts), and that store is responsible for syncing the server read model into local renderer state.

Sidebar folders and color metadata are different:

- local to this machine
- not part of orchestration state
- keyed by project workspace identity rather than server thread lifecycle
- primarily consumed by the sidebar

Keeping organization metadata in a dedicated store avoids entangling local sidebar concerns with server-synced thread data while still allowing the sidebar to derive a unified visible tree.

### Existing repo primitives to reuse

- the sidebar UI shell already exists in [Sidebar.tsx](/home/sammy/Documents/T3-code/t3code/apps/web/src/components/Sidebar.tsx)
- context menus already exist for projects and threads
- `dnd-kit` is already used for project reordering in the sidebar
- local persistence patterns already exist in [store.ts](/home/sammy/Documents/T3-code/t3code/apps/web/src/store.ts)

V1 should reuse these patterns instead of inventing a new persistence or drag/drop subsystem.

## State Model

### Store location

Create a new client-only store, for example:

- [sidebarOrganizationStore.ts](/home/sammy/Documents/T3-code/t3code/apps/web/src/sidebarOrganizationStore.ts)

This store should persist independently from the main app store.

### Persistence key

Use a dedicated, versioned local persistence key, for example:

- `t3code:sidebar-organization:v1`

The persisted schema should be versioned from day one so later migrations do not require rewriting the feature.

### Project keying

Organization data must be keyed by project `cwd`, not project ID.

Why:

- removing and re-adding the same repository path should restore its folder structure and colors
- project IDs can change across recreation flows
- `cwd` matches the user's mental model of "this repo"

### Suggested types

```ts
type SidebarColor = "slate" | "blue" | "teal" | "emerald" | "amber" | "rose" | "violet";

type SidebarNodeRef = { kind: "folder"; id: string } | { kind: "thread"; id: ThreadId };

type SidebarThreadColorMode = "inherit" | "custom" | "none";

interface SidebarFolder {
  id: string;
  parentFolderId: string | null;
  name: string;
  color: SidebarColor | null;
  childOrder: SidebarNodeRef[];
}

interface SidebarThreadMeta {
  colorMode: SidebarThreadColorMode;
  color: SidebarColor | null;
}

interface SidebarProjectOrganization {
  rootOrder: SidebarNodeRef[];
  foldersById: Record<string, SidebarFolder>;
  threadMetaById: Record<ThreadId, SidebarThreadMeta>;
  expandedFolderIds: string[];
}

interface SidebarOrganizationState {
  projectsByCwd: Record<string, SidebarProjectOrganization>;
}
```

### Semantics

- `rootOrder` contains root-level folders and root-level threads in sidebar order
- `childOrder` contains mixed folder/thread children for one folder
- folders and threads must be reorderable peers within the same parent
- `threadMetaById` stores only visual and placement-adjacent metadata, not thread content
- `expandedFolderIds` is local UI state that still persists for convenience

## Derived Tree Behavior

The visible sidebar tree should be derived from:

- current server-backed threads from [store.ts](/home/sammy/Documents/T3-code/t3code/apps/web/src/store.ts)
- current projects from [store.ts](/home/sammy/Documents/T3-code/t3code/apps/web/src/store.ts)
- local organization metadata from the new sidebar organization store

The derivation layer should:

- match thread IDs from the current project against stored placement metadata
- keep stored folder structure even when some folders are temporarily empty
- prune references to threads that no longer exist
- insert new unseen threads into the project root
- preserve explicit folder and thread ordering wherever possible

New threads with no saved placement should appear at the top of the project root by default.

Pruning dead thread references should happen lazily during derivation or organization updates, then persist back cleanly.

## Sidebar Behavior

### Project rows

Project rows remain the top-level container and keep their current behavior:

- expand/collapse project
- new thread
- existing project context menu

Add one new project-level organization action:

- `New folder`

Project-level `New folder` behavior:

1. create a root-level folder at the top of that project's root order
2. expand it immediately
3. enter inline rename immediately

### Folder rows

Folder rows behave like section rows inside a project:

- expandable/collapsible
- draggable
- renameable inline
- can contain both threads and subfolders

Folder context menu actions:

- `New subfolder`
- `Rename folder`
- `Set color`
- `Clear color`
- `Delete folder`

`New subfolder` behavior:

1. create a child folder at the top of that folder's children
2. ensure the parent folder is expanded
3. enter inline rename immediately

Deleting a folder must not delete its children.

Instead, delete-folder behavior is:

1. remove the folder node
2. promote its children into the deleted folder's parent
3. preserve child order at the deleted folder's position

This same promotion rule applies to nested subfolders.

### Thread rows

Thread rows keep their current navigation and status behavior.

Existing thread context menu actions remain:

- rename thread
- mark unread
- copy path
- copy thread ID
- delete

Add thread color actions:

- `Use folder color`
- `Set color`
- `No color`

V1 does not need a dedicated `Move to folder` menu action because drag/drop covers organization.

## Drag and Drop

### Scope

V1 supports single-item drag only:

- one folder
- or one thread

Multi-select drag remains out of scope even though thread multi-selection already exists for other actions.

### Supported moves

The drag model must support:

- reorder before or after root siblings
- reorder before or after siblings inside a folder
- move a root thread into a folder
- move a folder into another folder
- move a child back out to project root

### Drop cues

The resting UI should stay restrained, but drag state should become more explicit.

While dragging:

- show a clear insertion line for before/after placement
- show a soft folder highlight for "drop inside"
- keep folder drop affordances readable enough that nested organization does not feel guessy

This is the main place where the implementation can borrow the clearer affordances from the more tree-like option without changing the base visual style.

## Color Behavior

### Palette

Use a small curated palette of restrained sidebar accents rather than arbitrary colors.

V1 should treat the palette as design tokens, not user-entered values.

### Folder color

Folder color should be visible but still subtle:

- a left edge accent
- optionally a faint section tint
- never a loud full-row fill

### Thread color

Thread color should always be quieter than folder color.

Preferred presentation:

- a thin left marker or edge accent only
- no obvious full-row background fill

### Inheritance

Thread color resolution rules:

1. if thread mode is `custom`, use the thread's explicit color
2. if thread mode is `none`, show no color even if its folder is colored
3. if thread mode is `inherit`, use the nearest parent folder color
4. if there is no parent folder color, render neutral

This gives the user three meaningful thread states:

- inherit folder organization color
- override with a custom color
- remove color entirely

## Persistence and Cleanup

### Persistence

The sidebar organization store should persist with the same debounce discipline used elsewhere in the app to avoid noisy `localStorage` writes.

### Removal and re-add

If the same project `cwd` is removed and later re-added, the sidebar organization should come back automatically.

### Thread deletion

When a thread is deleted from the app:

- remove its placement references
- remove its thread color metadata
- do not disturb unrelated sibling order more than necessary

### Missing project records

If a project has no organization record yet:

- derive a root-only list from current project threads
- create a project-local organization record lazily on first organization action or first persistence pass

## UI Boundaries

Keep [Sidebar.tsx](/home/sammy/Documents/T3-code/t3code/apps/web/src/components/Sidebar.tsx) as the host, but split organization-specific logic into smaller focused units.

Recommended additions:

- `Sidebar.organization.ts`
  - tree derivation
  - move rules
  - promotion-on-delete logic
  - color resolution helpers
- `SidebarFolderRow.tsx`
  - folder rendering and folder context menu
- `SidebarThreadRow.tsx`
  - thread rendering with inherited/custom/no-color logic
- `SidebarOrganizationTree.tsx`
  - mixed folder/thread rendering for one project

Exact filenames can vary, but the key point is to avoid turning the existing sidebar file into the only place that understands organization rules.

## Testing Strategy

V1 should be covered by:

- unit tests for:
  - tree derivation from server threads plus local metadata
  - new-thread insertion at project root
  - dead-thread pruning
  - folder delete promotion behavior
  - move rules across root and nested folders
  - thread color inheritance, override, and `none`
  - persisted schema migration/loading
- browser/component tests for:
  - creating a folder from project context menu
  - creating a nested subfolder
  - renaming a folder inline
  - dragging a thread into a folder
  - dragging a folder into another folder
  - reordering a root thread above or below a root folder
  - deleting a folder while preserving its children
  - folder accent vs much subtler thread accent rendering

## Out of Scope

Explicitly out of scope for this sub-project:

- multi-project folders
- shared organization across devices
- automatic grouping
- arbitrary freeform color pickers
- multi-select drag and drop
- server-backed sidebar organization state
- replacing existing thread status, PR, or terminal indicators

## Follow-on Work

After this sub-project:

- a later version can add multi-project folder containers on top of the same local organization concepts
- a later version can move from local-only persistence to sync if there is a real need

The local store boundary in this spec is meant to make those future expansions possible without requiring another sidebar redesign first.
