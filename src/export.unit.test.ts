import { describe, expect, it } from "vitest";

import { toActionsMatrix, toCsv, toJson } from "./export";
import type { ValueRecord } from "./value";

const NAMES = ["os", "node", "debug"];
const ROWS: readonly ValueRecord[] = [
  { os: "linux", node: 22, debug: true },
  { os: "windows", node: undefined, debug: false },
];

describe("toJson", () => {
  it("writes an object for each combination in the order of the names, and leaves out a dimension that is unset", () => {
    expect(JSON.parse(toJson(NAMES, ROWS))).toEqual([{ os: "linux", node: 22, debug: true }, { os: "windows", debug: false }]);
    expect(Object.keys((JSON.parse(toJson(["debug", "os"], ROWS)) as object[])[0] ?? {})).toEqual(["debug", "os"]);
  });

  it("is an empty array for no combinations", () => {
    expect(JSON.parse(toJson(NAMES, []))).toEqual([]);
  });
});

describe("toActionsMatrix", () => {
  it("is a matrix whose include entries are the combinations, so none is crossed with another", () => {
    expect(JSON.parse(toActionsMatrix(NAMES, ROWS))).toEqual({ include: [{ os: "linux", node: 22, debug: true }, { os: "windows", debug: false }] });
  });
});

describe("toCsv", () => {
  it("writes the names as a header and a line for each combination, with an empty field for an unset dimension", () => {
    expect(toCsv(NAMES, ROWS)).toBe("os,node,debug\r\nlinux,22,true\r\nwindows,,false\r\n");
  });

  it("quotes a field that holds a comma, a quote or a line break, and doubles its quotes", () => {
    const text = toCsv(["a"], [{ a: "x,y" }, { a: 'say "hi"' }, { a: "one\ntwo" }]);

    expect(text).toBe('a\r\n"x,y"\r\n"say ""hi"""\r\n"one\ntwo"\r\n');
  });

  it("quotes a name that needs it, and is only the header for no combinations", () => {
    expect(toCsv(["a,b"], [])).toBe('"a,b"\r\n');
  });
});
