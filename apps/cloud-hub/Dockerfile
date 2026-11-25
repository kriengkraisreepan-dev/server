# Build from the repository root:  docker build -f apps/cloud-hub/Dockerfile .
# Debian (not Alpine): the A5 post renderer runs Playwright's Chromium, which needs glibc.
FROM node:22-bookworm-slim
WORKDIR /repo
# bridge-protocol is installed as a copy (.npmrc install-links=true), so it must sit at the same relative path.
COPY packages/bridge-protocol packages/bridge-protocol
COPY apps/cloud-hub/package.json apps/cloud-hub/package-lock.json apps/cloud-hub/.npmrc apps/cloud-hub/
WORKDIR /repo/apps/cloud-hub
ARG NPM_INCLUDE_DEV=false
RUN if [ "$NPM_INCLUDE_DEV" = "true" ]; then npm ci; else npm ci --omit=dev; fi
# A5: headless Chromium (shell only, smaller) + the system libraries it needs, at the version
# pinned by playwright-core in package-lock.json. Fonts for posts are inside src/content/fonts.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright-core install --with-deps --only-shell chromium \
  && rm -rf /var/lib/apt/lists/* /root/.npm \
  && chmod -R a+rX /ms-playwright
COPY apps/cloud-hub/src src
COPY apps/cloud-hub/scripts scripts
USER node
EXPOSE 8080
CMD ["node", "src/server.js"]
