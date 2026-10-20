import { exec as run, execSync, execFile } from "node:child_process";
import * as cp from "child_process";
declare const input: string;
// ruleid: domaine-no-dynamic-shell
run(`tool ${input}`);
// ruleid: domaine-no-dynamic-shell
execSync(input);
// ruleid: domaine-no-dynamic-shell
cp.exec("tool " + input);
// ruleid: domaine-no-dynamic-shell
cp.execSync(input);
// ok: domaine-no-dynamic-shell
execSync("git rev-parse --short HEAD");
// ok: domaine-no-dynamic-shell
run("git status --short");
// ok: domaine-no-dynamic-shell
execFile("tool", [input]);
// ok: domaine-no-dynamic-shell
cp.execSync("git status --short");
