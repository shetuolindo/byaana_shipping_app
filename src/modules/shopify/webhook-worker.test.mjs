import assert from "node:assert/strict";
import test from "node:test";
import {
  runShopifyWebhookWorker,
  runShopifyWebhookWorkerUntilShutdown,
  SHOPIFY_WEBHOOK_IDLE_POLL_MS,
} from "./webhook-worker.ts";

test("drains available webhook work immediately before waiting when idle", async () => {
  const shutdown = new AbortController();
  const outcomes = [
    { outcome: "processed", eventId: "event-1" },
    { outcome: "processed", eventId: "event-2" },
    { outcome: "idle" },
  ];
  const waits = [];
  let calls = 0;

  await runShopifyWebhookWorker({
    signal: shutdown.signal,
    async processNext() {
      const result = outcomes[calls];
      calls += 1;
      return result;
    },
    async waitForIdle(milliseconds) {
      waits.push(milliseconds);
      shutdown.abort();
    },
  });

  assert.equal(calls, 3);
  assert.deepEqual(waits, [SHOPIFY_WEBHOOK_IDLE_POLL_MS]);
});

test("waits once after an idle result instead of busy-looping", async () => {
  const shutdown = new AbortController();
  let calls = 0;
  let waits = 0;

  await runShopifyWebhookWorker({
    signal: shutdown.signal,
    async processNext() {
      calls += 1;
      return { outcome: "idle" };
    },
    async waitForIdle(milliseconds, signal) {
      waits += 1;
      assert.equal(milliseconds, 5_000);
      assert.equal(signal, shutdown.signal);
      shutdown.abort();
    },
  });

  assert.equal(calls, 1);
  assert.equal(waits, 1);
});

test("graceful shutdown finishes in-flight work and starts no new claim", async () => {
  const shutdown = new AbortController();
  let finishCurrent;
  const current = new Promise((resolve) => { finishCurrent = resolve; });
  let calls = 0;

  const worker = runShopifyWebhookWorker({
    signal: shutdown.signal,
    async processNext() {
      calls += 1;
      await current;
      return { outcome: "processed", eventId: "event-1" };
    },
  });

  await Promise.resolve();
  shutdown.abort();
  assert.equal(calls, 1);
  finishCurrent();
  await worker;
  assert.equal(calls, 1);
});

test("disconnects Prisma after worker shutdown", async () => {
  const calls = [];

  await runShopifyWebhookWorkerUntilShutdown({
    async run() { calls.push("run"); },
    async disconnect() { calls.push("disconnect"); },
  });

  assert.deepEqual(calls, ["run", "disconnect"]);
});

test("disconnects Prisma when the worker exits unexpectedly", async () => {
  const calls = [];

  await assert.rejects(
    runShopifyWebhookWorkerUntilShutdown({
      async run() {
        calls.push("run");
        throw new Error("synthetic worker failure");
      },
      async disconnect() { calls.push("disconnect"); },
    }),
    /synthetic worker failure/,
  );

  assert.deepEqual(calls, ["run", "disconnect"]);
});
