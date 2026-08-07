# syntax=docker/dockerfile:1
# api — built from the repo root. See DEPLOY-COOLIFY.md.
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
ENV NODE_ENV=production

RUN bun run build --filter=api

ENV PORT=3001
EXPOSE 3001

CMD ["bun", "run", "--filter=api", "start:prod"]
