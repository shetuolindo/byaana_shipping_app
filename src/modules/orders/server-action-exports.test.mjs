import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const actionModules = [
  ["login", "../../app/login/actions.ts"],
  ["logout", "../../app/logout/actions.ts"],
  ["order transition", "../../app/orders/[id]/actions.ts"],
  ["manual order", "../../app/orders/new/actions.ts"],
  ["replacement order", "../../app/orders/[id]/replacement/actions.ts"],
];

test("use server action modules export only async functions", async () => {
  for (const [label, relativePath] of actionModules) {
    const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
    const exports = source.match(/^export\s+(?:const|let|var|class|type|interface|function|async function)\s+\w+/gm) ?? [];

    assert.ok(exports.length > 0, `${label} action module should export a Server Action`);
    assert.ok(
      exports.every((declaration) => declaration.startsWith("export async function ")),
      `${label} action module contains a non-async export: ${exports.join(", ")}`,
    );
  }
});
