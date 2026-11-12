<script lang="ts">
  import { onMount } from "svelte";

  let { children } = $props();

  onMount(() => {
    if (import.meta.env.DEV) {
      void import("@gear-null/svelte-lens").then((m) => m.init());
    }
  });
</script>

{@render children?.()}

<style>
  :global(body) {
    margin: 0;
    font-family:
      ui-sans-serif,
      system-ui,
      -apple-system,
      "Segoe UI",
      Roboto,
      sans-serif;
    background: #fafafa;
    color: #111;
  }
</style>
