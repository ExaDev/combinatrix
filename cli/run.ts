import { parseArgs } from "node:util";

import type { Model, ValueRecord } from "combinatrix";
import { collect, CombinatrixError, count, coveringArray, diagnose, LimitExceededError, ModelError, parseModel, toActionsMatrix, toCsv, toJson } from "combinatrix";

/** What the command line needs of the process around it, so that `run` can be tested without one. */
export interface Io {
  /** The text of the file at a path, or of standard input for `-`. Throws when it cannot be read. */
  readonly read: (path: string) => string;
  /** Writes to standard output, and to standard error. Each is given a whole line without its line break. */
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  /** The version of the package, which `--version` prints. */
  readonly version: string;
}

/** The process's exit codes: everything went as asked, the model or a limit refused the request, or the command line was misused. */
export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;
export const EXIT_USAGE = 2;

/** The pairwise strength, which `cover` builds when none is asked for: every pair of values that any valid combination contains. */
const DEFAULT_STRENGTH = 2;

/** The most combinations `list` prints when no limit is asked for. Past it a list is data to process more than to read, and a model with more combinations than that stops with a message naming the option that raises it, never a silently cut list. */
const DEFAULT_LIST_LIMIT = 1000;

const FORMATS = ["json", "csv", "matrix"] as const;
type Format = (typeof FORMATS)[number];

const WRITERS: Readonly<Record<Format, (names: readonly string[], rows: readonly ValueRecord[]) => string>> = { json: toJson, csv: toCsv, matrix: toActionsMatrix };

const USAGE = `Usage: combinatrix <command> <model.json | -> [options]

Reads a model written as JSON (the data form of combinatrix's model; "-" reads standard input) and answers questions about its valid combinations.

Commands:
  check   Validate the model and say what it defines, or every defect it has
  count   Print the number of valid combinations
  list    Print the valid combinations, in enumeration order
  cover   Print a covering array: valid combinations that together contain every pair of values
  dead    Print the values that no valid combination uses; exits 1 if there are any

Options:
  --limit <n>       list: the most combinations to print; a model with more is refused (default ${String(DEFAULT_LIST_LIMIT)})
  --strength <t>    cover: how many dimensions' values are covered together (default ${String(DEFAULT_STRENGTH)}, pairwise)
  --format <f>      list and cover: ${FORMATS.join(", ")}; matrix is the \`matrix\` of a GitHub Actions job (default json)
  --help            Print this text
  --version         Print the version

Exit status: 0 on success, 1 when the model or a limit refuses the request, 2 when the command line is wrong.`;

/** A mistake in the command line, reported with the usage hint. */
class UsageError extends Error {}

/** The whole number an option states, or a usage error naming the option. */
function integerOption(name: string, text: string | undefined, fallback: number): number {
  if (text === undefined) return fallback;

  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < 0 || text.trim() === "") throw new UsageError(`--${name} must be a whole number of at least 0, not "${text}"`);

  return value;
}

function formatOption(text: string | undefined): Format {
  if (text === undefined) return "json";

  const format = FORMATS.find((candidate) => candidate === text);
  if (format === undefined) throw new UsageError(`--format must be one of ${FORMATS.join(", ")}, not "${text}"`);

  return format;
}

/** The command and the model path the arguments name, and the options they set. */
function parse(args: readonly string[]) {
  try {
    const { values, positionals } = parseArgs({ args: [...args], allowPositionals: true, options: { limit: { type: "string" }, strength: { type: "string" }, format: { type: "string" }, help: { type: "boolean" }, version: { type: "boolean" } } });

    return { values, positionals };
  } catch (error) {
    if (error instanceof TypeError) throw new UsageError(error.message);

    throw error;
  }
}

/** The dimension names of a model, which head the columns of a CSV and order the keys of JSON. */
function namesOf(model: Model<ValueRecord>): string[] {
  return model.dimensions.map((dimension) => dimension.name);
}

/** A value as the output writes it: JSON, and `unset` for a dimension that has no value. */
function describeValue(value: unknown): string {
  return value === undefined ? "unset" : JSON.stringify(value);
}

/** Plural of a noun for a count: `1 rule`, `2 rules`. */
function counted(amount: number, noun: string): string {
  return `${String(amount)} ${noun}${amount === 1 ? "" : "s"}`;
}

/** Runs one command on a model and reports its outcome through `io`. */
function execute(command: string, model: Model<ValueRecord>, values: ReturnType<typeof parse>["values"], io: Io): number {
  switch (command) {
    case "check":
      io.out(`valid: ${counted(model.dimensions.length, "dimension")}, ${counted(model.rules.length, "rule")}`);

      return EXIT_OK;
    case "count":
      io.out(String(count(model)));

      return EXIT_OK;
    case "list": {
      const rows = collect(model, { limit: integerOption("limit", values.limit, DEFAULT_LIST_LIMIT) }).map((combination) => combination.values);
      io.out(WRITERS[formatOption(values.format)](namesOf(model), rows).trimEnd());

      return EXIT_OK;
    }
    case "cover": {
      const rows = collect(model, { strategy: coveringArray({ strength: integerOption("strength", values.strength, DEFAULT_STRENGTH) }) }).map((combination) => combination.values);
      io.out(WRITERS[formatOption(values.format)](namesOf(model), rows).trimEnd());

      return EXIT_OK;
    }
    case "dead": {
      const diagnosis = diagnose(model);
      if (diagnosis.status === "empty") {
        io.out("no combination satisfies the model, so every value is dead");

        return EXIT_FAILURE;
      }
      for (const { dimension, value } of diagnosis.deadValues) io.out(`${dimension} = ${describeValue(value)}`);
      if (diagnosis.deadValues.length === 0) io.out(`no dead values in ${counted(diagnosis.count, "combination")}`);

      return diagnosis.deadValues.length === 0 ? EXIT_OK : EXIT_FAILURE;
    }
    default:
      throw new UsageError(`unknown command "${command}"`);
  }
}

/**
 * Runs the command line `args` (without the program and script names) and returns the exit status. Everything it prints goes through `io`. A model or a limit that refuses the request is a failure of the request (status 1) and a mistake in the command line is a usage error (status 2); anything else is a defect and is thrown.
 */
export function run(args: readonly string[], io: Io): number {
  try {
    const { values, positionals } = parse(args);
    if (values.help === true) {
      io.out(USAGE);

      return EXIT_OK;
    }
    if (values.version === true) {
      io.out(io.version);

      return EXIT_OK;
    }

    const [command, path, ...extra] = positionals;
    if (command === undefined || path === undefined || extra.length > 0) throw new UsageError("expected a command and one model, as in: combinatrix count model.json");
    if (!["check", "count", "list", "cover", "dead"].includes(command)) throw new UsageError(`unknown command "${command}"`);

    let text: string;
    try {
      text = io.read(path);
    } catch (error) {
      if (error instanceof Error) {
        io.err(`combinatrix: cannot read ${path}: ${error.message}`);

        return EXIT_FAILURE;
      }

      throw error;
    }

    return execute(command, parseModel(JSON.parse(text)), values, io);
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(`combinatrix: ${error.message}`);
      io.err("Run combinatrix --help for the commands and options.");

      return EXIT_USAGE;
    }
    if (error instanceof ModelError) {
      io.err("combinatrix: the model is not valid:");
      for (const issue of error.issues) io.err(`  ${issue}`);

      return EXIT_FAILURE;
    }
    if (error instanceof SyntaxError || error instanceof LimitExceededError || error instanceof CombinatrixError || error instanceof RangeError) {
      io.err(`combinatrix: ${error.message}${error instanceof LimitExceededError && error.bound === "solution-set" ? " (raise it with --limit)" : ""}`);

      return EXIT_FAILURE;
    }

    throw error;
  }
}
