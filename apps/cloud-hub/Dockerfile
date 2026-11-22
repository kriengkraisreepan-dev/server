# Build from the repository root:  docker build -f apps/cloud-hub/Dockerfile .
FROM node:22-alpine
WORKDIR /repo
# bridge-protocol is installed as a copy (.npmrc install-links=true), so it must sit at the same relative path.
COPY packages/bridge-protocol packages/bridge-protocol
COPY apps/cloud-hub/package.json apps/cloud-hub/package-lock.json apps/cloud-hub/.npmrc apps/cloud-hub/
WORKDIR /repo/apps/cloud-hub
ARG NPM_INCLUDE_DEV=false
RUN if [ "$NPM_INCLUDE_DEV" = "true" ]; then npm ci; else npm ci --omit=dev; fi
COPY apps/cloud-hub/src src
COPY apps/cloud-hub/scripts scripts
USER node
EXPOSE 8080
CMD ["node", "src/server.js"]
