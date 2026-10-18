import { describe, expect, it } from "vitest";

import {
  parseClientConfiguration,
  serializeClientConfiguration,
  withClientServers,
} from "./ClientConfigurationDocument.js";

describe.each(["toml", "grok"] as const)(
  "%s client TOML integers",
  (format) => {
    it("retains distinct Int64 values and source spelling through registration edits", () => {
      const original = `# User values are not registration settings.
[foreign]
first = 9007199254740992
second = 9007199254740993
minimum = -9223372036854775808
maximum = 9_223_372_036_854_775_807
hex = 0x7fff_ffff_ffff_ffff
octal = 0o777_777_777_777_777_777_777
binary = 0b100000000000000000000000000000000000000000000000000001
nested = [{ values = [9223372036854775807, -9223372036854775808] }]
ordinary = 30
fraction = 1.25
large_float = 1e20
`;
      const parsed = parseClientConfiguration(original, format);
      expect(parsed.document.foreign).toEqual({
        first: 9_007_199_254_740_992n,
        second: 9_007_199_254_740_993n,
        minimum: -9_223_372_036_854_775_808n,
        maximum: 9_223_372_036_854_775_807n,
        hex: 9_223_372_036_854_775_807n,
        octal: 9_223_372_036_854_775_807n,
        binary: 9_007_199_254_740_993n,
        nested: [
          { values: [9_223_372_036_854_775_807n, -9_223_372_036_854_775_808n] },
        ],
        ordinary: 30,
        fraction: 1.25,
        large_float: 1e20,
      });
      const registration = { command: "rea", args: ["mcp"] };
      const desired = withClientServers(parsed, { rea: registration });
      const configured = serializeClientConfiguration(
        desired,
        format,
        original,
      );
      expect(configured.startsWith(original)).toBe(true);
      expect(parseClientConfiguration(configured, format).document).toEqual(
        desired,
      );
      const rewritten = serializeClientConfiguration(desired, format);
      expect(parseClientConfiguration(rewritten, format).document).toEqual(
        desired,
      );
      const removed = serializeClientConfiguration(
        parsed.document,
        format,
        configured,
      );
      expect(removed.startsWith(original.trimEnd())).toBe(true);
      expect(parseClientConfiguration(removed, format).document).toEqual(
        parsed.document,
      );
    });

    it.each([
      "value = 9223372036854775808",
      "value = -9223372036854775809",
      "value = 0x8000_0000_0000_0000",
      "value = [{ nested = [9223372036854775808] }]",
    ])("rejects out-of-range integers before editing: %s", (text) => {
      expect(() => parseClientConfiguration(text, format)).toThrow(
        /signed 64-bit/u,
      );
    });

    it("still rejects malformed integer syntax", () => {
      expect(() =>
        parseClientConfiguration("value = 1__000", format),
      ).toThrow();
    });
  },
);
