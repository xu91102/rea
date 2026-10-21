import type { FileHandle } from "node:fs/promises";

const ZIP_END_RECORD_BYTES = 22;
const ZIP_MAX_COMMENT_BYTES = 0xffff;

/**
 * Recognize an end record at EOF without interpreting or executing a prefix.
 * The existing ZIP reader still owns directory, member and integrity validation.
 */
export const hasZipFooterSignature = async (
  handle: Pick<FileHandle, "read">,
  size: number,
  assertActive: () => void,
): Promise<boolean> => {
  assertActive();
  if (!Number.isSafeInteger(size) || size < ZIP_END_RECORD_BYTES) return false;
  // The ZIP comment's uint16 length bounds the entire footer search window.
  const length = Math.min(size, ZIP_END_RECORD_BYTES + ZIP_MAX_COMMENT_BYTES);
  const tail = Buffer.alloc(length);
  let consumed = 0;
  while (consumed < length) {
    assertActive();
    const { bytesRead } = await handle.read(
      tail,
      consumed,
      length - consumed,
      size - length + consumed,
    );
    assertActive();
    if (bytesRead === 0) return false;
    consumed += bytesRead;
  }
  for (let offset = length - ZIP_END_RECORD_BYTES; offset >= 0; offset -= 1)
    if (
      tail.readUInt32LE(offset) === 0x06054b50 &&
      offset + ZIP_END_RECORD_BYTES + tail.readUInt16LE(offset + 20) === length
    )
      return true;
  return false;
};
