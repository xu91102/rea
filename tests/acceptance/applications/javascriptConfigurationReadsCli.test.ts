import { join } from "node:path";

import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

cliTest.for(["CLI", "stdio MCP"] as const)(
  "retains configuration sources consumed by member access through %s",
  async (surface, { cli, processes }) => {
    const root = await createTestTempDirectory("rea-config-reads-");
    await writeFixtureFiles(root, {
      "entry.mjs": [
        "const length = process.env.REA_ENDPOINT.length;",
        "const endpoint = process.env.REA_ENDPOINT;",
        "const argumentLength = process.argv[2].length;",
        "const mode = process.argv[3].trim();",
        "const optional = process.env.REA_MISSING?.length;",
        "function shadow(process) { return process.env.LOCAL.length + process.argv[2].length; }",
        'const local = { env: { FAKE: "fake" }, argv: [0, 1, "abc"] };',
        'const control = shadow({ env: { LOCAL: "local" }, argv: [0, 1, "abc"] });',
        "console.log(JSON.stringify([length, endpoint, argumentLength, mode, optional, control, local.env.FAKE.length]));",
      ].join("\n"),
    });
    const control = await processes.run(
      process.execPath,
      [join(root, "entry.mjs"), "abc", " mode "],
      { env: { REA_ENDPOINT: "endpoint" }, timeoutMs: 15_000 },
    );
    expect(control.exitCode, control.stderr).toBe(0);
    expect(JSON.parse(control.stdout)).toEqual([
      8,
      "endpoint",
      3,
      "mode",
      null,
      8,
      4,
    ]);
    const graph = (await analyzeJavaScriptDirectory(surface, cli, root))
      .semantic_graph;
    const sources = graph.nodes.filter((node) => node.kind === "config-source");
    expect(
      sources
        .map((node) => [node.properties.source_kind, node.properties.key])
        .sort(),
    ).toEqual([
      ["argv", "2"],
      ["argv", "3"],
      ["environment", "REA_ENDPOINT"],
      ["environment", "REA_ENDPOINT"],
      ["environment", "REA_MISSING"],
    ]);
    expect(sources.every((node) => node.properties.value === null)).toBe(true);
    const endpoint = graph.nodes.find(
      (node) => node.kind === "binding" && node.label === "endpoint",
    );
    expect(endpoint).toBeDefined();
    for (const source of sources) {
      const bindingTargets = graph.relations
        .filter((relation) => relation.source_node_id === source.node_id)
        .flatMap((relation) =>
          graph.nodes.filter(
            (node) =>
              node.node_id === relation.target_node_id &&
              node.kind === "binding",
          ),
        );
      expect(bindingTargets.map((node) => node.node_id)).toEqual(
        source.identity.source_range?.start.line === 2
          ? [endpoint?.node_id]
          : [],
      );
    }
  },
);

cliTest.for(["CLI", "stdio MCP"] as const)(
  "does not claim an argv value after an unknown object selection escapes through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-config-escape-");
    await writeFixtureFiles(root, {
      "entry.mjs": [
        'throw new Error("static fixture must never execute");',
        "export function run(key) { patch(process.argv[key]); return process.argv[3]; }",
        "export function independent() { return process.env.PORT; }",
      ].join("\n"),
    });
    const graph = (await analyzeJavaScriptDirectory(surface, cli, root))
      .semantic_graph;
    const reads = graph.nodes
      .filter((node) => node.kind === "config-source")
      .map((node) => [node.properties.source_kind, node.properties.key]);
    expect(reads).not.toContainEqual(["argv", "3"]);
    expect(reads).toContainEqual(["environment", "PORT"]);
  },
);

cliTest.for(["CLI", "stdio MCP"] as const)(
  "retains the graph with unknown overflowing configuration defaults through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-config-nonfinite-");
    await writeFixtureFiles(root, {
      "entry.mjs": [
        'throw new Error("static fixture must never execute");',
        "export const nullish = process.env.NULLISH ?? 1e400;",
        "export const or = process.env.OR || 1e400;",
        "export const finite = process.env.FINITE ?? 1e308;",
        "export const zero = process.env.ZERO || 0;",
        "export const disabled = process.env.DISABLED ?? false;",
        'export const empty = process.env.EMPTY ?? "";',
        "export const dynamic = process.env.DYNAMIC ?? Infinity;",
        'export function unrelated() { return "retained"; }',
      ].join("\n"),
    });
    const graph = (await analyzeJavaScriptDirectory(surface, cli, root))
      .semantic_graph;
    const defaults = graph.nodes.filter(
      (node) =>
        node.kind === "config-source" &&
        node.properties.source_kind === "default",
    );
    expect(
      defaults
        .map((node) => [node.properties.key, node.properties.value])
        .sort(),
    ).toEqual([
      ["DISABLED", false],
      ["DYNAMIC", null],
      ["EMPTY", ""],
      ["FINITE", 1e308],
      ["NULLISH", null],
      ["OR", null],
      ["ZERO", 0],
    ]);
    for (const node of defaults) {
      const edges = graph.relations.filter(
        (relation) =>
          relation.source_node_id === node.node_id &&
          relation.relation === "defaults",
      );
      expect(edges).toHaveLength(1);
      expect(edges[0]?.resolution).toBe(
        node.properties.value === null ? "candidate" : "resolved",
      );
      const source = graph.nodes.find(
        (candidate) =>
          candidate.kind === "config-source" &&
          candidate.properties.source_kind === "environment" &&
          candidate.properties.key === node.properties.key,
      );
      expect(source).toBeDefined();
      expect(graph.relations).toContainEqual(
        expect.objectContaining({
          source_node_id: source?.node_id,
          target_node_id: node.node_id,
          relation: "overrides",
          resolution: edges[0]?.resolution,
        }),
      );
    }
    expect(
      graph.nodes.some(
        (node) => node.kind === "function" && node.label === "unrelated",
      ),
    ).toBe(true);
    expect(
      graph.coverage.families.find(({ family }) => family === "configuration"),
    ).toMatchObject({ status: "partial" });
  },
);
