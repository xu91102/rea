import type { Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";

import { ArtifactReaderFailure } from "./ArtifactReader.js";

/** Shared resource budget for the eagerly decoded ASAR header, not member bytes. */
export const MAX_ASAR_HEADER_BYTES = 16 * 1024 * 1024;

type AsarSignatureState = "pending" | "matched" | "rejected";

/** Scan only the pickle fields and JSON whitespace before its object token. */
export const createAsarHeaderSignatureProbe = (): {
  write(bytes: Uint8Array): AsarSignatureState;
  readonly state: AsarSignatureState;
  readonly limit: number;
} => {
  const prefix = Buffer.alloc(16);
  let state: AsarSignatureState = "pending";
  let offset = 0;
  let limit = 16;
  return {
    get state() {
      return state;
    },
    get limit() {
      return limit;
    },
    write(bytes) {
      for (const byte of bytes) {
        if (state !== "pending") break;
        if (offset < 16) {
          prefix[offset++] = byte;
          if (offset !== 16) continue;
          const extents = asarPickleExtents(prefix);
          if (extents === undefined || extents.jsonBytes < 2) {
            state = "rejected";
            break;
          }
          limit = Math.min(16 + extents.jsonBytes, 8 + MAX_ASAR_HEADER_BYTES);
          continue;
        }
        offset += 1;
        if (byte !== 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d)
          state = byte === 0x7b ? "matched" : "rejected";
        else if (offset >= limit) state = "rejected";
      }
      return state;
    },
  };
};

/** A signature observation; the ASAR reader still owns complete validation. */
export const hasAsarHeader = (prefix: Buffer): boolean =>
  createAsarHeaderSignatureProbe().write(prefix) === "matched";

const asarPickleExtents = (prefix: Buffer) => {
  if (prefix.length !== 16 || prefix.readUInt32LE(0) !== 4) return undefined;
  const headerBytes = prefix.readUInt32LE(4);
  const payloadBytes = prefix.readUInt32LE(8);
  const jsonBytes = prefix.readUInt32LE(12);
  return headerBytes < 8 ||
    payloadBytes !== headerBytes - 4 ||
    jsonBytes > payloadBytes - 4
    ? undefined
    : { headerBytes, jsonBytes };
};

/** Admit both Chromium pickle extents before an upstream decoder allocates them. */
export const admitAsarHeader = async (
  handle: Pick<FileHandle, "read"> & { stat(): Promise<Stats> },
): Promise<{
  readonly archiveBytes: number;
  readonly headerBytes: number;
  readonly jsonBytes: number;
}> => {
  const observed = await handle.stat();
  if (!observed.isFile())
    throw new ArtifactReaderFailure(
      "format",
      "ASAR container is not a regular file",
    );
  const prefix = Buffer.alloc(16);
  const read = await handle.read(prefix, 0, prefix.length, 0);
  if (read.bytesRead !== prefix.length || prefix.readUInt32LE(0) !== 4)
    throw new ArtifactReaderFailure(
      "format",
      "Truncated or invalid ASAR size pickle",
    );
  const extents = asarPickleExtents(prefix);
  if (extents === undefined || extents.headerBytes > observed.size - 8)
    throw new ArtifactReaderFailure(
      "format",
      "ASAR header leaves its container or has invalid pickle extents",
    );
  const { headerBytes, jsonBytes } = extents;
  if (headerBytes > MAX_ASAR_HEADER_BYTES)
    throw new ArtifactReaderFailure(
      "limit",
      `ASAR header exceeds the ${String(MAX_ASAR_HEADER_BYTES)} byte decode budget`,
    );
  return { archiveBytes: observed.size, headerBytes, jsonBytes };
};
