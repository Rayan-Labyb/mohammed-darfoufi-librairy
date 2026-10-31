'use strict';

/* ============================================================
   Mohammed Darfoufi Middle School — Digital Library
   Vanilla JS SPA
   Routes: #/discover · #/map · #/admin (librarian space)
   Built so future APIs plug into one `api` layer and all
   failures surface through `request()` + toasts.
   ============================================================ */

/* ---------- Constants ---------- */

const COLUMNS = [1, 2, 3, 4, 5, 6];
const TIERS = ['A', 'B', 'C', 'D'];
const PAGE_SIZE = 6;
const ROUTES = ['discover', 'map', 'admin'];
const ADMIN_TABS = ['catalog', 'map', 'io', 'guide'];

const state = {
  route: 'discover',
  adminTab: 'catalog',
  query: '',
  filterType: null,      // 'category' | 'language' | null
  filterValue: null,
  column: null,          // 1..6 | null
  sort: 'recommended',
  page: 1,
  visible: visibleStep(),
  books: [],
  loadError: false,
  previewId: null,
  activeBookId: null,
  autofetched: false,
};

function visibleStep() {
  if (window.matchMedia('(max-width: 640px)').matches) return 3;
  if (window.matchMedia('(max-width: 1023px)').matches) return 4;
  return PAGE_SIZE;
}

/* ---------- Array refs ---------- */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const DOM = {
  toastStack: $('#toastStack'),
  statTotalTop: $('#statTotalTop'),
  statBooksTotal: $('#statBooksTotal'),
  // discover
  searchForm: $('#searchForm'),
  searchInput: $('#searchInput'),
  exploreChips: $('#exploreChips'),
  columnChips: $('#columnChips'),
  clearFilters: $('#clearFilters'),
  shelfMap: $('#shelfMap'),
  shelfMapStatus: $('#shelfMapStatus'),
  previewMode: $('#previewMode'),
  quickPreview: $('#quickPreview'),
  resultsTitle: $('#resultsTitle'),
  resultsSub: $('#resultsSub'),
  sortSelect: $('#sortSelect'),
  bookGrid: $('#bookGrid'),
  emptyState: $('#emptyState'),
  emptyMessage: $('#emptyMessage'),
  retryLoad: $('#retryLoad'),
  pageInfo: $('#pageInfo'),
  pager: $('#pager'),
  showMoreBtn: $('#showMoreBtn'),
  // map
  mapGuideText: $('#mapGuideText'),
  mapChipText: $('#mapChipText'),
  bigMap: $('#bigMap'),
  mapColumnSection: $('#mapColumnSection'),
  mapColumnTitle: $('#mapColumnTitle'),
  mapColumnBooks: $('#mapColumnBooks'),
  // admin
  adminMap: $('#adminMap'),
  catForm: $('#catForm'),
  formBanner: $('#formBanner'),
  fields: {
    title: $('#fTitle'),
    author: $('#fAuthor'),
    category: $('#fCategory'),
    language: $('#fLanguage'),
    columnNumber: $('#fColumn'),
    shelfTier: $('#fTier'),
    isbn: $('#fIsbn'),
    overview: $('#fOverview'),
    price: $('#fPrice'),
  },
  isbnHint: $('#isbnHint'),
  autofetchBtn: $('#autofetchBtn'),
  clearFormBtn: $('#clearFormBtn'),
  catFormEl: null, // the <form> element itself
  pvCover: $('#pvCover'),
  pvCoverFallback: $('#pvCoverFallback'),
  pvTitle: $('#pvTitle'),
  pvAuthor: $('#pvAuthor'),
  pvMeta: $('#pvMeta'),
  pvLoc: $('#pvLoc'),
  tierList: $('#tierList'),
  tierCardTitle: $('#tierCardTitle'),
  adminListCount: $('#adminListCount'),
  adminBookList: $('#adminBookList'),
  importFile: $('#importFile'),
  importFile2: $('#importFile2'),
  importResults: $('#importResults'),
  // modal (book details)
  bookModal: $('#bookModal'),
  modalBackdrop: $('#modalBackdrop'),
  modalClose: $('#modalClose'),
  modalCover: $('#modalCover'),
  modalCoverFallback: $('#modalCoverFallback'),
  modalLoc: $('#modalLoc'),
  modalTitle: $('#modalTitle'),
  modalAuthor: $('#modalAuthor'),
  modalLang: $('#modalLang'),
  modalCat: $('#modalCat'),
  modalIsbn: $('#modalIsbn'),
  modalPrice: $('#modalPrice'),
  modalOverviewWrap: $('#bookModal').querySelector('.bm-overview'),
  overviewToggle: $('#overviewToggle'),
  modalOverview: $('#modalOverview'),
  modalLocate: $('#modalLocate'),
  modalPurchase: $('#modalPurchase'),
  // help modal
  helpModal: $('#helpModal'),
  helpBackdrop: $('#helpBackdrop'),
  helpClose: $('#helpClose'),
  helpBackBtn: $('#helpBackBtn'),
};

DOM.catFormEl = DOM.catForm;

/* ============================================================
   API layer — every request funnels through request() so
   network, HTTP, and validation errors are handled in one place.
   ============================================================ */

class ApiError extends Error {
  constructor(message, { status = 0, details = undefined } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

async function request(url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json', ...(options.headers || {}) },
      ...options,
    });
  } catch (networkError) {
    throw new ApiError('Cannot reach the library server. Check your connection and try again.', { status: 0 });
  }

  let payload = null;
  try { payload = await response.json(); } catch (parseError) { /* non-JSON body */ }

  if (!response.ok) {
    throw new ApiError(
      (payload && payload.error) || `Request failed with status ${response.status}.`,
      { status: response.status, details: payload && payload.details }
    );
  }
  return payload;
}

const api = {
  async books() {
    return (await request('/api/books')).books;
  },
  createBook(payload) {
    return request('/api/books', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },
  deleteBook(id) {
    return request(`/api/books/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  importBooks(payload) {
    return request('/api/books/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },
  fetchOpenLibrary(isbn) {
    return request(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
  },
};

/* ---------- Toasts ---------- */

function toast(message, type = 'info', { title, duration = 4200 } = {}) {
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.setAttribute('role', 'status');
  el.innerHTML = `<span>${title ? `<strong>${escapeHtml(title)}</strong>` : ''}${escapeHtml(message)}</span>`;
  DOM.toastStack.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  window.setTimeout(() => {
    el.classList.remove('show');
    window.setTimeout(() => el.remove(), 300);
  }, duration);
}

/* ---------- Helpers ---------- */

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const coverUrl = (book) =>
  book?.coverUrl || (book?.isbn ? `https://covers.openlibrary.org/b/isbn/${book.isbn}-L.jpg` : '');

const priceNumber = (text) => {
  const parsed = parseFloat(String(text ?? '').replace(/[^\d.]/g, ''));
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
};

function locationLabel(column, tier) {
  return `Column ${column} · Shelf ${tier}`;
}

function updateStatTotals() {
  DOM.statTotalTop.textContent = String(state.books.length);
  DOM.statBooksTotal.textContent = String(state.books.length);
}

/* ---------- Catalog loading (with offline-first fallback) ---------- */

async function loadCatalog() {
  try {
    state.books = await api.books();
    state.loadError = false;
  } catch (primaryError) {
    try {
      const fallback = await request('/data/books.json');
      if (!Array.isArray(fallback)) throw new ApiError('Fallback data is malformed.');
      state.books = fallback;
      state.loadError = false;
      toast('Live API unreachable — showing the offline snapshot. Data is read-only until the server responds.', 'warn', { title: 'Offline mode' });
    } catch (fallbackError) {
      state.books = [];
      state.loadError = true;
      toast(fallbackError.message || 'Catalog unavailable.', 'error', { title: 'Catalog unavailable' });
    }
  }
  updateStatTotals();
  if (state.route === 'discover') renderResults();
  if (state.route === 'map') renderMapView();
  if (state.route === 'admin') renderAdmin();
}

/* ============================================================
   Router
   ============================================================ */

function routeFromHash() {
  const hash = (window.location.hash || '').replace(/^#\/?/, '').split('?')[0];
  return ROUTES.includes(hash) ? hash : 'discover';
}

function setRoute(next, options = {}) {
  if (!ROUTES.includes(next)) next = 'discover';
  state.route = next;
  window.history.replaceState(null, '', `#/${next}`);

  ROUTES.forEach((route) => {
    const view = $(`#view-${route}`);
    if (view) view.hidden = route !== next;
  });
  $$('.nav-link, .nav-btn').forEach((el) => {
    el.classList.toggle('is-active', el.dataset.nav === next);
  });
  $$('.tab').forEach((tab) => {
    tab.classList.toggle('is-active', tab.dataset.tab === next);
  });

  if (next === 'map') renderMapView(options);
  if (next === 'admin') renderAdmin();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

window.addEventListener('hashchange', () => setRoute(routeFromHash()));

/* ============================================================
   Filtering / sorting / paging
   ============================================================ */

function applyFilters() {
  const query = state.query.trim().toLowerCase();
  const tokens = query ? query.split(/\s+/).filter(Boolean) : [];

  let list = state.books.filter((book) => {
    if (state.column && Number(book.columnNumber) !== state.column) return false;
    if (state.filterType === 'category' && book.category !== state.filterValue) return false;
    if (state.filterType === 'language' && book.language !== state.filterValue) return false;
    if (!tokens.length) return true;
    const haystack = [
      book.title,
      book.author,
      book.overview,
      book.isbn,
      book.category,
      book.language,
      `column ${book.columnNumber}`,
      `shelf ${book.shelfTier}`,
    ]
      .join(' ')
      .toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });

  if (state.sort === 'az') {
    list = [...list].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
  } else if (state.sort === 'price-asc') {
    list = [...list].sort((a, b) => priceNumber(a.estimatedPrice) - priceNumber(b.estimatedPrice));
  } else if (state.sort === 'price-desc') {
    list = [...list].sort((a, b) => priceNumber(b.estimatedPrice) - priceNumber(a.estimatedPrice));
  }

  state.filtered = list;
  return list;
}

const usePagerMode = () => !window.matchMedia('(max-width: 1023px)').matches;

/* ============================================================
   Book card rendering
   ============================================================ */

function bookCoverHTML(book, extraClass) {
  const cls = extraClass ? ` ${extraClass}` : '';
  return `<img class="${extraClass}" src="${escapeHtml(coverUrl(book))}" alt="Cover of ${escapeHtml(book.title)}" loading="lazy" />`;
}

function bookCardHTML(book) {
  const coverImg = bookCoverHTML(book, '');
  const initial = escapeHtml((book.title || 'B').charAt(0));
  return `
    <article class="book-card" data-book-id="${escapeHtml(book.id)}" tabindex="0">
      <span class="preview-flag">Previewing</span>
      <div class="book-cover">
        ${coverImg}
        <span class="cover-fallback" hidden>${initial}</span>
      </div>
      <div class="book-card__copy">
        <p class="book-meta">${escapeHtml(book.category)} · ${escapeHtml(book.language)}</p>
        <h3 class="book-title">${escapeHtml(book.title)}</h3>
        <p class="book-author">${escapeHtml(book.author)}</p>
        <span class="loc-chip">
          <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" focusable="false"><path d="M12 21s-7-6.1-7-11a7 7 0 1 1 14 0c0 4.9-7 11-7 11Z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="10" r="2.4" fill="currentColor"/></svg>
          ${escapeHtml(locationLabel(book.columnNumber, book.shelfTier))}
        </span>
      </div>
    </article>`;
}

function skeletonHTML() {
  return Array.from({ length: PAGE_SIZE })
    .map(
      () => `
      <article class="book-card" aria-hidden="true">
        <div class="sk-block sk-cover"></div>
        <div class="book-card__copy">
          <span class="sk-block sk-meta"></span>
          <span class="sk-block sk-line sk-line--w60"></span>
          <span class="sk-block sk-line sk-line--w40"></span>
        </div>
      </article>`
    )
    .join('');
}

/* Cover failures are caught once per container with a capture listener. */
function bindCoverFallbacks(container) {
  container.addEventListener(
    'error',
    (event) => {
      const img = event.target;
      if (!(img instanceof HTMLImageElement)) return;
      const fallback = img.parentElement?.querySelector('.cover-fallback');
      if (fallback) {
        fallback.textContent = (img.alt || 'B').replace(/^Cover of /, '').charAt(0);
        fallback.hidden = false;
      } else {
        img.hidden = true;
      }
    },
    true
  );
}

/* ============================================================
   Discover view
   ============================================================ */

function scopeText() {
  if (state.column) return `in Column ${state.column}`;
  if (state.filterType && state.filterValue) return `in ${state.filterValue}`;
  return 'in the library';
}

function visibleCount() {
  return Math.min(
    usePagerMode() ? state.page * PAGE_SIZE : state.visible,
    state.filtered.length
  );
}

function initialVisibleStep() {
  return visibleStep();
}

function updateChipStates() {
  $$('#exploreChips .chip').forEach((chip) => {
    chip.classList.toggle('is-active', chip.dataset.type === state.filterType && chip.dataset.value === state.filterValue);
  });
  $$('#columnChips .chip').forEach((chip) => {
    chip.classList.toggle('is-active', Number(chip.dataset.column) === state.column);
  });
}

function renderShelfMap() {
  const counts = columnCounts();

  const html = COLUMNS.map((column) => `
    <button class="shelf-tile${column === state.column ? ' is-selected' : ''}${counts[column] === 0 ? ' is-empty' : ''}"
      type="button" data-column="${column}" aria-pressed="${column === state.column}">
      <span class="num">${column}${counts[column] ? ` <span class="count">${counts[column]}</span>` : ''}</span>
      <span class="bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
    </button>
  `).join('');
  DOM.shelfMap.innerHTML = html;

  DOM.shelfMapStatus.innerHTML = state.column
    ? `<strong>Column ${state.column}</strong> selected. Shelves A–D run top to bottom.`
    : 'Pick a column to see it highlighted on the shelf map.';
}

function renderQuickPreview() {
  const pool = state.filtered && state.filtered.length ? state.filtered : state.books;
  const preview = pool.find((b) => b.id === state.previewId) || pool[0] || null;

  if (!preview) {
    DOM.quickPreview.innerHTML = '<p class="qp-overview">No books to preview yet.</p>';
    state.previewId = null;
    return;
  }
  state.previewId = preview.id;

  DOM.quickPreview.innerHTML = `
    <div class="qp-top">
      ${bookCoverHTML(preview, 'qp-cover')}
      <div class="qp-top-text">
        <span class="qp-price">${escapeHtml(preview.estimatedPrice || '—')}<small>Estimated copy price</small></span>
        <span class="qp-spot">${escapeHtml(preview.author)}</span>
      </div>
    </div>
    <p class="qp-overview">${escapeHtml(preview.overview)}</p>
    <span class="loc-chip">
      <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" focusable="false"><path d="M12 21s-7-6.1-7-11a7 7 0 1 1 14 0c0 4.9-7 11-7 11Z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="10" r="2.4" fill="currentColor"/></svg>
      ${escapeHtml(locationLabel(preview.columnNumber, preview.shelfTier))}
    </span>
    <button class="qp-link" data-view-details="${escapeHtml(preview.id)}" type="button">View book details <span aria-hidden="true">→</span></button>`;
}

function renderPagination(totalShown, total) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (usePagerMode()) {
    DOM.showMoreBtn.hidden = true;
    DOM.pager.hidden = false;

    if (state.page > totalPages) state.page = totalPages;

    const buttons = [];
    buttons.push(`<button class="pager-btn" data-page="${state.page - 1}" ${state.page === 1 ? 'disabled' : ''} aria-label="Previous page">‹</button>`);
    for (let p = 1; p <= totalPages; p += 1) {
      buttons.push(`<button class="pager-btn${p === state.page ? ' is-current' : ''}" data-page="${p}" aria-current="${p === state.page ? 'page' : 'false'}" ${totalPages === 1 ? 'disabled' : ''}>${p}</button>`);
    }
    buttons.push(`<button class="pager-btn" data-page="${state.page + 1}" ${state.page === totalPages ? 'disabled' : ''} aria-label="Next page">›</button>`);
    DOM.pager.innerHTML = buttons.join('');

    const from = totalShown === 0 ? 0 : (state.page - 1) * PAGE_SIZE + 1;
    const to = Math.min(state.page * PAGE_SIZE, total);
    DOM.pageInfo.textContent = total
      ? `Showing ${from}–${to} of ${total} books ${scopeText()}`
      : `0 books found ${scopeText()}`;
  } else {
    DOM.pager.hidden = true;
    DOM.showMoreBtn.hidden = totalShown >= total;
    DOM.pageInfo.textContent = `Showing ${totalShown} of ${total} books ${scopeText()}`;
  }
}

function renderResults() {
  updateChipStates();
  const list = applyFilters();
  const shown = list.slice(0, visibleCount());

  DOM.resultsTitle.textContent = state.column
    ? `Books in Column ${state.column}`
    : state.filterType && state.filterValue
      ? `Books in ${state.filterValue}`
      : 'All books';
  DOM.resultsSub.textContent = `${list.length} book${list.length === 1 ? '' : 's'} · Shelves A–D`;

  if (state.loadError) {
    renderCatalogUnavailable('The catalog could not be loaded. Check the server, then retry.');
    return;
  }

  if (list.length === 0) {
    DOM.bookGrid.innerHTML = '';
    DOM.emptyState.hidden = false;
    DOM.emptyMessage.textContent = state.books.length === 0
      ? 'The library catalog is empty. Librarians can add books from the Librarian space.'
      : 'Try another title, explore a category, or clear the filters.';
    DOM.pager.hidden = true;
    DOM.showMoreBtn.hidden = true;
    DOM.pageInfo.textContent = `0 books found ${scopeText()}`;
    DOM.quickPreview.innerHTML = '';
    state.previewId = null;
    renderShelfMap();
    return;
  }

  DOM.emptyState.hidden = true;
  DOM.bookGrid.innerHTML = shown.map(bookCardHTML).join('');
  renderPagination(shown.length, list.length);
  renderShelfMap();
  renderQuickPreview();
}

function renderSkeletons() {
  DOM.bookGrid.innerHTML = skeletonHTML();
  DOM.emptyState.hidden = true;
  DOM.pageInfo.textContent = 'Loading the catalog…';
}

function showMore() {
  state.visible += initialVisibleStep();
  renderResults();
}

function gotoPage(page) {
  const totalPages = Math.max(1, Math.ceil((state.filtered || []).length / PAGE_SIZE));
  state.page = Math.min(Math.max(1, page), totalPages);
  renderResults();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ============================================================
   Library map surfaces
   ============================================================ */

function columnCounts() {
  const counts = {};
  COLUMNS.forEach((c) => { counts[c] = 0; });
  state.books.forEach((b) => {
    if (counts[b.columnNumber] !== undefined) counts[b.columnNumber] += 1;
  });
  return counts;
}

function mapColumnHTML(column, counts, selected) {
  const tierBlocks = TIERS.map((tier) => {
    const tierCount = state.books.filter(
      (b) => b.columnNumber === column && b.shelfTier === tier
    ).length;
    return `<span class="map-tier${tierCount ? ' map-tier--hits' : ''}">${tier}<small>${tierCount} book${tierCount === 1 ? '' : 's'}</small></span>`;
  }).join('');

  return `
    <button class="map-col${column === selected ? ' is-selected' : ''}" type="button" data-column="${column}">
      <span class="map-col-head">Column ${column}<span class="count">${counts[column]} book${counts[column] === 1 ? '' : 's'}</span></span>
      ${tierBlocks}
    </button>`;
}

function renderMapView(options = {}) {
  const counts = columnCounts();
  DOM.bigMap.innerHTML = COLUMNS.map((c) => mapColumnHTML(c, counts, state.column)).join('');

  DOM.mapGuideText.textContent = state.column
    ? `Start at the entrance. Find the sign for Column ${state.column}, then match the shelf letter on your book's location label.`
    : 'Start at the entrance. Pick a column below, then match the shelf letter on your book\'s location label.';
  DOM.mapChipText.textContent = state.column
    ? `Column ${state.column} · Shelves A–D`
    : 'Column — · Shelves A–D';

  const columnBooks = state.column
    ? state.books.filter((b) => Number(b.columnNumber) === state.column)
    : null;

  DOM.mapColumnSection.hidden = !columnBooks;
  if (columnBooks) {
    DOM.mapColumnTitle.textContent = `Books in Column ${state.column} · ${columnBooks.length} book${columnBooks.length === 1 ? '' : 's'}`;
    DOM.mapColumnBooks.innerHTML = columnBooks.length
      ? columnBooks.map(bookCardHTML).join('')
      : '<p class="results-sub">No books catalogued in this column yet.</p>';
  }

  const card = options.pulse ? DOM.bigMap.querySelector(`.map-col[data-column="${state.column}"]`) : null;
  if (card) {
    card.classList.add('is-pulsing');
    window.setTimeout(() => card.classList.remove('is-pulsing'), 3400);
  }
}

function renderAdminMap() {
  const counts = columnCounts();
  DOM.adminMap.innerHTML = COLUMNS.map((c) => mapColumnHTML(c, counts, null)).join('');
}

/* ============================================================
   Book detail modal (student)
   ============================================================ */

let lastFocused = null;

function findBook(id) {
  return state.books.find((b) => b.id === id) || null;
}

function openBook(id) {
  const book = findBook(id);
  if (!book) {
    toast('That book is no longer in the catalog.', 'warn');
    return;
  }
  state.activeBookId = book.id;

  DOM.modalTitle.textContent = book.title;
  DOM.modalAuthor.textContent = `by ${book.author}`;
  DOM.modalLoc.innerHTML =
    `<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" focusable="false"><path d="M12 21s-7-6.1-7-11a7 7 0 1 1 14 0c0 4.9-7 11-7 11Z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="10" r="2.4" fill="currentColor"/></svg> ${escapeHtml(locationLabel(book.columnNumber, book.shelfTier))}`;
  DOM.modalLang.textContent = book.language;
  DOM.modalCat.textContent = book.category;
  DOM.modalIsbn.textContent = book.isbn;
  DOM.modalPrice.textContent = book.estimatedPrice || 'Price not listed';
  DOM.modalOverview.textContent = book.overview || 'No synopsis available yet.';

  if (book.purchaseUrl) {
    DOM.modalPurchase.href = book.purchaseUrl;
    DOM.modalPurchase.hidden = false;
  } else {
    DOM.modalPurchase.hidden = true;
  }

  DOM.modalCoverFallback.textContent = (book.title || 'B').charAt(0).toUpperCase();
  DOM.modalCover.src = coverUrl(book);
  DOM.modalCover.alt = `Cover of ${book.title}`;

  DOM.modalOverviewWrap.classList.remove('is-collapsed');
  DOM.overviewToggle.setAttribute('aria-expanded', 'true');

  lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  DOM.bookModal.hidden = false;
  DOM.bookModal.classList.add('is-open');
  document.body.classList.add('no-scroll');
  DOM.modalClose.focus();
}

function closeModal() {
  DOM.bookModal.classList.remove('is-open');
  DOM.bookModal.hidden = true;
  document.body.classList.remove('no-scroll');
  if (lastFocused instanceof HTMLElement) lastFocused.focus();
  lastFocused = null;
}

function locateOnMap() {
  const book = findBook(state.activeBookId);
  if (!book) return;
  state.column = Number(book.columnNumber);
  closeModal();
  setRoute('map', { pulse: true });
}

/* ============================================================
   Help modal (mobile "Help" tab)
   ============================================================ */

function openHelp() {
  lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  DOM.helpModal.hidden = false;
  DOM.helpModal.classList.add('is-open');
  document.body.classList.add('no-scroll');
  DOM.helpClose.focus();
}

function closeHelp() {
  DOM.helpModal.classList.remove('is-open');
  DOM.helpModal.hidden = true;
  document.body.classList.remove('no-scroll');
  if (lastFocused instanceof HTMLElement) lastFocused.focus();
  lastFocused = null;
}

/* ============================================================
   Admin (librarian space)
   ============================================================ */

function fieldError(name, message) {
  const input = DOM.fields[name];
  if (!input) return;
  const field = input.closest('.field');
  const errorEl = field?.querySelector('.field-error');
  field?.classList.toggle('is-error', Boolean(message));
  if (errorEl) {
    errorEl.textContent = message || '';
    errorEl.hidden = !message;
  }
}

function clearFieldErrors() {
  Object.keys(DOM.fields).forEach((key) => fieldError(key, ''));
  setBanner('');
}

function setBanner(message, type = 'error') {
  DOM.formBanner.textContent = message;
  DOM.formBanner.classList.toggle('is-success', type === 'success');
  DOM.formBanner.hidden = !message;
}

function isValidIsbn13(digits) {
  if (!/^97[89]\d{10}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(digits[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10 === Number(digits[12]);
}

function formValues() {
  return {
    title: DOM.fields.title.value.trim(),
    author: DOM.fields.author.value.trim(),
    category: DOM.fields.category.value,
    language: DOM.fields.language.value,
    columnNumber: DOM.fields.columnNumber.value,
    shelfTier: DOM.fields.shelfTier.value,
    isbn: DOM.fields.isbn.value.replace(/\D/g, ''),
    overview: DOM.fields.overview.value.trim(),
    price: DOM.fields.price.value.trim(),
  };
}

function updateFormPreview() {
  const values = formValues();
  const isbn = values.isbn;
  const digitsOk = /^\d{13}$/.test(isbn) && /^97[89]/.test(isbn);

  DOM.isbnHint.classList.toggle('is-ok', digitsOk && isValidIsbn13(isbn));
  DOM.isbnHint.textContent = digitsOk
    ? isValidIsbn13(isbn)
      ? '✓ Valid ISBN-13 format. Verify the edition before saving.'
      : '13 digits OK, but the checksum did not match. Verify the edition.'
    : 'Enter a 13-digit ISBN starting with 978 or 979.';

  if (digitsOk) {
    DOM.pvCover.src = `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`;
    DOM.pvCover.hidden = false;
    DOM.pvCoverFallback.hidden = true;
  } else {
    DOM.pvCover.hidden = true;
    DOM.pvCoverFallback.hidden = false;
  }

  DOM.pvTitle.textContent = values.title || 'New book';
  DOM.pvAuthor.textContent = values.author ? `by ${values.author}` : 'by …';
  DOM.pvMeta.textContent = `${values.category} · ${values.language}${values.price ? ` · ${values.price} MAD` : ''}`;
  DOM.tierCardTitle.textContent = locationLabel(values.columnNumber, values.shelfTier);
  DOM.pvLoc.innerHTML =
    `<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" focusable="false"><path d="M12 21s-7-6.1-7-11a7 7 0 1 1 14 0c0 4.9-7 11-7 11Z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="10" r="2.4" fill="currentColor"/></svg> ${escapeHtml(locationLabel(values.columnNumber, values.shelfTier))}`;

  $$('#tierList .tier').forEach((tier) => {
    tier.classList.toggle('is-current', tier.dataset.tier === values.shelfTier);
  });
}

function validateAdminForm(values) {
  const errors = {};
  if (!values.title) errors.title = 'Title is required. Type the title printed on the book cover.';
  if (!values.author) errors.author = 'Author is required.';
  if (!values.isbn) errors.isbn = 'ISBN is required.';
  else if (!/^\d{13}$/.test(values.isbn)) errors.isbn = 'ISBN must be exactly 13 digits starting 978 or 979.';
  if (!values.overview) errors.overview = 'Overview is required. Write a short, student-friendly synopsis.';
  return errors;
}

async function submitCatalogForm() {
  const values = formValues();
  const errors = validateAdminForm(values);
  Object.keys(DOM.fields).forEach((name) => fieldError(name, errors[name] || ''));

  if (Object.keys(errors).length) {
    setBanner('Please fix the highlighted fields before saving.');
    DOM.fields[Object.keys(errors)[0]]?.focus();
    return;
  }

  const button = $('#addBookBtn');
  button.disabled = true;
  try {
    const result = await api.createBook({
      title: values.title,
      author: values.author,
      category: values.category,
      language: values.language,
      columnNumber: Number(values.columnNumber),
      shelfTier: values.shelfTier,
      isbn: values.isbn,
      overview: values.overview,
      estimatedPrice: values.price ? Number(values.price) : '',
    });
    setBanner(`"${result.book.title}" was added to the catalog.`, 'success');
    toast(`"${result.book.title}" is now catalogued. Students can find it in ${locationLabel(result.book.columnNumber, result.book.shelfTier)}.`, 'success', { title: 'Book added' });
    DOM.catForm.reset();
    DOM.fields.columnNumber.value = '3';
    DOM.fields.shelfTier.value = 'B';
    DOM.fields.title.focus();
  } catch (error) {
    setBanner(error.message);
    if (error.details) {
      Object.keys(error.details).forEach((name) => fieldError(name, error.details[name]));
    }
    toast(error.message, 'error', { title: error.status === 409 ? 'Already catalogued' : 'Could not save' });
  } finally {
    button.disabled = false;
  }

  await loadCatalog();
  renderAdminList();
  updateFormPreview();
}

function renderAdminList() {
  DOM.adminListCount.textContent = String(state.books.length);
  DOM.adminBookList.innerHTML = state.books
    .map(
      (book) => `
      <li>
        <img class="abl-cover" src="${escapeHtml(coverUrl(book))}" alt="" loading="lazy" />
        <span class="abl-info">
          <strong>${escapeHtml(book.title)}</strong>
          <small>${escapeHtml(book.author)} · ${escapeHtml(book.isbn)}</small>
        </span>
        <span class="abl-loc">${escapeHtml(locationLabel(book.columnNumber, book.shelfTier))}</span>
        <button class="delete-btn" data-delete="${escapeHtml(book.id)}" data-title="${escapeHtml(book.title)}" type="button">Remove</button>
      </li>`
    )
    .join('');
}

function setAdminTab(tab) {
  if (!ADMIN_TABS.includes(tab)) tab = 'catalog';
  state.adminTab = tab;
  ADMIN_TABS.forEach((name) => {
    const panel = $(`#admintab-${name}`);
    if (panel) panel.hidden = name !== tab;
  });
  $$('.sidenav-btn').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.admtab === tab);
  });
  if (tab === 'map') renderAdminMap();
  if (tab === 'catalog') {
    updateFormPreview();
    renderAdminList();
  }
}

function renderAdmin() {
  updateFormPreview();
  renderAdminList();
  setAdminTab(state.adminTab);
}

/* ============================================================
   Import / export
   ============================================================ */

function triggerDownload() {
  const link = document.createElement('a');
  link.href = '/api/books/export';
  link.download = 'catalog.json';
  document.body.appendChild(link);
  link.click();
  link.remove();
  toast('catalog.json download started.', 'success', { title: 'Export' });
}

function handleImportFile(file) {
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async () => {
    let payload;
    try {
      payload = JSON.parse(String(reader.result));
    } catch (parseError) {
      toast('The file is not valid JSON. Open it in an editor and fix syntax errors, then retry.', 'error', { title: 'Import failed' });
      return;
    }

    try {
      const result = await api.importBooks(payload);
      const { imported, skipped, errors = [] } = result;

      if (imported === 0) {
        toast('No valid records were imported. See the details listed below.', 'error', { title: 'Import failed' });
      } else if (skipped > 0) {
        toast(`Imported ${imported} book${imported === 1 ? '' : 's'}; ${skipped} record${skipped === 1 ? '' : 's'} need attention.`, 'warn', { title: 'Import finished' });
      } else {
        toast(`Imported ${imported} book${imported === 1 ? '' : 's'} into the catalog.`, 'success', { title: 'Import finished' });
      }

      const list = DOM.importResults;
      list.innerHTML = errors.length
        ? `<strong>${imported} imported · ${skipped} need attention</strong>
           <ul>${errors.slice(0, 8).map((e) => `<li>${escapeHtml(e.title || `Record ${e.index + 1}`)}: ${escapeHtml(e.message)}</li>`).join('')}</ul>${errors.length > 8 ? `<p class="import-note">…and ${errors.length - 8} more.</p>` : ''}`
        : `<strong>${imported} imported</strong><p class="import-note">All records passed validation.</p>`;
      list.hidden = false;

      if (state.adminTab !== 'io') setAdminTab('io');
      if (imported) {
        await loadCatalog();
        renderAdminList();
      }
    } catch (error) {
      toast(error.message, 'error', { title: 'Import failed' });
    }
  };
  reader.onerror = () => toast('The file could not be read. Try re-saving it as JSON.', 'error', { title: 'Import failed' });
  reader.readAsText(file);
}

/* ============================================================
   Events
   ============================================================ */

let searchTimer = null;

function bindDiscoverEvents() {
  bindCoverFallbacks(DOM.bookGrid);
  bindCoverFallbacks(DOM.mapColumnBooks);
  bindCoverFallbacks(DOM.quickPreview);

  DOM.searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    renderResults();
  });

  DOM.searchInput.addEventListener('input', (event) => {
    state.query = event.target.value;
    state.page = 1;
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => renderResults(), 300);
  });

  DOM.exploreChips.addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (!chip) return;
    const same = state.filterType === chip.dataset.type && state.filterValue === chip.dataset.value;
    state.filterType = same ? null : chip.dataset.type;
    state.filterValue = same ? null : chip.dataset.value;
    state.page = 1;
    renderResults();
  });

  DOM.columnChips.addEventListener('click', (event) => {
    const chip = event.target.closest('.chip--column');
    if (!chip) return;
    const column = Number(chip.dataset.column);
    state.column = state.column === column ? null : column;
    state.page = 1;
    renderResults();
  });

  DOM.shelfMap.addEventListener('click', (event) => {
    const tile = event.target.closest('.shelf-tile');
    if (!tile) return;
    const column = Number(tile.dataset.column);
    state.column = state.column === column ? null : column;
    state.page = 1;
    renderResults();
  });

  DOM.clearFilters.addEventListener('click', () => {
    state.filterType = null;
    state.filterValue = null;
    state.column = null;
    state.page = 1;
    renderResults();
    toast('Filters cleared. Showing the whole catalog.', 'info');
  });

  DOM.sortSelect.addEventListener('change', (event) => {
    state.sort = event.target.value;
    renderResults();
  });

  DOM.showMoreBtn.addEventListener('click', showMore);

  DOM.pager.addEventListener('click', (event) => {
    const button = event.target.closest('.pager-btn');
    if (!button || button.disabled) return;
    gotoPage(Number(button.dataset.page));
  });

  const hoverFine = window.matchMedia('(hover: hover) and (pointer: fine)');
  DOM.bookGrid.addEventListener('mouseover', (event) => {
    if (!hoverFine.matches) return;
    const card = event.target.closest('.book-card');
    if (!card) return;
    $$('.book-card', DOM.bookGrid).forEach((el) => el.classList.toggle('is-previewed', el === card));
    state.previewId = card.dataset.bookId;
    renderQuickPreview();
  });

  DOM.bookGrid.addEventListener('click', (event) => {
    const card = event.target.closest('.book-card');
    if (card) openBook(card.dataset.bookId);
  });

  DOM.bookGrid.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const card = event.target.closest('.book-card');
    if (!card) return;
    event.preventDefault();
    openBook(card.dataset.bookId);
  });

  DOM.quickPreview.addEventListener('click', (event) => {
    const button = event.target.closest('[data-view-details]');
    if (button) openBook(button.dataset.viewDetails);
  });

  DOM.mapColumnBooks.addEventListener('click', (event) => {
    const card = event.target.closest('.book-card');
    if (card) openBook(card.dataset.bookId);
  });

  DOM.retryLoad.addEventListener('click', async () => {
    renderSkeletons();
    await loadCatalog();
    renderResults();
  });

  window
    .matchMedia('(max-width: 1023px)')
    .addEventListener('change', () => {
      state.visible = visibleStep();
      renderResults();
    });
}

function bindModalEvents() {
  bindCoverFallbacks(DOM.bookModal.querySelector('.bm-media'));

  DOM.modalClose.addEventListener('click', closeModal);
  DOM.modalBackdrop.addEventListener('click', closeModal);
  DOM.modalOverviewWrap.querySelector('.bm-collapsible').addEventListener('click', () => {
    const collapsed = DOM.modalOverviewWrap.classList.toggle('is-collapsed');
    DOM.overviewToggle.setAttribute('aria-expanded', String(!collapsed));
  });
  DOM.modalLocate.addEventListener('click', locateOnMap);
  DOM.modalPurchase.addEventListener('click', () => closeModal());

  DOM.helpClose.addEventListener('click', closeHelp);
  DOM.helpBackdrop.addEventListener('click', closeHelp);
  DOM.helpBackBtn.addEventListener('click', closeHelp);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (!DOM.helpModal.hidden) closeHelp();
      else if (!DOM.bookModal.hidden) closeModal();
      else if (DOM.searchInput.value) {
        DOM.searchInput.value = '';
        state.query = '';
        renderResults();
      }
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (state.route !== 'discover') setRoute('discover');
      DOM.searchInput.focus();
    }
  });
}

function bindTopNavEvents() {
  document.addEventListener('click', (event) => {
    const link = event.target.closest('[data-nav]');
    if (link) {
      event.preventDefault();
      setRoute(link.dataset.nav);
      return;
    }
    const tab = event.target.closest('.tab');
    if (tab) {
      if (tab.dataset.tab === 'help') openHelp();
      else setRoute(tab.dataset.tab);
    }
  });
}

function bindAdminEvents() {
  DOM.tierList.addEventListener('click', (event) => {
    const tier = event.target.closest('.tier');
    if (!tier) return;
    DOM.fields.shelfTier.value = tier.dataset.tier;
    updateFormPreview();
  });

  DOM.catForm.addEventListener('input', updateFormPreview);
  DOM.catForm.addEventListener('change', updateFormPreview);

  DOM.catForm.addEventListener('submit', (event) => {
    event.preventDefault();
    submitCatalogForm();
  });

  DOM.clearFormBtn.addEventListener('click', () => {
    DOM.catForm.reset();
    DOM.fields.columnNumber.value = '3';
    DOM.fields.shelfTier.value = 'B';
    clearFieldErrors();
    DOM.isbnHint.classList.remove('is-ok');
    DOM.isbnHint.textContent = 'Enter a 13-digit ISBN starting with 978 or 979.';
    updateFormPreview();
  });

  DOM.autofetchBtn.addEventListener('click', async () => {
    const digits = formValues().isbn;
    const field = DOM.fields.isbn.closest('.field');
    if (!/^\d{13}$/.test(digits)) {
      field.classList.add('is-error');
      const errorEl = field.querySelector('.field-error');
      if (errorEl) {
        errorEl.textContent = 'Enter a complete 13-digit ISBN before auto-fetching.';
        errorEl.hidden = false;
      }
      DOM.fields.isbn.focus();
      return;
    }
    DOM.autofetchBtn.disabled = true;
    try {
      const data = await api.fetchOpenLibrary(digits);
      const record = data && data[`ISBN:${digits}`];
      if (!record || !record.title) {
        toast('Open Library has no record for this ISBN. Fill in the details manually.', 'warn', { title: 'Nothing found' });
        return;
      }
      if (!DOM.fields.title.value.trim() && record.title) DOM.fields.title.value = record.title;
      if (!DOM.fields.author.value.trim() && Array.isArray(record.authors) && record.authors.length) {
        DOM.fields.author.value = record.authors.map((a) => a.name).join(', ');
      }
      if (!DOM.fields.overview.value.trim() && record.excerpts?.length) {
        DOM.fields.overview.value = String(record.excerpts[0].text || '').slice(0, 400);
      }
      updateFormPreview();
      toast('Details fetched from Open Library. Verify them against the physical copy before saving.', 'success', { title: 'Auto-fetch complete' });
    } catch (error) {
      toast('Could not reach Open Library. You can still catalog the book manually.', 'error', { title: 'Auto-fetch failed' });
    } finally {
      DOM.autofetchBtn.disabled = false;
    }
  });

  $('#uploadJsonBtn').addEventListener('click', () => DOM.importFile.click());
  $('#chooseJsonBtn').addEventListener('click', () => DOM.importFile.click());

  [DOM.importFile, DOM.importFile2].forEach((input) => {
    input.addEventListener('change', () => {
      handleImportFile(input.files && input.files[0]);
      input.value = '';
    });
  });

  $('#exportBtnTop').addEventListener('click', triggerDownload);
  $('#exportBtnIo').addEventListener('click', triggerDownload);

  DOM.bigMap.addEventListener('click', (event) => {
    const col = event.target.closest('.map-col');
    if (!col) return;
    const column = Number(col.dataset.column);
    state.column = state.column === column ? null : column;
    renderMapView();
  });

  DOM.adminMap.addEventListener('click', (event) => {
    const col = event.target.closest('.map-col');
    if (!col) return;
    state.column = Number(col.dataset.column);
    setRoute('discover');
    renderResults();
  });

  $$('.sidenav-btn').forEach((btn) => {
    btn.addEventListener('click', () => setAdminTab(btn.dataset.admtab));
  });

  DOM.adminBookList.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-delete]');
    if (!button) return;
    const id = button.dataset.delete;
    const title = button.dataset.title;
    if (!window.confirm(`Remove "${title}" from the catalog? This cannot be undone.`)) return;
    try {
      await api.deleteBook(id);
      toast(`"${title}" was removed from the catalog.`, 'success', { title: 'Book removed' });
      await loadCatalog();
      renderAdminList();
      renderResults();
    } catch (error) {
      toast(error.message, 'error', { title: 'Delete failed' });
    }
  });
}

/* ============================================================
   Boot
   ============================================================ */

async function init() {
  bindTopNavEvents();
  bindDiscoverEvents();
  bindModalEvents();
  bindAdminEvents();

  setRoute(routeFromHash());
  renderSkeletons();
  await loadCatalog();
  renderResults();
  updateStatTotals();
}

init();

