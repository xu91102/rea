import type { ProviderIdentity } from "../AnalysisProvider.js";
import { BINARY_ARCHITECTURES } from "../../domain/binaryTargetTypes.js";
import { createEvidence, type Evidence } from "../../domain/evidence.js";
import {
  electronFuseReportSchema,
  type ElectronFuseReport,
  type InspectElectronFusesInput,
} from "../../domain/electron/electronFuses.js";

/** Preserve the same validated fuse facts on success and incomplete finalization. */
export const createElectronFuseEvidence = (
  input: InspectElectronFusesInput,
  value: ElectronFuseReport,
  provider: ProviderIdentity,
): Evidence => {
  const architecture = subjectArchitecture(value);
  return createEvidence(
    {
      path: value.artifact.resolved_path,
      sha256: value.artifact.sha256,
      format: value.artifact.format,
      ...(architecture === undefined ? {} : { architecture }),
    },
    provider,
    {
      operation: "inspect_electron_fuses",
      parameters: input,
      result: value,
      confidence: "observed",
      limitations: value.limitations,
      locations: locationsFor(value),
    },
  );
};

const subjectArchitecture = (
  report: ReturnType<typeof electronFuseReportSchema.parse>,
) => {
  if (report.artifact.format === "mach-o-universal") return undefined;
  if (report.slices.length !== 1) return undefined;
  const name = report.slices[0]?.architecture;
  return BINARY_ARCHITECTURES.find((supported) => supported === name);
};

const locationsFor = (
  report: ReturnType<typeof electronFuseReportSchema.parse>,
) => [
  { kind: "artifact-path" as const, path: report.artifact.selected_path },
  ...(report.artifact.resolved_path === report.artifact.selected_path
    ? []
    : [
        {
          kind: "artifact-path" as const,
          path: report.artifact.resolved_path,
        },
      ]),
  ...report.slices.flatMap((slice) =>
    slice.sentinels.map((sentinel) => ({
      kind: "file-offset" as const,
      offset: sentinel.sentinel_offset,
    })),
  ),
];
