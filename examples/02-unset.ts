// examples/02-unset.ts
import { choice, collect, count, defineModel } from "combinatrix";

const model = defineModel({
  dimensions: [
    choice("os", ["linux", "macos", "windows"]),
    choice("arch", ["x64", "arm64"]),
    choice("runtime", [undefined, "node", "bun"]),
  ],
});

console.log(count(model, { limit: 100 }));
/*
18
*/

const [first] = collect(model, { limit: 100 });
console.log(first?.values);
/*
{ os: 'linux', arch: 'x64', runtime: undefined }
*/
