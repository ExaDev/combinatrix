// examples/08-cancellation.ts
import { choice, count, defineModel, isNonEmpty, predicate } from "combinatrix";

const SIZE = 1000;
const ABORT_AT = 10;
const values = Array.from({ length: SIZE }, (_, index) => index);
// A list built at runtime is typed number[], so it is narrowed to a non-empty domain first.
if (!isNonEmpty(values)) throw new Error("SIZE is positive");
const controller = new AbortController();
let evaluations = 0;

const model = defineModel({
  dimensions: [choice("n", values)],
  constraints: [
    predicate({
      reads: ["n"],
      test: () => {
        evaluations += 1;
        // Abort from inside the search, so the run is the same every time.
        if (evaluations === ABORT_AT) controller.abort(new Error("enough"));

        return true;
      },
    }),
  ],
});

try {
  count(model, { signal: controller.signal });
} catch (error) {
  console.log(error === controller.signal.reason);
}
/*
true
*/

console.log(evaluations < SIZE);
/*
true
*/
