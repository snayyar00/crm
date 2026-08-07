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

```
APP_URL             https://app.crm.webability.io
API_URL             https://api.crm.webability.io
AUTH_COOKIE_DOMAIN  .crm.webability.io
```

The cookie parent is `.crm.webability.io` and must stay that specific. `.webability.io`
would send this CRM's session cookie to every other production host on the domain.

OAuth redirect URIs go on the **API** origin, not the app's:

```
https://api.crm.webability.io/api/auth/callback/google
https://api.crm.webability.io/api/auth/callback/microsoft
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
