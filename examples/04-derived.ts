// examples/04-derived.ts
import { choice, collect, defineModel, firstValid } from "combinatrix";

const model = defineModel({
  dimensions: [
    choice("os", ["linux", "windows"]),
    choice("compress", [undefined, true]),
    // The preferred codec first; the one chosen is the first that no rule rejects.
    firstValid("codec", ["zstd", "brotli", "gzip"], { activeWhen: { set: "compress" } }),
  ],
  rules: [{ name: "windows has no zstd", excludes: { is: ["codec", "zstd"] }, when: { is: ["os", "windows"] } }],
});

for (const { values } of collect(model, { limit: 100 })) console.log(values);
/*
{ os: 'linux', compress: undefined, codec: undefined }
{ os: 'linux', compress: true, codec: 'zstd' }
{ os: 'windows', compress: undefined, codec: undefined }
{ os: 'windows', compress: true, codec: 'brotli' }
*/
