import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scripts = [
  ["import", new URL("../../../scripts/import-shopify-orders.ts", import.meta.url)],
  ["diagnostic", new URL("../../../scripts/diagnose-shopify-orders.ts", import.meta.url)],
];

for (const [label, scriptUrl] of scripts) {
  test(`${label} script loads through Node strip-only TypeScript`, () => {
    const result = spawnSync(process.execPath, [
      "--experimental-strip-types",
      fileURLToPath(scriptUrl),
      "--runtime-smoke",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: process.env,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).runtimeLoaded, true);
  });
}
