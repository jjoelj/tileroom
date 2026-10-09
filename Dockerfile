# SPDX-License-Identifier: AGPL-3.0-or-later
FROM oven/bun:1.4.2 AS build
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1.4.2-slim
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile --production
COPY server/src server/src
COPY server/drizzle server/drizzle
COPY shared shared
COPY wordlists/words.txt wordlists/abbreviations.txt wordlists/
COPY --from=build /app/client/dist client/dist
ENV NODE_ENV=production
CMD ["bun", "server/src/index.ts"]
