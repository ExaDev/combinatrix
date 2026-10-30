import pkg from "../../package.json" with { type: "json" };
import { schemaId } from "../../scripts/schema-id";

/** The JSON Schema a model the page writes names in its `$schema`: the one published with the release this page's package is at, so an editor that opens an exported file checks it against the schema that release shipped. */
export const SCHEMA_URL: string = schemaId(pkg.version);
