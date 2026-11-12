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
fs.copyFileSync(path.join(OUT, 'index.html'), path.join(OUT, '404.html'));
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

console.log(`Built ${path.relative(ROOT, OUT)}/ (index, 404 fallback, .nojekyll)`);
