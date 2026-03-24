import { Schema } from "effect";
import { TrimmedNonEmptyString } from "./baseSchemas";
import { ProviderKind } from "./orchestration";

export const SkillProvider = ProviderKind;
export type SkillProvider = typeof SkillProvider.Type;

export const SkillKind = Schema.Literals(["skill", "subagent"]);
export type SkillKind = typeof SkillKind.Type;

export const SkillScope = Schema.Literals(["global", "project"]);
export type SkillScope = typeof SkillScope.Type;

export const SkillManagedStatus = Schema.Literals([
  "unmanaged",
  "owner",
  "linked",
  "disabled",
  "broken",
]);
export type SkillManagedStatus = typeof SkillManagedStatus.Type;

export const SkillEnableScope = Schema.Literals(["current-provider", "all-providers"]);
export type SkillEnableScope = typeof SkillEnableScope.Type;

export const SkillAdoptTargetState = Schema.Literals([
  "missing",
  "linked",
  "replaceable",
  "conflict",
]);
export type SkillAdoptTargetState = typeof SkillAdoptTargetState.Type;

export const SkillOperationFailureCode = Schema.Literals([
  "unsupported_source",
  "resolution_failed",
  "network_failed",
  "archive_invalid",
  "skill_root_not_found",
  "validation_failed",
  "destination_exists",
  "permission_denied",
  "filesystem_failed",
]);
export type SkillOperationFailureCode = typeof SkillOperationFailureCode.Type;

export const SkillProvenanceStatus = Schema.Literals([
  "verified",
  "legacy",
  "missing",
  "unsupported",
]);
export type SkillProvenanceStatus = typeof SkillProvenanceStatus.Type;

export const SkillUpdateStatus = Schema.Literals([
  "up-to-date",
  "update-available",
  "unknown",
  "unsupported",
]);
export type SkillUpdateStatus = typeof SkillUpdateStatus.Type;

export const SkillDriftStatus = Schema.Literals([
  "clean",
  "locally-modified",
  "drifted",
  "unknown",
]);
export type SkillDriftStatus = typeof SkillDriftStatus.Type;

export const SkillOperationFailure = Schema.Struct({
  code: SkillOperationFailureCode,
  message: TrimmedNonEmptyString,
  retryable: Schema.Boolean,
  details: Schema.optional(TrimmedNonEmptyString),
});
export type SkillOperationFailure = typeof SkillOperationFailure.Type;

export const SkillsListInput = Schema.Struct({
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  codexHomePath: Schema.optional(TrimmedNonEmptyString),
});
export type SkillsListInput = typeof SkillsListInput.Type;

export const SkillsRefreshInput = SkillsListInput;
export type SkillsRefreshInput = typeof SkillsRefreshInput.Type;

export const InstalledSkillItem = Schema.Struct({
  provider: SkillProvider,
  kind: SkillKind,
  scope: SkillScope,
  slug: TrimmedNonEmptyString,
  displayName: TrimmedNonEmptyString,
  description: Schema.optional(TrimmedNonEmptyString),
  installPath: TrimmedNonEmptyString,
  sourceUrl: Schema.optional(TrimmedNonEmptyString),
  repoUrl: Schema.optional(TrimmedNonEmptyString),
  sourceHost: Schema.optional(TrimmedNonEmptyString),
  sourceSubpath: Schema.optional(TrimmedNonEmptyString),
  installedAt: Schema.optional(TrimmedNonEmptyString),
  resolvedRef: Schema.optional(TrimmedNonEmptyString),
  resolvedDefaultBranch: Schema.optional(TrimmedNonEmptyString),
  resolvedCommitSha: Schema.optional(TrimmedNonEmptyString),
  displayNameAtInstall: Schema.optional(TrimmedNonEmptyString),
  descriptionAtInstall: Schema.optional(TrimmedNonEmptyString),
  provenanceStatus: Schema.optional(SkillProvenanceStatus),
  updateStatus: Schema.optional(SkillUpdateStatus),
  driftStatus: Schema.optional(SkillDriftStatus),
  lastCheckedAt: Schema.optional(TrimmedNonEmptyString),
  lastKnownRemoteCommitSha: Schema.optional(TrimmedNonEmptyString),
  lastUpgradeAt: Schema.optional(TrimmedNonEmptyString),
  managedStatus: Schema.optional(SkillManagedStatus),
  managedGroupId: Schema.optional(TrimmedNonEmptyString),
  ownerProvider: Schema.optional(SkillProvider),
  ownerInstallPath: Schema.optional(TrimmedNonEmptyString),
  linkedProviders: Schema.optional(Schema.Array(SkillProvider)),
  isAdopted: Schema.optional(Schema.Boolean),
});
export type InstalledSkillItem = typeof InstalledSkillItem.Type;

export const SkillsInventory = Schema.Struct({
  items: Schema.Array(InstalledSkillItem),
  warnings: Schema.Array(TrimmedNonEmptyString),
});
export type SkillsInventory = typeof SkillsInventory.Type;

export const SkillsPreviewInstallInput = Schema.Struct({
  url: TrimmedNonEmptyString,
  provider: SkillProvider,
  kind: SkillKind,
  scope: SkillScope,
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  codexHomePath: Schema.optional(TrimmedNonEmptyString),
});
export type SkillsPreviewInstallInput = typeof SkillsPreviewInstallInput.Type;

export const SkillsInstallPreview = Schema.Struct({
  provider: SkillProvider,
  kind: SkillKind,
  scope: SkillScope,
  slug: TrimmedNonEmptyString,
  displayName: TrimmedNonEmptyString,
  description: Schema.optional(TrimmedNonEmptyString),
  sourceUrl: TrimmedNonEmptyString,
  repoUrl: TrimmedNonEmptyString,
  sourceHost: Schema.optional(TrimmedNonEmptyString),
  sourceSubpath: Schema.optional(TrimmedNonEmptyString),
  resolvedDefaultBranch: Schema.optional(TrimmedNonEmptyString),
  resolvedCommitSha: Schema.optional(TrimmedNonEmptyString),
  installPath: TrimmedNonEmptyString,
  exists: Schema.Boolean,
  warnings: Schema.Array(TrimmedNonEmptyString),
});
export type SkillsInstallPreview = typeof SkillsInstallPreview.Type;

export const SkillsInstallInput = Schema.Struct({
  url: TrimmedNonEmptyString,
  provider: SkillProvider,
  kind: SkillKind,
  scope: SkillScope,
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  codexHomePath: Schema.optional(TrimmedNonEmptyString),
  overwrite: Schema.optional(Schema.Boolean),
});
export type SkillsInstallInput = typeof SkillsInstallInput.Type;

export const SkillsInstallResult = Schema.Struct({
  item: InstalledSkillItem,
  warnings: Schema.Array(TrimmedNonEmptyString),
});
export type SkillsInstallResult = typeof SkillsInstallResult.Type;

export const SkillsCheckUpdatesInput = Schema.Struct({
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  codexHomePath: Schema.optional(TrimmedNonEmptyString),
  installPath: Schema.optional(TrimmedNonEmptyString),
});
export type SkillsCheckUpdatesInput = typeof SkillsCheckUpdatesInput.Type;

export const SkillsCheckUpdatesResult = SkillsInventory;
export type SkillsCheckUpdatesResult = typeof SkillsCheckUpdatesResult.Type;

export const SkillsUpgradeInput = Schema.Struct({
  installPath: TrimmedNonEmptyString,
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  codexHomePath: Schema.optional(TrimmedNonEmptyString),
  overwrite: Schema.optional(Schema.Boolean),
});
export type SkillsUpgradeInput = typeof SkillsUpgradeInput.Type;

export const SkillsUpgradeResult = SkillsInstallResult;
export type SkillsUpgradeResult = typeof SkillsUpgradeResult.Type;

export const SkillsReinstallInput = Schema.Struct({
  installPath: TrimmedNonEmptyString,
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  codexHomePath: Schema.optional(TrimmedNonEmptyString),
  overwrite: Schema.optional(Schema.Boolean),
});
export type SkillsReinstallInput = typeof SkillsReinstallInput.Type;

export const SkillsReinstallResult = SkillsInstallResult;
export type SkillsReinstallResult = typeof SkillsReinstallResult.Type;

export const SkillsRemoveInput = Schema.Struct({
  installPath: TrimmedNonEmptyString,
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  codexHomePath: Schema.optional(TrimmedNonEmptyString),
});
export type SkillsRemoveInput = typeof SkillsRemoveInput.Type;

export const SkillsRemoveResult = Schema.Struct({
  removed: Schema.Boolean,
});
export type SkillsRemoveResult = typeof SkillsRemoveResult.Type;

export const SkillsAdoptTarget = Schema.Struct({
  provider: SkillProvider,
  installPath: TrimmedNonEmptyString,
  state: SkillAdoptTargetState,
  message: Schema.optional(TrimmedNonEmptyString),
});
export type SkillsAdoptTarget = typeof SkillsAdoptTarget.Type;

export const SkillsPreviewAdoptInput = Schema.Struct({
  installPath: TrimmedNonEmptyString,
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  codexHomePath: Schema.optional(TrimmedNonEmptyString),
});
export type SkillsPreviewAdoptInput = typeof SkillsPreviewAdoptInput.Type;

export const SkillsAdoptPreview = Schema.Struct({
  installPath: TrimmedNonEmptyString,
  provider: SkillProvider,
  kind: SkillKind,
  scope: SkillScope,
  slug: TrimmedNonEmptyString,
  displayName: TrimmedNonEmptyString,
  canAdopt: Schema.Boolean,
  compatibleTargets: Schema.Array(SkillsAdoptTarget),
  defaultTargetProviders: Schema.Array(SkillProvider),
  warnings: Schema.Array(TrimmedNonEmptyString),
});
export type SkillsAdoptPreview = typeof SkillsAdoptPreview.Type;

export const SkillsAdoptInput = Schema.Struct({
  installPath: TrimmedNonEmptyString,
  targetProviders: Schema.optional(Schema.Array(SkillProvider)),
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  codexHomePath: Schema.optional(TrimmedNonEmptyString),
});
export type SkillsAdoptInput = typeof SkillsAdoptInput.Type;

export const SkillsAdoptResult = SkillsInventory;
export type SkillsAdoptResult = typeof SkillsAdoptResult.Type;

export const SkillsSetEnabledInput = Schema.Struct({
  installPath: TrimmedNonEmptyString,
  enabled: Schema.Boolean,
  scope: SkillEnableScope,
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  codexHomePath: Schema.optional(TrimmedNonEmptyString),
});
export type SkillsSetEnabledInput = typeof SkillsSetEnabledInput.Type;

export const SkillsSetEnabledResult = SkillsInventory;
export type SkillsSetEnabledResult = typeof SkillsSetEnabledResult.Type;

export const SkillsRepairManagedLinksInput = Schema.Struct({
  installPath: TrimmedNonEmptyString,
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  codexHomePath: Schema.optional(TrimmedNonEmptyString),
});
export type SkillsRepairManagedLinksInput = typeof SkillsRepairManagedLinksInput.Type;

export const SkillsRepairManagedLinksResult = SkillsInventory;
export type SkillsRepairManagedLinksResult = typeof SkillsRepairManagedLinksResult.Type;

export const SkillsStopManagingInput = Schema.Struct({
  installPath: TrimmedNonEmptyString,
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  codexHomePath: Schema.optional(TrimmedNonEmptyString),
});
export type SkillsStopManagingInput = typeof SkillsStopManagingInput.Type;

export const SkillsStopManagingResult = SkillsInventory;
export type SkillsStopManagingResult = typeof SkillsStopManagingResult.Type;
