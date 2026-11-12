import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { captureVersionHead, verifyVersionHead } from "./version-pr-head.mjs";
const baseSha = "a".repeat(40),
  sha = "b".repeat(40),
  tree = "c".repeat(40);
const expected = { repository: "owner/repo", branch: "main", baseSha, tree };
const fixture = () => ({
  pr: {
    state: "open",
    head: { repo: { full_name: "owner/repo" }, ref: "changeset-release/main", sha },
    base: { repo: { full_name: "owner/repo" }, ref: "main" },
  },
  commit: { sha, parents: [{ sha: baseSha }], tree: { sha: tree } },
});
test("API-pushed Version head is bound to generated content, not stale local HEAD", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "lens-version-head-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const output = join(directory, "output");
  const { pr, commit } = fixture();
  const calls = [];
  const result = await captureVersionHead({
    env: {
      GITHUB_ACTIONS: "true",
      VERSION_PR_NUMBER: "74",
      GITHUB_REPOSITORY: "owner/repo",
      GITHUB_SHA: baseSha,
      GITHUB_REF_NAME: "main",
      GITHUB_TOKEN: "fixture-not-a-credential",
      GITHUB_OUTPUT: output,
    },
    git: (_command, args) => {
      calls.push(args);
      return args[0] === "write-tree" ? `${tree}\n` : "";
    },
    request: async (url) => ({
      ok: true,
      json: async () => (url.includes("/pulls/") ? pr : commit),
    }),
  });
  assert.equal(result, sha);
  assert.equal(readFileSync(output, "utf8"), `sha=${sha}\n`);
  assert.deepEqual(calls, [["add", "--all"], ["write-tree"]]);
});
for (const [name, change] of [
  ["foreign head", (f) => (f.pr.head.repo.full_name = "other/repo")],
  ["foreign base", (f) => (f.pr.base.repo.full_name = "other/repo")],
  ["wrong branch", (f) => (f.pr.head.ref = "unrelated")],
  ["wrong base", (f) => (f.pr.base.ref = "other")],
  ["closed PR", (f) => (f.pr.state = "closed")],
  ["stale commit", (f) => (f.commit.sha = baseSha)],
  ["moved parent", (f) => (f.commit.parents = [{ sha }])],
  ["mismatched content", (f) => (f.commit.tree.sha = baseSha)],
])
  test(`rejects ${name} before granting the App a commit`, () => {
    const f = fixture();
    change(f);
    assert.throws(() => verifyVersionHead(f.pr, f.commit, expected));
  });
test("refuses developer checkouts and missing PR output before touching git or network", async () => {
  for (const env of [{}, { GITHUB_ACTIONS: "true", VERSION_PR_NUMBER: "" }]) {
    await assert.rejects(
      captureVersionHead({
        env,
        git: () => assert.fail("git called"),
        request: () => assert.fail("network called"),
      }),
    );
  }
});
