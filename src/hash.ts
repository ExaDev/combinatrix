const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const HASH_BITS = 64;
const HEX_RADIX = 16;
const BITS_PER_HEX_DIGIT = 4;
const HEX_DIGITS = HASH_BITS / BITS_PER_HEX_DIGIT;

const encoder = new TextEncoder();

/**
 * The 64-bit FNV-1a hash of a string's UTF-8 bytes, as 16 lower-case hexadecimal digits. Pure JavaScript with no runtime-specific import, so the same text hashes to the same digits in every runtime. Not a cryptographic hash: it identifies, it does not authenticate.
 */
export function fnv1a64(text: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (const byte of encoder.encode(text)) {
    hash = BigInt.asUintN(HASH_BITS, (hash ^ BigInt(byte)) * FNV_PRIME);
  }

  return hash.toString(HEX_RADIX).padStart(HEX_DIGITS, "0");
}
