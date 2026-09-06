# Build the API as a container. Multi-stage so the running image carries no toolchain, no test
# suites and no source: only what is needed to serve requests.
FROM node:20-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

# --- dependencies -------------------------------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
# The API's postinstall generates the Prisma client, which needs the schema present.
COPY apps/api/prisma apps/api/prisma
COPY apps/api/prisma.config.ts apps/api/
RUN pnpm install --frozen-lockfile --filter @health-capital/api... --filter @health-capital/contracts

# --- build --------------------------------------------------------------------------------------
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY apps/api apps/api
RUN pnpm --filter @health-capital/contracts build \
  && pnpm --filter @health-capital/api exec prisma generate \
  && pnpm --filter @health-capital/api exec tsc -p tsconfig.build.json

# --- runtime ------------------------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
# Migrations run as a release step, so the running container needs the Prisma CLI and the schema.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/contracts/dist packages/contracts/dist
COPY --from=build /app/packages/contracts/package.json packages/contracts/
COPY --from=build /app/packages/contracts/node_modules packages/contracts/node_modules
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/src/generated apps/api/src/generated
COPY --from=build /app/apps/api/node_modules apps/api/node_modules
COPY --from=build /app/apps/api/prisma apps/api/prisma
COPY --from=build /app/apps/api/prisma.config.ts apps/api/
COPY --from=build /app/apps/api/package.json apps/api/
COPY package.json pnpm-workspace.yaml ./

# Every COPY above runs as root, so the workspace lands owned by root. A pre-deploy step such as
# `prisma migrate deploy` runs through pnpm, which writes a temporary lockfile inside the workspace
# and fails with a permission error when it cannot. Handing the workspace to the unprivileged user
# is what lets a deployment command run without any of it running as root.
RUN chown -R node:node /app

# Runs unprivileged. The image carries no secret: every one arrives from the platform at runtime.
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

WORKDIR /app/apps/api
CMD ["node", "dist/main.js"]
