#!/usr/bin/env sh
set -eu

tmp=$(mktemp /tmp/ant-startswith-bench.XXXXXX.mjs)
trap 'rm -f "$tmp"' EXIT

cat > "$tmp" <<'EOF'
const N = 10000000;
const url = "http://localhost:8080/?q=hello";
const key = "q";
const pos = url.indexOf(key);
let hits = 0;

const t0 = performance.now();
for (let i = 0; i < N; i++) {
  if (url.startsWith(key, pos)) hits++;
}
const ms = performance.now() - t0;

console.log(JSON.stringify({ N, hits, ms, ops: N / ms * 1000 }));
EOF

ant "$tmp"
