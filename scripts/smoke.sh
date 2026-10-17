#!/usr/bin/env bash
# Launches the built app against a throwaway data folder and a small fixture Development folder,
# then checks that the window rendered the scanned projects. Linux only (uses xvfb).
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build --silent
work="$(mktemp -d)"
dev="$work/Development"
for name in alpha beta; do
  mkdir -p "$dev/$name"
  git -C "$dev/$name" init -q -b main
  echo "export const x = 1" > "$dev/$name/index.ts"
  git -C "$dev/$name" add -A
  git -C "$dev/$name" -c user.name=t -c user.email=t@t commit -q -m init
done
mkdir -p "$work/data"
echo "{\"developmentFolder\":\"$dev\",\"overrides\":{}}" > "$work/data/settings.json"
out="${SMOKE_OUT:-$work/smoke}"
env -u NOTION_TOKEN DASHBOARD_HOME="$work/data" DASHBOARD_SMOKE="$out" \
  xvfb-run -a npx electron . --no-sandbox --disable-gpu 2>&1 | grep SMOKE_RESULT | tee "$work/result.txt"
echo "screenshot: $out.png"
node -e '
const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8").replace(/^SMOKE_RESULT /, ""));
const expectKeys = ["getSettings","getSnapshot","kill","onProjectUpdate","openLink","park","promote","saveSettings","setCriterion","setNextAction","setToken","startScan","unpark"];
const checks = {
  "no launch error": !r.error,
  "sidebar counts both fixture folders": r.allProjects === "2" && r.inbox === "2",
  "headline asks to connect Notion": typeof r.headline === "string" && r.headline.includes("Connect Notion"),
  "banner explains how to connect": typeof r.banner === "string" && r.banner.includes("NOTION_TOKEN"),
  "portfolio says nothing is tracked": r.noTracked === true,
  "sidebar says Notion is not connected": typeof r.notionState === "string" && r.notionState.includes("not connected"),
  "bridge exposes exactly the intended methods": JSON.stringify(r.bridgeKeys) === JSON.stringify(expectKeys),
  "Node is not reachable from the page": r.nodeLeaked === false,
  "strict script policy": typeof r.csp === "string" && r.csp.includes("script-src '"'"'self'"'"';") && !/script-src[^;]*unsafe/.test(r.csp),
  "scan finished without error": r.scanError === null,
};
let bad = 0;
for (const [k, v] of Object.entries(checks)) { console.log((v ? "PASS " : "FAIL ") + k); if (!v) bad++; }
process.exit(bad ? 1 : 0);
' "$work/result.txt"
