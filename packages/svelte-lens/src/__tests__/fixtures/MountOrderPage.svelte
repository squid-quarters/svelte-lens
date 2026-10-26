<script lang="ts">
  import { onMount } from "svelte";
  import { init } from "../../index.js";

  // A page that uses svelte-lens and cleans up after itself on unmount.
  onMount(() => {
    const api = init();
    api.registerPlugin({ name: "page-plugin" });
    return () => api.dispose();
  });
</script>

<p>page</p>
