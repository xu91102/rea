import { describe, expect, it } from "vitest";
import { objcAdoptedProtocolsMacho } from "../../tests/fixtures/objcAdoptedProtocolsMacho.js";
import { objcSwiftMetadataSchema } from "../domain/native/objcSwiftMetadata.js";
import { decodeAppleDispatchMetadata } from "./AppleDispatchMetadata.js";

const provenance = {
  path: "/fixtures/protocol-list.macho",
  sha256: "a".repeat(64),
};

describe("adopted protocol-list count limits", () => {
  for (const owner of ["class", "protocol", "category"] as const)
    it.each([20001n, 0xffffffffffffffffn])(
      `retains the ${owner} independently of a %s-entry list`,
      (count) => {
        const result = decodeAppleDispatchMetadata(
          objcAdoptedProtocolsMacho(owner, count),
          100,
          provenance,
        );
        expect(objcSwiftMetadataSchema.safeParse(result).success).toBe(true);
        const row =
          owner === "class"
            ? result.objc_classes.find(({ is_meta_class }) => !is_meta_class)
            : owner === "protocol"
              ? result.objc_protocol_records[0]
              : result.objc_categories[0];
        expect(row).toMatchObject({
          decode: { status: "partial", reason: "protocol_list_count_limit" },
        });
        expect(result.objc_dispatch_implementations).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              class_name: "FixtureClass",
              selector: "classMethod",
            }),
          ]),
        );
        if (owner === "class")
          expect(result.objc_classes).toMatchObject([
            { is_meta_class: false, protocols: [] },
            { is_meta_class: true, decode: { status: "decoded" } },
          ]);
        else if (owner === "protocol")
          expect(result.objc_protocols[0]?.methods).toMatchObject([
            { selector: "protocolMethod" },
          ]);
        else {
          expect(result.objc_categories[0]).toMatchObject({
            class_name: "FixtureClass",
            instance_methods: ["classMethod"],
            protocols: [],
          });
          expect(
            result.coverage.find(
              ({ facet }) => facet === "objc_properties_categories",
            ),
          ).toMatchObject({
            status: "partial",
            reason: expect.stringContaining("protocol_list_count_limit"),
          });
          expect(
            result.coverage.find(
              ({ facet }) => facet === "objc_class_method_ivar_metadata",
            ),
          ).toMatchObject({
            status: "complete",
            reason: null,
            examined: 1,
            decoded: 1,
          });
        }
        expect(result.coverage.some(({ status }) => status === "partial")).toBe(
          true,
        );
      },
    );

  it.each([0n, 1n, 20000n])(
    "keeps a supported %s-entry list decoded",
    (count) => {
      const result = decodeAppleDispatchMetadata(
        objcAdoptedProtocolsMacho("class", count),
        50000,
        provenance,
      );
      expect(result.objc_classes).toHaveLength(2);
      expect(result.objc_classes[0]?.decode).toEqual({
        status: "decoded",
        reason: null,
      });
      expect(result.objc_classes[0]?.protocols).toHaveLength(Number(count));
    },
  );

  it("keeps record-budget truncation distinct from the count bound", () => {
    const result = decodeAppleDispatchMetadata(
      objcAdoptedProtocolsMacho("class", 20000n),
      3,
      provenance,
    );
    expect(result.objc_classes[0]).toMatchObject({
      decode: { status: "partial", reason: "max_records_reached" },
    });
    expect(result.objc_classes[0]?.protocols).toHaveLength(1);
  });
});
