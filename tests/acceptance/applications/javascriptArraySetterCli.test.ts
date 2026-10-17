import { expect } from "vitest";

import { verifyJavaScriptReturnShapes } from "../../fixtures/javascriptReturnShapes.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const setter = "{ value: 1, set update(next) { this.value = next; } }";
const source = `
  export function assigned() {
    const state = { list: [${setter}] };
    state.list[0].update = 2;
    return { changed: state.list[0].value, kept: 7 };
  }
  export function nested() {
    const state = [[${setter}]];
    state[0][0].update = 2;
    return state[0][0].value;
  }
  export function spread() {
    const state = [...[${setter}]];
    state[0].update = 2;
    return state[0].value;
  }
  export function ordinary() {
    const state = [{ value: 1, update: 0 }];
    state[0].update = 2;
    return state[0].value;
  }
  export function unwritten() {
    const state = [${setter}];
    return state[0].value;
  }
  export function deleted() {
    const state = [${setter}];
    delete state[0].update;
    return state[0].value;
  }
  export function sibling() {
    const state = [{ value: 1 }, ${setter}];
    state[1].update = 2;
    return state[0].value;
  }
`;

cliTest(
  "preserves setter receiver uncertainty and ordinary literals through CLI and stdio MCP",
  ({ cli }) =>
    verifyJavaScriptReturnShapes(cli, source, (fields) => {
      expect(fields("assigned")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "/changed", state: "unknown" }),
          expect.objectContaining({
            path: "/kept",
            state: "literal",
            value: 7,
          }),
        ]),
      );
      for (const name of ["nested", "spread"])
        expect(fields(name), name).toContainEqual(
          expect.objectContaining({ path: "", state: "unknown" }),
        );
      for (const name of ["ordinary", "unwritten", "deleted", "sibling"])
        expect(fields(name), name).toContainEqual(
          expect.objectContaining({ path: "", state: "literal", value: 1 }),
        );
    }),
  120_000,
);
