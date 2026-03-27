import { describe, expect, it } from "vitest";

import { parseDiffRouteSearch, stripDiffSearchParams } from "./diffRouteSearch";

describe("parseDiffRouteSearch", () => {
  it("parses valid diff search values", () => {
    const parsed = parseDiffRouteSearch({
      diff: "1",
      diffTurnId: "turn-1",
      diffFilePath: "src/app.ts",
    });

    expect(parsed).toEqual({
      diff: "1",
      diffTurnId: "turn-1",
      diffFilePath: "src/app.ts",
    });
  });

  it("treats numeric and boolean diff toggles as open", () => {
    expect(
      parseDiffRouteSearch({
        diff: 1,
        diffTurnId: "turn-1",
      }),
    ).toEqual({
      diff: "1",
      diffTurnId: "turn-1",
    });

    expect(
      parseDiffRouteSearch({
        diff: true,
        diffTurnId: "turn-1",
      }),
    ).toEqual({
      diff: "1",
      diffTurnId: "turn-1",
    });
  });

  it("drops turn and file values when diff is closed", () => {
    const parsed = parseDiffRouteSearch({
      diff: "0",
      diffTurnId: "turn-1",
      diffFilePath: "src/app.ts",
    });

    expect(parsed).toEqual({});
  });

  it("drops file value when turn is not selected", () => {
    const parsed = parseDiffRouteSearch({
      diff: "1",
      diffFilePath: "src/app.ts",
    });

    expect(parsed).toEqual({
      diff: "1",
      diffFilePath: "src/app.ts",
    });
  });

  it("normalizes whitespace-only values", () => {
    const parsed = parseDiffRouteSearch({
      diff: "1",
      diffTurnId: "  ",
      diffFilePath: "  ",
    });

    expect(parsed).toEqual({
      diff: "1",
    });
  });

  it("keeps editor state without a selected turn", () => {
    expect(
      parseDiffRouteSearch({
        diff: "1",
        diffTab: "editor",
        diffFilePath: "docs/superpowers/specs/2026-03-26-diff-workspace-design.md",
        diffFileMode: "edit",
      }),
    ).toEqual({
      diff: "1",
      diffTab: "editor",
      diffFilePath: "docs/superpowers/specs/2026-03-26-diff-workspace-design.md",
      diffFileMode: "edit",
    });
  });

  it("drops invalid tab and file mode values", () => {
    expect(
      parseDiffRouteSearch({
        diff: "1",
        diffTab: "banana",
        diffFilePath: "docs/plan.md",
        diffFileMode: "sideways",
      }),
    ).toEqual({
      diff: "1",
      diffFilePath: "docs/plan.md",
    });
  });
});

describe("stripDiffSearchParams", () => {
  it("removes all diff workspace params", () => {
    expect(
      stripDiffSearchParams({
        diff: "1",
        diffTurnId: "turn-1",
        diffFilePath: "docs/plan.md",
        diffTab: "editor",
        diffFileMode: "edit",
        keep: "value",
      }),
    ).toEqual({ keep: "value" });
  });
});
