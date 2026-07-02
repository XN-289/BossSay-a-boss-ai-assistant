#!/bin/bash
# BossSay - 打包脚本
# 用于生成上架 Chrome Web Store / Edge Add-ons 的 ZIP 包
#
# 使用方法：
#   bash package.sh
#   或在 Windows 上: git bash package.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

VERSION=$(node -e "console.log(require('./manifest.json').version)")
OUTPUT="bosssay-v${VERSION}.zip"

echo "🎯 BossSay 打包工具"
echo "版本: v${VERSION}"
echo "输出: ${OUTPUT}"
echo ""

# 删除旧的 ZIP
rm -f "$OUTPUT"

# 打包，排除开发文件
zip -r "$OUTPUT" \
  manifest.json \
  LICENSE \
  README.md \
  PRIVACY.md \
  popup/ \
  content/ \
  background/ \
  lib/ \
  icons/ \
  -x "*.DS_Store" \
  -x "*/.*"

echo ""
echo "✅ 打包完成: ${OUTPUT}"
echo "📦 文件大小: $(du -h "$OUTPUT" | cut -f1)"
echo ""
echo "📋 包含文件:"
unzip -l "$OUTPUT" | tail -n +4 | head -n -2

echo ""
echo "🚀 下一步："
echo "   Chrome: 上传到 https://chrome.google.com/webstore/devconsole"
echo "   Edge:   上传到 https://partner.microsoft.com/dashboard/microsoftedge"
