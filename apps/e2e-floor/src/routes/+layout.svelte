<script lang="ts">
  import Layout from "../../../e2e-app/src/routes/+layout.svelte";
  let { children } = $props();
</script>

<Layout>{@render children()}</Layout>
