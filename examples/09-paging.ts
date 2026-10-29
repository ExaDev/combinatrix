// examples/09-paging.ts
import { at, choice, count, defineModel, indexOf, is, samples } from "combinatrix";

const model = defineModel({
  dimensions: [
    choice("os", ["linux", "macos", "windows"]),
    choice("arch", ["x64", "arm64"]),
    choice("runtime", [undefined, "node", "bun"]),
  ],
  rules: [{ name: "bun is not offered on windows", excludes: is("os", "windows"), when: is("runtime", "bun") }],
});

const size = count(model);
console.log(at(model, size - 1)?.values);
/*
{ os: 'windows', arch: 'arm64', runtime: 'node' }
*/

console.log(at(model, size));
/*
undefined
*/

console.log(indexOf(model, { os: "macos", arch: "x64", runtime: "bun" }));
/*
8
*/

console.log(indexOf(model, { os: "windows", arch: "x64", runtime: "bun" }));
/*
-1
*/

// A seeded generator (Park and Miller's minimal standard), so the sample is the same every run.
const MODULUS = 2_147_483_647;
const MULTIPLIER = 48_271;
const SEED = 20_261_029;
let state = SEED;
const random = (bound: number): number => {
  state = (state * MULTIPLIER) % MODULUS;

  return Math.floor((state / MODULUS) * bound);
};

const SAMPLE_SIZE = 3;
let drawn = 0;
for (const { values } of samples(model, { random })) {
  console.log(values);
  drawn += 1;
  if (drawn === SAMPLE_SIZE) break;
}
/*
{ os: 'macos', arch: 'x64', runtime: undefined }
{ os: 'windows', arch: 'arm64', runtime: undefined }
{ os: 'macos', arch: 'arm64', runtime: undefined }
*/
