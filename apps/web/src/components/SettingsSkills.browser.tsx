import "../index.css";

import {
  type InstalledSkillItem,
  ORCHESTRATION_WS_METHODS,
  type MessageId,
  type OrchestrationReadModel,
  type ProjectId,
  type ServerConfig,
  type ThreadId,
  type WsWelcomePayload,
  WS_CHANNELS,
  WS_METHODS,
} from "@t3tools/contracts";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { HttpResponse, http, ws } from "msw";
import { setupWorker } from "msw/browser";
import { page } from "vitest/browser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { useComposerDraftStore } from "../composerDraftStore";
import { getRouter } from "../router";
import { useStore } from "../store";

const THREAD_ID = "thread-settings-skills-test" as ThreadId;
const PROJECT_ID = "project-settings-skills-test" as ProjectId;
const NOW_ISO = "2026-03-20T12:00:00.000Z";

interface WsRequestEnvelope {
  id: string;
  body: {
    _tag: string;
    [key: string]: unknown;
  };
}

interface TestFixture {
  snapshot: OrchestrationReadModel;
  serverConfig: ServerConfig;
  welcome: WsWelcomePayload;
  skillsInventory: {
    items: InstalledSkillItem[];
    warnings: string[];
  };
}

let fixture: TestFixture;
const wsLink = ws.link(/ws(s)?:\/\/.*/);

function createBaseServerConfig(): ServerConfig {
  return {
    cwd: "/repo/project",
    skillsEnabled: true,
    keybindingsConfigPath: "/repo/project/.t3code-keybindings.json",
    keybindings: [],
    issues: [],
    providers: [
      {
        provider: "codex",
        status: "ready",
        available: true,
        authStatus: "authenticated",
        checkedAt: NOW_ISO,
      },
      {
        provider: "claudeAgent",
        status: "ready",
        available: true,
        authStatus: "authenticated",
        checkedAt: NOW_ISO,
      },
    ],
    availableEditors: ["file-manager"],
  };
}

function createSnapshot(): OrchestrationReadModel {
  return {
    snapshotSequence: 1,
    projects: [
      {
        id: PROJECT_ID,
        title: "Project",
        workspaceRoot: "/repo/project",
        defaultModel: "gpt-5",
        scripts: [],
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
        deletedAt: null,
      },
    ],
    threads: [
      {
        id: THREAD_ID,
        projectId: PROJECT_ID,
        title: "Settings thread",
        model: "gpt-5",
        interactionMode: "default",
        runtimeMode: "full-access",
        branch: "main",
        worktreePath: null,
        latestTurn: null,
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
        deletedAt: null,
        messages: [
          {
            id: "msg-settings-1" as MessageId,
            role: "user",
            text: "hello",
            turnId: null,
            streaming: false,
            createdAt: NOW_ISO,
            updatedAt: NOW_ISO,
          },
        ],
        activities: [],
        proposedPlans: [],
        checkpoints: [],
        session: {
          threadId: THREAD_ID,
          status: "ready",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: NOW_ISO,
        },
      },
    ],
    updatedAt: NOW_ISO,
  };
}

function buildFixture(): TestFixture {
  return {
    snapshot: createSnapshot(),
    serverConfig: createBaseServerConfig(),
    welcome: {
      cwd: "/repo/project",
      projectName: "Project",
      bootstrapProjectId: PROJECT_ID,
      bootstrapThreadId: THREAD_ID,
    },
    skillsInventory: {
      items: [
        {
          provider: "codex",
          kind: "skill",
          scope: "global",
          slug: "copywriter",
          displayName: "Copywriter",
          description: "Sharpens product messaging.",
          installPath: "/Users/test/.codex/skills/copywriter",
          sourceUrl: "https://skills.sh/openai/codex/copywriter",
          repoUrl: "https://github.com/openai/codex",
          sourceHost: "skills.sh",
          updateStatus: "unknown",
          driftStatus: "clean",
        },
        {
          provider: "codex",
          kind: "skill",
          scope: "project",
          slug: "reviewer",
          displayName: "Reviewer",
          description: "Reviews project-specific code.",
          installPath: "/repo/project/.codex/skills/reviewer",
          sourceUrl: "https://skills.sh/openai/codex/reviewer",
          repoUrl: "https://github.com/openai/codex",
          sourceHost: "skills.sh",
          updateStatus: "up-to-date",
          driftStatus: "clean",
        },
        {
          provider: "claudeAgent",
          kind: "skill",
          scope: "global",
          slug: "frontend-design",
          displayName: "Frontend Design",
          description: "Builds polished UI systems.",
          installPath: "/Users/test/.claude/skills/frontend-design",
          sourceUrl: "https://skills.sh/openai/codex/frontend-design",
          repoUrl: "https://github.com/openai/codex",
          sourceHost: "skills.sh",
          updateStatus: "unknown",
          driftStatus: "clean",
        },
        {
          provider: "claudeAgent",
          kind: "subagent",
          scope: "global",
          slug: "program-manager",
          displayName: "Program Manager",
          description: "Coordinates multi-project work.",
          installPath: "/Users/test/.claude/agents/program-manager.md",
          sourceUrl: "https://skills.sh/openai/codex/program-manager",
          repoUrl: "https://github.com/openai/codex",
          sourceHost: "skills.sh",
          updateStatus: "unknown",
          driftStatus: "clean",
        },
      ],
      warnings: [],
    },
  };
}

function resolveWsRpc(body: WsRequestEnvelope["body"]): unknown {
  const tag = body._tag;
  if (tag === ORCHESTRATION_WS_METHODS.getSnapshot) {
    return fixture.snapshot;
  }
  if (tag === WS_METHODS.serverGetConfig) {
    return fixture.serverConfig;
  }
  if (tag === WS_METHODS.gitListBranches) {
    return {
      isRepo: true,
      hasOriginRemote: true,
      branches: [{ name: "main", current: true, isDefault: true, worktreePath: null }],
    };
  }
  if (tag === WS_METHODS.gitStatus) {
    return {
      branch: "main",
      hasWorkingTreeChanges: false,
      workingTree: { files: [], insertions: 0, deletions: 0 },
      hasUpstream: true,
      aheadCount: 0,
      behindCount: 0,
      pr: null,
    };
  }
  if (tag === WS_METHODS.projectsSearchEntries) {
    return { entries: [], truncated: false };
  }
  if (tag === WS_METHODS.skillsList || tag === WS_METHODS.skillsRefresh) {
    return fixture.skillsInventory;
  }
  if (tag === WS_METHODS.skillsPreviewInstall) {
    if (typeof body.url === "string" && body.url.includes("unsupported")) {
      throw Object.assign(new Error("Only GitHub-backed skills.sh sources are supported."), {
        code: "unsupported_source",
        details: {
          code: "unsupported_source",
          retryable: false,
        },
      });
    }
    const scope = body.scope === "project" ? "project" : "global";
    return {
      provider: body.provider === "claudeAgent" ? "claudeAgent" : "codex",
      kind: body.kind === "subagent" ? "subagent" : "skill",
      scope,
      slug: "frontend-design",
      displayName: "Frontend Design",
      description: "Builds polished UI systems.",
      sourceUrl: "https://skills.sh/openai/codex/frontend-design",
      repoUrl: "https://github.com/openai/codex",
      sourceSubpath: "frontend-design",
      installPath:
        scope === "project"
          ? "/repo/project/.codex/skills/frontend-design"
          : "/Users/test/.codex/skills/frontend-design",
      exists: false,
      warnings: [],
    };
  }
  if (tag === WS_METHODS.skillsInstall) {
    const scope = body.scope === "project" ? "project" : "global";
    const item: InstalledSkillItem = {
      provider: body.provider === "claudeAgent" ? "claudeAgent" : "codex",
      kind: body.kind === "subagent" ? "subagent" : "skill",
      scope,
      slug: "frontend-design",
      displayName: "Frontend Design",
      description: "Builds polished UI systems.",
      installPath:
        scope === "project"
          ? "/repo/project/.codex/skills/frontend-design"
          : "/Users/test/.codex/skills/frontend-design",
      sourceUrl: "https://skills.sh/openai/codex/frontend-design",
      repoUrl: "https://github.com/openai/codex",
    };
    fixture.skillsInventory = {
      ...fixture.skillsInventory,
      items: [...fixture.skillsInventory.items, item],
    };
    return { item, warnings: [] };
  }
  if (tag === WS_METHODS.skillsRemove) {
    const installPath = typeof body.installPath === "string" ? body.installPath : "";
    fixture.skillsInventory = {
      ...fixture.skillsInventory,
      items: fixture.skillsInventory.items.filter((item) => item.installPath !== installPath),
    };
    return { removed: true };
  }
  if (tag === WS_METHODS.skillsCheckUpdates) {
    fixture.skillsInventory = {
      ...fixture.skillsInventory,
      items: fixture.skillsInventory.items.map((item) =>
        item.installPath === "/Users/test/.codex/skills/copywriter"
          ? {
              ...item,
              updateStatus: "update-available",
              lastCheckedAt: NOW_ISO,
              lastKnownRemoteCommitSha: "next-commit-sha",
            }
          : {
              ...item,
              lastCheckedAt: NOW_ISO,
            },
      ),
    };
    return fixture.skillsInventory;
  }
  if (tag === WS_METHODS.skillsUpgrade || tag === WS_METHODS.skillsReinstall) {
    const installPath = typeof body.installPath === "string" ? body.installPath : "";
    fixture.skillsInventory = {
      ...fixture.skillsInventory,
      items: fixture.skillsInventory.items.map((item) =>
        item.installPath === installPath
          ? {
              ...item,
              updateStatus: "up-to-date",
              driftStatus: "clean",
              lastCheckedAt: NOW_ISO,
              lastUpgradeAt: NOW_ISO,
            }
          : item,
      ),
    };
    const item = fixture.skillsInventory.items.find((entry) => entry.installPath === installPath);
    if (!item) {
      throw new Error("Install not found.");
    }
    return { item, warnings: [] };
  }
  return {};
}

const worker = setupWorker(
  wsLink.addEventListener("connection", ({ client }) => {
    client.send(
      JSON.stringify({
        type: "push",
        sequence: 1,
        channel: WS_CHANNELS.serverWelcome,
        data: fixture.welcome,
      }),
    );
    client.addEventListener("message", (event) => {
      const rawData = event.data;
      if (typeof rawData !== "string") return;
      let request: WsRequestEnvelope;
      try {
        request = JSON.parse(rawData) as WsRequestEnvelope;
      } catch {
        return;
      }
      const method = request.body?._tag;
      if (typeof method !== "string") return;
      try {
        const result = resolveWsRpc(request.body);
        client.send(
          JSON.stringify({
            id: request.id,
            result,
          }),
        );
      } catch (error) {
        const errorLike =
          error && typeof error === "object"
            ? (error as { message?: unknown; code?: unknown; details?: unknown })
            : null;
        client.send(
          JSON.stringify({
            id: request.id,
            error: {
              message:
                errorLike && typeof errorLike.message === "string"
                  ? errorLike.message
                  : "Request failed",
              ...(errorLike && typeof errorLike.code === "string" ? { code: errorLike.code } : {}),
              ...(errorLike && errorLike.details !== undefined
                ? { details: errorLike.details }
                : {}),
            },
          }),
        );
      }
    });
  }),
  http.get("*/attachments/:attachmentId", () => new HttpResponse(null, { status: 204 })),
  http.get("*/api/project-favicon", () => new HttpResponse(null, { status: 204 })),
);

async function mountSettings(): Promise<{ cleanup: () => Promise<void> }> {
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.inset = "0";
  host.style.width = "100vw";
  host.style.height = "100vh";
  host.style.display = "grid";
  host.style.overflow = "hidden";
  document.body.append(host);

  const router = getRouter(
    createMemoryHistory({
      initialEntries: ["/settings"],
    }),
  );

  const screen = await render(<RouterProvider router={router} />, {
    container: host,
  });

  await vi.waitFor(
    () => {
      expect(document.body.textContent ?? "").toContain("Settings");
      expect(document.body.textContent ?? "").toContain("Skills");
    },
    { timeout: 8_000, interval: 16 },
  );

  return {
    cleanup: async () => {
      await screen.unmount();
      host.remove();
    },
  };
}

async function openDiscoverTab(): Promise<void> {
  await page.getByRole("tab", { name: "Discover" }).click();
}

async function openInstalledTab(): Promise<void> {
  await page.getByText("Installed", { exact: true }).click();
}

async function openInstalledItem(displayName: string): Promise<void> {
  await page.getByText(displayName, { exact: true }).click();
}

describe("Settings skills", () => {
  beforeAll(async () => {
    await worker.start({
      onUnhandledRequest: "bypass",
      quiet: true,
      serviceWorker: {
        url: "/mockServiceWorker.js",
      },
    });
  });

  afterAll(async () => {
    await worker.stop();
  });

  beforeEach(() => {
    fixture = buildFixture();
    localStorage.clear();
    document.body.innerHTML = "";
    useComposerDraftStore.setState({
      draftsByThreadId: {},
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
      stickyModel: null,
      stickyModelOptions: {},
    });
    useStore.setState({
      projects: [],
      threads: [],
      threadsHydrated: false,
    });
    const confirmMock = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmMock);
    window.confirm = confirmMock;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("shows installed items grouped by global and project scope", async () => {
    const mounted = await mountSettings();

    try {
      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("Copywriter");
        expect(text).toContain("Reviewer");
        expect(text).toContain("Frontend Design");
        expect(text).toContain("Program Manager");
        expect(text).toContain("Global");
        expect(text).toContain("Project");
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("installs a skill from settings", async () => {
    fixture = buildFixture();
    fixture.skillsInventory = {
      ...fixture.skillsInventory,
      items: fixture.skillsInventory.items.filter((item) => item.slug !== "frontend-design"),
    };
    const mounted = await mountSettings();

    try {
      await openDiscoverTab();
      await page
        .getByPlaceholder("https://skills.sh/owner/repo/skill")
        .fill("https://skills.sh/openai/codex/frontend-design");

      await page.getByRole("button", { name: "Install", exact: true }).click();

      await vi.waitFor(() => {
        expect(fixture.skillsInventory.items.some((item) => item.slug === "frontend-design")).toBe(
          true,
        );
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("removes an installed skill from settings", async () => {
    const mounted = await mountSettings();

    try {
      await openInstalledItem("Copywriter");
      await page.getByRole("button", { name: "Remove" }).click();

      await vi.waitFor(() => {
        expect(fixture.skillsInventory.items.some((item) => item.slug === "copywriter")).toBe(
          false,
        );
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("checks for updates and upgrades an installed skill", async () => {
    const mounted = await mountSettings();

    try {
      await openInstalledItem("Copywriter");
      await page.getByRole("button", { name: "Check updates" }).first().click();

      await vi.waitFor(() => {
        expect(document.body.textContent ?? "").toContain("Update available");
      });

      await page.getByRole("button", { name: "Upgrade" }).first().click();

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("Up to date");
        expect(text).toContain("Last upgraded:");
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("shows an actionable unsupported-source preview state", async () => {
    const mounted = await mountSettings();

    try {
      await openDiscoverTab();
      await page
        .getByPlaceholder("https://skills.sh/owner/repo/skill")
        .fill("https://skills.sh/unsupported/source");

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("Preview unavailable");
        expect(text).toContain("This source is not supported.");
        expect(text).toContain("Public launch currently supports skills.sh pages");
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("shows installed inventory while gating off remote lifecycle actions", async () => {
    fixture = buildFixture();
    fixture.serverConfig = {
      ...fixture.serverConfig,
      skillsEnabled: false,
    };
    const mounted = await mountSettings();

    try {
      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("Copywriter");
      });
      await openDiscoverTab();
      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain(
          "Remote skills installation is currently disabled for this environment.",
        );
      });
      await expect
        .element(page.getByRole("button", { name: "Install", exact: true }))
        .toBeDisabled();
      await openInstalledTab();
      await openInstalledItem("Copywriter");
      await expect
        .element(page.getByRole("button", { name: "Check updates" }).first())
        .toBeDisabled();
    } finally {
      await mounted.cleanup();
    }
  });

  it("shows Claude-specific empty state guidance", async () => {
    fixture = buildFixture();
    fixture.skillsInventory = { items: [], warnings: [] };
    const mounted = await mountSettings();

    try {
      await page.getByRole("button", { name: "Claude" }).click();
      await page.getByRole("button", { name: "Skills", exact: true }).click();

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("No installed Claude skills.");
        expect(text).toContain("Browse skills.sh");
      });
    } finally {
      await mounted.cleanup();
    }
  });
});
