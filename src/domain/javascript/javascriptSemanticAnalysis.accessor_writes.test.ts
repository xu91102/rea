import { expect, it } from "vitest";

import { analyzeJavaScriptSemantics } from "./javascriptSemanticAnalysis.js";

const returned = (source: string) => {
  const ir = analyzeJavaScriptSemantics(source);
  const callable = ir.callables.find(({ name }) => name === "observe");
  return callable?.returnSites[0]?.value;
};

it("keeps members unknown after a write through a local setter", () => {
  // The setter runs on assignment and may replace any member of `this`.
  expect(
    returned(`
      export function observe() {
        const state = { value: 1, set update(next) { this.value = next; } };
        state.update = 2;
        return state;
      }
    `),
  ).toMatchObject({ status: "unknown" });
});

it("keeps sibling literals when the written key is an ordinary property", () => {
  expect(
    returned(`
      export function observe() {
        const state = { value: 1, update: 0 };
        state.update = 2;
        return state;
      }
    `),
  ).toMatchObject({
    status: "object",
    properties: expect.arrayContaining([
      expect.objectContaining({
        name: "value",
        value: { status: "literal", value: 1 },
      }),
    ]),
  });
});

it("keeps nested members unknown after a write through a nested setter", () => {
  const value = returned(`
    export function observe() {
      const state = {
        label: "kept",
        nested: { value: 1, set update(next) { this.value = next; } },
      };
      state.nested.update = 2;
      return state;
    }
  `);
  expect(value).toMatchObject({
    status: "object",
    properties: expect.arrayContaining([
      expect.objectContaining({
        name: "label",
        value: { status: "literal", value: "kept" },
      }),
      expect.objectContaining({
        name: "nested",
        value: expect.objectContaining({ status: "unknown" }),
      }),
    ]),
  });
});

it("keeps sibling literals when an accessor is deleted rather than assigned", () => {
  expect(
    returned(`
      export function observe() {
        const state = { value: 1, set update(next) {} };
        delete state.update;
        return state;
      }
    `),
  ).toMatchObject({
    status: "object",
    properties: expect.arrayContaining([
      expect.objectContaining({
        name: "value",
        value: { status: "literal", value: 1 },
      }),
    ]),
  });
});

it("keeps sibling literals when a later data property replaces the setter", () => {
  expect(
    returned(`
      export function observe() {
        const state = { value: 1, set update(next) {}, update: 0 };
        state.update = 2;
        return state;
      }
    `),
  ).toMatchObject({
    status: "object",
    properties: expect.arrayContaining([
      expect.objectContaining({
        name: "value",
        value: { status: "literal", value: 1 },
      }),
    ]),
  });
});

it("invalidates a setter receiver selected through an array element", () => {
  expect(
    returned(`
      export function observe() {
        const state = { list: [{ value: 1, set update(next) { this.value = next; } }] };
        state.list[0].update = 2;
        return state.list[0].value;
      }
    `),
  ).toMatchObject({ status: "unknown" });
});

const setter = "{ value: 1, set update(next) { this.value = next; } }";

it.each([
  ["root array", `[${setter}]`, "state[0].update = 2;", "state[0].value"],
  [
    "quoted index",
    `{ list: [${setter}] }`,
    'state.list["0"].update = 2;',
    "state.list[0].value",
  ],
  [
    "nested arrays",
    `[[${setter}]]`,
    "state[0][0].update = 2;",
    "state[0][0].value",
  ],
  ["array hole", `[, ${setter}]`, "state[1].update = 2;", "state[1].value"],
  [
    "literal spread",
    `[...[${setter}]]`,
    "state[0].update = 2;",
    "state[0].value",
  ],
  [
    "uncertain preceding spread",
    `[...prefix, ${setter}]`,
    "state[1].update = 2;",
    "state[1].value",
  ],
  [
    "following spread",
    `[${setter}, ...prefix]`,
    "state[0].update = 2;",
    "state[0].value",
  ],
])(
  "invalidates the selected setter through %s",
  (_label, initial, write, read) => {
    expect(
      returned(
        `export function observe(prefix) { const state = ${initial}; ${write} return ${read}; }`,
      ),
    ).toMatchObject({ status: "unknown" });
  },
);

it.each([
  [
    "ordinary selected element",
    "[{ value: 1, update: 0 }]",
    "state[0].update = 2;",
    "state[0].value",
  ],
  ["unwritten accessor", `[${setter}]`, "", "state[0].value"],
  [
    "deleted accessor",
    `[${setter}]`,
    "delete state[0].update;",
    "state[0].value",
  ],
  [
    "replaced accessor",
    "[{ value: 1, set update(next) {}, update: 0 }]",
    "state[0].update = 2;",
    "state[0].value",
  ],
  [
    "different element",
    `[${setter}, { value: 1, update: 0 }]`,
    "state[1].update = 2;",
    "state[1].value",
  ],
  [
    "sibling of written setter",
    `[{ value: 1, update: 0 }, ${setter}]`,
    "state[1].update = 2;",
    "state[0].value",
  ],
  [
    "exact prefix before spread",
    `[{ value: 1, update: 0 }, ...prefix, ${setter}]`,
    "state[0].update = 2;",
    "state[0].value",
  ],
])("keeps the exact literal for %s", (_label, initial, write, read) => {
  expect(
    returned(
      `export function observe(prefix) { const state = ${initial}; ${write} return ${read}; }`,
    ),
  ).toMatchObject({ status: "literal", value: 1 });
});

it("handles a large uncertain array selection without exhausting call arguments", () => {
  expect(
    returned(`
      export function observe(prefix) {
        const state = [...prefix, ${"0,".repeat(500_000)}{ value: 1, update: 0 }];
        state[500000].update = 2;
        return state[500000].value;
      }
    `),
  ).toMatchObject({ status: "unknown" });
});
