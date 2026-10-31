#!/bin/bash
# cc_wrapper for sccache 0.19.
#
# Chromium adds these to every clang command:
#   -Xclang -fmodule-file-home-is-cwd
#   -Xclang -fmodules-cache-path=/not_exist_dummy_dir
# sccache treats an unknown -Xclang argument as non-cacheable. The failed
# run reported "Can't handle UnknownFlag arguments with -Xclang" and wrote
# nothing to the GitHub Actions cache. The cache path is a dummy so
# implicit modules are not written, and the home flag only affects module
# lookup. Compiles that actually pass -fmodules are left untouched so
# sccache's fallback still runs clang with the original arguments.
set -euo pipefail

for arg in "$@"; do
    case "$arg" in
        -fmodules|-fcxx-modules|-fmodules-ts)
            exec sccache "$@"
            ;;
    esac
done

args=()
i=0
all=("$@")
while [ "$i" -lt "${#all[@]}" ]; do
    cur="${all[$i]}"
    nxt="${all[$((i + 1))]:-}"
    if [ "$cur" = "-Xclang" ] && \
        { [ "$nxt" = "-fmodule-file-home-is-cwd" ] || \
          [[ "$nxt" == -fmodules-cache-path=* ]]; }; then
        i=$((i + 2))
        continue
    fi
    args+=("$cur")
    i=$((i + 1))
done

exec sccache "${args[@]}"
