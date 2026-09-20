// ============================================================================
// VIEWS.JS - Vistas: Colección (Carga Invisible por Lotes + Drag & Drop Protegido),
//            Búsqueda Inteligente (Fuzzy & Acentos), Cronología,
//            Grafo Constelación Transparente, Estadísticas y Colecciones
//            + Muro de Portadas Letterboxd (Medio y Compacto / 0% GPU)
//            + Cesto Flotante de Desvinculación y Botón folder-minus en Tarjetas
//            + Semáforo Anti-Congelamiento de Hilo UI (Chromium/WebView2 Guard)
// ============================================================================

import { 
  state, 
  library, 
  saveLibrary, 
  getStatusIconName, 
  COUNTRY_FLAGS, 
  refreshLucide, 
  showToast, 
  customCollections, 
  addItemToCollection, 
  removeItemFromCollection,
  deleteCustomCollection,
  flushDeferredRender,
  queueDeferredRender
} from './state.js';

import { 
  escapeHtml, 
  openDetailModal, 
  openCoverModal, 
  openDeleteModal, 
  setTagFilter, 
  openDayInspectorModal 
} from './modals.js';

import { initOrUpdateAtlas } from './atlas.js';

let graphInstance = null;
let draggedItemId = null;
let viewsEventsInitialized = false;
const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

// ============================================================================
// 0. UTILIDADES DE COBERTURA Y FORMATEO
// ============================================================================

/**
 * Valida si la URL de la portada es válida (HTTP, HTTPS, Blob URL, Data-URI o ruta local).
 * @param {string|null|undefined} url 
 * @returns {boolean}
 */
function isValidCover(url) {
  if (!url || typeof url !== 'string') return false;
  const clean = url.trim();
  if (clean.length < 5) return false;
  return (
    clean.startsWith('http://') ||
    clean.startsWith('https://') ||
    clean.startsWith('blob:') ||
    clean.startsWith('data:image/') ||
    clean.startsWith('./') ||
    clean.startsWith('/')
  );
}

/**
 * Formatea una calificación numérica con pasos dinámicos de decimales (ej. ★ 5, ★ 4.5, ★ 4.75).
 * @param {number|null|undefined} rating 
 * @returns {string}
 */
function formatRatingPill(rating) {
  const num = parseFloat(rating);
  if (!num || isNaN(num) || num <= 0) return '';
  return `★ ${Number(num).toFixed(num % 1 === 0 ? 0 : (num % 0.5 === 0 ? 1 : 2))}`;
}

// ============================================================================
// 0.1 MOTOR DE BÚSQUEDA INTELIGENTE (INSENSIBLE A TILDES Y TOLERANTE A ERRORES)
// ============================================================================
function normalizeSearch(str = '') {
  return String(str ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function levenshteinDistance(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

function tokenMatchesTarget(token, targetWords, rawTargetNormalized) {
  if (rawTargetNormalized.includes(token)) return true;
  if (token.length < 4) return false;

  const maxDistance = token.length <= 5 ? 1 : 2;
  return targetWords.some(word => {
    if (Math.abs(word.length - token.length) > maxDistance) return false;
    return levenshteinDistance(token, word) <= maxDistance;
  });
}

function matchesSmartSearch(query, item) {
  if (!query || !query.trim()) return true;

  const normQuery = normalizeSearch(query);
  const tokens = normQuery.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;

  const creator = item.details?.author || item.details?.director || item.details?.artist || item.creator || '';
  const publisher = item.details?.publisher || item.details?.studio || item.publisher || '';
  const year = String(item.releaseYear || '');
  const tags = (item.tags || []).join(' ');
  const notes = item.userNotes || '';

  const targetText = `${item.title || ''} ${creator} ${item.country || ''} ${publisher} ${year} ${tags} ${notes}`;
  const normTarget = normalizeSearch(targetText);
  const targetWords = normTarget.split(/[\s,.;:()\[\]\-_/]+/).filter(Boolean);

  return tokens.every(token => tokenMatchesTarget(token, targetWords, normTarget));
}

// ----------------------------------------------------------------------------
// 1. GESTOR PRINCIPAL DE PESTAÑAS (SUSPENSIÓN DE HARDWARE Y RENDERS PROTEGIDOS)
// ----------------------------------------------------------------------------
export function renderActiveView() {
  // Si el usuario está realizando un gesto físico de arrastre, retenemos el render
  // para no desmontar elementos activos de WebView2 y evitar cuelgues.
  if (state.isDragging) {
    queueDeferredRender(renderActiveView);
    return;
  }

  const mediaContainer = document.getElementById('media-container');
  const timelineView = document.getElementById('timeline-view');
  const graphView = document.getElementById('graph-view');
  const mapView = document.getElementById('map-view');
  const statsView = document.getElementById('stats-view');
  const viewModeToggle = document.getElementById('view-mode-toggle');
  const sortSelect = document.getElementById('sort-select');

  mediaContainer?.classList.add('hidden');
  timelineView?.classList.add('hidden');
  graphView?.classList.add('hidden');
  mapView?.classList.add('hidden');
  statsView?.classList.add('hidden');
  viewModeToggle?.classList.add('hidden');
  sortSelect?.classList.add('hidden');

  renderSidebarCollections();

  if (state.currentActiveView === 'library') {
    mediaContainer?.classList.remove('hidden');
    viewModeToggle?.classList.remove('hidden');
    sortSelect?.classList.remove('hidden');
    renderCollection();
  } else if (state.currentActiveView === 'timeline') {
    timelineView?.classList.remove('hidden');
    renderTimelineSection();
  } else if (state.currentActiveView === 'graph') {
    graphView?.classList.remove('hidden');
    initOrUpdateGraph();
  } else if (state.currentActiveView === 'map') {
    mapView?.classList.remove('hidden');
    initOrUpdateAtlas();
  } else if (state.currentActiveView === 'stats') {
    statsView?.classList.remove('hidden');
    renderStatsDashboard();
  }

  if (graphInstance) {
    if (state.currentActiveView === 'graph') {
      graphInstance.resumeAnimation();
    } else {
      graphInstance.pauseAnimation();
    }
  }

  refreshLucide();
}

// ----------------------------------------------------------------------------
// 2. COLECCIÓN (FILTRADO INTELIGENTE Y CARGA POR LOTES INVISIBLE)
// ----------------------------------------------------------------------------
const CHUNK_SIZE = 40;
let currentRenderedCount = 0;
let currentFilteredItems = [];
let collectionObserver = null;

function cleanupCollectionObserver() {
  if (collectionObserver) {
    collectionObserver.disconnect();
    collectionObserver = null;
  }
}

export function filterAndSortItems() {
  let filtered = library.filter(item => {
    const matchesType = (state.activeTypeFilter === 'all') || (item.type === state.activeTypeFilter);
    const matchesStatus = (state.activeStatusFilter === 'all') || (item.status === state.activeStatusFilter);
    const matchesWishlist = !state.isWishlistFilterActive || (item.isWishlist === true);
    const matchesCollection = !state.activeCollectionFilter || (Array.isArray(item.collections) && item.collections.includes(state.activeCollectionFilter));
    const matchesTag = !state.activeTagFilter || (item.tags && item.tags.includes(state.activeTagFilter)) || (item.country === state.activeTagFilter);

    const matchesSearch = matchesSmartSearch(state.searchQuery, item);

    return matchesType && matchesStatus && matchesWishlist && matchesCollection && matchesTag && matchesSearch;
  });

  filtered.sort((a, b) => {
    if (state.currentSortOrder === 'year-desc') return (b.releaseYear || 0) - (a.releaseYear || 0);
    if (state.currentSortOrder === 'year-asc') return (a.releaseYear || 0) - (b.releaseYear || 0);
    if (state.currentSortOrder === 'rating-desc') return (b.userRating || 0) - (a.userRating || 0);
    if (state.currentSortOrder === 'title-asc') {
      return (a.title || '').localeCompare(b.title || '');
    }
    return 0;
  });

  return filtered;
}

function buildCardElement(item, viewMode) {
  const hasCover = isValidCover(item.coverUrl);
  const typeIcon = item.type === 'book' ? 'book' : (item.type === 'movie' ? 'film' : 'disc');
  const safeTitle = escapeHtml(item.title || 'Sin título');
  const statusIcon = getStatusIconName(item.type, item.status);
  const safeCountry = escapeHtml(item.country || 'N/A');
  const creatorRaw = item.details?.author || item.details?.director || item.details?.artist || item.creator || 'Creador';
  const creator = escapeHtml(creatorRaw);

  const removeColBtnHtml = state.activeCollectionFilter ? `
    <button type="button" class="btn-remove-from-collection" data-id="${escapeHtml(item.id)}" title="Quitar de «${escapeHtml(state.activeCollectionFilter)}»">
      <i data-lucide="folder-minus"></i>
    </button>
  ` : '';

  // ==========================================================================
  // A) MURO DE PORTADAS LETTERBOXD (MEDIO Y MASIVO/COMPACTO)
  // ==========================================================================
  if (viewMode === 'poster-medium' || viewMode === 'poster-massive') {
    const card = document.createElement('div');
    card.className = `media-poster-card type-${item.type} mode-${viewMode}`;
    card.dataset.id = item.id;
    card.setAttribute('draggable', 'true');

    const yearStr = item.releaseYear ? ` (${item.releaseYear})` : '';
    const ratingStr = item.userRating ? ` • ★ ${Number(item.userRating).toFixed(item.userRating % 1 === 0 ? 0 : (item.userRating % 0.5 === 0 ? 1 : 2))}` : '';
    card.title = `${item.title || 'Sin título'}${yearStr} — ${creatorRaw}${ratingStr}`;

    const wishlistBadge = item.isWishlist ? `<div class="poster-wishlist-badge"><i data-lucide="sparkles"></i></div>` : '';
    
    const coverHtml = hasCover
      ? `<img src="${escapeHtml(item.coverUrl)}" alt="${safeTitle}" class="poster-cover-img" draggable="false" loading="lazy" decoding="async" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
         <div class="poster-placeholder-fallback hidden">
           <i data-lucide="${typeIcon}"></i>
           <span>${safeTitle}</span>
         </div>`
      : `<div class="poster-placeholder-fallback">
           <i data-lucide="${typeIcon}"></i>
           <span>${safeTitle}</span>
         </div>`;

    card.innerHTML = `
      ${wishlistBadge}
      ${removeColBtnHtml}
      <div class="poster-cover-wrap">
        ${coverHtml}
      </div>
    `;
    return card;
  }

  // ==========================================================================
  // B) CUADRÍCULA NORMAL CON FICHA COMPLETA
  // ==========================================================================
  if (viewMode === 'grid') {
    const card = document.createElement('div');
    card.className = `media-card type-${item.type}`;
    card.dataset.id = item.id;
    card.setAttribute('draggable', 'true');

    const coverHtml = hasCover
      ? `<img src="${escapeHtml(item.coverUrl)}" alt="${safeTitle}" class="card-cover" draggable="false" loading="lazy" decoding="async" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
         <div class="card-placeholder-fallback hidden">
           <i data-lucide="${typeIcon}"></i>
           <span>${safeTitle}</span>
         </div>`
      : `<div class="card-placeholder-fallback">
           <i data-lucide="${typeIcon}"></i>
           <span>${safeTitle}</span>
         </div>`;

    let specificInfo = '';
    if (item.type === 'book') {
      specificInfo = `<div class="card-creator">${creator}</div>`;
    } else if (item.type === 'movie') {
      const year = escapeHtml(String(item.releaseYear || ''));
      specificInfo = `<div class="card-creator">Dir. ${creator} (${year})</div>`;
    } else if (item.type === 'music') {
      const year = escapeHtml(String(item.releaseYear || ''));
      specificInfo = `<div class="card-creator">${creator} (${year})</div>`;
    }

    const tagsHtml = (item.tags || []).slice(0, 3).map(tag => `<span class="tag-badge" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</span>`).join('');
    const wishlistBadge = item.isWishlist ? `<div class="wishlist-ribbon"><i data-lucide="sparkles"></i> Deseo</div>` : '';

    card.innerHTML = `
      ${wishlistBadge}
      <div class="cover-wrapper">
        ${coverHtml}
      </div>
      <div class="card-body">
        <h4 class="card-title">${safeTitle}</h4>
        ${specificInfo}
        <div class="card-creator"><span class="tag-badge" data-tag="${safeCountry}">📍 ${safeCountry}</span></div>
        <div class="card-tags">${tagsHtml}</div>
        <div class="card-actions">
          <button type="button" class="btn-edit-cover" data-id="${escapeHtml(item.id)}">🖼️ Portada</button>
          ${removeColBtnHtml}
          <button type="button" class="btn-status-toggle status-${escapeHtml(item.status || 'todo')}" data-id="${escapeHtml(item.id)}" title="Alternar Estado">
            <i data-lucide="${statusIcon}"></i>
          </button>
          <button type="button" class="btn-delete-item" data-id="${escapeHtml(item.id)}" title="Eliminar"><i data-lucide="trash-2"></i></button>
        </div>
      </div>
    `;
    return card;
  } 

  // ==========================================================================
  // C) VISTA LISTA COMPACTA
  // ==========================================================================
  else {
    const row = document.createElement('div');
    row.className = 'media-list-row';
    row.dataset.id = item.id;
    row.setAttribute('draggable', 'true');

    const thumbHtml = hasCover
      ? `<img src="${escapeHtml(item.coverUrl)}" class="list-thumb" draggable="false" loading="lazy" decoding="async" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
         <div class="list-thumb-placeholder hidden"><i data-lucide="${typeIcon}"></i></div>`
      : `<div class="list-thumb-placeholder"><i data-lucide="${typeIcon}"></i></div>`;

    const stars = item.userRating 
      ? `★ ${Number(item.userRating).toFixed(item.userRating % 1 === 0 ? 0 : (item.userRating % 0.5 === 0 ? 1 : 2))}` 
      : '-';

    const wishlistTag = item.isWishlist ? '<i data-lucide="sparkles" style="color:var(--wishlist-gold)"></i>' : '';
    const tagsHtml = (item.tags || []).slice(0, 2).map(t => `<span class="tag-badge" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</span>`).join('');

    row.innerHTML = `
      ${thumbHtml}
      <div class="list-title">${wishlistTag} ${safeTitle}</div>
      <div class="list-creator">${creator}</div>
      <div class="list-year">${escapeHtml(String(item.releaseYear || '-'))}</div>
      <div class="list-country"><span class="tag-badge" data-tag="${safeCountry}">${safeCountry}</span></div>
      <div class="list-stars" style="font-weight:700; letter-spacing:0.5px; color:var(--star-gold);">${escapeHtml(stars)}</div>
      <div class="list-tags">${tagsHtml}</div>
      <div class="card-actions" style="border:none; margin:0; padding:0;">
        ${removeColBtnHtml}
        <button type="button" class="btn-status-toggle status-${escapeHtml(item.status || 'todo')}" data-id="${escapeHtml(item.id)}" title="Alternar Estado">
          <i data-lucide="${statusIcon}"></i>
        </button>
        <button type="button" class="btn-delete-item" data-id="${escapeHtml(item.id)}" title="Eliminar"><i data-lucide="trash-2"></i></button>
      </div>
    `;
    return row;
  }
}

/**
 * Inyecta el siguiente bloque de 40 obras desde RAM al DOM de forma instantánea.
 */
function appendNextCollectionChunk() {
  const mediaContainer = document.getElementById('media-container');
  if (!mediaContainer || currentRenderedCount >= currentFilteredItems.length) {
    cleanupCollectionObserver();
    return;
  }

  const nextBatch = currentFilteredItems.slice(currentRenderedCount, currentRenderedCount + CHUNK_SIZE);
  if (nextBatch.length === 0) {
    cleanupCollectionObserver();
    return;
  }

  const fragment = document.createDocumentFragment();
  nextBatch.forEach(item => {
    fragment.appendChild(buildCardElement(item, state.currentViewMode));
  });

  const existingSentinel = document.getElementById('collection-scroll-sentinel');
  if (existingSentinel) existingSentinel.remove();

  mediaContainer.appendChild(fragment);
  currentRenderedCount += nextBatch.length;

  if (currentRenderedCount < currentFilteredItems.length) {
    const sentinel = document.createElement('div');
    sentinel.id = 'collection-scroll-sentinel';
    sentinel.style.cssText = 'height: 1px; width: 100%; grid-column: 1 / -1; pointer-events: none; opacity: 0;';
    mediaContainer.appendChild(sentinel);

    cleanupCollectionObserver();
    collectionObserver = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        appendNextCollectionChunk();
      }
    }, {
      rootMargin: '600px'
    });
    collectionObserver.observe(sentinel);
  } else {
    cleanupCollectionObserver();
  }

  refreshLucide();
}

/**
 * Sincroniza y actualiza la zona de arrastre flotante en la esquina inferior derecha.
 */
function updateFloatingDropzoneUI() {
  let dropzone = document.getElementById('floating-remove-dropzone');

  if (!state.activeCollectionFilter) {
    if (dropzone) dropzone.remove();
    return;
  }

  if (!dropzone) {
    dropzone = document.createElement('div');
    dropzone.id = 'floating-remove-dropzone';
    dropzone.className = 'floating-remove-dropzone';
    document.querySelector('.main-content')?.appendChild(dropzone);

    // Eventos nativos de zona de soltar (Dropzone)
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      dropzone.classList.add('drag-over');
    });

    dropzone.addEventListener('dragleave', (e) => {
      if (!e.relatedTarget || !dropzone.contains(e.relatedTarget)) {
        dropzone.classList.remove('drag-over');
      }
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag-over', 'drag-active');
      const itemId = draggedItemId || e.dataTransfer.getData('text/plain');
      const activeCol = state.activeCollectionFilter;

      if (itemId && activeCol) {
        const removed = removeItemFromCollection(itemId, activeCol);
        if (removed) {
          showToast(`Obra retirada de «${activeCol}».`, 'info');
          renderSidebarCollections();
          renderCollection();
        }
      }
      draggedItemId = null;
    });
  }

  dropzone.innerHTML = `
    <div class="dropzone-inner">
      <i data-lucide="folder-x"></i>
      <div class="dropzone-text">
        <span>Arrastra aquí</span>
        <small>para quitar de «${escapeHtml(state.activeCollectionFilter)}»</small>
      </div>
    </div>
  `;
  refreshLucide();
}

export function renderCollection() {
  const mediaContainer = document.getElementById('media-container');
  const statsSummary = document.getElementById('stats-summary');
  const activeTagChip = document.getElementById('active-tag-chip');
  const activeTagName = document.getElementById('active-tag-name');
  const activeCollectionChip = document.getElementById('active-collection-chip');
  const activeCollectionName = document.getElementById('active-collection-name');
  if (!mediaContainer) return;

  currentFilteredItems = filterAndSortItems();
  currentRenderedCount = 0;
  cleanupCollectionObserver();

  if (statsSummary) {
    statsSummary.textContent = `${currentFilteredItems.length} elemento(s) en Colección de ${library.length} total`;
  }
  
  if (state.activeTagFilter && activeTagChip && activeTagName) {
    activeTagChip.classList.remove('hidden');
    activeTagName.textContent = `Etiqueta: ${state.activeTagFilter}`;
  } else if (activeTagChip) {
    activeTagChip.classList.add('hidden');
  }

  if (state.activeCollectionFilter && activeCollectionChip && activeCollectionName) {
    activeCollectionChip.classList.remove('hidden');
    activeCollectionName.textContent = `Colección: ${state.activeCollectionFilter}`;
  } else if (activeCollectionChip) {
    activeCollectionChip.classList.add('hidden');
  }

  mediaContainer.className = `media-container view-${state.currentViewMode}`;

  if (currentFilteredItems.length === 0) {
    mediaContainer.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; color: var(--text-muted); padding: 50px;">
        No hay elementos que coincidan con los filtros seleccionados.
      </div>`;
    updateFloatingDropzoneUI();
    refreshLucide();
    return;
  }

  mediaContainer.innerHTML = '';
  appendNextCollectionChunk();
  updateFloatingDropzoneUI();
}

// ----------------------------------------------------------------------------
// 3. RENDERIZADO DE COLECCIONES EN BARRA LATERAL
// ----------------------------------------------------------------------------
export function renderSidebarCollections() {
  const collectionsList = document.getElementById('custom-collections-list');
  if (!collectionsList) return;

  if (customCollections.length === 0) {
    collectionsList.innerHTML = '';
    return;
  }

  const fragment = document.createDocumentFragment();

  customCollections.forEach(colName => {
    const count = library.filter(i => Array.isArray(i.collections) && i.collections.includes(colName)).length;
    const isActive = state.activeCollectionFilter === colName;

    const row = document.createElement('div');
    row.className = `custom-collection-row ${isActive ? 'active' : ''}`;
    row.dataset.collection = colName;
    row.title = `Colección: ${colName} (Arrastra obras aquí)`;

    row.innerHTML = `
      <div class="collection-row-left">
        <i data-lucide="folder"></i>
        <span class="collection-row-name">${escapeHtml(colName)}</span>
      </div>
      <div class="collection-row-right">
        <span class="collection-count-pill">${count}</span>
        <button type="button" class="btn-delete-collection" data-collection="${escapeHtml(colName)}" title="Eliminar colección">✕</button>
      </div>
    `;

    fragment.appendChild(row);
  });

  collectionsList.replaceChildren(fragment);
  refreshLucide();
}

// ----------------------------------------------------------------------------
// 4. DELEGACIÓN DE EVENTOS EN COLECCIÓN Y DRAG & DROP
// ----------------------------------------------------------------------------
function initCollectionEventDelegation() {
  const mediaContainer = document.getElementById('media-container');
  if (!mediaContainer || mediaContainer.dataset.delegated === 'true') return;
  mediaContainer.dataset.delegated = 'true';

  mediaContainer.addEventListener('click', (e) => {
    // 1. Quitar de la colección activa (Botón de 1 solo clic)
    const removeColBtn = e.target.closest('.btn-remove-from-collection');
    if (removeColBtn) {
      e.stopPropagation();
      const id = removeColBtn.dataset.id;
      const activeCol = state.activeCollectionFilter;
      if (id && activeCol) {
        const removed = removeItemFromCollection(id, activeCol);
        if (removed) {
          showToast(`Obra retirada de «${activeCol}».`, 'info');
          renderSidebarCollections();
          renderCollection();
        }
      }
      return;
    }

    // 2. Alternar Estado
    const statusBtn = e.target.closest('.btn-status-toggle');
    if (statusBtn) {
      e.stopPropagation();
      const id = statusBtn.dataset.id;
      const targetItem = library.find(i => i.id === id);
      if (!targetItem) return;

      const cycle = { 'todo': 'in_progress', 'in_progress': 'completed', 'completed': 'todo' };
      targetItem.status = cycle[targetItem.status] || 'todo';
      saveLibrary(renderCollection);
      return;
    }

    // 3. Editar Portada
    const coverBtn = e.target.closest('.btn-edit-cover');
    if (coverBtn) {
      e.stopPropagation();
      openCoverModal(coverBtn.dataset.id);
      return;
    }

    // 4. Eliminar
    const deleteBtn = e.target.closest('.btn-delete-item');
    if (deleteBtn) {
      e.stopPropagation();
      openDeleteModal(deleteBtn.dataset.id);
      return;
    }

    // 5. Filtrar por Tag
    const tagBadge = e.target.closest('.tag-badge');
    if (tagBadge && tagBadge.dataset.tag) {
      e.stopPropagation();
      setTagFilter(tagBadge.dataset.tag);
      return;
    }

    // 6. Abrir Detalle
    const cardEl = e.target.closest('.media-card, .media-list-row, .media-poster-card');
    if (cardEl && cardEl.dataset.id) {
      openDetailModal(cardEl.dataset.id);
    }
  });

  // GESTO NATIVO: INICIO DE ARRASTRE
  mediaContainer.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.media-card, .media-list-row, .media-poster-card');
    if (card && card.dataset.id) {
      state.isDragging = true; // Activa el semáforo para retener cualquier render asíncrono
      draggedItemId = card.dataset.id;
      e.dataTransfer.setData('text/plain', card.dataset.id);
      e.dataTransfer.effectAllowed = 'copyMove';
      card.classList.add('is-dragging');

      const dropzone = document.getElementById('floating-remove-dropzone');
      if (dropzone) dropzone.classList.add('drag-active');
    }
  });

  // GESTO NATIVO: FIN DE ARRASTRE (ÉXITO O CANCELACIÓN)
  mediaContainer.addEventListener('dragend', (e) => {
    state.isDragging = false;
    draggedItemId = null;
    const card = e.target.closest('.media-card, .media-list-row, .media-poster-card');
    if (card) {
      card.classList.remove('is-dragging');
    }

    const dropzone = document.getElementById('floating-remove-dropzone');
    if (dropzone) {
      dropzone.classList.remove('drag-active', 'drag-over');
    }

    // Despachar cualquier render que la IA o un servicio haya intentado hacer en segundo plano
    flushDeferredRender();
  });
}

// ----------------------------------------------------------------------------
// 5. DELEGACIÓN DE EVENTOS EN COLECCIONES DE LA BARRA LATERAL (DROPZONE)
// ----------------------------------------------------------------------------
function initSidebarCollectionsDelegation() {
  const collectionsList = document.getElementById('custom-collections-list');
  if (!collectionsList || collectionsList.dataset.delegated === 'true') return;
  collectionsList.dataset.delegated = 'true';

  collectionsList.addEventListener('dragover', (e) => {
    const row = e.target.closest('.custom-collection-row');
    if (row) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      row.classList.add('drag-over');
    }
  });

  collectionsList.addEventListener('dragleave', (e) => {
    const row = e.target.closest('.custom-collection-row');
    if (row && (!e.relatedTarget || !row.contains(e.relatedTarget))) {
      row.classList.remove('drag-over');
    }
  });

  collectionsList.addEventListener('drop', (e) => {
    const row = e.target.closest('.custom-collection-row');
    if (row) {
      e.preventDefault();
      row.classList.remove('drag-over');
      const colName = row.dataset.collection;
      const itemId = draggedItemId || e.dataTransfer.getData('text/plain');

      if (itemId && colName) {
        const added = addItemToCollection(itemId, colName);
        if (added) {
          showToast(`Obra agregada a "${colName}"`);
          renderSidebarCollections();
          if (state.activeCollectionFilter === colName) {
            renderCollection();
          }
        } else {
          showToast(`Esta obra ya pertenece a "${colName}".`, 'info');
        }
      }
      draggedItemId = null;
    }
  });

  collectionsList.addEventListener('click', (e) => {
    const deleteBtn = e.target.closest('.btn-delete-collection');
    if (deleteBtn) {
      e.stopPropagation();
      const colName = deleteBtn.dataset.collection;
      deleteCustomCollection(colName);
      renderSidebarCollections();
      renderCollection();
      showToast(`Colección "${colName}" eliminada.`);
      return;
    }

    const row = e.target.closest('.custom-collection-row');
    if (row) {
      const colName = row.dataset.collection;
      if (state.activeCollectionFilter === colName) {
        state.activeCollectionFilter = null;
      } else {
        state.activeCollectionFilter = colName;
        state.isWishlistFilterActive = false;
        document.getElementById('filter-wishlist')?.classList.remove('active');
      }

      state.currentActiveView = 'library';
      document.querySelectorAll('.tab-btn[data-view]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === 'library');
      });

      renderActiveView();
    }
  });
}

// ----------------------------------------------------------------------------
// 6. CRONOLOGÍA (CALENDARIO Y DIARIO VERTICAL)
// ----------------------------------------------------------------------------
export function renderTimelineSection() {
  const calendarWrapper = document.getElementById('calendar-wrapper');
  const timelineStream = document.getElementById('timeline-stream');

  const btnCal = document.getElementById('btn-timeline-calendar');
  const btnCons = document.getElementById('btn-timeline-consumption');
  const btnRel = document.getElementById('btn-timeline-release');

  btnCal?.classList.toggle('active', state.timelineSubMode === 'calendar');
  btnCons?.classList.toggle('active', state.timelineSubMode === 'consumption');
  btnRel?.classList.toggle('active', state.timelineSubMode === 'release');

  if (state.timelineSubMode === 'calendar') {
    calendarWrapper?.classList.remove('hidden');
    timelineStream?.classList.add('hidden');
    renderCalendar();
  } else {
    calendarWrapper?.classList.add('hidden');
    timelineStream?.classList.remove('hidden');
    renderVerticalTimeline();
  }
  refreshLucide();
}

export function renderCalendar() {
  const calendarMonthTitle = document.getElementById('calendar-month-title');
  const calendarGridDays = document.getElementById('calendar-grid-days');
  if (!calendarMonthTitle || !calendarGridDays) return;

  calendarMonthTitle.textContent = `${MONTH_NAMES[state.calMonth]} ${state.calYear}`;
  
  const fragment = document.createDocumentFragment();

  const firstDayIndex = (new Date(state.calYear, state.calMonth, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(state.calYear, state.calMonth + 1, 0).getDate();
  const prevMonthDays = new Date(state.calYear, state.calMonth, 0).getDate();
  const todayStr = new Date().toISOString().split('T')[0];

  for (let i = firstDayIndex - 1; i >= 0; i--) {
    const cell = document.createElement('div');
    cell.className = 'calendar-day-cell other-month';
    cell.innerHTML = `<span class="cal-day-num">${prevMonthDays - i}</span>`;
    fragment.appendChild(cell);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dayPadded = String(day).padStart(2, '0');
    const monthPadded = String(state.calMonth + 1).padStart(2, '0');
    const dateStr = `${state.calYear}-${monthPadded}-${dayPadded}`;

    const dayItems = library.filter(item => {
      const rawItemDate = item.dateFinished || item.dateStarted || item.createdAt || '';
      const cleanItemDate = rawItemDate.split('T')[0].trim();
      const matchesDate = (cleanItemDate === dateStr);
      const matchesType = state.calTypeFilter === 'all' || item.type === state.calTypeFilter;
      return matchesDate && matchesType;
    });

    const isToday = (dateStr === todayStr);

    const cell = document.createElement('div');
    cell.className = `calendar-day-cell ${isToday ? 'today' : ''}`;
    cell.dataset.date = dateStr;

    let itemsHtml = '';
    dayItems.slice(0, 2).forEach(it => {
      const hasCover = isValidCover(it.coverUrl);
      const safeTitle = escapeHtml(it.title || 'Sin título');
      const thumbHtml = hasCover
        ? `<img src="${escapeHtml(it.coverUrl)}" alt="${safeTitle}" class="cal-mini-thumb" loading="lazy" decoding="async" onerror="this.style.display='none';" />`
        : ``;

      const creator = escapeHtml(it.details?.author || item.details?.director || it.details?.artist || it.creator || '');
      const statusIcon = getStatusIconName(it.type, it.status);

      const ratingHtml = it.userRating 
        ? `<span style="margin-left:auto; font-size:0.65rem; color:var(--star-gold); font-weight:700; flex-shrink:0;">★ ${Number(it.userRating).toFixed(it.userRating % 1 === 0 ? 0 : (it.userRating % 0.5 === 0 ? 1 : 2))}</span>` 
        : '';

      itemsHtml += `
        <div class="cal-item-card" title="${safeTitle} - ${creator}">
          ${thumbHtml}
          <div class="cal-mini-info" style="flex:1; min-width:0;">
            <span class="cal-mini-title"><i data-lucide="${statusIcon}"></i> ${safeTitle}</span>
            <span class="cal-mini-creator">${creator}</span>
          </div>
          ${ratingHtml}
        </div>
      `;
    });

    if (dayItems.length > 2) itemsHtml += `<span class="cal-more-badge">+${dayItems.length - 2} más</span>`;

    cell.innerHTML = `<span class="cal-day-num">${day}</span><div class="cal-day-items">${itemsHtml}</div>`;
    fragment.appendChild(cell);
  }

  const totalCells = firstDayIndex + daysInMonth;
  const remainingCells = (7 - (totalCells % 7)) % 7;
  for (let j = 1; j <= remainingCells; j++) {
    const cell = document.createElement('div');
    cell.className = 'calendar-day-cell other-month';
    cell.innerHTML = `<span class="cal-day-num">${j}</span>`;
    fragment.appendChild(cell);
  }

  calendarGridDays.replaceChildren(fragment);
  refreshLucide();
}

function renderVerticalTimeline() {
  const timelineStream = document.getElementById('timeline-stream');
  if (!timelineStream) return;
  timelineStream.innerHTML = '';

  if (library.length === 0) {
    timelineStream.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding: 40px;">Tu línea de tiempo está vacía.</div>`;
    return;
  }

  let groups = {};
  if (state.timelineSubMode === 'consumption') {
    const sorted = [...library].sort((a, b) => {
      const dateA = a.dateFinished || a.dateStarted || a.createdAt || '2000-01-01';
      const dateB = b.dateFinished || b.dateStarted || b.createdAt || '2000-01-01';
      return dateB.localeCompare(dateA);
    });

    sorted.forEach(item => {
      const rawDate = item.dateFinished || item.dateStarted;
      let groupKey = 'Sin fecha registrada';
      let formattedPill = 'Fecha no fijada';

      if (rawDate) {
        const cleanDate = rawDate.split('T')[0].trim();
        const parts = cleanDate.split('-');
        if (parts.length === 3) {
          const [y, m, d] = parts;
          const monthName = MONTH_NAMES[parseInt(m, 10) - 1] || '';
          groupKey = `${monthName} ${y}`.trim();
          formattedPill = `${parseInt(d, 10)} de ${monthName}, ${y}`;
        }
      }
      if (!groups[groupKey]) groups[groupKey] = [];
      groups[groupKey].push({ item, pill: formattedPill });
    });
  } else {
    const sorted = [...library].sort((a, b) => (b.releaseYear || 0) - (a.releaseYear || 0));
    sorted.forEach(item => {
      const yearKey = item.releaseYear ? `Año ${item.releaseYear}` : 'Año Desconocido';
      if (!groups[yearKey]) groups[yearKey] = [];
      groups[yearKey].push({ item, pill: `Estreno: ${item.releaseYear || 'N/A'}` });
    });
  }

  const fragment = document.createDocumentFragment();

  for (const [groupTitle, entries] of Object.entries(groups)) {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'timeline-group';
    groupDiv.innerHTML = `
      <div class="timeline-group-header"><span class="timeline-node-dot"></span><span>${escapeHtml(groupTitle)}</span></div>
      <div class="timeline-items-list"></div>
    `;
    const listDiv = groupDiv.querySelector('.timeline-items-list');

    entries.forEach(({ item, pill }) => {
      const card = document.createElement('div');
      card.className = 'timeline-card';
      card.dataset.id = item.id;

      const hasCover = isValidCover(item.coverUrl);
      const typeIcon = item.type === 'book' ? 'book' : (item.type === 'movie' ? 'film' : 'disc');

      const safeTitle = escapeHtml(item.title || 'Sin título');
      const thumbHtml = hasCover
        ? `<img src="${escapeHtml(item.coverUrl)}" alt="${safeTitle}" class="timeline-card-thumb" loading="lazy" decoding="async" onerror="this.style.display='none';" />`
        : `<div class="timeline-thumb-placeholder"><i data-lucide="${typeIcon}"></i></div>`;

      const creator = escapeHtml(item.details?.author || item.details?.director || item.details?.artist || item.creator || 'Creador');
      const starsPill = formatRatingPill(item.userRating);
      const statusIcon = getStatusIconName(item.type, item.status);
      const tagsHtml = (item.tags || []).map(t => `<span class="tag-badge">${escapeHtml(t)}</span>`).join(' ');
      const safeCountry = escapeHtml(item.country || 'N/A');

      card.innerHTML = `
        ${thumbHtml}
        <div class="timeline-card-content">
          <div class="timeline-card-top">
            <div class="timeline-card-title"><i data-lucide="${statusIcon}"></i> ${safeTitle}</div>
            <span class="timeline-date-pill">${escapeHtml(pill)}</span>
          </div>
          <div class="timeline-card-creator">${creator} • 📍 ${safeCountry} ${starsPill ? `• <span style="color:var(--star-gold); font-weight:700;">${escapeHtml(starsPill)}</span>` : ''}</div>
          ${tagsHtml ? `<div class="card-tags" style="margin-top:4px; padding-top:0;">${tagsHtml}</div>` : ''}
          ${item.userNotes ? `<div class="timeline-card-notes">“${escapeHtml(item.userNotes)}”</div>` : ''}
        </div>
      `;

      listDiv.appendChild(card);
    });

    fragment.appendChild(groupDiv);
  }

  timelineStream.replaceChildren(fragment);
  refreshLucide();
}

// ----------------------------------------------------------------------------
// 7. GRAFO DE CONEXIONES CULTURALES (CONSTELACIÓN TRANSPARENTE)
// ----------------------------------------------------------------------------
function getNodeColor(node) {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  if (node.group === 'book') return '#3b82f6';
  if (node.group === 'movie') return '#ef4444';
  if (node.group === 'music') return '#a855f7';
  if (node.group === 'country') return '#10b981';
  if (node.group === 'tag') return '#f59e0b';
  return isLight ? '#475569' : '#e2e8f0';
}

export function initOrUpdateGraph() {
  const graphCanvas = document.getElementById('cultural-graph-canvas');
  const graphStatsText = document.getElementById('graph-stats-text');
  if (!graphCanvas) return;

  const activeGraphType = state.graphTypeFilter || 'all';

  const filteredItems = library.filter(item => {
    if (activeGraphType === 'all') return true;
    return item.type === activeGraphType;
  });

  if (filteredItems.length === 0) {
    if (graphInstance) {
      if (typeof graphInstance.pauseAnimation === 'function') {
        graphInstance.pauseAnimation();
      }
      graphInstance = null;
    }
    graphCanvas.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding:50px;">No hay obras disponibles para esta vista del grafo.</div>`;
    if (graphStatsText) graphStatsText.textContent = `0 nodos conectados`;
    return;
  }

  const nodes = [];
  const links = [];
  const nodeSet = new Set();

  const addNode = (id, name, group, val = 4) => {
    if (!nodeSet.has(id)) {
      nodeSet.add(id);
      nodes.push({ id, name, group, val });
    }
  };

  filteredItems.forEach(item => {
    const workId = `work-${item.id}`;
    addNode(workId, item.title, item.type, 5);

    if (item.country) {
      const countryId = `country-${item.country}`;
      addNode(countryId, item.country, 'country', 4);
      links.push({ source: workId, target: countryId });
    }

    (item.tags || []).forEach(tag => {
      const tagId = `tag-${tag}`;
      addNode(tagId, tag, 'tag', 3);
      links.push({ source: workId, target: tagId });
    });
  });

  if (graphStatsText) graphStatsText.textContent = `${nodes.length} nodos conectados`;

  document.querySelectorAll('.graph-filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.graphtype === activeGraphType);
  });

  if (!graphInstance) {
    graphCanvas.innerHTML = '';
    graphInstance = ForceGraph()(graphCanvas)
      .graphData({ nodes, links })
      .nodeId('id')
      .nodeVal('val')
      .d3AlphaDecay(0.03)
      .d3VelocityDecay(0.6)
      .cooldownTicks(80)
      .backgroundColor('rgba(0, 0, 0, 0)')
      .linkColor(() => {
        const isLight = document.documentElement.getAttribute('data-theme') === 'light';
        return isLight ? 'rgba(15, 23, 42, 0.45)' : 'rgba(255, 255, 255, 0.40)';
      })
      .linkWidth(1.4)
      .onNodeClick(node => {
        if (node.id.startsWith('work-')) {
          openDetailModal(node.id.replace('work-', ''));
        }
      })
      .nodeCanvasObject((node, ctx, globalScale) => {
        const isLight = document.documentElement.getAttribute('data-theme') === 'light';
        const label = node.name || '';
        const radius = node.val || 4;

        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
        ctx.fillStyle = getNodeColor(node);
        ctx.fill();

        ctx.strokeStyle = isLight ? 'rgba(0, 0, 0, 0.30)' : 'rgba(255, 255, 255, 0.60)';
        ctx.lineWidth = 1.2 / globalScale;
        ctx.stroke();

        if (globalScale > 0.85) {
          const fontSize = Math.max(10 / globalScale, 2.5);
          ctx.font = `600 ${fontSize}px 'Inter', system-ui, -apple-system, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';

          const textY = node.y + radius + (2.5 / globalScale);

          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';
          ctx.strokeStyle = isLight ? 'rgba(255, 255, 255, 0.95)' : 'rgba(0, 0, 0, 0.95)';
          ctx.lineWidth = 1.2 / globalScale;
          ctx.strokeText(label, node.x, textY);

          ctx.fillStyle = isLight ? '#0f172a' : '#ffffff';
          ctx.fillText(label, node.x, textY);
        }
      })
      .nodeCanvasObjectMode(() => 'replace')
      .nodePointerAreaPaint((node, color, ctx) => {
        const radius = (node.val || 4) + 3;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
        ctx.fill();
      });

    graphInstance.d3Force('charge').strength(-180);
    graphInstance.d3Force('link').distance(45);
  } else {
    graphInstance
      .graphData({ nodes, links })
      .backgroundColor('rgba(0, 0, 0, 0)');
    
    setTimeout(() => {
      if (graphCanvas && graphInstance) {
        graphInstance.width(graphCanvas.clientWidth);
        graphInstance.height(graphCanvas.clientHeight);
      }
    }, 150);
  }
}

// ----------------------------------------------------------------------------
// 8. INICIALIZACIÓN DE EVENTOS DE VISTAS
// ----------------------------------------------------------------------------
export function initViewsEvents() {
  if (viewsEventsInitialized) return;
  viewsEventsInitialized = true;

  initCollectionEventDelegation();
  initSidebarCollectionsDelegation();

  // Red de seguridad a nivel de ventana: limpia el arrastre si se cancela fuera o con ESC
  window.addEventListener('dragend', () => {
    if (state.isDragging) {
      state.isDragging = false;
      draggedItemId = null;
      document.querySelectorAll('.is-dragging').forEach(el => el.classList.remove('is-dragging'));
      const dropzone = document.getElementById('floating-remove-dropzone');
      if (dropzone) {
        dropzone.classList.remove('drag-active', 'drag-over');
      }
      flushDeferredRender();
    }
  });

  document.getElementById('btn-clear-collection-filter')?.addEventListener('click', () => {
    state.activeCollectionFilter = null;
    renderSidebarCollections();
    renderCollection();
  });

  document.getElementById('btn-clear-tag-filter')?.addEventListener('click', () => {
    state.activeTagFilter = null;
    renderCollection();
  });

  const calendarGridDays = document.getElementById('calendar-grid-days');
  calendarGridDays?.addEventListener('click', (e) => {
    const cell = e.target.closest('.calendar-day-cell:not(.other-month)');
    if (cell && cell.dataset.date) {
      const dateStr = cell.dataset.date;
      const dayItems = library.filter(item => {
        const rawItemDate = item.dateFinished || item.dateStarted || item.createdAt || '';
        const cleanItemDate = rawItemDate.split('T')[0].trim();
        return cleanItemDate === dateStr && (state.calTypeFilter === 'all' || item.type === state.calTypeFilter);
      });
      if (dayItems.length > 0) {
        openDayInspectorModal(dateStr, dayItems);
      }
    }
  });

  const timelineStream = document.getElementById('timeline-stream');
  timelineStream?.addEventListener('click', (e) => {
    const card = e.target.closest('.timeline-card');
    if (card && card.dataset.id) {
      openDetailModal(card.dataset.id);
    }
  });

  document.getElementById('btn-timeline-calendar')?.addEventListener('click', () => {
    state.timelineSubMode = 'calendar';
    renderTimelineSection();
  });

  document.getElementById('btn-timeline-consumption')?.addEventListener('click', () => {
    state.timelineSubMode = 'consumption';
    renderTimelineSection();
  });

  document.getElementById('btn-timeline-release')?.addEventListener('click', () => {
    state.timelineSubMode = 'release';
    renderTimelineSection();
  });

  document.getElementById('btn-cal-prev')?.addEventListener('click', () => {
    state.calMonth--;
    if (state.calMonth < 0) {
      state.calMonth = 11;
      state.calYear--;
    }
    renderCalendar();
  });

  document.getElementById('btn-cal-next')?.addEventListener('click', () => {
    state.calMonth++;
    if (state.calMonth > 11) {
      state.calMonth = 0;
      state.calYear++;
    }
    renderCalendar();
  });

  document.getElementById('btn-cal-today')?.addEventListener('click', () => {
    const now = new Date();
    state.calYear = now.getFullYear();
    state.calMonth = now.getMonth();
    renderCalendar();
  });

  document.querySelectorAll('.cal-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cal-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.calTypeFilter = btn.dataset.caltype;
      renderCalendar();
    });
  });

  document.querySelectorAll('.graph-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.graph-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.graphTypeFilter = btn.dataset.graphtype;
      initOrUpdateGraph();
    });
  });
}

// ----------------------------------------------------------------------------
// 9. ESTADÍSTICAS CULTURALES (ESCALA RELATIVA)
// ----------------------------------------------------------------------------
export function renderStatsDashboard() {
  const totalItems = library.length || 1;
  const booksCount = library.filter(i => i.type === 'book').length;
  const moviesCount = library.filter(i => i.type === 'movie').length;
  const musicCount = library.filter(i => i.type === 'music').length;
  const countriesSet = new Set(library.map(i => i.country).filter(Boolean));

  const countBooksEl = document.getElementById('stat-count-books');
  const countMoviesEl = document.getElementById('stat-count-movies');
  const countMusicEl = document.getElementById('stat-count-music');
  const countCountriesEl = document.getElementById('stat-count-countries');

  if (countBooksEl) countBooksEl.textContent = String(booksCount);
  if (countMoviesEl) countMoviesEl.textContent = String(moviesCount);
  if (countMusicEl) countMusicEl.textContent = String(musicCount);
  if (countCountriesEl) countCountriesEl.textContent = String(countriesSet.size);

  const countryCounts = {};
  library.forEach(i => {
    if (i.country) countryCounts[i.country] = (countryCounts[i.country] || 0) + 1;
  });
  const sortedCountries = Object.entries(countryCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxCountryCount = sortedCountries[0]?.[1] || 1;

  const topCountriesList = document.getElementById('stats-top-countries');
  if (topCountriesList) {
    if (sortedCountries.length === 0) {
      topCountriesList.innerHTML = '<div style="color:var(--text-muted); font-size:0.8rem;">Sin datos suficientes.</div>';
    } else {
      const fragment = document.createDocumentFragment();
      sortedCountries.forEach(([country, count]) => {
        const flag = COUNTRY_FLAGS[country] || '📍';
        const globalPercent = Math.round((count / totalItems) * 100);
        const visualBarWidth = Math.round((count / maxCountryCount) * 100);
        const row = document.createElement('div');
        row.className = 'stat-rank-row';
        const safeCountry = escapeHtml(country);

        row.innerHTML = `
          <span class="stat-rank-label" title="${safeCountry}">${flag} ${safeCountry}</span>
          <div class="stat-rank-bar-track">
            <div class="stat-rank-bar" style="width: ${visualBarWidth}%;"></div>
          </div>
          <span class="stat-rank-val">${count} (${globalPercent}%)</span>
        `;
        fragment.appendChild(row);
      });
      topCountriesList.replaceChildren(fragment);
    }
  }

  const tagCounts = {};
  library.forEach(i => {
    (i.tags || []).forEach(t => {
      tagCounts[t] = (tagCounts[t] || 0) + 1;
    });
  });
  const sortedTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxTagCount = sortedTags[0]?.[1] || 1;

  const topTagsList = document.getElementById('stats-top-tags');
  if (topTagsList) {
    if (sortedTags.length === 0) {
      topTagsList.innerHTML = '<div style="color:var(--text-muted); font-size:0.8rem;">Sin datos suficientes.</div>';
    } else {
      const fragment = document.createDocumentFragment();
      sortedTags.forEach(([tag, count]) => {
        const globalPercent = Math.round((count / totalItems) * 100);
        const visualBarWidth = Math.round((count / maxTagCount) * 100);
        const row = document.createElement('div');
        row.className = 'stat-rank-row';
        const safeTag = escapeHtml(tag);

        row.innerHTML = `
          <span class="stat-rank-label" title="${safeTag}">🏷️ ${safeTag}</span>
          <div class="stat-rank-bar-track">
            <div class="stat-rank-bar" style="width: ${visualBarWidth}%; background:var(--wishlist-gold);"></div>
          </div>
          <span class="stat-rank-val">${count} (${globalPercent}%)</span>
        `;
        fragment.appendChild(row);
      });
      topTagsList.replaceChildren(fragment);
    }
  }

  refreshLucide();
}