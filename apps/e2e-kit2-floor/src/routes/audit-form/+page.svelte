<script lang="ts">
  import { enhance } from "$app/forms";
  let { form }: { form?: { success?: boolean } | null } = $props();
</script>

<form method="POST" action="?/submit" use:enhance><button>Submit probe</button></form>
<form method="POST" action="?/go" use:enhance><button>Redirect normally</button></form>
{#if form?.success}<p data-testid="form-result">accepted</p>{/if}
