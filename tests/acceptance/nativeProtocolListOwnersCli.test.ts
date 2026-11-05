import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { toolContract } from "../../src/contracts/toolContracts.js";
import { parseEvidence } from "../../src/domain/evidence.js";
import { objcAdoptedProtocolsMacho } from "../fixtures/objcAdoptedProtocolsMacho.js";
import { connectLocalToolsMcp } from "../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest } from "../support/cli/cliFixture.js";

cliTest.skipIf(process.platform !== "darwin")(
  "retains independent class and metaclass facts beside an oversized adopted list through CLI and MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-protocol-list-owners-");
    const target = join(root, "class.macho");
    const bytes = objcAdoptedProtocolsMacho("class", 20001n);
    await writeFile(target, bytes);
    const environment = {
      PATH: process.env.PATH ?? "",
      REA_ANALYSIS_PROVIDER: "auto",
      HOPPER_LAUNCHER_PATH: "/rea-unconfigured-deep-provider/hopper",
      GHIDRA_INSTALL_DIR: "/rea-unconfigured-deep-provider/ghidra",
      JAVA_HOME: "/rea-unconfigured-deep-provider/java",
      REA_IDA_MCP_CONFIG: "/rea-unconfigured-deep-provider/ida-mcp.json",
      REA_KUNA_COMMAND: "/rea-unconfigured-deep-provider/kuna",
      REA_KUNA_CACHE_DIR: "/rea-unconfigured-deep-provider/kuna-cache",
      REA_LOG_LEVEL: "silent",
    };
    const response = await cli.run({
      arguments: ["inspect-native-dispatch-metadata", target, "--json"],
      environment,
    });
    expect(response.exitCode, response.stderr).toBe(0);
    const cliEvidence = toolContract(
      "inspect_native_dispatch_metadata",
    ).outputSchema.parse(response.json);
    const { client, call } = await connectLocalToolsMcp(environment);
    const opened = await call("open_binary", { path: target });
    expect(opened.isError, JSON.stringify(opened)).not.toBe(true);
    const inspected = await call("inspect_native_dispatch_metadata", {});
    expect(inspected.isError, JSON.stringify(inspected)).not.toBe(true);
    for (const evidence of [
      cliEvidence,
      parseEvidence(inspected.structuredContent),
    ])
      expect(evidence.normalized_result).toMatchObject({
        result: {
          objc_classes: [
            {
              name: "FixtureClass",
              is_meta_class: false,
              methods: [{ selector: "classMethod" }],
              protocols: [],
              decode: {
                status: "partial",
                reason: "protocol_list_count_limit",
              },
            },
            { is_meta_class: true, decode: { status: "decoded" } },
          ],
        },
      });
    expect(Buffer.compare(await readFile(target), bytes)).toBe(0);
    await client.ping();
  },
  30000,
);
