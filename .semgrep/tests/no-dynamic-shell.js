const child = require("node:child_process");
// ruleid: domaine-no-dynamic-shell
child.exec(process.argv[2]);
// ruleid: domaine-no-dynamic-shell
child.execSync(process.argv[2]);
// ok: domaine-no-dynamic-shell
child.exec("git status --short");
// ok: domaine-no-dynamic-shell
child.execFile("tool", [process.argv[2]]);
