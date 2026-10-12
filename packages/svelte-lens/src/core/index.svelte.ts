import { mount, unmount } from "svelte";
import Renderer from "../components/Renderer.svelte";
import type {
  ActionContext,
  Bounds,
  ContextMenuAction,
  Options,
  Plugin,
  Position,
  SettableOptions,
  SourceInfo,
  SvelteLensAPI,
  SvelteLensState,
} from "../types.js";
import {
  DRAG_THRESHOLD_PX,
  ELEMENT_DETECTION_THROTTLE_MS,
  FEEDBACK_DURATION_MS,
  HOST_ATTRIBUTE,
} from "../constants.js";
import { mountRoot } from "../utils/mount-root.js";
import { createElementBounds } from "../utils/create-element-bounds.js";
import { getElementAtPosition } from "../utils/get-element-at-position.js";
import { isMountHost } from "../utils/is-mount-host.js";
import { isKeyboardEventFromInput } from "../utils/is-keyboard-event-from-input.js";
import { copyToClipboard } from "../utils/copy-to-clipboard.js";
import { getTagName } from "../utils/get-tag-name.js";
import { formatHtmlPreview } from "../utils/format-html-preview.js";
import { parseActivationKey } from "../utils/parse-activation-key.js";
import { createLensStore } from "./store.svelte.js";
import { createPluginRegistry } from "./plugin-registry.svelte.js";
import { resolveSource, getStackContext } from "./source.js";
import { copyPlugin } from "./plugins/copy.js";
import { openPlugin } from "./plugins/open.js";

const noop = (): void => {};

const createNoopApi = (): SvelteLensAPI => ({
  activate: noop,
  deactivate: noop,
  toggle: noop,
  isActive: () => false,
  isEnabled: () => false,
  setEnabled: noop,
  copyElement: () => Promise.resolve(false),
  getSource: () => Promise.resolve(null),
  getStackContext: () => Promise.resolve(""),
  getState: () => ({
    isActive: false,
    isDragging: false,
    isCopying: false,
    targetElement: null,
  }),
  setOptions: noop,
  registerPlugin: noop,
  unregisterPlugin: noop,
  getPlugins: () => [],
  dispose: noop,
});

const isCopyKeyCombo = (event: KeyboardEvent): boolean => {
  if (event.key !== "c" && event.key !== "C") return false;
  return event.metaKey || event.ctrlKey;
};

// Prefer the physical key (code) so Caps Lock and Option-modified layouts
// still match; fall back to key for synthetic events without a code.
const isDefaultActivationCombo = (event: KeyboardEvent): boolean =>
  (event.code === "KeyG" || event.key?.toLowerCase() === "g") &&
  (event.metaKey || event.ctrlKey) &&
  event.altKey;

type ModifierKey = "Meta" | "Control" | "Alt" | "Shift";
const MODIFIER_KEYS = new Set<string>(["Meta", "Control", "Alt", "Shift"]);

interface InitGuards {
  hasBeenInited: boolean;
}

const guards: InitGuards = { hasBeenInited: false };

export const init = (rawOptions?: Options): SvelteLensAPI => {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return createNoopApi();
  }
  if (rawOptions?.enabled === false) {
    return createNoopApi();
  }
  if (guards.hasBeenInited) {
    return createNoopApi();
  }
  guards.hasBeenInited = true;

  const initialOptions: SettableOptions = {
    activationMode: rawOptions?.activationMode,
    keyHoldDuration: rawOptions?.keyHoldDuration,
    allowActivationInsideInput: rawOptions?.allowActivationInsideInput,
    activationKey: rawOptions?.activationKey,
    getContent: rawOptions?.getContent,
  };

  const store = createLensStore({
    keyHoldDuration: rawOptions?.keyHoldDuration ?? 100,
  });
  const pluginRegistry = createPluginRegistry(initialOptions);

  // Resolve the activationKey matcher from the live options so setOptions()
  // and plugin options take effect. Falls back to Cmd/Ctrl+Alt+G when no
  // activationKey is configured.
  let cachedActivationKey: SettableOptions["activationKey"] | null = null;
  let cachedActivationMatcher: ((event: KeyboardEvent) => boolean) | null = null;
  const getActivationMatcher = (): ((event: KeyboardEvent) => boolean) => {
    const activationKey = pluginRegistry.store.options.activationKey;
    if (cachedActivationMatcher && activationKey === cachedActivationKey) {
      return cachedActivationMatcher;
    }
    const isCustom =
      typeof activationKey === "function" ||
      (typeof activationKey === "string" && activationKey.trim() !== "");
    cachedActivationKey = activationKey;
    cachedActivationMatcher = isCustom
      ? parseActivationKey(activationKey)
      : isDefaultActivationCombo;
    return cachedActivationMatcher;
  };

  const { root, shadowRoot, destroy: destroyMountRoot } = mountRoot();

  const renderState = $state<{
    selectionVisible: boolean;
    selectionBounds: Bounds | null;
    selectionTagName: string | null;
    selectionComponentName: string | null;
    selectionStatus: "idle" | "copying" | "copied" | "error";
    selectionStatusText: string | undefined;
    isActive: boolean;
    enabled: boolean;
    contextMenuPosition: Position | null;
    contextMenuActions: ContextMenuAction[];
    actionContext: ActionContext | null;
  }>({
    selectionVisible: false,
    selectionBounds: null,
    selectionTagName: null,
    selectionComponentName: null,
    selectionStatus: "idle",
    selectionStatusText: undefined,
    isActive: false,
    enabled: true,
    contextMenuPosition: null,
    contextMenuActions: [],
    actionContext: null,
  });

  let lastDetectionAt = 0;
  let trailingDetectTimer: ReturnType<typeof setTimeout> | null = null;
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  // The physical key that started a hold-mode activation, if any.
  let holdKeyCode: string | null = null;
  let holdModifiers: Record<ModifierKey, boolean> | null = null;
  let copyResetTimer: ReturnType<typeof setTimeout> | null = null;
  let copyInProgress = false;

  const updateSelectionFromElement = (element: Element | null): void => {
    if (!element) {
      renderState.selectionVisible = false;
      renderState.selectionBounds = null;
      renderState.selectionTagName = null;
      renderState.selectionComponentName = null;
      return;
    }
    renderState.selectionVisible = true;
    renderState.selectionBounds = createElementBounds(element);
    renderState.selectionTagName = getTagName(element);
    void resolveSource(element).then((source) => {
      if (store.state.detectedElement === element) {
        renderState.selectionComponentName = source?.componentName ?? null;
      }
    });
  };

  const detectElement = (clientX: number, clientY: number): void => {
    const element = getElementAtPosition(clientX, clientY);
    if (element === store.state.detectedElement) return;
    store.setDetectedElement(element);
    updateSelectionFromElement(element);
  };

  const clearTrailingDetect = (): void => {
    if (trailingDetectTimer) {
      clearTimeout(trailingDetectTimer);
      trailingDetectTimer = null;
    }
  };

  const onPointerMove = (event: PointerEvent): void => {
    // Track the pointer even while inactive so activation can detect at once.
    store.setPointer({ x: event.clientX, y: event.clientY });
    if (!store.state.isActive) return;
    // Freeze hover while the context menu is open so the highlight stays on
    // the element the menu acts on.
    if (renderState.contextMenuPosition) return;
    const now = performance.now();
    const elapsed = now - lastDetectionAt;
    if (elapsed < ELEMENT_DETECTION_THROTTLE_MS) {
      // Trailing edge: make sure the final pointer position is detected.
      if (!trailingDetectTimer) {
        trailingDetectTimer = setTimeout(() => {
          trailingDetectTimer = null;
          if (!store.state.isActive || renderState.contextMenuPosition) return;
          lastDetectionAt = performance.now();
          detectElement(store.state.pointer.x, store.state.pointer.y);
        }, ELEMENT_DETECTION_THROTTLE_MS - elapsed);
      }
      return;
    }
    clearTrailingDetect();
    lastDetectionAt = now;
    detectElement(event.clientX, event.clientY);
  };

  const performCopy = async (element: Element): Promise<boolean> => {
    if (copyInProgress) return false;
    copyInProgress = true;
    const elements = [element];
    renderState.selectionStatus = "copying";
    store.startCopy();

    try {
      await pluginRegistry.hooks.onBeforeCopy(elements);
      const userContent = pluginRegistry.store.options.getContent
        ? await pluginRegistry.store.options.getContent(elements)
        : await buildDefaultContent(element);

      const finalContent = await pluginRegistry.hooks.transformCopyContent(userContent, elements);

      const success = await copyToClipboard(finalContent);
      if (!success) {
        throw new Error("Clipboard write failed");
      }

      pluginRegistry.hooks.onAfterCopy(elements, true);
      store.completeCopy(element);
      renderState.selectionStatus = "copied";
      renderState.selectionStatusText = "Copied";
      scheduleStatusReset();
      return true;
    } catch (caught) {
      const error = caught instanceof Error ? caught : new Error(String(caught));
      pluginRegistry.hooks.onCopyError(error);
      pluginRegistry.hooks.onAfterCopy(elements, false);
      store.completeCopy(element, error.message);
      renderState.selectionStatus = "error";
      renderState.selectionStatusText = error.message;
      scheduleStatusReset();
      return false;
    } finally {
      copyInProgress = false;
    }
  };

  const buildDefaultContent = async (element: Element): Promise<string> => {
    const html = formatHtmlPreview(element);
    const stack = await getStackContext(element);
    return stack ? `${html}${stack}` : html;
  };

  const scheduleStatusReset = (): void => {
    if (copyResetTimer) clearTimeout(copyResetTimer);
    copyResetTimer = setTimeout(() => {
      renderState.selectionStatus = "idle";
      renderState.selectionStatusText = undefined;
    }, FEEDBACK_DURATION_MS);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!renderState.enabled) return;
    if (
      !pluginRegistry.store.options.allowActivationInsideInput &&
      isKeyboardEventFromInput(event)
    ) {
      return;
    }

    // Never take over native copy inside text fields.
    if (isCopyKeyCombo(event) && store.state.isActive && !isKeyboardEventFromInput(event)) {
      // While the context menu is open, copy the element it was opened for.
      const target = renderState.actionContext?.element ?? store.state.detectedElement;
      if (target) {
        event.preventDefault();
        event.stopPropagation();
        void selectAndCopy(target);
        return;
      }
    }

    if (event.key === "Escape" && store.state.isActive) {
      event.preventDefault();
      deactivate();
      return;
    }

    if (getActivationMatcher()(event)) {
      // preventDefault before the repeat check so held-key repeats are still
      // swallowed but don't re-toggle.
      event.preventDefault();
      if (event.repeat) return;
      if (pluginRegistry.store.options.activationMode === "hold") startHold(event);
      else toggle();
    }
  };

  const selectAndCopy = async (element: Element): Promise<void> => {
    // A plugin returning true from onElementSelect handles the selection itself.
    if (await pluginRegistry.hooks.onElementSelect(element)) return;
    await performCopy(element);
  };

  const clearHold = (): void => {
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
    holdKeyCode = null;
    holdModifiers = null;
    store.releaseHold();
  };

  // Hold mode: activate once the key has been held for keyHoldDuration;
  // releasing it (or any modifier held with it) deactivates.
  const startHold = (event: KeyboardEvent): void => {
    if (store.state.isActive || holdKeyCode !== null) return;
    holdKeyCode = event.code || event.key;
    holdModifiers = {
      Meta: event.metaKey,
      Control: event.ctrlKey,
      Alt: event.altKey,
      Shift: event.shiftKey,
    };
    store.startHold();
    holdTimer = setTimeout(() => {
      holdTimer = null;
      activate();
    }, pluginRegistry.store.options.keyHoldDuration);
  };

  const endHold = (): void => {
    if (holdKeyCode === null) return;
    clearHold();
    if (store.state.isActive) deactivate();
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    if (holdKeyCode === null) return;
    const releasedHoldKey = (event.code || event.key) === holdKeyCode;
    const releasedHoldModifier =
      MODIFIER_KEYS.has(event.key) && holdModifiers?.[event.key as ModifierKey] === true;
    if (releasedHoldKey || releasedHoldModifier) endHold();
  };

  const onContextMenuEvent = (event: MouseEvent): void => {
    if (!store.state.isActive) return;
    if (!store.state.detectedElement) return;
    event.preventDefault();
    event.stopPropagation();
    showContextMenu({ x: event.clientX, y: event.clientY }, store.state.detectedElement);
  };

  const showContextMenu = async (position: Position, element: Element): Promise<void> => {
    const source = await resolveSource(element);
    const ctx: ActionContext = {
      element,
      elements: [element],
      filePath: source?.filePath,
      lineNumber: source?.lineNumber ?? undefined,
      componentName: source?.componentName ?? undefined,
      tagName: getTagName(element),
      hideContextMenu: () => {
        renderState.contextMenuPosition = null;
        renderState.actionContext = null;
      },
      cleanup: () => deactivate(),
    };
    renderState.contextMenuPosition = position;
    renderState.actionContext = ctx;
    renderState.contextMenuActions = pluginRegistry.store.actions;
    pluginRegistry.hooks.onContextMenu(element, position);
  };

  const dismissContextMenu = (): void => {
    renderState.contextMenuPosition = null;
    renderState.actionContext = null;
  };

  const activate = (): void => {
    if (!renderState.enabled) return;
    store.activate();
    renderState.isActive = true;
    // Detect under the current pointer so a keyboard activation is usable
    // before the mouse moves.
    detectElement(store.state.pointer.x, store.state.pointer.y);
    pluginRegistry.hooks.onActivate();
  };

  const deactivate = (): void => {
    store.deactivate();
    renderState.isActive = false;
    renderState.selectionVisible = false;
    renderState.selectionBounds = null;
    renderState.selectionTagName = null;
    renderState.selectionComponentName = null;
    renderState.selectionStatus = "idle";
    renderState.selectionStatusText = undefined;
    renderState.contextMenuPosition = null;
    renderState.actionContext = null;
    if (copyResetTimer) {
      clearTimeout(copyResetTimer);
      copyResetTimer = null;
    }
    clearTrailingDetect();
    clearHold();
    pluginRegistry.hooks.onDeactivate();
  };

  const toggle = (): void => {
    if (store.state.isActive) deactivate();
    else activate();
  };

  let mounted: ReturnType<typeof mount> | null = null;

  const mountRenderer = (): void => {
    mounted = mount(Renderer, {
      target: root,
      props: {
        get selectionVisible() {
          return renderState.selectionVisible;
        },
        get selectionBounds() {
          return renderState.selectionBounds;
        },
        get selectionTagName() {
          return renderState.selectionTagName;
        },
        get selectionComponentName() {
          return renderState.selectionComponentName;
        },
        get selectionStatus() {
          return renderState.selectionStatus;
        },
        get selectionStatusText() {
          return renderState.selectionStatusText;
        },
        get toolbarVisible() {
          return pluginRegistry.store.theme.toolbar.enabled !== false;
        },
        get toolbarEnabled() {
          return renderState.enabled;
        },
        get isActive() {
          return renderState.isActive;
        },
        onToggleActive: toggle,
        get contextMenuPosition() {
          return renderState.contextMenuPosition;
        },
        get contextMenuActions() {
          return renderState.contextMenuActions;
        },
        get actionContext() {
          return renderState.actionContext;
        },
        onContextMenuDismiss: dismissContextMenu,
      },
    });
  };

  const installListeners = (): void => {
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", endHold);
    document.addEventListener("contextmenu", onContextMenuEvent, true);
    window.addEventListener("scroll", refreshSelectionBounds, true);
    window.addEventListener("resize", refreshSelectionBounds);
  };

  const uninstallListeners = (): void => {
    document.removeEventListener("pointermove", onPointerMove, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("blur", endHold);
    document.removeEventListener("contextmenu", onContextMenuEvent, true);
    window.removeEventListener("scroll", refreshSelectionBounds, true);
    window.removeEventListener("resize", refreshSelectionBounds);
  };

  const refreshSelectionBounds = (): void => {
    // Re-detect under the stationary pointer: scrolling moves content under it.
    if (store.state.isActive && !renderState.contextMenuPosition) {
      detectElement(store.state.pointer.x, store.state.pointer.y);
    }
    if (!store.state.detectedElement) return;
    if (!store.state.detectedElement.isConnected) {
      store.setDetectedElement(null);
      updateSelectionFromElement(null);
      return;
    }
    renderState.selectionBounds = createElementBounds(store.state.detectedElement);
  };

  installListeners();
  mountRenderer();

  const api: SvelteLensAPI = {
    activate,
    deactivate,
    toggle,
    isActive: () => store.state.isActive,
    isEnabled: () => renderState.enabled,
    setEnabled: (value: boolean) => {
      renderState.enabled = value;
      if (!value) deactivate();
    },
    copyElement: async (target: Element | Element[]) => {
      const elements = Array.isArray(target) ? target : [target];
      const first = elements[0];
      if (!first) return false;
      return performCopy(first);
    },
    getSource: resolveSource,
    getStackContext: getStackContext,
    getState: (): SvelteLensState => ({
      isActive: store.state.isActive,
      isDragging: false,
      isCopying: store.state.isCopying,
      targetElement: store.state.detectedElement,
    }),
    setOptions: (options: SettableOptions) => pluginRegistry.setOptions(options),
    registerPlugin: (plugin: Plugin) => pluginRegistry.register(plugin, api),
    unregisterPlugin: (name: string) => pluginRegistry.unregister(name),
    getPlugins: () => pluginRegistry.getPluginNames(),
    dispose: () => {
      if (store.state.isActive) deactivate();
      // Unregistering runs each plugin's setup() cleanup.
      for (const name of pluginRegistry.getPluginNames()) pluginRegistry.unregister(name);
      uninstallListeners();
      if (copyResetTimer) {
        clearTimeout(copyResetTimer);
        copyResetTimer = null;
      }
      clearTrailingDetect();
      clearHold();
      if (mounted) void unmount(mounted);
      mounted = null;
      destroyMountRoot();
      guards.hasBeenInited = false;
      if (typeof window !== "undefined") {
        delete window.__SVELTE_LENS__;
      }
    },
  };

  for (const builtin of [copyPlugin, openPlugin]) {
    pluginRegistry.register(builtin, api);
  }

  return api;
};

export {
  resolveSource as getSource,
  resolveStack as getStack,
  getStackContext,
  getElementContext,
} from "./source.js";

export const isLensHost = (element: Element): boolean => {
  if (typeof document === "undefined") return false;
  return Boolean(element.closest(`[${HOST_ATTRIBUTE}]`));
};
