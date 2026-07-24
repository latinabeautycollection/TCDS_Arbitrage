#!/usr/bin/env sh
set -eu

printf '%s\n' 'TCDS Domain 6 Shell Preflight'
node --version
npm --version
npm run verify:registry
npm ci --no-audit --no-fund
npm run check
npm run build
printf '%s\n' 'PASS: registry, dependencies, TypeScript, and Vite build verified.'
