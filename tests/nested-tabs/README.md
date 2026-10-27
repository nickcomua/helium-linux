# Nested-tab integration checks (Chromium 156 / PR1832 port)

Run from the helium-linux repository after building the browser:

```sh
nix shell nixpkgs#nodejs nixpkgs#xdotool nixpkgs#imagemagick nixpkgs#xorgserver \
  --command node tests/nested-tabs/run.mjs
```

The runner requires Node with global WebSocket support, Nix, Xvfb, xdotool,
ImageMagick `import`, and (on this host) `hyprctl` for desktop-isolation checks.
The sibling `../helium` flake supplies `#browser-env`. Override `HELIUM_REPO`,
`HELIUM_BINARY`, `HELIUM_FLAKE`, or `XDOTOOL` if needed.

Tests run serially on an invisible Xvfb display `:98`, CDP port `9336`, with
fresh profiles and local HTML fixtures. The FHS launcher sets DISPLAY and
unsets WAYLAND_DISPLAY internally, and explicitly selects X11. It does not
use your normal profile or desktop pointer. Occupied display/port checks
prevent taking over another test. Do not run two suites concurrently or
rebuild the binary while a suite is running.

Run `node tests/nested-tabs/safety.mjs` separately to verify that both runners
refuse an occupied CDP port without attempting to close the existing service.
The extended runner waits for the borrowed uBlock background page's explicit
initialization barrier before extension calls; ordinary operations retain an
eight-second deadline with no retries.

Results go to `build/nested-tabs-tests/<timestamp>/`, including:

- `summary.json`: binary hash, expected case counts, pass/fail and errors;
- per-batch raw Mojo model snapshots and screenshots;
- browser and runner logs, including evidence on crashes.

The runner exits nonzero on failed cases, startup errors, missing results or
incomplete coverage. It does not retry product failures. A timed-out batch
stops the run; inspect and terminate only its isolated test processes before
retrying.

## Coverage

The baseline checks exact hierarchy/order, automatic multilevel nesting,
child close/reopen, collapse and active-descendant reveal, layout and nesting
preference round-trips, disabled auto-nesting, graceful restart persistence,
and closing/reopening a collapsed tree.

The extended cases exercise actual settings control DOM click bindings,
pin/unpin parent and child, grouping/ungrouping trees/subtrees, splitting
parent/child, leaf/owner/complete-tree cross-window moves and close/reopen,
and native Escape-cancelled leaf and subtree drags.

Settings controls are driven through their real WebUI and preferences; tab
operations use Chromium's real extension APIs and xdotool native input.
The internal Mojo inspector currently represents nested collections as extra
unpinned nodes. Collapse is verified through native row hit tests and images,
not inferred from an unavailable Mojo collapse field.

## Limitations

This is a bounded Linux/X11 integration matrix, not proof of all possible
interleavings, sync conflicts, beforeunload cancellation, macOS/Windows behavior,
or Wayland/GPU frame presentation. Pixel-based drag cases assume the specified
window geometry and default scale. Inspect saved screenshots when diagnosing
a failure rather than weakening assertions. Chromium unit-test additions are
separate from this runtime suite.
Cross-window moves and same-window drag cancellation are covered separately;
cross-window Escape cancellation is not established by this matrix.
