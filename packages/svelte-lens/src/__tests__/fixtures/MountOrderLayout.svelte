<script lang="ts">
  import { onMount } from "svelte";
  import { init } from "../../index.js";
  import MountOrderPage from "./MountOrderPage.svelte";

  let showPage = $state(true);

  // Stands in for client-side navigation away from the page.
  export const hidePage = (): void => {
    showPage = false;
  };

  // The Quick Start: the root layout initialises svelte-lens and never
  // disposes it. Svelte runs this after the page's onMount.
  onMount(() => {
    (globalThis as { __mountOrder?: string[] }).__mountOrder?.push("layout");
    init();
  });
</script>

{#if showPage}
  <MountOrderPage />
{/if}
