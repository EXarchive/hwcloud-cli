#!/usr/bin/env python3
"""build_deck.py —— 从 JSON 大纲生成 .pptx（主题化、可复用）

用法:
    python scripts/build_deck.py --content content/demo.json --out out/demo.pptx
    python scripts/build_deck.py --content content/demo.json --out out/demo.pptx --theme dark

大纲 JSON 结构:
    {
      "title": "标题",
      "subtitle": "副标题",
      "author": "作者",
      "theme": "light | dark",
      "slides": [
        {"layout": "section", "title": "章节标题"},
        {"layout": "bullets", "title": "要点页", "bullets": ["a", "b"]},
        {"layout": "two-column", "title": "对比", "left": {...}, "right": {...}},
        {"layout": "table", "title": "数据", "headers": ["h1"], "rows": [["v1"]]},
        {"layout": "quote", "text": "引用", "cite": "出处"}
      ]
    }
"""

import argparse
import json
import os
import sys

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.util import Emu, Pt

THEMES = {
    "light": {
        "bg": RGBColor(0xFF, 0xFF, 0xFF),
        "title": RGBColor(0x1F, 0x29, 0x37),
        "body": RGBColor(0x37, 0x41, 0x51),
        "accent": RGBColor(0x4F, 0x46, 0xE5),
        "muted": RGBColor(0x6B, 0x72, 0x80),
        "band": RGBColor(0xF3, 0xF4, 0xFF),
    },
    "dark": {
        "bg": RGBColor(0x0B, 0x10, 0x20),
        "title": RGBColor(0xF8, 0xFA, 0xFC),
        "body": RGBColor(0xCB, 0xD5, 0xE1),
        "accent": RGBColor(0x93, 0xC5, 0xFD),
        "muted": RGBColor(0x94, 0xA3, 0xB8),
        "band": RGBColor(0x13, 0x1A, 0x2E),
    },
}

SLIDE_W = Emu(12192000)  # 13.333in 16:9
SLIDE_H = Emu(6858000)   # 7.5in
MARGIN = Emu(838200)     # 0.9166in


def _blank(prs, theme):
    """新建空白页并铺底色"""
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    bg = slide.shapes.add_shape(1, 0, 0, SLIDE_W, SLIDE_H)
    bg.fill.solid()
    bg.fill.fore_color.rgb = theme["bg"]
    bg.line.fill.background()
    bg.shadow.inherit = False
    return slide


def _textbox(slide, left, top, width, height, text, size, color, bold=False, align=PP_ALIGN.LEFT):
    box = slide.shapes.add_textbox(left, top, width, height)
    tf = box.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = MSO_ANCHOR.TOP
    p = tf.paragraphs[0]
    p.text = text
    p.alignment = align
    run = p.runs[0]
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = color
    return box


def _accent_bar(slide, theme, top, width=Emu(1600000)):
    bar = slide.shapes.add_shape(1, MARGIN, top, width, Emu(64000))
    bar.fill.solid()
    bar.fill.fore_color.rgb = theme["accent"]
    bar.line.fill.background()
    bar.shadow.inherit = False
    return bar


def build(content, out_path):
    theme_name = content.get("theme", "light")
    theme = THEMES.get(theme_name, THEMES["light"])

    prs = Presentation()
    prs.slide_width = SLIDE_W
    prs.slide_height = SLIDE_H

    # ---- 封面 ----
    cover = _blank(prs, theme)
    band = cover.shapes.add_shape(1, 0, Emu(2200000), SLIDE_W, Emu(1500000))
    band.fill.solid()
    band.fill.fore_color.rgb = theme["band"]
    band.line.fill.background()
    band.shadow.inherit = False

    _textbox(cover, MARGIN, Emu(2450000), Emu(10000000), Emu(700000), content.get("title", ""), 40, theme["title"], bold=True)
    if content.get("subtitle"):
        _textbox(cover, MARGIN, Emu(3150000), Emu(10000000), Emu(500000), content["subtitle"], 18, theme["muted"])
    _accent_bar(cover, theme, Emu(3900000))
    if content.get("author"):
        _textbox(cover, MARGIN, Emu(4100000), Emu(6000000), Emu(400000), content["author"], 13, theme["muted"])

    # ---- 内容页 ----
    for spec in content.get("slides", []):
        layout = spec.get("layout", "bullets")
        slide = _blank(prs, theme)

        if layout == "section":
            _textbox(slide, MARGIN, Emu(2600000), Emu(10000000), Emu(800000), spec.get("title", ""), 34, theme["title"], bold=True)
            _accent_bar(slide, theme, Emu(3450000), Emu(2200000))
            if spec.get("note"):
                _textbox(slide, MARGIN, Emu(3560000), Emu(9000000), Emu(500000), spec["note"], 15, theme["muted"])
            continue

        if layout == "quote":
            _textbox(slide, MARGIN, Emu(2200000), Emu(10000000), Emu(1400000), f"“{spec.get('text','')}”", 28, theme["title"], bold=True)
            if spec.get("cite"):
                _textbox(slide, MARGIN, Emu(3700000), Emu(8000000), Emu(400000), f"— {spec['cite']}", 14, theme["muted"])
            continue

        # 其他布局统一带标题
        _textbox(slide, MARGIN, Emu(520000), Emu(10000000), Emu(600000), spec.get("title", ""), 26, theme["title"], bold=True)
        _accent_bar(slide, theme, Emu(1240000))

        if layout == "bullets":
            box = slide.shapes.add_textbox(MARGIN, Emu(1560000), Emu(10100000), Emu(4200000))
            tf = box.text_frame
            tf.word_wrap = True
            for i, item in enumerate(spec.get("bullets", [])):
                p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
                p.text = f"·  {item}"
                p.space_after = Pt(10)
                p.runs[0].font.size = Pt(18)
                p.runs[0].font.color.rgb = theme["body"]

        elif layout == "two-column":
            col_w = Emu(4600000)
            for idx, key in enumerate(("left", "right")):
                left = MARGIN + idx * (col_w + Emu(500000))
                col = spec.get(key) or {}
                card = slide.shapes.add_shape(1, left, Emu(1560000), col_w, Emu(4000000))
                card.fill.solid()
                card.fill.fore_color.rgb = theme["band"]
                card.line.color.rgb = theme["accent"]
                card.shadow.inherit = False
                _textbox(slide, left + Emu(200000), Emu(1680000), col_w - Emu(400000), Emu(400000), col.get("title", ""), 17, theme["title"], bold=True)
                body = slide.shapes.add_textbox(left + Emu(200000), Emu(2160000), col_w - Emu(400000), Emu(3200000))
                tf = body.text_frame
                tf.word_wrap = True
                for i, item in enumerate(col.get("bullets", [])):
                    p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
                    p.text = f"·  {item}"
                    p.space_after = Pt(8)
                    p.runs[0].font.size = Pt(14)
                    p.runs[0].font.color.rgb = theme["body"]

        elif layout == "table":
            headers = spec.get("headers", [])
            rows = spec.get("rows", [])
            shape = slide.shapes.add_table(
                len(rows) + 1, max(1, len(headers)),
                MARGIN, Emu(1560000), Emu(10100000), Emu(500000) * (len(rows) + 1),
            )
            table = shape.table
            for c, h in enumerate(headers):
                cell = table.cell(0, c)
                cell.text = str(h)
                cell.text_frame.paragraphs[0].runs[0].font.size = Pt(14)
                cell.text_frame.paragraphs[0].runs[0].font.bold = True
                cell.text_frame.paragraphs[0].runs[0].font.color.rgb = theme["title"]
                cell.fill.solid()
                cell.fill.fore_color.rgb = theme["band"]
            for r, row in enumerate(rows, start=1):
                for c, value in enumerate(row):
                    cell = table.cell(r, c)
                    cell.text = str(value)
                    cell.text_frame.paragraphs[0].runs[0].font.size = Pt(13)
                    cell.text_frame.paragraphs[0].runs[0].font.color.rgb = theme["body"]

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    prs.save(out_path)
    return len(prs.slides._sldIdLst)


def main():
    ap = argparse.ArgumentParser(description="从 JSON 大纲生成 PPTX")
    ap.add_argument("--content", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--theme", help="覆盖大纲里的 theme")
    args = ap.parse_args()

    with open(args.content, "r", encoding="utf-8") as f:
        content = json.load(f)
    if args.theme:
        content["theme"] = args.theme

    slides = build(content, args.out)
    size = os.path.getsize(args.out)
    print(f"#deck={args.out}")
    print(f"#slides={slides}")
    print(f"#bytes={size}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR {exc}", file=sys.stderr)
        sys.exit(1)
