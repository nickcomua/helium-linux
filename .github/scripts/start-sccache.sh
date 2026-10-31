#!/bin/bash
set -euxo pipefail

# mozilla-actions/sccache-action only installs the binary and re-exports
# ACTIONS_RESULTS_URL / ACTIONS_RUNTIME_TOKEN. It does not enable the
# GitHub Actions backend or start a daemon, so the post-step stats were
# a fresh local-disk server with zero compile requests.

if [ "${_runner_environment:-}" != "github-hosted" ]; then
    echo "sccache GitHub Actions cache is only used on github-hosted runners"
    exit 0
fi

case "${ARCH:-x64}" in
    x86_64|amd64|x64) export SCCACHE_GHA_VERSION=x64 ;;
    arm64|aarch64) export SCCACHE_GHA_VERSION=arm64 ;;
    *) export SCCACHE_GHA_VERSION="${ARCH}" ;;
esac

export SCCACHE_GHA_ENABLED=on

sccache --start-server
sccache --show-stats
