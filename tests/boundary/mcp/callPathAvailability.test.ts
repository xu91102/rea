import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it } from "vitest";

import {
  createAnalysisExecution,
  type CapabilityDescriptor,
} from "../../../src/application/AnalysisProvider.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { expandToolAvailability } from "../../../src/contracts/toolOutputSchemaPrimitives.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { ok } from "../../../src/domain/result.js";
import { silentLogger } from "../../../src/logger.js";
import { createServer } from "../../../src/server/createServer.js";
import {
  createBinarySessionTargets,
  createCacheProvider,
  createTestBinarySession,
} from "../../fixtures/binarySession.js";

it.each([
  ["both directions", ["procedure_callees", "procedure_callers"]],
  ["forward only", ["procedure_callees"]],
  ["backward only", ["procedure_callers"]],
] as const)(
  "matches session discovery to callable traces: %s",
  async (_, relationships) => {
    const [target] = await createBinarySessionTargets();
    const provider = createCacheProvider([]);
    const capability = provider.capabilities()[0];
    if (capability === undefined) throw new Error("Missing fixture capability");
    const operations: readonly CapabilityDescriptor["operation"][] = [
      "procedure_address",
      ...relationships,
    ];
    provider.capabilities = () =>
      operations.map((operation) => ({ ...capability, operation }));
    provider.createClient = () => ({
      execute: async (operation, args) => {
        let result: string | readonly string[];
        if (operation === "procedure_address") result = String(args.procedure);
        else if (operation === "procedure_callees")
          result = args.procedure === "0x1000" ? ["0x1100"] : [];
        else if (operation === "procedure_callers")
          result = args.procedure === "0x1100" ? ["0x1000"] : [];
        else throw new Error(`Unexpected provider operation: ${operation}`);
        return ok(
          createAnalysisExecution(result, provider.identity(), {
            relationshipCoverage: { status: "complete" },
          }),
        );
      },
      close: async () => ok(null),
    });
    const session = createTestBinarySession(provider);
    const unavailable = {
      status: "unavailable",
      code: "not_configured",
      reason: "This fixture does not probe host tools.",
      diagnostics: {},
    } as const;
    const port = {
      inspectAvailability: async () => unavailable,
      execute: async () => {
        throw new Error("Unexpected host tool execution");
      },
      close: async () => {},
    };
    const server = createServer(
      { kind: "session", session },
      {
        androidAnalysis: port,
        adbDeviceAnalysis: port,
        apktoolAnalysis: port,
        environment: {},
        logger: silentLogger,
      },
    );
    const client = new Client({ name: "call-path-availability", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const inventory = async () => {
      const reply = await client.callTool({
        name: "binary_session",
        arguments: {},
      });
      const status = toolContract("binary_session").outputSchema.parse(
        reply.structuredContent,
      ).result;
      return expandToolAvailability(status.tool_availability).find(
        ({ name }) => name === "trace_call_path",
      );
    };
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      expect(
        (await client.listTools()).tools.some(
          ({ name }) => name === "trace_call_path",
        ),
      ).toBe(true);
      expect(await inventory()).toMatchObject({
        available: false,
        reason: "target_required",
      });
      expect(
        (
          await client.callTool({
            name: "open_binary",
            arguments: { path: target },
          })
        ).isError,
      ).not.toBe(true);
      expect(await inventory()).toMatchObject({
        available: true,
        reason: "available",
        remediation: null,
      });

      for (const direction of ["forward", "backward"] as const) {
        const start = direction === "forward" ? "0x1000" : "0x1100";
        const goal = direction === "forward" ? "0x1100" : "0x1000";
        const operation =
          direction === "forward" ? "procedure_callees" : "procedure_callers";
        const reply = await client.callTool({
          name: "trace_call_path",
          arguments: { start, goal, direction },
        });
        expect(reply.isError).not.toBe(true);
        const evidence = parseEvidence(reply.structuredContent);
        const text = reply.content.find((content) => content.type === "text");
        if (text?.type !== "text")
          throw new Error("Missing trace Evidence text");
        expect(parseEvidence(JSON.parse(text.text))).toEqual(evidence);
        if (operations.includes(operation))
          expect(evidence.normalized_result).toMatchObject({
            goal_status: "reached",
            traversal_path: [start, goal],
            failures: [],
            truncated: false,
          });
        else
          expect(evidence.normalized_result).toMatchObject({
            goal_status: "unknown",
            truncated: true,
            failures: [
              expect.objectContaining({
                error: expect.objectContaining({
                  code: "capability_unavailable",
                }),
              }),
            ],
          });
      }
    } finally {
      const closed = await Promise.allSettled([
        client.close(),
        server.close(),
        session.close().then((result) => {
          if (!result.ok) throw result.error;
        }),
      ]);
      const failures = closed.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      if (failures.length > 0)
        throw new AggregateError(failures, "Call-path fixture cleanup failed");
    }
  },
);
