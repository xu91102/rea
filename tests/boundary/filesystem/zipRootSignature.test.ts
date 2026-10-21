import { open, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it } from "vitest";

import { parseBinaryTarget } from "../../../src/application/BinaryTargetResolver.js";
import { hasZipFooterSignature } from "../../../src/artifacts/ZipRootSignature.js";
import { peResourceFixture } from "../../../src/native/pe/PeResources.fixture.js";
import {
  CPU,
  fatImage,
  machoImage,
} from "../../../src/artifacts/apple/MachoImage.fixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const endRecord = (): Buffer => {
  const bytes = Buffer.alloc(22);
  bytes.writeUInt32LE(0x06054b50);
  return bytes;
};

it.each(["FAT host selection", "unsupported ELF architecture"] as const)(
  "keeps the original %s refusal when a ZIP end record follows it",
  async (kind) => {
    const root = await createTestTempDirectory(
      "rea-rejected-native-zip-footer-",
    );
    const path = join(root, "original");
    const elf = Buffer.alloc(64);
    elf.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
    elf.writeUInt16LE(2, 16);
    elf.writeUInt32LE(1, 20);
    elf.writeUInt16LE(64, 52);
    const bytes =
      kind === "FAT host selection"
        ? Buffer.from(
            fatImage([
              { cpu: CPU.x86_64, bytes: machoImage({ cpu: CPU.x86_64 }) },
            ]),
          )
        : elf;
    await writeFile(path, bytes);
    const original = await parseBinaryTarget(path, {
      hostArchitecture: "arm64",
    });
    if (original.ok)
      throw new Error("The native negative control was admitted");
    await writeFile(path, Buffer.concat([bytes, endRecord()]));
    const withFooter = await parseBinaryTarget(path, {
      hostArchitecture: "arm64",
    });
    expect(withFooter.ok).toBe(false);
    if (!withFooter.ok)
      expect(withFooter.error.message).toBe(original.error.message);
  },
);

it("preserves a valid executable's routing when it also has a ZIP footer", async () => {
  const root = await createTestTempDirectory("rea-native-zip-footer-");
  const path = join(root, "native.exe");
  await writeFile(
    path,
    Buffer.concat([peResourceFixture(true).bytes, endRecord()]),
  );
  const result = await parseBinaryTarget(path);
  expect(result).toMatchObject({
    ok: true,
    value: { kind: "executable", format: "pe" },
  });
});

it("preserves explicitly named JavaScript routing", async () => {
  const root = await createTestTempDirectory("rea-js-zip-footer-");
  const path = join(root, "script.js");
  await writeFile(
    path,
    Buffer.concat([Buffer.from("// original script\n"), endRecord()]),
  );
  expect(await parseBinaryTarget(path)).toMatchObject({
    ok: true,
    value: { kind: "artifact", format: "javascript" },
  });
});

it("propagates cancellation observed after the actual footer read", async () => {
  const root = await createTestTempDirectory("rea-zip-read-cancel-");
  const path = join(root, "source");
  await writeFile(path, endRecord());
  const handle = await open(path, "r");
  const controller = new AbortController();
  const reason = new Error("caller cancelled footer admission");
  let checks = 0;
  try {
    await expect(
      hasZipFooterSignature(handle, 22, () => {
        if (++checks === 3) controller.abort(reason);
        controller.signal.throwIfAborted();
      }),
    ).rejects.toBe(reason);
    // This probe borrows the descriptor; the original owner can still use it.
    expect((await handle.stat()).size).toBe(22);
  } finally {
    await handle.close();
  }
});

it("keeps physical descriptor failures instead of reporting no signature", async () => {
  const root = await createTestTempDirectory("rea-zip-read-io-");
  const path = join(root, "source");
  await writeFile(path, endRecord());
  const handle = await open(path, "r");
  await handle.close();
  await expect(
    hasZipFooterSignature(handle, 22, () => undefined),
  ).rejects.toMatchObject({ code: "EBADF" });
});
