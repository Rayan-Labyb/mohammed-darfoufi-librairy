'use strict';

/* ============================================================
   Library database (SQLite via node:sqlite — built into Node 22+)
   - Single file: data/library.sqlite3
   - No automatic seeding: an empty database stays empty until books
     are added through the admin panel (or `npm run seed` is run by
     hand to restore the sample catalog from data/books.json).
   ============================================================ */

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DB_FILE = path.join(__dirname, 'library.sqlite3');
const SEED_FILE = path.join(__dirname, 'books.json');

/* ---------- Connect & migrate ---------- */

const db = new DatabaseSync(DB_FILE);

// WAL mode: safe concurrent reads while the admin panel writes.
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
  CREATE TABLE IF NOT EXISTS books (
    id             TEXT PRIMARY KEY,
    isbn           TEXT NOT NULL,
    title          TEXT NOT NULL,
    author         TEXT NOT NULL,
    category       TEXT NOT NULL,
    language       TEXT NOT NULL,
    columnNumber   INTEGER NOT NULL CHECK (columnNumber BETWEEN 1 AND 6),
    shelfTier      TEXT NOT NULL CHECK (shelfTier IN ('A','B','C','D')),
    coverUrl       TEXT NOT NULL DEFAULT '',
    overview       TEXT NOT NULL DEFAULT '',
    estimatedPrice TEXT NOT NULL DEFAULT 'Price not listed',
    purchaseUrl    TEXT NOT NULL DEFAULT '',
    createdAt      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updatedAt      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
`);

db.exec(`
  DROP INDEX IF EXISTS idx_books_isbn;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_books_isbn ON books (isbn) WHERE isbn <> '';
  CREATE INDEX IF NOT EXISTS idx_books_column ON books (columnNumber, shelfTier);
`);

/* ---------- Manual seeding (opt-in) ----------
   Run `npm run seed` to restore the sample catalog from data/books.json.
   This never happens automatically, so your library stays empty after
   being cleared until you (or the admin panel) add books.
-------------------------------------------------- */

function seedFromJson() {
  if (!fs.existsSync(SEED_FILE)) {
    console.warn(`No seed file found at ${SEED_FILE}. Nothing to import.`);
    return 0;
  }
  let seeded = 0;
  try {
    const seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
    if (!Array.isArray(seed)) {
      console.warn('books.json is malformed: expected an array of books.');
      return 0;
    }
    const insert = db.prepare(`
      INSERT OR IGNORE INTO books
        (id, isbn, title, author, category, language, columnNumber, shelfTier,
         coverUrl, overview, estimatedPrice, purchaseUrl)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    db.exec('BEGIN');
    for (const b of seed) {
      if (!b || !b.id) continue;
      const result = insert.run(
        String(b.id),
        String(b.isbn ?? ''),
        String(b.title ?? ''),
        String(b.author ?? ''),
        String(b.category ?? ''),
        String(b.language ?? ''),
        Number.parseInt(b.columnNumber, 10) || 1,
        String(b.shelfTier ?? 'A'),
        String(b.coverUrl ?? ''),
        String(b.overview ?? ''),
        String(b.estimatedPrice ?? 'Price not listed'),
        String(b.purchaseUrl ?? '')
      );
      if (result.changes > 0) seeded += 1;
    }
    db.exec('COMMIT');
  } catch (seedError) {
    db.exec('ROLLBACK');
    console.warn('Could not seed the database from books.json:', seedError.message);
    return 0;
  }
  return seeded;
}

/* ---------- Row ⇄ book mapping ---------- */

function rowToBook(row) {
  if (!row) return null;
  return {
    id: row.id,
    isbn: row.isbn,
    title: row.title,
    author: row.author,
    category: row.category,
    language: row.language,
    columnNumber: Number(row.columnNumber),
    shelfTier: row.shelfTier,
    coverUrl: row.coverUrl,
    overview: row.overview,
    estimatedPrice: row.estimatedPrice,
    purchaseUrl: row.purchaseUrl,
  };
}

const bookToParams = (book) => [
  book.isbn,
  book.title,
  book.author,
  book.category,
  book.language,
  book.columnNumber,
  book.shelfTier,
  book.coverUrl,
  book.overview,
  book.estimatedPrice,
  book.purchaseUrl,
];

/* ---------- Prepared statements ---------- */

const ST = {
  all: db.prepare('SELECT * FROM books ORDER BY createdAt, id'),
  byId: db.prepare('SELECT * FROM books WHERE id = ?'),
  byIsbn: db.prepare('SELECT * FROM books WHERE isbn = ?'),
  count: db.prepare('SELECT COUNT(*) AS n FROM books'),
  maxSeq: db.prepare("SELECT MAX(CAST(substring(id, 12) AS INTEGER)) AS max FROM books WHERE id LIKE 'mdms-book-%'"),
  nextId: db.prepare('SELECT id FROM books WHERE id = ?'),
  insert: db.prepare(`
    INSERT INTO books
      (id, isbn, title, author, category, language, columnNumber, shelfTier,
       coverUrl, overview, estimatedPrice, purchaseUrl)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  update: db.prepare(`
    UPDATE books SET
      isbn = ?, title = ?, author = ?, category = ?, language = ?,
      columnNumber = ?, shelfTier = ?, coverUrl = ?, overview = ?,
      estimatedPrice = ?, purchaseUrl = ?,
      updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id = ?
  `),
  remove: db.prepare('DELETE FROM books WHERE id = ?'),
};

/* ---------- Public helpers (sync — SQLite is local) ---------- */

const catalog = {
  /** All books, optionally filtered. `q` uses the same token matching as before. */
  listBooks({ q, category, language, shelfTier, columnNumber } = {}) {
    let rows = ST.all.all();

    if (category && category !== 'All') rows = rows.filter((r) => r.category === category);
    if (language && language !== 'All') rows = rows.filter((r) => r.language === language);
    if (shelfTier && shelfTier !== 'All') rows = rows.filter((r) => r.shelfTier === shelfTier);

    const column = Number.parseInt(columnNumber, 10);
    if (columnNumber !== undefined && columnNumber !== null && columnNumber !== '' && !Number.isNaN(column)) {
      rows = rows.filter((r) => Number(r.columnNumber) === column);
    }

    const query = String(q ?? '').trim().toLowerCase();
    if (query) {
      const tokens = query.split(/\s+/).filter(Boolean);
      rows = rows.filter((r) => {
        const haystack = [r.title, r.author, r.overview, r.category, r.language, r.shelfTier, r.isbn]
          .join(' ')
          .toLowerCase();
        return tokens.every((token) => haystack.includes(token));
      });
    }

    return rows.map(rowToBook);
  },

  getBook(id) {
    return rowToBook(ST.byId.get(id));
  },

  getByIsbn(isbn) {
    return rowToBook(ST.byIsbn.get(isbn));
  },

  countBooks() {
    return Number(ST.count.get().n);
  },

  /** Next free mdms-book-NNN id, based on the highest existing number. */
  nextBookId() {
    const max = Number(ST.maxSeq.get()?.max) || 0;
    return `mdms-book-${String(max + 1).padStart(3, '0')}`;
  },

  insertBook(book) {
    let id = book.id || this.nextBookId();
    while (ST.nextId.get(id)) {
      const m = /^mdms-book-(\d+)$/.exec(id);
      id = m
        ? `mdms-book-${String(Number(m[1]) + 1).padStart(3, '0')}`
        : `${id}-2`;
    }
    ST.insert.run(id, ...bookToParams(book));
    return this.getBook(id);
  },

  updateBook(id, book) {
    ST.update.run(...bookToParams(book), id);
    return this.getBook(id);
  },

  deleteBook(id) {
    const result = ST.remove.run(id);
    return result.changes > 0;
  },

  /** Bulk insert with new auto ids inside one transaction. Returns inserted books. */
  insertMany(books) {
    const inserted = [];
    db.exec('BEGIN');
    try {
      for (const book of books) {
        const { id: _drop, ...rest } = book;
        void _drop;
        inserted.push(this.insertBook(rest));
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return inserted;
  },
};

module.exports = { catalog, DB_FILE, SEED_FILE, seedFromJson };

/* ---------- CLI mode: `node data/database.js` or `npm run seed` ---------- */

if (require.main === module) {
  const count = seedFromJson();
  console.log(
    `Seeded ${count} book${count === 1 ? '' : 's'} from books.json. ` +
    `Database now has ${catalog.countBooks()} book${catalog.countBooks() === 1 ? '' : 's'}.`
  );
  db.close();
}
