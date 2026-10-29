// examples/03-rules.ts
import { choice, count, defineModel, explain, is } from "combinatrix";

const model = defineModel({
  dimensions: [
    choice("os", ["linux", "macos", "windows"]),
    choice("arch", ["x64", "arm64"]),
    choice("runtime", [undefined, "node", "bun"]),
  ],
  rules: [{ name: "bun is not offered on windows", excludes: is("os", "windows"), when: is("runtime", "bun") }],
});

console.log(count(model));
/*
16
*/

console.dir(explain(model, { os: "windows", arch: "x64", runtime: "bun" }), { depth: 4 });
/*
{
  valid: false,
  reasons: [
    {
      kind: 'constraint',
      index: 0,
      constraint: {
        dependencies: [ 'runtime', 'os' ],
        evaluate: [Function: evaluate],
        name: 'bun is not offered on windows'
      },
      rule: {
        name: 'bun is not offered on windows',
        excludes: { kind: 'and', left: [Object], right: [Object] },
        when: { kind: 'and', left: [Object], right: [Object] }
      }
    }
  ]
}
*/

// A condition is a trilean predicate tree, plain JSON: the dimension is set, and is one of the values.
console.log(JSON.stringify(is("os", "windows")));
/*
{"kind":"and","left":{"kind":"exists","operand":{"kind":"reference","key":"os"}},"right":{"kind":"memberOf","op":"in","operand":{"kind":"reference","key":"os"},"candidates":[{"kind":"textLiteral","value":"windows"}]}}
*/
