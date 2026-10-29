/** The rows the combinations table asks for until the user changes it. */
export const DEFAULT_LIST_LIMIT = 100;

/** The most rows the table is asked for: each row is plain DOM, so beyond this the page itself, not the engine, would be what stalls. */
export const MAX_LIST_LIMIT = 10_000;

/** The default strength of a covering array: pairwise, which covers every pair of values. */
export const DEFAULT_STRENGTH = 2;

/** The largest solution set the page enumerates to check a covering array. `isCoveringArray` enumerates the whole solution set and keys every t-way tuple of each combination, so past this size the check would cost far more than building the array; the array is shown unchecked and the page says why. */
export const VERIFICATION_SOLUTION_SET_LIMIT = 10_000;

const BYTES_PER_MEBIBYTE = 1_048_576;

/** The most mebibytes a shared link may inflate to. A fragment is attacker-controlled input to `DecompressionStream`, and deflate can expand a few kilobytes to gigabytes, so the inflated size is capped; a model larger than this travels as a gist. */
const MAX_DECODED_STATE_MEBIBYTES = 8;

/** `MAX_DECODED_STATE_MEBIBYTES` in bytes. */
export const MAX_DECODED_STATE_BYTES = MAX_DECODED_STATE_MEBIBYTES * BYTES_PER_MEBIBYTE;
