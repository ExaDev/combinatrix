import type { Scalar, ValueRecord } from "./value";

/** The rows as JSON objects, one per combination, with the dimensions in the model's order. An unset dimension has no key, since JSON has no `undefined`. */
function objectsOf(names: readonly string[], rows: readonly ValueRecord[]): Record<string, Scalar>[] {
  return rows.map((row) =>
    Object.fromEntries(
      names.flatMap((name) => {
        const value = row[name];

        return value === undefined ? [] : [[name, value]];
      }),
    ),
  );
}

/** The combinations as a JSON array of objects, one for each combination with its dimensions in the order of `names`. A dimension that is unset has no key, since JSON has no `undefined`. */
export function toJson(names: readonly string[], rows: readonly ValueRecord[]): string {
  return JSON.stringify(objectsOf(names, rows), null, 2);
}

/** The combinations as the `matrix` of a GitHub Actions job: every row an `include` entry, so each is run as it is and none is crossed with another. A dimension that is unset has no key. */
export function toActionsMatrix(names: readonly string[], rows: readonly ValueRecord[]): string {
  return JSON.stringify({ include: objectsOf(names, rows) }, null, 2);
}

/** A field as RFC 4180 writes it: in quotes, with its quotes doubled, when it holds a comma, a quote or a line break. */
function csvField(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** The combinations as CSV (RFC 4180): a header of the dimension names in the order of `names` and a line for each combination. An unset dimension is an empty field. Every value is written as text, so a CSV reader cannot tell the text "1" from the number 1, or the text "null" from null. */
export function toCsv(names: readonly string[], rows: readonly ValueRecord[]): string {
  const lines = [names, ...rows.map((row) => names.map((name) => (row[name] === undefined ? "" : String(row[name]))))];

  return `${lines.map((line) => line.map(csvField).join(",")).join("\r\n")}\r\n`;
}
