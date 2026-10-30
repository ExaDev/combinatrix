import { describe, expect, it } from "vitest";

import { watchForUpdates } from "./updates";

type Listener = () => void;

/** Calls each listener, as the browser or the user would. */
function fire(listeners: readonly Listener[]): void {
  for (const listener of listeners) listener();
}

/** A browser call that finishes later, either well or with the given failure. */
async function outcome(failure: Error | undefined): Promise<void> {
  await Promise.resolve();
  if (failure !== undefined) throw failure;
}

/** The worker, the prompt and the page around the update logic, driven by hand: each records what the logic asks of it and exposes the events a browser or a user would cause. */
function setup(failures: { readonly register?: Error; readonly check?: Error } = {}) {
  const listeners = { waiting: [] as Listener[], controlling: [] as Listener[], update: [] as Listener[], dismiss: [] as Listener[], visible: [] as Listener[] };
  const seen = { registrations: 0, checks: 0, activations: 0, reloads: 0, shown: false, reported: [] as unknown[] };

  watchForUpdates(
    {
      register: async () => {
        seen.registrations += 1;
        await outcome(failures.register);
      },
      onWaiting: (listener) => {
        listeners.waiting.push(listener);
      },
      onControlling: (listener) => {
        listeners.controlling.push(listener);
      },
      checkForUpdate: async () => {
        seen.checks += 1;
        await outcome(failures.check);
      },
      activateWaiting: () => {
        seen.activations += 1;
      },
    },
    {
      show: () => {
        seen.shown = true;
      },
      hide: () => {
        seen.shown = false;
      },
      onUpdate: (listener) => {
        listeners.update.push(listener);
      },
      onDismiss: (listener) => {
        listeners.dismiss.push(listener);
      },
    },
    {
      reload: () => {
        seen.reloads += 1;
      },
      onVisible: (listener) => {
        listeners.visible.push(listener);
      },
      report: (error) => {
        seen.reported.push(error);
      },
    },
  );

  return {
    seen,
    installWaiting: () => {
      fire(listeners.waiting);
    },
    takeOver: () => {
      fire(listeners.controlling);
    },
    pressUpdate: () => {
      fire(listeners.update);
    },
    pressLater: () => {
      fire(listeners.dismiss);
    },
    becomeVisible: () => {
      fire(listeners.visible);
    },
  };
}

/** Lets the promises the update logic started settle, so a failure it caught has been reported. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("watchForUpdates", () => {
  it("registers the worker and shows nothing until an update is waiting", () => {
    const { seen } = setup();

    expect(seen.registrations).toBe(1);
    expect(seen.shown).toBe(false);
  });

  it("offers the update when a newer worker is waiting, without activating it", () => {
    const { seen, installWaiting } = setup();
    installWaiting();

    expect(seen.shown).toBe(true);
    expect(seen.activations).toBe(0);
  });

  it("activates the waiting worker only when the user asks, and reloads once it has taken over", () => {
    const { seen, installWaiting, pressUpdate, takeOver } = setup();
    installWaiting();
    pressUpdate();

    expect(seen.activations).toBe(1);
    expect(seen.reloads).toBe(0);

    takeOver();

    expect(seen.reloads).toBe(1);
  });

  it("does not reload the page for a worker that takes over without being asked, such as the first to install", () => {
    const { seen, takeOver } = setup();
    takeOver();

    expect(seen.reloads).toBe(0);
  });

  it("hides the prompt and leaves the page and the waiting worker alone when the user puts the update off", () => {
    const { seen, installWaiting, pressLater } = setup();
    installWaiting();
    pressLater();

    expect(seen.shown).toBe(false);
    expect(seen.activations).toBe(0);
    expect(seen.reloads).toBe(0);
  });

  it("looks for a newer worker each time the page becomes visible again", () => {
    const { seen, becomeVisible } = setup();
    becomeVisible();
    becomeVisible();

    expect(seen.checks).toBe(2);
  });

  it("reports a worker that cannot register and carries on", async () => {
    const failure = new Error("blocked");
    const { seen } = setup({ register: failure });
    await settle();

    expect(seen.reported).toEqual([failure]);
  });

  it("reports a failed check for an update, such as one made offline, and carries on", async () => {
    const failure = new Error("offline");
    const { seen, becomeVisible } = setup({ check: failure });
    becomeVisible();
    await settle();

    expect(seen.reported).toEqual([failure]);
  });
});
