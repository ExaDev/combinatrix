// examples/11-json-model.ts
import { collect, ModelError, parseModel } from "combinatrix";

// The contents of a model file. Conditions are trilean predicate trees. JSON has no `undefined`, so a dimension is unset only where its `activeWhen` does not hold, and a comparison of a dimension that can be unset is guarded by `exists`, as a trilean comparison of an absent value is undecided rather than false.
const text = `{
  "dimensions": [
    { "kind": "choice", "name": "os", "values": ["linux", "windows"] },
    { "kind": "choice", "name": "compress", "values": [true, false] },
    {
      "kind": "first-valid",
      "name": "codec",
      "candidates": ["zstd", "brotli"],
      "activeWhen": { "kind": "memberOf", "op": "in", "operand": { "kind": "reference", "key": "compress" }, "candidates": [{ "kind": "booleanLiteral", "value": true }] }
    }
  ],
  "rules": [
    {
      "name": "windows has no zstd",
      "excludes": {
        "kind": "and",
        "left": { "kind": "exists", "operand": { "kind": "reference", "key": "codec" } },
        "right": { "kind": "textCompare", "op": "equals", "left": { "kind": "reference", "key": "codec" }, "right": { "kind": "textLiteral", "value": "zstd" } }
      },
      "when": { "kind": "textCompare", "op": "equals", "left": { "kind": "reference", "key": "os" }, "right": { "kind": "textLiteral", "value": "windows" } }
    }
  ]
}`;

const data: unknown = JSON.parse(text);
const model = parseModel(data);

for (const { values } of collect(model)) console.log(values);
/*
{ os: 'linux', compress: true, codec: 'zstd' }
{ os: 'linux', compress: false, codec: undefined }
{ os: 'windows', compress: true, codec: 'brotli' }
{ os: 'windows', compress: false, codec: undefined }
*/

// A rule naming a dimension the model lacks is refused, with every such defect listed.
try {
  parseModel({ dimensions: [{ kind: "choice", name: "os", values: ["linux"] }], rules: [{ requires: { kind: "exists", operand: { kind: "reference", key: "arch" } } }] });
} catch (error) {
  if (!(error instanceof ModelError)) throw error;

  for (const issue of error.issues) console.log(issue);
}
/*
rule 0 at $.operand: mentions unknown dimension "arch"
*/
