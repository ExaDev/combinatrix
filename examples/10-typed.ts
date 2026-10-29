// examples/10-typed.ts
import { allOf, choice, collect, computed, defineModel, explain, is } from "combinatrix";

const os = choice("os", ["linux", "macos", "windows"]);
const arch = choice("arch", ["x64", "arm64"]);

const model = defineModel({
  dimensions: [
    os,
    arch,
    // Given as the dimensions themselves, the reads arrive with their own value types.
    computed("target", { reads: [os, arch], compute: (values) => `${values.arch}-${values.os === "macos" ? "apple-darwin" : values.os}` }),
  ],
  rules: [{ name: "no arm64 on windows", excludes: allOf(is("os", "windows"), is("arch", "arm64")) }],
});

console.log(collect(model).map(({ values }) => values.target));
/*
[
  'x64-linux',
  'arm64-linux',
  'x64-apple-darwin',
  'arm64-apple-darwin',
  'x64-windows'
]
*/

const explanation = explain(model, { os: "windows", arch: "arm64", target: "x64-windows" });
if (!explanation.valid) {
  for (const reason of explanation.reasons) {
    // Testing the dimension narrows the value to that dimension's own values.
    if (reason.kind === "derived" && reason.dimension === "target") console.log(reason.expected);
    if (reason.kind === "constraint") console.log(reason.rule?.name);
  }
}
/*
arm64-windows
no arm64 on windows
*/
