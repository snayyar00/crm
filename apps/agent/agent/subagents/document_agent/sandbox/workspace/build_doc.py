#!/usr/bin/env python3
"""build_doc.py — generate ANY branded WebAbility document as a tagged PDF.

Usage: python3 build_doc.py <docspec.json> <output.pdf>

Shares the brand layer with the SOW builder (sow.css + helpers from
build_sow.py): navy cover, numbered sections, tables, callouts, banner.
The SOW is one preset of this general shape; this builder renders any
document from a section list.

Doc-spec schema (JSON):
{
  "title": "Accessibility Audit Proposal",        // cover + <title>
  "title_accent": "for Acme Corp",                // optional blue second line
  "subtitle": "one-line descriptor under title",  // optional
  "doc_type": "Proposal",                         // header label; default "Document"
  "reference": "PROP-2026-0001",                  // optional
  "date": "August 13, 2026",
  "month_year": "August 2026",                    // optional header suffix
  "prepared_for": "Acme Corp · Attn. Jane Doe",   // optional cover meta lines
  "prepared_by": "WebAbility.io · Sidharth Nayyar, Founder",
  "extra_meta": "Offer valid through ...",        // optional third meta line
  "cover": true,                                  // default true; false = no cover page
  "numbered": true,                               // default true; 01/02/... section numbers
  "sections": [
    { "heading": "Executive Summary",
      "blocks": [
        {"type": "p", "text": "plain paragraph"},
        {"type": "callout", "paras": ["boxed paragraph", "..."]},
        {"type": "bullets", "items": ["a", "b"]},
        {"type": "numbers", "items": ["step 1", "step 2"]},
        {"type": "kicker", "text": "4.1 · In Scope"},
        {"type": "table", "headers": ["Col A", "Col B"], "rows": [["a", "b"]]},
        {"type": "banner", "big": "USD $2,000", "label": "ENGAGEMENT FEE",
         "note": "right-side note, <strong>inline HTML ok</strong>"},
        {"type": "html", "html": "<p>escape hatch — raw HTML</p>"}
      ]}
  ]
}

Text in p/bullets/numbers/kicker/table cells is escaped; banner.note and
html blocks are raw HTML (author-controlled).
"""

import json
import os
import subprocess
import sys

from build_sow import bullets, esc, find_chrome, logo_data_uri, section, table

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


def render_block(b):
    t = b.get("type", "p")
    if t == "p":
        return f"<p>{esc(b['text'])}</p>"
    if t == "callout":
        inner = "".join(f"<p>{esc(p)}</p>" for p in b["paras"])
        return f'<div class="callout">{inner}</div>'
    if t == "bullets":
        return bullets(b["items"])
    if t == "numbers":
        lis = "\n".join(f"<li>{esc(i)}</li>" for i in b["items"])
        return f"<ol>\n{lis}\n</ol>"
    if t == "kicker":
        return f'<h3 class="kicker">{esc(b["text"])}</h3>'
    if t == "table":
        return table(b["headers"], [[esc(c) for c in row] for row in b["rows"]])
    if t == "banner":
        note = f'<div class="fee-note">{b["note"]}</div>' if b.get("note") else ""
        return (
            '<div class="fee-banner">'
            f'<div><div class="amount">{esc(b["big"])}</div>'
            f'<div class="fee-label">{esc(b.get("label", ""))}</div></div>'
            f"{note}</div>"
        )
    if t == "html":
        return b["html"]
    raise ValueError(f"unknown block type: {t}")


def render(spec):
    logo = logo_data_uri()
    doc_type = spec.get("doc_type", "Document")
    numbered = spec.get("numbered", True)
    parts = []
    parts.append("<!DOCTYPE html>")
    parts.append('<html lang="en"><head><meta charset="utf-8">')
    parts.append(f"<title>{esc(spec['title'])}</title>")
    css = open(os.path.join(SCRIPT_DIR, "sow.css")).read()
    parts.append(f"<style>{css}</style>")
    parts.append("</head><body>")
    parts.append('<a class="skip-link" href="#main">Skip to content</a>')

    if spec.get("cover", True):
        parts.append('<header class="cover" role="banner">')
        parts.append('<div class="cover-bar cover-bar--top"></div>')
        parts.append('<div class="cover-inner">')
        parts.append('<div class="cover-brand">')
        if logo:
            parts.append(f'<img src="{logo}" alt="WebAbility logo">')
        parts.append('<span class="wordmark">WebAbility</span></div>')
        parts.append(
            '<div class="cover-tagline">Digital Accessibility · '
            "Audit &amp; Conformance Practice</div>"
        )
        accent = (
            f'<br><span class="engagement">{esc(spec["title_accent"])}</span>'
            if spec.get("title_accent")
            else ""
        )
        parts.append(f'<h1 class="cover-title">{esc(spec["title"])}{accent}</h1>')
        if spec.get("subtitle"):
            parts.append(f'<p class="cover-sub">{esc(spec["subtitle"])}</p>')
        parts.append('<hr class="cover-rule">')
        meta = []
        if spec.get("prepared_for"):
            meta.append(f"Prepared for <strong>{esc(spec['prepared_for'])}</strong>")
        if spec.get("prepared_by"):
            meta.append(f"Prepared by <strong>{esc(spec['prepared_by'])}</strong>")
        ref_line = []
        if spec.get("reference"):
            ref_line.append(f"Reference <strong>{esc(spec['reference'])}</strong>")
        if spec.get("date"):
            ref_line.append(f"Issued {esc(spec['date'])}")
        if ref_line:
            meta.append(" · ".join(ref_line))
        if spec.get("extra_meta"):
            meta.append(esc(spec["extra_meta"]))
        if meta:
            parts.append(
                '<div class="cover-meta">' + "<br>".join(meta) + "</div>"
            )
        parts.append("</div>")
        parts.append('<div class="cover-bar cover-bar--bottom"></div>')
        parts.append("</header>")

    parts.append('<main id="main">')
    parts.append('<div class="doc-header">')
    parts.append('<div class="brand">')
    if logo:
        parts.append(f'<img src="{logo}" alt="">')
    parts.append("<span>WebAbility</span></div>")
    ref = f" · {esc(spec['reference'])}" if spec.get("reference") else ""
    my = f" · {esc(spec['month_year'])}" if spec.get("month_year") else ""
    parts.append(f'<div class="doc-ref">{esc(doc_type)}{ref}{my}</div>')
    parts.append("</div>")

    if not spec.get("cover", True):
        # No cover: the document opens with an H1 instead.
        parts.append(f"<h2>{esc(spec['title'])}</h2>")

    for i, sec in enumerate(spec["sections"], 1):
        if numbered:
            parts.append(section(i, sec["heading"]))
        else:
            parts.append(f"<h2>{esc(sec['heading'])}</h2>")
        for block in sec.get("blocks", []):
            parts.append(render_block(block))

    parts.append("</main></body></html>")
    return "\n".join(parts)


def main():
    if len(sys.argv) != 3:
        print("Usage: python3 build_doc.py <docspec.json> <output.pdf>",
              file=sys.stderr)
        sys.exit(1)

    spec_path, output_pdf = sys.argv[1], sys.argv[2]
    with open(spec_path) as f:
        spec = json.load(f)

    html_doc = render(spec)
    output_pdf = os.path.abspath(output_pdf)
    html_path = os.path.splitext(output_pdf)[0] + ".html"
    with open(html_path, "w") as f:
        f.write(html_doc)

    chrome = find_chrome()
    result = subprocess.run(
        [chrome, "--headless", "--disable-gpu", "--no-pdf-header-footer",
         "--export-tagged-pdf", "--generate-pdf-document-outline",
         f"--print-to-pdf={output_pdf}", f"file://{html_path}"],
        capture_output=True, text=True, timeout=60,
    )
    if result.returncode != 0:
        print(f"Chrome exited {result.returncode}", file=sys.stderr)
        print(result.stderr, file=sys.stderr)
        sys.exit(result.returncode)

    pdf_size = os.path.getsize(output_pdf)
    print(f"PDF_SIZE:{pdf_size}")
    if pdf_size < 2000:
        print(f"WARNING: PDF is only {pdf_size} bytes — likely empty render",
              file=sys.stderr)
    os.unlink(html_path)


if __name__ == "__main__":
    main()
