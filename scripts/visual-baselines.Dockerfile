# Linux runner for the visual-regression baselines (WP-41).
#
# WHY THIS FILE EXISTS. The committed screenshot baselines under
# tests/e2e/__screenshots__ are compared byte-for-byte-ish on ubuntu-latest in
# CI. Text rasterisation differs enough between Windows/macOS and Linux that a
# baseline written on a founder's laptop fails on every glyph in CI. So the
# baselines are Linux-only, and this is how a non-Linux machine produces and
# checks them without a Linux machine.
#
# BASE IMAGE. The official Playwright image, pinned to the exact Playwright
# version in package.json. It already carries Chromium plus the ~90 system
# libraries `playwright install --with-deps` would otherwise fetch, and Node 22
# (which `next dev` needs — `next` is a Node shebang script, so a bun-only image
# cannot run the dev server).
#
# KEEP THIS VERSION IN LOCK-STEP with the `@playwright/test` dependency. A
# mismatch means the browser generating the baselines is not the browser
# comparing them, which is the same platform bug in a different coat.
FROM mcr.microsoft.com/playwright:v1.60.0-noble

# bun is this project's package manager (CLAUDE.md §10) and `npm install` is
# banned for project dependencies. This is not that: it installs the bun BINARY
# itself into a throwaway image, exactly as CI's `oven-sh/setup-bun` action does.
# Every dependency install below still goes through `bun install`.
RUN npm install --global bun@1.2.23 \
    && bun --version

# Browsers live in the image, not in a bind-mounted node_modules.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV CI=1

WORKDIR /work
