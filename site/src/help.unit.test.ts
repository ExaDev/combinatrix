// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import indexHtml from "../index.html?raw";
import { fillHelp, HELP } from "./help";
import { keysOf } from "./exhaustive";

/** The page as served, with the descriptions filled in as the page does when it starts. */
function page(): Document {
  const document = new DOMParser().parseFromString(indexHtml, "text/html");
  fillHelp(document);

  return document;
}

/** The controls of an operation that a person can focus: buttons, fields and the fieldset of pickers, but not the menus the page draws into that fieldset later. */
function controlsOf(document: Document): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(".operation button, .operation input, .operation select:not(.pickers *), .operation fieldset")];
}

describe("operation descriptions", () => {
  it("has a non-empty paragraph on the page for every description, and a description for every paragraph", () => {
    const document = page();
    const paragraphs = [...document.querySelectorAll<HTMLElement>("[data-help]")];

    expect(paragraphs.map((paragraph) => String(paragraph.dataset["help"])).toSorted((left, right) => left.localeCompare(right))).toEqual(keysOf(HELP).toSorted((left, right) => left.localeCompare(right)));
    for (const paragraph of paragraphs) expect(paragraph.textContent.trim().length, `the paragraph for ${paragraph.dataset["help"] ?? ""}`).toBeGreaterThan(0);
  });

  it("names, on every control of an operation, a description that exists and is not empty", () => {
    const document = page();
    const controls = controlsOf(document);

    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      const names = (control.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((name) => name !== "");
      expect(names.length, `${control.id} names a description`).toBeGreaterThan(0);
      for (const name of names) expect((document.getElementById(name)?.textContent ?? "").trim().length, `${control.id} is described by #${name}`).toBeGreaterThan(0);
    }
  });

  it("puts each description inside the operation it describes, as a paragraph that is not hidden", () => {
    const document = page();

    for (const paragraph of document.querySelectorAll<HTMLElement>("[data-help]")) {
      expect(paragraph.closest(".operation"), `${paragraph.id} is in an operation`).not.toBeNull();
      expect(paragraph.tagName).toBe("P");
      expect(paragraph.closest("[hidden]")).toBeNull();
    }
  });

  it("explains the covering array and its strength in the plain words asked for", () => {
    expect(HELP.covering).toContain("short list of valid combinations");
    expect(HELP.covering).toContain("without listing them all");
    expect(HELP.covering).toContain("checked");
    expect(HELP.strength).toContain("How many options at a time must be covered together");
    expect(HELP.strength).toContain("1 means every single value");
    expect(HELP.strength).toContain("pairwise");
    expect(HELP.strength).toContain("default");
    expect(HELP.strength).toContain("3 means every triple");
    expect(HELP.strength).toContain("rules make impossible are not required");
  });

  it("is written in plain sentences: no spaced double hyphen, no dash, no doubled spaces, and each ends with a full stop", () => {
    for (const [key, text] of Object.entries(HELP)) {
      expect(text, key).not.toMatch(/ -- |—|–| {2}/);
      expect(text.endsWith("."), key).toBe(true);
    }
  });
});
