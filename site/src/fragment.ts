import { MAX_DECODED_STATE_BYTES } from "./limits";

/** What a shared link carries: the model as the editor holds it, and optionally the index of the combination the sharer selected. */
export interface SharedState {
  readonly model: string;
  readonly index?: number;
}

/** Thrown when a link's fragment does not hold a shared state. */
export class SharedStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SharedStateError";
  }
}

/** The fragment parameter that holds the encoded state: `#s=<base64url>`. */
const PARAMETER = "s";

/** The deflate flavour with no zlib header or checksum, which is the smallest the platform's streams offer. */
const FORMAT = "deflate-raw";

/** Bytes turned into characters per `String.fromCharCode` call, which spreads them as arguments: far below the argument count any engine accepts. */
const CHUNK = 0x2000;

const BASE64URL = /^[A-Za-z0-9_-]*$/;

/** The link that restores `state`: the page's address with its query and fragment replaced by the encoded state. The fragment is never sent to a server. */
export async function shareUrl(page: string, state: SharedState): Promise<string> {
  const url = new URL(page);
  url.search = "";
  url.hash = `${PARAMETER}=${await encodeState(state)}`;

  return url.href;
}

/** The encoded state in a location's fragment, or `undefined` when the fragment holds none. */
export function encodedStateOf(hash: string): string | undefined {
  const parameters = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);

  return parameters.get(PARAMETER) ?? undefined;
}

/** The state as deflate-compressed JSON, in base64url. */
export async function encodeState(state: SharedState): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(state));
  const compressed = await readAll(new Blob([json]).stream().pipeThrough(new CompressionStream(FORMAT)));

  return toBase64Url(compressed);
}

/** The state an encoded string holds. Throws `SharedStateError` when it is not base64url, not deflate data, inflates past `MAX_DECODED_STATE_BYTES`, or is not a state. */
export async function decodeState(encoded: string): Promise<SharedState> {
  if (!BASE64URL.test(encoded)) throw new SharedStateError("the link's data is not base64url");

  let json: string;
  try {
    const compressed = fromBase64Url(encoded);
    const inflated = await readAll(new Blob([compressed]).stream().pipeThrough(new DecompressionStream(FORMAT)).pipeThrough(capped(MAX_DECODED_STATE_BYTES)));
    json = new TextDecoder("utf-8", { fatal: true }).decode(inflated);
  } catch (error) {
    if (error instanceof SharedStateError) throw error;

    throw new SharedStateError("the link's data is not a compressed state");
  }

  return parseState(json);
}

function parseState(json: string): SharedState {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new SharedStateError("the link's data is not JSON");
  }
  if (typeof value !== "object" || value === null || !("model" in value) || typeof value.model !== "string") throw new SharedStateError("the link's data has no model");
  if (!("index" in value) || value.index === undefined) return { model: value.model };
  if (typeof value.index !== "number" || !Number.isSafeInteger(value.index) || value.index < 0) throw new SharedStateError("the link's index is not a non-negative integer");

  return { model: value.model, index: value.index };
}

/** Everything a stream yields, concatenated. */
async function readAll(stream: Readonly<ReadableStream<Uint8Array<ArrayBuffer>>>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A pass-through that errors the stream with a `SharedStateError`, which also stops the inflation upstream, once more than `maxBytes` have passed. */
function capped(maxBytes: number): TransformStream<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>> {
  let length = 0;

  return new TransformStream({
    transform: (chunk, controller) => {
      length += chunk.byteLength;
      if (length > maxBytes) controller.error(new SharedStateError(`the link's data is larger than ${String(maxBytes)} bytes once inflated; share a model that large as a gist`));
      else controller.enqueue(chunk);
    },
  });
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let start = 0; start < bytes.length; start += CHUNK) binary += String.fromCharCode(...bytes.subarray(start, start + CHUNK));

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** The bytes a base64url string encodes. Throws `DOMException` when its length cannot be base64. */
function fromBase64Url(encoded: string): Uint8Array<ArrayBuffer> {
  const binary = atob(encoded.replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);

  return bytes;
}
