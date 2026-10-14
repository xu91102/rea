import { createAsarHeaderSignatureProbe } from "./AsarHeader.js";
import {
  createXmlPlistSignatureProbe,
  MAX_XML_PLIST_PROBE_BYTES,
} from "../domain/apple/appleArchiveFormat.js";

/** Bounded initial evidence, extended only while a supported signature is pending. */
export const ARTIFACT_CLASSIFICATION_PREFIX_BYTES = 8_192;

/** One prefix budget and signature owner for descriptor reads and stream hashes. */
export const createArtifactClassificationProbe = () => {
  const xml = createXmlPlistSignatureProbe();
  const asar = createAsarHeaderSignatureProbe();
  const blocks: Buffer[] = [];
  let tail: Buffer | undefined;
  let tailBytes = 0;
  let length = 0;
  return {
    get length() {
      return length;
    },
    get prefix() {
      return Buffer.concat(
        blocks.map((block, index) =>
          index === blocks.length - 1 ? block.subarray(0, tailBytes) : block,
        ),
      );
    },
    get limit() {
      return Math.max(
        ARTIFACT_CLASSIFICATION_PREFIX_BYTES,
        xml.state === "pending" ? MAX_XML_PLIST_PROBE_BYTES : 0,
        asar.state === "pending" ? asar.limit : 0,
      );
    },
    write(bytes: Uint8Array) {
      xml.write(bytes);
      asar.write(bytes);
      let offset = 0;
      while (offset < bytes.length) {
        if (tail === undefined || tailBytes === tail.length) {
          tail = Buffer.allocUnsafe(ARTIFACT_CLASSIFICATION_PREFIX_BYTES);
          blocks.push(tail);
          tailBytes = 0;
        }
        const copied = Math.min(tail.length - tailBytes, bytes.length - offset);
        tail.set(bytes.subarray(offset, offset + copied), tailBytes);
        tailBytes += copied;
        length += copied;
        offset += copied;
      }
    },
  };
};
