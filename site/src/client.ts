import type { Request, Response } from "./protocol";

/** What the page needs of a running worker: send it a request and stop it. */
export interface WorkerPort {
  readonly post: (request: Request) => void;
  readonly terminate: () => void;
}

/** What a worker reports back: its answer, or that it died without one. */
export interface WorkerHandlers {
  readonly respond: (response: Response) => void;
  /** The worker raised an error that `execute` does not turn into a `Response`, such as running out of memory. */
  readonly fail: (message: string) => void;
}

/** Starts a worker that reports to the given handlers. */
export type SpawnWorker = (handlers: WorkerHandlers) => WorkerPort;

/** Rejects the promise of an operation that `cancel` stopped. */
export class CancelledError extends Error {
  constructor() {
    super("the operation was cancelled");
    this.name = "CancelledError";
  }
}

/**
 * Runs one request at a time on a worker and can stop it. The engine is synchronous library code, which a message cannot interrupt while it runs, and a page without cross-origin isolation has no shared memory to flag cancellation through, so `cancel` terminates the worker and the next request starts a fresh one. The worker is stateless, so nothing is lost.
 */
export class EngineClient {
  readonly #spawn: SpawnWorker;

  #port: WorkerPort | undefined;

  /** Counts the workers started, so a message from one that was terminated is recognised and ignored: the page may still have it queued when `cancel` runs. */
  #generation = 0;

  #pending: { readonly resolve: (response: Response) => void; readonly reject: (error: Error) => void } | undefined;

  constructor(spawn: SpawnWorker) {
    this.#spawn = spawn;
  }

  /** Whether a request is running. */
  get busy(): boolean {
    return this.#pending !== undefined;
  }

  /** Runs a request. Rejects with `CancelledError` if `cancel` stops it, and with an `Error` if the worker dies or a request is already running, which the page prevents by disabling its controls while one runs. */
  async run(request: Request): Promise<Response> {
    if (this.#pending !== undefined) throw new Error("a request is already running");

    return new Promise<Response>((resolve, reject) => {
      this.#pending = { resolve, reject };
      this.#port ??= this.#start();
      this.#port.post(request);
    });
  }

  /** Stops the running request, if any, by terminating its worker. */
  cancel(): void {
    const pending = this.#pending;
    if (pending === undefined) return;

    this.#discard();
    pending.reject(new CancelledError());
  }

  #start(): WorkerPort {
    this.#generation += 1;
    const generation = this.#generation;
    const current = (): boolean => generation === this.#generation;

    return this.#spawn({
      respond: (response) => {
        if (current()) this.#settle(response);
      },
      fail: (message) => {
        if (current()) this.#die(message);
      },
    });
  }

  #settle(response: Response): void {
    const pending = this.#pending;
    if (pending === undefined) throw new Error("unreachable: the worker answered with no request running");

    this.#pending = undefined;
    pending.resolve(response);
  }

  #die(message: string): void {
    const pending = this.#pending;
    this.#discard();
    if (pending === undefined) throw new Error("unreachable: the worker failed with no request running");

    pending.reject(new Error(message));
  }

  /** Terminates the worker and forgets the running request, so the next request starts a fresh worker. */
  #discard(): void {
    this.#generation += 1;
    this.#port?.terminate();
    this.#port = undefined;
    this.#pending = undefined;
  }
}
