// examples/01-combinations.ts
import { choice, combinations, count, defineModel } from "combinatrix";

const model = defineModel({
  dimensions: [
    choice("os", ["linux", "macos", "windows"]),
    choice("arch", ["x64", "arm64"]),
  ],
});

console.log(count(model));
/*
6
*/

for (const { values } of combinations(model)) console.log(values);
/*
{ os: 'linux', arch: 'x64' }
{ os: 'linux', arch: 'arm64' }
{ os: 'macos', arch: 'x64' }
{ os: 'macos', arch: 'arm64' }
{ os: 'windows', arch: 'x64' }
{ os: 'windows', arch: 'arm64' }
*/
