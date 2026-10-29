import type { Value } from "combinatrix";

import type { Row } from "./protocol";
import { describeValue } from "./reasons";

/** An element with text content and optionally a class. */
export function textElement<K extends keyof HTMLElementTagNameMap>(tag: K, content: string, className?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.textContent = content;
  if (className !== undefined) element.className = className;

  return element;
}

/** A value as the table writes it: unset in italics, so it is not mistaken for the text "unset", and everything else as JSON. */
function valueCell(value: Value): HTMLTableCellElement {
  const cell = document.createElement("td");
  if (value === undefined) cell.append(textElement("span", "unset", "unset"));
  else cell.textContent = describeValue(value);

  return cell;
}

/** A list of messages, one per item. */
export function messageList(messages: readonly string[], className: string): HTMLUListElement {
  const list = document.createElement("ul");
  list.className = "messages";
  for (const message of messages) list.append(textElement("li", message, className));

  return list;
}

/**
 * A table of combinations in a scrolling region, so a wide table scrolls inside the page rather than widening it. With `firstIndex` the first column numbers the rows from it, which is each combination's index when the rows are the start of the solution set.
 */
export function rowsTable(caption: string, names: readonly string[], rows: readonly Row[], firstIndex: number | undefined): HTMLElement {
  const table = document.createElement("table");
  table.append(textElement("caption", caption));

  const head = document.createElement("tr");
  const headings = [...(firstIndex === undefined ? [] : ["Index"]), ...names, "Id"];
  for (const heading of headings) {
    const cell = textElement("th", heading);
    cell.scope = "col";
    head.append(cell);
  }
  table.append(head);

  rows.forEach((row, position) => {
    const line = document.createElement("tr");
    if (firstIndex !== undefined) line.append(textElement("td", String(firstIndex + position)));
    for (const name of names) line.append(valueCell(row.values[name]));
    line.append(textElement("td", row.id, "id"));
    table.append(line);
  });

  const region = document.createElement("div");
  region.className = "table-scroll";
  region.tabIndex = 0;
  region.setAttribute("role", "region");
  region.setAttribute("aria-label", caption);
  region.append(table);

  return region;
}

/** "1 combination", "2 combinations". */
export function combinationsPhrase(count: number): string {
  return `${String(count)} combination${count === 1 ? "" : "s"}`;
}
