import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import {
  type InstalledSkillItem,
  type ProviderKind,
  type SkillKind,
  type SkillScope,
} from "@t3tools/contracts";
import {
  skillsAdoptMutationOptions,
  invalidateSkillsQueries,
  skillsRepairManagedLinksMutationOptions,
  skillsSetEnabledMutationOptions,
  skillsStopManagingMutationOptions,
  skillsCheckUpdatesMutationOptions,
  skillsInstallMutationOptions,
  skillsInventoryQueryOptions,
  skillsPreviewQueryOptions,
  skillsQueryKeys,
  skillsRefreshMutationOptions,
  skillsReinstallMutationOptions,
  skillsRemoveMutationOptions,
  skillsUpgradeMutationOptions,
} from "~/lib/skillsReactQuery";
import {
  describeSkillFailure,
  getSkillFailureCode,
  isRetryableSkillFailure,
} from "~/lib/skillErrors";
import { ensureNativeApi } from "~/nativeApi";
import { type EditorId } from "@t3tools/contracts";
import { resolveAndPersistPreferredEditor } from "~/editorPreferences";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { ToggleGroup, Toggle } from "./ui/toggle-group";
import { Collapsible, CollapsibleTrigger, CollapsiblePanel } from "./ui/collapsible";
import { ChevronDownIcon, ChevronRightIcon, SearchIcon } from "lucide-react";

// ── Constants ─────────────────────────────────────────────────────────

const PROVIDER_LABELS: Record<ProviderKind, string> = {
  codex: "Codex",
  claudeAgent: "Claude",
};

const SCOPE_LABELS: Record<SkillScope, string> = {
  global: "Global",
  project: "Project",
};

function tokenPrefix(kind: SkillKind): "@" | "$" {
  return kind === "subagent" ? "@" : "$";
}

function formatTimestamp(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}

type StatusState = {
  updateStatus: "up-to-date" | "update-available" | "unknown" | "unsupported" | undefined;
  driftStatus: "clean" | "locally-modified" | "drifted" | "unknown" | undefined;
};

function statusLabel(item: StatusState) {
  if (item.driftStatus === "drifted") return "Drifted";
  if (item.driftStatus === "locally-modified") return "Modified";
  if (item.updateStatus === "update-available") return "Update available";
  if (item.updateStatus === "up-to-date") return "Up to date";
  if (item.updateStatus === "unsupported") return "No updates";
  return "Unchecked";
}

function statusClassName(item: StatusState) {
  if (item.driftStatus === "drifted" || item.updateStatus === "update-available") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  }
  if (item.updateStatus === "up-to-date") {
    return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
  return "border-border bg-muted/50 text-muted-foreground";
}

function renderFailureSummary(error: unknown): string {
  const detail = describeSkillFailure(error);
  return isRetryableSkillFailure(error) ? `${detail} You can try again.` : detail;
}

function managedStatusLabel(status?: InstalledSkillItem["managedStatus"]): string | null {
  switch (status) {
    case "owner":
      return "Sync owner";
    case "linked":
      return "Synced link";
    case "disabled":
      return "Disabled";
    case "broken":
      return "Needs repair";
    default:
      return null;
  }
}

function managedStatusClassName(status?: InstalledSkillItem["managedStatus"]): string {
  switch (status) {
    case "owner":
      return "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300";
    case "linked":
      return "border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300";
    case "disabled":
      return "border-border bg-muted/50 text-muted-foreground";
    case "broken":
      return "border-destructive/30 bg-destructive/10 text-destructive";
    default:
      return "border-border bg-muted/50 text-muted-foreground";
  }
}

// ── Component ─────────────────────────────────────────────────────────

export function SettingsSkillsSection(props: {
  skillsEnabled: boolean;
  workspaceRoot: string | null;
  codexHomePath: string;
  availableEditors?: readonly EditorId[] | undefined;
}) {
  const { skillsEnabled, workspaceRoot, codexHomePath, availableEditors } = props;
  const queryClient = useQueryClient();

  // ── Skills state ──────────────────────────────────────────────────
  const [skillInstallUrl, setSkillInstallUrl] = useState("");
  const [skillInstallProvider, setSkillInstallProvider] = useState<ProviderKind>("codex");
  const [skillInstallKind, setSkillInstallKind] = useState<SkillKind>("skill");
  const [skillInstallScope, setSkillInstallScope] = useState<SkillScope>("global");
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // ── Filter state ──────────────────────────────────────────────────
  const [providerFilter, setProviderFilter] = useState<ProviderKind | "all">("all");
  const [kindFilter, setKindFilter] = useState<SkillKind | "all">("all");
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  // ── Queries & mutations ───────────────────────────────────────────
  const skillsInventoryQuery = useQuery(
    skillsInventoryQueryOptions({
      workspaceRoot,
      codexHomePath: codexHomePath || null,
    }),
  );
  const skillInstallPreviewQuery = useQuery(
    skillsPreviewQueryOptions({
      url: skillInstallUrl.trim(),
      provider: skillInstallProvider,
      kind: skillInstallKind,
      scope: skillInstallScope,
      ...(workspaceRoot ? { workspaceRoot } : {}),
      ...(codexHomePath ? { codexHomePath } : {}),
      enabled:
        skillsEnabled &&
        skillInstallUrl.trim().length > 0 &&
        (skillInstallScope === "global" || workspaceRoot !== null),
    }),
  );

  const installSkillMutation = useMutation(skillsInstallMutationOptions());
  const removeSkillMutation = useMutation(skillsRemoveMutationOptions());
  const refreshSkillsMutation = useMutation(skillsRefreshMutationOptions());
  const checkSkillUpdatesMutation = useMutation(skillsCheckUpdatesMutationOptions());
  const upgradeSkillMutation = useMutation(skillsUpgradeMutationOptions());
  const reinstallSkillMutation = useMutation(skillsReinstallMutationOptions());
  const adoptSkillMutation = useMutation(skillsAdoptMutationOptions());
  const setManagedSkillEnabledMutation = useMutation(skillsSetEnabledMutationOptions());
  const repairManagedLinksMutation = useMutation(skillsRepairManagedLinksMutationOptions());
  const stopManagingSkillMutation = useMutation(skillsStopManagingMutationOptions());

  const installedSkills = skillsInventoryQuery.data?.items ?? [];
  const skillsWarnings = skillsInventoryQuery.data?.warnings ?? [];

  // ── Derived data ──────────────────────────────────────────────────
  const filteredSkills = installedSkills.filter((item) => {
    if (providerFilter !== "all" && item.provider !== providerFilter) return false;
    if (kindFilter !== "all" && item.kind !== kindFilter) return false;
    return true;
  });

  // ── Callbacks ─────────────────────────────────────────────────────
  const invalidateSkills = useCallback(() => {
    void invalidateSkillsQueries(queryClient, {
      workspaceRoot,
      codexHomePath: codexHomePath || null,
      provider: skillInstallProvider,
    });
  }, [codexHomePath, queryClient, skillInstallProvider, workspaceRoot]);

  const replaceSkillsInventory = useCallback(
    (items: typeof installedSkills, warnings: ReadonlyArray<string>) => {
      queryClient.setQueryData(skillsQueryKeys.inventory(workspaceRoot, codexHomePath || null), {
        items,
        warnings: [...warnings],
      });
    },
    [codexHomePath, queryClient, workspaceRoot],
  );

  const openInstalledSkillPath = useCallback(
    async (installPath: string) => {
      const api = ensureNativeApi();
      const editor = availableEditors?.includes("file-manager")
        ? "file-manager"
        : resolveAndPersistPreferredEditor(availableEditors ?? []);
      if (!editor) {
        setSkillsError("No available editor or file manager found.");
        return;
      }
      setSkillsError(null);
      await api.shell.openInEditor(installPath, editor).catch((error) => {
        setSkillsError(error instanceof Error ? error.message : "Unable to open install path.");
      });
    },
    [availableEditors],
  );

  const installSkill = useCallback(async () => {
    if (!skillsEnabled) {
      setSkillsError("Remote skills installation is currently disabled for this environment.");
      return;
    }
    if (skillInstallScope === "project" && !workspaceRoot) {
      setSkillsError("Project-scoped installs require an active workspace.");
      return;
    }
    setSkillsError(null);
    try {
      const preview = skillInstallPreviewQuery.data;
      const shouldOverwrite =
        preview?.exists === true &&
        (await ensureNativeApi().dialogs.confirm(
          `Replace the existing ${preview.displayName} install at ${preview.installPath}?`,
        ));
      if (preview?.exists === true && !shouldOverwrite) {
        return;
      }
      await installSkillMutation.mutateAsync({
        url: skillInstallUrl.trim(),
        provider: skillInstallProvider,
        kind: skillInstallKind,
        scope: skillInstallScope,
        ...(workspaceRoot ? { workspaceRoot } : {}),
        ...(codexHomePath ? { codexHomePath } : {}),
        overwrite: shouldOverwrite || false,
      });
      setSkillInstallUrl("");
      invalidateSkills();
    } catch (error) {
      setSkillsError(renderFailureSummary(error));
    }
  }, [
    codexHomePath,
    installSkillMutation,
    invalidateSkills,
    skillsEnabled,
    skillInstallKind,
    skillInstallProvider,
    skillInstallScope,
    skillInstallUrl,
    skillInstallPreviewQuery.data,
    workspaceRoot,
  ]);

  const removeInstalledSkill = useCallback(
    async (installPath: string, displayName?: string) => {
      const api = ensureNativeApi();
      const confirmed = await api.dialogs.confirm(
        `Remove ${displayName ?? "this installed skill or subagent"} from disk?`,
      );
      if (!confirmed) return;
      if (!skillsEnabled) {
        setSkillsError("Skills management is currently disabled for this environment.");
        return;
      }
      setSkillsError(null);
      try {
        await removeSkillMutation.mutateAsync({
          installPath,
          ...(workspaceRoot ? { workspaceRoot } : {}),
          ...(codexHomePath ? { codexHomePath } : {}),
        });
        invalidateSkills();
      } catch (error) {
        setSkillsError(renderFailureSummary(error));
      }
    },
    [codexHomePath, invalidateSkills, removeSkillMutation, skillsEnabled, workspaceRoot],
  );

  const refreshSkills = useCallback(async () => {
    setSkillsError(null);
    try {
      await refreshSkillsMutation.mutateAsync({
        ...(workspaceRoot ? { workspaceRoot } : {}),
        ...(codexHomePath ? { codexHomePath } : {}),
      });
      invalidateSkills();
    } catch (error) {
      setSkillsError(error instanceof Error ? error.message : "Unable to refresh skills.");
    }
  }, [codexHomePath, invalidateSkills, refreshSkillsMutation, workspaceRoot]);

  const checkInstalledSkillUpdates = useCallback(
    async (installPath?: string) => {
      if (!skillsEnabled) {
        setSkillsError(
          "Remote skills lifecycle actions are currently disabled for this environment.",
        );
        return;
      }
      setSkillsError(null);
      try {
        const inventory = await checkSkillUpdatesMutation.mutateAsync({
          ...(workspaceRoot ? { workspaceRoot } : {}),
          ...(codexHomePath ? { codexHomePath } : {}),
          ...(installPath ? { installPath } : {}),
        });
        replaceSkillsInventory(inventory.items, inventory.warnings);
      } catch (error) {
        setSkillsError(renderFailureSummary(error));
      }
    },
    [
      checkSkillUpdatesMutation,
      codexHomePath,
      replaceSkillsInventory,
      skillsEnabled,
      workspaceRoot,
    ],
  );

  const upgradeInstalledSkill = useCallback(
    async (
      installPath: string,
      driftStatus?: "clean" | "locally-modified" | "drifted" | "unknown",
      options?: { displayName?: string; sourceHost?: string },
    ) => {
      let confirmed = true;
      if (driftStatus === "drifted" || driftStatus === "locally-modified") {
        confirmed = await ensureNativeApi().dialogs.confirm(
          `Upgrade ${options?.displayName ?? "this install"}${
            options?.sourceHost ? ` from ${options.sourceHost}` : ""
          } and overwrite local changes?`,
        );
      }
      if (!confirmed) return;
      if (!skillsEnabled) {
        setSkillsError(
          "Remote skills lifecycle actions are currently disabled for this environment.",
        );
        return;
      }
      setSkillsError(null);
      try {
        await upgradeSkillMutation.mutateAsync({
          installPath,
          ...(workspaceRoot ? { workspaceRoot } : {}),
          ...(codexHomePath ? { codexHomePath } : {}),
          overwrite: true,
        });
        await checkInstalledSkillUpdates(installPath);
        invalidateSkills();
      } catch (error) {
        setSkillsError(renderFailureSummary(error));
      }
    },
    [
      checkInstalledSkillUpdates,
      codexHomePath,
      invalidateSkills,
      skillsEnabled,
      upgradeSkillMutation,
      workspaceRoot,
    ],
  );

  const reinstallInstalledSkill = useCallback(
    async (
      installPath: string,
      driftStatus?: "clean" | "locally-modified" | "drifted" | "unknown",
      options?: { displayName?: string; sourceHost?: string },
    ) => {
      const confirmed = await ensureNativeApi().dialogs.confirm(
        driftStatus === "drifted" || driftStatus === "locally-modified"
          ? `Reinstall ${options?.displayName ?? "this item"}${
              options?.sourceHost ? ` from ${options.sourceHost}` : ""
            } and overwrite local changes?`
          : `Reinstall ${options?.displayName ?? "this item"}${
              options?.sourceHost ? ` from ${options.sourceHost}` : ""
            } from its recorded source?`,
      );
      if (!confirmed) return;
      if (!skillsEnabled) {
        setSkillsError(
          "Remote skills lifecycle actions are currently disabled for this environment.",
        );
        return;
      }
      setSkillsError(null);
      try {
        await reinstallSkillMutation.mutateAsync({
          installPath,
          ...(workspaceRoot ? { workspaceRoot } : {}),
          ...(codexHomePath ? { codexHomePath } : {}),
          overwrite: true,
        });
        invalidateSkills();
      } catch (error) {
        setSkillsError(renderFailureSummary(error));
      }
    },
    [codexHomePath, invalidateSkills, reinstallSkillMutation, skillsEnabled, workspaceRoot],
  );

  const adoptInstalledSkill = useCallback(
    async (item: InstalledSkillItem) => {
      if (!skillsEnabled) {
        setSkillsError("Skills management is currently disabled for this environment.");
        return;
      }
      setSkillsError(null);
      try {
        const api = ensureNativeApi();
        const preview = await api.skills.previewAdopt({
          installPath: item.installPath,
          ...(workspaceRoot ? { workspaceRoot } : {}),
          ...(codexHomePath ? { codexHomePath } : {}),
        });
        if (!preview.canAdopt) {
          setSkillsError(preview.warnings[0] ?? "This item cannot be adopted for sync.");
          return;
        }
        const targetLabels = preview.defaultTargetProviders.map(
          (provider) => PROVIDER_LABELS[provider],
        );
        const confirmed = await api.dialogs.confirm(
          `Adopt ${item.displayName} for sync and create provider-native links for ${targetLabels.join(", ")}?`,
        );
        if (!confirmed) return;
        await adoptSkillMutation.mutateAsync({
          installPath: item.installPath,
          targetProviders: preview.defaultTargetProviders,
          ...(workspaceRoot ? { workspaceRoot } : {}),
          ...(codexHomePath ? { codexHomePath } : {}),
        });
        invalidateSkills();
      } catch (error) {
        setSkillsError(renderFailureSummary(error));
      }
    },
    [adoptSkillMutation, codexHomePath, invalidateSkills, skillsEnabled, workspaceRoot],
  );

  const setManagedSkillEnabled = useCallback(
    async (
      item: InstalledSkillItem,
      enabled: boolean,
      scope: "current-provider" | "all-providers",
    ) => {
      if (!skillsEnabled) {
        setSkillsError("Skills management is currently disabled for this environment.");
        return;
      }
      setSkillsError(null);
      try {
        await setManagedSkillEnabledMutation.mutateAsync({
          installPath: item.installPath,
          enabled,
          scope,
          ...(workspaceRoot ? { workspaceRoot } : {}),
          ...(codexHomePath ? { codexHomePath } : {}),
        });
        invalidateSkills();
      } catch (error) {
        setSkillsError(renderFailureSummary(error));
      }
    },
    [codexHomePath, invalidateSkills, setManagedSkillEnabledMutation, skillsEnabled, workspaceRoot],
  );

  const repairManagedSkill = useCallback(
    async (item: InstalledSkillItem) => {
      if (!skillsEnabled) {
        setSkillsError("Skills management is currently disabled for this environment.");
        return;
      }
      setSkillsError(null);
      try {
        await repairManagedLinksMutation.mutateAsync({
          installPath: item.installPath,
          ...(workspaceRoot ? { workspaceRoot } : {}),
          ...(codexHomePath ? { codexHomePath } : {}),
        });
        invalidateSkills();
      } catch (error) {
        setSkillsError(renderFailureSummary(error));
      }
    },
    [codexHomePath, invalidateSkills, repairManagedLinksMutation, skillsEnabled, workspaceRoot],
  );

  const stopManagingSkill = useCallback(
    async (item: InstalledSkillItem) => {
      if (!skillsEnabled) {
        setSkillsError("Skills management is currently disabled for this environment.");
        return;
      }
      const confirmed = await ensureNativeApi().dialogs.confirm(
        `Stop managing ${item.displayName} and remove any synced provider-native links while keeping the original owner install?`,
      );
      if (!confirmed) return;
      setSkillsError(null);
      try {
        await stopManagingSkillMutation.mutateAsync({
          installPath: item.installPath,
          ...(workspaceRoot ? { workspaceRoot } : {}),
          ...(codexHomePath ? { codexHomePath } : {}),
        });
        invalidateSkills();
      } catch (error) {
        setSkillsError(renderFailureSummary(error));
      }
    },
    [codexHomePath, invalidateSkills, skillsEnabled, stopManagingSkillMutation, workspaceRoot],
  );

  const toggleExpanded = useCallback((installPath: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(installPath)) {
        next.delete(installPath);
      } else {
        next.add(installPath);
      }
      return next;
    });
  }, []);

  const handleSearch = useCallback(() => {
    const trimmed = searchQuery.trim();
    if (trimmed) {
      void ensureNativeApi().shell.openExternal(
        `https://skills.sh?q=${encodeURIComponent(trimmed)}`,
      );
    } else {
      void ensureNativeApi().shell.openExternal("https://skills.sh");
    }
  }, [searchQuery]);

  // ── Render ────────────────────────────────────────────────────────
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium text-foreground">Skills</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            View installed provider skills and Claude subagents, install from <code>skills.sh</code>
            , and manage local/project inventories with provider-native links only.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              void ensureNativeApi().shell.openExternal("https://skills.sh");
            }}
          >
            Open skills.sh
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              void refreshSkills();
            }}
          >
            Refresh
          </Button>
        </div>
      </div>

      <Tabs defaultValue="installed">
        <TabsList>
          <TabsTrigger value="installed">Installed</TabsTrigger>
          <TabsTrigger value="discover">Discover</TabsTrigger>
        </TabsList>

        {/* ── Installed Tab ─────────────────────────────────────── */}
        <TabsContent value="installed">
          {/* Filter pills */}
          <div className="mb-4 flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Provider</span>
              <ToggleGroup
                aria-label="Filter by provider"
                variant="outline"
                size="xs"
                value={[providerFilter]}
                onValueChange={(value) => {
                  const selected = value[0] as ProviderKind | "all" | undefined;
                  setProviderFilter(selected ?? "all");
                }}
              >
                <Toggle value="all">All</Toggle>
                <Toggle value="codex">Codex</Toggle>
                <Toggle value="claudeAgent">Claude</Toggle>
              </ToggleGroup>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Kind</span>
              <ToggleGroup
                aria-label="Filter by kind"
                variant="outline"
                size="xs"
                value={[kindFilter]}
                onValueChange={(value) => {
                  const selected = value[0] as SkillKind | "all" | undefined;
                  setKindFilter(selected ?? "all");
                }}
              >
                <Toggle value="all">All</Toggle>
                <Toggle value="skill">Skills</Toggle>
                <Toggle value="subagent">Subagents</Toggle>
              </ToggleGroup>
            </div>
          </div>

          {/* Provider-aware empty state for Codex + Subagents */}
          {providerFilter === "codex" && kindFilter === "subagent" ? (
            <div className="rounded-lg border border-dashed border-border bg-background px-4 py-6 text-center text-xs text-muted-foreground">
              Codex does not support subagents. Switch the provider filter to{" "}
              <button
                type="button"
                className="font-medium text-foreground underline underline-offset-2"
                onClick={() => setProviderFilter("claudeAgent")}
              >
                Claude
              </button>{" "}
              to manage subagents.
            </div>
          ) : filteredSkills.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-background px-4 py-6 text-center text-xs text-muted-foreground">
              {providerFilter === "claudeAgent" && kindFilter === "skill" ? (
                <>
                  No installed Claude skills.{" "}
                  <button
                    type="button"
                    className="font-medium text-foreground underline underline-offset-2"
                    onClick={() => {
                      void ensureNativeApi().shell.openExternal("https://skills.sh");
                    }}
                  >
                    Browse skills.sh
                  </button>{" "}
                  to find one.
                </>
              ) : providerFilter === "claudeAgent" && kindFilter === "subagent" ? (
                "No installed Claude subagents found locally."
              ) : installedSkills.length === 0 ? (
                <>
                  No installed skills or subagents yet. Use{" "}
                  <button
                    type="button"
                    className="font-medium text-foreground underline underline-offset-2"
                    onClick={() => {
                      void ensureNativeApi().shell.openExternal("https://skills.sh");
                    }}
                  >
                    Browse skills.sh
                  </button>{" "}
                  to find one, then paste its URL below to install.
                </>
              ) : (
                "No items match the current filters."
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredSkills.map((item) => {
                const isExpanded = expandedPaths.has(item.installPath);
                const status = {
                  updateStatus: item.updateStatus,
                  driftStatus: item.driftStatus,
                };
                const managedLabel = managedStatusLabel(item.managedStatus);
                const canManageSync = item.kind === "skill" && item.managedStatus === "unmanaged";
                const canRunLifecycleActions =
                  item.managedStatus === "owner" || item.managedStatus === "unmanaged";
                return (
                  <Collapsible
                    key={item.installPath}
                    open={isExpanded}
                    onOpenChange={() => toggleExpanded(item.installPath)}
                  >
                    <div className="rounded-lg border border-border bg-background">
                      <CollapsibleTrigger
                        aria-label={`${item.displayName} - ${isExpanded ? "collapse" : "expand"} details`}
                        className="flex w-full flex-col gap-2 px-3 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-3"
                      >
                        <div className="flex min-w-0 items-start gap-2">
                          {isExpanded ? (
                            <ChevronDownIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRightIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                          )}
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground">
                              {item.displayName}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {tokenPrefix(item.kind)}
                              {item.slug}
                              {item.sourceHost ? ` \u00B7 ${item.sourceHost}` : ""}
                            </p>
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-2 pl-5.5 sm:pl-0">
                          <div className="flex flex-wrap gap-1.5">
                            <Badge variant="outline" size="sm" className="rounded-full">
                              {PROVIDER_LABELS[item.provider]}
                            </Badge>
                            <Badge variant="outline" size="sm" className="rounded-full">
                              {item.kind === "subagent" ? "Subagent" : "Skill"}
                            </Badge>
                            <Badge variant="outline" size="sm" className="rounded-full">
                              {SCOPE_LABELS[item.scope]}
                            </Badge>
                          </div>
                          <Badge
                            size="sm"
                            className={`shrink-0 rounded-full ${statusClassName(status)}`}
                          >
                            {statusLabel(status)}
                          </Badge>
                          {managedLabel ? (
                            <Badge
                              size="sm"
                              className={`shrink-0 rounded-full ${managedStatusClassName(item.managedStatus)}`}
                            >
                              {managedLabel}
                            </Badge>
                          ) : null}
                        </div>
                      </CollapsibleTrigger>

                      <CollapsiblePanel>
                        <div className="border-t border-border px-3 pb-3 pt-3">
                          {item.description ? (
                            <p className="mb-3 text-xs leading-5 text-muted-foreground">
                              {item.description}
                            </p>
                          ) : null}
                          <div className="space-y-1 text-xs text-muted-foreground">
                            <p className="break-all">
                              <span className="font-medium text-foreground">Install path:</span>{" "}
                              {item.installPath}
                            </p>
                            {item.sourceUrl ? (
                              <p className="break-all">
                                <span className="font-medium text-foreground">Source:</span>{" "}
                                {item.sourceUrl}
                              </p>
                            ) : null}
                            {item.lastCheckedAt ? (
                              <p>
                                <span className="font-medium text-foreground">Last checked:</span>{" "}
                                {formatTimestamp(item.lastCheckedAt) ?? item.lastCheckedAt}
                              </p>
                            ) : null}
                            {item.lastUpgradeAt ? (
                              <p>
                                <span className="font-medium text-foreground">Last upgraded:</span>{" "}
                                {formatTimestamp(item.lastUpgradeAt) ?? item.lastUpgradeAt}
                              </p>
                            ) : null}
                            {item.ownerProvider ? (
                              <p>
                                <span className="font-medium text-foreground">Owner:</span>{" "}
                                {PROVIDER_LABELS[item.ownerProvider]}
                              </p>
                            ) : null}
                            {item.linkedProviders && item.linkedProviders.length > 0 ? (
                              <p>
                                <span className="font-medium text-foreground">
                                  Linked providers:
                                </span>{" "}
                                {item.linkedProviders
                                  .map((provider) => PROVIDER_LABELS[provider])
                                  .join(", ")}
                              </p>
                            ) : null}
                          </div>
                          {item.driftStatus === "drifted" ? (
                            <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                              Local contents differ from the installed source snapshot.
                            </p>
                          ) : null}
                          {item.managedStatus === "disabled" ? (
                            <p className="mt-2 text-xs text-muted-foreground">
                              This managed target is currently disabled for{" "}
                              {PROVIDER_LABELS[item.provider]}.
                            </p>
                          ) : null}
                          {item.managedStatus === "broken" ? (
                            <p className="mt-2 text-xs text-destructive">
                              This managed target is missing or no longer points at the current
                              owner.
                            </p>
                          ) : null}
                          {item.managedStatus && item.managedStatus !== "unmanaged" ? (
                            <p className="mt-2 text-xs text-muted-foreground">
                              Sync only creates or removes native-root links. T3 Code does not copy
                              installs between CLIs.
                            </p>
                          ) : null}
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            {/* Navigation actions */}
                            {item.managedStatus !== "disabled" ? (
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={() => {
                                  void openInstalledSkillPath(item.installPath);
                                }}
                              >
                                Reveal
                              </Button>
                            ) : null}
                            {item.sourceUrl ? (
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={() => {
                                  void ensureNativeApi().shell.openExternal(item.sourceUrl!);
                                }}
                              >
                                Open source
                              </Button>
                            ) : null}

                            {/* Lifecycle actions */}
                            {canRunLifecycleActions ? (
                              <>
                                <span className="mx-0.5 hidden h-4 w-px bg-border sm:block" />
                                <Button
                                  size="xs"
                                  variant="outline"
                                  disabled={!skillsEnabled || checkSkillUpdatesMutation.isPending}
                                  onClick={() => {
                                    void checkInstalledSkillUpdates(item.installPath);
                                  }}
                                >
                                  Check updates
                                </Button>
                                {item.updateStatus === "update-available" ? (
                                  <Button
                                    size="xs"
                                    variant="outline"
                                    disabled={!skillsEnabled || upgradeSkillMutation.isPending}
                                    onClick={() => {
                                      void upgradeInstalledSkill(
                                        item.installPath,
                                        item.driftStatus,
                                        {
                                          displayName: item.displayName,
                                          ...(item.sourceHost
                                            ? { sourceHost: item.sourceHost }
                                            : {}),
                                        },
                                      );
                                    }}
                                  >
                                    Upgrade
                                  </Button>
                                ) : null}
                                <Button
                                  size="xs"
                                  variant="outline"
                                  disabled={!skillsEnabled || reinstallSkillMutation.isPending}
                                  onClick={() => {
                                    void reinstallInstalledSkill(
                                      item.installPath,
                                      item.driftStatus,
                                      {
                                        displayName: item.displayName,
                                        ...(item.sourceHost ? { sourceHost: item.sourceHost } : {}),
                                      },
                                    );
                                  }}
                                >
                                  Reinstall
                                </Button>
                              </>
                            ) : null}

                            {/* Sync management actions */}
                            {(canManageSync ||
                              (item.managedStatus && item.managedStatus !== "unmanaged")) && (
                              <span className="mx-0.5 hidden h-4 w-px bg-border sm:block" />
                            )}
                            {canManageSync ? (
                              <Button
                                size="xs"
                                variant="outline"
                                disabled={!skillsEnabled || adoptSkillMutation.isPending}
                                onClick={() => {
                                  void adoptInstalledSkill(item);
                                }}
                              >
                                Manage sync
                              </Button>
                            ) : null}
                            {item.managedStatus === "owner" || item.managedStatus === "linked" ? (
                              <Button
                                size="xs"
                                variant="outline"
                                disabled={
                                  !skillsEnabled || setManagedSkillEnabledMutation.isPending
                                }
                                onClick={() => {
                                  void setManagedSkillEnabled(item, false, "current-provider");
                                }}
                              >
                                Disable here
                              </Button>
                            ) : null}
                            {item.managedStatus === "disabled" ||
                            item.managedStatus === "broken" ? (
                              <Button
                                size="xs"
                                variant="outline"
                                disabled={
                                  !skillsEnabled || setManagedSkillEnabledMutation.isPending
                                }
                                onClick={() => {
                                  void setManagedSkillEnabled(item, true, "current-provider");
                                }}
                              >
                                Enable here
                              </Button>
                            ) : null}
                            {item.managedStatus === "disabled" ||
                            item.managedStatus === "broken" ? (
                              <Button
                                size="xs"
                                variant="outline"
                                disabled={
                                  !skillsEnabled || setManagedSkillEnabledMutation.isPending
                                }
                                onClick={() => {
                                  void setManagedSkillEnabled(item, true, "all-providers");
                                }}
                              >
                                Enable all
                              </Button>
                            ) : null}
                            {item.managedStatus === "broken" ? (
                              <Button
                                size="xs"
                                variant="outline"
                                disabled={!skillsEnabled || repairManagedLinksMutation.isPending}
                                onClick={() => {
                                  void repairManagedSkill(item);
                                }}
                              >
                                Repair link
                              </Button>
                            ) : null}

                            {/* Destructive actions */}
                            {item.managedStatus && item.managedStatus !== "unmanaged" ? (
                              <Button
                                size="xs"
                                variant="outline"
                                disabled={!skillsEnabled || stopManagingSkillMutation.isPending}
                                onClick={() => {
                                  void stopManagingSkill(item);
                                }}
                              >
                                Stop managing
                              </Button>
                            ) : (
                              <>
                                <span className="mx-0.5 hidden h-4 w-px bg-border sm:block" />
                                <Button
                                  size="xs"
                                  variant="destructive-outline"
                                  disabled={!skillsEnabled || removeSkillMutation.isPending}
                                  onClick={() => {
                                    void removeInstalledSkill(item.installPath, item.displayName);
                                  }}
                                >
                                  Remove
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      </CollapsiblePanel>
                    </div>
                  </Collapsible>
                );
              })}
            </div>
          )}

          {skillsWarnings.length > 0 ? (
            <div className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/8 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              {skillsWarnings[0]}
            </div>
          ) : null}
        </TabsContent>

        {/* ── Discover Tab ──────────────────────────────────────── */}
        <TabsContent value="discover">
          {/* Search section */}
          <div className="mb-6 space-y-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSearch();
                  }}
                  placeholder="Search skills on skills.sh..."
                  className="pl-8"
                />
              </div>
              <Button variant="outline" onClick={handleSearch}>
                Search
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Search opens skills.sh in your browser so you can read more about a skill. Once you
              find one, copy the skill page URL and paste it below to install.
            </p>
          </div>

          {/* Install section */}
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium text-foreground">Install from URL</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Paste a skill page URL, preview the resolved install target, then install it.
              </p>
            </div>

            {!skillsEnabled ? (
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Remote skills installation is currently disabled for this environment. Installed
                inventory remains visible, but install and lifecycle actions are gated off until
                rollout is enabled.
              </div>
            ) : null}

            <label className="block space-y-1">
              <span className="text-xs font-medium text-foreground">skills.sh URL</span>
              <Input
                value={skillInstallUrl}
                onChange={(event) => setSkillInstallUrl(event.target.value)}
                placeholder="https://skills.sh/owner/repo/skill"
                spellCheck={false}
                disabled={!skillsEnabled}
              />
            </label>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <span className="text-xs font-medium text-foreground">Provider</span>
                <Select
                  value={skillInstallProvider}
                  disabled={!skillsEnabled}
                  onValueChange={(value) => {
                    if (value === "codex" || value === "claudeAgent") {
                      setSkillInstallProvider(value);
                      if (value === "codex") setSkillInstallKind("skill");
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue>{PROVIDER_LABELS[skillInstallProvider]}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value="codex">Codex</SelectItem>
                    <SelectItem value="claudeAgent">Claude</SelectItem>
                  </SelectPopup>
                </Select>
              </div>
              <div className="space-y-1">
                <span className="text-xs font-medium text-foreground">Kind</span>
                <Select
                  value={skillInstallKind}
                  disabled={!skillsEnabled}
                  onValueChange={(value) => {
                    if (value === "skill" || value === "subagent") {
                      setSkillInstallKind(skillInstallProvider === "codex" ? "skill" : value);
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue>
                      {skillInstallKind === "subagent" ? "Subagent" : "Skill"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value="skill">Skill</SelectItem>
                    {skillInstallProvider === "claudeAgent" ? (
                      <SelectItem value="subagent">Subagent</SelectItem>
                    ) : null}
                  </SelectPopup>
                </Select>
              </div>
              <div className="space-y-1">
                <span className="text-xs font-medium text-foreground">Scope</span>
                <Select
                  value={skillInstallScope}
                  disabled={!skillsEnabled}
                  onValueChange={(value) => {
                    if (value === "global" || value === "project") {
                      setSkillInstallScope(value);
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue>{SCOPE_LABELS[skillInstallScope]}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value="global">Global</SelectItem>
                    <SelectItem value="project">Project</SelectItem>
                  </SelectPopup>
                </Select>
              </div>
            </div>

            {/* Preview panel */}
            <div className="rounded-lg border border-border bg-background px-3 py-3 text-xs">
              {skillInstallPreviewQuery.isLoading ? (
                <p className="text-muted-foreground">Loading install preview\u2026</p>
              ) : skillInstallPreviewQuery.data ? (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-foreground">
                          {skillInstallPreviewQuery.data.displayName}
                        </p>
                        <p className="text-muted-foreground">
                          {tokenPrefix(skillInstallPreviewQuery.data.kind)}
                          {skillInstallPreviewQuery.data.slug}
                        </p>
                      </div>
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <Badge variant="outline" size="sm" className="rounded-full">
                          {PROVIDER_LABELS[skillInstallPreviewQuery.data.provider]}
                        </Badge>
                        <Badge variant="outline" size="sm" className="rounded-full">
                          {skillInstallPreviewQuery.data.kind === "subagent" ? "Subagent" : "Skill"}
                        </Badge>
                        <Badge variant="outline" size="sm" className="rounded-full">
                          {SCOPE_LABELS[skillInstallPreviewQuery.data.scope]}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  {skillInstallPreviewQuery.data.description ? (
                    <p className="text-muted-foreground">
                      {skillInstallPreviewQuery.data.description}
                    </p>
                  ) : null}
                  <div className="space-y-1 text-muted-foreground">
                    <p className="break-all">
                      <span className="font-medium text-foreground">Source repo:</span>{" "}
                      {skillInstallPreviewQuery.data.repoUrl}
                    </p>
                    {skillInstallPreviewQuery.data.sourceSubpath ? (
                      <p className="break-all">
                        <span className="font-medium text-foreground">Source path:</span>{" "}
                        {skillInstallPreviewQuery.data.sourceSubpath}
                      </p>
                    ) : null}
                    <p className="break-all">
                      <span className="font-medium text-foreground">Install path:</span>{" "}
                      {skillInstallPreviewQuery.data.installPath}
                    </p>
                    {skillInstallPreviewQuery.data.resolvedDefaultBranch ? (
                      <p>
                        <span className="font-medium text-foreground">Resolved ref:</span>{" "}
                        {skillInstallPreviewQuery.data.resolvedDefaultBranch}
                        {skillInstallPreviewQuery.data.resolvedCommitSha
                          ? ` \u00B7 ${skillInstallPreviewQuery.data.resolvedCommitSha.slice(0, 12)}`
                          : ""}
                      </p>
                    ) : null}
                  </div>
                  <div className="rounded-md border border-sky-500/20 bg-sky-500/8 px-3 py-2 text-sky-700 dark:text-sky-300">
                    You are installing remote instructions onto this machine.
                  </div>
                  {skillInstallPreviewQuery.data.exists ? (
                    <div className="rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-300">
                      A managed install already exists at this destination. Installing again will
                      require overwrite confirmation.
                    </div>
                  ) : null}
                  {skillInstallPreviewQuery.data.warnings.length > 0 ? (
                    <div className="rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-300">
                      {skillInstallPreviewQuery.data.warnings[0]}
                    </div>
                  ) : null}
                </div>
              ) : skillInstallPreviewQuery.error ? (
                <div className="space-y-2">
                  <p className="font-medium text-foreground">Preview unavailable</p>
                  <p className="text-muted-foreground">
                    {renderFailureSummary(skillInstallPreviewQuery.error)}
                  </p>
                  <p className="text-muted-foreground">
                    {getSkillFailureCode(skillInstallPreviewQuery.error) === "unsupported_source"
                      ? "Public launch currently supports skills.sh pages that resolve cleanly to GitHub-backed sources."
                      : "The preview failed before installation. No local files were changed."}
                  </p>
                </div>
              ) : (
                <p className="text-muted-foreground">
                  Paste a URL to preview the resolved install target.
                </p>
              )}
            </div>

            <Button
              disabled={
                !skillsEnabled ||
                skillInstallUrl.trim().length === 0 ||
                installSkillMutation.isPending ||
                (skillInstallScope === "project" && workspaceRoot === null)
              }
              onClick={() => {
                void installSkill();
              }}
            >
              {installSkillMutation.isPending ? "Installing\u2026" : "Install"}
            </Button>
          </div>
        </TabsContent>
      </Tabs>

      {skillsError && !expandedPaths.size ? (
        <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive">
          {skillsError}
        </div>
      ) : null}
    </section>
  );
}
