import { once } from "node:events";
import { join } from "node:path";

import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { waitForExit } from "../../support/process/processFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

cliTest.for(["CLI", "stdio MCP"] as const)(
  "keeps dynamic child signals unknown through %s",
  async (surface, { cli, processes }) => {
    const root = await createTestTempDirectory("rea-child-signals-");
    await writeFixtureFiles(root, {
      "app/entry.mjs": [
        'import { spawn } from "node:child_process";',
        "const selected = process.env.REA_SIGNAL;",
        'const dynamic = spawn("dynamic", []); dynamic.kill(selected);',
        'const omitted = spawn("omitted", []); omitted.kill();',
        'const literal = spawn("literal", []); literal.kill("SIGINT");',
        'let ambiguous = spawn("ambiguous-a", []); ambiguous = spawn("ambiguous-b", []); ambiguous.kill("SIGINT");',
        'const explicit = spawn("explicit", []); explicit.kill(undefined);',
        'function stop(undefined) { const child = spawn("shadowed", []); child.kill(undefined); } stop("SIGINT");',
      ].join("\n"),
      "child.cjs": 'console.log("ready"); setInterval(() => {}, 1000);',
    });
    const signals: (NodeJS.Signals | null)[] = [];
    for (const kind of ["dynamic", "omitted", "explicit"]) {
      const child = processes.spawn(process.execPath, [
        join(root, "child.cjs"),
      ]);
      await once(child.stdout, "data", { signal: AbortSignal.timeout(5_000) });
      if (kind === "omitted") child.kill();
      else child.kill(kind === "dynamic" ? "SIGINT" : undefined);
      expect(await waitForExit(child, 5_000)).toBe(true);
      signals.push(child.signalCode);
    }
    expect(signals).toEqual(["SIGINT", "SIGTERM", "SIGTERM"]);
    const graph = (
      await analyzeJavaScriptDirectory(surface, cli, join(root, "app"))
    ).semantic_graph;
    const children = graph.nodes.filter(
      (node) => node.kind === "child-process",
    );
    expect(children).toHaveLength(7);
    for (const [command, name, resolution] of [
      ["dynamic", null, "candidate"],
      ["shadowed", null, "candidate"],
      ["omitted", "SIGTERM", "resolved"],
      ["explicit", "SIGTERM", "resolved"],
      ["literal", "SIGINT", "resolved"],
      ["ambiguous-b", "SIGINT", "candidate"],
    ] as const) {
      const child = children.find(
        (node) => node.properties.command === command,
      );
      const relation = graph.relations.find(
        (value) =>
          value.relation === "forwards-signal" &&
          value.target_node_id === child?.node_id,
      );
      const signal = graph.nodes.find(
        (node) => node.node_id === relation?.source_node_id,
      );
      expect(signal?.properties.signal_name, command).toBe(name);
      expect(relation?.resolution, command).toBe(resolution);
      if (resolution === "candidate") {
        const unknown = graph.unknowns.find(
          (value) => value.node_id === signal?.node_id,
        );
        expect(unknown?.reason, command).toBe(
          name === null ? "unknown-value" : "ambiguous-target",
        );
        const candidates =
          command === "ambiguous-b"
            ? ["ambiguous-a", "ambiguous-b"].map(
                (name) =>
                  children.find((node) => node.properties.command === name)
                    ?.node_id,
              )
            : [child?.node_id];
        expect(new Set(unknown?.candidate_node_ids), command).toEqual(
          new Set(candidates),
        );
        expect(unknown?.evidence.location.available, command).toBe(true);
      }
    }
  },
);
