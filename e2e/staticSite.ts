import { readFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';

/** The media types of the files the built site holds. */
const MEDIA_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
};

/** The HTTP statuses the server answers with. */
const OK = 200;
const NOT_FOUND = 404;

/** The address the server listens on, named for the same reason playwright.config.ts names its own. */
const HOST = '127.0.0.1';

/** A change to a file before it is served, as a deployment of a newer build would make: the path under the site's base and the bytes it holds, answered with the bytes to serve instead. */
export type Transform = (path: string, body: Buffer) => Buffer;

/** A built site served from its own origin, which a test can stop to take the network away from the browser. */
export interface StaticSite {
  /** The address of the site's start page, under its base path. */
  readonly url: string;
  /** Stops answering and drops every open connection, so the next request fails to connect as it does with no network. */
  readonly stop: () => Promise<void>;
}

/** The file under `directory` that a request path names, or undefined for a path outside the base or outside the directory. */
function fileFor(directory: string, base: string, pathname: string): { readonly relative: string; readonly file: string } | undefined {
  if (!pathname.startsWith(base)) return undefined;
  const relative = pathname.slice(base.length) || 'index.html';
  const file = normalize(join(directory, relative));

  return file.startsWith(directory + sep) ? { relative, file } : undefined;
}

/** Serves the built site in `directory` under `base` on a port of its own, with `transform` applied to each file. A server per test gives each its own origin, so no test shares a service worker or cache with another. */
export async function serveSite(directory: string, base: string, transform: Transform = (_path, body) => body): Promise<StaticSite> {
  const server: Server = createServer((request, response) => {
    void (async () => {
      const target = fileFor(directory, base, new URL(request.url ?? '/', `http://${HOST}`).pathname);
      if (target === undefined) {
        response.writeHead(NOT_FOUND).end();

        return;
      }
      try {
        const body = transform(target.relative, await readFile(target.file));
        response.writeHead(OK, { 'content-type': MEDIA_TYPES[extname(target.file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' }).end(body);
      } catch {
        response.writeHead(NOT_FOUND).end();
      }
    })();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, HOST, resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('the server is not listening on a port');

  return {
    url: `http://${HOST}:${String(address.port)}${base}`,
    stop: async () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
        server.closeAllConnections();
      }),
  };
}
