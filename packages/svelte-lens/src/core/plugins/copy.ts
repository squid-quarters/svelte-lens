import type { Plugin } from "../../types.js";
import { isMac } from "../../utils/is-mac.js";

export const copyPlugin: Plugin = {
  name: "copy",
  // The action is built in setup so it can reach the real API's copyElement.
  setup: (api) => ({
    actions: [
      {
        id: "copy",
        label: "Copy",
        shortcut: isMac() ? "Cmd+C" : "Ctrl+C",
        onAction: async (context) => {
          context.hideContextMenu();
          await api.copyElement(context.element);
        },
      },
    ],
  }),
};
