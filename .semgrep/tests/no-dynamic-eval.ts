// Fixtures are scanned as data, never executed.
// ruleid: domaine-no-dynamic-eval
eval(userInput);
// ruleid: domaine-no-dynamic-eval
new Function("return " + userInput);
// ruleid: domaine-no-dynamic-eval
Function("x", "return x");
// ruleid: domaine-no-dynamic-eval
globalThis.eval(userInput);
// ok: domaine-no-dynamic-eval
JSON.parse(userInput);
// ok: domaine-no-dynamic-eval
const calculate = (x: number) => x + 1;
