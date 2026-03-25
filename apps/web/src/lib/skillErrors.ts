import type { SkillOperationFailureCode } from "@t3tools/contracts";

type SkillErrorLike = {
  code?: unknown;
  details?: unknown;
  message?: unknown;
};

function asSkillError(error: unknown): SkillErrorLike | null {
  if (!error || typeof error !== "object") {
    return null;
  }
  return error as SkillErrorLike;
}

export function getSkillFailureCode(error: unknown): SkillOperationFailureCode | null {
  const candidate = asSkillError(error)?.code;
  return typeof candidate === "string" ? (candidate as SkillOperationFailureCode) : null;
}

export function getSkillFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  const message = asSkillError(error)?.message;
  return typeof message === "string" && message.trim().length > 0
    ? message
    : "Skill operation failed.";
}

export function isRetryableSkillFailure(error: unknown): boolean {
  const details = asSkillError(error)?.details;
  if (details && typeof details === "object" && "retryable" in details) {
    return (details as { retryable?: unknown }).retryable === true;
  }

  const code = getSkillFailureCode(error);
  return code === "network_failed" || code === "resolution_failed";
}

export function describeSkillFailure(error: unknown): string {
  const code = getSkillFailureCode(error);
  switch (code) {
    case "unsupported_source":
      return "This source is not supported. Public launch currently supports supported skills.sh pages that resolve cleanly to GitHub-backed sources.";
    case "resolution_failed":
      return "The source could not be resolved cleanly. Verify the skills.sh page still points at a valid GitHub-backed install target.";
    case "network_failed":
      return "The remote source could not be reached. Try again once the network or remote service is available.";
    case "archive_invalid":
      return "The remote archive was rejected for safety reasons or could not be extracted safely.";
    case "skill_root_not_found":
      return "The remote repository did not contain a valid SKILL.md at the resolved skill path.";
    case "validation_failed":
      return "The remote source was rejected because it does not match the expected skill layout.";
    case "destination_exists":
      return "A managed install already exists at this destination. Confirm overwrite to continue.";
    case "permission_denied":
      return "This server currently has remote skills management disabled or does not permit this operation.";
    case "filesystem_failed":
      return "The operation failed while reading or writing local files.";
    default:
      return getSkillFailureMessage(error);
  }
}
