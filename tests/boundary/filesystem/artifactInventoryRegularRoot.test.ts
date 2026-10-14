import { execFile } from "node:child_process";
import { lstat, open, rename, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { promisify } from "node:util";

import { expect, it, vi } from "vitest";

import {
  classifyAndHashRoot,
  inventoryArtifact,
} from "../../fixtures/artifactInventory.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { readWithoutFifoWriter } from "../../fixtures/fifoInput.js";
import { asarHeaderBytes } from "../../fixtures/asarHeader.js";

it.each([1, 7])(
  "classifies a long ASAR JSON prefix with controlled %i-byte descriptor reads",
  async (maximumRead) => {
    const root = await createTestTempDirectory("rea-asar-short-root-read-");
    const path = join(root, "input.asar");
    const bytes = asarHeaderBytes(" ".repeat(9000) + '{"files":{}}');
    await writeFile(path, bytes);
    const prototypeHandle = await open(path, "r");
    type BufferRead = (
      buffer: Buffer,
      offset: number,
      length: number,
      position: number | bigint | null,
    ) => Promise<{ bytesRead: number; buffer: Buffer }>;
    const prototype = Object.getPrototypeOf(prototypeHandle) as {
      read: BufferRead;
    };
    await prototypeHandle.close();
    const nativeRead = prototype.read;
    const buffers = new Set<Buffer>();
    let firstRead = true;
    let classification = true;
    const read = vi.spyOn(prototype, "read").mockImplementation(function (
      this: typeof prototypeHandle,
      buffer,
      offset,
      length,
      position,
    ) {
      // Hashing uses independent bigint offsets. Keep those reads native;
      // this injection examines only the admitted descriptor prefix owner.
      if (typeof position !== "number") classification = false;
      else if (position === 0) {
        if (!firstRead) classification = false;
        firstRead = false;
      }
      if (!classification)
        return nativeRead.call(this, buffer, offset, length, position);
      buffers.add(buffer);
      return nativeRead.call(
        this,
        buffer,
        offset,
        Math.min(length, maximumRead),
        position,
      );
    });
    try {
      const result = await classifyAndHashRoot(path, false, await lstat(path));
      expect(result.format).toBe("asar");
      expect(result.digest?.sha256).toBe(
        createHash("sha256").update(bytes).digest("hex"),
      );
      // Short reads must reuse bounded storage rather than pin one backing per read.
      expect(buffers.size).toBeLessThanOrEqual(2);
      expect(read).toHaveBeenCalled();
    } finally {
      read.mockRestore();
    }
  },
);

it.skipIf(process.platform === "win32")(
  "rejects a FIFO artifact root without waiting for a writer",
  async () => {
    const root = await createTestTempDirectory("rea-artifact-root-fifo-");
    const fifoPath = join(root, "input.asar");
    await promisify(execFile)("mkfifo", [fifoPath]);

    const outcome = await readWithoutFifoWriter(fifoPath, () =>
      inventoryArtifact(fifoPath).then(
        () => undefined,
        (cause: unknown) => cause,
      ),
    );
    expect(outcome.state).toBe("completed");
    if (outcome.state !== "completed")
      throw new Error("Artifact inventory waited for a FIFO writer");
    expect(outcome.result).toMatchObject({
      reason: "format",
      message: `Artifact root is not a regular file: ${fifoPath}`,
    });
  },
);

it("rejects a root path replaced between its initial stat and open", async () => {
  const root = await createTestTempDirectory("rea-artifact-root-replaced-");
  const path = join(root, "input.bin");
  const replacement = join(root, "replacement.bin");
  await writeFile(path, "first bytes\n");
  const expectedMetadata = await lstat(path);
  await writeFile(replacement, "different bytes\n");
  await rm(path);
  await rename(replacement, path);

  await expect(
    classifyAndHashRoot(path, false, expectedMetadata),
  ).rejects.toMatchObject({
    reason: "integrity",
    message: `Root artifact changed before inventory: ${path}`,
  });
});

it("keeps unavailable container traversal distinct from observed root bytes", async () => {
  const root = await createTestTempDirectory("rea-artifact-root-scope-");
  const path = join(root, "fixture.pkg");
  // The recognized XAR prefix selects PKG inventory; no child decoder is installed.
  await writeFile(path, Buffer.from("xar!fixture"));
  const inventory = await inventoryArtifact(path);
  expect(inventory.manifest).toMatchObject({
    root_format: "pkg",
    node_count: 1,
    occurrence_count: 1,
    edge_count: 0,
  });
  expect(inventory.occurrences[0]?.hash_status).toBe("verified");
  expect(inventory.coverage).toEqual({
    scope: "container-entries",
    status: "unknown",
  });
});
