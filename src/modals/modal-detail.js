// ============================================================================
// SRC/MODALS/MODAL-DETAIL.JS - Ficha Técnica Editorial y Multimedia
// - Auto-Guardado Continuo y Silencioso (Estilo Obsidian/Notion con 0% Lag)
// - Sistema de Calificación Fraccionaria (0.25 con hover en vivo y reseteo delegado)
// - Ficha Técnica Extendida con Dualidad Temporal (Año Original vs Año de Edición)
// - Citación Académica, Archivos Locales (Tauri IPC) y Hub de Streaming
// ============================================================================

import { 
  state,
  library, 
  saveLibrary, 
  getStatusIconName, 
  refreshLucide, 
  showToast, 
  canonicalizeCountry 
} from '../state.js';
import { renderActiveView } from '../views.js';
import { normalizeLanguage } from '../api.js';
import { escapeHtml, openExternalResource } from './utils.js';

let currentDetailItem = null;
let currentDetailTags = [];
let currentRating = 0;
let currentDetailIsWishlist = false;
let currentDetailStatus = 'todo';
let autoSaveTimer = null;

/**
 * Obtiene la obra actualmente cargada en el modal de detalle (usado por el Crítico Cultural).
 * @returns {object|null}
 */
export function getCurrentDetailItem() {
  return currentDetailItem;
}

/**
 * Aplica un filtro de etiqueta en la vista principal y cambia a la perspectiva de colección.
 * @param {string} tag - Nombre de la etiqueta o país.
 */
export function setTagFilter(tag) {
  if (!tag || tag === 'N/A' || tag === '-') return;
  state.activeTagFilter = tag;
  state.currentActiveView = 'library';
  renderActiveView();
}

/**
 * Guarda y sincroniza en caliente todos los campos del modal en la base de datos.
 * @param {boolean} silent - Si es true, no muestra notificación flotante.
 */
function commitDetailChanges(silent = true) {
  if (!currentDetailItem) return;

  const newTitle = document.getElementById('detail-edit-title')?.value.trim();
  const newCreator = document.getElementById('detail-edit-creator')?.value.trim();
  if (newTitle) currentDetailItem.title = newTitle;

  if (!currentDetailItem.details) currentDetailItem.details = {};

  if (currentDetailItem.type === 'book') {
    currentDetailItem.details.author = newCreator;
    currentDetailItem.creator = newCreator; // Sincronización garantizada con vistas y exportadores
    
    const editPublisher = document.getElementById('book-edit-publisher')?.value.trim();
    const editEdition = document.getElementById('book-edit-edition')?.value.trim();
    const editEditionYear = parseInt(document.getElementById('book-edit-edition-year')?.value, 10);
    const editTranslator = document.getElementById('book-edit-translator')?.value.trim();
    const editPages = parseInt(document.getElementById('book-edit-pages')?.value, 10);
    const editIsbn = document.getElementById('book-edit-isbn')?.value.trim();
    const editLang = document.getElementById('book-edit-language')?.value.trim();
    const editSynopsis = document.getElementById('book-edit-synopsis')?.value.trim();

    currentDetailItem.details.publisher = editPublisher || currentDetailItem.details.publisher || '';
    currentDetailItem.publisher = currentDetailItem.details.publisher;
    currentDetailItem.details.editionNumber = editEdition || '';
    currentDetailItem.details.editionYear = !isNaN(editEditionYear) ? editEditionYear : null;
    currentDetailItem.details.translator = editTranslator || '';
    currentDetailItem.details.pageCount = !isNaN(editPages) ? editPages : null;
    currentDetailItem.details.isbn = editIsbn || '--';
    currentDetailItem.details.language = normalizeLanguage(editLang || 'Español');
    
    if (editSynopsis !== undefined) {
      currentDetailItem.synopsis = editSynopsis;
      currentDetailItem.details.synopsis = editSynopsis;
    }
  } else if (currentDetailItem.type === 'movie') {
    const editDirector = document.getElementById('movie-edit-director')?.value.trim();
    const editStudio = document.getElementById('movie-edit-studio')?.value.trim();
    const editRuntime = parseInt(document.getElementById('movie-edit-runtime')?.value, 10);
    const editVote = document.getElementById('movie-edit-vote')?.value.trim();
    const editCast = document.getElementById('movie-edit-cast')?.value.trim();
    const editSynopsis = document.getElementById('movie-edit-synopsis')?.value.trim();

    currentDetailItem.details.director = editDirector || newCreator;
    currentDetailItem.creator = currentDetailItem.details.director;
    currentDetailItem.details.studio = editStudio || '';
    currentDetailItem.details.runtime = !isNaN(editRuntime) ? editRuntime : null;
    currentDetailItem.details.voteAverage = editVote || '';
    currentDetailItem.details.cast = editCast ? editCast.split(',').map(a => a.trim()).filter(Boolean) : [];

    if (editSynopsis !== undefined) {
      currentDetailItem.synopsis = editSynopsis;
      currentDetailItem.details.synopsis = editSynopsis;
    }
  } else if (currentDetailItem.type === 'music') {
    currentDetailItem.details.artist = newCreator;
    currentDetailItem.creator = newCreator;
  }

  const detailCustomLinkInput = document.getElementById('detail-custom-link');
  if (detailCustomLinkInput) {
    const cleanCustomLink = detailCustomLinkInput.value.trim().replace(/^["']|["']$/g, '');
    currentDetailItem.customLink = cleanCustomLink;
    currentDetailItem.details.customLink = cleanCustomLink;
  }

  const countryVal = document.getElementById('detail-edit-country')?.value.trim();
  if (countryVal) {
    currentDetailItem.country = canonicalizeCountry(countryVal);
  }
  
  const yearVal = parseInt(document.getElementById('detail-edit-year')?.value, 10);
  if (!isNaN(yearVal)) {
    currentDetailItem.releaseYear = yearVal;
  }

  currentDetailItem.tags = [...currentDetailTags];
  currentDetailItem.isWishlist = currentDetailIsWishlist;
  currentDetailItem.userRating = currentRating;
  currentDetailItem.status = currentDetailStatus;
  currentDetailItem.dateStarted = document.getElementById('detail-date-started')?.value || '';
  currentDetailItem.dateFinished = document.getElementById('detail-date-finished')?.value || '';
  currentDetailItem.userNotes = document.getElementById('detail-notes')?.value || '';

  // Persistencia reactiva en IndexedDB + localStorage
  saveLibrary(() => {
    renderActiveView();
  });

  if (!silent) {
    showToast('Cambios guardados correctamente.');
  }
}

/**
 * Programa un guardado automático con debounce para WebView2.
 */
function scheduleAutoSave() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    commitDetailChanges(true);
  }, 350);
}

/**
 * Actualiza visualmente el indicador de estado en la cabecera de la ficha técnica.
 * @param {string} status - 'todo' | 'in_progress' | 'completed'
 * @param {string} type - 'book' | 'movie' | 'music'
 */
export function updateDetailStatusUI(status, type) {
  const indicator = document.getElementById('detail-status-indicator');
  if (!indicator) return;
  const statusIcon = getStatusIconName(type, status);
  const statusLabels = { todo: 'Por empezar', in_progress: 'En progreso', completed: 'Terminado' };
  
  indicator.style.cursor = 'pointer';
  indicator.title = 'Haz clic para alternar el estado (Por empezar ➔ En progreso ➔ Terminado)';
  indicator.innerHTML = `<i data-lucide="${statusIcon}"></i> Estado: ${statusLabels[status] || status}`;
  refreshLucide();
}

/**
 * Actualiza el botón de lista de deseos en la interfaz.
 * @param {boolean} isWishlist 
 */
function updateWishlistButtonUI(isWishlist) {
  currentDetailIsWishlist = isWishlist;
  const toggle = document.getElementById('detail-wishlist-toggle');
  const text = document.getElementById('detail-wishlist-text');
  if (!toggle || !text) return;

  if (isWishlist) {
    toggle.classList.add('active');
    text.textContent = 'En Lista de Deseos (Activo)';
  } else {
    toggle.classList.remove('active');
    text.textContent = 'Agregar a Lista de Deseos';
  }
  refreshLucide();
}

// ============================================================================
// SISTEMA DE CALIFICACIÓN PRECISA (INCREMENTOS DE 0.25)
// ============================================================================

/**
 * Renderiza la UI de las estrellas fraccionarias y el badge numérico.
 * @param {number} rating 
 */
function renderStarRatingUI(rating) {
  const stars = document.querySelectorAll('#detail-stars span');
  stars.forEach((star, idx) => {
    const starVal = idx + 1;
    if (rating >= starVal) {
      star.style.setProperty('--fill', '100%');
      star.classList.add('active');
    } else if (rating > idx) {
      const fractionalPart = rating - idx;
      star.style.setProperty('--fill', `${fractionalPart * 100}%`);
      star.classList.add('active');
    } else {
      star.style.setProperty('--fill', '0%');
      star.classList.remove('active');
    }
  });

  let badge = document.getElementById('detail-rating-val');
  if (!badge) {
    const container = document.querySelector('.rating-container');
    if (container) {
      badge = document.createElement('div');
      badge.id = 'detail-rating-val';
      badge.className = 'rating-numeric-badge';
      badge.title = 'Haz clic para restablecer la calificación a 0';
      container.appendChild(badge);
    }
  }

  if (badge) {
    if (rating > 0) {
      const formatted = rating % 1 === 0 
        ? rating.toFixed(0) 
        : (rating % 0.5 === 0 ? rating.toFixed(1) : rating.toFixed(2));
      badge.innerHTML = `⭐ <strong>${formatted}</strong> <small>/ 5.0</small>`;
      badge.classList.add('has-rating');
    } else {
      badge.innerHTML = `☆ <small>Sin calificar</small>`;
      badge.classList.remove('has-rating');
    }
  }
}

/**
 * Fija la calificación activa y sincroniza la UI.
 * @param {number|string} rating 
 */
function setStarRating(rating) {
  currentRating = parseFloat(rating) || 0;
  renderStarRatingUI(currentRating);
}

/**
 * Renderiza el listado de etiquetas interactivas de la obra.
 */
function renderDetailTags() {
  const wrap = document.getElementById('detail-tags-wrap');
  if (!wrap) return;
  const fragment = document.createDocumentFragment();

  currentDetailTags.forEach((tag, index) => {
    const pill = document.createElement('span');
    pill.className = 'interactive-tag';
    pill.innerHTML = `
      <span style="cursor:pointer;" class="detail-tag-click" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</span>
      <span class="tag-delete-x" data-index="${index}" title="Quitar etiqueta">✕</span>
    `;
    fragment.appendChild(pill);
  });

  wrap.replaceChildren(fragment);
}

/**
 * Alterna entre la pestaña General y Contenido Extendido.
 * @param {'general'|'extended'} tab 
 */
function activateDetailSubTab(tab) {
  const btnGeneral = document.getElementById('btn-dtab-general');
  const btnExtended = document.getElementById('btn-dtab-extended');
  const paneGeneral = document.getElementById('pane-detail-general');
  const paneExtended = document.getElementById('pane-detail-extended');

  if (tab === 'general') {
    btnGeneral?.classList.add('active');
    btnExtended?.classList.remove('active');
    paneGeneral?.classList.add('active');
    paneExtended?.classList.remove('active');
  } else {
    btnExtended?.classList.add('active');
    btnGeneral?.classList.remove('active');
    paneExtended?.classList.add('active');
    paneGeneral?.classList.remove('active');
  }
  refreshLucide();
}

/**
 * Renderiza la lista de canciones en obras de música.
 * @param {Array<object>} tracks 
 */
function renderTracklist(tracks) {
  const container = document.getElementById('detail-tracklist-container');
  const countBadge = document.getElementById('music-track-count');
  if (!container) return;

  if (countBadge) countBadge.textContent = `${tracks.length} pista(s)`;

  if (!tracks || tracks.length === 0) {
    container.innerHTML = `<p class="empty-hint">No hay lista de canciones registrada para este álbum.</p>`;
    return;
  }

  const fragment = document.createDocumentFragment();
  tracks.forEach(t => {
    const row = document.createElement('div');
    row.className = 'track-row';
    row.innerHTML = `
      <div class="track-left">
        <span class="track-num">${escapeHtml(t.position || '#')}</span>
        <span class="track-title">${escapeHtml(t.title)}</span>
      </div>
      <span class="track-duration">${escapeHtml(t.duration || '--:--')}</span>
    `;
    fragment.appendChild(row);
  });
  container.replaceChildren(fragment);
}

/**
 * Carga campos extendidos de películas.
 * @param {object} item 
 */
function renderMovieExtended(item) {
  const runtimeBadge = document.getElementById('movie-runtime-badge');
  const directorInput = document.getElementById('movie-edit-director');
  const studioInput = document.getElementById('movie-edit-studio');
  const runtimeInput = document.getElementById('movie-edit-runtime');
  const voteInput = document.getElementById('movie-edit-vote');
  const castInput = document.getElementById('movie-edit-cast');
  const synopsisTextarea = document.getElementById('movie-edit-synopsis');

  const runtimeVal = item.details?.runtime || null;
  if (runtimeBadge) runtimeBadge.textContent = runtimeVal ? `${runtimeVal} min` : 'Duración N/A';

  if (directorInput) directorInput.value = item.details?.director || item.creator || '';
  if (studioInput) studioInput.value = item.details?.studio || '';
  if (runtimeInput) runtimeInput.value = runtimeVal || '';
  if (voteInput) voteInput.value = item.details?.voteAverage || '';
  if (castInput) castInput.value = (item.details?.cast || []).join(', ');
  if (synopsisTextarea) synopsisTextarea.value = item.synopsis || item.details?.synopsis || '';
}

/**
 * Carga campos extendidos de libros con año específico de edición e idioma normalizado.
 * @param {object} item 
 */
function renderBookExtended(item) {
  const pagesBadge = document.getElementById('book-pages-badge');
  const publisherInput = document.getElementById('book-edit-publisher');
  const editionInput = document.getElementById('book-edit-edition');
  const editionYearInput = document.getElementById('book-edit-edition-year');
  const translatorInput = document.getElementById('book-edit-translator');
  const pagesInput = document.getElementById('book-edit-pages');
  const isbnInput = document.getElementById('book-edit-isbn');
  const langInput = document.getElementById('book-edit-language');
  const synopsisTextarea = document.getElementById('book-edit-synopsis');

  const pageCount = item.details?.pageCount || null;
  if (pagesBadge) pagesBadge.textContent = pageCount ? `${pageCount} págs` : 'Páginas N/A';

  if (publisherInput) publisherInput.value = item.details?.publisher || item.publisher || '';
  if (editionInput) editionInput.value = item.details?.editionNumber || item.details?.edition || '';
  if (editionYearInput) editionYearInput.value = item.details?.editionYear || '';
  if (translatorInput) translatorInput.value = item.details?.translator || '';
  if (pagesInput) pagesInput.value = pageCount || '';
  if (isbnInput) isbnInput.value = (item.details?.isbn && item.details.isbn !== '--') ? item.details.isbn : '';
  if (langInput) langInput.value = normalizeLanguage(item.details?.language || 'Español');
  if (synopsisTextarea) synopsisTextarea.value = item.synopsis || item.details?.synopsis || '';
}

/**
 * Abre el modal de ficha técnica cargando los datos de la obra correspondiente.
 * @param {string} id - Identificador UUID de la obra.
 */
export function openDetailModal(id) {
  const item = library.find(i => i.id === id);
  if (!item) return;
  currentDetailItem = item;

  const detailModal = document.getElementById('detail-modal');
  const detailModalBox = document.getElementById('detail-modal-box');
  const detailAmbientGlowImg = document.getElementById('detail-ambient-glow-img');
  const coverImgEl = document.getElementById('detail-cover');

  if (detailModalBox) {
    detailModalBox.classList.toggle('type-music', item.type === 'music');
  }

  currentDetailTags = [...(item.tags || [])];
  currentDetailStatus = item.status || 'todo';

  const coverSrc = item.coverUrl || '';
  if (coverImgEl) {
    coverImgEl.src = coverSrc;
    coverImgEl.style.display = coverSrc ? 'block' : 'none';
  }
  if (detailAmbientGlowImg) {
    detailAmbientGlowImg.src = coverSrc;
    detailAmbientGlowImg.style.display = coverSrc ? 'block' : 'none';
  }

  const titleInput = document.getElementById('detail-edit-title');
  const creatorInput = document.getElementById('detail-edit-creator');
  const countryInput = document.getElementById('detail-edit-country');
  const yearInput = document.getElementById('detail-edit-year');
  const typeBadge = document.getElementById('detail-type-badge');

  if (titleInput) titleInput.value = item.title || '';
  const creatorStr = item.details?.author || item.details?.director || item.details?.artist || item.creator || '';
  if (creatorInput) creatorInput.value = creatorStr;
  if (countryInput) countryInput.value = item.country || '';
  if (yearInput) yearInput.value = item.releaseYear || '';

  const typeLabels = { book: 'Libro', movie: 'Película', music: 'Música' };
  if (typeBadge) typeBadge.textContent = typeLabels[item.type] || item.type;

  updateDetailStatusUI(currentDetailStatus, item.type);
  updateWishlistButtonUI(item.isWishlist || false);
  setStarRating(item.userRating || 0);

  const streamingHubBtnLabel = document.getElementById('streaming-hub-btn-label');
  if (streamingHubBtnLabel) {
    if (item.type === 'music') streamingHubBtnLabel.textContent = 'Escuchar en Spotify / YouTube';
    else if (item.type === 'movie') streamingHubBtnLabel.textContent = 'Dónde Ver & Trailers';
    else streamingHubBtnLabel.textContent = 'Goodreads & Enlaces';
  }

  const detailCustomLinkInput = document.getElementById('detail-custom-link');
  if (detailCustomLinkInput) {
    detailCustomLinkInput.value = item.customLink || item.details?.customLink || '';
  }

  const startInput = document.getElementById('detail-date-started');
  const finishInput = document.getElementById('detail-date-finished');
  const notesInput = document.getElementById('detail-notes');

  if (startInput) startInput.value = item.dateStarted || '';
  if (finishInput) finishInput.value = item.dateFinished || '';
  if (notesInput) notesInput.value = item.userNotes || '';

  const criticResultContainer = document.getElementById('critic-result-container');
  if (criticResultContainer) {
    criticResultContainer.innerHTML = '';
  }

  renderDetailTags();
  activateDetailSubTab('general');

  const extendedContentMusic = document.getElementById('extended-content-music');
  const extendedContentMovie = document.getElementById('extended-content-movie');
  const extendedContentBook = document.getElementById('extended-content-book');
  const detailExtendedTabLabel = document.getElementById('detail-extended-tab-label');

  extendedContentMusic?.classList.add('hidden');
  extendedContentMovie?.classList.add('hidden');
  extendedContentBook?.classList.add('hidden');

  if (item.type === 'music') {
    if (detailExtendedTabLabel) detailExtendedTabLabel.textContent = 'Canciones / Pistas';
    extendedContentMusic?.classList.remove('hidden');
    renderTracklist(item.details?.tracklist || []);
  } else if (item.type === 'movie') {
    if (detailExtendedTabLabel) detailExtendedTabLabel.textContent = 'Reparto & Ficha';
    extendedContentMovie?.classList.remove('hidden');
    renderMovieExtended(item);
  } else if (item.type === 'book') {
    if (detailExtendedTabLabel) detailExtendedTabLabel.textContent = 'Detalles de Edición';
    extendedContentBook?.classList.remove('hidden');
    renderBookExtended(item);
  }

  detailModal?.showModal();
  refreshLucide();
}

// ----------------------------------------------------------------------------
// HUB DE STREAMING & ENLACES INTELIGENTES
// ----------------------------------------------------------------------------
let currentStreamingLinks = [];

function generateStreamingLinks(type, title, creator, year) {
  const qGeneral = encodeURIComponent(`${creator} ${title}`.trim());
  const qTitle = encodeURIComponent(title.trim());

  if (type === 'music') {
    return [
      { name: 'Spotify', icon: '🟢', desc: 'Escuchar álbum completo', url: `https://open.spotify.com/search/${qGeneral}` },
      { name: 'YouTube Music', icon: '🔴', desc: 'Reproducir pistas y temas', url: `https://music.youtube.com/search?q=${qGeneral}` },
      { name: 'YouTube', icon: '▶️', desc: 'Ver videos y directos', url: `https://www.youtube.com/results?search_query=${encodeURIComponent(creator + ' ' + title + ' full album')}` },
      { name: 'Apple Music', icon: '🍎', desc: 'Catálogo de Apple', url: `https://music.apple.com/us/search?term=${qGeneral}` },
      { name: 'RateYourMusic', icon: '🎼', desc: 'Ficha y reseñas de culto', url: `https://rateyourmusic.com/search?searchterm=${qGeneral}&type=l` },
      { name: 'Buscar en Google', icon: '🔍', desc: 'Búsqueda web global', url: `https://www.google.com/search?q=${encodeURIComponent(creator + ' ' + title + ' album spotify')}` }
    ];
  } else if (type === 'movie') {
    return [
      { name: 'JustWatch', icon: '🍿', desc: 'Dónde ver en streaming', url: `https://www.justwatch.com/es/buscar?q=${qTitle}` },
      { name: 'YouTube Trailers', icon: '🎬', desc: 'Ver trailer oficial HD', url: `https://www.youtube.com/results?search_query=${encodeURIComponent(title + ' ' + year + ' trailer oficial')}` },
      { name: 'Letterboxd', icon: '🟢', desc: 'Comunidad cinéfila', url: `https://letterboxd.com/search/${qTitle}/` },
      { name: 'IMDb', icon: '⭐', desc: 'Ficha técnica y notas', url: `https://www.imdb.com/find?q=${encodeURIComponent(title + ' ' + year)}` },
      { name: 'Rotten Tomatoes', icon: '🍅', desc: 'Tomatómetro y crítica', url: `https://www.rottentomatoes.com/search?search=${qTitle}` },
      { name: 'Buscar en Google', icon: '🔍', desc: 'Búsqueda web global', url: `https://www.google.com/search?q=${encodeURIComponent(title + ' ' + year + ' pelicula')}` }
    ];
  } else {
    return [
      { name: 'Goodreads', icon: '📚', desc: 'Reseñas de la comunidad', url: `https://www.goodreads.com/search?q=${qGeneral}` },
      { name: 'Google Books', icon: '📖', desc: 'Vista previa y catálogo', url: `https://www.google.com/search?tbm=bks&q=${qGeneral}` },
      { name: 'OpenLibrary', icon: '🏛️', desc: 'Biblioteca digital libre', url: `https://openlibrary.org/search?q=${qGeneral}` },
      { name: 'Buscar en Google', icon: '🔍', desc: 'Búsqueda web global', url: `https://www.google.com/search?q=${encodeURIComponent(creator + ' ' + title + ' libro')}` }
    ];
  }
}

export function openStreamingHubModal(item) {
  const hubModal = document.getElementById('streaming-hub-modal');
  const hubTitle = document.getElementById('streaming-hub-title');
  const hubSubtitle = document.getElementById('streaming-hub-subtitle');
  const grid = document.getElementById('streaming-links-grid');
  if (!hubModal || !grid) return;

  const creator = item.details?.author || item.details?.director || item.details?.artist || item.creator || '';
  const title = item.title || '';
  const year = item.releaseYear ? String(item.releaseYear) : '';

  if (hubTitle) hubTitle.textContent = item.title;
  if (hubSubtitle) hubSubtitle.textContent = `${creator} (${year || 's.f.'}) • Enlaces en navegador`;

  currentStreamingLinks = generateStreamingLinks(item.type, title, creator, year);

  const fragment = document.createDocumentFragment();
  currentStreamingLinks.forEach((link, idx) => {
    const card = document.createElement('div');
    card.className = 'streaming-link-card';
    card.dataset.idx = idx;
    card.title = `Abrir ${link.name}`;
    card.innerHTML = `
      <div class="streaming-card-icon">${link.icon}</div>
      <div class="streaming-card-info">
        <span class="streaming-card-name">${escapeHtml(link.name)}</span>
        <span class="streaming-card-desc">${escapeHtml(link.desc)}</span>
      </div>
    `;
    fragment.appendChild(card);
  });

  grid.replaceChildren(fragment);
  hubModal.showModal();
  refreshLucide();
}

// ----------------------------------------------------------------------------
// INICIALIZACIÓN DE EVENTOS DEL DETALLE CON AUTO-GUARDADO
// ----------------------------------------------------------------------------
export function initDetailModalEvents() {
  const detailModal = document.getElementById('detail-modal');
  const detailModalBox = document.getElementById('detail-modal-box');
  const detailTagsWrap = document.getElementById('detail-tags-wrap');
  const newTagInput = document.getElementById('new-tag-input');
  const detailWishlistToggle = document.getElementById('detail-wishlist-toggle');
  const detailStatusIndicator = document.getElementById('detail-status-indicator');
  const streamingLinksGrid = document.getElementById('streaming-links-grid');
  const detailCustomLinkInput = document.getElementById('detail-custom-link');
  const detailFilePicker = document.getElementById('detail-file-picker');

  // Auto-guardado reactivo en campos de texto y fechas
  detailModalBox?.addEventListener('input', (e) => {
    if (e.target.id === 'new-tag-input') return;
    scheduleAutoSave();
  });

  detailModalBox?.addEventListener('change', (e) => {
    if (e.target.id === 'new-tag-input') return;
    scheduleAutoSave();
  });

  // Guardado garantizado al cerrar el modal
  detailModal?.addEventListener('close', () => {
    clearTimeout(autoSaveTimer);
    commitDetailChanges(true);
  });

  // Delegación de clics en tags
  if (detailTagsWrap && !detailTagsWrap.dataset.delegated) {
    detailTagsWrap.dataset.delegated = 'true';
    detailTagsWrap.addEventListener('click', (e) => {
      const deleteBtn = e.target.closest('.tag-delete-x');
      if (deleteBtn) {
        const idx = parseInt(deleteBtn.dataset.index, 10);
        currentDetailTags.splice(idx, 1);
        renderDetailTags();
        commitDetailChanges(true);
        return;
      }

      const tagClick = e.target.closest('.detail-tag-click');
      if (tagClick && tagClick.dataset.tag) {
        detailModal?.close();
        setTagFilter(tagClick.dataset.tag);
      }
    });
  }

  // Delegación de clics en el Hub de Streaming
  if (streamingLinksGrid && !streamingLinksGrid.dataset.delegated) {
    streamingLinksGrid.dataset.delegated = 'true';
    streamingLinksGrid.addEventListener('click', (e) => {
      const card = e.target.closest('.streaming-link-card');
      if (!card) return;
      const idx = parseInt(card.dataset.idx, 10);
      const targetLink = currentStreamingLinks[idx];
      if (targetLink && targetLink.url) {
        openExternalResource(targetLink.url);
        showToast(`Abriendo ${targetLink.name} en tu navegador...`);
      }
    });
  }

  document.getElementById('btn-dtab-general')?.addEventListener('click', () => activateDetailSubTab('general'));
  document.getElementById('btn-dtab-extended')?.addEventListener('click', () => activateDetailSubTab('extended'));

  document.getElementById('btn-open-streaming-hub')?.addEventListener('click', () => {
    if (currentDetailItem) openStreamingHubModal(currentDetailItem);
  });

  document.getElementById('btn-close-streaming-hub')?.addEventListener('click', () => {
    document.getElementById('streaming-hub-modal')?.close();
  });

  // Selector de archivo local (PDF / EPUB / MKV)
  detailFilePicker?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const filePath = file.path;
    if (detailCustomLinkInput) {
      if (filePath) {
        detailCustomLinkInput.value = filePath;
        showToast(`Archivo vinculado: ${file.name}`);
      } else {
        detailCustomLinkInput.value = file.name;
        showToast(`Archivo: ${file.name}.`, 'info');
      }
      commitDetailChanges(true);
    }
  });

  document.getElementById('btn-open-custom-link')?.addEventListener('click', async () => {
    const rawVal = detailCustomLinkInput?.value.trim() || '';
    if (!rawVal) return showToast('Pega un enlace web o selecciona un archivo local primero.', 'error');
    showToast('Abriendo recurso...');
    await openExternalResource(rawVal);
  });

  // Alternar estado de consumo
  detailStatusIndicator?.addEventListener('click', () => {
    if (!currentDetailItem) return;
    const cycle = { 'todo': 'in_progress', 'in_progress': 'completed', 'completed': 'todo' };
    currentDetailStatus = cycle[currentDetailStatus || 'todo'] || 'todo';

    if (currentDetailStatus === 'completed') {
      const finishInput = document.getElementById('detail-date-finished');
      if (finishInput && !finishInput.value) {
        finishInput.value = new Date().toISOString().split('T')[0];
      }
    }

    updateDetailStatusUI(currentDetailStatus, currentDetailItem.type);
    commitDetailChanges(true);
    showToast(`Estado: ${currentDetailStatus === 'completed' ? 'Terminado' : (currentDetailStatus === 'in_progress' ? 'En progreso' : 'Por empezar')}`, 'info');
  });

  document.getElementById('btn-close-detail')?.addEventListener('click', () => detailModal?.close());

  // Alternar lista de deseos
  detailWishlistToggle?.addEventListener('click', () => {
    updateWishlistButtonUI(!currentDetailIsWishlist);
    commitDetailChanges(true);
  });

  // Gestor interactivo de estrellas (pasos de 0.25)
  const starsContainer = document.getElementById('detail-stars');
  if (starsContainer && !starsContainer.dataset.ratingInit) {
    starsContainer.dataset.ratingInit = 'true';

    starsContainer.addEventListener('mousemove', (e) => {
      const star = e.target.closest('span[data-star]');
      if (!star) return;
      const starIndex = parseInt(star.dataset.star, 10) - 1;
      const rect = star.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const ratio = Math.max(0.05, Math.min(1, x / rect.width));
      const quarter = Math.ceil(ratio * 4) / 4;
      const hoverRating = Math.min(5, Math.max(0.25, starIndex + quarter));
      renderStarRatingUI(hoverRating);
    });

    starsContainer.addEventListener('mouseleave', () => {
      renderStarRatingUI(currentRating);
    });

    starsContainer.addEventListener('click', (e) => {
      const star = e.target.closest('span[data-star]');
      if (!star) return;
      const starIndex = parseInt(star.dataset.star, 10) - 1;
      const rect = star.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const ratio = Math.max(0.05, Math.min(1, x / rect.width));
      const quarter = Math.ceil(ratio * 4) / 4;
      const selectedRating = Math.min(5, Math.max(0.25, starIndex + quarter));

      currentRating = (currentRating === selectedRating) ? 0 : selectedRating;
      renderStarRatingUI(currentRating);
      commitDetailChanges(true);
    });
  }

  // Delegación sobre el contenedor padre para reiniciar calificación a 0 (anti-bug de creación dinámica)
  const ratingParentContainer = document.querySelector('.rating-container');
  if (ratingParentContainer && !ratingParentContainer.dataset.delegated) {
    ratingParentContainer.dataset.delegated = 'true';
    ratingParentContainer.addEventListener('click', (e) => {
      const badge = e.target.closest('#detail-rating-val');
      if (badge) {
        currentRating = 0;
        renderStarRatingUI(0);
        commitDetailChanges(true);
        showToast('Calificación restablecida a 0.', 'info');
      }
    });
  }

  document.getElementById('btn-add-tag')?.addEventListener('click', () => {
    const val = newTagInput?.value.trim();
    if (val && !currentDetailTags.includes(val)) {
      currentDetailTags.push(val);
      renderDetailTags();
      newTagInput.value = '';
      commitDetailChanges(true);
    }
  });

  newTagInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('btn-add-tag')?.click();
    }
  });

  document.querySelectorAll('.btn-copy-cite').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!currentDetailItem) return;
      const style = btn.dataset.style;
      const creator = currentDetailItem.details?.author || currentDetailItem.details?.director || currentDetailItem.details?.artist || currentDetailItem.creator || 'Autor';
      const year = currentDetailItem.releaseYear || 's.f.';
      const title = currentDetailItem.title;
      const publisher = currentDetailItem.details?.publisher || 'Editorial';

      const citation = `${creator} (${year}). ${title}. ${publisher}.`;
      navigator.clipboard.writeText(citation).then(() => {
        showToast(`Cita copiada (${style.toUpperCase()})`);
      });
    });
  });
}