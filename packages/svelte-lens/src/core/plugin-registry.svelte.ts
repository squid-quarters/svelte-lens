import type {
  ContextMenuAction,
  Plugin,
  PluginConfig,
  PluginHooks,
  Position,
  SettableOptions,
  SvelteLensAPI,
  Theme,
} from "../types.js";
import { DEFAULT_KEY_HOLD_DURATION_MS } from "../constants.js";

interface RegisteredPlugin {
  plugin: Plugin;
  config: PluginConfig;
}

export interface ResolvedOptions {
  activationMode: "toggle" | "hold";
  keyHoldDuration: number;
  allowActivationInsideInput: boolean;
  activationKey: string | ((event: KeyboardEvent) => boolean) | undefined;
  getContent: ((elements: Element[]) => Promise<string> | string) | undefined;
}

const DEFAULT_OPTIONS: ResolvedOptions = {
  activationMode: "toggle",
  keyHoldDuration: DEFAULT_KEY_HOLD_DURATION_MS,
  allowActivationInsideInput: true,
  activationKey: undefined,
  getContent: undefined,
};

const DEFAULT_THEME: Required<Theme> = {
  enabled: true,
  hue: 240,
  selectionBox: { enabled: true },
  toolbar: { enabled: true },
  elementLabel: { enabled: true },
};

interface PluginStoreState {
  theme: Required<Theme>;
  options: ResolvedOptions;
  actions: ContextMenuAction[];
}

const mergeTheme = (
  base: Required<Theme>,
  override: Partial<Theme> | undefined,
): Required<Theme> => {
  if (!override) return base;
  return {
    enabled: override.enabled ?? base.enabled,
    hue: override.hue ?? base.hue,
    selectionBox: { ...base.selectionBox, ...override.selectionBox },
    toolbar: { ...base.toolbar, ...override.toolbar },
    elementLabel: { ...base.elementLabel, ...override.elementLabel },
  };
};

// Drop keys whose value is undefined so unset options don't mask the defaults
// when spread over them.
const definedOnly = <T extends object>(options: T | undefined): Partial<T> =>
  Object.fromEntries(
    Object.entries(options ?? {}).filter(([, value]) => value !== undefined),
  ) as Partial<T>;

const reportHookError = (pluginName: string, hookName: string, error: unknown): void => {
  console.error(`[svelte-lens] plugin "${pluginName}" hook "${hookName}" threw`, error);
};

export const createPluginRegistry = (initialOptions: SettableOptions = {}) => {
  const plugins = new Map<string, RegisteredPlugin>();
  const directOptionOverrides: Partial<ResolvedOptions> = {};

  const store = $state<PluginStoreState>({
    theme: DEFAULT_THEME,
    options: { ...DEFAULT_OPTIONS, ...definedOnly(initialOptions) },
    actions: [],
  });

  const recompute = (): void => {
    let mergedTheme: Required<Theme> = DEFAULT_THEME;
    let mergedOptions: ResolvedOptions = { ...DEFAULT_OPTIONS, ...definedOnly(initialOptions) };
    const mergedActions: ContextMenuAction[] = [];

    for (const { config } of plugins.values()) {
      if (config.theme) mergedTheme = mergeTheme(mergedTheme, config.theme);
      if (config.options) mergedOptions = { ...mergedOptions, ...definedOnly(config.options) };
      if (config.actions) mergedActions.push(...config.actions);
    }

    Object.assign(mergedOptions, directOptionOverrides);

    store.theme = mergedTheme;
    store.options = mergedOptions;
    store.actions = mergedActions;
  };

  const setOptions = (updates: SettableOptions): void => {
    for (const [optionKey, optionValue] of Object.entries(updates)) {
      // Guard against prototype pollution (CWE-1321).
      if (optionKey === "__proto__" || optionKey === "constructor" || optionKey === "prototype") {
        continue;
      }
      if (optionValue !== undefined) {
        (directOptionOverrides as Record<string, unknown>)[optionKey] = optionValue;
      }
    }
    recompute();
  };

  const register = (plugin: Plugin, api: SvelteLensAPI): void => {
    if (plugins.has(plugin.name)) {
      unregister(plugin.name);
    }

    const config: PluginConfig = plugin.setup?.(api) ?? {};

    if (plugin.theme) config.theme = { ...plugin.theme, ...config.theme };
    if (plugin.options) config.options = { ...plugin.options, ...config.options };
    if (plugin.hooks) config.hooks = { ...plugin.hooks, ...config.hooks };
    if (plugin.actions) config.actions = [...plugin.actions, ...(config.actions ?? [])];

    plugins.set(plugin.name, { plugin, config });
    recompute();
  };

  const unregister = (name: string): void => {
    const registered = plugins.get(name);
    if (!registered) return;
    // Isolated so a throwing cleanup still unregisters the plugin and cannot
    // abort the caller's teardown (e.g. dispose()).
    try {
      registered.config.cleanup?.();
    } catch (error) {
      reportHookError(name, "cleanup", error);
    }
    plugins.delete(name);
    recompute();
  };

  const getPluginNames = (): string[] => Array.from(plugins.keys());

  // Each plugin is isolated so one throwing hook cannot break the others or
  // the caller's state transition.
  const callHook = <K extends keyof PluginHooks>(
    hookName: K,
    ...args: Parameters<NonNullable<PluginHooks[K]>>
  ): void => {
    for (const [name, { config }] of plugins) {
      const hook = config.hooks?.[hookName] as
        ((...hookArgs: Parameters<NonNullable<PluginHooks[K]>>) => void) | undefined;
      if (!hook) continue;
      try {
        hook(...args);
      } catch (error) {
        reportHookError(name, hookName, error);
      }
    }
  };

  const callHookWithIntercept = async <K extends keyof PluginHooks>(
    hookName: K,
    ...args: Parameters<NonNullable<PluginHooks[K]>>
  ): Promise<boolean> => {
    let intercepted = false;
    for (const [name, { config }] of plugins) {
      const hook = config.hooks?.[hookName] as
        | ((
            ...hookArgs: Parameters<NonNullable<PluginHooks[K]>>
          ) => boolean | void | Promise<boolean>)
        | undefined;
      if (!hook) continue;
      try {
        if ((await hook(...args)) === true) intercepted = true;
      } catch (error) {
        reportHookError(name, hookName, error);
      }
    }
    return intercepted;
  };

  const callHookAsync = async <K extends keyof PluginHooks>(
    hookName: K,
    ...args: Parameters<NonNullable<PluginHooks[K]>>
  ): Promise<void> => {
    for (const { config } of plugins.values()) {
      const hook = config.hooks?.[hookName];
      if (hook) {
        await (hook as (...hookArgs: typeof args) => unknown)(...args);
      }
    }
  };

  const reduceTransform = async (initial: string, elements: Element[]): Promise<string> => {
    let result = initial;
    for (const { config } of plugins.values()) {
      const hook = config.hooks?.transformCopyContent;
      if (hook) {
        result = await hook(result, elements);
      }
    }
    return result;
  };

  const hooks = {
    onActivate: () => callHook("onActivate"),
    onDeactivate: () => callHook("onDeactivate"),
    onElementSelect: (element: Element) => callHookWithIntercept("onElementSelect", element),
    onBeforeCopy: (elements: Element[]) => callHookAsync("onBeforeCopy", elements),
    transformCopyContent: (content: string, elements: Element[]) =>
      reduceTransform(content, elements),
    onAfterCopy: (elements: Element[], success: boolean) =>
      callHook("onAfterCopy", elements, success),
    onCopyError: (error: Error) => callHook("onCopyError", error),
    onContextMenu: (element: Element, position: Position) =>
      callHook("onContextMenu", element, position),
  };

  return {
    store,
    register,
    unregister,
    getPluginNames,
    setOptions,
    hooks,
  };
};

export type PluginRegistryInstance = ReturnType<typeof createPluginRegistry>;
