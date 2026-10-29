// examples/11-json-model.ts
import { collect, ModelError, parseModel } from "combinatrix";

// The contents of a model file. JSON has no `undefined`, so a dimension is unset only where its `activeWhen` does not hold.
const text = `{
  "dimensions": [
    { "kind": "choice", "name": "os", "values": ["linux", "windows"] },
    { "kind": "choice", "name": "compress", "values": [true, false] },
    { "kind": "first-valid", "name": "codec", "candidates": ["zstd", "brotli"], "activeWhen": { "is": ["compress", true] } }
  ],
  "rules": [{ "name": "windows has no zstd", "excludes": { "is": ["codec", "zstd"] }, "when": { "is": ["os", "windows"] } }]
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
  parseModel({ dimensions: [{ kind: "choice", name: "os", values: ["linux"] }], rules: [{ requires: { set: "arch" } }] });
} catch (error) {
  if (!(error instanceof ModelError)) throw error;

  for (const issue of error.issues) console.log(issue);
}
/*
rule 0 mentions unknown dimension "arch"
constraint 0 depends on unknown dimension "arch"
*/
