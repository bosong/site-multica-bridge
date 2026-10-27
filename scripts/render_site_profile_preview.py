"""Render a privacy-safe preview of the development UI (requires Pillow)."""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "assets" / "site-profiles-preview.png"
FONT_PATH = next(
    str(path) for path in [
        Path("/Library/Fonts/Microsoft/Microsoft Yahei.ttf"),
        Path("/System/Library/Fonts/STHeiti Medium.ttc"),
    ] if path.exists()
)


def font(size):
    return ImageFont.truetype(FONT_PATH, size)


def text(draw, xy, value, size=22, fill="#26364D"):
    draw.text(xy, value, font=font(size), fill=fill)


image = Image.new("RGB", (1500, 1050), "#EDF2F8")
draw = ImageDraw.Draw(image)

text(draw, (56, 58), "五栏工作台", 32, "#172B4D")
text(draw, (56, 101), "站点捕获配置", 30, "#172B4D")
text(draw, (57, 153), "合成示意 · 无真实数据", 18, "#63748B")
draw.rounded_rectangle((56, 196, 370, 500), 20, fill="#FFFFFF", outline="#DFE7F2", width=2)
text(draw, (82, 224), "站点来源", 25, "#1E3352")
draw.rounded_rectangle((82, 278, 344, 323), 12, fill="#EFF6FF")
text(draw, (98, 287), "BugDone  ·  内置", 18, "#2356A6")
draw.rounded_rectangle((82, 337, 344, 382), 12, fill="#EFF6FF")
text(draw, (98, 346), "友盟 APM  ·  内置", 18, "#2356A6")
draw.rounded_rectangle((82, 396, 344, 441), 12, fill="#EFF6FF")
text(draw, (98, 405), "GitHub Issues  ·  内置", 18, "#2356A6")
text(draw, (82, 461), "自定义规则可从模板新建", 16, "#77879A")

panel = (410, 28, 1468, 1018)
draw.rounded_rectangle(panel, 23, fill="#F7F9FD", outline="#DCE5F0", width=2)
draw.rounded_rectangle((411, 29, 1467, 174), 22, fill="#FFFFFF")
draw.rounded_rectangle((411, 133, 1467, 176), 0, fill="#FFFFFF")
draw.rounded_rectangle((438, 53, 489, 104), 12, fill="#EFF6FF")
text(draw, (450, 60), "M", 30, "#2563EB")
text(draw, (507, 49), "Multica-AI", 26, "#1C2D48")
text(draw, (508, 88), "Issues处理工作台", 16, "#8492A6")
text(draw, (1190, 68), "打开 Multica", 17, "#2563EB")
draw.ellipse((1389, 61, 1430, 102), fill="#F1F5F9")
text(draw, (1401, 61), "×", 26, "#64748B")

tabs = [(441, "信息捕获"), (565, "AI任务创建"), (708, "处理列表"), (834, "设置"), (915, "站点捕获配置")]
for x, label in tabs:
    text(draw, (x, 127), label, 17, "#2563EB" if label == "站点捕获配置" else "#7A8799")
draw.line((411, 175, 1467, 175), fill="#E5EAF2", width=2)
draw.rectangle((914, 172, 1042, 177), fill="#2D6CEF")

text(draw, (443, 205), "SOURCE CONFIGURATION", 14, "#94A1B3")
text(draw, (443, 230), "站点捕获配置", 27, "#20314B")
draw.rounded_rectangle((439, 286, 1438, 934), 16, fill="#FFFFFF", outline="#DEE6F0", width=2)

text(draw, (465, 309), "启用友盟 APM 崩溃捕获", 20, "#243753")
text(draw, (465, 346), "按声明规则捕获友盟崩溃列表与详情；启停与保存立即应用，支持回滚。", 16, "#8190A4")
draw.rounded_rectangle((1351, 314, 1411, 347), 17, fill="#2F6FE8")
draw.ellipse((1382, 318, 1407, 343), fill="#FFFFFF")
draw.line((464, 394, 1413, 394), fill="#E8EDF4", width=2)

text(draw, (465, 417), "站点配置", 18, "#394D69")
draw.rounded_rectangle((465, 449, 1413, 504), 10, fill="#FFFFFF", outline="#CDD9E7", width=2)
text(draw, (485, 464), "内置 · GitHub Issues · github.com · 已启用", 17, "#2A3E5D")
text(draw, (1378, 462), "v", 21, "#70819B")

draw.rounded_rectangle((465, 521, 729, 572), 9, fill="#FFFFFF", outline="#CAD8E8", width=2)
text(draw, (483, 533), "使用合成模板新建", 17, "#426183")
text(draw, (465, 591), "配置 JSON · 内置规则支持用户覆盖", 18, "#394D69")
draw.rounded_rectangle((465, 624, 1413, 796), 10, fill="#F8FAFD", outline="#D6DFEB", width=2)
code = [
    '{  "schemaVersion": 2,  "id": "github-issues",  "enabled": true,',
    '   "allowedOrigins": ["https://github.com"],',
    '   "pages": ["/:owner/:repo/issues", ".../issues/:number"],',
    '   "captures": [{"method":"GET","requestOnPage":true}, ...],',
    '   "defaultLabel": {"mode":"inherit"}, "attachments": [], ... }',
]
for index, line in enumerate(code):
    text(draw, (484, 642 + index * 27), line, 16, "#3D5879")

draw.rounded_rectangle((465, 819, 1413, 875), 10, fill="#F6F9FD", outline="#DDE6F1", width=2)
text(draw, (486, 833), "配置字段说明与填写规则  >", 18, "#415978")
text(draw, (466, 892), "schemaVersion · id · allowedOrigins · pages · captures · record · draft · dedup · attachments", 15, "#8493A8")

draw.rounded_rectangle((439, 962, 1438, 995), 8, fill="#FFFFFF")
text(draw, (456, 963), "●  配置示意：站点标签可继承 / 不带 / 指定；新建规则校验后手动启用。", 15, "#667B98")

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
image.save(OUTPUT)
print(OUTPUT)
