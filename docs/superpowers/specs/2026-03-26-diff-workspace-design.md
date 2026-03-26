# Diff Workspace Design

## Scope

This spec covers the first sub-project only:

- expanding the current diff viewer into a shared in-house file workspace
- adding lightweight in-app file viewing/editing
- adding an in-panel file explorer
- reorganizing the diff panel header so it can support this workspace cleanly

This spec does not cover:

- Task 1: provider health false-negative fixes
- Task 3: sidebar folder/color organization
- a full IDE-style code editor
- file creation, rename, delete, move, or arbitrary workspace management

## Goal

Turn the current diff panel into a compact workspace surface that can:

- keep the existing diff workflow intact
- let the user open a changed file into a focused in-app viewer/editor
- let the user open AI-sent file links in-app as an additional action alongside external editor opening
- provide a lightweight file explorer in the same panel area
- support small edits for plan and workspace text files without forcing a round-trip to Cursor, VS Code, or Finder

The result should feel like a focused extension of the existing diff viewer, not a separate application hidden inside the app.

## User Outcomes

The user can:

- inspect diffs with horizontal scrolling by default instead of clipped long lines
- collapse and expand individual file diffs
- choose a changed file and make it the main focus of the panel with `Expand`
- edit `.md`, `.txt`, and `.env`-family files in-app with a confirmation before writing changes
- open a file from chat links directly into the same in-app workspace
- browse the workspace in a `Files` tab without leaving the current panel

The user cannot, in V1:

- do arbitrary code editing beyond viewing non-eligible text files
- edit binary assets
- manage multiple open editor tabs
- create or delete files

## Product Shape

The current diff viewer becomes a three-tab workspace inside the same panel shell:

- `Changes`
- `Files`
- `Editor`

The top rail is reorganized to stop spending most of its width on turn chips.

### Header Layout

The header should contain:

- turn controls:
  - `All turns`
  - the previous two turn chips relative to the current selection
  - when `All turns` is selected, the two most recent completed turns become the quick-access chips
  - `More` dropdown for older turns
  - existing prev/next arrows
- workspace tabs:
  - `Changes`
  - `Files`
  - `Editor`
- context-sensitive controls:
  - diff view/wrap controls only when the `Changes` tab is active
  - explorer filter controls only when the `Files` tab is active
  - file actions only when the `Editor` tab is active

This header is intentionally designed as a future expansion rail. More workspace modes can be added later without repeating another layout rewrite.

## Architecture

The correct boundary is a shared in-app file surface hosted inside the diff panel shell.

### Why this boundary

The user wants the same in-app file experience from three entry points:

- changed files in the diff view
- inline file links in assistant messages
- the new file explorer

If the focused viewer/editor is implemented only inside the diff list, the same logic would need to be extracted later for chat links and the explorer. Building the shared surface now is the smallest design that avoids that rewrite.

### Existing repo primitives to reuse

- workspace-scoped `readFile` and `writeFile` APIs already exist
- workspace search/indexing already exists
- changed-file tree rendering patterns already exist
- current route search already controls diff panel open/close and selected turn/file context

V1 should compose these primitives rather than introducing a second file-access subsystem.

## Components

### `DiffPanel`

`apps/web/src/components/DiffPanel.tsx`

Responsibilities:

- remain the host container for the right-side workspace
- load diff data and current turn selection
- coordinate panel tabs and focused file routing state
- delegate actual content rendering to smaller tab/view components

`DiffPanel` should stop directly owning every visual mode inline.

### `DiffWorkspaceHeader`

New header composition component hosted by `DiffPanel`.

Responsibilities:

- compact turn controls
- tab switching
- context-sensitive controls
- preserving current diff open/close behavior

### `DiffChangesTab`

Responsibilities:

- current diff content rendering
- per-file collapse/expand
- default horizontal scrolling for long lines
- file-level `Expand` and `Edit` entry points
- preserving current “open file in external editor” behavior where applicable

### `DiffFilesTab`

Responsibilities:

- lightweight workspace explorer in the same panel
- tree/list rendering built from workspace entry data
- search/filter support
- opening the shared focused file surface

V1 should build the explorer from workspace entry indexing and client-side tree construction. It should use the existing workspace entry index, fetched for the active workspace and rendered into a client-side directory tree. V1 does not require a dedicated new server-side file-tree API.

### `FocusedFileSurface`

Shared viewer/editor surface used by:

- `Changes`
- `Files`
- inline file links from chat

Responsibilities:

- file loading
- read-only preview
- edit eligibility checks
- text editing state
- unsaved-changes handling
- save confirmation
- writing to disk
- refreshing dependent views after save

This should be lightweight. V1 uses a textarea-style editor, not Monaco, CodeMirror, or a full code IDE surface.

### `ChatMarkdown` link actions

`apps/web/src/components/ChatMarkdown.tsx`

Current file links open externally. V1 should add an in-app action alongside the current external behavior.

The user should be able to choose:

- `Open in app`
- external open using the current preferred editor workflow

`Open in app` should open the shared focused file surface in the diff workspace panel, not a separate modal.

## Routing and State

### Route-level state

The existing diff route search should be extended to cover workspace navigation so that different entry points can open the same panel state.

The route search should represent:

- whether the diff workspace is open
- selected turn, when relevant
- selected file path
- selected tab: `changes | files | editor`
- selected file mode: `preview | edit`

Examples:

- opening a changed file into diff context:
  - `diff=1`
  - `diffTurnId=<turn>`
  - `diffFilePath=<path>`
  - `diffTab=changes`
- opening a chat file link in-app:
  - `diff=1`
  - `diffFilePath=<path>`
  - `diffTab=editor`
  - no turn-specific requirement
- opening from explorer:
  - `diff=1`
  - `diffTab=editor`
  - `diffFilePath=<path>`

This keeps in-app file openings navigable, bookmarkable, and internally consistent.

### Local component state

Ephemeral state should remain local to the focused file surface or explorer:

- draft text
- save confirmation dialog visibility
- unsaved-changes prompt visibility
- local filter text
- transient expanded/collapsed UI state

V1 should not introduce a new global Zustand store for editor state.

## Changes Tab Behavior

### Default line behavior

Long lines should be horizontally scrollable by default. Wrapping remains optional through the existing wrap toggle.

This applies both to:

- rendered file diffs
- raw fallback patch rendering

### File collapse behavior

Each file diff should support collapse/expand.

Collapsed state shows only:

- file header
- path
- change stats
- file actions

Expanded state shows the rendered diff body.

Global controls should support:

- `Collapse all`
- `Expand all`

### File actions

Each changed file row should expose actions for:

- `Expand`
- `Edit`
- external open where relevant

Action behavior:

- `Expand` promotes the file into the shared focused file surface as the main body of the panel
- `Edit` opens the same focused file surface directly into edit mode if the file is eligible
- if the file is not editable, `Edit` is unavailable or replaced with read-only preview behavior

## Files Tab Behavior

The `Files` tab is a lightweight explorer, not a full file manager.

### V1 contents

It should show:

- directories
- files
- filter/search input
- a client-side tree built from indexed workspace entries

### V1 expectations

It should support:

- browsing
- filtering
- opening files into the shared focused file surface

It does not need:

- drag and drop
- context menus
- create/rename/delete
- multi-select

## Focused File Surface Behavior

### Opening

The focused file surface opens from:

- `Changes` tab actions
- `Files` tab selection
- chat file-link in-app action

When open, the `Editor` tab becomes active.

If the user activates `Editor` without a selected file, show an empty state:

“Open a changed file or choose one from Files.”

### Preview mode

The initial state is read-only preview.

The surface should display:

- file path
- source context:
  - changed file
  - explorer
  - chat link
- relevant actions:
  - `Back to diffs` or equivalent return affordance
  - `Edit` when eligible
  - external open action

### Edit eligibility

Editable in V1:

- `*.md`
- `*.txt`
- `.env`
- `.env.*`

View-only in V1:

- other plain text files that can be safely rendered as text

Not viewable/editable in-app in V1:

- binary assets
- unsupported files

### Edit mode

Edit mode should use a lightweight text editor surface sized for small edits.

It should support:

- cursor-based editing
- scrolling
- preserving line breaks exactly
- canceling out of edit mode

It does not need:

- syntax-aware code editing
- lint integration
- inline diagnostics
- command palettes

### Save flow

The save flow is:

1. user edits file
2. clicks `Save`
3. confirmation dialog appears
4. on confirm:
   - write file to disk
   - reload file contents
   - invalidate/refresh related diff state
5. editor remains on the file with updated content

If save fails:

- keep draft text intact
- show a clear error toast or inline error state
- do not exit edit mode

### Cancel and unsaved changes

If the user attempts to leave edit mode or switch away with unsaved changes:

- show an unsaved-changes confirmation
- allow:
  - stay
  - discard changes

V1 should not auto-save.

## Chat Link Behavior

File links rendered in assistant messages should stop being single-path external launch actions.

For workspace-resolved file links:

- keep external open behavior available
- add in-app open behavior

The exact UI affordance can be a small adjacent action or link menu, but the in-app path must not remove the external option in V1.

If a link resolves outside the workspace or cannot be resolved safely:

- keep current external fallback behavior only

## Diff Refresh and Data Consistency

After a confirmed write:

- the focused file surface should reload file contents from disk
- the `Changes` tab should reflect updated diffs without requiring a full app reload
- if a changed file becomes clean, it should disappear from the changed-files view naturally on refresh

Consistency requirements:

- `Editor` must never show stale draft text after a confirmed successful reload
- route state must continue pointing at the same file path after save
- if the file no longer exists or becomes unreadable, the surface must show a controlled error state

## Error Handling

### Workspace access errors

If file read or write fails:

- show a clear error message
- keep the panel open
- avoid losing the current draft on write failure

### Unsupported file types

If the file is not viewable in-app:

- show a non-destructive unsupported-file message
- provide external-open action

### Missing files

If a file path from chat link or diff no longer exists:

- show a “file not found” state in the focused file surface
- allow the user to return to `Changes` or `Files`

## Testing Strategy

V1 should be covered by:

- unit tests for:
  - edit eligibility rules
  - route-state parsing/serialization
  - file-surface mode transitions
- browser/component tests for:
  - opening a changed file into the focused surface
  - opening a chat file link in-app
  - save confirmation flow
  - unsaved-changes confirmation flow
  - header turn overflow behavior
  - `Changes / Files / Editor` tab transitions
- regression coverage for:
  - default horizontal scroll behavior in diffs
  - per-file collapse/expand behavior

## Out of Scope

Explicitly out of scope for this sub-project:

- editing arbitrary code files in-app
- multi-file editor tabs
- a full code editor framework
- terminal integration inside the editor
- file creation/deletion/rename/move
- replacing external editor actions
- provider health fixes
- sidebar folder/color organization

## Follow-on Work

After this sub-project:

- Task 1 can proceed as a small server/client bugfix track
- Task 3 can proceed as a separate sidebar-organization track

The shared in-house file surface from this spec becomes the foundation for any future richer workspace tools.
