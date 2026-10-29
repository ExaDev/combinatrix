import { describe, expect, it } from "vitest";

import type { WorkerHandlers, WorkerPort } from "./client";
import { CancelledError, EngineClient } from "./client";
import type { Request, Response } from "./protocol";

const REQUEST: Request = { op: "count", model: "{}" };
const ANSWER: Response = { ok: true, result: { op: "count", count: 3 } };

/** A worker that records what it was sent and answers only when told to. */
class FakeWorker implements WorkerPort {
  readonly posted: Request[] = [];

  terminated = false;

  readonly handlers: WorkerHandlers;

  constructor(handlers: WorkerHandlers) {
    this.handlers = handlers;
  }

  post = (request: Request): void => {
    this.posted.push(request);
  };

  terminate = (): void => {
    this.terminated = true;
  };
}

function setup(): { readonly client: EngineClient; readonly workers: FakeWorker[] } {
  const workers: FakeWorker[] = [];
  const client = new EngineClient((handlers) => {
    const worker = new FakeWorker(handlers);
    workers.push(worker);

    return worker;
  });

  return { client, workers };
}

/** The worker the client has started most recently. */
function latest(workers: readonly FakeWorker[]): FakeWorker {
  const worker = workers.at(-1);
  if (worker === undefined) throw new Error("no worker has been started");

  return worker;
}

describe("EngineClient", () => {
  it("starts no worker until the first request, and sends it the request", () => {
    const { client, workers } = setup();
    expect(workers).toHaveLength(0);

    void client.run(REQUEST);

    expect(latest(workers).posted).toEqual([REQUEST]);
  });

  it("resolves with the worker's answer and is idle afterwards", async () => {
    const { client, workers } = setup();
    const answer = client.run(REQUEST);
    expect(client.busy).toBe(true);

    latest(workers).handlers.respond(ANSWER);

    await expect(answer).resolves.toBe(ANSWER);
    expect(client.busy).toBe(false);
  });

  it("reuses its worker for the next request", async () => {
    const { client, workers } = setup();
    const first = client.run(REQUEST);
    latest(workers).handlers.respond(ANSWER);
    await first;

    void client.run(REQUEST);

    expect(workers).toHaveLength(1);
    expect(latest(workers).posted).toHaveLength(2);
  });

  it("refuses a second request while one runs, and leaves the first running", async () => {
    const { client, workers } = setup();
    const first = client.run(REQUEST);

    await expect(client.run(REQUEST)).rejects.toThrow("already running");

    expect(client.busy).toBe(true);
    latest(workers).handlers.respond(ANSWER);
    await expect(first).resolves.toBe(ANSWER);
  });

  it("cancels by terminating the worker, and rejects the request", async () => {
    const { client, workers } = setup();
    const answer = client.run(REQUEST);

    client.cancel();

    await expect(answer).rejects.toBeInstanceOf(CancelledError);
    expect(latest(workers).terminated).toBe(true);
    expect(client.busy).toBe(false);
  });

  it("starts a fresh worker for the request after a cancel", async () => {
    const { client, workers } = setup();
    const cancelled = client.run(REQUEST);
    client.cancel();
    await expect(cancelled).rejects.toBeInstanceOf(CancelledError);

    const answer = client.run(REQUEST);
    latest(workers).handlers.respond(ANSWER);

    await expect(answer).resolves.toBe(ANSWER);
    expect(workers).toHaveLength(2);
    expect(workers[0]?.terminated).toBe(true);
    expect(workers[1]?.terminated).toBe(false);
  });

  it("ignores an answer that arrives from a worker already cancelled", async () => {
    const { client, workers } = setup();
    const cancelled = client.run(REQUEST);
    const old = latest(workers);
    client.cancel();
    await expect(cancelled).rejects.toBeInstanceOf(CancelledError);
    const next = client.run({ op: "count", model: "[]" });

    old.handlers.respond(ANSWER);
    old.handlers.fail("late failure");

    expect(client.busy).toBe(true);
    const fresh: Response = { ok: true, result: { op: "count", count: 9 } };
    latest(workers).handlers.respond(fresh);
    await expect(next).resolves.toBe(fresh);
  });

  it("does nothing when cancelled while idle", () => {
    const { client, workers } = setup();

    client.cancel();

    expect(workers).toHaveLength(0);
  });

  it("rejects when the worker dies, and starts a fresh one afterwards", async () => {
    const { client, workers } = setup();
    const answer = client.run(REQUEST);

    latest(workers).handlers.fail("out of memory");

    await expect(answer).rejects.toThrow("out of memory");
    expect(latest(workers).terminated).toBe(true);
    void client.run(REQUEST);
    expect(workers).toHaveLength(2);
  });
});
