import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  type InstalledSkillItem,
  type SkillKind,
  type SkillOperationFailure,
  type SkillOperationFailureCode,
  type SkillProvider,
  type SkillScope,
  type SkillsAdoptInput,
  type SkillsAdoptPreview,
  type SkillsAdoptResult,
  type SkillsCheckUpdatesInput,
  type SkillsCheckUpdatesResult,
  type SkillsInstallInput,
  type SkillsInstallPreview,
  type SkillsInstallResult,
  type SkillsInventory,
  type SkillsListInput,
  type SkillsPreviewAdoptInput,
  type SkillsPreviewInstallInput,
  type SkillsRepairManagedLinksInput,
  type SkillsRepairManagedLinksResult,
  type SkillsRefreshInput,
  type SkillsReinstallInput,
  type SkillsReinstallResult,
  type SkillsRemoveInput,
  type SkillsRemoveResult,
  type SkillsSetEnabledInput,
  type SkillsSetEnabledResult,
  type SkillsStopManagingInput,
  type SkillsStopManagingResult,
  type SkillsUpgradeInput,
  type SkillsUpgradeResult,
} from "@t3tools/contracts";
import { Effect, Layer, Schema, ServiceMap } from "effect";

import { version as appVersion } from "../../../package.json" with { type: "json" };
import { ServerConfig } from "../../config.ts";
import { createLogger } from "../../logger.ts";
import { AnalyticsService } from "../../telemetry/Services/AnalyticsService.ts";
import { installSkillFromResolvedSource } from "../SkillInstaller.ts";
import {
  makeSkillManagementStore,
  type ManagedSkillRecord,
  type ManagedSkillTargetRecord,
} from "../SkillManagementStore.ts";
import { makeSkillProvenanceStore } from "../SkillProvenanceStore.ts";
import { resolveGitHubRepository, resolveSkillSource } from "../SkillSourceResolver.ts";
import {
  SKILL_MD,
  compatibleProvidersFor,
  computeDirectoryManifestHash,
  discoverInstalledSkillEntries,
  discoverPluginSkillEntries,
  fileExists,
  getSourceHost,
  installDirectoryFor,
  isWithinDirectory,
  listManagedDirectories,
  parseDescriptionFromSkillMarkdown,
  parseFrontmatterName,
  parseStandaloneMarkdownDescription,
  parseStandaloneMarkdownTitle,
  parseTitleFromSkillMarkdown,
  type ResolvedSkillSource,
  type SkillProvenanceRecord,
} from "../shared.ts";

const logger = createLogger("skills");

export class SkillRegistryError extends Schema.TaggedErrorClass<SkillRegistryError>()(
  "SkillRegistryError",
  {
    message: Schema.String,
    code: Schema.optional(Schema.String),
    details: Schema.optional(Schema.Unknown),
  },
) {}

export interface SkillRegistryShape {
  readonly list: (input: SkillsListInput) => Effect.Effect<SkillsInventory, SkillRegistryError>;
  readonly previewAdopt: (
    input: SkillsPreviewAdoptInput,
  ) => Effect.Effect<SkillsAdoptPreview, SkillRegistryError>;
  readonly adopt: (input: SkillsAdoptInput) => Effect.Effect<SkillsAdoptResult, SkillRegistryError>;
  readonly previewInstall: (
    input: SkillsPreviewInstallInput,
  ) => Effect.Effect<SkillsInstallPreview, SkillRegistryError>;
  readonly install: (
    input: SkillsInstallInput,
  ) => Effect.Effect<SkillsInstallResult, SkillRegistryError>;
  readonly remove: (
    input: SkillsRemoveInput,
  ) => Effect.Effect<SkillsRemoveResult, SkillRegistryError>;
  readonly refresh: (
    input: SkillsRefreshInput,
  ) => Effect.Effect<SkillsInventory, SkillRegistryError>;
  readonly checkUpdates: (
    input: SkillsCheckUpdatesInput,
  ) => Effect.Effect<SkillsCheckUpdatesResult, SkillRegistryError>;
  readonly upgrade: (
    input: SkillsUpgradeInput,
  ) => Effect.Effect<SkillsUpgradeResult, SkillRegistryError>;
  readonly reinstall: (
    input: SkillsReinstallInput,
  ) => Effect.Effect<SkillsReinstallResult, SkillRegistryError>;
  readonly setEnabled: (
    input: SkillsSetEnabledInput,
  ) => Effect.Effect<SkillsSetEnabledResult, SkillRegistryError>;
  readonly repairManagedLinks: (
    input: SkillsRepairManagedLinksInput,
  ) => Effect.Effect<SkillsRepairManagedLinksResult, SkillRegistryError>;
  readonly stopManaging: (
    input: SkillsStopManagingInput,
  ) => Effect.Effect<SkillsStopManagingResult, SkillRegistryError>;
}

export class SkillRegistry extends ServiceMap.Service<SkillRegistry, SkillRegistryShape>()(
  "t3/skills/Services/SkillRegistry",
) {}

const isSkillRegistryError = Schema.is(SkillRegistryError);

function mapErrorCode(error: unknown): SkillOperationFailureCode {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes("archive") || message.includes("symlink")) return "archive_invalid";
  if (message.includes("skills.sh") || message.includes("unsupported source")) {
    return "unsupported_source";
  }
  if (message.includes("github") || message.includes("resolve")) return "resolution_failed";
  if (message.includes("download") || message.includes("network") || message.includes("fetch")) {
    return "network_failed";
  }
  if (message.includes("skill root") || message.includes("locate skill")) {
    return "skill_root_not_found";
  }
  if (message.includes("does not contain") || message.includes("validation")) {
    return "validation_failed";
  }
  if (message.includes("already exists")) return "destination_exists";
  if (message.includes("permission")) return "permission_denied";
  return "filesystem_failed";
}

function retryableForCode(code: SkillOperationFailureCode): boolean {
  return code === "network_failed" || code === "resolution_failed";
}

function toSkillRegistryError(
  error: unknown,
  fallback: string,
  codeOverride?: SkillOperationFailureCode,
): SkillRegistryError {
  if (isSkillRegistryError(error)) {
    return error;
  }
  const code = codeOverride ?? mapErrorCode(error);
  const message =
    error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
  const details: SkillOperationFailure = {
    code,
    message,
    retryable: retryableForCode(code),
  };
  return new SkillRegistryError({
    message,
    code,
    details,
  });
}

function inferUpdateStatus(item: InstalledSkillItem): InstalledSkillItem["updateStatus"] {
  if (item.provenanceStatus === "legacy" || !item.repoUrl || !item.sourceUrl) {
    return "unsupported";
  }
  if (!item.lastCheckedAt || !item.lastKnownRemoteCommitSha || !item.resolvedCommitSha) {
    return "unknown";
  }
  return item.lastKnownRemoteCommitSha === item.resolvedCommitSha
    ? "up-to-date"
    : "update-available";
}

function inferDriftStatus(
  provenance: SkillProvenanceRecord | null,
  manifestHash: string | null,
): InstalledSkillItem["driftStatus"] {
  if (!provenance?.manifestHash || !manifestHash) return "unknown";
  return provenance.manifestHash === manifestHash ? "clean" : "drifted";
}

function buildInstalledItem(params: {
  provider: InstalledSkillItem["provider"];
  kind: InstalledSkillItem["kind"];
  scope: InstalledSkillItem["scope"];
  installPath: string;
  markdown: string;
  provenance: SkillProvenanceRecord | null;
  manifestHash?: string | null;
}): InstalledSkillItem {
  const { provenance } = params;
  const currentManifestHash = params.manifestHash ?? null;
  const item: InstalledSkillItem = {
    provider: params.provider,
    kind: params.kind,
    scope: params.scope,
    slug: path.basename(params.installPath),
    displayName: parseTitleFromSkillMarkdown(params.markdown) ?? path.basename(params.installPath),
    ...(parseDescriptionFromSkillMarkdown(params.markdown)
      ? { description: parseDescriptionFromSkillMarkdown(params.markdown) }
      : {}),
    installPath: params.installPath,
    ...(provenance?.sourceUrl ? { sourceUrl: provenance.sourceUrl } : {}),
    ...(provenance?.repoUrl ? { repoUrl: provenance.repoUrl } : {}),
    ...(provenance?.sourceUrl ? { sourceHost: getSourceHost(provenance.sourceUrl) } : {}),
    ...(provenance?.sourceSubpath ? { sourceSubpath: provenance.sourceSubpath } : {}),
    ...(provenance?.installedAt ? { installedAt: provenance.installedAt } : {}),
    ...(provenance?.resolvedRef ? { resolvedRef: provenance.resolvedRef } : {}),
    ...(provenance?.resolvedDefaultBranch
      ? { resolvedDefaultBranch: provenance.resolvedDefaultBranch }
      : {}),
    ...(provenance?.resolvedCommitSha ? { resolvedCommitSha: provenance.resolvedCommitSha } : {}),
    ...(provenance?.displayNameAtInstall
      ? { displayNameAtInstall: provenance.displayNameAtInstall }
      : {}),
    ...(provenance?.descriptionAtInstall
      ? { descriptionAtInstall: provenance.descriptionAtInstall }
      : {}),
    provenanceStatus: provenance ? "verified" : "legacy",
    driftStatus: inferDriftStatus(provenance, currentManifestHash),
    ...(provenance?.lastCheckedAt ? { lastCheckedAt: provenance.lastCheckedAt } : {}),
    ...(provenance?.lastKnownRemoteCommitSha
      ? { lastKnownRemoteCommitSha: provenance.lastKnownRemoteCommitSha }
      : {}),
    ...(provenance?.lastUpgradeAt ? { lastUpgradeAt: provenance.lastUpgradeAt } : {}),
  };
  return {
    ...item,
    updateStatus: inferUpdateStatus(item),
  };
}

function deriveInstalledItemMetadata(params: {
  kind: InstalledSkillItem["kind"];
  slug: string;
  markdown: string;
  fallbackInstallPath: string;
}): {
  slug: string;
  displayName: string;
  description?: string;
} {
  if (params.kind === "subagent") {
    const slug = parseFrontmatterName(params.markdown) ?? params.slug;
    const displayName =
      parseStandaloneMarkdownTitle(params.markdown) ??
      slug ??
      path.basename(params.fallbackInstallPath, ".md");
    const description = parseStandaloneMarkdownDescription(params.markdown);
    return {
      slug,
      displayName,
      ...(description ? { description } : {}),
    };
  }

  const displayName =
    parseTitleFromSkillMarkdown(params.markdown) ?? path.basename(params.fallbackInstallPath);
  const description = parseDescriptionFromSkillMarkdown(params.markdown);
  return {
    slug: params.slug,
    displayName,
    ...(description ? { description } : {}),
  };
}

async function computeManifestHashForInstall(params: {
  installPath: string;
  markdownPath: string;
  entryType: "directory" | "file";
  realPath?: string;
}): Promise<string | null> {
  if (params.entryType === "directory") {
    return computeDirectoryManifestHash(params.realPath ?? params.installPath);
  }
  const markdown = await readFile(params.realPath ?? params.markdownPath, "utf8");
  return computeFileManifestHash(markdown);
}

function computeFileManifestHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function installPathClassFor(item: {
  provider: InstalledSkillItem["provider"];
  kind: InstalledSkillItem["kind"];
  scope: InstalledSkillItem["scope"];
}): string {
  if (item.provider === "codex") {
    return item.scope === "project" ? "project_codex_skill" : "global_codex_skill";
  }
  if (item.kind === "subagent") {
    return item.scope === "project" ? "project_claude_agent" : "global_claude_agent";
  }
  return item.scope === "project" ? "project_claude_skill" : "global_claude_skill";
}

function isFileInstall(item: { provider: SkillProvider; kind: SkillKind }): boolean {
  return item.provider === "claudeAgent" && item.kind === "subagent";
}

function managedStatusForTarget(params: {
  record: ManagedSkillRecord;
  target: ManagedSkillTargetRecord;
  onDisk: boolean;
  linkHealthy: boolean;
}): InstalledSkillItem["managedStatus"] {
  if (!params.target.enabled) {
    return "disabled";
  }
  if (params.target.role === "owner") {
    return params.onDisk ? "owner" : "broken";
  }
  if (!params.onDisk || !params.linkHealthy) {
    return "broken";
  }
  return "linked";
}

function compatibleTargetProviders(item: {
  provider: SkillProvider;
  kind: SkillKind;
}): SkillProvider[] {
  return compatibleProvidersFor(item).filter((provider) => provider !== item.provider);
}

function buildInstallPath(params: {
  provider: SkillProvider;
  kind: SkillKind;
  scope: SkillScope;
  slug: string;
  workspaceRoot?: string;
  codexHomePath?: string;
}): string {
  const root = installDirectoryFor({
    provider: params.provider,
    kind: params.kind,
    scope: params.scope,
    ...(params.workspaceRoot ? { workspaceRoot: params.workspaceRoot } : {}),
    ...(params.codexHomePath ? { codexHomePath: params.codexHomePath } : {}),
  });
  return isFileInstall(params)
    ? path.join(root, `${params.slug}.md`)
    : path.join(root, params.slug);
}

function inventoryContext(
  input:
    | SkillsListInput
    | SkillsRefreshInput
    | SkillsCheckUpdatesInput
    | SkillsPreviewAdoptInput
    | SkillsAdoptInput
    | SkillsSetEnabledInput
    | SkillsRepairManagedLinksInput
    | SkillsStopManagingInput
    | SkillsRemoveInput
    | SkillsUpgradeInput
    | SkillsReinstallInput,
) {
  return {
    ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
    ...(input.codexHomePath ? { codexHomePath: input.codexHomePath } : {}),
  };
}

function ownerTarget(record: ManagedSkillRecord): ManagedSkillTargetRecord {
  const target = record.targets.find((candidate) => candidate.role === "owner");
  if (!target) {
    throw new Error(`Managed group ${record.id} does not have an owner target.`);
  }
  return target;
}

function findManagedGroupByPath(
  records: ReadonlyArray<ManagedSkillRecord>,
  installPath: string,
): { record: ManagedSkillRecord; target: ManagedSkillTargetRecord } | null {
  for (const record of records) {
    const target = record.targets.find((candidate) => candidate.installPath === installPath);
    if (target) {
      return { record, target };
    }
  }
  return null;
}

function withManagedMetadata(
  item: InstalledSkillItem,
  record: ManagedSkillRecord,
  target: ManagedSkillTargetRecord,
  managedStatus: InstalledSkillItem["managedStatus"],
): InstalledSkillItem {
  const owner = ownerTarget(record);
  const linkedProviders = record.targets
    .filter((candidate) => candidate.role === "linked" && candidate.enabled)
    .map((candidate) => candidate.provider);
  return {
    ...item,
    managedStatus,
    managedGroupId: record.id,
    ownerProvider: owner.provider,
    ownerInstallPath: owner.installPath,
    linkedProviders,
    isAdopted: record.isAdopted,
  };
}

function createSyntheticManagedItem(params: {
  record: ManagedSkillRecord;
  target: ManagedSkillTargetRecord;
  managedStatus: InstalledSkillItem["managedStatus"];
}): InstalledSkillItem {
  const owner = ownerTarget(params.record);
  const linkedProviders = params.record.targets
    .filter((candidate) => candidate.role === "linked" && candidate.enabled)
    .map((candidate) => candidate.provider);
  return {
    provider: params.target.provider,
    kind: params.record.kind,
    scope: params.record.scope,
    slug: params.record.slug,
    displayName: params.record.displayName,
    ...(params.record.description ? { description: params.record.description } : {}),
    installPath: params.target.installPath,
    ...(params.record.sourceUrl ? { sourceUrl: params.record.sourceUrl } : {}),
    ...(params.record.repoUrl ? { repoUrl: params.record.repoUrl } : {}),
    ...(params.record.sourceHost ? { sourceHost: params.record.sourceHost } : {}),
    ...(params.record.sourceSubpath ? { sourceSubpath: params.record.sourceSubpath } : {}),
    ...(params.record.installedAt ? { installedAt: params.record.installedAt } : {}),
    ...(params.record.resolvedRef ? { resolvedRef: params.record.resolvedRef } : {}),
    ...(params.record.resolvedDefaultBranch
      ? { resolvedDefaultBranch: params.record.resolvedDefaultBranch }
      : {}),
    ...(params.record.resolvedCommitSha
      ? { resolvedCommitSha: params.record.resolvedCommitSha }
      : {}),
    managedStatus: params.managedStatus,
    managedGroupId: params.record.id,
    ownerProvider: owner.provider,
    ownerInstallPath: owner.installPath,
    linkedProviders,
    isAdopted: params.record.isAdopted,
    updateStatus: "unknown",
    driftStatus: "unknown",
    provenanceStatus: params.record.sourceUrl ? "verified" : "missing",
  };
}

async function installExists(installPath: string): Promise<boolean> {
  return fileExists(installPath);
}

async function ensureInstallParent(installPath: string): Promise<void> {
  await mkdir(path.dirname(installPath), { recursive: true });
}

async function createManagedLink(params: {
  sourcePath: string;
  targetPath: string;
}): Promise<void> {
  await ensureInstallParent(params.targetPath);
  await rm(params.targetPath, { recursive: true, force: true });
  const sourceStat = await lstat(params.sourcePath).catch(() => null);
  await symlink(params.sourcePath, params.targetPath, sourceStat?.isDirectory() ? "dir" : "file");
}

async function manifestHashForExistingInstall(item: InstalledSkillItem): Promise<string | null> {
  if (!(await installExists(item.installPath))) {
    return null;
  }
  if (isFileInstall(item)) {
    return computeFileManifestHash(await readFile(item.installPath, "utf8"));
  }
  return computeDirectoryManifestHash(item.installPath);
}

async function isHealthyManagedLink(params: {
  sourcePath: string;
  targetPath: string;
}): Promise<boolean> {
  const targetStat = await lstat(params.targetPath).catch(() => null);
  if (!targetStat?.isSymbolicLink()) {
    return false;
  }
  const [sourceRealPath, targetRealPath] = await Promise.all([
    realpath(params.sourcePath).catch(() => null),
    realpath(params.targetPath).catch(() => null),
  ]);
  return sourceRealPath !== null && targetRealPath !== null && sourceRealPath === targetRealPath;
}

export const SkillRegistryLive = Layer.effect(
  SkillRegistry,
  Effect.gen(function* () {
    const serverConfig = yield* ServerConfig;
    const analytics = yield* AnalyticsService;
    const provenanceStore = makeSkillProvenanceStore(path.join(serverConfig.stateDir, "skills"));
    const managementStore = makeSkillManagementStore(
      path.join(serverConfig.stateDir, "managed-skills"),
    );

    const recordAnalytics = (event: string, properties: Record<string, unknown>) => {
      void Effect.runPromise(analytics.record(event, properties));
    };
    const assertSkillsEnabled = (operation: string): void => {
      if (!serverConfig.skillsEnabled) {
        throw toSkillRegistryError(
          new Error(`Skills management is disabled for this server (${operation}).`),
          "Skills management is disabled for this server.",
          "permission_denied",
        );
      }
    };

    const scanInstalledInventory = async (
      input: SkillsListInput | SkillsRefreshInput | SkillsCheckUpdatesInput,
    ): Promise<SkillsInventory> => {
      const warnings: string[] = [];
      const locations = [
        { provider: "codex" as const, kind: "skill" as const, scope: "global" as const },
        { provider: "codex" as const, kind: "skill" as const, scope: "project" as const },
        { provider: "claudeAgent" as const, kind: "skill" as const, scope: "global" as const },
        { provider: "claudeAgent" as const, kind: "skill" as const, scope: "project" as const },
        { provider: "claudeAgent" as const, kind: "subagent" as const, scope: "global" as const },
        { provider: "claudeAgent" as const, kind: "subagent" as const, scope: "project" as const },
      ];
      const items: InstalledSkillItem[] = [];

      for (const location of locations) {
        if (location.scope === "project" && !input.workspaceRoot) continue;
        const root = installDirectoryFor({
          ...location,
          ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
          ...(input.codexHomePath ? { codexHomePath: input.codexHomePath } : {}),
        });
        const entries = await discoverInstalledSkillEntries({
          root,
          provider: location.provider,
          kind: location.kind,
          scope: location.scope,
        });
        for (const entry of entries) {
          try {
            const markdown = await readFile(entry.markdownPath, "utf8");
            const provenance = await provenanceStore.read(entry.installPath);
            const manifestHash = provenance?.manifestHash
              ? await computeManifestHashForInstall(entry)
              : null;
            const metadata = deriveInstalledItemMetadata({
              kind: entry.kind,
              slug: entry.slug,
              markdown,
              fallbackInstallPath: entry.installPath,
            });
            items.push({
              ...buildInstalledItem({
                provider: location.provider,
                kind: location.kind,
                scope: location.scope,
                installPath: entry.installPath,
                markdown,
                provenance,
                manifestHash,
              }),
              ...metadata,
            });
          } catch (error) {
            warnings.push(
              `Failed to parse installed ${location.kind} at ${entry.installPath}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        }
      }

      // Discover skills from Claude plugins cache (~/.claude/plugins/cache/)
      const seenSlugs = new Set(items.map((item) => item.slug));
      try {
        const pluginEntries = await discoverPluginSkillEntries();
        for (const entry of pluginEntries) {
          if (seenSlugs.has(entry.slug)) continue; // skip duplicates
          try {
            const markdown = await readFile(entry.markdownPath, "utf8");
            const metadata = deriveInstalledItemMetadata({
              kind: entry.kind,
              slug: entry.slug,
              markdown,
              fallbackInstallPath: entry.installPath,
            });
            items.push({
              ...buildInstalledItem({
                provider: entry.provider,
                kind: entry.kind,
                scope: entry.scope,
                installPath: entry.installPath,
                markdown,
                provenance: null,
              }),
              ...metadata,
            });
            seenSlugs.add(entry.slug);
          } catch (error) {
            warnings.push(
              `Failed to parse plugin skill at ${entry.installPath}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        }
      } catch (error) {
        warnings.push(
          `Failed to discover plugin skills: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      return { items, warnings };
    };

    const loadInventory = async (
      input: SkillsListInput | SkillsRefreshInput | SkillsCheckUpdatesInput,
    ): Promise<SkillsInventory> => {
      const inventory = await scanInstalledInventory(input);
      const warnings = [...inventory.warnings];
      const managedRecords = await managementStore.list();
      const itemsByPath = new Map(inventory.items.map((item) => [item.installPath, item]));
      const items = await Promise.all(
        inventory.items.map(async (item) => {
          const managed = findManagedGroupByPath(managedRecords, item.installPath);
          if (!managed) {
            return Object.assign({}, item, { managedStatus: "unmanaged" as const });
          }
          const owner = ownerTarget(managed.record);
          const linkHealthy =
            managed.target.role === "linked"
              ? await isHealthyManagedLink({
                  sourcePath: owner.installPath,
                  targetPath: managed.target.installPath,
                })
              : true;
          return withManagedMetadata(
            item,
            managed.record,
            managed.target,
            managedStatusForTarget({
              record: managed.record,
              target: managed.target,
              onDisk: true,
              linkHealthy,
            }),
          );
        }),
      );

      for (const record of managedRecords) {
        const owner = ownerTarget(record);
        for (const target of record.targets) {
          if (itemsByPath.has(target.installPath)) {
            continue;
          }
          const onDisk = await installExists(target.installPath);
          const linkHealthy =
            target.role === "linked" && onDisk
              ? await isHealthyManagedLink({
                  sourcePath: owner.installPath,
                  targetPath: target.installPath,
                })
              : false;
          items.push(
            createSyntheticManagedItem({
              record,
              target,
              managedStatus: managedStatusForTarget({
                record,
                target,
                onDisk,
                linkHealthy,
              }),
            }),
          );
        }
      }

      return {
        items: items.toSorted((left, right) => {
          const displayNameComparison = left.displayName.localeCompare(right.displayName);
          if (displayNameComparison !== 0) return displayNameComparison;
          const providerComparison = left.provider.localeCompare(right.provider);
          if (providerComparison !== 0) return providerComparison;
          return left.installPath.localeCompare(right.installPath);
        }),
        warnings,
      };
    };

    const previewAdoptImpl = async (
      input: SkillsPreviewAdoptInput,
    ): Promise<SkillsAdoptPreview> => {
      assertSkillsEnabled("preview-adopt");
      const scanned = await scanInstalledInventory(inventoryContext(input));
      const managedRecords = await managementStore.list();
      if (findManagedGroupByPath(managedRecords, input.installPath)) {
        throw new Error("This installed item is already managed for sync.");
      }
      const ownerItem = scanned.items.find((item) => item.installPath === input.installPath);
      if (!ownerItem) {
        throw new Error("The selected installed item could not be found.");
      }
      if (ownerItem.kind !== "skill") {
        return {
          installPath: ownerItem.installPath,
          provider: ownerItem.provider,
          kind: ownerItem.kind,
          scope: ownerItem.scope,
          slug: ownerItem.slug,
          displayName: ownerItem.displayName,
          canAdopt: false,
          compatibleTargets: [],
          defaultTargetProviders: [],
          warnings: [
            "Only skills can be managed across providers. Claude subagents remain local to the Claude CLI.",
          ],
        };
      }
      const targetProviders = compatibleTargetProviders(ownerItem);
      const warnings: string[] = [];
      if (targetProviders.length === 0) {
        warnings.push("This item kind does not have any compatible harness targets.");
      }
      const ownerHash = await manifestHashForExistingInstall(ownerItem);
      const compatibleTargets = await Promise.all(
        targetProviders.map(async (provider) => {
          const installPath = buildInstallPath({
            provider,
            kind: ownerItem.kind,
            scope: ownerItem.scope,
            slug: ownerItem.slug,
            ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
            ...(input.codexHomePath ? { codexHomePath: input.codexHomePath } : {}),
          });
          const existingItem = scanned.items.find((item) => item.installPath === installPath);
          if (!existingItem) {
            return {
              provider,
              installPath,
              state: "missing" as const,
            };
          }
          const healthyLink = await isHealthyManagedLink({
            sourcePath: ownerItem.installPath,
            targetPath: installPath,
          });
          if (healthyLink) {
            return {
              provider,
              installPath,
              state: "linked" as const,
            };
          }
          const existingHash = await manifestHashForExistingInstall(existingItem);
          if (ownerHash !== null && existingHash !== null && ownerHash === existingHash) {
            return {
              provider,
              installPath,
              state: "replaceable" as const,
              message: "Existing install matches the owner and can be replaced with a link.",
            };
          }
          warnings.push(
            `Cannot adopt ${provider} for ${ownerItem.displayName} because a different install already exists at ${installPath}.`,
          );
          return {
            provider,
            installPath,
            state: "conflict" as const,
            message: "A different local install already exists at this path.",
          };
        }),
      );
      const defaultTargetProviders = compatibleTargets
        .filter(
          (target) =>
            target.state === "missing" ||
            target.state === "linked" ||
            target.state === "replaceable",
        )
        .map((target) => target.provider);

      return {
        installPath: ownerItem.installPath,
        provider: ownerItem.provider,
        kind: ownerItem.kind,
        scope: ownerItem.scope,
        slug: ownerItem.slug,
        displayName: ownerItem.displayName,
        canAdopt: defaultTargetProviders.length > 0,
        compatibleTargets,
        defaultTargetProviders,
        warnings,
      };
    };

    const adoptImpl = async (input: SkillsAdoptInput): Promise<SkillsAdoptResult> => {
      assertSkillsEnabled("adopt");
      const preview = await previewAdoptImpl(input);
      if (!preview.canAdopt) {
        throw new Error("This installed item cannot be adopted for sync.");
      }
      const targetProviders = (input.targetProviders ?? preview.defaultTargetProviders).filter(
        (provider) => preview.defaultTargetProviders.includes(provider),
      );
      if (targetProviders.length === 0) {
        throw new Error("No compatible target providers were selected for adoption.");
      }
      const scanned = await scanInstalledInventory(inventoryContext(input));
      const ownerItem = scanned.items.find((item) => item.installPath === input.installPath);
      if (!ownerItem) {
        throw new Error("The selected installed item could not be found.");
      }
      const now = new Date().toISOString();
      const targets: ManagedSkillTargetRecord[] = [
        {
          provider: ownerItem.provider,
          installPath: ownerItem.installPath,
          role: "owner",
          enabled: true,
        },
      ];
      for (const provider of targetProviders) {
        const targetInstallPath = buildInstallPath({
          provider,
          kind: ownerItem.kind,
          scope: ownerItem.scope,
          slug: ownerItem.slug,
          ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
          ...(input.codexHomePath ? { codexHomePath: input.codexHomePath } : {}),
        });
        await createManagedLink({
          sourcePath: ownerItem.installPath,
          targetPath: targetInstallPath,
        });
        await provenanceStore.remove(targetInstallPath);
        targets.push({
          provider,
          installPath: targetInstallPath,
          role: "linked",
          enabled: true,
        });
      }
      await managementStore.write({
        id: randomUUID(),
        slug: ownerItem.slug,
        kind: ownerItem.kind,
        scope: ownerItem.scope,
        displayName: ownerItem.displayName,
        ...(ownerItem.description ? { description: ownerItem.description } : {}),
        ...(ownerItem.sourceUrl ? { sourceUrl: ownerItem.sourceUrl } : {}),
        ...(ownerItem.repoUrl ? { repoUrl: ownerItem.repoUrl } : {}),
        ...(ownerItem.sourceHost ? { sourceHost: ownerItem.sourceHost } : {}),
        ...(ownerItem.sourceSubpath ? { sourceSubpath: ownerItem.sourceSubpath } : {}),
        ...(ownerItem.installedAt ? { installedAt: ownerItem.installedAt } : {}),
        ...(ownerItem.resolvedRef ? { resolvedRef: ownerItem.resolvedRef } : {}),
        ...(ownerItem.resolvedDefaultBranch
          ? { resolvedDefaultBranch: ownerItem.resolvedDefaultBranch }
          : {}),
        ...(ownerItem.resolvedCommitSha ? { resolvedCommitSha: ownerItem.resolvedCommitSha } : {}),
        isAdopted: true,
        createdAt: now,
        updatedAt: now,
        targets,
      });
      return loadInventory(inventoryContext(input));
    };

    const setEnabledImpl = async (input: SkillsSetEnabledInput): Promise<SkillsInventory> => {
      assertSkillsEnabled("set-enabled");
      const records = await managementStore.list();
      const managed = findManagedGroupByPath(records, input.installPath);
      if (!managed) {
        throw new Error("This installed item is not managed for sync.");
      }
      const { record, target } = managed;
      if (!input.enabled && input.scope === "current-provider" && target.role === "owner") {
        throw new Error(
          "Cannot disable the owner install. Remove linked providers or stop managing the item instead.",
        );
      }

      const owner = ownerTarget(record);
      const enablingLinkedTargets = record.targets.some((candidate) => {
        const shouldApply =
          input.scope === "all-providers"
            ? candidate.role === "linked"
            : candidate.installPath === target.installPath;
        return shouldApply && candidate.role === "linked" && input.enabled;
      });
      if (enablingLinkedTargets && !(await installExists(owner.installPath))) {
        throw new Error("The managed owner install is missing and cannot enable linked targets.");
      }
      const nextTargets = await Promise.all(
        record.targets.map(async (candidate) => {
          const shouldApply =
            input.scope === "all-providers"
              ? candidate.role === "linked"
              : candidate.installPath === target.installPath;
          if (!shouldApply) {
            return candidate;
          }
          if (candidate.role === "owner") {
            return { ...candidate, enabled: true };
          }
          if (input.enabled) {
            await createManagedLink({
              sourcePath: owner.installPath,
              targetPath: candidate.installPath,
            });
          } else {
            await rm(candidate.installPath, { recursive: true, force: true });
          }
          await provenanceStore.remove(candidate.installPath);
          return { ...candidate, enabled: input.enabled };
        }),
      );

      await managementStore.write({
        ...record,
        updatedAt: new Date().toISOString(),
        targets: nextTargets,
      });
      return loadInventory(inventoryContext(input));
    };

    const repairManagedLinksImpl = async (
      input: SkillsRepairManagedLinksInput,
    ): Promise<SkillsInventory> => {
      assertSkillsEnabled("repair-managed-links");
      const records = await managementStore.list();
      const managed = findManagedGroupByPath(records, input.installPath);
      if (!managed) {
        throw new Error("This installed item is not managed for sync.");
      }
      const owner = ownerTarget(managed.record);
      if (!(await installExists(owner.installPath))) {
        throw new Error("The managed owner install is missing and cannot repair links.");
      }
      for (const target of managed.record.targets) {
        if (target.role === "owner") {
          continue;
        }
        if (target.enabled) {
          await createManagedLink({
            sourcePath: owner.installPath,
            targetPath: target.installPath,
          });
        } else {
          await rm(target.installPath, { recursive: true, force: true });
        }
        await provenanceStore.remove(target.installPath);
      }
      return loadInventory(inventoryContext(input));
    };

    const stopManagingImpl = async (input: SkillsStopManagingInput): Promise<SkillsInventory> => {
      assertSkillsEnabled("stop-managing");
      const records = await managementStore.list();
      const managed = findManagedGroupByPath(records, input.installPath);
      if (!managed) {
        throw new Error("This installed item is not managed for sync.");
      }
      for (const target of managed.record.targets) {
        if (target.role === "owner") {
          continue;
        }
        await rm(target.installPath, { recursive: true, force: true });
        await provenanceStore.remove(target.installPath);
      }
      await managementStore.remove(managed.record.id);
      return loadInventory(inventoryContext(input));
    };

    const previewAdopt = (input: SkillsPreviewAdoptInput) =>
      Effect.tryPromise({
        try: () => previewAdoptImpl(input),
        catch: (error) => toSkillRegistryError(error, "Failed to preview sync adoption."),
      });

    const previewInstall = (input: SkillsPreviewInstallInput) =>
      Effect.tryPromise({
        try: async () => {
          assertSkillsEnabled("preview");
          const startedAt = Date.now();
          const source = await resolveSkillSource(input.url);
          if (input.scope === "project" && !input.workspaceRoot) {
            throw new Error("Project-scoped installs require a workspace root.");
          }
          const installRoot = installDirectoryFor({
            provider: input.provider,
            kind: input.kind,
            scope: input.scope,
            ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
            ...(input.codexHomePath ? { codexHomePath: input.codexHomePath } : {}),
          });
          const installPath =
            input.provider === "claudeAgent" && input.kind === "subagent"
              ? path.join(installRoot, `${source.slug}.md`)
              : path.join(installRoot, source.slug);
          recordAnalytics("skills.preview.success", {
            provider: input.provider,
            kind: input.kind,
            scope: input.scope,
            sourceHost: source.sourceHost,
            repoUrl: source.repoUrl,
            resolvedCommitSha: source.commitSha,
            destinationPathClass: installPathClassFor(input),
            durationMs: Date.now() - startedAt,
          });
          return {
            provider: input.provider,
            kind: input.kind,
            scope: input.scope,
            slug: source.slug,
            displayName: source.displayName,
            ...(source.description ? { description: source.description } : {}),
            sourceUrl: source.sourceUrl,
            repoUrl: source.repoUrl,
            sourceHost: source.sourceHost,
            ...(source.sourceSubpath ? { sourceSubpath: source.sourceSubpath } : {}),
            resolvedDefaultBranch: source.defaultBranch,
            resolvedCommitSha: source.commitSha,
            installPath,
            exists: await fileExists(installPath),
            warnings: source.warnings,
          } satisfies SkillsInstallPreview;
        },
        catch: (error) => {
          const code = mapErrorCode(error);
          logger.warn("skills preview failed", {
            code,
            error: String(error),
            sourceUrl: input.url,
          });
          recordAnalytics("skills.preview.failure", {
            code,
            sourceUrl: input.url,
            retryable: retryableForCode(code),
          });
          return toSkillRegistryError(error, "Failed to preview skill install.", code);
        },
      });

    const installFromSource = async (params: {
      source: ResolvedSkillSource;
      installPath: string;
      provider: InstalledSkillItem["provider"];
      kind: InstalledSkillItem["kind"];
      scope: InstalledSkillItem["scope"];
      overwrite?: boolean;
      existing?: InstalledSkillItem | null;
    }): Promise<SkillsInstallResult> => {
      const { markdown, manifestHash } = await installSkillFromResolvedSource({
        source: params.source,
        installPath: params.installPath,
        provider: params.provider,
        kind: params.kind,
        ...(params.overwrite !== undefined ? { overwrite: params.overwrite } : {}),
      });
      const now = new Date().toISOString();
      const record: SkillProvenanceRecord = {
        installPath: params.installPath,
        sourceUrl: params.source.sourceUrl,
        repoUrl: params.source.repoUrl,
        ...(params.source.sourceSubpath ? { sourceSubpath: params.source.sourceSubpath } : {}),
        installedSlug: params.source.slug,
        provider: params.provider,
        kind: params.kind,
        scope: params.scope,
        installedAt: params.existing?.installedAt ?? now,
        installedByAppVersion: appVersion,
        resolvedRef: params.source.commitSha,
        resolvedDefaultBranch: params.source.defaultBranch,
        resolvedCommitSha: params.source.commitSha,
        displayNameAtInstall: params.source.displayName,
        ...(params.source.description ? { descriptionAtInstall: params.source.description } : {}),
        manifestHash,
        ...(params.existing?.lastCheckedAt ? { lastCheckedAt: params.existing.lastCheckedAt } : {}),
        ...(params.existing?.lastKnownRemoteCommitSha
          ? { lastKnownRemoteCommitSha: params.existing.lastKnownRemoteCommitSha }
          : { lastKnownRemoteCommitSha: params.source.commitSha }),
        ...(params.existing ? { lastUpgradeAt: now } : {}),
      };
      await provenanceStore.write(record);
      const metadata = deriveInstalledItemMetadata({
        kind: params.kind,
        slug: params.source.slug,
        markdown,
        fallbackInstallPath: params.installPath,
      });
      return {
        item: {
          ...buildInstalledItem({
            provider: params.provider,
            kind: params.kind,
            scope: params.scope,
            installPath: params.installPath,
            markdown,
            provenance: record,
            manifestHash,
          }),
          ...metadata,
        },
        warnings: params.source.warnings,
      };
    };

    const list = (input: SkillsListInput) =>
      Effect.tryPromise({
        try: () => loadInventory(input),
        catch: (error) => toSkillRegistryError(error, "Failed to load skills inventory."),
      });

    const adopt = (input: SkillsAdoptInput) =>
      Effect.tryPromise({
        try: () => adoptImpl(input),
        catch: (error) => toSkillRegistryError(error, "Failed to adopt installed item."),
      });

    const install = (input: SkillsInstallInput) =>
      Effect.tryPromise({
        try: async () => {
          assertSkillsEnabled("install");
          const startedAt = Date.now();
          if (input.scope === "project" && !input.workspaceRoot) {
            throw new Error("Project-scoped installs require a workspace root.");
          }
          const source = await resolveSkillSource(input.url);
          const installRoot = installDirectoryFor({
            provider: input.provider,
            kind: input.kind,
            scope: input.scope,
            ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
            ...(input.codexHomePath ? { codexHomePath: input.codexHomePath } : {}),
          });
          const installPath =
            input.provider === "claudeAgent" && input.kind === "subagent"
              ? path.join(installRoot, `${source.slug}.md`)
              : path.join(installRoot, source.slug);
          const result = await installFromSource({
            source,
            installPath,
            provider: input.provider,
            kind: input.kind,
            scope: input.scope,
            ...(input.overwrite !== undefined ? { overwrite: input.overwrite } : {}),
          });
          logger.event("skill installed", {
            provider: input.provider,
            kind: input.kind,
            scope: input.scope,
            sourceUrl: source.sourceUrl,
            repoUrl: source.repoUrl,
            installPath,
            commit: source.commitSha,
          });
          recordAnalytics("skills.install.success", {
            provider: input.provider,
            kind: input.kind,
            scope: input.scope,
            sourceHost: source.sourceHost,
            repoUrl: source.repoUrl,
            resolvedCommitSha: source.commitSha,
            destinationPathClass: installPathClassFor(input),
            durationMs: Date.now() - startedAt,
          });
          return result;
        },
        catch: (error) => {
          const code = mapErrorCode(error);
          logger.error("skill install failed", {
            code,
            error: String(error),
            sourceUrl: input.url,
          });
          recordAnalytics("skills.install.failure", {
            code,
            sourceUrl: input.url,
            provider: input.provider,
            kind: input.kind,
            scope: input.scope,
            retryable: retryableForCode(code),
            destinationPathClass: installPathClassFor(input),
          });
          return toSkillRegistryError(error, "Failed to install skill.", code);
        },
      });

    const remove = (input: SkillsRemoveInput) =>
      Effect.tryPromise({
        try: async () => {
          assertSkillsEnabled("remove");
          const startedAt = Date.now();
          const normalizedInstallPath = path.resolve(input.installPath);
          if (findManagedGroupByPath(await managementStore.list(), normalizedInstallPath)) {
            throw new Error(
              "Managed items cannot be removed directly. Disable the linked harness or stop managing the item first.",
            );
          }
          const allowedDirectories = listManagedDirectories({
            ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
            ...(input.codexHomePath ? { codexHomePath: input.codexHomePath } : {}),
          });
          const isAllowed = allowedDirectories.some((directory) =>
            isWithinDirectory(normalizedInstallPath, directory),
          );
          if (!isAllowed) {
            throw new Error("Refusing to remove a path outside managed skill directories.");
          }
          const isDirectoryInstall = await fileExists(path.join(normalizedInstallPath, SKILL_MD));
          const isMarkdownInstall =
            normalizedInstallPath.endsWith(".md") && (await fileExists(normalizedInstallPath));
          if (!isDirectoryInstall && !isMarkdownInstall) {
            throw new Error(
              "Refusing to remove a path that is not a managed skill or subagent install.",
            );
          }
          await rm(normalizedInstallPath, { recursive: true, force: true });
          await provenanceStore.remove(normalizedInstallPath);
          logger.event("skill removed", { installPath: normalizedInstallPath });
          recordAnalytics("skills.remove.success", {
            installPath: normalizedInstallPath,
            durationMs: Date.now() - startedAt,
          });
          return { removed: true };
        },
        catch: (error) => {
          const code = mapErrorCode(error);
          logger.warn("skill remove failed", {
            code,
            error: String(error),
            installPath: input.installPath,
          });
          recordAnalytics("skills.remove.failure", {
            code,
            installPath: input.installPath,
            retryable: retryableForCode(code),
          });
          return toSkillRegistryError(error, "Failed to remove skill.", code);
        },
      });

    const refresh = (input: SkillsRefreshInput) => list(input);

    const checkUpdates = (input: SkillsCheckUpdatesInput) =>
      Effect.tryPromise({
        try: async () => {
          assertSkillsEnabled("check-updates");
          const startedAt = Date.now();
          const inventory = await loadInventory(input);
          const nextItems: InstalledSkillItem[] = [];
          const warnings = [...inventory.warnings];
          for (const item of inventory.items) {
            if (input.installPath && item.installPath !== input.installPath) {
              nextItems.push(item);
              continue;
            }
            if (
              item.managedStatus &&
              item.managedStatus !== "owner" &&
              item.managedStatus !== "unmanaged"
            ) {
              nextItems.push({ ...item, updateStatus: "unsupported" });
              continue;
            }
            if (!item.repoUrl || !item.sourceUrl) {
              nextItems.push({ ...item, updateStatus: "unsupported" });
              continue;
            }
            try {
              const repo = await resolveGitHubRepository(item.repoUrl);
              const provenance = await provenanceStore.read(item.installPath);
              const nextRecord: SkillProvenanceRecord = {
                ...(provenance ?? { installPath: item.installPath }),
                installPath: item.installPath,
                ...(item.sourceUrl ? { sourceUrl: item.sourceUrl } : {}),
                ...(item.repoUrl ? { repoUrl: item.repoUrl } : {}),
                ...(item.sourceSubpath ? { sourceSubpath: item.sourceSubpath } : {}),
                installedSlug: item.slug,
                provider: item.provider,
                kind: item.kind,
                scope: item.scope,
                ...(provenance?.installedAt ? { installedAt: provenance.installedAt } : {}),
                ...(provenance?.installedByAppVersion
                  ? { installedByAppVersion: provenance.installedByAppVersion }
                  : {}),
                ...(item.resolvedRef ? { resolvedRef: item.resolvedRef } : {}),
                resolvedDefaultBranch: repo.defaultBranch,
                ...(item.resolvedCommitSha ? { resolvedCommitSha: item.resolvedCommitSha } : {}),
                ...(provenance?.displayNameAtInstall
                  ? { displayNameAtInstall: provenance.displayNameAtInstall }
                  : {}),
                ...(provenance?.descriptionAtInstall
                  ? { descriptionAtInstall: provenance.descriptionAtInstall }
                  : {}),
                ...(provenance?.manifestHash ? { manifestHash: provenance.manifestHash } : {}),
                lastCheckedAt: new Date().toISOString(),
                lastKnownRemoteCommitSha: repo.commitSha,
                ...(provenance?.lastUpgradeAt ? { lastUpgradeAt: provenance.lastUpgradeAt } : {}),
              };
              await provenanceStore.write(nextRecord);
              const markdownPath =
                item.kind === "subagent" && item.provider === "claudeAgent"
                  ? item.installPath
                  : path.join(item.installPath, SKILL_MD);
              const markdown = await readFile(markdownPath, "utf8");
              const metadata = deriveInstalledItemMetadata({
                kind: item.kind,
                slug: item.slug,
                markdown,
                fallbackInstallPath: item.installPath,
              });
              nextItems.push({
                ...buildInstalledItem({
                  provider: item.provider,
                  kind: item.kind,
                  scope: item.scope,
                  installPath: item.installPath,
                  markdown,
                  provenance: nextRecord,
                  manifestHash:
                    item.kind === "subagent" && item.provider === "claudeAgent"
                      ? await computeManifestHashForInstall({
                          installPath: item.installPath,
                          markdownPath,
                          entryType: "file",
                        })
                      : await computeDirectoryManifestHash(item.installPath),
                }),
                ...metadata,
              });
            } catch (error) {
              warnings.push(
                `Failed to check updates for ${item.displayName}: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
              nextItems.push({ ...item, updateStatus: "unknown" });
            }
          }
          recordAnalytics("skills.check-updates.success", {
            count: nextItems.length,
            installPath: input.installPath ?? "all",
            durationMs: Date.now() - startedAt,
          });
          return { items: nextItems, warnings };
        },
        catch: (error) => {
          const code = mapErrorCode(error);
          recordAnalytics("skills.check-updates.failure", {
            code,
            installPath: input.installPath,
            retryable: retryableForCode(code),
          });
          return toSkillRegistryError(error, "Failed to check skill updates.", code);
        },
      });

    const reinstall = (input: SkillsReinstallInput) =>
      Effect.tryPromise({
        try: async () => {
          assertSkillsEnabled("reinstall");
          const startedAt = Date.now();
          const inventory = await loadInventory({
            ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
            ...(input.codexHomePath ? { codexHomePath: input.codexHomePath } : {}),
          });
          const existing = inventory.items.find((item) => item.installPath === input.installPath);
          if (
            existing?.managedStatus &&
            existing.managedStatus !== "owner" &&
            existing.managedStatus !== "unmanaged"
          ) {
            throw new Error(
              "Only unmanaged or owner installs can be reinstalled. Repair or enable the managed target instead.",
            );
          }
          if (!existing || !existing.sourceUrl) {
            throw new Error(
              "This installed item cannot be reinstalled because its source is unknown.",
            );
          }
          const source = await resolveSkillSource(existing.sourceUrl);
          const result = await installFromSource({
            source,
            installPath: existing.installPath,
            provider: existing.provider,
            kind: existing.kind,
            scope: existing.scope,
            ...(input.overwrite !== undefined
              ? { overwrite: input.overwrite }
              : { overwrite: true }),
            existing,
          });
          recordAnalytics("skills.reinstall.success", {
            installPath: existing.installPath,
            sourceHost: source.sourceHost,
            repoUrl: source.repoUrl,
            resolvedCommitSha: source.commitSha,
            destinationPathClass: installPathClassFor(existing),
            durationMs: Date.now() - startedAt,
          });
          return result;
        },
        catch: (error) => {
          const code = mapErrorCode(error);
          recordAnalytics("skills.reinstall.failure", {
            code,
            installPath: input.installPath,
            retryable: retryableForCode(code),
          });
          return toSkillRegistryError(error, "Failed to reinstall skill.", code);
        },
      });

    const upgrade = (input: SkillsUpgradeInput) =>
      Effect.tryPromise({
        try: async () => {
          assertSkillsEnabled("upgrade");
          const startedAt = Date.now();
          const inventory = await loadInventory({
            ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
            ...(input.codexHomePath ? { codexHomePath: input.codexHomePath } : {}),
          });
          const existing = inventory.items.find((item) => item.installPath === input.installPath);
          if (
            existing?.managedStatus &&
            existing.managedStatus !== "owner" &&
            existing.managedStatus !== "unmanaged"
          ) {
            throw new Error(
              "Only unmanaged or owner installs can be upgraded. Repair or enable the managed target instead.",
            );
          }
          if (!existing || !existing.sourceUrl || !existing.repoUrl) {
            throw new Error(
              "This installed item cannot be upgraded because its source is unknown.",
            );
          }
          const source = await resolveSkillSource(existing.sourceUrl);
          const result = await installFromSource({
            source,
            installPath: existing.installPath,
            provider: existing.provider,
            kind: existing.kind,
            scope: existing.scope,
            ...(input.overwrite !== undefined
              ? { overwrite: input.overwrite }
              : { overwrite: true }),
            existing,
          });
          recordAnalytics("skills.upgrade.success", {
            installPath: existing.installPath,
            sourceHost: source.sourceHost,
            repoUrl: source.repoUrl,
            resolvedCommitSha: source.commitSha,
            destinationPathClass: installPathClassFor(existing),
            durationMs: Date.now() - startedAt,
          });
          return {
            ...result,
            warnings:
              existing.driftStatus && existing.driftStatus !== "clean"
                ? ["Local changes were replaced during upgrade.", ...result.warnings]
                : result.warnings,
          };
        },
        catch: (error) => {
          const code = mapErrorCode(error);
          recordAnalytics("skills.upgrade.failure", {
            code,
            installPath: input.installPath,
            retryable: retryableForCode(code),
          });
          return toSkillRegistryError(error, "Failed to upgrade skill.", code);
        },
      });

    const setEnabled = (input: SkillsSetEnabledInput) =>
      Effect.tryPromise({
        try: () => setEnabledImpl(input),
        catch: (error) => toSkillRegistryError(error, "Failed to update managed skill state."),
      });

    const repairManagedLinks = (input: SkillsRepairManagedLinksInput) =>
      Effect.tryPromise({
        try: () => repairManagedLinksImpl(input),
        catch: (error) => toSkillRegistryError(error, "Failed to repair managed links."),
      });

    const stopManaging = (input: SkillsStopManagingInput) =>
      Effect.tryPromise({
        try: () => stopManagingImpl(input),
        catch: (error) => toSkillRegistryError(error, "Failed to stop managing the item."),
      });

    return {
      list,
      previewAdopt,
      adopt,
      previewInstall,
      install,
      remove,
      refresh,
      checkUpdates,
      upgrade,
      reinstall,
      setEnabled,
      repairManagedLinks,
      stopManaging,
    } satisfies SkillRegistryShape;
  }),
);
