// examples/07-limit.ts
import { choice, collect, count, defineModel, LimitExceededError } from "combinatrix";

const model = defineModel({
  dimensions: [
    choice("os", ["linux", "macos", "windows"]),
    choice("arch", ["x64", "arm64"]),
  ],
});

console.log(count(model, { limit: 6 }));
/*
6
*/

try {
  collect(model, { limit: 5 });
} catch (error) {
  if (!(error instanceof LimitExceededError)) throw error;

  console.log(error.bound);
  console.log(error.message);
}
/*
solution-set
the solution set has more than 5 combinations
*/
