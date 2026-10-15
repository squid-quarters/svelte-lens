import type { ActionContext, ContextMenuAction } from "../types.js";

export const isActionEnabled = (
  action: ContextMenuAction,
  context: ActionContext | null,
): boolean => {
  if (!context) return false;
  if (action.enabled === undefined) return true;
  if (typeof action.enabled === "boolean") return action.enabled;
  return action.enabled(context);
};
