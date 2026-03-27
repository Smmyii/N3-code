# Implementation Brief — t3.code Fork Improvements

This brief is for delegated implementation sessions. The codebase is at `/home/sammy/Documents/T3-code/t3code`.

**Build command:** `bun run build` (must pass 5/5 tasks)
**Effect API note:** This codebase uses a custom Effect fork where error handling is `Effect.catch()` NOT `Effect.catchAll()`.

---

## Task 1: Codex CLI False "Not Installed" Error

**Priority:** High (bug)
**Effort:** ~15 min

The provider health banner shows "Codex CLI ('codex') is not installed or not on PATH" while the user is actively chatting with Codex.

**Where to look:**

- Search for "not installed or not on PATH" in the codebase
- Likely in a provider health check that runs `which codex` or checks PATH
- The check may be stale, running at startup but not re-evaluating
- Fix: either fix the PATH detection or suppress the banner when an active Codex session exists

---

## Task 2: File Viewer Horizontal Scroll + Collapsible Sections

**Priority:** High (UX)
**Effort:** ~30 min

Long lines in the diff file viewer are clipped with no way to scroll horizontally.

**Key file:** `apps/web/src/components/DiffPanel.tsx`

- Line ~610-620: `FileDiff` component from `@pierre/diffs` already supports `overflow: 'scroll' | 'wrap'`
- Currently respects `diffWordWrap` state toggle
- **Fix:** Ensure default is `'scroll'` (not `'wrap'`), add a visible toggle button near the existing "Collapse all" / "View diff" buttons (~line 529-540)

**Collapsible per-file sections:**

- The virtualizer at line ~583-624 maps over diff entries
- Add a `collapsedFiles: Set<string>` state
- When collapsed, render just the file header (path + stats) without the `<FileDiff>` component
- Add collapse/expand toggle per file header and a "Collapse all" / "Expand all" global toggle

---

## Task 3: Color Coding + Directory Organization for Sidebar

**Priority:** Medium (UX)
**Effort:** ~2-3 hrs

Threads in the sidebar are a flat list under each project. Need folder organization with color coding.

**Approach: Client-only (localStorage, no server changes)**

1. **New store** — `apps/web/src/threadOrganizationStore.ts`:

   ```typescript
   interface ThreadFolder {
     id: string;
     projectId: ProjectId;
     name: string;
     color: string; // hex or tailwind color name
     order: number;
   }

   interface ThreadOrganizationState {
     folders: ThreadFolder[];
     threadFolderMap: Record<ThreadId, string>; // threadId → folderId
   }
   ```

   Persist to localStorage via Zustand persist middleware.

2. **Sidebar changes** — `apps/web/src/components/Sidebar.tsx`:
   - Group threads by folder within each project's collapsible section
   - Render folder headers with colored dot/left-border accent
   - Threads not in any folder go under "Uncategorized" (or just at the top)
   - Folders are collapsible independently of the project

3. **Context menu additions** — In the thread right-click menu:
   - "Move to folder →" submenu listing available folders + "New folder..."
   - "Set color" on folder right-click with a 6-8 color palette

4. **Color palette:** `red`, `orange`, `amber`, `emerald`, `sky`, `violet`, `pink`, `slate`
   Show as colored circles in a popover.

**Key files:**

- `apps/web/src/components/Sidebar.tsx` (1,707 lines) — thread rendering at lines 1337-1666
- `apps/web/src/store.ts` — Thread/Project types
- `apps/web/src/types.ts` — Thread interface at line 89

---

## Task 4: Supervised Mode → Permission Queue Rework

**Priority:** Medium (architecture)
**Effort:** ~3-4 hrs

**Current behavior:** Supervised mode (`approval-required`) blocks the turn with `Deferred.await()` in ClaudeAdapter. The user must be present on the thread to approve. If they navigate away, the turn just hangs.

**Desired behavior:** Claude asks for permission and WAITS. User can be on a different project/thread and come back later to approve. A notification/badge should show pending approvals across all threads.

**Research findings (from supervised mode research agent):**

The server already waits indefinitely — `Deferred.await(decisionDeferred)` at `apps/server/src/provider/Layers/ClaudeAdapter.ts` line 2494 doesn't time out. The issue is purely client-side:

1. **Global pending approvals indicator** — Show a badge/count in the sidebar on threads that have pending approvals (data already available via `derivePendingApprovals()` in `apps/web/src/session-logic.ts` lines 182-235)

2. **Cross-thread notification** — When an approval is requested on any thread, show a toast or global notification bar so the user knows to go back

3. **Approval UI always visible** — The `ComposerPendingApprovalPanel` and `ComposerPendingApprovalActions` components (`apps/web/src/components/chat/`) should render based on pending approval state, not just when the turn is "actively running"

**Key files:**

- `apps/server/src/provider/Layers/ClaudeAdapter.ts` (line 2426-2494) — approval decision point
- `apps/web/src/session-logic.ts` (line 182-235) — `derivePendingApprovals()`
- `apps/web/src/components/chat/ComposerPendingApprovalPanel.tsx`
- `apps/web/src/components/chat/ComposerPendingApprovalActions.tsx`
- `apps/web/src/components/Sidebar.tsx` — add pending approval badges
- `apps/web/src/components/ChatView.tsx` (line 2944-2970) — `onRespondToApproval`

**Orchestration contracts:**

- `packages/contracts/src/orchestration.ts` — `RuntimeMode`, `ProviderApprovalDecision`
- Decider: `apps/server/src/orchestration/decider.ts` (line 364-386) — `thread.approval.respond`

---

## Task 5: Multi-Chat Panes

**Priority:** Low (feature, needs design)
**Effort:** ~4-6 hrs

Optional side-by-side chat panes for running parallel conversations. Must preserve current single-chat look as default.

**Approach ideas:**

- Add a "Split view" button that creates a second chat column
- Each pane is an independent thread viewer (different threadId)
- Layout: flexbox with resizable divider (same pattern as terminal panel)
- Limit to 2 panes initially
- Store pane layout in localStorage

**Key constraint:** Don't break the current look. This should be opt-in, triggered by a button or keyboard shortcut.

**Key files:**

- `apps/web/src/components/ChatView.tsx` — main chat layout
- Would need a new wrapper component or layout state in the route

---

## Task 6: Context Window Viewer

**Priority:** Low (feature)
**Effort:** ~2-3 hrs

Show context window usage (like Claude CLI's `/context` command) and a `/compact` trigger button.

**Approach:** This needs research into what API data is available about context window usage. The Claude/Codex providers may expose token counts in turn metadata.

---

## General Notes

- All UI uses Tailwind CSS with `cn()` utility from `~/lib/utils`
- Components use shadcn-style primitives from `apps/web/src/components/ui/`
- The app uses `@base-ui/react` for tabs, menus, popovers, tooltips
- Drag-and-drop uses `@dnd-kit/core` and `@dnd-kit/sortable`
- State management: Zustand stores with localStorage persistence
- Always run `bun run build` after changes to verify (must pass 5/5)
