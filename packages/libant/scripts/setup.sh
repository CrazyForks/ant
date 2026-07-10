#!/bin/bash
set -e

. "$(dirname "$0")/common.sh"

cd "$ROOT_DIR"
meson subprojects download

mkdir -p "$SCRIPT_DIR/vendor"
rsync -a --exclude='.git/' "$ROOT_DIR/vendor/" "$SCRIPT_DIR/vendor/"

mkdir -p "$BUILD_DIR"
