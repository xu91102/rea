import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { expect } from "vitest";

import {
  artifactExtractionResultSchema,
  artifactInventoryResultSchema,
} from "../../../src/domain/artifactGraph.js";
import { artifactInspectionResultSchema } from "../../../src/domain/artifactInspection.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "inspects a prefixed ZIP without changing its original identity",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-prefixed-zip-");
    const prefix = Buffer.from("#!/bin/sh\nexit 0\n");
    const writer = new ZipWriter(new Uint8ArrayWriter(), {
      offset: prefix.length,
    });
    await writer.add("a.txt", new TextReader("hello world\n"));
    const bytes = Buffer.concat([prefix, await writer.close()]);
    const path = join(root, "original.zip");
    await writeFile(path, bytes);

    const result = await cli.run({
      arguments: ["inspect-artifact", path, "--json"],
    });

    expect(result.exitCode, result.stdout).toBe(0);
    expect(result.json).toMatchObject({
      operation: "inspect_artifact",
      subject: {
        digest: { sha256: createHash("sha256").update(bytes).digest("hex") },
      },
      normalized_result: { subject: { root_format: "zip" } },
    });
    expect(await readFile(path)).toEqual(bytes);
  },
);

cliTest.for([
  {
    name: "plain",
    prefixBytes: 0,
    empty: false,
    zip64: false,
    commentBytes: 0,
  },
  {
    name: "large-prefix",
    prefixBytes: 131072,
    empty: false,
    zip64: false,
    commentBytes: 0,
  },
  {
    name: "commented-empty",
    prefixBytes: 17,
    empty: true,
    zip64: false,
    commentBytes: 65535,
  },
  {
    name: "zip64",
    prefixBytes: 17,
    empty: false,
    zip64: true,
    commentBytes: 0,
  },
])("preserves inventory and extraction for $name", async (sample, { cli }) => {
  const root = await createTestTempDirectory("rea-zip-root-controls-");
  const prefix = Buffer.alloc(sample.prefixBytes, 0x23);
  const writer = new ZipWriter(new Uint8ArrayWriter(), {
    offset: prefix.length,
    zip64: sample.zip64,
  });
  if (!sample.empty) await writer.add("a.txt", new TextReader("hello world\n"));
  const bytes = Buffer.concat([
    prefix,
    await writer.close(Buffer.alloc(sample.commentBytes, 0x78)),
  ]);
  // No extension is needed to establish the ZIP storage format.
  const path = join(root, "original");
  await writeFile(path, bytes);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const result = await cli.run({
    arguments: ["inspect-artifact", path, "--json"],
  });
  expect(result.exitCode, result.stdout).toBe(0);
  const inspection = artifactInspectionResultSchema.parse(
    parseEvidence(result.json).normalized_result,
  );
  const inventoryEvidence = inspection.substeps[0]?.evidence;
  if (inventoryEvidence === undefined)
    throw new Error("Missing inventory Evidence");
  const { manifest, nodes } = artifactInventoryResultSchema.parse(
    inventoryEvidence.normalized_result,
  );
  expect(manifest.root_format).toBe("zip");
  expect(manifest.root_sha256).toBe(digest);
  expect(
    nodes.find((node) => node.artifact_id === manifest.root_artifact_id),
  ).toMatchObject({
    format: "zip",
    sha256: digest,
    size: bytes.length,
  });
  if (!sample.empty) {
    const extracted = await cli.run({
      arguments: ["extract-artifact", path, "--json"],
    });
    expect(extracted.exitCode, extracted.stdout).toBe(0);
    const output = artifactExtractionResultSchema.parse(
      parseEvidence(extracted.json).normalized_result,
    );
    expect(output.artifacts.map((artifact) => artifact.relative_path)).toEqual([
      "a.txt",
    ]);
    try {
      expect(await readFile(join(output.output_root, "a.txt"), "utf8")).toBe(
        "hello world\n",
      );
    } finally {
      await rm(output.output_root, { recursive: true, force: true });
    }
  }
  expect(await readFile(path)).toEqual(bytes);
});

cliTest.for(["truncated", "bad-comment", "missing-directory"] as const)(
  "refuses a prefixed ZIP with %s metadata",
  async (kind, { cli }) => {
    const root = await createTestTempDirectory("rea-bad-zip-root-");
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50);
    if (kind === "bad-comment") end.writeUInt16LE(1, 20);
    if (kind === "missing-directory") {
      end.writeUInt16LE(1, 8);
      end.writeUInt16LE(1, 10);
    }
    const bytes = Buffer.concat([
      Buffer.from("inert prefix"),
      kind === "truncated" ? end.subarray(0, 12) : end,
    ]);
    const path = join(root, "bad.zip");
    await writeFile(path, bytes);
    const result = await cli.run({
      arguments: ["inspect-artifact", path, "--json"],
    });
    expect(result.exitCode, result.stdout).toBe(1);
    expect(await readFile(path)).toEqual(bytes);
  },
);

cliTest(
  "keeps explicitly named ASAR admission ahead of the ZIP footer",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-asar-named-zip-");
    const prefix = Buffer.from("inert prefix");
    const writer = new ZipWriter(new Uint8ArrayWriter(), {
      offset: prefix.length,
    });
    await writer.add("a.txt", new TextReader("hello world\n"));
    const bytes = Buffer.concat([prefix, await writer.close()]);
    const path = join(root, "original.asar");
    await writeFile(path, bytes);
    const inspected = await cli.run({
      arguments: ["inspect-artifact", path, "--json"],
    });
    expect(inspected.exitCode, inspected.stdout).toBe(0);
    expect(inspected.json).toMatchObject({
      normalized_result: { subject: { root_format: "file" } },
    });
    const extracted = await cli.run({
      arguments: ["extract-artifact", path, "--json"],
    });
    expect(extracted.exitCode, extracted.stdout).toBe(1);
    expect(extracted.json).toMatchObject({
      code: "artifact_operation_failed",
      details: {
        reason: "format",
        detail: "ASAR header has invalid Pickle extents",
      },
    });
    expect(await readFile(path)).toEqual(bytes);
  },
);

cliTest(
  "uses the same prefixed ZIP admission through stdio MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-prefix-zip-mcp-");
    const prefix = Buffer.from("inert prefix");
    const writer = new ZipWriter(new Uint8ArrayWriter(), {
      offset: prefix.length,
    });
    await writer.add("a.txt", new TextReader("hello world\n"));
    const bytes = Buffer.concat([prefix, await writer.close()]);
    const path = join(root, "original.zip");
    await writeFile(path, bytes);
    const call = await cli.sharedMcpCall?.();
    if (call === undefined) throw new Error("Missing shared MCP fixture");
    const opened = await call("open_binary", { path });
    expect(opened.isError, JSON.stringify(opened)).not.toBe(true);
    let outputRoot: string | undefined;
    try {
      for (const name of ["inspect_artifact", "extract_artifact"] as const) {
        const output = await call(name, {});
        expect(output.isError, JSON.stringify(output)).not.toBe(true);
        expect(output.structuredContent).toMatchObject({ operation: name });
        if (name === "extract_artifact") {
          const extracted = artifactExtractionResultSchema.parse(
            parseEvidence(output.structuredContent).normalized_result,
          );
          outputRoot = extracted.output_root;
          expect(await readFile(join(outputRoot, "a.txt"), "utf8")).toBe(
            "hello world\n",
          );
        }
      }
    } finally {
      expect((await call("close_binary", {})).isError).not.toBe(true);
      if (outputRoot !== undefined)
        await rm(outputRoot, { recursive: true, force: true });
    }
    expect(await readFile(path)).toEqual(bytes);
  },
);
