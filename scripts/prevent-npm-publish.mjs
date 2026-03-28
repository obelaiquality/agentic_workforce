#!/usr/bin/env node

console.error(
  [
    "npm publication is intentionally disabled for this repository.",
    "Agentic Workforce 1.0 ships from GitHub source checkouts and signed desktop binaries attached to GitHub Releases.",
    "If a dedicated npm package is needed, publish it from a purpose-built package directory instead of this repo root.",
  ].join("\n")
);

process.exit(1);
