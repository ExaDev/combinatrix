import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

import type { Json, JsonObject, JsonStep } from '../site/src/json';
import { getIn, isJsonObject, parseJson } from '../site/src/json';

/** The most a check of the model, or an operation on it, may take to show its result, in milliseconds. It bounds a hang: the page's own work is counted in combinations, and the models here are small. */
export const RESULT_TIMEOUT_MS = 20_000;

/** The model of the page's first example, which the page starts on: two rules' worth of structure over three dimensions. */
export const STARTING_EXAMPLE = 'A rule: bun is not offered on Windows';

/** How much of an unnamed control's markup is put in a failure message, so the control can be found. */
const REPORTED_HTML_LENGTH = 80;

/** A text node of a rule's tree, as the form writes it. */
export function textLiteral(value: string): JsonObject {
  return { kind: 'textLiteral', value };
}

/** A reference to a dimension, as the form writes it. */
export function reference(key: string): JsonObject {
  return { kind: 'reference', key };
}

/** The comparison of a dimension with a text. */
export function textEquals(key: string, value: string): JsonObject {
  return { kind: 'textCompare', op: 'equals', left: reference(key), right: textLiteral(value) };
}

/** Runs an action on each item, one after the other: the page is one stateful thing, so the steps of a test cannot overlap. */
export async function inOrder<T>(items: readonly T[], action: (item: T) => Promise<void>): Promise<void> {
  await items.reduce(async (previous, item) => {
    await previous;
    await action(item);
  }, Promise.resolve());
}

/** The addresses of the requests a page makes outside the origin of the base address, as the page makes them: the explorer is meant to make none besides the page's own files, the optional gist fetch aside. The list is filled as the page runs. */
export function trackExternalRequests(page: Page, baseURL: string | undefined): string[] {
  const origin = new URL(String(baseURL)).host;
  const outside: string[] = [];
  page.on('request', (request) => {
    const { protocol, host } = new URL(request.url());
    if (protocol !== 'data:' && protocol !== 'blob:' && host !== origin) outside.push(request.url());
  });

  return outside;
}

/** What the tests know of the explorer's page: its controls by the field id the form gives each, and the few things every test starts with. */
export class Explorer {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /** Opens the page, at a path under its base address, and waits for the model it starts on to be checked. */
  static async open(page: Page, path = ''): Promise<Explorer> {
    const explorer = new Explorer(page);
    await page.goto(path);
    await explorer.ready();

    return explorer;
  }

  /** The control with a field id: every control of the form has one, the same on every draw. */
  field(id: string): Locator {
    return this.page.locator(`[data-field=${JSON.stringify(id)}]`);
  }

  /** The element with an id. */
  id(id: string): Locator {
    return this.page.locator(`#${id}`);
  }

  /** Waits until the model in the editor has been checked and found valid. */
  async ready(): Promise<void> {
    await expect(this.page.locator('#validation .valid')).toBeVisible({ timeout: RESULT_TIMEOUT_MS });
  }

  /** The Advanced view, opened if it is closed. */
  async advanced(): Promise<Locator> {
    const open = await this.id('advanced').evaluate((element) => element instanceof HTMLDetailsElement && element.open);
    if (!open) await this.page.locator('#advanced summary').click();

    return this.id('model');
  }

  /** Replaces the model's JSON text, as typing it would, and waits for it to be checked and found valid unless the caller expects it not to be. */
  async setJson(model: Json, options: { readonly expectValid?: boolean } = {}): Promise<void> {
    const editor = await this.advanced();
    await editor.fill(typeof model === 'string' ? model : JSON.stringify(model));
    if (options.expectValid !== false) await this.ready();
  }

  /** Replaces the JSON text with text that need not be JSON. */
  async setText(text: string): Promise<void> {
    const editor = await this.advanced();
    await editor.fill(text);
  }

  /** The model the JSON view holds, parsed. */
  async json(): Promise<JsonObject> {
    const editor = await this.advanced();
    const parsed = parseJson(await editor.inputValue());
    if (!isJsonObject(parsed)) throw new Error('the JSON view does not hold an object');

    return parsed;
  }

  /** The value at a path of the model the JSON view holds. */
  async at(path: readonly JsonStep[]): Promise<Json | undefined> {
    return getIn(await this.json(), path);
  }

  /** Loads an example from the menu, and waits for it to be valid. */
  async loadExample(name: string): Promise<void> {
    await this.id('example').selectOption({ label: name });
    await this.ready();
  }

  /** The text of an operation's result. */
  result(id: 'count' | 'list' | 'diagnose' | 'covering' | 'combination'): Locator {
    return this.id(`${id}-result`);
  }

  /** Runs an operation by its button. */
  async run(button: 'count' | 'list' | 'diagnose' | 'covering' | 'at' | 'explain'): Promise<void> {
    await this.id(button).click();
  }

  /** Sets a number field. */
  async setNumber(id: 'list-limit' | 'strength' | 'index', value: number): Promise<void> {
    await this.id(id).fill(String(value));
  }

  /** The cards of the form's dimensions, or of its rules. */
  cards(part: 'dimensions' | 'rules'): Locator {
    return this.page.locator(`#${part}-heading`).locator('..').locator('li.card');
  }

  /** The accessible names of the controls of the form, which must be given to each. */
  async unnamedControls(): Promise<string[]> {
    return this.page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('#form button, #form input, #form select, #form textarea')]
        .filter((element) => {
          const labelled = element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement ? (element.labels?.length ?? 0) > 0 : false;

          return !labelled && element.getAttribute('aria-label') === null && element.textContent.trim() === '';
        })
        .map((element) => element.dataset['field'] ?? element.outerHTML.slice(0, REPORTED_HTML_LENGTH)),
    );
  }

  /** The field id of the control that has focus, or the empty text when none has one. */
  async focused(): Promise<string> {
    return this.page.evaluate(() => document.activeElement?.getAttribute('data-field') ?? '');
  }

  /** Presses Tab until the control with a field id has focus, as a keyboard-only user would. It gives up after a full turn of the page's focusable controls, which is as many presses as there are controls. */
  async tabTo(id: string): Promise<void> {
    const controls = await this.page.locator('button, input, select, textarea, summary, a[href]').count();
    await this.tabToWithin(id, controls);
  }

  private async tabToWithin(id: string, presses: number): Promise<void> {
    if ((await this.focused()) === id) return;
    if (presses === 0) throw new Error(`Tab never reached ${id}; focus is on ${await this.focused()}`);

    await this.page.keyboard.press('Tab');
    await this.tabToWithin(id, presses - 1);
  }
}
