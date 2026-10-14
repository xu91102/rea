/** Serialize a header-only ASAR, including Chromium pickle alignment. */
export const asarHeaderBytes = (json: string): Buffer => {
  const text = Buffer.from(json);
  const headerSize = 8 + Math.ceil(text.length / 4) * 4;
  const bytes = Buffer.alloc(8 + headerSize);
  bytes.writeUInt32LE(4, 0);
  bytes.writeUInt32LE(headerSize, 4);
  bytes.writeUInt32LE(headerSize - 4, 8);
  bytes.writeUInt32LE(text.length, 12);
  text.copy(bytes, 16);
  return bytes;
};

/** Prepend serialized header text while preserving every original member byte. */
export const prefixAsarHeaderJson = (archive: Buffer, prefix: string): Buffer =>
  Buffer.concat([
    asarHeaderBytes(
      prefix +
        archive.subarray(16, 16 + archive.readUInt32LE(12)).toString("utf8"),
    ),
    archive.subarray(8 + archive.readUInt32LE(4)),
  ]);

/** Nested metadata without a recursive fixture builder or real directories. */
export const nestedAsarHeader = (
  depth: number,
  name: string,
  leaves: number,
): Buffer => {
  let json = `{"files":{${Array.from(
    { length: leaves },
    (_, index) => `"f${index}":{"size":0,"offset":"0"}`,
  ).join(",")}}}`;
  for (let index = 0; index < depth; index++)
    json = `{"files":{${JSON.stringify(name)}:${json}}}`;
  return asarHeaderBytes(json);
};
