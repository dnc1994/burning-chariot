#!/bin/sh
# 重新生成 fonts/rz-display.woff2（界面和战场上的美术字）。
# 游戏本身不需要这一步——字体文件已经提交在仓库里。只有当界面里出现了字体里没有的
# 生僻字（会退回系统字体，看起来「跳戏」）时才需要重跑。
#
# 字体：站酷庆科黄油体（ZCOOL QingKe HuangYou），SIL OFL 1.1，见 fonts/OFL.txt。
# 子集：GB2312 一级汉字 3755 个 + 仓库文本里实际用到的所有汉字 + ASCII + 常用全角标点。
#
#   pip install fonttools brotli
#   sh tools/subset-font.sh /path/to/ZCOOLQingKeHuangYou-Regular.ttf
set -e
SRC="$1"
[ -f "$SRC" ] || { echo "用法: sh tools/subset-font.sh <ZCOOLQingKeHuangYou-Regular.ttf>"; exit 1; }
cd "$(dirname "$0")/.."
python3 - <<'PY' > /tmp/rz-chars.txt
import glob, io
l1 = ''.join(bytes([a, b]).decode('gb2312') for a in range(0xB0, 0xD8) for b in range(0xA1, 0xFF) if not (a == 0xD7 and b > 0xF9))
used = set()
for f in ['index.html', 'README.md', 'CHANGELOG.md'] + glob.glob('js/*.js'):
    used |= set(c for c in io.open(f, encoding='utf8').read() if '一' <= c <= '鿿')
print(l1 + ''.join(sorted(used)) + ''.join(chr(c) for c in range(0x20, 0x7f)) + '，。！？：；（）「」《》、…—×％＋－')
PY
pyftsubset "$SRC" --flavor=woff2 --output-file=fonts/rz-display.woff2 \
  --text-file=/tmp/rz-chars.txt --layout-features= --no-hinting --desubroutinize
ls -la fonts/rz-display.woff2
