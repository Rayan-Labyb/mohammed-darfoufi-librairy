const path = require('path');
const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_FILE = path.join(__dirname, 'data', 'books.json');

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
   Catalog persistence (portable books.json on disk)
   ============================================================ */

async function readCatalog() {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) {
      throw new ApiError('books.json is corrupted: expected an array.', 500);
    }
    return data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('The catalog file could not be read.', 500);
  }
}

async function writeCatalog(books) {
  await fs.writeFile(DATA_FILE, JSON.stringify(books, null, 2) + '\n', 'utf8');
}

/* ============================================================
   Validation & normalization
   Each bad field is returned as { field: message } so both the
   admin form and future mobile clients can highlight inputs.
   ============================================================ */

const normalizeText = (value) =>
  typeof value === 'string' ? value.trim() : value;

function checkIsbn(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return /^97[89]\d{10}$/.test(digits) ? digits : null;
}

function normalizePrice(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 0 ? `${value} MAD` : '0 MAD';
  }
  const text = typeof value === 'string' ? value.trim() : '';
  if (/^\d+([.,]\d+)?$/.test(text)) return `${text} MAD`;
  return text || '';
}

function nextBookId(books) {
  const max = books.reduce((acc, book) => {
    const match = /^mdms-book-(\d+)$/.exec(book.id || '');
    return match ? Math.max(acc, Number(match[1])) : acc;
  }, 0);
  return `mdms-book-${String(max + 1).padStart(3, '0')}`;
}

function validateBook(input = {}, existing = null) {
  const src = existing ? { ...existing, ...input } : input;
  const errors = {};

  const isbn = checkIsbn(src.isbn);
  if (!isbn) {
    errors.isbn = 'ISBN must be a valid 13-digit ISBN-13 starting with 978 or 979.';
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

  let purchaseUrl = normalizeText(src.purchaseUrl);
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
    id: src.id || nextBookId,
    isbn,
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
app.use('/data', express.static(path.join(__dirname, 'data')));

const normalize = (value) => String(value ?? '').trim().toLowerCase();

function filterBooks(books, { q, category, language, shelfTier, columnNumber } = {}) {
  let results = [...books];

  const query = normalize(q);
  if (query) {
    const tokens = query.split(/\s+/).filter(Boolean);
    results = results.filter((book) => {
      const haystack = [
        book.title,
        book.author,
        book.overview,
        book.category,
        book.language,
        book.shelfTier,
        book.isbn,
      ]
        .map(normalize)
        .join(' ');
      return tokens.every((token) => haystack.includes(token));
    });
  }

  if (category && category !== 'All') {
    results = results.filter((book) => book.category === category);
  }
  if (language && language !== 'All') {
    results = results.filter((book) => book.language === language);
  }
  if (shelfTier && shelfTier !== 'All') {
    results = results.filter((book) => book.shelfTier === shelfTier);
  }
  const column = Number.parseInt(columnNumber, 10);
  if (columnNumber !== undefined && columnNumber !== null && columnNumber !== '' && !Number.isNaN(column)) {
    results = results.filter((book) => book.columnNumber === column);
  }

  return results;
}

/* ============================================================
   Routes
   ============================================================ */

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'mohammed-darfoufi-middle-school-digital-library',
    timestamp: new Date().toISOString(),
  });
});

app.get(
  '/api/stats',
  asyncHandler(async (req, res) => {
    const books = await readCatalog();
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
    const books = await readCatalog();
    const results = filterBooks(books, req.query);
    res.json({
      count: results.length,
      total: books.length,
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
    const books = await readCatalog();
    res.set('Content-Disposition', 'attachment; filename="catalog.json"');
    res.json(books);
  })
);

app.get(
  '/api/books/:id',
  asyncHandler(async (req, res) => {
    const books = await readCatalog();
    const book = books.find((b) => b.id === req.params.id);
    if (!book) {
      throw new ApiError(`Book with id "${req.params.id}" was not found.`, 404);
    }
    res.json({ book });
  })
);

app.post(
  '/api/books',
  asyncHandler(async (req, res) => {
    const books = await readCatalog();
    const { id: _ignored } = req.body || {};
    void _ignored;
    const normalized = validateBook(req.body);
    if (books.some((b) => b.isbn === normalized.isbn)) {
      throw new ApiError('This ISBN already exists in the catalog.', 409, {
        isbn: 'A book with this ISBN is already catalogued. Check the existing entry.',
      });
    }
    const book = { ...normalized, id: nextBookId(books) };
    books.push(book);
    await writeCatalog(books);
    res.status(201).json({ book, total: books.length });
  })
);

app.put(
  '/api/books/:id',
  asyncHandler(async (req, res) => {
    const books = await readCatalog();
    const existing = books.find((b) => b.id === req.params.id);
    if (!existing) {
      throw new ApiError(`Book with id "${req.params.id}" was not found.`, 404);
    }
    const normalized = validateBook(req.body || {}, existing);
    if (normalized.isbn !== existing.isbn && books.some((b) => b.isbn === normalized.isbn)) {
      throw new ApiError('The updated ISBN already belongs to another book.', 409, {
        isbn: 'Another book already uses this ISBN.',
      });
    }
    const index = books.indexOf(existing);
    books[index] = { ...existing, ...normalized, id: existing.id };
    await writeCatalog(books);
    res.json({ book: books[index] });
  })
);

app.delete(
  '/api/books/:id',
  asyncHandler(async (req, res) => {
    const books = await readCatalog();
    const existing = books.find((b) => b.id === req.params.id);
    if (!existing) {
      throw new ApiError(`Book with id "${req.params.id}" was not found.`, 404);
    }
    const next = books.filter((b) => b.id !== existing.id);
    await writeCatalog(next);
    res.json({ ok: true, id: existing.id, total: next.length });
  })
);

/**
 * Bulk import: accepts a bare array like books.json, or { books: [...] }.
 * Valid records are appended with new ids; invalid records are reported.
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

    const books = await readCatalog();
    const imported = [];
    const errors = [];
    const seenIsbns = new Set(books.map((b) => b.isbn));

    records.forEach((record, index) => {
      try {
        const normalized = { ...validateBook(record) };
        delete normalized.id;
        if (seenIsbns.has(normalized.isbn)) {
          throw new ApiError(`Duplicate ISBN ${normalized.isbn} (already in catalog).`, 409);
        }
        seenIsbns.add(normalized.isbn);
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
      for (const book of imported) {
        book.id = nextBookId(books);
        books.push(book);
      }
      await writeCatalog(books);
    }

    res.json({
      imported: imported.length,
      skipped: errors.length,
      totalInFile: records.length,
      catalogSize: books.length,
      errors,
    });
  })
);

app.get('/api/data', (req, res) => {
  res.sendFile(DATA_FILE);
});

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
  console.error(err);
  res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(PORT, () => {
  console.log(`Mohammed Darfoufi Middle School Digital Library running on http://localhost:${PORT}`);
});
