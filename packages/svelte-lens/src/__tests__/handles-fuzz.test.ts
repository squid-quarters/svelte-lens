import { it, expect, vi } from "vitest";
import type { Plugin, SvelteLensAPI } from "../types.js";
import { HOST_ATTRIBUTE } from "../constants.js";

// Seeded random sequences of handle operations on one plugin name. After
// every step, the registered plugin must be one a live handle holds, or the
// built-in when no handle holds one, and setup() must not rerun when the
// registered plugin didn't change.
it("handle registrations stay consistent under random sequences", async () => {
  let seed = 12345;
  const random = (n: number): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };

  for (let round = 0; round < 200; round++) {
    vi.resetModules();
    for (const el of document.querySelectorAll(`[${HOST_ATTRIBUTE}]`)) el.remove();
    const { init } = await import("../core/index.svelte.js");
    const { copyPlugin } = await import("../core/plugins/copy.js");

    let setups = 0;
    let current: Plugin | undefined;
    const tracked = (tag: string): Plugin => {
      const plugin: Plugin = {
        name: "copy",
        setup: () => {
          setups += 1;
          current = plugin;
          return { cleanup: () => void (current === plugin && (current = undefined)) };
        },
      };
      Object.defineProperty(plugin, "toString", { value: () => tag });
      return plugin;
    };
    const pool: Plugin[] = [copyPlugin, tracked("A"), tracked("B"), tracked("C")];
    const owner = init();
    const handles: Array<{ api: SvelteLensAPI; holds: Plugin | null; alive: boolean }> = [];
    const trace: string[] = [];

    for (let step = 0; step < 30; step++) {
      const live = handles.filter((h) => h.alive);
      const before = current ?? copyPlugin;
      const setupsBefore = setups;
      const op = random(5);
      if (op === 0 || live.length === 0) {
        handles.push({ api: init(), holds: null, alive: true });
        trace.push(`new h${handles.length - 1}`);
      } else {
        const h = live[random(live.length)]!;
        const i = handles.indexOf(h);
        if (op <= 2) {
          const plugin = pool[random(pool.length)]!;
          h.api.registerPlugin(plugin);
          h.holds = plugin;
          trace.push(`h${i}.register(${plugin === copyPlugin ? "built-in" : String(plugin)})`);
        } else if (op === 3 && h.holds) {
          h.api.unregisterPlugin("copy");
          h.holds = null;
          trace.push(`h${i}.unregister`);
        } else if (op === 4) {
          h.api.dispose();
          h.alive = false;
          trace.push(`h${i}.dispose`);
        }
      }

      const registered = owner.getPlugins().includes("copy");
      const effective = registered ? (current ?? copyPlugin) : undefined;
      const held = handles.filter((h) => h.alive && h.holds).map((h) => h.holds);
      const context = `round ${round}: ${trace.join(", ")}`;
      if (held.length === 0) expect(effective, context).toBe(copyPlugin);
      else expect(held, context).toContain(effective);
      if (effective === before) expect(setups, `setup reran: ${context}`).toBe(setupsBefore);
      if (effective === copyPlugin) current = undefined;
    }

    for (const h of handles) if (h.alive) h.api.dispose();
    owner.dispose();
  }
}, 60_000);
