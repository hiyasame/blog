#!/usr/bin/env bash
set -euo pipefail

# elog 是全局安装的，@elog/plugin-adapter 与它在同一个 node_modules 下。
# 但 Node 从项目目录解析模块时不会搜索全局目录，这里显式加入 NODE_PATH。
ELOG_BIN="$(command -v elog)"
ELOG_REAL="$(node -p 'require("fs").realpathSync(process.argv[1])' "$ELOG_BIN")"
ELOG_MODULES="$(cd "$(dirname "$ELOG_REAL")/../../.." && pwd)"
export NODE_PATH="$ELOG_MODULES${NODE_PATH:+:$NODE_PATH}"

elog sync --force -e .env # 同步飞书上的博文到本地
git add .
git commit -m "update: $(date +"%Y-%m-%d %H:%M:%S")"
git push origin master