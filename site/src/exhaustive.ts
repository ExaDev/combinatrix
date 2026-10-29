/** Fails the build when a union gains a variant that a `switch` over it does not list, and the page at run time if a value reaches it some other way. */
export function unreachable(value: never): never {
  throw new Error(`unreachable: ${JSON.stringify(value)} is not a variant this switch lists`);
}
