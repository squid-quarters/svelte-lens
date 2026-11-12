import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import test from "node:test";
const appRequire = createRequire(resolve("apps/e2e-app/package.json"));
const pluginRequire = createRequire(appRequire.resolve("@sveltejs/vite-plugin-svelte"));
const entry = pluginRequire.resolve("deepmerge");
const root = resolve(dirname(entry), "..");
const payload = () => JSON.parse('{"__proto__":{"lensFixturePoison":true}}');
// The two distributed runtime bundles are self-contained. index.js is build
// source (its development-only predicate is bundled into these entries).
for (const path of [entry, resolve(root, "dist/umd.js")]) {
  const merge = pluginRequire(path);
  test(`deepmerge keeps output prototypes intact: ${path.split("/").slice(-2).join("/")}`, () => {
    for (const [target, source] of [
      [payload(), {}],
      [Object.create(null), payload()],
    ]) {
      const result = merge(target, source);
      assert.equal(Object.getPrototypeOf(result), Object.prototype);
      assert.equal(result.lensFixturePoison, undefined);
      assert.equal(Object.hasOwn(result, "__proto__"), true);
      assert.deepEqual(Object.getOwnPropertyDescriptor(result, "__proto__"), {
        value: { lensFixturePoison: true },
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    for (const placeholder of [null, false, 0, ""]) {
      const result = merge({ nested: placeholder }, { nested: payload() });
      assert.equal(Object.getPrototypeOf(result.nested), Object.prototype);
      assert.equal(result.nested.lensFixturePoison, undefined);
    }
    assert.equal(Object.prototype.lensFixturePoison, undefined);
    // Preserve the existing guard when the source key is inherited on a plain target.
    assert.equal(Object.hasOwn(merge({}, payload()), "__proto__"), false);
  });
  test(`deepmerge preserves configuration semantics: ${path.split("/").slice(-2).join("/")}`, () => {
    const symbol = Symbol("config");
    const date = new Date(0),
      regex = /fixture/;
    const original = { nested: { a: 1 }, list: [{ a: 1 }], date, [symbol]: 1 };
    const result = merge(original, { nested: { b: 2 }, list: [{ b: 2 }], regex, [symbol]: 2 });
    assert.deepEqual(result.nested, { a: 1, b: 2 });
    assert.deepEqual(result.list, [{ a: 1 }, { b: 2 }]);
    assert.notEqual(result.list[0], original.list[0]);
    assert.equal(result.date, date);
    assert.equal(result.regex, regex);
    assert.equal(result[symbol], 2);
    const replacement = [2];
    assert.equal(
      merge({ list: [1] }, { list: replacement }, { arrayMerge: (_a, b) => b }).list,
      replacement,
    );
    assert.equal(merge(original, {}, { clone: false }).nested, original.nested);
    assert.deepEqual(
      merge(
        { nested: 1 },
        { nested: 2 },
        { customMerge: (key) => (key === "nested" ? (a, b) => a + b : undefined) },
      ),
      { nested: 2 },
    );
    assert.deepEqual(
      merge(
        { nested: { a: 1 } },
        { nested: { b: 2 } },
        { customMerge: () => () => ({ custom: true }) },
      ),
      { nested: { custom: true } },
    );
    assert.deepEqual(
      merge(
        { constructor: { a: 1 }, prototype: { a: 1 } },
        { constructor: { b: 2 }, prototype: { b: 2 } },
      ),
      { constructor: { a: 1, b: 2 }, prototype: { a: 1, b: 2 } },
    );
    assert.equal(merge([], [payload()])[0].lensFixturePoison, undefined);
  });
}
