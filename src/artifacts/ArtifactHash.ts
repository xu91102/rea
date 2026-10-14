import { createHash } from "node:crypto";
import type { Readable } from "node:stream";

import { ArtifactReaderFailure } from "./ArtifactReader.js";
import { streamChunkToBuffer } from "./StreamBytes.js";
import {
  createArtifactClassificationProbe,
  ARTIFACT_CLASSIFICATION_PREFIX_BYTES,
} from "./ArtifactClassificationProbe.js";
export { ARTIFACT_CLASSIFICATION_PREFIX_BYTES } from "./ArtifactClassificationProbe.js";

/** Full stream digest and byte count with bounded classification evidence. */
export type HashResult = {
  readonly sha256: string;
  readonly bytes: number;
  readonly prefix: Buffer;
};

/** Preserve the inventory cancellation reason at a stream boundary. */
export const abortIfNeeded = (signal?: AbortSignal): void => {
  if (signal?.aborted === true)
    throw new ArtifactReaderFailure(
      "cancelled",
      "Artifact inventory cancelled",
    );
};

/** Hash every stream byte and retain its bounded classification prefix. */
export const hashReadable = async (
  stream: Readable,
  signal?: AbortSignal,
): Promise<HashResult> => {
  const hash = createHash("sha256");
  const probe = createArtifactClassificationProbe();
  let bytes = 0;
  for await (const raw of stream) {
    abortIfNeeded(signal);
    const chunk = streamChunkToBuffer(raw);
    bytes += chunk.length;
    hash.update(chunk);
    let chunkOffset = 0;
    while (chunkOffset < chunk.length && probe.length < probe.limit) {
      const limit =
        probe.length < ARTIFACT_CLASSIFICATION_PREFIX_BYTES
          ? ARTIFACT_CLASSIFICATION_PREFIX_BYTES
          : probe.limit;
      const selected = chunk.subarray(
        chunkOffset,
        Math.min(chunkOffset + limit - probe.length, chunk.length),
      );
      chunkOffset += selected.length;
      probe.write(selected);
    }
  }
  return { sha256: hash.digest("hex"), bytes, prefix: probe.prefix };
};
