import { describe, expect, it } from "vitest";

import type { History } from "./history";
import { emptyHistory, MAX_HISTORY, record, redo, undo } from "./history";

/** The state after three changes, and how many changes past the most the history keeps are made to show the oldest dropped. */
const LATEST = 3;
const OVERFLOW = 5;

/** The history after each change in turn, where a change is the state it left behind and its key. */
function after(changes: readonly (readonly [number, string | undefined])[]): History<number> {
  return changes.reduce((history, [previous, key]) => record(history, previous, key), emptyHistory<number>());
}

describe("history", () => {
  it("has nothing to undo or redo before anything changes", () => {
    expect(undo(emptyHistory<number>(), 0)).toBeUndefined();
    expect(redo(emptyHistory<number>(), 0)).toBeUndefined();
  });

  it("undoes to the state before the last change, and redoes to the one undone", () => {
    const history = after([[0, undefined], [1, undefined]]);

    const undone = undo(history, 2);
    expect(undone?.state).toBe(1);
    const again = undone === undefined ? undefined : undo(undone.history, undone.state);
    expect(again?.state).toBe(0);
    const redone = again === undefined ? undefined : redo(again.history, again.state);
    expect(redone?.state).toBe(1);
    const last = redone === undefined ? undefined : redo(redone.history, redone.state);
    expect(last?.state).toBe(2);
    expect(last === undefined ? undefined : redo(last.history, last.state)).toBeUndefined();
  });

  it("makes one step of a run of changes that share a key, undoing to the state before the first", () => {
    const history = after([[0, "title"], [1, "title"], [2, "title"]]);

    expect(history.past).toEqual([0]);
    expect(undo(history, LATEST)?.state).toBe(0);
  });

  it("makes a new step when the key changes, or comes back after another change", () => {
    expect(after([[0, "title"], [1, "description"]]).past).toEqual([0, 1]);
    expect(after([[0, "title"], [1, undefined], [2, "title"]]).past).toEqual([0, 1, 2]);
  });

  it("forgets what was undone when a new change is made, including one that adds no step", () => {
    const undone = undo(after([[0, undefined], [1, "title"]]), 2);
    if (undone === undefined) throw new Error("there is a change to undo");

    expect(record(undone.history, undone.state, undefined).future).toEqual([]);
    expect(record({ ...undone.history, lastKey: "title" }, undone.state, "title").future).toEqual([]);
  });

  it("does not merge a change into the step before it once that step was undone", () => {
    const undone = undo(after([[0, "title"]]), 1);
    if (undone === undefined) throw new Error("there is a change to undo");

    expect(record(undone.history, 0, "title").past).toEqual([0]);
  });

  it("keeps at most MAX_HISTORY states, dropping the oldest", () => {
    const history = after(Array.from({ length: MAX_HISTORY + OVERFLOW }, (_, state): readonly [number, string | undefined] => [state, undefined]));

    expect(history.past).toHaveLength(MAX_HISTORY);
    expect(history.past[0]).toBe(OVERFLOW);
  });
});
