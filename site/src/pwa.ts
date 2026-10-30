import { describeBuild } from "./build";
import { byId } from "./dom";
import { watchForUpdates, workboxSource } from "./updates";

/** Shows the build the page came from as a link in the footer: to its release page, or to its commit when it is not a release. */
function showBuild(): void {
  const link = byId("build-link", HTMLAnchorElement);
  const { label, title } = describeBuild(__BUILD_IDENTITY__);
  link.textContent = label;
  link.href = __BUILD_IDENTITY__.url;
  link.title = title;
}

/** Registers the service worker and offers the user a newer version when one is waiting. A page that cannot register one, and the dev server, which has none, simply run without it. */
function startUpdates(): void {
  if (!__REGISTER_SERVICE_WORKER__ || !("serviceWorker" in navigator)) return;

  const prompt = byId("update-prompt", HTMLElement);
  const update = byId("update-now", HTMLButtonElement);
  const dismiss = byId("update-later", HTMLButtonElement);
  const offlineStatus = byId("offline-status", HTMLElement);

  watchForUpdates(
    // Relative to the page, so it is found under the repository's project-page path and under a preview of the build.
    workboxSource(new URL("sw.js", document.baseURI).href),
    {
      show: () => {
        prompt.hidden = false;
      },
      hide: () => {
        prompt.hidden = true;
      },
      offlineReady: () => {
        offlineStatus.textContent = "Ready to work offline.";
      },
      onUpdate: (listener) => {
        update.addEventListener("click", listener);
      },
      onDismiss: (listener) => {
        dismiss.addEventListener("click", listener);
      },
    },
    {
      reload: () => {
        window.location.reload();
      },
      onVisible: (listener) => {
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") listener();
        });
      },
      report: (error) => {
        console.error("The offline service worker is unavailable:", error);
      },
    },
  );
}

/** Fills in what the build supplies and starts the offline support. */
export function startPwa(): void {
  showBuild();
  startUpdates();
}
