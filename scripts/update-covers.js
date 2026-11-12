'use strict';

/* ============================================================
   Cover finder — searches Open Library (quoted title + author)
   for every book in the database and downloads each cover into
   public/covers/<book-id>.jpg so pages never depend on external
   hosts. Google Books metadata is used as a fallback source.

   Run manually:
     node scripts/update-covers.js

   Network notes:
   - All requests are forced to IPv4 (IPv6 routes time out here).
   - Redirects are followed manually: covers.openlibrary.org
     answers 302 → archive.org → a us.archive.org data node.
   - The archive hop is slow: low concurrency + retries + long
     timeout. Cover bytes are only saved when the chain ends in a
     real image, so a hotlink is never replaced by a broken file.
   ============================================================ */

const path = require('path');
const fs = require('fs');
const https = require('https');
const { catalog } = require(path.join(__dirname, '..', 'data', 'database'));

const CONCURRENCY = 1;          // googleapis.com throttles anonymous bursts (HTTP 429)
const TIMEOUT_MS = 20000;       // per request hop
const DELAY_MS = 2500;          // ~24 req/min stays under the anonymous quota
const RETRIES = 4;
const COVERS_DIR = path.join(__dirname, '..', 'public', 'covers');

/* ---------- HTTP layer (IPv4 + manual redirects) ---------- */

function httpsRequest(url, { method = 'GET', headers = {}, maxRedirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    const attempt = (target, redirectsLeft) => {
      const req = https.request(
        target,
        {
          method,
          family: 4,
          timeout: TIMEOUT_MS,
          headers: {
            'User-Agent': 'mdms-library-cover-search/1.0 (school library cataloger)',
            Accept: '*/*',
            ...headers,
          },
        },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
            res.resume();
            let next;
            try {
              next = new URL(res.headers.location, target);
            } catch {
              reject(new Error(`Invalid redirect: ${res.headers.location}`));
              return;
            }
            attempt(next, redirectsLeft - 1);
            return;
          }

          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            const bytes = Buffer.concat(chunks);
            resolve({
              status: res.statusCode,
              contentType: res.headers['content-type'] || '',
              bytes,
              text: () => bytes.toString('utf8'),
            });
          });
        }
      );
      req.on('timeout', () => req.destroy(new Error('ETIMEDOUT')));
      req.on('error', (err) => reject(err));
      req.end();
    };

    attempt(new URL(url), maxRedirects);
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(url) {
  const res = await httpsRequest(url, { headers: { Accept: 'application/json' } });
  if (res.status === 429) throw new Error('RATE_LIMITED');
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
  return JSON.parse(res.text());
}

/** Wait for a rate-limit window, then retry the whole task. */
async function withRateLimitRetry(task, attempt = 0) {
  try {
    return await task();
  } catch (error) {
    if (error.message === 'RATE_LIMITED' && attempt < 5) {
      const waitMs = 30000 + attempt * 15000;
      await sleep(waitMs);
      return withRateLimitRetry(task, attempt + 1);
    }
    throw error;
  }
}

/** Download a cover with retries; returns { bytes, contentType } or null. */
async function downloadCover(url) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const probe = url.includes('covers.openlibrary.org') && !url.includes('default=false')
    ? `${url}?default=false`
    : url;
  for (let i = 0; i <= RETRIES; i += 1) {
    try {
      const res = await httpsRequest(probe);
      if (res.status >= 200 && res.status < 300 && res.bytes.length > 1000) {
        return { bytes: res.bytes, contentType: res.contentType };
      }
      if (res.status === 404) return null; // OL confirms: no cover for this book
    } catch (error) {
      if (i < RETRIES) await sleep(600 * (i + 1));
      else if (error.code === 'ETIMEDOUT') return null;
    }
  }
  return null;
}

/* ---------- matching helpers ---------- */

const norm = (value) =>
  String(value || '')
    .toLowerCase()
    // Keep letters and digits in any script (Latin, Arabic, French
    // accents, …); strip only diacritics, punctuation and symbols.
    .normalize('NFC')
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '') // Arabic harakat
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function scoreDoc(doc, title, author) {
  const docTitle = norm(doc.title);
  const wanted = norm(title);
  let score = 0;
  if (docTitle === wanted) score += 5;
  else if (docTitle.includes(wanted) || wanted.includes(docTitle)) score += 3;

  const docAuthors = (doc.author_name || []).map(norm).join(' ');
  for (const part of norm(author).split(' ')) {
    if (part && docAuthors.includes(part)) score += 1;
  }
  return score;
}

function bestDoc(docs, title, author, minScore) {
  let best = null;
  let bestScore = 0;
  for (const doc of docs) {
    const score = scoreDoc(doc, title, author);
    if (score > bestScore) {
      bestScore = score;
      best = doc;
    }
  }
  return bestScore >= minScore ? best : null;
}

/* ---------- Open Library (quoted phrase beats plain queries) ---------- */

async function olCandidates(title, author) {
  // A quoted title alone matches reliably; adding the author to the same
  // phrase query reliably returns zero results. So: query by quoted title,
  // then pick the best candidate by author/title scoring.
  const urls = [
    `https://openlibrary.org/search.json?limit=8&fields=title,author_name,cover_i,isbn` +
      `&q=${encodeURIComponent(`"${title}"`)}`,
    `https://openlibrary.org/search.json?limit=8&fields=title,author_name,cover_i,isbn` +
      `&q=${encodeURIComponent(`${title} ${author}`)}`,
  ];
  for (const url of urls) {
    const docs = (await fetchJson(url)).documents || [];
    const best = docs.length > 0 ? bestDoc(docs, title, author, 3) : null;
    if (!best) continue;
    const validIsbn = (best.isbn || []).find((i) => /^97[89]\d{10}$/.test(String(i)));
    const coverUrl = validIsbn
      ? `https://covers.openlibrary.org/b/isbn/${validIsbn}-L.jpg`
      : (best.cover_i
        ? `https://covers.openlibrary.org/b/id/${best.cover_i}-L.jpg`
        : null);
    if (!coverUrl) continue;
    return {
      coverUrl,
      suggestedIsbn: validIsbn || null,
      matchedTitle: best.title,
      published: best.first_publish_year,
      source: 'Open Library',
    };
  }
  return null;
}

/* ---------- Google Books (metadata fallback) ---------- */

async function googleCandidate(title, author, isbn = null) {
  // An ISBN query is an exact match — try it first when we have one
  if (isbn) {
    const data = await fetchJson(
      `https://www.googleapis.com/books/v1/volumes?maxResults=3&q=${encodeURIComponent(`isbn:${isbn}`)}`
    );
    const info = (data.items || []).map((item) => item.volumeInfo || {}).find(
      (info2) => info2.imageLinks && (info2.imageLinks.thumbnail || info2.imageLinks.smallThumbnail)
    );
    if (info) {
      const thumb = info.imageLinks.thumbnail || info.imageLinks.smallThumbnail;
      return {
        coverUrl: thumb.replace(/^http:\/\//i, 'https://').replace(/&zoom=\d/, '&zoom=2'),
        suggestedIsbn: isbn,
        matchedTitle: info.title,
        published: info.publishedDate,
        source: 'Google Books (ISBN)',
      };
    }
  }

  const url = `https://www.googleapis.com/books/v1/volumes?maxResults=5&q=${encodeURIComponent(
    `${title} ${author}`
  )}`;
  const data = await fetchJson(url);
  const items = data.items || [];
  let best = null;
  for (const item of items) {
    const info = item.volumeInfo || {};
    const doc = { title: info.title, author_name: info.authors || [] };
    const best2 = bestDoc([doc], title, author, 3);
    if (best2) {
      best = info;
      break;
    }
  }
  if (!best) return null;

  const thumb = best.imageLinks && (best.imageLinks.thumbnail || best.imageLinks.smallThumbnail);
  if (!thumb) return null;

  return {
    coverUrl: thumb.replace(/^http:\/\//i, 'https://').replace(/&zoom=\d/, '&zoom=2'),
    suggestedIsbn: (best.industryIdentifiers || []).find((i) => i.type === 'ISBN_13')?.identifier || null,
    matchedTitle: best.title,
    published: best.publishedDate,
    source: 'Google Books',
  };
}

/* ---------- lookup pipeline ---------- */

async function lookUp(book) {
  fs.mkdirSync(COVERS_DIR, { recursive: true });
  const localPath = `/covers/${book.id}.jpg`;
  const localFile = path.join(COVERS_DIR, `${book.id}.jpg`);
  const alreadyLocal = fs.existsSync(localFile);

  // 1. Fast path: the book's own ISBN links straight to its cover — no search.
  if (book.isbn) {
    if (alreadyLocal) return { status: 'kept', coverUrl: localPath, found: null };
    const data = await downloadCover(`https://covers.openlibrary.org/b/isbn/${book.isbn}-L.jpg`);
    if (data && data.bytes.length > 1000) {
      fs.writeFileSync(localFile, data.bytes);
      return { status: 'found', coverUrl: localPath, found: { source: `ISBN ${book.isbn}`, matchedTitle: book.title } };
    }
    // Open Library lacks most Arabic editions — try Google Books by ISBN
    const gByIsbn = await googleCandidate(book.title, book.author, book.isbn).catch(() => null);
    if (gByIsbn) {
      const gdata = await downloadCover(gByIsbn.coverUrl);
      if (gdata && gdata.bytes.length > 1000) {
        fs.writeFileSync(localFile, gdata.bytes);
        return { status: 'found', coverUrl: localPath, found: gByIsbn };
      }
    }
  }

  // 2. Books with a leftover remote cover: pull it local when possible.
  if (book.coverUrl) {
    if (book.coverUrl.startsWith('/covers/')) {
      if (alreadyLocal) return { status: 'kept', coverUrl: book.coverUrl, found: null };
      return { status: 'missing', coverUrl: '', found: null };
    }
    const data = await downloadCover(book.coverUrl);
    if (data && data.bytes.length > 1000) {
      fs.writeFileSync(localFile, data.bytes);
      return { status: 'found', coverUrl: localPath, found: { source: 'existing cover (downloaded)', matchedTitle: book.title } };
    }
    // The hotlink is dead and no ISBN path existed — fall through to search.
  }

  // 3. Search Open Library by quoted title (author used for scoring only).
  let found = null;
  try {
    found = await olCandidates(book.title, book.author);
  } catch (error) {
    found = { error: `Open Library: ${error.message}` };
  }
  let data = null;
  if (found && found.coverUrl) data = await downloadCover(found.coverUrl);
  if (found && data && data.bytes.length > 1000) {
    fs.writeFileSync(localFile, data.bytes);
    return { status: 'found', coverUrl: localPath, found };
  }

  let gfound = null;
  try {
    gfound = await googleCandidate(book.title, book.author, book.isbn);
  } catch (error) {
    gfound = { error: `Google Books: ${error.message}` };
  }
  let gdata = null;
  if (gfound && gfound.coverUrl) gdata = await downloadCover(gfound.coverUrl);
  if (gfound && gdata && gdata.bytes.length > 1000) {
    fs.writeFileSync(localFile, gdata.bytes);
    return { status: 'found', coverUrl: localPath, found: gfound };
  }

  return {
    status: 'missing',
    coverUrl: '',
    found: found && found.coverUrl ? null : found,
    error: (found && found.error) || (gfound && gfound.error) || null,
  };
}

/* ---------- main ---------- */

async function run() {
  const books = catalog.listBooks();
  console.log(`Searching covers for ${books.length} books…\n`);

  const results = new Map();
  let batch = [];
  let done = 0;
  for (const book of books) {
    const task = withRateLimitRetry(() => lookUp(book))
      .then((result) => {
        results.set(book.id, result);
        done += 1;
        const src = result.found && result.found.matchedTitle ? `  →  ${result.found.source}: "${result.found.matchedTitle}"` : '';
        const extra = result.error ? `  [${result.error}]` : '';
        console.log(`[${String(done).padStart(2, '0')}/${books.length}] ${result.status.padEnd(12)} ${book.title}${src}${extra}`);
      })
      .catch((error) => {
        results.set(book.id, { status: 'missing', coverUrl: '', found: null, error: error.message });
        done += 1;
        console.log(`[${String(done).padStart(2, '0')}/${books.length}] ERROR        ${book.title} → ${error.message}`);
      });
    batch.push(task);
    if (batch.length === CONCURRENCY) {
      await Promise.allSettled(batch);
      batch = [];
      await sleep(DELAY_MS);
    }
  }
  await Promise.allSettled(batch);

  let foundCount = 0;
  let keptRemote = 0;
  let keptLocal = 0;
  let missingCount = 0;
  const suggestions = [];

  for (const book of books) {
    const result = results.get(book.id) || { status: 'missing', coverUrl: '' };
    if (result.status === 'found') {
      catalog.updateBook(book.id, { ...book, coverUrl: result.coverUrl });
      foundCount += 1;
    } else if (result.status === 'kept') {
      keptLocal += 1;
    } else if (result.status === 'kept-remote') {
      keptRemote += 1;
    } else {
      catalog.updateBook(book.id, { ...book, coverUrl: '' });
      missingCount += 1;
    }
    if (result.found && result.found.suggestedIsbn && !book.isbn) {
      suggestions.push({ id: book.id, title: book.title, isbn: result.found.suggestedIsbn, source: result.found.source });
    }
  }

  const total = catalog.countBooks();
  const withCovers = catalog.listBooks().filter((b) => b.coverUrl).length;
  console.log(`\n──────── Summary ────────`);
  console.log(`Covers downloaded locally : ${foundCount}`);
  console.log(`Already local (verified)  : ${keptLocal}`);
  console.log(`Kept as remote hotlink    : ${keptRemote}`);
  console.log(`No cover found            : ${missingCount}`);
  console.log(`Database                  : ${withCovers}/${total} books have a coverUrl`);

  if (suggestions.length) {
    console.log(`\nISBNs discovered during the search (not saved automatically):`);
    for (const s of suggestions) console.log(`  ${s.id}  ${s.isbn}  (${s.source})  "${s.title}"`);
  }
}

run();
