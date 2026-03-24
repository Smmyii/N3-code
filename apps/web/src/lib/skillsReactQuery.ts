import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import type { ProviderKind } from "@t3tools/contracts";
import type {
  SkillsAdoptInput,
  SkillsPreviewAdoptInput,
  SkillsSetEnabledInput,
  SkillsRepairManagedLinksInput,
  SkillsStopManagingInput,
  SkillsInstallInput,
  SkillsPreviewInstallInput,
  SkillsRefreshInput,
  SkillsRemoveInput,
  SkillsCheckUpdatesInput,
  SkillsUpgradeInput,
  SkillsReinstallInput,
} from "@t3tools/contracts";
import { ensureNativeApi } from "~/nativeApi";

export const skillsQueryKeys = {
  all: ["skills"] as const,
  inventory: (workspaceRoot: string | null, codexHomePath: string | null) =>
    ["skills", "inventory", workspaceRoot, codexHomePath] as const,
  adoptPreview: (installPath: string, workspaceRoot: string | null, codexHomePath: string | null) =>
    ["skills", "adopt-preview", installPath, workspaceRoot, codexHomePath] as const,
  preview: (
    url: string,
    provider: string,
    kind: string,
    scope: string,
    workspaceRoot: string | null,
    codexHomePath: string | null,
  ) => ["skills", "preview", url, provider, kind, scope, workspaceRoot, codexHomePath] as const,
  updates: (
    workspaceRoot: string | null,
    codexHomePath: string | null,
    installPath: string | null,
  ) => ["skills", "updates", workspaceRoot, codexHomePath, installPath] as const,
  inventoryByProvider: (
    workspaceRoot: string | null,
    codexHomePath: string | null,
    provider: ProviderKind | null,
  ) => ["skills", "inventory-by-provider", workspaceRoot, codexHomePath, provider] as const,
};

export function invalidateSkillsQueries(
  queryClient: QueryClient,
  input: {
    workspaceRoot: string | null;
    codexHomePath: string | null;
    provider?: ProviderKind | null;
    installPath?: string | null;
  },
) {
  const invalidations = [
    queryClient.invalidateQueries({ queryKey: skillsQueryKeys.all }),
    queryClient.invalidateQueries({
      queryKey: skillsQueryKeys.inventory(input.workspaceRoot, input.codexHomePath),
    }),
    queryClient.invalidateQueries({
      queryKey: skillsQueryKeys.inventoryByProvider(
        input.workspaceRoot,
        input.codexHomePath,
        input.provider ?? null,
      ),
    }),
    queryClient.invalidateQueries({
      queryKey: skillsQueryKeys.updates(
        input.workspaceRoot,
        input.codexHomePath,
        input.installPath ?? null,
      ),
    }),
  ];
  return Promise.all(invalidations);
}

export function skillsInventoryQueryOptions(input: {
  workspaceRoot: string | null;
  codexHomePath: string | null;
}) {
  return queryOptions({
    queryKey: skillsQueryKeys.inventory(input.workspaceRoot, input.codexHomePath),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.skills.list({
        ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
        ...(input.codexHomePath ? { codexHomePath: input.codexHomePath } : {}),
      });
    },
    staleTime: 10_000,
  });
}

export function skillsPreviewQueryOptions(
  input: SkillsPreviewInstallInput & { enabled?: boolean },
) {
  const { enabled, ...requestInput } = input;
  return queryOptions({
    queryKey: skillsQueryKeys.preview(
      input.url,
      input.provider,
      input.kind,
      input.scope,
      input.workspaceRoot ?? null,
      input.codexHomePath ?? null,
    ),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.skills.previewInstall(requestInput);
    },
    enabled: (enabled ?? true) && input.url.trim().length > 0,
    staleTime: 10_000,
    retry: false,
  });
}

export function skillsAdoptPreviewQueryOptions(
  input: SkillsPreviewAdoptInput & { enabled?: boolean },
) {
  const { enabled, ...requestInput } = input;
  return queryOptions({
    queryKey: skillsQueryKeys.adoptPreview(
      input.installPath,
      input.workspaceRoot ?? null,
      input.codexHomePath ?? null,
    ),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.skills.previewAdopt(requestInput);
    },
    enabled: enabled ?? true,
    staleTime: 10_000,
    retry: false,
  });
}

export function skillsInstallMutationOptions() {
  return mutationOptions({
    mutationFn: async (input: SkillsInstallInput) => {
      const api = ensureNativeApi();
      return api.skills.install(input);
    },
  });
}

export function skillsRemoveMutationOptions() {
  return mutationOptions({
    mutationFn: async (input: SkillsRemoveInput) => {
      const api = ensureNativeApi();
      return api.skills.remove(input);
    },
  });
}

export function skillsRefreshMutationOptions() {
  return mutationOptions({
    mutationFn: async (input: SkillsRefreshInput) => {
      const api = ensureNativeApi();
      return api.skills.refresh(input);
    },
  });
}

export function skillsCheckUpdatesMutationOptions() {
  return mutationOptions({
    mutationFn: async (input: SkillsCheckUpdatesInput) => {
      const api = ensureNativeApi();
      return api.skills.checkUpdates(input);
    },
  });
}

export function skillsUpgradeMutationOptions() {
  return mutationOptions({
    mutationFn: async (input: SkillsUpgradeInput) => {
      const api = ensureNativeApi();
      return api.skills.upgrade(input);
    },
  });
}

export function skillsReinstallMutationOptions() {
  return mutationOptions({
    mutationFn: async (input: SkillsReinstallInput) => {
      const api = ensureNativeApi();
      return api.skills.reinstall(input);
    },
  });
}

export function skillsAdoptMutationOptions() {
  return mutationOptions({
    mutationFn: async (input: SkillsAdoptInput) => {
      const api = ensureNativeApi();
      return api.skills.adopt(input);
    },
  });
}

export function skillsSetEnabledMutationOptions() {
  return mutationOptions({
    mutationFn: async (input: SkillsSetEnabledInput) => {
      const api = ensureNativeApi();
      return api.skills.setEnabled(input);
    },
  });
}

export function skillsRepairManagedLinksMutationOptions() {
  return mutationOptions({
    mutationFn: async (input: SkillsRepairManagedLinksInput) => {
      const api = ensureNativeApi();
      return api.skills.repairManagedLinks(input);
    },
  });
}

export function skillsStopManagingMutationOptions() {
  return mutationOptions({
    mutationFn: async (input: SkillsStopManagingInput) => {
      const api = ensureNativeApi();
      return api.skills.stopManaging(input);
    },
  });
}
