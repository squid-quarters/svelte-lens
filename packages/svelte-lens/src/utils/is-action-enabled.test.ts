import { describe, it, expect } from "vitest";
import { isActionEnabled } from "./is-action-enabled.js";
import type { ActionContext, ContextMenuAction } from "../types.js";

const context = { filePath: "/a.svelte" } as ActionContext;
const action = (enabled?: ContextMenuAction["enabled"]): ContextMenuAction => ({
  id: "a",
  label: "A",
  enabled,
  onAction: () => {},
});

describe("isActionEnabled", () => {
  it("is false without a context", () => {
    expect(isActionEnabled(action(), null)).toBe(false);
  });

  it("defaults to enabled and honours booleans and predicates", () => {
    expect(isActionEnabled(action(), context)).toBe(true);
    expect(isActionEnabled(action(false), context)).toBe(false);
    expect(
      isActionEnabled(
        action((ctx) => Boolean(ctx.filePath)),
        context,
      ),
    ).toBe(true);
    expect(
      isActionEnabled(
        action((ctx) => !ctx.filePath),
        context,
      ),
    ).toBe(false);
  });
});
