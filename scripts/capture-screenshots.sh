#!/usr/bin/env bash
# 重拍 README 截图。UI 变更后运行 `npm run screenshots`，产物随代码一起提交。
#
# 依赖：本机 Chrome + 已启动的 dev server（npm run dev）。
# 可用环境变量覆盖：BASE_URL / OUT_DIR / CHROME / WIDTH / HEIGHT / WAIT_MS
set -euo pipefail

export PATH="/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:${PATH:-}"

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
OUT_DIR="${OUT_DIR:-docs/assets}"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
WIDTH="${WIDTH:-1440}"
HEIGHT="${HEIGHT:-900}"
WAIT_MS="${WAIT_MS:-15000}"

if [ ! -x "$CHROME" ]; then
  echo "找不到 Chrome，请用 CHROME=/path/to/Chrome 指定" >&2
  exit 1
fi

if ! /usr/bin/curl --noproxy '*' -fsS --max-time 10 "$BASE_URL/" -o /dev/null; then
  echo "服务未就绪：先启动 npm run dev（或设置 BASE_URL）" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

firstCaseId="${FIRST_CASE_ID:-e237c6bd-1dc6-4602-9ff5-ada329fb1c59}"

# 输出文件名 | 路由。
shots=(
  "aitrade-workspace-sidebar.png|/"
  "aitrade-competitors.png|/competitors"
  "aitrade-report-pdf.png|/cases/${firstCaseId}/report"
  "aitrade-sourcing.png|/sourcing"
  "aitrade-content-studio.png|/content"
)

for spec in "${shots[@]}"; do
  file="${spec%%|*}"
  path="${spec#*|}"
  # dev 模式首次编译较慢，先预热路由，避免截到编译中的空白页。
  /usr/bin/curl --noproxy '*' -fsS --max-time 180 "$BASE_URL$path" -o /dev/null || true
  "$CHROME" \
    --headless=new --disable-gpu --no-sandbox --no-proxy-server --hide-scrollbars \
    --window-size="$WIDTH,$HEIGHT" --virtual-time-budget="$WAIT_MS" \
    --screenshot="$OUT_DIR/$file" "$BASE_URL$path" >/dev/null 2>&1
  if [ ! -s "$OUT_DIR/$file" ]; then
    echo "截图失败: $path" >&2
    exit 1
  fi
  echo "已生成 $OUT_DIR/$file ($path)"
done
