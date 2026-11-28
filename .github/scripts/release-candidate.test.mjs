import assert from "node:assert/strict";
import test from "node:test";
import { assertIntegrity, digest, verifyRecovery } from "./release-candidate.mjs";

test("verification rejects changed or malformed release artifact evidence", () => {
  const original = Buffer.from("candidate bytes");
  const integrity = digest(original);
  assert.doesNotThrow(() => assertIntegrity(original, integrity));
  assert.throws(() => assertIntegrity(Buffer.from("different bytes"), integrity), /differs/);
  assert.throws(() => assertIntegrity(original, "sha512-invalid"));
});

for (const failAt of [null, "install", "inspect"]) {
  test(`restores the verified baseline after candidate ${failAt ?? "success"}`, async () => {
    const operations = [];
    const run = (stage, version) => {
      operations.push(`${stage}:${version}`);
      if (version === "candidate" && stage === failAt) throw new Error("candidate failed");
    };
    const verify = verifyRecovery({
      install: (version) => run("install", version),
      inspect: (version) => run("inspect", version),
      assertData: () => operations.push("consumer data"),
    });
    if (failAt) await assert.rejects(verify, /candidate failed/);
    else await verify;
    assert.deepEqual(operations.slice(-3), [
      "install:previous",
      "inspect:previous",
      "consumer data",
    ]);
  });
}
