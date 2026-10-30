import { Workbox } from "workbox-window";

/** The service worker, as the page's update logic needs it, so a test can stand in for the browser. */
export interface UpdateSource {
  /** Registers the worker. Rejects when the browser cannot. */
  readonly register: () => Promise<void>;
  /** Calls the listener when a newer worker has installed and is waiting for the page to let it take over. */
  readonly onWaiting: (listener: () => void) => void;
  /** Calls the listener when a newer worker has taken over the page. */
  readonly onControlling: (listener: () => void) => void;
  /** Asks the browser to look for a newer worker now. */
  readonly checkForUpdate: () => Promise<void>;
  /** Lets the waiting worker take over. */
  readonly activateWaiting: () => void;
}

/** The prompt the page shows when an update is waiting. */
export interface UpdateView {
  readonly show: () => void;
  readonly hide: () => void;
  /** Calls the listener when the user asks to update now. */
  readonly onUpdate: (listener: () => void) => void;
  /** Calls the listener when the user puts the update off. */
  readonly onDismiss: (listener: () => void) => void;
}

/** What the update logic needs from the page around it. */
export interface UpdateEnvironment {
  readonly reload: () => void;
  /** Calls the listener each time the page becomes visible again. */
  readonly onVisible: (listener: () => void) => void;
  /** Reports a failure the user does not need to see: the page works without a service worker. */
  readonly report: (error: unknown) => void;
}

/**
 * Wires a service worker to the update prompt. A newer worker is installed in the background and left waiting; the prompt offers it, and only the user's choice lets it take over and reloads the page, so a running session is never swapped under the user. The browser looks for a newer worker on each navigation; this also looks each time the page becomes visible again, so a page left open in the background hears of a release when it is next seen.
 *
 * A browser that cannot register the worker is left as it is: the page works online without one, so the failure goes to `report` and nowhere else.
 */
export function watchForUpdates(source: UpdateSource, view: UpdateView, environment: UpdateEnvironment): void {
  let updating = false;

  source.onWaiting(view.show);
  source.onControlling(() => {
    // A worker can also take over a page that never asked, such as the first one to install; only the update the user chose reloads it.
    if (updating) environment.reload();
  });
  view.onUpdate(() => {
    updating = true;
    source.activateWaiting();
  });
  view.onDismiss(view.hide);
  environment.onVisible(() => {
    source.checkForUpdate().catch(environment.report);
  });

  source.register().catch(environment.report);
}

/** The browser's service worker for the script at `url`, through Workbox's window helper, which tracks an install through to its waiting and controlling states. */
export function workboxSource(url: string): UpdateSource {
  const workbox = new Workbox(url);

  return {
    register: async () => {
      await workbox.register();
    },
    onWaiting: (listener) => {
      workbox.addEventListener("waiting", listener);
    },
    onControlling: (listener) => {
      workbox.addEventListener("controlling", listener);
    },
    checkForUpdate: async () => {
      await workbox.update();
    },
    activateWaiting: () => {
      workbox.messageSkipWaiting();
    },
  };
}
