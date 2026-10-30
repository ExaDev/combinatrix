import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { format, inspect } from "node:util";

import { describe, expect, it, vi } from "vitest";

import { budgetFor } from "../test/budget";

/**
 * The README's examples are the files in `examples/`. Each is shown verbatim in a fenced `ts` block of the README whose first line is the comment naming its file, and each shows what it prints in the bare block comments, with the opening and closing delimiters each on a line of their own, that follow the statements printing it. This suite runs every file, so an example that stops compiling or running fails here; compares each README block with its file byte for byte; compares the lines a file prints with the lines of those block comments; and derives the expected values of each example by plain loops, independently of the library.
 */
const ROOT = join(import.meta.dirname, "..");
const EXAMPLES_DIRECTORY = join(ROOT, "examples");
const MARKER = /^\/\/ examples\/(?<file>\S+\.ts)$/u;

/** Each example module is imported by a literal path so the bundler can follow it; importing a module runs it. */
const LOADERS: Readonly<Record<string, () => Promise<unknown>>> = {
  "01-combinations.ts": async () => import("../examples/01-combinations"),
  "02-unset.ts": async () => import("../examples/02-unset"),
  "03-rules.ts": async () => import("../examples/03-rules"),
  "04-derived.ts": async () => import("../examples/04-derived"),
  "05-predicate.ts": async () => import("../examples/05-predicate"),
  "06-advanced.ts": async () => import("../examples/06-advanced"),
  "07-limit.ts": async () => import("../examples/07-limit"),
  "08-cancellation.ts": async () => import("../examples/08-cancellation"),
  "09-paging.ts": async () => import("../examples/09-paging"),
  "10-typed.ts": async () => import("../examples/10-typed"),
  "11-json-model.ts": async () => import("../examples/11-json-model"),
  "12-covering-array.ts": async () => import("../examples/12-covering-array"),
};

const FILES = Object.keys(LOADERS);

/** The time one example may take a test, in milliseconds: at least two hundred times what the slowest takes on an idle machine, which is the first, since it loads the library, so a machine under heavy load still passes and only an example that stops terminating fails. */
const EXAMPLE_BUDGET_MS = 26_000;
/** The options of a test that runs one example. */
const ONE_EXAMPLE = budgetFor(1, EXAMPLE_BUDGET_MS);

/** The lines an example prints through `console.log` and `console.dir`, formatted as Node formats them, in the order printed. */
async function printedBy(file: string): Promise<string[]> {
  const load = LOADERS[file];
  if (load === undefined) throw new Error(`no loader for ${file}`);

  const lines: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...args: readonly unknown[]) => void lines.push(...format(...args).split("\n")));
  const dir = vi.spyOn(console, "dir").mockImplementation((value: unknown, options?: object) => void lines.push(...inspect(value, { customInspect: false, ...options }).split("\n")));
  try {
    await load();
  } finally {
    log.mockRestore();
    dir.mockRestore();
  }

  return lines;
}

/** The output a source file claims: the lines of each bare block comment, verbatim. */
function claimedBy(source: string): string[] {
  const claimed: string[] = [];
  let inBlock = false;
  for (const line of source.split("\n")) {
    if (line === "/*") inBlock = true;
    else if (line === "*/") inBlock = false;
    else if (inBlock) claimed.push(line);
  }

  return claimed;
}

/** The README's fenced `ts` blocks that start with an example marker, keyed by the file they name, in README order. */
function readmeExamples(): Map<string, string> {
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  const blocks = new Map<string, string>();
  for (const match of readme.matchAll(/^```ts\n(?<code>[\s\S]*?)\n```$/gmu)) {
    const code = match.groups?.["code"] ?? "";
    const file = MARKER.exec(code.split("\n")[0] ?? "")?.groups?.["file"];
    if (file === undefined) continue;

    if (blocks.has(file)) throw new Error(`README shows ${file} twice`);
    blocks.set(file, code);
  }

  return blocks;
}

const printed = new Map<string, Promise<string[]>>();

/** What an example prints, running it on first use only: importing a module runs it once, and a test file's tests run one at a time, so the spies in `printedBy` never overlap. */
async function printedOf(file: string): Promise<string[]> {
  const run = printed.get(file) ?? printedBy(file);
  printed.set(file, run);

  return await run;
}

function sourceOf(file: string): string {
  return readFileSync(join(EXAMPLES_DIRECTORY, file), "utf8");
}

describe("the README's examples", () => {
  it("has a loader for every file in examples and a block in the README for every file, in order", () => {
    expect(readdirSync(EXAMPLES_DIRECTORY).sort()).toEqual(FILES);
    expect([...readmeExamples().keys()]).toEqual(FILES);
  });

  it.each(FILES)("shows %s in the README byte for byte", (file) => {
    expect(`${readmeExamples().get(file) ?? ""}\n`).toBe(sourceOf(file));
  });

  it.each(FILES)("prints what the block comments of %s say it prints", ONE_EXAMPLE, async (file) => {
    expect(claimedBy(sourceOf(file))).toEqual(await printedOf(file));
  });
});

const OS = ["linux", "macos", "windows"] as const;
const ARCH = ["x64", "arm64"] as const;
const RUNTIME = [undefined, "node", "bun"] as const;

describe("the combinations example", () => {
  it("prints the size of the Cartesian product, then each combination with the first dimension varying slowest", ONE_EXAMPLE, async () => {
    const expected = OS.flatMap((os) => ARCH.map((arch) => format({ os, arch })));
    expect(await printedOf("01-combinations.ts")).toEqual([String(OS.length * ARCH.length), ...expected]);
  });
});

describe("the unset example", () => {
  it("counts the product with unset as a value, and shows the key present with the value undefined", ONE_EXAMPLE, async () => {
    expect(await printedOf("02-unset.ts")).toEqual([String(OS.length * ARCH.length * RUNTIME.length), format({ os: "linux", arch: "x64", runtime: undefined })]);
  });
});

/** The kind of each reason in an explanation as `console.dir` prints it, where each reason's own keys are indented by six spaces and a condition's nodes are printed inline after a key. */
const REASON_KIND = /^ {6}kind: /gmu;

describe("the rules example", () => {
  const survivors = OS.flatMap((os) => ARCH.flatMap((arch) => RUNTIME.filter((runtime) => !(runtime === "bun" && os === "windows")).map((runtime) => ({ os, arch, runtime }))));

  it("counts the product less the combinations the rule excludes", ONE_EXAMPLE, async () => {
    expect((await printedOf("03-rules.ts"))[0]).toBe(String(survivors.length));
  });

  it("explains the excluded combination by naming the rule that excludes it, and no other reason", ONE_EXAMPLE, async () => {
    const explanation = (await printedOf("03-rules.ts")).slice(1, -1).join("\n");
    expect(explanation).toContain("valid: false");
    expect(explanation).toContain("name: 'bun is not offered on windows'");
    expect(explanation.match(REASON_KIND)).toHaveLength(1);
  });

  it("prints the condition as a trilean tree: the dimension exists and is a member of the one value", ONE_EXAMPLE, async () => {
    const line = (await printedOf("03-rules.ts")).at(-1) ?? "";
    const reference = { kind: "reference", key: "os" };
    expect(JSON.parse(line)).toEqual({ kind: "and", left: { kind: "exists", operand: reference }, right: { kind: "memberOf", op: "in", operand: reference, candidates: [{ kind: "textLiteral", value: "windows" }] } });
  });
});

describe("the derived example", () => {
  it("lists a compressed combination once per operating system with the first codec the rule accepts, and an uncompressed one with no codec", ONE_EXAMPLE, async () => {
    const codecs = ["zstd", "brotli", "gzip"] as const;
    const expected = (["linux", "windows"] as const).flatMap((os) =>
      ([undefined, true] as const).map((compress) => {
        const codec = compress === undefined ? undefined : codecs.find((candidate) => !(os === "windows" && candidate === "zstd"));

        return format({ os, compress, codec });
      }),
    );
    expect(await printedOf("04-derived.ts")).toEqual(expected);
  });
});

describe("the predicate example", () => {
  const BUILD = ["x64", "arm64"] as const;
  const TARGET = ["x64", "arm64", "riscv64"] as const;
  const accepted = BUILD.flatMap((buildArch) => TARGET.filter((targetArch) => buildArch === targetArch).map((targetArch) => ({ buildArch, targetArch })));

  it("counts the pairs the function accepts and reports as dead the target no pair uses", ONE_EXAMPLE, async () => {
    const dead = TARGET.filter((targetArch) => !accepted.some((pair) => pair.targetArch === targetArch));
    expect(dead).toEqual(["riscv64"]);
    expect(await printedOf("05-predicate.ts")).toEqual([String(accepted.length), ...format({ status: "satisfiable", count: accepted.length, deadValues: dead.map((value) => ({ dimension: "targetArch", value })) }).split("\n")]);
  });
});

describe("the advanced example", () => {
  const CHANNELS = [undefined, "beta", "canary", "dev"] as const;
  const SWITCH = [undefined, true] as const;
  const solutions = SWITCH.flatMap((interceptors) =>
    SWITCH.flatMap((maturation) => {
      if (interceptors === undefined && maturation === undefined) return [undefined];

      const accepts = (channel: (typeof CHANNELS)[number]) => (interceptors !== true || channel === "canary" || channel === "dev") && (maturation !== true || channel === "beta" || channel === "dev");
      const channel = CHANNELS.find(accepts);

      return channel === undefined ? [] : [channel];
    }),
  );

  it("counts the free choices times the channels the features leave open", ONE_EXAMPLE, async () => {
    const modes = 2;
    const ratios = 3;
    expect((await printedOf("06-advanced.ts"))[0]).toBe(String(modes * ratios * solutions.length));
  });

  it("explains a channel too weak for the interceptors by the derived channel and the rule", ONE_EXAMPLE, async () => {
    const explanation = (await printedOf("06-advanced.ts")).slice(1).join("\n");
    expect(explanation).toContain("expected: 'canary'");
    expect(explanation).toContain("name: 'interceptors need canary or dev'");
    expect(explanation.match(REASON_KIND)).toHaveLength(2);
  });
});

describe("the limit example", () => {
  it("counts the product when the limit equals its size, then refuses a collection one short of it, saying the limit", ONE_EXAMPLE, async () => {
    const size = OS.length * ARCH.length;
    expect(await printedOf("07-limit.ts")).toEqual([String(size), "solution-set", `the solution set has more than ${String(size - 1)} combinations`]);
  });
});

describe("the paging example", () => {
  const survivors = OS.flatMap((os) => ARCH.flatMap((arch) => RUNTIME.filter((runtime) => !(runtime === "bun" && os === "windows")).map((runtime) => ({ os, arch, runtime }))));
  const MODULUS = 2_147_483_647;
  const MULTIPLIER = 48_271;
  const SEED = 20_261_029;
  const SAMPLE_SIZE = 3;
  /** The lines printed before the sample: the last combination, past the end, and two indices. */
  const BEFORE_SAMPLE = 4;

  it("finds the last combination by index, nothing past it, the index of a combination and -1 for an excluded one", ONE_EXAMPLE, async () => {
    const last = survivors.at(-1);
    const position = survivors.findIndex(({ os, arch, runtime }) => os === "macos" && arch === "x64" && runtime === "bun");
    expect((await printedOf("09-paging.ts")).slice(0, BEFORE_SAMPLE)).toEqual([format(last), "undefined", String(position), "-1"]);
  });

  it("draws the combinations at the indices the seeded generator picks below the count", ONE_EXAMPLE, async () => {
    let state = SEED;
    const drawn = Array.from({ length: SAMPLE_SIZE }, () => {
      state = (state * MULTIPLIER) % MODULUS;

      return survivors[Math.floor((state / MODULUS) * survivors.length)];
    });
    expect((await printedOf("09-paging.ts")).slice(BEFORE_SAMPLE)).toEqual(drawn.map((values) => format(values)));
  });
});

describe("the typed example", () => {
  const TARGET_OS = { linux: "linux", macos: "apple-darwin", windows: "windows" } as const;

  it("computes each target from its os and arch, leaving out the excluded pair, and explains a wrong target by the derived one and the rule", ONE_EXAMPLE, async () => {
    const targets = OS.flatMap((os) => ARCH.filter((arch) => !(os === "windows" && arch === "arm64")).map((arch) => `${arch}-${TARGET_OS[os]}`));
    expect(await printedOf("10-typed.ts")).toEqual([...format(targets).split("\n"), `arm64-${TARGET_OS.windows}`, "no arm64 on windows"]);
  });
});

describe("the cancellation example", () => {
  it("catches the signal's own reason, and stops the search before it has visited every value", ONE_EXAMPLE, async () => {
    expect(await printedOf("08-cancellation.ts")).toEqual(["true", "true"]);
  });
});

describe("the JSON model example", () => {
  it("lists the model's combinations with the first dimension slowest, the codec the first the rule accepts and unset only where `compress` is off, then the issue for the rule naming a dimension the model lacks", ONE_EXAMPLE, async () => {
    const codecs = ["zstd", "brotli"] as const;
    const expected = (["linux", "windows"] as const).flatMap((os) =>
      ([true, false] as const).map((compress) => {
        const codec = compress ? codecs.find((candidate) => !(os === "windows" && candidate === "zstd")) : undefined;

        return format({ os, compress, codec });
      }),
    );
    expect(await printedOf("11-json-model.ts")).toEqual([...expected, 'rule 0 at $.operand: mentions unknown dimension "arch"']);
  });
});

describe("the covering array example", () => {
  const RUNTIMES = ["node", "bun", "deno"] as const;
  interface Combination { readonly os: (typeof OS)[number]; readonly arch: (typeof ARCH)[number]; readonly runtime: (typeof RUNTIMES)[number] }
  const solutions: Combination[] = OS.flatMap((os) => ARCH.flatMap((arch) => RUNTIMES.filter((runtime) => !(runtime === "bun" && os === "windows")).map((runtime) => ({ os, arch, runtime }))));
  const byText = new Map(solutions.map((solution) => [format(solution), solution]));
  const PAIRS = [["os", "arch"], ["os", "runtime"], ["arch", "runtime"]] as const;
  const pairsOf = (combination: Combination): string[] => PAIRS.map(([left, right]) => `${left}=${combination[left]} ${right}=${combination[right]}`);

  /** The solution a printed row shows, refusing a row that is not one. */
  function solutionShown(row: string): Combination {
    const solution = byText.get(row);
    if (solution === undefined) throw new Error(`${row} is not a solution`);

    return solution;
  }

  it("prints the size of the solution set and of the array, then rows that are solutions, each once, and true", ONE_EXAMPLE, async () => {
    const lines = await printedOf("12-covering-array.ts");
    const rows = lines.slice(1, -1);
    expect(lines.at(-1)).toBe("true");
    expect(lines[0]).toBe(`${String(solutions.length)} ${String(rows.length)}`);
    expect(new Set(rows).size).toBe(rows.length);
    expect(rows.map(solutionShown)).toHaveLength(rows.length);
  });

  it("covers every pair of values some solution contains, in fewer rows than the solution set", ONE_EXAMPLE, async () => {
    const rows = (await printedOf("12-covering-array.ts")).slice(1, -1);
    const covered = new Set(rows.map(solutionShown).flatMap(pairsOf));
    expect(solutions.flatMap(pairsOf).every((pair) => covered.has(pair))).toBe(true);
    expect(rows.length).toBeLessThan(solutions.length);
  });
});
