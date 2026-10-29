import { execute } from "./engine";
import type { Request } from "./protocol";

// The worker's own global, which is not the page's `Window` that the DOM library declares `self` as.
declare const self: DedicatedWorkerGlobalScope;

self.addEventListener("message", (event: MessageEvent<Request>) => {
  self.postMessage(execute(event.data));
});
