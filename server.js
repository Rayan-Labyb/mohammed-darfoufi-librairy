const path = require('path');
const express = require('express');
const cors = require('cors');

const { catalog } = require('./data/database');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const SEED_FILE = path.join(__dirname, 'data', 'books.json');

const COLUMNS = [1, 2, 3, 4, 5, 6];
const SHELF_TIERS = ['A', 'B', 'C', 'D'];

/* ============================================================
   Errors — structured so the frontend (or future APIs) can
   react to `status` and `details` uniformly.
   ============================================================ */

class ApiError extends Error {
  constructor(message, status = 400, details = undefined) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/* ============================================================
   Validation & normalization
   Each bad field is returned as { field: message } so both the
   admin form and future mobile clients can highlight inputs.
   ============================================================ */

const normalizeText = (value) =>
  typeof value === 'string' ? value.trim() : value;

function checkIsbn(value) {
  // Accept any 13-digit EAN-13 (bookland 978/979 as well as regional
  // prefixes like 622/628 used on Arabic editions) with a valid checksum
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!/^\d{13}$/.test(digits)) return null;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(digits[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10 === Number(digits[12]) ? digits : null;
}

function normalizePrice(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 0 ? `${value} MAD` : '0 MAD';
  }
  const text = typeof value === 'string' ? value.trim() : '';
  if (/^\d+([.,]\d+)?$/.test(text)) return `${text} MAD`;
  return text || '';
}

function validateBook(input = {}, existing = null) {
  const src = existing ? { ...existing, ...input } : input;
  const errors = {};

  const rawIsbn = normalizeText(src.isbn);
  const isbn = checkIsbn(src.isbn);
  if (!isbn && rawIsbn) {
    errors.isbn = 'ISBN must be a valid 13-digit barcode with a matching checksum — or leave it blank if the copy has none.';
  }

  const title = normalizeText(src.title);
  if (!title) errors.title = 'Title is required. Type the title printed on the book cover.';

  const author = normalizeText(src.author);
  if (!author) errors.author = 'Author is required.';

  const category = normalizeText(src.category);
  if (!category) errors.category = 'Category is required.';

  const language = normalizeText(src.language);
  if (!language) errors.language = 'Language is required.';

  const columnNumber = Number.parseInt(src.columnNumber, 10);
  if (!COLUMNS.includes(columnNumber)) {
    errors.columnNumber = `Choose a physical column from 1 to ${COLUMNS.length}.`;
  }

  const shelfTier = String(src.shelfTier ?? '').trim().toUpperCase();
  if (!SHELF_TIERS.includes(shelfTier)) {
    errors.shelfTier = 'Choose a shelf tier from A (top) to D (bottom).';
  }

  const overview = normalizeText(src.overview);
  if (!overview) errors.overview = 'Overview is required. Write a short student-friendly synopsis.';

  const estimatedPrice = normalizePrice(src.estimatedPrice);

  let purchaseUrl = normalizeText(src.purchaseUrl) || '';
  if (!purchaseUrl && isbn) {
    purchaseUrl = `https://www.amazon.com/s?k=${isbn}`;
  }
  if (purchaseUrl && !/^https?:\/\//i.test(purchaseUrl)) {
    errors.purchaseUrl = 'Purchase URL must start with http(s)://.';
  }

  const coverUrl =
    normalizeText(src.coverUrl) ||
    (isbn ? `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg` : '');

  if (Object.keys(errors).length) {
    throw new ApiError(
      existing ? 'Please fix the highlighted fields before updating.' : 'Please fix the highlighted fields before saving.',
      422,
      errors
    );
  }

  return {
    isbn: isbn || '',
    title,
    author,
    category,
    language,
    columnNumber,
    shelfTier,
    coverUrl,
    overview,
    estimatedPrice: estimatedPrice || 'Price not listed',
    purchaseUrl,
  };
}

/* ============================================================
   App & middleware
   ============================================================ */

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));
// Clean SPA paths — the views live at /discover, /map, /admin (no "#")
app.get(['/discover', '/map', '/admin'], (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);
// books.json stays reachable for the offline fallback snapshot only
// (the SQLite file and DB module are NOT served publicly).
app.get('/data/books.json', (req, res) => res.sendFile(SEED_FILE));

/* ============================================================
   Routes — every read/write goes to the SQLite database
   ============================================================ */

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'mohammed-darfoufi-middle-school-digital-library',
    storage: 'sqlite',
    timestamp: new Date().toISOString(),
  });
});

app.get(
  '/api/stats',
  asyncHandler(async (req, res) => {
    const books = catalog.listBooks();
    const stats = {
      total: books.length,
      columns: COLUMNS.length,
      shelfTiers: SHELF_TIERS.length,
      byColumn: {},
      byTier: {},
      byCategory: {},
      byLanguage: {},
    };
    for (const column of COLUMNS) stats.byColumn[column] = 0;
    for (const tier of SHELF_TIERS) stats.byTier[tier] = 0;
    for (const book of books) {
      stats.byColumn[book.columnNumber] = (stats.byColumn[book.columnNumber] || 0) + 1;
      stats.byTier[book.shelfTier] = (stats.byTier[book.shelfTier] || 0) + 1;
      stats.byCategory[book.category] = (stats.byCategory[book.category] || 0) + 1;
      stats.byLanguage[book.language] = (stats.byLanguage[book.language] || 0) + 1;
    }
    res.json({ ...stats, updated: new Date().toISOString() });
  })
);

app.get(
  '/api/books',
  asyncHandler(async (req, res) => {
    const total = catalog.countBooks();
    const results = catalog.listBooks(req.query);
    res.json({
      count: results.length,
      total,
      filters: {
        q: req.query.q || '',
        category: req.query.category || 'All',
        language: req.query.language || 'All',
        shelfTier: req.query.shelfTier || 'All',
        columnNumber: req.query.columnNumber || null,
      },
      books: results,
    });
  })
);

app.get(
  '/api/books/export',
  asyncHandler(async (req, res) => {
    const books = catalog.listBooks();
    res.set('Content-Disposition', 'attachment; filename="catalog.json"');
    res.json(books);
  })
);

app.get(
  '/api/books/:id',
  asyncHandler(async (req, res) => {
    const book = catalog.getBook(req.params.id);
    if (!book) {
      throw new ApiError(`Book with id "${req.params.id}" was not found.`, 404);
    }
    res.json({ book });
  })
);

app.post(
  '/api/books',
  asyncHandler(async (req, res) => {
    const { id: _ignored } = req.body || {};
    void _ignored;
    const normalized = validateBook(req.body);
    if (normalized.isbn && catalog.getByIsbn(normalized.isbn)) {
      throw new ApiError('This ISBN already exists in the catalog.', 409, {
        isbn: 'A book with this ISBN is already catalogued. Check the existing entry.',
      });
    }
    const book = catalog.insertBook({ ...normalized, id: catalog.nextBookId() });
    res.status(201).json({ book, total: catalog.countBooks() });
  })
);

app.put(
  '/api/books/:id',
  asyncHandler(async (req, res) => {
    const existing = catalog.getBook(req.params.id);
    if (!existing) {
      throw new ApiError(`Book with id "${req.params.id}" was not found.`, 404);
    }
    const normalized = validateBook(req.body || {}, existing);
    if (normalized.isbn !== existing.isbn) {
      const clash = catalog.getByIsbn(normalized.isbn);
      if (clash && clash.id !== existing.id) {
        throw new ApiError('The updated ISBN already belongs to another book.', 409, {
          isbn: 'Another book already uses this ISBN.',
        });
      }
    }
    const book = catalog.updateBook(existing.id, normalized);
    res.json({ book });
  })
);

app.delete(
  '/api/books/:id',
  asyncHandler(async (req, res) => {
    const existing = catalog.getBook(req.params.id);
    if (!existing) {
      throw new ApiError(`Book with id "${req.params.id}" was not found.`, 404);
    }
    catalog.deleteBook(existing.id);
    res.json({ ok: true, id: existing.id, total: catalog.countBooks() });
  })
);

/**
 * Bulk import: accepts a bare array like books.json, or { books: [...] }.
 * Valid records are appended to the database with new ids; invalid records
 * are reported individually so they can be fixed and retried.
 */
app.post(
  '/api/books/import',
  asyncHandler(async (req, res) => {
    const payload = req.body;
    if (!Array.isArray(payload) && !Array.isArray(payload?.books)) {
      throw new ApiError(
        'Import failed: the JSON must be an array of books, or an object with a "books" array.',
        400
      );
    }
    const records = Array.isArray(payload) ? payload : payload.books;
    if (records.length === 0) {
      throw new ApiError('Import failed: the file contains no books.', 400);
    }
    if (records.length > 500) {
      throw new ApiError('Import failed: at most 500 books can be imported at once.', 400);
    }

    const imported = [];
    const errors = [];
    const catalogIsbns = new Set(
      catalog.listBooks().map((b) => b.isbn).filter(Boolean)
    );

    records.forEach((record, index) => {
      try {
        const normalized = validateBook(record);
        // Copies without a barcode share an empty ISBN; skip the check
        if (normalized.isbn && catalogIsbns.has(normalized.isbn)) {
          throw new ApiError(`Duplicate ISBN ${normalized.isbn} (already in catalog).`, 409);
        }
        if (normalized.isbn) catalogIsbns.add(normalized.isbn);
        imported.push(normalized);
      } catch (error) {
        errors.push({
          index,
          title: record && record.title ? record.title : `Record ${index + 1}`,
          message: error.message,
          details: error.details || (error.status === 409 ? { isbn: error.message } : undefined),
        });
      }
    });

    if (imported.length) {
      catalog.insertMany(imported);
    }

    res.json({
      imported: imported.length,
      skipped: errors.length,
      totalInFile: records.length,
      catalogSize: catalog.countBooks(),
      errors,
    });
  })
);

app.get(
  '/api/data',
  asyncHandler(async (req, res) => {
    res.json(catalog.listBooks());
  })
);

/* ============================================================
   Error handling (always last)
   ============================================================ */

app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found.' });
});

app.use((err, req, res, next) => {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Invalid JSON in the request body.' });
    return;
  }
  if (err?.type?.startsWith('entity.too.large')) {
    res.status(413).json({ error: 'Request body is too large.' });
    return;
  }
  // Unique-index guard from the database layer surfaces as a clean 409.
  if (err?.code === 'SQLITE_CONSTRAINT' && String(err.message).includes('isbn')) {
    res.status(409).json({ error: 'A book with this ISBN is already catalogued.' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(PORT, HOST, () => {
  console.log(`Mohammed Darfoufi Middle School Digital Library running on http://localhost:${PORT}`);
  console.log(`Storage: SQLite (${path.join(__dirname, 'data', 'library.sqlite3')})`);
  // Print every address other devices on the same network can use.
  try {
    const os = require('os');
    const urls = [];
    for (const addresses of Object.values(os.networkInterfaces())) {
      for (const net of addresses || []) {
        if (net.family === 'IPv4' && !net.internal) urls.push(`http://${net.address}:${PORT}`);
      }
    }
    if (urls.length) {
      console.log('Open from another device on the same network:');
      for (const u of urls) console.log(`  ${u}`);
    } else {
      console.log('No external network address found — only localhost is reachable.');
    }
  } catch (err) {
    console.log(`(Could not list network addresses: ${err.message})`);
  }
});
