/** The `$id` of the published JSON Schema for a package version, which a model file names in its `$schema`. It is version-pinned, never `latest`, so a reference to it keeps meaning the schema it was written against. */
export function schemaId(version: string): string {
  return `https://cdn.jsdelivr.net/npm/combinatrix@${version}/schemas/combinatrix.schema.json`;
}
