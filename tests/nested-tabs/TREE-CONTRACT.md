# Native tree-tab interaction contract

## Chosen behavior

- Single-parent drag moves every descendant, expanded or collapsed, preserving internal order and collapse state.
- Destination = remaining-tree insertion gap + exact group + exact parent. Explicit root is not inferred ownership. Last-child and root-after-parent may share a flat index.
- Before/after owner-row drops place siblings around the entire subtree. Center drops append beneath the owner on accepted release.
- Hover over a collapsed owner must not hide or immediately nest the dragged tab. Expanded-body reorder previews may change placement; Escape restores original ownership.
- No-op requires the same complete contiguous block, parent, and group, not just the first selected index.
- Reject cycles, stale parents, mismatched groups and split-interior destinations before mutation.
- Preserve the original pointer grab offset across container handoffs.
- Existing subtree-close policy is unchanged; reference projects' promotion policies are not silently adopted.

## References

Sidebery commit e6da8e8178ff5a23af960889f5e9bd7006138261: https://github.com/mbnuqw/sidebery
Relevant paths: src/sidebar/components/tab.vue, src/services/tabs.fg.move.ts, src/services/drag-and-drop.fg.ts.

Tree Style Tab commit e887d43c10f011f989efcd2e369b830c5ae1a292: https://github.com/piroor/treestyletab
Relevant paths: webextensions/sidebar/drag-and-drop.js, webextensions/common/tree-behavior.js, webextensions/tests/test-hidden.js, webextensions/tests/test-close-parent-behavior.js.

These are behavioral references, not drop-in native libraries. Sidebery is MIT; TST defaults to MPL-2.0 with file exceptions. No implementation code from either is copied here. Selection/close policies differ, and neither inspected test inventory proves exhaustive pointer-drag coverage.

## Required matrix

Assert exact identities, parent edges, preorder, selection, group/split membership and visible projection. Check source visibility and cursor attachment during drag separately from final topology. Cancellation must demonstrate actual drag activation.

- Chains and sibling fanout; short and long strips.
- Expanded/collapsed source and target, nested folds.
- Up/down, adjacent, beginning/end, before/inside/after and same-index ownership changes.
- Root/nested sources, discontiguous selection, overlapping ancestor/descendant selection.
- Group entry/exit, split boundaries, pins, cross-window movement and cancellation.
- Hover without release, center acceptance, edge acceptance, Escape, target removal mid-drag.
- Close/undo, beforeunload refusal, restart restoration and layout/settings transitions.

## Verification status

Binary SHA256: 45aaae5a3dbd92a8191978a48c8727ca4600b197d9599fd84061fd8122438110.
Existing run.mjs: 25 passed; build/nested-tabs-tests/2026-10-26T19-01-12.955Z/summary.json. Both occupied-endpoint safety checks also passed.

Repository drag/run.mjs: 22 distinct native cases passed on that binary. Evidence under build/nested-tabs-tests/:
- rollback-final-focused/summary.json: 11 passed.
- rollback-final-expanded/summary.json: 10 passed; the remaining center-hover case had an invalid premature-reparenting expectation.
- rollback-final-center-cancel/summary.json: corrected center-hover contract passed independently (hover retains root ownership; Escape preserves original state).

This covers short-strip bottom movement, collapsed-target traversal, center/edge acceptance, active visibility/unrelated folds, same-gap parent changes, group exit, discontiguous selection, both movement directions and expanded/collapsed-owner Escape. All recorded cleanup checks passed. Center acceptance preserves active selection and reveals enclosing ancestors, including their other visible children; the selected owner's own fold is preserved.

Generated unexecuted cases, syntax checks and randomized case ordering are not passing coverage or stateful property testing. Cross-window Escape, arbitrary concurrent mutations and compositor-specific presentation remain unverified. Identity-based rollback after concurrent closure has authored model tests but is not established by this native matrix.

New C++ model regression tests in tab_strip_model_unittest.cc have not been compiled/run as a test target; browser compilation does not verify them. This document is a contract and coverage inventory, not a stability certification.
