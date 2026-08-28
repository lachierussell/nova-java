/**
 * A minimal stand-in for the parts of the Nova API the edit path touches, so
 * `applyTextEdits` and the formatting commands can be exercised outside the
 * editor. Only used by tests.
 */

class FakeRange {
  constructor(
    readonly start: number,
    readonly end: number,
  ) {}
  get length(): number {
    return this.end - this.start;
  }
}

/** Install the globals Nova provides ambiently. Call once per test file. */
export function installNovaGlobals(): void {
  (globalThis as Record<string, unknown>).Range = FakeRange;
}

export class FakeDocument {
  constructor(public text: string) {}

  get length(): number {
    return this.text.length;
  }

  getTextInRange(range: { start: number; end: number }): string {
    if (range.start < 0 || range.end > this.text.length) {
      // Nova throws on an out-of-bounds read; reproducing that keeps the fake
      // honest about the failure mode a mid-transaction re-read can hit.
      throw new RangeError(
        `Range ${range.start}..${range.end} is outside the document (length ${this.text.length})`,
      );
    }
    return this.text.slice(range.start, range.end);
  }
}

/**
 * An editor whose document mutates as each `replace` lands, matching Nova's
 * behaviour of applying a TextEditorEdit's changes in sequence.
 */
export class FakeEditor {
  readonly document: FakeDocument;
  tabLength = 4;
  softTabs = true;
  /** Every replace performed, in the order the editor received them. */
  readonly replacements: { start: number; end: number; newText: string }[] = [];

  constructor(text: string) {
    this.document = new FakeDocument(text);
  }

  get text(): string {
    return this.document.text;
  }

  async edit(
    callback: (edit: {
      replace: (range: { start: number; end: number }, text: string) => void;
    }) => void,
  ): Promise<void> {
    callback({
      replace: (range, text) => {
        const doc = this.document;
        if (range.start < 0 || range.end > doc.text.length || range.start > range.end) {
          throw new RangeError(
            `Cannot replace ${range.start}..${range.end} in a document of length ${doc.text.length}`,
          );
        }
        this.replacements.push({
          start: range.start,
          end: range.end,
          newText: text,
        });
        doc.text =
          doc.text.slice(0, range.start) + text + doc.text.slice(range.end);
      },
    });
  }
}

/** A language client that answers one request with a canned response. */
export class FakeClient {
  readonly requests: { method: string; params: unknown }[] = [];

  constructor(
    private readonly responder: (
      method: string,
      params: unknown,
    ) => unknown | Promise<unknown>,
  ) {}

  async sendRequest(method: string, params?: unknown): Promise<unknown> {
    this.requests.push({ method, params });
    return this.responder(method, params);
  }
}
