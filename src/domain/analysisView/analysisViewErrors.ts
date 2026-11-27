import { err, type Result } from "../result.js";
import {
  AnalysisInputError,
  AnalysisResourceConstraintError,
  type AnalysisInputIssue,
} from "../analysisErrorCore.js";
import { fixedAllowanceOptions } from "../fixedAllowanceRemediation.js";

export const INSPECT_ANALYSIS_VIEW_OPERATION = "inspect_analysis_view" as const;

export const ANALYSIS_VIEW_PAGE_BYTES = 1024 * 1024;

/** The projection owns this ceiling and the recovery for each view. */
export const analysisViewPageRecovery = (
  narrowing = "For a pageable collection, select fewer fields or a smaller selection; one oversized field may not fit even in a one-row page. If the error includes details.partial_observation, use that complete parent Evidence. Otherwise, read the parent directly from the caller-supplied bundle, or retrieve/export the retained parent in the same MCP session. The page keeps the same allowance.",
) =>
  fixedAllowanceOptions("The analysis-view page allowance", "bytes", {
    limit: ANALYSIS_VIEW_PAGE_BYTES,
    unit: "bytes",
    narrowing,
  });

/** Refuse an oversized page while retaining the view's selection and recovery. */
export const analysisViewPageTooLarge = (
  parentEvidenceId: string,
  reason: string,
  {
    narrowing,
    ...selection
  }: {
    readonly collection?: string;
    readonly facet?: string;
    readonly narrowing?: string;
  } = {},
): Result<never, AnalysisResourceConstraintError> =>
  err(
    new AnalysisResourceConstraintError(
      INSPECT_ANALYSIS_VIEW_OPERATION,
      "transport",
      reason,
      {
        parent_evidence_id: parentEvidenceId,
        limit_bytes: ANALYSIS_VIEW_PAGE_BYTES,
        ...selection,
      },
      analysisViewPageRecovery(narrowing),
    ),
  );

/** Construct a typed input failure for one selected-view constraint. */
export const analysisViewInputError = (
  issues: readonly AnalysisInputIssue[],
): AnalysisInputError =>
  new AnalysisInputError(INSPECT_ANALYSIS_VIEW_OPERATION, undefined, issues);

/** A constraint on the selected view as a whole. */
export const invalidAnalysisView = (
  message: string,
): Result<never, AnalysisInputError> =>
  err(
    analysisViewInputError([
      { path: ["view"], reason: "invalid_value", message },
    ]),
  );

/** The parent Evidence subject does not identify the artifact required by the view. */
export const invalidAnalysisViewSubject = (
  message: string,
): Result<never, AnalysisInputError> =>
  err(
    analysisViewInputError([
      { path: ["source", "subject"], reason: "invalid_value", message },
    ]),
  );
