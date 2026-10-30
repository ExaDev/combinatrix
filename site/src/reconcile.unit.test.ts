import { describe, expect, it } from "vitest";

import { changesBetween, meet } from "./reconcile";
import type { JsonObject } from "./json";

const OS = { kind: "choice", name: "os", values: ["linux", "macos"] };
const ARCH = { kind: "choice", name: "arch", values: ["x64", "arm64"] };
const RULE = { name: "no arm", excludes: { kind: "textCompare", op: "equals", left: { kind: "reference", key: "arch" }, right: { kind: "textLiteral", value: "arm64" } } };

const FOO: JsonObject = { id: "foo", title: "Builds", dimensions: [OS, ARCH], rules: [RULE] };

const text = (model: JsonObject): string => JSON.stringify(model, null, 2);
const noSaved = (): undefined => undefined;

describe("meet", () => {
  it("finds nothing to choose when the incoming model has no id, is not a model, or no copy here has its id", () => {
    expect(meet(text({ dimensions: [OS] }), text(FOO), noSaved)).toBeUndefined();
    expect(meet("not json", text(FOO), noSaved)).toBeUndefined();
    expect(meet(text({ ...FOO, id: "bar" }), text(FOO), noSaved)).toBeUndefined();
    expect(meet(text(FOO), "", noSaved)).toBeUndefined();
  });

  it("finds nothing to choose when the copy here has the same content, whatever the order of keys or the schema it names", () => {
    const reordered: JsonObject = { rules: [RULE], dimensions: [OS, ARCH], title: "Builds", id: "foo", $schema: "https://example.com/other.json" };

    expect(meet(text(reordered), text(FOO), noSaved)).toBeUndefined();
    expect(meet(text(FOO), "", () => text(reordered))).toBeUndefined();
  });

  it("is a clash when the copy in the editor has the id and different content, and names the editor as the copy here", () => {
    const theirs = { ...FOO, title: "Builds, edited" };

    const clash = meet(text(theirs), text(FOO), noSaved);

    expect(clash?.source).toBe("editor");
    expect(clash?.mine).toBe(text(FOO));
    expect(clash?.changes).toEqual(['title is "Builds" in mine and "Builds, edited" in theirs']);
  });

  it("compares the saved copy when the editor holds another model", () => {
    const theirs = { ...FOO, rules: [] };

    const clash = meet(text(theirs), text({ id: "other", dimensions: [] }), (id) => (id === "foo" ? text(FOO) : undefined));

    expect(clash?.source).toBe("saved");
    expect(clash?.mine).toBe(text(FOO));
    expect(clash?.changes).toEqual(['rule "no arm" is only in mine']);
  });

  it("prefers the editor's copy to the saved one, since it is what loading the incoming model would replace", () => {
    const inEditor = { ...FOO, description: "unsaved edit" };

    const clash = meet(text({ ...FOO, title: "theirs" }), text(inEditor), () => text(FOO));

    expect(clash?.source).toBe("editor");
  });

  it("does not take a saved text that is not a model for a copy", () => {
    expect(meet(text(FOO), "", () => "not json")).toBeUndefined();
  });
});

describe("changesBetween", () => {
  it("is empty for the same model", () => {
    expect(changesBetween(FOO, { ...FOO })).toEqual([]);
  });

  it("reports a detail that is only on one side, and one that differs without being text", () => {
    expect(changesBetween({ dimensions: [] }, { description: "d", dimensions: [] })).toEqual(["description is only in theirs"]);
    expect(changesBetween({ title: "t", dimensions: [] }, { dimensions: [] })).toEqual(["title is only in mine"]);
    expect(changesBetween({ note: 1, dimensions: [] }, { note: 2, dimensions: [] })).toEqual(["note differs"]);
  });

  it("reports a dimension added by one side and removed by the other, by name", () => {
    expect(changesBetween({ ...FOO, dimensions: [OS] }, FOO)).toEqual(['dimension "arch" is only in theirs']);
    expect(changesBetween(FOO, { ...FOO, dimensions: [OS] })).toEqual(['dimension "arch" is only in mine']);
  });

  it("reports a changed dimension as that dimension differing, and says in what", () => {
    const widened = { ...OS, values: ["linux", "macos", "windows"] };

    expect(changesBetween(FOO, { ...FOO, dimensions: [widened, ARCH] })).toEqual(['dimension "os" differs in values']);
  });

  it("reports dimensions in another order", () => {
    expect(changesBetween(FOO, { ...FOO, dimensions: [ARCH, OS] })).toEqual(["the dimensions are in a different order"]);
  });

  it("reports rules in another order, and items without a name in another order, so a clash always says something", () => {
    const another = { name: "another", requires: { kind: "booleanLiteral", value: true } };
    const first = { requires: { kind: "booleanLiteral", value: true } };
    const second = { excludes: { kind: "booleanLiteral", value: false } };

    expect(changesBetween({ ...FOO, rules: [RULE, another] }, { ...FOO, rules: [another, RULE] })).toEqual(["the rules are in a different order"]);
    expect(changesBetween({ ...FOO, rules: [first, second] }, { ...FOO, rules: [second, first] })).toEqual(["the items are in a different order"]);
  });

  it("reports a changed rule by its label, and an added rule", () => {
    const changed = { ...RULE, when: { kind: "booleanLiteral", value: true } };
    const added = { name: "another", requires: { kind: "booleanLiteral", value: true } };

    expect(changesBetween(FOO, { ...FOO, rules: [changed, added] })).toEqual(['rule "no arm" differs in when', 'rule "another" is only in theirs']);
  });

  it("matches rules without a label by content, and counts the ones left over", () => {
    const first = { requires: { kind: "booleanLiteral", value: true } };
    const second = { excludes: { kind: "booleanLiteral", value: false } };

    expect(changesBetween({ ...FOO, rules: [first, second] }, { ...FOO, rules: [first] })).toEqual(["1 unnamed rule only in mine"]);
    expect(changesBetween({ ...FOO, rules: [first] }, { ...FOO, rules: [first, second, second] })).toEqual(["2 unnamed rules only in theirs"]);
  });

  it("does not report the schema a model names", () => {
    expect(changesBetween({ ...FOO, $schema: "a" }, { ...FOO, $schema: "b" })).toEqual([]);
  });
});
