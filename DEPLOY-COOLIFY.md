# Deploying this fork on Coolify

Self-hosting notes for `snayyar00/crm`. Upstream deploys on Vercel; this file covers what
changes when it does not.

Deploy from branch **`coolify`**, which is `release` plus the Node pin below.

## Node 24 is required

`apps/agent` runs on eve, which refuses anything below Node 24:

```
eve requires Node.js >=24. You are running v22.15.0.
```

Upstream's root `engines.node` says `>=22`, which is wrong and lets a build image pick 22.
This branch sets `engines.node` to `>=24` and adds `.node-version` and `.nvmrc`, so
nixpacks, railpack and nvm all read the same answer.

Node 22.11 and below additionally break `@crm/db`'s postinstall — `@prisma/dev` `require()`s
an ESM module and throws `ERR_REQUIRE_ESM`.

## Four resources

| Resource | Build (base directory = repo root) | Start |
|---|---|---|
| Postgres | Coolify database | — |
| api | `bun run build --filter=api` | `bun run --filter=api start:prod` |
| app | `bun run build --filter=app` | `bun run --filter=app start` |
| agent | `bun run build --filter=agent` | `bun run --filter=agent start` |

`apps/api` has two start scripts. `start` runs from source; **`start:prod` runs
`bun dist/main.js`** and is the one to use.

Keep the base directory at the repo root, not `apps/<name>`. The root holds `bun.lock`,
`turbo.json` and `packages/*`.

`apps/api/src/generated/server.ts` is committed and the build must never regenerate it —
the generator needs a newer GLIBC than most build images. `bun run build` does not reach
`trpc:generate`. Do not add it.

## Migrations

`bun run db:deploy` as a pre-deploy command on the **api resource only**. Three apps racing
the same migration is a deadlock, not a speedup.

Never run `bun run db:seed` against a Coolify database. It writes invented companies and
deals.

## Domains

Live as deployed:

```
APP_URL             https://app.crm.server.techywebsolutions.com
API_URL             https://api.crm.server.techywebsolutions.com
AUTH_COOKIE_DOMAIN  .crm.server.techywebsolutions.com
```

`*.server.techywebsolutions.com` is a DNS-only wildcard pointing straight at the host, and
DNS wildcards match at any depth — so these names resolved with no record to add, and
Traefik issues their Let's Encrypt certificates itself.

The cookie parent is `.crm.server.techywebsolutions.com`, one level below the wildcard, so
the session cookie does not reach the other staging hosts on that domain.

### If you move to crm.webability.io

Two things, and the first is not obvious:

1. **Add real A records.** `*.webability.io` is a proxied wildcard that already answers for
   `app.crm.webability.io`, so the name resolving proves nothing — it is the wildcard, and
   it points at the wrong origin. Confirm with `dig` on a random sibling name: if
   `random-abcd.crm.webability.io` answers too, no record exists.
2. **Grey-cloud them.** Cloudflare's Universal SSL covers `webability.io` and
   `*.webability.io` — one label only. A proxied `app.crm.webability.io` has no matching
   edge certificate and dies with `ERR_SSL_VERSION_OR_CIPHER_MISMATCH` before Traefik is
   ever reached. DNS-only sidesteps it; the alternative is an advanced certificate pack
   covering `*.crm.webability.io`, which is how `*.pdf.webability.io` already works.

OAuth redirect URIs go on the **API** origin, not the app's:

```
https://api.crm.server.techywebsolutions.com/api/auth/callback/google
https://api.crm.server.techywebsolutions.com/api/auth/callback/microsoft
```

## Internal wiring

Coolify gives databases a stable hostname but app containers do not. Set a
`custom_network_aliases` of `crm-agent` on the agent resource, then:

```
AGENT_URL  http://crm-agent:2000
```

These three must be byte-identical across api, app and agent:

- `DATABASE_URL`
- `BETTER_AUTH_SECRET` — a mismatch is a redirect loop, not an error
- `AGENT_BRIDGE_SECRET` — unset makes the Agent tab report "not configured"

## The sandbox degrades here, on purpose

`eve/dist/src/public/sandbox/backends/default.js` selects in order: Vercel → Docker daemon
→ microsandbox → `justbash`. A plain Coolify container has none of the first three, so it
lands on **`justbash`**.

That drops the `deny-all` egress guarantee `docs/agent.md` describes. This deployment
accepts it: the agent's shell can reach the container network, and the container is the
security boundary instead. The alternative — mounting `/var/run/docker.sock` — is a
container-escape primitive on a host that also runs production services, which is worse.

The rule that still holds: **never give the sandbox `DATABASE_URL`.**

## Mailbox sync

Coolify scheduled task on the api resource, every 5-15 minutes:

```sh
curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://api.crm.webability.io/internal/sync/mailboxes
```

`/internal/sync/mailboxes` and `/internal/sync/google` are aliases for the same handler
(`apps/api/src/sync/sync.controller.ts`); GET and POST both work. Without `CRON_SECRET` the
route returns 503.

The agent's own work queue needs no cron. `eve start` runs `dispatch.ts`; `eve dev` does not.

## Model access

Upstream reaches the Vercel AI Gateway through OIDC, which exists only on Vercel. Off
Vercel the agent has no model until `AI_GATEWAY_API_KEY` is set.

## Telemetry

The API sends one event of counts per day by default. Set `CRM_TELEMETRY_DISABLED="1"` to
stop it.

## Outbound email (Brevo)

The CRM can queue and send email. Brevo rather than Resend because
`support@webability.io` is **already a verified Brevo sender** — no new SPF/DKIM records on a
domain that already carries live customer mail, and replies come from the address customers
already correspond with.

```
BREVO_API_KEY     required — without it dispatch is a logged no-op, never a silent one
EMAIL_FROM        defaults to support@webability.io
EMAIL_FROM_NAME   defaults to WebAbility
```

**Everything lands as `DRAFT`.** `emails.draft` cannot queue; only `emails.release` moves a row
to `QUEUED`, and the dispatcher only ever reads `QUEUED`. A queue that mails on a timer is one
bad row away from sending a customer the wrong thing.

Drain it with a scheduled task on the api resource, same bearer contract as the mailbox route:

```sh
curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://api.crm.server.techywebsolutions.com/internal/sync/emails
```

A send that succeeds writes an `EMAIL` Activity against whichever of
`dealId`/`contactId`/`companyId` the job carried. Three consecutive failures move the row to
`FAILED` and stop — retrying a rejected send forever only burns credits.

**It cannot reply into an existing Gmail thread.** Brevo has no visibility of a Gmail thread id,
so a reply sent this way opens a new conversation on the recipient's side and never appears in
the sender's Gmail sent folder. Use it for new outbound and automation; use the `gog` CLI for
replies to live conversations.

## The obligation alarm

Every stalled deal here stalled because we promised an artifact and never sent it —
an invoice 23 days after a signed SOW, an agreement 34 days after the buyer said yes.
Winning a deal now spawns its five contractual obligations automatically, and this
route is what makes them visible.

```
OBLIGATION_DIGEST_TO   required — the founder's address. No default: the route
                       refuses rather than guess a recipient.
```

Schedule it as a morning task on the api resource, same bearer contract as the others:

```sh
curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://api.crm.server.techywebsolutions.com/internal/sync/obligations
```

**A quiet run is the expected outcome.** It returns `{ sent: false, reason: "clean" }`
on any day with nothing overdue or due within three days, and sends no mail at all.
That silence is the design: an alarm that arrives every morning with "due in 14 days"
teaches you inside a week that it is skippable, and then the one carrying a
23-day-overdue signed contract gets archived with the rest.

It enqueues as QUEUED rather than DRAFT — the only place in this system that bypasses
the human-release gate. That gate exists so a human approves outbound CUSTOMER mail;
this is internal mail to the founder, and requiring him to release it to himself would
deadlock on the exact inattention it is built to fix. The recipient is pinned from
`OBLIGATION_DIGEST_TO` in the controller so the bypass can never address a customer.
