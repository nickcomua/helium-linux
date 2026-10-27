# Off-screen native tree drag regressions

This runs real native pointer input against a prebuilt browser, never your regular profile. Do not build/relink during a run. Requires Node 22+, Xvfb, xdotool, ImageMagick, Linux /proc and Hyprland client inspection. Sandbox stays enabled. Every case uses a fresh profile; occupied display/ports are refused and cleanup is verified.

From helium-linux, after the build completes:

```sh
BUILD_READY=1 \
HELIUM_BINARY="$PWD/build/src/out/Default/helium" \
HELIUM_FLAKE=/home/nick/Documents/helium \
XDOTOOL="$(command -v xdotool)" \
ARTIFACT_DIR="$PWD/build/nested-tabs-tests/drag-$(date +%s)" \
SUITE=focused node tests/nested-tabs/drag/run.mjs
```

Set XDOTOOL to its installed absolute path if absent from PATH. HELIUM_FLAKE is optional when already inside a compatible runtime. Defaults: display :108, CDP 9436, native UI DevTools 9437; override TEST_DISPLAY/CDP_PORT/UI_PORT together for parallel isolation. Never run against an existing browser.

Metadata-only inventory:

```sh
node tests/nested-tabs/drag/run.mjs --list
SUITE=matrix node tests/nested-tabs/drag/run.mjs --list
```

The focused inventory contains 11 cases. Expanded direction/cancellation selection:

```sh
SUITE=matrix FILTER='^((up|down)-open-to-open-(before|after)-(drop|cancel)|up-folded-to-open-(before|after)-cancel|same-index-parent-center-cancel)$'
```

Supply those variables with the same runner/environment above. Long runs should not be interrupted by a short terminal timeout. A forcibly killed worker requires checking its recorded owned processes before retrying.

Assertions cover exact identities, hierarchy, selection, group membership, visible projection, real drag activation and pixel-based two-axis grab offsets. Targets use transformed native screen bounds, not occluded text matching. Preview movement may relocate a target; bounded stationary measurements and fresh edge reacquisition must converge before release. No stale-coordinate drop or missed drag counts as a pass.

An accepted center drop preserves the active dragged tab and expands its ancestors. This also reveals other direct children; unrelated folded branches stay folded. During group-exit preview, only moved tabs may have their declared source/destination membership; final membership remains exact.

See ../TREE-CONTRACT.md for policy/provenance and limits. Generated matrix entries are not executed coverage. SEED randomizes independent case order, not stateful operations. Cross-window Escape, arbitrary concurrent mutations and real compositor presentation remain separate verification work. C++ model regression sources are not verified by building only the browser.
