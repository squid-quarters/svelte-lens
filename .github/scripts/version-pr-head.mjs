import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function verifyVersionHead(pr, commit, { repository, branch, baseSha, tree }) {
  assert.equal(pr.state, "open");
  assert.equal(pr.head.repo.full_name, repository, "Version head repository changed");
  assert.equal(pr.base.repo.full_name, repository, "Version base repository changed");
  assert.equal(pr.head.ref, `changeset-release/${branch}`, "Unexpected Version branch");
  assert.equal(pr.base.ref, branch, "Unexpected Version base branch");
  assert.match(pr.head.sha, /^[a-f0-9]{40}$/);
  assert.equal(commit.sha, pr.head.sha, "Commit is not the current Version head");
  assert.deepEqual(
    commit.parents.map(({ sha }) => sha),
    [baseSha],
    "Version base moved",
  );
  assert.equal(commit.tree.sha, tree, "Version content differs from this run's generated tree");
  return pr.head.sha;
}

export async function captureVersionHead({
  env = process.env,
  request = fetch,
  git = execFileSync,
} = {}) {
  assert.equal(env.GITHUB_ACTIONS, "true", "Run only in the Version workflow");
  assert.match(env.VERSION_PR_NUMBER ?? "", /^[1-9]\d*$/);
  assert.match(env.GITHUB_REPOSITORY ?? "", /^[\w.-]+\/[\w.-]+$/);
  assert.match(env.GITHUB_SHA ?? "", /^[a-f0-9]{40}$/);
  assert.ok(env.GITHUB_REF_NAME && env.GITHUB_TOKEN && env.GITHUB_OUTPUT);
  // Only the disposable CI checkout's index is staged, never a developer tree.
  git("git", ["add", "--all"], { stdio: "pipe" });
  const tree = git("git", ["write-tree"], { encoding: "utf8" }).trim();
  const read = async (path) => {
    const response = await request(
      `https://api.github.com/repos/${env.GITHUB_REPOSITORY}/${path}`,
      {
        headers: {
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
    assert.ok(response.ok, `Version metadata request failed: ${response.status}`);
    return response.json();
  };
  const pr = await read(`pulls/${env.VERSION_PR_NUMBER}`);
  assert.match(pr.head.sha, /^[a-f0-9]{40}$/);
  const commit = await read(`git/commits/${pr.head.sha}`);
  const sha = verifyVersionHead(pr, commit, {
    repository: env.GITHUB_REPOSITORY,
    branch: env.GITHUB_REF_NAME,
    baseSha: env.GITHUB_SHA,
    tree,
  });
  appendFileSync(env.GITHUB_OUTPUT, `sha=${sha}\n`);
  console.log(`Verified Version PR ${env.VERSION_PR_NUMBER} head ${sha}, tree ${tree}`);
  return sha;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  captureVersionHead().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
