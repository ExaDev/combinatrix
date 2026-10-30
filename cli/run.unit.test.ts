import { describe, expect, it } from "vitest";

import type { Io } from "./run";
import { EXIT_FAILURE, EXIT_OK, EXIT_USAGE, run } from "./run";

/** A model of an operating system and an architecture, where arm64 is not offered on windows. */
const MODEL = JSON.stringify({
  dimensions: [
    { kind: "choice", name: "os", values: ["linux", "macos", "windows"] },
    { kind: "choice", name: "arch", values: ["x64", "arm64"] },
  ],
  rules: [
    {
      name: "no arm64 on windows",
      excludes: { kind: "textCompare", op: "equals", left: { kind: "reference", key: "arch" }, right: { kind: "textLiteral", value: "arm64" } },
      when: { kind: "textCompare", op: "equals", left: { kind: "reference", key: "os" }, right: { kind: "textLiteral", value: "windows" } },
    },
  ],
});

/** The combinations of that model, and the pairwise rows that cover it. */
const COMBINATIONS = 5;

/** A model in which a value is dead: no combination can have arm64 at all. */
const DEAD_MODEL = JSON.stringify({
  dimensions: [{ kind: "choice", name: "arch", values: ["x64", "arm64"] }],
  rules: [{ excludes: { kind: "textCompare", op: "equals", left: { kind: "reference", key: "arch" }, right: { kind: "textLiteral", value: "arm64" } } }],
});

/** The command line run against files held in a map, with everything it prints kept. */
function runWith(args: readonly string[], files: Readonly<Record<string, string>> = { "model.json": MODEL, "-": MODEL }) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = {
    read: (path) => {
      const text = files[path];
      if (text === undefined) throw new Error("no such file");

      return text;
    },
    out: (line) => void out.push(line),
    err: (line) => void err.push(line),
    version: "9.8.7",
  };

  return { status: run(args, io), out, err };
}

describe("run", () => {
  it("counts the valid combinations", () => {
    expect(runWith(["count", "model.json"])).toEqual({ status: EXIT_OK, out: [String(COMBINATIONS)], err: [] });
  });

  it("reads the model from standard input for -", () => {
    expect(runWith(["count", "-"]).out).toEqual([String(COMBINATIONS)]);
  });

  it("checks a model and says what it defines", () => {
    expect(runWith(["check", "model.json"]).out).toEqual(["valid: 2 dimensions, 1 rule"]);
  });

  it("lists the combinations as JSON by default, in enumeration order, and as CSV or a matrix when asked", () => {
    const json: unknown = JSON.parse(runWith(["list", "model.json"]).out.join("\n"));
    expect(Array.isArray(json) && json.length).toBe(COMBINATIONS);
    expect(Array.isArray(json) && json[0]).toEqual({ os: "linux", arch: "x64" });
    expect(runWith(["list", "model.json", "--format", "csv"]).out.join("\n").split("\r\n")).toEqual(["os,arch", "linux,x64", "linux,arm64", "macos,x64", "macos,arm64", "windows,x64"]);
    const matrix: unknown = JSON.parse(runWith(["list", "model.json", "--format", "matrix"]).out.join("\n"));
    expect(matrix).toEqual({ include: json });
  });

  it("refuses a list longer than the limit, naming the option that raises it", () => {
    const { status, out, err } = runWith(["list", "model.json", "--limit", "2"]);

    expect(status).toBe(EXIT_FAILURE);
    expect(out).toEqual([]);
    expect(err.join("\n")).toContain("--limit");
  });

  it("builds a covering array whose rows are valid combinations, with a strength when asked", () => {
    const pairwise = JSON.parse(runWith(["cover", "model.json"]).out.join("\n")) as readonly { os: string; arch: string }[];
    const everyValue = JSON.parse(runWith(["cover", "model.json", "--strength", "1"]).out.join("\n")) as readonly unknown[];

    expect(pairwise.length).toBeLessThanOrEqual(COMBINATIONS);
    expect(pairwise.some((row) => row.os === "windows" && row.arch === "arm64")).toBe(false);
    expect(everyValue.length).toBeLessThanOrEqual(pairwise.length);
  });

  it("reports the values no combination uses and exits 1, and exits 0 when there are none", () => {
    expect(runWith(["dead", "model.json"]).status).toBe(EXIT_OK);
    const dead = runWith(["dead", "model.json"], { "model.json": DEAD_MODEL });

    expect(dead.status).toBe(EXIT_FAILURE);
    expect(dead.out).toEqual(['arch = "arm64"']);
  });

  it("lists every defect of a model that is not valid, and exits 1", () => {
    const { status, err } = runWith(["check", "model.json"], { "model.json": JSON.stringify({ dimensions: [{ kind: "choice", name: "a", values: [] }, { kind: "choice", name: "a", values: ["x"] }] }) });

    expect(status).toBe(EXIT_FAILURE);
    expect(err[0]).toBe("combinatrix: the model is not valid:");
    expect(err.length).toBeGreaterThan(1);
  });

  it("says when the text is not JSON or the file cannot be read, and exits 1", () => {
    expect(runWith(["count", "model.json"], { "model.json": "{" }).status).toBe(EXIT_FAILURE);
    const missing = runWith(["count", "missing.json"]);

    expect(missing.status).toBe(EXIT_FAILURE);
    expect(missing.err).toEqual(["combinatrix: cannot read missing.json: no such file"]);
  });

  it("prints the usage for --help and the version for --version", () => {
    expect(runWith(["--help"]).out.join("\n")).toContain("Usage: combinatrix <command>");
    expect(runWith(["--version"])).toEqual({ status: EXIT_OK, out: ["9.8.7"], err: [] });
  });

  it.each([[[]], [["count"]], [["count", "a", "b"]], [["nope", "model.json"]], [["count", "model.json", "--bogus"]], [["list", "model.json", "--limit", "x"]], [["list", "model.json", "--limit", "-1"]], [["list", "model.json", "--limit", ""]], [["list", "model.json", "--format", "xml"]], [["cover", "model.json", "--strength", "0.5"]]])("is a usage error for %j", (args) => {
    const { status, out, err } = runWith(args);

    expect(status).toBe(EXIT_USAGE);
    expect(out).toEqual([]);
    expect(err.at(-1)).toBe("Run combinatrix --help for the commands and options.");
  });
});
