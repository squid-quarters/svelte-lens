<script lang="ts">
  import { VIEWPORT_MARGIN_PX } from "../constants.js";
  import type { ActionContext, ContextMenuAction, Position } from "../types.js";
  import { getViewportSize } from "../utils/get-viewport-size.js";
  import { isActionEnabled } from "../utils/is-action-enabled.js";

  interface Props {
    position: Position | null;
    actions: ContextMenuAction[];
    actionContext: ActionContext | null;
    onDismiss: () => void;
  }

  let { position, actions, actionContext, onDismiss }: Props = $props();

  let menuEl: HTMLDivElement | undefined = $state();
  let menuSize = $state({ width: 0, height: 0 });

  // Re-measure whenever the menu opens, moves or its action list changes.
  $effect(() => {
    void position;
    void actions.length;
    if (!menuEl) return;
    const { width, height } = menuEl.getBoundingClientRect();
    menuSize = { width, height };
  });

  // Keep the menu inside the viewport; the strict-contained host clips overflow.
  const menuStyle = $derived.by(() => {
    if (!position) return "";
    const viewport = getViewportSize();
    const maxX = viewport.width - menuSize.width - VIEWPORT_MARGIN_PX;
    const maxY = viewport.height - menuSize.height - VIEWPORT_MARGIN_PX;
    const x = Math.max(VIEWPORT_MARGIN_PX, Math.min(position.x, maxX));
    const y = Math.max(VIEWPORT_MARGIN_PX, Math.min(position.y, maxY));
    return `position:fixed;top:${y}px;left:${x}px`;
  });

  const runAction = async (action: ContextMenuAction): Promise<void> => {
    if (!actionContext) return;
    // The element was removed (e.g. client-side navigation): nothing to act on.
    if (!actionContext.element.isConnected) {
      onDismiss();
      return;
    }
    await action.onAction(actionContext);
  };
</script>

{#if position && actionContext}
  <div bind:this={menuEl} class="lens-menu" style={menuStyle} role="menu">
    {#each actions as action (action.id)}
      {@const enabled = isActionEnabled(action, actionContext)}
      <button
        class="lens-menu-item"
        disabled={!enabled}
        onclick={() => runAction(action)}
        role="menuitem"
      >
        <span>{action.label}</span>
        {#if action.shortcut}
          <kbd>{action.shortcut}</kbd>
        {/if}
      </button>
    {/each}
  </div>

  <div
    class="lens-menu-backdrop"
    role="presentation"
    onclick={onDismiss}
    onkeydown={(e) => e.key === "Escape" && onDismiss()}
  ></div>
{/if}

<style>
  .lens-menu {
    z-index: 2147483647;
    pointer-events: auto;
    background: rgba(20, 20, 20, 0.95);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    padding: 4px;
    min-width: 160px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    font-family:
      ui-sans-serif,
      system-ui,
      -apple-system,
      sans-serif;
    font-size: 12px;
    color: white;
  }
  .lens-menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 2147483646;
    pointer-events: auto;
    background: transparent;
  }
  .lens-menu-item {
    display: flex;
    width: 100%;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 10px;
    border-radius: 4px;
    background: transparent;
    border: 0;
    color: white;
    font: inherit;
    cursor: pointer;
    text-align: left;
    /* Keeps min-content equal to max-content so the menu measures at its
       natural width even when first laid out at the unclamped click point. */
    white-space: nowrap;
  }
  .lens-menu-item:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.08);
  }
  .lens-menu-item:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  kbd {
    font-family: inherit;
    font-size: 10px;
    color: #999;
    background: rgba(255, 255, 255, 0.06);
    padding: 1px 5px;
    border-radius: 3px;
  }
</style>
