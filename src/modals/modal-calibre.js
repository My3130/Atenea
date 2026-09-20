// ============================================================================
// SRC/MODALS/MODAL-CALIBRE.JS - Selector Panorámico Calibre (1150px)
// - Distinción visible de fuentes (Google Books, OpenLibrary, Bóveda)
// - Registro natural: fecha actual en 'Empezado/Registrado' y 'Terminado' vacío
// - Importación de ediciones con extracción automática de Tracklist (Música)
// - Enriquecimiento Curatorial en Segundo Plano (País real, Año original y Tags)
// - Actualización Quirúrgica Local (Anti-congelamientos por Drag & Drop)
// ============================================================================

import { 
  library, 
  saveLibrary, 
  isItemDuplicate, 
  refreshLucide, 
  showToast, 
  API_KEY_STORAGE, 
  state 
} from '../state.js';
import { renderActiveView } from '../views.js';
import { enrichBookMetadataWithAi, fetchAlbumTracklist } from '../api.js';
import { escapeHtml } from './utils.js';

let calibreSearchResults = [];
let selectedCalibreIndex = 0;

/**
 * Actualiza la columna lateral de previsualización con la edición seleccionada.
 * @param {object} item - Obra candidata devuelta por el buscador de metadatos.
 */
function updateCalibrePreview(item) {
  if (!item) return;

  const previewCover = document.getElementById('calibre-preview-cover');
  const previewTitle = document.getElementById('calibre-preview-title');
  const previewCreator = document.getElementById('calibre-preview-creator');
  const previewTags = document.getElementById('calibre-preview-tags');
  const previewSynopsis = document.getElementById('calibre-preview-synopsis');

  if (previewCover) {
    previewCover.src = item.coverUrl || '';
    previewCover.style.display = item.coverUrl ? 'block' : 'none';
  }
  if (previewTitle) previewTitle.textContent = item.title || '';
  if (previewCreator) {
    const sourceTag = item.source ? ` • [${item.source}]` : '';
    previewCreator.textContent = `${item.creator || 'Autor desconocido'} (${item.releaseYear || 's.f.'}) • 📍 ${item.country || 'Internacional'}${sourceTag}`;
  }
  
  if (previewTags) {
    previewTags.innerHTML = (item.tags || []).map(t => `<span class="tag-badge">${escapeHtml(t)}</span>`).join('');
  }
  if (previewSynopsis) {
    previewSynopsis.textContent = item.synopsis || 'Sin sinopsis disponible.';
  }
  refreshLucide();
}

/**
 * Parchea quirúrgicamente el nodo DOM de la tarjeta en pantalla sin destruir el contenedor.
 * Esto evita desmontar elementos durante operaciones de arrastre en curso.
 * @param {HTMLElement} cardEl 
 * @param {object} item 
 */
function updateItemCardInDom(cardEl, item) {
  if (!cardEl || !item) return;

  const safeCountry = escapeHtml(item.country || 'N/A');
  const creatorRaw = item.details?.author || item.creator || 'Creador';
  const creator = escapeHtml(creatorRaw);

  // 1. Muro de Portadas Letterboxd
  if (cardEl.classList.contains('media-poster-card')) {
    const yearStr = item.releaseYear ? ` (${item.releaseYear})` : '';
    const ratingStr = item.userRating ? ` • ★ ${Number(item.userRating).toFixed(item.userRating % 1 === 0 ? 0 : (item.userRating % 0.5 === 0 ? 1 : 2))}` : '';
    cardEl.title = `${item.title || 'Sin título'}${yearStr} — ${creatorRaw}${ratingStr}`;
    return;
  }

  // 2. Cuadrícula Normal
  if (cardEl.classList.contains('media-card')) {
    const creatorEl = cardEl.querySelector('.card-creator');
    if (creatorEl) creatorEl.textContent = creator;

    const countryBadge = cardEl.querySelector('[data-tag]');
    if (countryBadge && countryBadge.textContent.includes('📍')) {
      countryBadge.dataset.tag = item.country || 'Internacional';
      countryBadge.textContent = `📍 ${safeCountry}`;
    }

    const tagsContainer = cardEl.querySelector('.card-tags');
    if (tagsContainer && Array.isArray(item.tags)) {
      tagsContainer.innerHTML = item.tags.slice(0, 3).map(tag => `<span class="tag-badge" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</span>`).join('');
    }
    return;
  }

  // 3. Vista Lista
  if (cardEl.classList.contains('media-list-row')) {
    const creatorEl = cardEl.querySelector('.list-creator');
    if (creatorEl) creatorEl.textContent = creator;

    const yearEl = cardEl.querySelector('.list-year');
    if (yearEl) yearEl.textContent = String(item.releaseYear || '-');

    const countryBadge = cardEl.querySelector('.list-country .tag-badge');
    if (countryBadge) {
      countryBadge.dataset.tag = item.country || 'Internacional';
      countryBadge.textContent = safeCountry;
    }

    const tagsContainer = cardEl.querySelector('.list-tags');
    if (tagsContainer && Array.isArray(item.tags)) {
      tagsContainer.innerHTML = item.tags.slice(0, 2).map(tag => `<span class="tag-badge" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</span>`).join('');
    }
  }
}

/**
 * Abre el modal panorámico de 1150px y renderiza la tabla de candidatos de metadatos.
 * @param {string} query - Término de búsqueda introducido por el usuario.
 * @param {Array<object>} results - Lista de resultados devueltos por searchPublicMetadata.
 */
export function openCalibreResultsModal(query, results) {
  calibreSearchResults = results;
  selectedCalibreIndex = 0;

  const calibreModal = document.getElementById('calibre-modal');
  const resultsList = document.getElementById('calibre-results-list');
  const querySubtitle = document.getElementById('calibre-query-subtitle');
  const btnImport = document.getElementById('btn-calibre-import');

  if (querySubtitle) {
    querySubtitle.textContent = `Se encontraron ${results.length} edición(es) para "${query}"`;
  }
  if (!resultsList) return;

  if (results.length === 0) {
    resultsList.innerHTML = `
      <div style="padding: 50px; text-align:center; color:var(--text-muted);">
        No se encontraron ediciones en bases de datos para este término.
      </div>
    `;
    const previewCover = document.getElementById('calibre-preview-cover');
    const previewTitle = document.getElementById('calibre-preview-title');
    const previewCreator = document.getElementById('calibre-preview-creator');
    const previewTags = document.getElementById('calibre-preview-tags');
    const previewSynopsis = document.getElementById('calibre-preview-synopsis');

    if (previewCover) previewCover.src = '';
    if (previewTitle) previewTitle.textContent = 'Sin resultados';
    if (previewCreator) previewCreator.textContent = '';
    if (previewTags) previewTags.innerHTML = '';
    if (previewSynopsis) previewSynopsis.textContent = 'Prueba ajustando el término de búsqueda.';
    if (btnImport) btnImport.disabled = true;
    calibreModal?.showModal();
    refreshLucide();
    return;
  }

  if (btnImport) btnImport.disabled = false;

  const fragment = document.createDocumentFragment();

  results.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = `calibre-row ${index === 0 ? 'active' : ''}`;
    row.dataset.index = index;

    const coverSrc = item.coverUrl || '';
    const sourceLabel = item.source ? `<span class="badge-pill" style="font-size:0.62rem; padding:1px 6px; margin-left:6px; opacity:0.85;">${escapeHtml(item.source)}</span>` : '';

    row.innerHTML = `
      <span class="calibre-row-num">${index + 1}</span>
      <img src="${coverSrc}" class="calibre-row-thumb" loading="lazy" decoding="async" onerror="this.style.display='none';" />
      <div class="calibre-row-info">
        <span class="calibre-row-title">${escapeHtml(item.title)}</span>
        <span class="calibre-row-creator">${escapeHtml(item.creator)}</span>
      </div>
      <span class="calibre-row-year">${escapeHtml(String(item.releaseYear || '-'))}</span>
      <span class="calibre-row-publisher">${escapeHtml(item.publisher || '-')}${sourceLabel}</span>
    `;

    fragment.appendChild(row);
  });

  resultsList.replaceChildren(fragment);
  updateCalibrePreview(results[0]);
  calibreModal?.showModal();
  refreshLucide();
}

/**
 * Inicializa la delegación de eventos para la lista de resultados y el botón de importación.
 */
export function initCalibreModalEvents() {
  const calibreModal = document.getElementById('calibre-modal');
  const resultsList = document.getElementById('calibre-results-list');
  const btnImport = document.getElementById('btn-calibre-import');

  if (resultsList && !resultsList.dataset.delegated) {
    resultsList.dataset.delegated = 'true';
    resultsList.addEventListener('click', (e) => {
      const row = e.target.closest('.calibre-row');
      if (!row) return;

      document.querySelectorAll('.calibre-row').forEach(r => r.classList.remove('active'));
      row.classList.add('active');
      
      selectedCalibreIndex = parseInt(row.dataset.index, 10) || 0;
      updateCalibrePreview(calibreSearchResults[selectedCalibreIndex]);
    });
  }

  btnImport?.addEventListener('click', async () => {
    const selectedItem = calibreSearchResults[selectedCalibreIndex];
    if (!selectedItem) return;

    if (isItemDuplicate(selectedItem, library)) {
      return showToast(`«${selectedItem.title}» ya existe en tu colección.`, 'error');
    }

    const originalBtnContent = btnImport.innerHTML;
    btnImport.disabled = true;
    btnImport.innerHTML = `<i data-lucide="loader-2"></i> Importando obra...`;
    refreshLucide();

    try {
      if (selectedItem.type === 'music' && (!selectedItem.details?.tracklist || selectedItem.details.tracklist.length === 0)) {
        const tracks = await fetchAlbumTracklist(selectedItem);
        if (tracks && tracks.length > 0) {
          if (!selectedItem.details) selectedItem.details = {};
          selectedItem.details.tracklist = tracks;
        }
      }
    } catch (e) {
      console.warn('No se pudo extraer el tracklist completo:', e);
    } finally {
      btnImport.disabled = false;
      btnImport.innerHTML = originalBtnContent;
    }

    const newItem = {
      ...selectedItem,
      id: crypto.randomUUID(),
      status: 'todo',
      dateStarted: new Date().toISOString().split('T')[0],
      dateFinished: '',
      createdAt: new Date().toISOString().split('T')[0]
    };

    if (!newItem.details) newItem.details = {};

    if (selectedItem.details?.editionYear) {
      newItem.details.editionYear = selectedItem.details.editionYear;
    } else if (selectedItem.releaseYear) {
      newItem.details.editionYear = selectedItem.releaseYear;
    }

    library.unshift(newItem);
    calibreModal?.close();
    state.currentActiveView = 'library';
    saveLibrary(renderActiveView);

    const trackCount = newItem.details?.tracklist?.length || 0;
    const trackMsg = trackCount > 0 ? ` (${trackCount} pistas incluidas)` : '';
    showToast(`«${newItem.title}» añadido a tu biblioteca${trackMsg}.`);

    // ========================================================================
    // ENRIQUECIMIENTO CURATORIAL EN SEGUNDO PLANO (GEMINI) PARA LIBROS
    // ========================================================================
    if (newItem.type === 'book' && localStorage.getItem(API_KEY_STORAGE)) {
      (async () => {
        try {
          const enrichment = await enrichBookMetadataWithAi(newItem);
          if (enrichment) {
            let hasChanges = false;

            // 1. País legítimo de origen del autor
            if (enrichment.country && enrichment.country !== 'Internacional') {
              newItem.country = enrichment.country;
              hasChanges = true;
            }

            // 2. Año original de la obra (ej: 1967) vs año de la edición (ej: 2017)
            if (enrichment.originalReleaseYear) {
              if (!newItem.details.editionYear && newItem.releaseYear) {
                newItem.details.editionYear = newItem.releaseYear;
              }
              newItem.releaseYear = enrichment.originalReleaseYear;
              hasChanges = true;
            }

            // 3. Nombre canónico del autor
            if (enrichment.canonicalAuthor) {
              newItem.creator = enrichment.canonicalAuthor;
              if (newItem.details) newItem.details.author = enrichment.canonicalAuthor;
              hasChanges = true;
            }

            // 4. Etiquetas y corrientes canónicas
            if (enrichment.tags && enrichment.tags.length > 0) {
              newItem.tags = enrichment.tags;
              hasChanges = true;
            }

            // 5. Subtipo especial de edición (si aplica)
            if (enrichment.editionSubtype && !newItem.details.editionNumber) {
              newItem.details.editionNumber = enrichment.editionSubtype;
              hasChanges = true;
            }

            if (hasChanges) {
              // Buscar si la tarjeta ya está renderizada en pantalla
              const cardEl = document.querySelector(
                `.media-card[data-id="${newItem.id}"], .media-poster-card[data-id="${newItem.id}"], .media-list-row[data-id="${newItem.id}"]`
              );

              if (cardEl && state.currentActiveView === 'library') {
                // Parche quirúrgico directo: la tarjeta se actualiza sin demoler el DOM
                updateItemCardInDom(cardEl, newItem);
                
                // Si el usuario está arrastrando cualquier obra, delegamos a saveLibrary
                // para que retenga el render global hasta dragend; si no, guardamos sin parpadeo.
                if (state.isDragging) {
                  saveLibrary(renderActiveView);
                } else {
                  saveLibrary();
                }
              } else {
                saveLibrary(renderActiveView);
              }

              const yearTxt = newItem.releaseYear ? ` (${newItem.releaseYear})` : '';
              const countryTxt = newItem.country ? ` • 📍 ${newItem.country}` : '';
              showToast(`✨ Enriquecido por IA: ${newItem.title}${yearTxt}${countryTxt}`, 'info');
            }
          }
        } catch (e) {
          console.warn('Error en segundo plano al enriquecer metadatos literarios:', e);
        }
      })();
    }
  });

  document.getElementById('btn-close-calibre')?.addEventListener('click', () => calibreModal?.close());
}