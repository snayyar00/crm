#!/usr/bin/env python3
"""build_sow.py — generate a branded WebAbility SOW as a tagged/accessible PDF.

Usage: python3 build_sow.py <config.json> <output.pdf>

Replicates the design of the signed Questback SOW (SOW-2026-0417):
navy full-bleed cover, numbered sections 01-14, serif body, navy-header
tables, fee banner, and a two-column Execution block. Rendered to a
tagged PDF via headless Chrome.
"""

import base64
import html
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent

PROVIDER_DEFAULTS = {
    "legal_name": "TechyWeb Solutions Inc.",
    "dba": "operating as WebAbility.io",
    "address": "7300 Edmonds St, Burnaby, BC V3N 0G8, Canada",
    "registration": "BC Inc. No. BC1350554 · Business No. 744220807",
    "contact_name": "Sidharth Nayyar",
    "contact_title": "Founder",
    "contact_email": "support@webability.io",
    "brand": "WebAbility.io",
}

GOVERNING_LAW_DEFAULT = (
    "This Statement of Work is governed by the laws of the Province of "
    "British Columbia, Canada, and the parties submit to the exclusive "
    "jurisdiction of the courts of British Columbia sitting in Vancouver "
    "for any dispute arising out of or in connection with it."
)


def find_chrome():
    for binary in [
        "google-chrome", "google-chrome-stable", "chromium",
        "chromium-browser", "chrome",
    ]:
        path = shutil.which(binary)
        if path:
            return path
    for candidate in [
        "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium", "/usr/bin/chromium-browser",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ]:
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    sys.exit("chrome-not-found")


def esc(s):
    return html.escape(str(s), quote=False)


def logo_data_uri():
    mark = SCRIPT_DIR / "webability-mark.png"
    if not mark.exists():
        return None
    return "data:image/png;base64," + base64.b64encode(mark.read_bytes()).decode()


def section(num, title):
    return f'<h2><span class="num">{num:02d}</span>{esc(title)}</h2>'


def bullets(items):
    lis = "\n".join(f"<li>{esc(i)}</li>" for i in items)
    return f"<ul>\n{lis}\n</ul>"


def table(headers, rows, cls=""):
    """rows: list of lists of RAW HTML cell strings (caller escapes data)."""
    ths = "".join(f'<th scope="col">{esc(h)}</th>' for h in headers)
    trs = "\n".join(
        "<tr>" + "".join(f"<td>{cell}</td>" for cell in row) + "</tr>"
        for row in rows
    )
    c = f' class="{cls}"' if cls else ""
    return (
        f"<table{c}>\n<thead><tr>{ths}</tr></thead>\n"
        f"<tbody>\n{trs}\n</tbody>\n</table>"
    )


def render(config):
    c = config
    prov = {**PROVIDER_DEFAULTS, **c.get("provider", {})}
    client = c["client"]
    client_name = client["company_name"]
    fee = c["fee"]
    scope = c.get("scope", {})
    logo = logo_data_uri()

    engagement_title = c.get(
        "engagement_title",
        f"{scope.get('standard', 'WCAG 2.2 AA')} Conformance Engagement",
    )
    cover_sub = c.get(
        "cover_subtitle",
        "Accessibility Audit · Remediation Support · VPAT/ACR · "
        f"{c.get('recheck_months', 8)}-Month Re-check",
    )
    month_year = c.get("month_year", c.get("date", ""))
    doc = c.get("document_control", {})

    parts = []
    parts.append("<!DOCTYPE html>")
    parts.append('<html lang="en"><head><meta charset="utf-8">')
    parts.append(
        f"<title>Statement of Work {esc(c['sow_ref'])} — "
        f"{esc(client_name)}</title>"
    )
    css = (SCRIPT_DIR / "sow.css").read_text()
    parts.append(f"<style>{css}</style>")
    parts.append("</head><body>")
    parts.append('<a class="skip-link" href="#main">Skip to content</a>')

    # ---------- Cover ----------
    parts.append('<header class="cover" role="banner">')
    parts.append('<div class="cover-bar cover-bar--top"></div>')
    parts.append('<div class="cover-inner">')
    parts.append('<div class="cover-brand">')
    if logo:
        parts.append(f'<img src="{logo}" alt="WebAbility logo">')
    parts.append('<span class="wordmark">WebAbility</span>')
    parts.append("</div>")
    parts.append(
        '<div class="cover-tagline">Digital Accessibility · '
        "Audit &amp; Conformance Practice</div>"
    )
    parts.append(
        f'<h1 class="cover-title">Statement of Work<br>'
        f'<span class="engagement">{esc(engagement_title)}</span></h1>'
    )
    parts.append(f'<p class="cover-sub">{esc(cover_sub)}</p>')
    parts.append('<hr class="cover-rule">')
    parts.append('<div class="cover-meta">')
    attn = client.get("contact_name", "")
    if client.get("contact_title"):
        attn += f", {client['contact_title']}"
    parts.append(
        f"Prepared for <strong>{esc(client_name)}</strong>"
        + (f" · Attn. {esc(attn)}" if attn else "")
        + "<br>"
    )
    parts.append(
        f"Prepared by <strong>{esc(prov['brand'])}</strong> · "
        f"{esc(prov['contact_name'])}, {esc(prov['contact_title'])}<br>"
    )
    validity = ""
    if c.get("signer_deadline"):
        validity = f" · Offer valid through {esc(c['signer_deadline'])}"
    parts.append(
        f"Reference <strong>{esc(c['sow_ref'])}</strong> · "
        f"Issued {esc(c['date'])}{validity}"
    )
    parts.append("</div></div>")
    parts.append('<div class="cover-bar cover-bar--bottom"></div>')
    parts.append("</header>")

    # ---------- Inner pages ----------
    parts.append('<main id="main">')

    parts.append('<div class="doc-header">')
    parts.append('<div class="brand">')
    if logo:
        parts.append(f'<img src="{logo}" alt="">')
    parts.append("<span>WebAbility</span></div>")
    parts.append(
        f'<div class="doc-ref">Statement of Work · {esc(c["sow_ref"])}'
        + (f" · {esc(month_year)}" if month_year else "")
        + "</div>"
    )
    parts.append("</div>")

    # 01 Executive Summary
    parts.append(section(1, "Executive Summary"))
    parts.append('<div class="callout">')
    summary_paras = c.get("executive_summary") or [
        f"WebAbility will conduct an independent {scope.get('standard', 'WCAG 2.2 AA')} "
        f"conformance engagement covering {esc(scope.get('target', client_name))}. "
        "The engagement follows the W3C's formal evaluation methodology (WCAG-EM) "
        "and concludes with conformance documentation suitable for customer "
        "procurement and regulatory contexts.",
        "The engagement runs five to six weeks from kickoff and includes a "
        f"re-check {c.get('recheck_months', 8)} months after delivery. We retest "
        "every fix before the conformance documentation is issued, and the VPAT "
        "is authored to reflect the product's actual conformance level (a "
        "Partially Conformant report is the expected and honest outcome for a "
        "live application).",
    ]
    for p in summary_paras:
        parts.append(f"<p>{esc(p)}</p>")
    parts.append("</div>")

    # 02 Parties & Document Control
    parts.append(section(2, "Parties & Document Control"))
    provider_cell = (
        f'<div class="cell-title">{esc(prov["legal_name"])}</div>'
        f'<div class="cell-sub">{esc(prov["dba"])}</div>'
        f"{esc(prov['address'])}<br>"
        f'<div class="cell-fine">{esc(prov["registration"])}</div>'
        f"{esc(prov['contact_name'])}, {esc(prov['contact_title'])}<br>"
        f"{esc(prov['contact_email'])}"
    )
    client_lines = [f'<div class="cell-title">{esc(client_name)}</div>']
    client_lines.append('<div class="cell-sub">Client</div>')
    if client.get("address"):
        client_lines.append(f"{esc(client['address'])}<br>")
    elif client.get("domain"):
        client_lines.append(f"{esc(client['domain'])}<br>")
    if client.get("contact_name"):
        line = esc(client["contact_name"])
        if client.get("contact_title"):
            line += f", {esc(client['contact_title'])}"
        client_lines.append(line + "<br>")
    if client.get("contact_email"):
        client_lines.append(esc(client["contact_email"]))
    parts.append(
        table(
            [f'Service Provider ("WebAbility")', f'Client ("{client_name}")'],
            [[provider_cell, "".join(client_lines)]],
            cls="parties",
        )
    )
    parts.append(
        table(
            ["Reference", "Version", "Classification", "Validity"],
            [[
                esc(c["sow_ref"]),
                esc(doc.get("version", "1.0")),
                esc(doc.get("classification", "Private & Confidential")),
                esc(doc.get(
                    "validity",
                    f"Through {c['signer_deadline']}" if c.get("signer_deadline")
                    else "Until superseded",
                )),
            ]],
        )
    )

    # 03 Background & Objective
    parts.append(section(3, "Background & Objective"))
    for p in c.get("background_paras", [c.get("background", "")]):
        if p:
            parts.append(f"<p>{esc(p)}</p>")

    # 04 Scope of Engagement
    parts.append(section(4, "Scope of Engagement"))
    parts.append(f'<h3 class="kicker">4.1 · In Scope</h3>')
    if c.get("scope_intro"):
        parts.append(f"<p>{esc(c['scope_intro'])}</p>")
    if c.get("scope_details"):
        parts.append(bullets(c["scope_details"]))
    if scope.get("pages"):
        pages = scope["pages"]
        pages = pages[0].lower() + pages[1:] if pages else pages
        parts.append(
            "<p>The definitive page-and-state inventory is confirmed jointly "
            f"at kickoff and frozen in writing; the audit covers {esc(pages)} "
            "as scoped.</p>"
        )
    if c.get("out_of_scope"):
        parts.append(f'<h3 class="kicker">4.2 · Out of Scope</h3>')
        parts.append(bullets(c["out_of_scope"]))

    # 05 Methodology
    parts.append(section(5, "Methodology"))
    parts.append(
        "<p>The audit follows the W3C Website Accessibility Conformance "
        "Evaluation Methodology (WCAG-EM): scope definition, representative "
        "sampling across all component types, evaluation, and reporting. "
        "Testing combines:</p>"
    )
    parts.append(
        "<ul>"
        "<li><strong>Automated scanning</strong> of every in-scope page "
        "(multi-engine, including axe-core)</li>"
        "<li><strong>Manual expert testing</strong>: keyboard-only operation; "
        "screen reader matrix (NVDA + Chrome/Firefox on Windows 11, VoiceOver "
        "+ Safari on macOS and iOS); 200–400% zoom and reflow; text spacing; "
        "color and non-text contrast; pointer and dragging alternatives "
        "(WCAG 2.2 §2.5.7); target size (§2.5.8); and focus management</li>"
        "</ul>"
    )
    parts.append(
        "<p>Every finding is documented with the failed WCAG 2.2 checkpoint, "
        "severity, test environment, expected vs. actual result, user impact, "
        "annotated screenshot evidence, and an engineering recommendation.</p>"
    )

    # 06 Deliverables
    parts.append(section(6, "Deliverables"))
    rows = []
    for d in c["deliverables"]:
        if isinstance(d, dict):
            rows.append([f'{esc(d["name"])}', esc(d["desc"])])
        else:
            rows.append([esc(d), ""])
    parts.append(table(["Deliverable", "Description"], rows))
    parts.append(
        f"<p><strong>Deliverable review &amp; correction.</strong> "
        f"{esc(client_name)} has a review period of five (5) business days "
        "for each deliverable. WebAbility will correct, at no additional "
        "cost, any deliverable that is materially incomplete or does not "
        "conform to the scope and descriptions set out in this section.</p>"
    )

    # 07 Timeline & Engagement Cadence
    parts.append(section(7, "Timeline & Engagement Cadence"))
    tl_rows = [
        [esc(w["label"]), esc(w["desc"])] for w in c.get("timeline_weeks", [])
    ]
    if tl_rows:
        parts.append(table(["Phase", "Milestone"], tl_rows))
    kickoff = c.get("timeline", {}).get("kickoff", "the week following signature")
    parts.append(
        f"<p><strong>Target start: {esc(kickoff)}</strong> (confirmed at "
        "kickoff). Written status reports are issued every Friday. Any "
        "barrier that fully blocks a user is escalated to your technical "
        "contact within 24 hours of discovery. Critical findings are never "
        "held for the final report.</p>"
    )

    # 08 Client Responsibilities
    parts.append(section(8, "Client Responsibilities"))
    parts.append(bullets(c.get("client_responsibilities", [
        "Provide a stable test environment/link for the scoped flow, frozen "
        "for the duration of the audit window",
        "Name a technical point of contact for remediation coordination and "
        "fix delivery",
        "Apply remediation within the project window so validation and the "
        "ACR complete on schedule",
        "Return the completed engagement intake questionnaire ahead of kickoff",
    ])))

    # 09 Professional Fees
    parts.append(section(9, "Professional Fees"))
    amount = f"{fee['currency']} ${fee['amount']:,.0f}"
    fee_label = fee.get("label", "All-Inclusive Engagement Fee")
    fee_note = fee.get("banner_note", fee.get("discount_note", ""))
    parts.append('<div class="fee-banner">')
    parts.append(
        f'<div><div class="amount">{esc(amount)}</div>'
        f'<div class="fee-label">{esc(fee_label)}</div></div>'
    )
    if fee_note:
        parts.append(f'<div class="fee-note">{fee_note}</div>')
    parts.append("</div>")
    fee_bullets = c.get("fee_terms", [
        "One-time fee, invoiced in full on execution of this SOW; terms "
        + fee.get("payment_terms", "Net 15"),
        "Invoiced electronically; payment by card or bank transfer",
        "The fee covers every deliverable in §06, including the "
        f"{c.get('recheck_months', 8)}-month re-check and 12 months of "
        "CLI/MCP access. No additional charges without prior written "
        "agreement.",
    ])
    parts.append(bullets(fee_bullets))

    # 10 Assumptions & Limitations
    parts.append(section(10, "Assumptions & Limitations"))
    parts.append(bullets(c.get("assumptions", [
        f"Conformance outcomes depend on {client_name} implementing the "
        "recommended remediation; the ACR reflects the state of the product "
        "as validated at issuance.",
        "WCAG conformance assessment involves expert judgment; WebAbility "
        "warrants a diligent, methodology-driven evaluation, not immunity "
        "from third-party claims.",
        "Material scope additions (new pages, flows, or products) are "
        "handled by written change order.",
    ])))

    # 11 Confidentiality & IP
    parts.append(section(11, "Confidentiality & Intellectual Property"))
    parts.append(
        "<p>Each party will keep the other's non-public information "
        "confidential and use it solely for this engagement. Upon full "
        f"payment, all reports and deliverables produced under this SOW are "
        f"owned by {esc(client_name)}. WebAbility retains ownership of its "
        "tools, methodologies, and pre-existing materials, and may reference "
        f"the engagement anonymously; naming {esc(client_name)} as a customer "
        f"requires {esc(client_name)}'s prior written consent.</p>"
    )
    parts.append('<h3 class="kicker">11.1 · No Production or Customer Data</h3>')
    parts.append(
        "<p>The engagement is performed solely against "
        f"{esc(client_name)}-provided environments and materials. No "
        "production data, customer data, production logs containing personal "
        "data, or other personal data will be accessible or made available "
        "to WebAbility. If any such data is inadvertently made available, "
        f"WebAbility will promptly notify {esc(client_name)}, stop using it, "
        "and delete it unless otherwise agreed in writing.</p>"
    )
    parts.append(
        '<h3 class="kicker">11.2 · Handling &amp; Deletion of Client '
        "Materials</h3>"
    )
    parts.append(
        f"<p>{esc(client_name)} materials — including screenshots, test "
        "links, credentials, reports-in-progress, and logs — are kept "
        "confidential and are returned or securely deleted after completion "
        f"of the engagement or earlier upon {esc(client_name)}'s request.</p>"
    )
    parts.append('<h3 class="kicker">11.3 · Tooling, CLI &amp; MCP Data Use</h3>')
    parts.append(
        "<p>WebAbility's CLI, MCP integration, scanning tools, support "
        "channels, and related tooling will not transmit, store, or disclose "
        f"{esc(client_name)}'s confidential information, source code, "
        "credentials, screenshots, logs, or product data to any third party "
        f"without {esc(client_name)}'s prior written approval.</p>"
    )

    # 12 Term & Termination
    parts.append(section(12, "Term & Termination"))
    parts.append(
        "<p>Either party may terminate for material breach with 14 days' "
        "written notice and opportunity to cure. On termination, "
        f"{esc(client_name)} pays for work performed to date and receives "
        "all completed work product.</p>"
    )

    # 13 Governing Law & Venue
    parts.append(section(13, "Governing Law & Venue"))
    parts.append(f"<p>{esc(c.get('governing_law', GOVERNING_LAW_DEFAULT))}</p>")

    # 14 Execution
    parts.append(section(14, "Execution"))
    parts.append(
        "<p>By signing below, each party agrees to the terms of this "
        f"Statement of Work ({esc(c['sow_ref'])}).</p>"
    )
    parts.append('<div class="execution">')
    for party, name, title, anchors in [
        (prov["brand"], prov["contact_name"], prov["contact_title"],
         ("/sn1/", "/dt1/")),
        (client_name, client.get("contact_name", ""),
         client.get("contact_title", ""), ("/sn2/", "/dt2/")),
    ]:
        who = esc(name) + (f" · {esc(title)}" if title else "")
        parts.append(
            '<div class="sig-block">'
            f'<div class="sig-party">{esc(party)}</div>'
            f'<div class="sig-line"><span class="sig-anchor">{anchors[0]}'
            "</span></div>"
            '<div class="sig-caption">Signature</div>'
            f'<div class="sig-name">{who}</div>'
            f'<div class="sig-line"><span class="sig-anchor">{anchors[1]}'
            "</span></div>"
            '<div class="sig-caption">Date</div>'
            "</div>"
        )
    parts.append("</div>")

    parts.append("</main></body></html>")
    return "\n".join(parts)


def main():
    if len(sys.argv) != 3:
        print("Usage: python3 build_sow.py <config.json> <output.pdf>",
              file=sys.stderr)
        sys.exit(1)

    config_path, output_pdf = sys.argv[1], sys.argv[2]
    with open(config_path) as f:
        config = json.load(f)

    html_doc = render(config)
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
