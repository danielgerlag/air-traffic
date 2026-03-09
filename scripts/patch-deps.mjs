#!/usr/bin/env node
// Patches vscode-jsonrpc to add missing "exports" subpaths so ESM imports
// like "vscode-jsonrpc/node" and "vscode-jsonrpc/node.js" resolve correctly.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

try {
  const require = createRequire(import.meta.url);

  // Resolve the main entry to locate the package directory.
  // The "main" field points to ./lib/node/main.js, so we walk up to the root.
  const mainEntry = require.resolve('vscode-jsonrpc');
  let dir = path.dirname(mainEntry);
  let pkgPath = null;

  for (let i = 0; i < 5 && !pkgPath; i++) {
    const candidate = path.join(dir, 'package.json');
    try {
      const content = JSON.parse(fs.readFileSync(candidate, 'utf-8'));
      if (content.name === 'vscode-jsonrpc') pkgPath = candidate;
    } catch {}
    dir = path.dirname(dir);
  }

  if (!pkgPath) process.exit(0);

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

  const desired = {
    '.': './lib/node/main.js',
    './node': './node.js',
    './node.js': './node.js',
    './browser': './browser.js',
    './browser.js': './browser.js',
    './package.json': './package.json',
  };

  const current = pkg.exports || {};
  const needsPatch = Object.keys(desired).some((k) => current[k] !== desired[k]);

  if (needsPatch) {
    pkg.exports = { ...current, ...desired };
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
  }
} catch {
  // Not critical — only needed for ESM subpath resolution
}
