import { it, expect, vi } from "vitest";
import type { Plugin, SvelteLensAPI } from "../types.js";
import { HOST_ATTRIBUTE } from "../constants.js";

// Invariant oracle (taken from the PR's own README/comments), checked after
// every step of random mixed operations:
//  I1 no orphans: the plugin registered under a name is held by a live handle
//     or is the current direct registration (module-level / global instance /
//     setup's api / built-in).
//  I2 a handle leaving (unregister of a held name, non-last dispose) whose
//     plugin was not the registered one changes nothing.
//  I3 a handle leaving never resurrects something a later direct
//     register/unregister replaced or removed: a plugin it brings back is the
//     current direct one, or one a live handle (re)registered after the last
//     direct op on that name.
//  I4 a handle's registerPlugin(P) leaves P registered.
//  I5 setup() doesn't rerun after a handle op that changes nothing.
const SEED = Number(process.env.SEED ?? 4242);
const ROUNDS = Number(process.env.ROUNDS ?? 400);
const STEPS = 40;

it("mixed handle / direct / module-level / setup-reentrant operations", async () => {
  let seed = SEED;
  const random = (n: number): number => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) % n;
  };
  const failures: string[] = [];

  for (let round = 0; round < ROUNDS && failures.length < 6; round++) {
    vi.resetModules();
    for (const el of document.querySelectorAll(`[${HOST_ATTRIBUTE}]`)) el.remove();
    delete window.__SVELTE_LENS__;
    const m = await import("../index.js");
    const { copyPlugin } = await import("../core/plugins/copy.js");

    let step = 0;
    let inInit = false;
    const direct: Record<string, Plugin | undefined> = {};
    const lastDirect: Record<string, number> = {};
    const noteDirect = (name: string, p: Plugin | undefined) => {
      if (inInit) return;
      direct[name] = p;
      lastDirect[name] = step;
    };

    const current = new Map<string, Plugin>();
    let setups = 0;
    const make = (
      name: string,
      tag: string,
      extra?: (api: SvelteLensAPI) => () => void,
    ): Plugin => {
      const plugin: Plugin = {
        name,
        setup: (api) => {
          setups += 1;
          current.set(name, plugin);
          const undo = extra?.(api);
          return {
            cleanup: () => {
              undo?.();
              if (current.get(name) === plugin) current.delete(name);
            },
          };
        },
      };
      Object.defineProperty(plugin, "toString", { value: () => tag });
      return plugin;
    };
    const helperS = make("helper", "hS");
    const S = make("copy", "S", (api) => {
      api.registerPlugin(helperS);
      noteDirect("helper", helperS);
      return () => {
        api.unregisterPlugin("helper");
        noteDirect("helper", undefined);
      };
    });
    const pools: Record<string, Plugin[]> = {
      copy: [copyPlugin, make("copy", "A"), make("copy", "B"), S],
      helper: [make("helper", "hA"), make("helper", "hB"), helperS],
    };
    const names = ["copy", "helper"];
    const label = (p: Plugin | undefined) =>
      p === copyPlugin ? "built-in" : p ? String(p) : "none";

    let live = false;
    let instance: SvelteLensAPI | undefined;
    const pending: Plugin[] = [];
    type Hold = { plugin: Plugin; t: number };
    type H = { api: SvelteLensAPI; alive: boolean; holds: Map<string, Hold>; gen: number };
    const handles: H[] = [];
    let gen = 0;
    const trace: string[] = [];

    const registered = (name: string): Plugin | undefined => {
      if (!instance!.getPlugins().includes(name)) return undefined;
      return current.get(name) ?? (name === "copy" ? copyPlugin : undefined);
    };

    for (step = 1; step <= STEPS; step++) {
      const liveHandles = handles.filter((h) => h.alive && h.gen === gen);
      const before = live ? names.map(registered) : [];
      const setupsBefore = setups;
      const op = random(12);
      const name = names[random(names.length)]!;
      const pool = pools[name]!;
      let kind: "leave" | "hregister" | "other" = "other";
      let actorHoldsBefore = new Map<string, Hold>();
      let registeredPlugin: Plugin | undefined;

      if (!live && op >= 2) {
        inInit = true;
        const api = m.init();
        inInit = false;
        live = true;
        gen += 1;
        instance = window.__SVELTE_LENS__;
        direct.copy = copyPlugin;
        direct.helper = undefined;
        lastDirect.copy = step;
        lastDirect.helper = step;
        for (const p of pending.splice(0)) {
          if (p.name === "copy") {
            if (direct.copy === S) direct.helper = undefined;
            direct.copy = p;
            if (p === S) direct.helper = helperS;
          } else direct.helper = p;
        }
        handles.push({ api, alive: true, holds: new Map(), gen });
        trace.push(`init#${gen}->h${handles.length - 1}`);
      } else if (op === 0) {
        const p = pool[random(pool.length)]!;
        trace.push(`m.register(${label(p)})`);
        m.registerPlugin(p);
        if (live) noteDirect(p.name, p);
        else pending.push(p);
      } else if (op === 1) {
        trace.push(`m.unregister(${name})`);
        m.unregisterPlugin(name);
        if (live) noteDirect(name, undefined);
        else {
          const i = pending.findIndex((p) => p.name === name);
          if (i !== -1) pending.splice(i, 1);
        }
      } else if (op === 2 && live) {
        handles.push({ api: m.init(), alive: true, holds: new Map(), gen });
        trace.push(`init->h${handles.length - 1}`);
      } else if (op === 3 && live && random(4) === 0) {
        trace.push(`instance.dispose`);
        instance!.dispose();
        live = false;
      } else if (op === 4 && live) {
        const p = pool[random(pool.length)]!;
        trace.push(`global.register(${label(p)})`);
        window.__SVELTE_LENS__!.registerPlugin(p);
        noteDirect(p.name, p);
      } else if (liveHandles.length > 0 && live) {
        const h = liveHandles[random(liveHandles.length)]!;
        const hi = handles.indexOf(h);
        actorHoldsBefore = new Map(h.holds);
        if (op <= 8) {
          const p = pool[random(pool.length)]!;
          trace.push(`h${hi}.register(${label(p)})`);
          h.api.registerPlugin(p);
          h.holds.set(name, { plugin: p, t: step });
          kind = "hregister";
          registeredPlugin = p;
        } else if (op <= 10) {
          trace.push(`h${hi}.unregister(${name})`);
          const held = h.holds.has(name);
          h.api.unregisterPlugin(name);
          if (held) {
            h.holds.delete(name);
            kind = "leave";
          } else noteDirect(name, undefined);
        } else {
          trace.push(`h${hi}.dispose`);
          h.api.dispose();
          h.alive = false;
          if (liveHandles.length === 1) live = false;
          else kind = "leave";
        }
      } else {
        continue;
      }

      const context = `seed ${SEED} round ${round}: ${trace.join(", ")}`;
      try {
        const check = (id: string, cond: boolean, what: string) => {
          if (!cond) throw new Error(`${id} ${what}\n  ${context}`);
        };
        if (!live) {
          check("G", window.__SVELTE_LENS__ === undefined, "global not cleared after teardown");
          for (const h of handles) if (h.gen === gen && h.alive) h.api.dispose(); // must not throw
          for (const h of handles) if (h.gen === gen) h.alive = false;
          current.clear();
          continue;
        }
        check("G", window.__SVELTE_LENS__ === instance, "global changed");
        const liveNow = handles.filter((h) => h.alive && h.gen === gen);
        names.forEach((n, i) => {
          const got = registered(n);
          const heldBy = liveNow.filter((h) => h.holds.get(n)?.plugin === got);
          check(
            "I1",
            got === undefined || got === direct[n] || heldBy.length > 0,
            `orphan: ${n} registered ${label(got)} (direct ${label(direct[n])}, no live holder)`,
          );
          if (kind !== "leave" || lastDirect[n] === step) return;
          if (actorHoldsBefore.get(n)?.plugin !== before[i]) {
            check(
              "I2",
              got === before[i],
              `${n} changed ${label(before[i])} -> ${label(got)} though the leaving handle's plugin wasn't registered`,
            );
          }
          if (got !== before[i] && got !== undefined) {
            const fresh = heldBy.some((h) => h.holds.get(n)!.t > lastDirect[n]!);
            check(
              "I3",
              got === direct[n] || fresh,
              `resurrected: ${n} ${label(before[i])} -> ${label(got)}, superseded by a direct op at step ${lastDirect[n]}`,
            );
          }
        });
        if (kind === "hregister") {
          check(
            "I4",
            registered(registeredPlugin!.name) === registeredPlugin,
            `${label(registeredPlugin)} not registered`,
          );
        }
        const unchanged = names.every((n, i) => registered(n) === before[i]);
        if (unchanged && kind !== "other")
          check("I5", setups === setupsBefore, "setup reran without a change");
      } catch (error) {
        failures.push((error as Error).message);
        break;
      }
    }
    if (window.__SVELTE_LENS__) window.__SVELTE_LENS__.dispose();
  }
  expect(failures, failures.join("\n\n")).toEqual([]);
}, 120_000);
