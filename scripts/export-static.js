#!/usr/bin/env node
'use strict';

/* ============================================================
   Export the catalog for static hosting (GitHub Pages).
   Writes public/data/catalog.json from the live SQLite database;
   falls back to the JSON seed when no database file exists.
   Root-absolute local cover paths ("/covers/x.jpg") are rewritten
   to relative paths so they resolve under the Pages sub-path.
   ============================================================ */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DB_FILE = path.join(ROOT, 'data', 'library.sqlite3');
const SEED_FILE = path.join(ROOT, 'data', 'books.json');
const OUT_FILE = path.join(ROOT, 'public', 'data', 'catalog.json');

function relativizeCover(url) {
  return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//')
    ? url.slice(1)
    : url;
}

function fromDatabase() {
  // node:sqlite is built into Node 22+, so no dependencies are needed
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(DB_FILE, { readOnly: true });
  const rows = db
    .prepare(
      `SELECT id, isbn, title, author, category, language, columnNumber,
              shelfTier, coverUrl, overview, estimatedPrice, purchaseUrl
         FROM books ORDER BY id`
    )
    .all();
  db.close();
  return rows.map((row) => ({ ...row, coverUrl: relativizeCover(row.coverUrl) }));
}

function fromSeed() {
  const seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
  return seed.map((row) => ({ ...row, coverUrl: relativizeCover(row.coverUrl) }));
}

let books;
let source;
try {
  books = fromDatabase();
  source = 'database';
} catch (dbError) {
  books = fromSeed();
  source = 'seed (database unavailable: ' + dbError.code + ')';
}

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(
  OUT_FILE,
  JSON.stringify({ books, total: books.length }, null, 2) + '\n'
);
console.log(`Exported ${books.length} books from the ${source} to ${path.relative(ROOT, OUT_FILE)}`);
