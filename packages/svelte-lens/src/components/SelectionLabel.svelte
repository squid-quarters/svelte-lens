<script lang="ts">
  import type { Bounds } from "../types.js";

  interface Props {
    visible: boolean;
    bounds: Bounds | null;
    tagName: string | null;
    componentName: string | null;
    status: "idle" | "copying" | "copied" | "error";
    statusText?: string;
  }

  let { visible, bounds, tagName, componentName, status, statusText }: Props = $props();

  const labelText = $derived.by(() => {
    if (status === "copying") return statusText ?? "Copying...";
    if (status === "copied") return statusText ?? "Copied";
    if (status === "error") return statusText ?? "Failed";
    return componentName ?? "";
  });

  let labelEl: HTMLDivElement | undefined = $state();
  let labelWidth = $state(0);

  // Re-measure whenever the label is shown or its content changes.
  $effect(() => {
    void visible;
    void bounds;
    void tagName;
    void labelText;
    if (!labelEl) return;
    labelWidth = labelEl.getBoundingClientRect().width;
  });

  const positionStyle = $derived(() => {
    if (!visible || !bounds) return "display:none";
    const top = Math.max(bounds.y - 28, 4);
    // Clamp on both sides; the strict-contained host clips overflow.
    const maxLeft = Math.max(window.innerWidth - labelWidth - 4, 4);
    const left = Math.min(Math.max(bounds.x, 4), maxLeft);
    return `position:fixed;top:${top}px;left:${left}px`;
  });

  const colorByStatus: Record<typeof status, string> = {
    idle: "#5050fa",
    copying: "#5050fa",
    copied: "#10b981",
    error: "#ef4444",
  };
</script>

<div bind:this={labelEl} class="lens-label" style={positionStyle()}>
  <span class="lens-label-dot" style="background:{colorByStatus[status]}"></span>
  {#if tagName}<span class="lens-label-tag">{tagName}</span>{/if}
  {#if labelText}<span class="lens-label-name">{labelText}</span>{/if}
</div>

<style>
  .lens-label {
    pointer-events: none;
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New",
      monospace;
    font-size: 11px;
    line-height: 1;
    background: rgba(20, 20, 20, 0.92);
    color: white;
    padding: 5px 8px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    gap: 6px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
    white-space: nowrap;
    max-width: calc(100vw - 8px);
    box-sizing: border-box;
    z-index: 2147483646;
  }
  .lens-label-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .lens-label-tag {
    color: #999;
  }
  .lens-label-name {
    color: white;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
</style>
