/** Fails the build when a union gains a variant that a `switch` over it does not list, and the page at run time if a value reaches it some other way. */
export function unreachable(value: never): never {
  throw new Error(`unreachable: ${JSON.stringify(value)} is not a variant this switch lists`);
}

/** Whether a key of a record is one of the keys its type names. */
function isKeyOf<K extends string>(record: Readonly<Record<K, unknown>>, key: string): key is K {
  return Object.hasOwn(record, key);
}

/** The keys of a record that has an entry for every member of `K`, typed as `K`: `Object.keys` can only say text. */
export function keysOf<K extends string>(record: Readonly<Record<K, unknown>>): K[] {
  return Object.keys(record).filter((key): key is K => isKeyOf(record, key));
}
