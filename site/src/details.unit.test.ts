// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { Harness } from "./formHarness";

let harness: Harness | undefined;

afterEach(() => {
  harness?.destroy();
  harness = undefined;
});

function drawn(model: ConstructorParameters<typeof Harness>[0]): Harness {
  harness = new Harness(model);

  return harness;
}

describe("the details of a model in the form", () => {
  it("shows the title and description, and writes them in front of the definition", () => {
    const form = drawn({ dimensions: [] });

    form.type("title:text", "Builds");
    form.type("description:text", "Where it builds.");

    expect(form.model).toEqual({ title: "Builds", description: "Where it builds.", dimensions: [] });
    expect(Object.keys(form.model)).toEqual(["title", "description", "dimensions"]);
  });

  it("removes a detail that is cleared, and keeps the rest of the model", () => {
    const form = drawn({ $schema: "s", title: "Builds", dimensions: [], note: "kept" });

    form.type("title:text", "");

    expect(form.model).toEqual({ $schema: "s", dimensions: [], note: "kept" });
  });

  it("shows the title a model has", () => {
    const form = drawn({ title: "Builds", dimensions: [] });

    const field = form.field("title:text");

    expect(field instanceof HTMLInputElement && field.value).toBe("Builds");
  });

  it("shows the id a model has, as text that cannot be edited, and says when it has none", () => {
    expect(drawn({ id: "foo", dimensions: [] }).container.querySelector("code")?.textContent).toBe("foo");
    expect(drawn({ id: "foo", dimensions: [] }).fields()).not.toContain("id:text");
    harness?.destroy();
    expect(drawn({ dimensions: [] }).container.textContent).toContain("The model has no id yet");
  });
});
