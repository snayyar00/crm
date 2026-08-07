# syntax=docker/dockerfile:1
# app — built from the repo root. See DEPLOY-COOLIFY.md.
#
# node:24 and not a bun base image: eve resolves the real node binary and refuses
# anything below 24, and nixpacks/railpack cannot be trusted to pick 24 on their own.
FROM node:24-slim AS runtime

# openssl: prisma's query engine links against it.
# ca-certificates: outbound TLS from the api and the agent.
# curl: Coolify's HTTP healthcheck shells out to curl or wget INSIDE the container.
#       node:24-slim ships neither, so without this every deploy fails the health
#       gate and rolls back with "/bin/sh: 1: curl: not found".
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

RUN npm install -g bun@1.3.12

WORKDIR /app

COPY . .

# @crm/db's postinstall runs `prisma generate`, which reads DATABASE_URL and fails
# without it. `prisma generate` only parses the URL, it never connects, so a
# placeholder is enough — and ARG keeps it out of the final image, so the real
# credential never lands in a layer. Coolify supplies the real one at runtime.
ARG DATABASE_URL="postgresql://prisma:prisma@localhost:5432/prisma?schema=public"

RUN bun install --frozen-lockfile

# Before the build, not after: `bun build --target=bun` INLINES process.env.NODE_ENV
# into the bundle. Setting it afterwards bakes "development" in, which flips
# Better Auth's secure-cookie behaviour at runtime with no visible error.
# next.config.ts puts NEXT_PUBLIC_API_URL into `env`, which Next INLINES into the
# client bundle at BUILD time. Without it the browser ships the fallback
# "http://localhost:3001" and every call fails with "Could not reach the sign-in
# service" — while the API itself is perfectly healthy.
#
# It must be exported as NEXT_PUBLIC_API_URL, not API_URL. apps/app/turbo.json's
# build task declares env: ["NEXT_PUBLIC_API_URL", "NEXT_PUBLIC_AUTH_URL"] and a
# passThroughEnv list that does NOT include API_URL, so turbo strips API_URL out
# of the build environment and next.config falls through to the localhost default.
#
# Coolify must mark API_URL as a BUILD variable so it arrives as --build-arg.
ARG API_URL="http://localhost:3001"
ENV NEXT_PUBLIC_API_URL=$API_URL

ENV NODE_ENV=production

RUN bun run build --filter=app

ENV PORT=3000
EXPOSE 3000

CMD ["bun", "run", "--filter=app", "start"]
