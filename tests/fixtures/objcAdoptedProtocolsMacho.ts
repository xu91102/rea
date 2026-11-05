import { objcRecordBudgetMacho } from "./objcRecordBudgetMacho.js";

/** One independently readable owner with a separate adopted-protocol list. */
export const objcAdoptedProtocolsMacho = (
  owner: "class" | "protocol" | "category",
  count: bigint,
): Buffer => {
  const original = objcRecordBudgetMacho(
    owner === "protocol" ? "protocol" : "class",
  );
  const bytes = count === 20000n ? Buffer.alloc(0xc08 + 20000 * 8) : original;
  if (bytes !== original) original.copy(bytes);
  const pointer = (at: number, offset: number) =>
    bytes.writeBigUInt64LE(0x100000000n + BigInt(offset), at);
  bytes.writeBigUInt64LE(BigInt(bytes.length), 64);
  bytes.writeBigUInt64LE(BigInt(bytes.length), 80);
  bytes.writeBigUInt64LE(count, 0xc00);
  if (count <= 20000n)
    for (let index = 0; index < Number(count); index++)
      pointer(0xc08 + index * 8, 0x740);

  if (owner === "class") {
    pointer(0x328, 0xc00);
    pointer(0x200, 0xa00);
    pointer(0xa20, 0xa40);
    bytes.writeUInt32LE(3, 0xa40);
    pointer(0xa58, 0xb00);
    bytes.write("FixtureClass\0", 0xb00);
  } else if (owner === "protocol") pointer(0x750, 0xc00);
  else {
    bytes.writeUInt32LE(232, 20);
    bytes.writeUInt32LE(232, 36);
    bytes.writeUInt32LE(2, 96);
    bytes.write("__objc_catlist", 184);
    bytes.write("__DATA", 200);
    pointer(216, 0xc80);
    bytes.writeBigUInt64LE(8n, 224);
    bytes.writeUInt32LE(0xc80, 232);
    pointer(0xc80, 0xd00);
    pointer(0xd00, 0xda0);
    pointer(0xd08, 0x200);
    pointer(0xd10, 0x500);
    pointer(0xd20, 0xc00);
    bytes.write("FixtureCategory\0", 0xda0);
  }
  return bytes;
};
