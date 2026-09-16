# Microsoft's Playwright image already carries Chromium and every system library
# it needs. Building from node:slim means installing ~40 apt packages by hand and
# getting one of them wrong.
#
# This tag MUST match the `playwright` version in package.json -- the image ships
# the browser build that version expects, and a mismatch fails at launch. Both are
# pinned exactly for that reason.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

ENV NODE_ENV=production \
    SKIP_PLAYWRIGHT_DOWNLOAD=1

WORKDIR /app

COPY package*.json ./
# The browser ships with the image, but `playwright` itself is a devDependency,
# so install it here rather than omitting dev entirely.
RUN npm ci --omit=dev && npm install --no-save playwright@1.63.0

COPY . .

EXPOSE 8787
CMD ["node", "server.js"]
