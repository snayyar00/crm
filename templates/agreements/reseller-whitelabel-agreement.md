# Reseller & White-Label Partnership Agreement

**Template — fill all `{{…}}` placeholders before use.**
`<!-- PROPOSED: ... -->` marks a default invented for this template rather than taken from an
agreed deal term. Review each before sending. This is not legal advice; have a lawyer review
it before first use.

Commercial terms in Sections 3 and 6 ($1,400/yr, unlimited sites, 100 audit hours, CNAME +
SMTP + logo white-labelling) are taken verbatim from the reseller offer sent to a real partner
on 2026-07-02 — they are not invented.

---

## 1. Parties

This Reseller & White-Label Partnership Agreement (the "Agreement") is made on
**{{EFFECTIVE_DATE}}** between:

- **TECHYWEB SOLUTIONS INC.**, doing business as **WebAbility.io**, incorporated in British
  Columbia, Canada (incorporation no. BC1350554, business no. 744220807), registered office
  7300 Edmonds St, Burnaby, BC V3N 0G8, Canada ("**WebAbility**", "we", "us"); and
- **{{PARTNER_LEGAL_NAME}}**, doing business as **{{PARTNER_TRADE_NAME}}**, a
  {{PARTNER_ENTITY_TYPE}} organised under the laws of {{PARTNER_JURISDICTION}}, principal
  place of business {{PARTNER_ADDRESS}} ("**Partner**", "you").

Each a "Party"; together the "Parties".

## 2. What this Agreement covers

WebAbility provides:

(a) the **Widget** — a JavaScript accessibility widget that applies runtime fixes to the
    rendered experience of a web page;
(b) the **Scanner** — automated accessibility scanning and reporting, including PDF reports
    and API access; and
(c) **Audit Services** — manual WCAG 2.2 AA audits, remediation, VPAT/ACR reports and
    accessibility statements, performed by humans.

Together, the "**Services**". Partner resells the Services to its own clients ("**End
Clients**") under Partner's brand.

## 3. Appointment and licence grant

3.1 **Appointment.** WebAbility appoints Partner a non-exclusive reseller. Partner may market,
sell and price the Services to End Clients under its own brand and keeps the margin over the
fees in Section 6. WebAbility may still sell directly and through other resellers.

3.2 **Licence.** For the Term, WebAbility grants Partner a non-exclusive, non-transferable,
non-sublicensable (except deployment to End Clients as intended) licence to:

- deploy the Widget on an unlimited number of End Client sites;
- use the Scanner, including its API, for End Client work, including integrating scan output
  into Partner's own tooling;
- rebrand and use the partner asset pack WebAbility provides (value-proposition deck,
  compliance checklists, "how it works" documents, product screenshots, branding) as its own.

3.3 **White-label scope.** WebAbility will configure, and Partner may present under its brand:
the Widget served from Partner's domain via CNAME; Partner's logo and colours across the
Widget, Scanner and PDF reports; product email sent through Partner's SMTP. WebAbility performs
all white-label configuration; Partner does not access or modify the underlying config, code or
infrastructure.

3.4 **Limits.** Partner must not: reverse-engineer, copy or build a competing product from the
Services; remove notices WebAbility reasonably requires to remain; resell other than to End
Clients under this arrangement, or grant sub-reseller rights, without written consent; register
a trademark, domain or company name confusingly similar to "WebAbility"; or use the Services
unlawfully.

3.5 **Ownership.** WebAbility retains all intellectual property in the Services and underlying
technology, including improvements. Partner retains its own brand and marks. Neither Party
gains rights in the other's IP beyond the licences stated here.

## 4. Marketing claims — accessibility and legal compliance

**This clause is a condition of the licence in Section 3, not a mere covenant. Breach is
grounds for immediate termination under Section 9.3.**

4.1 **What the Widget is.** The Widget improves the rendered experience of a web page by
applying fixes at runtime. It does **not** modify the End Client's source code, and it does
**not**, by itself, make a website compliant with WCAG, the ADA, Section 508, the AODA, the
European Accessibility Act or any other accessibility law or standard. Conformance depends on
the End Client's own source code, content and development practices.

4.2 **Prohibited claims.** Partner must not state or imply — in marketing, sales conversations,
proposals, contracts or product descriptions — that:

- installing the Widget alone makes a website "compliant", "ADA compliant", "WCAG conformant",
  "lawsuit-proof" or words to that effect;
- the Widget guarantees protection from accessibility complaints, demand letters or litigation;
- automated tooling (Widget plus Scanner) is equivalent to a manual audit or full remediation.

4.3 **Permitted claims.** Partner may accurately describe what the Services do: that the Widget
applies runtime accessibility fixes and improves usability; that the Scanner identifies issues
against WCAG criteria; and that manual audits, remediation and conformance reports are
available as human-performed services. Conformance language ("audited against WCAG 2.2 AA") may
be used only for work actually delivered under the Audit Services.

4.4 **Flow-down.** Partner must not promise End Clients any outcome prohibited by 4.2, and must
pass the disclaimer in 10.2 through to its End Client terms in substance.

4.5 **Remedies.** On notice of a prohibited claim, Partner must correct or withdraw it within
5 business days. <!-- PROPOSED: 5-business-day cure; repeated or uncured breach = immediate termination. -->

## 5. What WebAbility provides

5.1 **Setup.** WebAbility performs the white-label setup in 3.3 on receiving Partner's brand
assets, DNS access for the CNAME record and SMTP credentials.

5.2 **Asset pack.** WebAbility provides and periodically updates the partner asset drive.

5.3 **Operation.** WebAbility hosts and operates the Widget and Scanner and maintains their
availability with reasonable skill and care.
<!-- PROPOSED: deliberately no SLA or uptime percentage — a one-person company should not sign
     up to service credits and reporting it cannot administer. Add one only if the partner insists. -->

## 6. Fees, payment and audit hours

6.1 **Reseller fee.** **USD $1,400 per year** {{OR_ALTERNATE_FEE}}, covering unlimited End
Client sites and the audit hours in 6.3.

6.2 **Payment terms.** Annual fee payable in advance — first payment on signing, renewals on or
before the renewal date. Invoices due within 14 days.
<!-- PROPOSED: annual prepay, net-14. --> Fees are non-refundable except as stated in Section 9,
and exclude applicable taxes. Partner bills and collects from End Clients; WebAbility never
invoices End Clients.

6.3 **Included audit hours.** Each contract year includes **100 hours** of manual auditing work
(audits, remediation, VPAT/ACR, accessibility statements) for Partner's End Clients.

- **Drawdown:** against actual time worked, recorded in 0.5-hour increments, reported on
  request and at renewal. <!-- PROPOSED -->
- **Rollover:** unused hours expire at the end of the contract year.
  <!-- PROPOSED: no rollover — protects a one-person company from an accumulating labour liability. -->
- **Overage:** beyond 100 hours, quoted and agreed in writing before work starts, at
  {{OVERAGE_HOURLY_RATE}}. <!-- PROPOSED: no work begins without written sign-off. -->
- **Scheduling:** by mutual agreement; hours cannot be demanded on less than
  {{AUDIT_LEAD_TIME}} notice.
  <!-- PROPOSED: suggest 10 business days, so 100 hours cannot all be called in one week. -->

6.4 **Price changes.** WebAbility may change the renewal fee on at least 60 days' written
notice before renewal. Partner's remedy is non-renewal. <!-- PROPOSED -->

## 7. Support boundaries

7.1 **First line: Partner.** End Clients contact Partner. Partner handles all End Client
communication, onboarding, billing and first-line support. WebAbility has no direct
relationship with, and no obligation to communicate with, End Clients.

7.2 **Second line: WebAbility.** Partner escalates unresolved technical issues to
{{SUPPORT_EMAIL}}. WebAbility acknowledges within 2 business days and works with reasonable
diligence. <!-- PROPOSED: acknowledgement only, no resolution-time commitment. -->

7.3 Support is in English, during Pacific-timezone business hours. <!-- PROPOSED -->

## 8. Client data, confidentiality and deliverables

8.1 **End Client data.** As between the Parties, Partner (or the End Client) owns End Client
data. Partner is responsible for the rights, consents and lawful basis needed for WebAbility to
scan End Client sites, deploy the Widget and process the resulting data. WebAbility processes
End Client data only to provide the Services, does not sell it, and does not use it to market
to End Clients.

8.2 **Confidentiality.** Each Party keeps the other's non-public business, technical and
pricing information confidential, uses it only for this Agreement, and protects it with at
least reasonable care. Excludes information that is public, independently developed or lawfully
received from a third party; disclosure required by law is permitted with notice where lawful.
Survives 3 years after termination. <!-- PROPOSED -->

8.3 **Audit deliverables.** On payment, End Client-facing audit deliverables (reports, VPAT/ACR
documents, accessibility statements, remediation guidance) are owned by Partner and may be
delivered under Partner's brand. WebAbility retains its methodologies, templates, checklists
and tooling and may reuse them. Partner must not alter the substantive findings or conformance
conclusions of a deliverable while still attributing the work to the audit — cosmetic
rebranding is fine; changing results is not.

8.4 **Publicity.** Neither Party names the other publicly without written consent, except that
WebAbility may identify Partner in confidential contexts (e.g. to investors under NDA).
<!-- PROPOSED: mutual restriction, consistent with white-label positioning. -->

## 9. Term, renewal and termination

9.1 **Term.** One year from the Effective Date, renewing automatically for further one-year
terms unless either Party gives written non-renewal notice at least 30 days before renewal.
<!-- PROPOSED -->

9.2 **Termination for convenience.** By the non-renewal notice above, at the end of the
then-current term. <!-- PROPOSED: no mid-term termination for convenience; the annual fee is the commitment. -->

9.3 **Termination for cause.** Immediately on written notice if the other Party materially
breaches and fails to cure within 15 days <!-- PROPOSED -->; or immediately without cure for a
repeated or uncured breach of Section 4, non-payment more than 30 days overdue after notice, or
insolvency.

9.4 **Effect of termination — End Client wind-down.** The commercially important clause:

- **Wind-Down Period.** For 60 days after termination, Widgets already installed on End Client
  sites keep working, so End Client sites do not break overnight. <!-- PROPOSED -->
- **During wind-down** Partner onboards no new End Client sites and either migrates End Clients
  to a direct relationship with WebAbility (if both agree) or transitions them off the Services.
- **After wind-down** WebAbility may disable the white-label configuration and stop serving the
  Widget to Partner's End Client sites, on 14 days' prior notice. <!-- PROPOSED -->
- **Where termination follows a Section 4 breach**, WebAbility may shorten the Wind-Down Period
  if continued operation creates legal exposure, giving at least 14 days' notice where
  practicable. <!-- PROPOSED -->
- **Asset pack and brand.** Partner stops distributing the rebranded asset pack and stops
  representing that it resells the Services. Materials already delivered to End Clients need
  not be recalled.
- **Deliverables and data.** Paid-for audit deliverables remain Partner's (8.3). On written
  request within 30 days WebAbility exports Partner's account data in a reasonable format, then
  deletes it save for law and backups. <!-- PROPOSED -->
- **Fees.** No refund of prepaid fees, except that if Partner terminates for WebAbility's
  uncured material breach, WebAbility refunds the prorated unused portion of the annual fee.
  Unused audit hours are not refundable in cash. <!-- PROPOSED -->

9.5 **Survival.** Sections 4.4 (as to existing End Client contracts), 8, 10, 11 and 12 survive.

## 10. Warranties and disclaimers

10.1 **Mutual.** Each Party warrants it has the right and authority to enter this Agreement.

10.2 **Accessibility disclaimer.** WebAbility warrants it will provide the Services with
reasonable skill and care. However, **WebAbility does not warrant, and Partner acknowledges,
that the Widget or Scanner will make any website conform to WCAG or comply with any
accessibility law.** Conformance depends on the End Client's own source code, content,
third-party embeds and ongoing development practices, which WebAbility does not control.
Automated runtime fixes address only a subset of accessibility issues; full conformance
requires changes to the underlying site. Except as expressly stated, the Services are provided
without other warranties, and implied warranties are excluded so far as the law allows.

10.3 **Legal advice.** Nothing WebAbility provides — reports, checklists, VPAT/ACR documents,
accessibility statements — is legal advice. End Clients remain responsible for their own
compliance.

## 11. Liability

11.1 **Cap.** Each Party's total aggregate liability is limited to the fees paid or payable by
Partner in the 12 months before the event giving rise to the claim. <!-- PROPOSED -->

11.2 **Exclusions.** Neither Party is liable for indirect or consequential loss, loss of
profits, business or data, even if advised of the possibility.

11.3 **Carve-outs.** The cap and exclusions do not apply to: Partner's breach of Section 4;
either Party's breach of 8.2; Partner's unpaid fees; or liability that cannot be excluded by
law, including fraud. <!-- PROPOSED: putting a marketing-claims breach outside the cap is the teeth behind Section 4. -->

11.4 **Indemnity.** Partner indemnifies WebAbility against third-party claims — including End
Client claims and accessibility demand letters or lawsuits — arising from Partner
representations exceeding what 4.3 permits, or from End Client contracts promising outcomes
prohibited by 4.2. <!-- PROPOSED: one-way indemnity scoped narrowly to overclaiming, the specific risk overlay vendors have been sued over. -->

## 12. Governing law and disputes

<!-- Swappable clause. Default is British Columbia. To change jurisdiction (a previous customer
     required Norwegian law and got it), replace only the two placeholders below. -->

12.1 Governed by the laws of **{{GOVERNING_LAW: the Province of British Columbia and the
federal laws of Canada applicable there}}**, without regard to conflict-of-law rules.

12.2 The Parties will first try in good faith to resolve any dispute by direct discussion
within 30 days. Failing that, disputes fall to the exclusive jurisdiction of the courts of
**{{FORUM: Vancouver, British Columbia}}**.
<!-- PROPOSED: courts rather than arbitration, to avoid administering an arbitration process. -->

## 13. General

- **Independent contractors.** Partner is not WebAbility's agent, may not bind WebAbility, and
  sells to End Clients in its own name and on its own terms (subject to 4.4 and 10).
- **Assignment.** Not without the other's written consent, except to a successor in a merger or
  sale of substantially all assets, with notice.
- **Entire agreement.** This replaces prior discussions and emails on its subject matter.
- **Amendment.** In writing and signed; email confirmation by both signatories counts.
  <!-- PROPOSED: keeps administration light. -->
- **Notices.** By email to the addresses below, copied to the registered/principal address for
  termination notices, effective on the business day received.
  WebAbility: {{WEBABILITY_NOTICE_EMAIL}} · Partner: {{PARTNER_NOTICE_EMAIL}}
- **Severability & waiver.** If a clause is unenforceable the rest stands; not enforcing a right
  once does not waive it.
- **Force majeure.** Neither Party is liable for delay beyond its reasonable control (excluding
  payment obligations).
- **Counterparts & e-signature.** May be signed in counterparts and electronically.

## 14. Signatures

**TECHYWEB SOLUTIONS INC.** (dba WebAbility.io)

| | |
|---|---|
| Signature | ______________________________ |
| Name | Sidharth Nayyar |
| Title | Founder |
| Date | ______________________________ |

**{{PARTNER_LEGAL_NAME}}** (dba {{PARTNER_TRADE_NAME}})

| | |
|---|---|
| Signature | ______________________________ |
| Name | {{PARTNER_SIGNATORY_NAME}} |
| Title | {{PARTNER_SIGNATORY_TITLE}} |
| Date | ______________________________ |

---

### Fill sheet

| Placeholder | Value |
|---|---|
| `{{PARTNER_LEGAL_NAME}}` | registered legal name — confirm with the partner |
| `{{PARTNER_TRADE_NAME}}` | trading name |
| `{{PARTNER_SIGNATORY_NAME}}` / `{{PARTNER_SIGNATORY_TITLE}}` | who signs |
| `{{PARTNER_JURISDICTION}}` / `{{PARTNER_ADDRESS}}` | state/country of formation and address |
| `{{OVERAGE_HOURLY_RATE}}` | **not derivable from any existing term — decide before sending** |
| `{{AUDIT_LEAD_TIME}}` | suggested 10 business days |
| `{{SUPPORT_EMAIL}}` | support@webability.io |
| `{{GOVERNING_LAW}}` / `{{FORUM}}` | BC default; swap per the Section 12 comment |
