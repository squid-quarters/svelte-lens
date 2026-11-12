<script lang="ts">
  import Counter from "#lib/Counter.svelte";
  import Card from "#lib/Card.svelte";

  const cards = [
    { title: "Hover", description: "Move your cursor over an element to highlight it." },
    { title: "Press Cmd+Alt+G", description: "Toggle svelte-lens activation." },
    {
      title: "Cmd+C",
      description: "Copy the hovered element's source context to clipboard.",
    },
  ];
</script>

<main>
  <header>
    <h1>svelte-lens playground</h1>
    <p>Try hovering an element and pressing <kbd>Cmd</kbd>+<kbd>Alt</kbd>+<kbd>G</kbd>.</p>
  </header>

  <section class="counter-area">
    <Counter />
  </section>

  <section class="grid">
    {#each cards as card (card.title)}
      <Card title={card.title} description={card.description} />
    {/each}
  </section>
</main>

<style>
  main {
    max-width: 800px;
    margin: 0 auto;
    padding: 60px 24px;
    display: flex;
    flex-direction: column;
    gap: 32px;
  }
  header h1 {
    margin: 0 0 6px;
    font-size: 28px;
    letter-spacing: -0.02em;
  }
  header p {
    margin: 0;
    font-size: 14px;
    color: #666;
  }
  .counter-area {
    display: flex;
    justify-content: flex-start;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 16px;
  }
  kbd {
    background: #f0f0f0;
    border: 1px solid #ddd;
    border-radius: 4px;
    padding: 1px 5px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
  }
</style>
