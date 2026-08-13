import blankPage from './blank-page.mjs';
import brokenImages from './broken-images.mjs';
import clippedText from './clipped-text.mjs';
import consoleErrors from './console-errors.mjs';
import contrast from './contrast.mjs';
import failedRequests from './failed-requests.mjs';
import horizontalOverflow from './horizontal-overflow.mjs';
import invisibleText from './invisible-text.mjs';
import leakedMarkup from './leaked-markup.mjs';
import missingLabels from './missing-labels.mjs';
import stuckLoading from './stuck-loading.mjs';
import tinyTargets from './tiny-targets.mjs';

/**
 * The checks, in the order they are reported.
 *
 * Order is not arbitrary: a blank page or a navigation error explains every
 * other finding on the same scene, so it comes first and the rest reads as
 * consequence instead of as a separate problem.
 */
export const CHECKS = [
  blankPage,
  consoleErrors,
  failedRequests,
  stuckLoading,
  horizontalOverflow,
  clippedText,
  invisibleText,
  leakedMarkup,
  contrast,
  brokenImages,
  tinyTargets,
  missingLabels,
];

export const BY_ID = Object.fromEntries(CHECKS.map((c) => [c.id, c]));

export {
  blankPage,
  brokenImages,
  clippedText,
  consoleErrors,
  contrast,
  failedRequests,
  horizontalOverflow,
  invisibleText,
  missingLabels,
  stuckLoading,
  tinyTargets,
};
