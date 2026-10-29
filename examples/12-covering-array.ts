// examples/12-covering-array.ts
import { choice, collect, count, coveringArray, defineModel, is, isCoveringArray } from "combinatrix";

const model = defineModel({
  dimensions: [
    choice("os", ["linux", "macos", "windows"]),
    choice("arch", ["x64", "arm64"]),
    choice("runtime", ["node", "bun", "deno"]),
  ],
  rules: [{ name: "bun is not offered on windows", excludes: is("runtime", "bun"), when: is("os", "windows") }],
});

const rows = collect(model, { strategy: coveringArray({ strength: 2 }) }).map(({ values }) => values);

console.log(count(model), rows.length);
/*
16 8
*/

for (const row of rows) console.log(row);
/*
{ os: 'linux', arch: 'x64', runtime: 'node' }
{ os: 'linux', arch: 'arm64', runtime: 'bun' }
{ os: 'macos', arch: 'x64', runtime: 'bun' }
{ os: 'macos', arch: 'arm64', runtime: 'node' }
{ os: 'windows', arch: 'x64', runtime: 'deno' }
{ os: 'windows', arch: 'arm64', runtime: 'node' }
{ os: 'linux', arch: 'arm64', runtime: 'deno' }
{ os: 'macos', arch: 'x64', runtime: 'deno' }
*/

console.log(isCoveringArray(rows, model, { strength: 2, limit: 16 }));
/*
true
*/
