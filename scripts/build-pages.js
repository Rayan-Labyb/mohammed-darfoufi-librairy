#!/usr/bin/env node
'use strict';

/* ============================================================
   Build the static site into docs/ — the folder GitHub Pages
   serves when the Pages source is "main /docs". Run after
   `npm run export-static` (or via `npm run build-pages`).
   Copies public/ to docs/, adds the 404.html fallback so clean
   deep links (/discover, /map) resolve on Pages, and .nojekyll
   so GitHub serves files as-is without Jekyll processing.
   ============================================================ */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'docs');

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(SRC, OUT, { recursive: true });

// Cache-bust the subresources: every build rewrites the asset URLs with
// a fresh query so browsers, proxies and the Pages CDN can never serve
// a stale app.js/styles.css after a redeploy.
const version = Date.now().toString(36);
const indexPath = path.join(OUT, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
html = html
  .replace('href="styles.css"', `href="styles.css?v=${version}"`)
  .replace('src="app.js"', `src="app.js?v=${version}"`);
fs.writeFileSync(indexPath, html);

fs.copyFileSync(indexPath, path.join(OUT, '404.html'));
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

console.log(`Built ${path.relative(ROOT, OUT)}/ (assets ?v=${version})`);
