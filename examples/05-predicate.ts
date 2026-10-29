// examples/05-predicate.ts
import { choice, count, defineModel, diagnose, predicate } from "combinatrix";

const model = defineModel({
  dimensions: [choice("buildArch", ["x64", "arm64"]), choice("targetArch", ["x64", "arm64", "riscv64"])],
  constraints: [
    predicate({
      reads: ["buildArch", "targetArch"],
      name: "builds are native",
      test: ({ buildArch, targetArch }) => buildArch === targetArch,
    }),
  ],
});

console.log(count(model, { limit: 100 }));
/*
2
*/

console.log(diagnose(model, { limit: 100 }));
/*
{
  status: 'satisfiable',
  count: 2,
  deadValues: [ { dimension: 'targetArch', value: 'riscv64' } ]
}
*/
