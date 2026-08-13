#!/usr/bin/env python3
"""docusign-check.py — prove the DocuSign integration is ready. Safe by default.

Usage:
  python3 docusign-check.py                # auth + userinfo only (read-only)
  python3 docusign-check.py --draft <pdf>  # also create a DRAFT envelope
                                           # (status 'created' — NOBODY is emailed)

Reads DOCUSIGN_* from external/crm/.env. Auth host follows DOCUSIGN_BASE_URL
(demo -> account-d.docusign.com, else account.docusign.com).
"""

import base64
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request

ENV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "..", "..", "..", "..", "..", ".env")


def load_env():
    env = {}
    for line in open(os.path.normpath(ENV_PATH)):
        m = re.match(r"^(DOCUSIGN_[A-Z_]+)=(.*)$", line.rstrip("\n"))
        if m:
            env[m.group(1)] = m.group(2).strip().strip('"')
    missing = [k for k in ("DOCUSIGN_CLIENT_ID", "DOCUSIGN_USER_ID",
                           "DOCUSIGN_ACCOUNT_ID", "DOCUSIGN_PRIVATE_KEY") if not env.get(k)]
    if missing:
        sys.exit(f"missing in .env: {', '.join(missing)}")
    return env


def get_token(env):
    base = env.get("DOCUSIGN_BASE_URL", "https://demo.docusign.net/restapi")
    host = "account-d.docusign.com" if "demo" in base else "account.docusign.com"
    key = env["DOCUSIGN_PRIVATE_KEY"].replace("\\n", "\n")

    def b64u(b):
        return base64.urlsafe_b64encode(b).rstrip(b"=").decode()

    import time
    now = int(time.time())
    header = b64u(json.dumps({"alg": "RS256", "typ": "JWT"}).encode())
    payload = b64u(json.dumps({
        "iss": env["DOCUSIGN_CLIENT_ID"], "sub": env["DOCUSIGN_USER_ID"],
        "aud": host, "iat": now, "exp": now + 600,
        "scope": "signature impersonation"}).encode())
    si = f"{header}.{payload}".encode()
    with tempfile.NamedTemporaryFile("w", suffix=".pem", delete=False) as f:
        f.write(key)
        kf = f.name
    try:
        sig = subprocess.run(["openssl", "dgst", "-sha256", "-sign", kf],
                             input=si, capture_output=True, check=True).stdout
    finally:
        os.unlink(kf)
    jwt = f"{header}.{payload}.{b64u(sig)}"

    data = urllib.parse.urlencode({
        "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
        "assertion": jwt}).encode()
    try:
        with urllib.request.urlopen(urllib.request.Request(
                f"https://{host}/oauth/token", data=data)) as r:
            tok = json.load(r)["access_token"]
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:300]
        hint = ""
        if "user_not_found" in body:
            hint = ("\nHINT: DOCUSIGN_USER_ID is not a user in this environment. "
                    "For demo, copy the User ID from apps-d.docusign.com -> "
                    "Settings -> Apps and Keys.")
        if "consent_required" in body:
            hint = ("\nHINT: grant consent once:\n"
                    f"https://{host}/oauth/auth?response_type=code&scope=signature%20"
                    f"impersonation&client_id={env['DOCUSIGN_CLIENT_ID']}"
                    "&redirect_uri=https://www.docusign.com")
        sys.exit(f"AUTH FAILED {e.code}: {body}{hint}")
    print("AUTH: OK")

    with urllib.request.urlopen(urllib.request.Request(
            f"https://{host}/oauth/userinfo",
            headers={"Authorization": "Bearer " + tok})) as r:
        ui = json.load(r)
    print(f"USER: {ui.get('name')} <{ui.get('email')}>")
    account = None
    for a in ui.get("accounts", []):
        star = " (matches .env ACCOUNT_ID)" if a["account_id"] == env["DOCUSIGN_ACCOUNT_ID"] else ""
        print(f"ACCOUNT: {a['account_id']} | {a['account_name']} | {a['base_uri']}{star}")
        if a["account_id"] == env["DOCUSIGN_ACCOUNT_ID"]:
            account = a
    if account is None:
        print("WARNING: .env DOCUSIGN_ACCOUNT_ID does not match any account above — "
              "update it to one of the listed account_ids.")
        account = next((a for a in ui.get("accounts", []) if a.get("is_default")),
                       ui.get("accounts", [{}])[0])
    return tok, account


def create_draft(tok, account, env, pdf_path):
    base = account["base_uri"] + "/restapi"
    pdf64 = base64.b64encode(open(pdf_path, "rb").read()).decode()

    def anchor_tabs(sn, dt):
        return {"signHereTabs": [{"anchorString": sn, "anchorUnits": "pixels",
                                  "anchorXOffset": "0", "anchorYOffset": "-20"}],
                "dateSignedTabs": [{"anchorString": dt, "anchorUnits": "pixels",
                                    "anchorXOffset": "0", "anchorYOffset": "-10"}]}

    envelope = {
        "emailSubject": "TEST DRAFT — do not send",
        "documents": [{"documentBase64": pdf64, "name": "sow-draft-test.pdf",
                       "fileExtension": "pdf", "documentId": "1"}],
        "recipients": {"signers": [
            {"email": "support@webability.io", "name": "Sidharth Nayyar",
             "recipientId": "1", "routingOrder": "1",
             "tabs": anchor_tabs("/sn1/", "/dt1/")},
            {"email": "support@webability.io", "name": "Test Client Signer",
             "recipientId": "2", "routingOrder": "2",
             "tabs": anchor_tabs("/sn2/", "/dt2/")},
        ]},
        "status": "created",  # DRAFT — nobody is emailed
    }
    req = urllib.request.Request(
        f"{base}/v2.1/accounts/{account['account_id']}/envelopes",
        data=json.dumps(envelope).encode(),
        headers={"Authorization": "Bearer " + tok,
                 "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            out = json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"DRAFT FAILED {e.code}: {e.read().decode()[:400]}")
    print(f"DRAFT ENVELOPE: OK — id {out['envelopeId']} status {out['status']}")
    print("Nobody was emailed. Review/delete it in the DocuSign web UI (Drafts).")


def main():
    env = load_env()
    tok, account = get_token(env)
    if len(sys.argv) > 2 and sys.argv[1] == "--draft":
        create_draft(tok, account, env, sys.argv[2])
    else:
        print("\nReady. To also prove envelope creation (draft, no email):")
        print("  python3 docusign-check.py --draft /tmp/Zonar-SOW-2026-0813-v6.pdf")


if __name__ == "__main__":
    main()
