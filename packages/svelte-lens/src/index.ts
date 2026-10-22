import type { Plugin, SvelteLensAPI } from "./types.js";
import { init as coreInit } from "./core/index.svelte.js";

const flushPendingPlugins = (api: SvelteLensAPI): void => {
  while (pendingPlugins.length > 0) {
    const plugin = pendingPlugins.shift();
    if (plugin) api.registerPlugin(plugin);
  }
};

// `process.env.NODE_ENV` is left as a literal in the published build so the
// consumer's bundler (Vite/Rollup/webpack) statically replaces it; without a
// bundler the reference throws and we treat the build as non-production.
const isProductionBuild = (): boolean => {
  try {
    return process.env.NODE_ENV === "production";
  } catch {
    return false;
  }
};

const init = (options?: import("./types.js").Options): SvelteLensAPI => {
  if (typeof window !== "undefined" && window.__SVELTE_LENS_DISABLED__) {
    options = { ...options, enabled: false };
  } else if (
    typeof window !== "undefined" &&
    isProductionBuild() &&
    window.__SVELTE_LENS_FORCE_ENABLE__ !== true
  ) {
    console.warn(
      "[svelte-lens] init() skipped: production build detected. " +
        "svelte-lens is a development tool and should not run for end users. " +
        "Set window.__SVELTE_LENS_FORCE_ENABLE__ = true before calling init() to override.",
    );
    options = { ...options, enabled: false };
  }
  const api = coreInit(options);
  // A repeat init() returns the running instance, already set up below.
  if (api === globalApi) return api;
  if (api.isEnabled()) {
    setGlobalApi(api);
    flushPendingPlugins(api);
    // Dispatch event for plugin integrations — only on explicit init.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("svelte-lens:init", { detail: api }));
    }
    // Wrap dispose so the module-level globalApi is also cleared, unless a
    // newer instance has replaced it (a stale handle disposed again).
    const origDispose = api.dispose.bind(api);
    api.dispose = () => {
      origDispose();
      if (globalApi === api) setGlobalApi(null);
    };
  }
  return api;
};

export { init };
export {
  getSource,
  getStack,
  getStackContext,
  getElementContext,
  isLensHost,
} from "./core/index.svelte.js";

export { copyPlugin } from "./core/plugins/copy.js";
export { openPlugin } from "./core/plugins/open.js";

export type {
  Options,
  SettableOptions,
  ActivationKey,
  ActivationMode,
  Plugin,
  PluginConfig,
  PluginHooks,
  ContextMenuAction,
  ActionContext,
  Theme,
  SourceInfo,
  ElementContext,
  SvelteLensAPI,
  SvelteLensState,
  Position,
  Bounds,
} from "./types.js";

declare global {
  interface Window {
    __SVELTE_LENS__?: SvelteLensAPI;
    __SVELTE_LENS_DISABLED__?: boolean;
    __SVELTE_LENS_FORCE_ENABLE__?: boolean;
  }
}

let globalApi: SvelteLensAPI | null = null;
const pendingPlugins: Plugin[] = [];

export const getGlobalApi = (): SvelteLensAPI | null => {
  if (typeof window === "undefined") return globalApi;
  return window.__SVELTE_LENS__ ?? globalApi ?? null;
};

const setGlobalApi = (api: SvelteLensAPI | null): void => {
  globalApi = api;
  if (typeof window !== "undefined") {
    if (api) {
      Object.defineProperty(window, "__SVELTE_LENS__", {
        value: api,
        configurable: true, // allows dispose() to delete
        enumerable: false,
        writable: false, // prevents overwrite by other scripts
      });
    } else {
      delete window.__SVELTE_LENS__;
    }
  }
};

export const registerPlugin = (plugin: Plugin): void => {
  const api = getGlobalApi();
  if (api) {
    api.registerPlugin(plugin);
    return;
  }
  pendingPlugins.push(plugin);
};

export const unregisterPlugin = (name: string): void => {
  const api = getGlobalApi();
  if (api) {
    api.unregisterPlugin(name);
    return;
  }
  const pendingIndex = pendingPlugins.findIndex((plugin) => plugin.name === name);
  if (pendingIndex !== -1) pendingPlugins.splice(pendingIndex, 1);
};
