import type {
  ExecutionOptions,
  ProviderIdentity,
} from "../AnalysisProvider.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type {
  ElectronActiveObservationInput,
  ElectronActiveObservationResult,
} from "../../domain/javascript/electronActiveObservation.js";
import type { Result } from "../../domain/result.js";

/** Caller selections resolved once before entering the runtime adapter. */
export type CanonicalElectronActiveObservationInput =
  ElectronActiveObservationInput & { readonly application_root: string };

/** Provider-neutral boundary for owned Electron runtime experiments. */
export interface ElectronActiveObservationPort {
  identity(): ProviderIdentity;
  /** Retry retained preflight resources without acquiring target execution authority. */
  close?(): Promise<void>;
  capture(
    input: CanonicalElectronActiveObservationInput,
    options?: ExecutionOptions,
  ): Promise<Result<ElectronActiveObservationResult, AnalysisError>>;
}
