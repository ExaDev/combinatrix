// examples/06-advanced.ts
import { choice, count, defineModel, explain, firstValid } from "combinatrix";

const model = defineModel({
  dimensions: [
    choice("mode", [undefined, "token"]),
    choice("ratio", [undefined, "moderate", "aggressive"]),
    choice("interceptors", [undefined, true]),
    choice("maturation", [undefined, true]),
    // Only needed when a feature is on, then the least channel that unlocks it.
    firstValid("channel", [undefined, "beta", "canary", "dev"], { activeWhen: { any: [{ set: "interceptors" }, { set: "maturation" }] } }),
  ],
  rules: [
    { name: "interceptors need canary or dev", requires: { in: ["channel", ["canary", "dev"]] }, when: { is: ["interceptors", true] } },
    { name: "maturation needs beta or dev", requires: { in: ["channel", ["beta", "dev"]] }, when: { is: ["maturation", true] } },
  ],
});

console.log(count(model, { limit: 1000 }));
/*
24
*/

console.dir(explain(model, { mode: "token", ratio: undefined, interceptors: true, maturation: undefined, channel: "beta" }), { depth: null });
/*
{
  valid: false,
  reasons: [
    {
      kind: 'derived',
      dimension: 'channel',
      value: 'beta',
      expected: 'canary'
    },
    {
      kind: 'constraint',
      index: 0,
      constraint: {
        dependencies: [ 'interceptors', 'channel' ],
        evaluate: [Function: evaluate],
        name: 'interceptors need canary or dev'
      },
      rule: {
        name: 'interceptors need canary or dev',
        requires: { in: [ 'channel', [ 'canary', 'dev' ] ] },
        when: { is: [ 'interceptors', true ] }
      }
    }
  ]
}
*/
