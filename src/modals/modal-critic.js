// ============================================================================
// SRC/MODALS/MODAL-CRITIC.JS - El Crítico Cultural (IA Gemini: Puentes y Descubrimientos)
// ============================================================================

import { 
  library, 
  saveLibrary, 
  refreshLucide, 
  showToast, 
  API_KEY_STORAGE, 
  canonicalizeCountry 
} from '../state.js';
import { renderActiveView } from '../views.js';
import { 
  analyzeDeepConnections, 
  generateCulturalDiscoveries, 
  fetchAutomaticCover 
} from '../api.js';
import { escapeHtml } from './utils.js';
import { getCurrentDetailItem } from './modal-detail.js';

/**
 * Inicializa los controladores de eventos para el análisis comparativo y
 * las recomendaciones canónicas generadas por Google Gemini.
 */
export function initCriticEvents() {
  const btnCriticBridges = document.getElementById('btn-critic-bridges');
  const btnCriticDiscoveries = document.getElementById('btn-critic-discoveries');
  const criticResultContainer = document.getElementById('critic-result-container');

  // 1. PUENTES TEMÁTICOS (Análisis comparativo con la colección del usuario)
  btnCriticBridges?.addEventListener('click', async () => {
    const item = getCurrentDetailItem();
    if (!item) return;
    if (!localStorage.getItem(API_KEY_STORAGE)) {
      return showToast('Configura tu API Key de Gemini en Ajustes.', 'error');
    }

    if (criticResultContainer) {
      criticResultContainer.innerHTML = `
        <div class="critic-loading-box">
          <div class="critic-spinner"></div>
          <span>Analizando resonancias semánticas y puentes conceptuales...</span>
        </div>
      `;
    }

    try {
      const result = await analyzeDeepConnections(item, library);
      if (!criticResultContainer) return;

      if (!result.hasConnections) {
        criticResultContainer.innerHTML = `
          <div class="critic-bridge-card empty">
            <div class="critic-card-header">
              <i data-lucide="compass"></i>
              <span>Sin puentes directos</span>
            </div>
            <p class="critic-essay-text">${escapeHtml(result.academicInsight || result.message || 'No se encontraron puentes temáticos directos entre esta obra y el resto de tu colección.')}</p>
          </div>
        `;
      } else {
        criticResultContainer.innerHTML = `
          <div class="critic-bridge-card">
            <div class="critic-card-header">
              <i data-lucide="sparkles"></i>
              <span class="critic-theme-badge">${escapeHtml(result.connectionTheme || 'Conexión Temática')}</span>
            </div>
            <div class="critic-bridge-relation">
              <span>Resuena con:</span>
              <strong>«${escapeHtml(result.relatedItemTitle || 'Obra del catálogo')}»</strong>
            </div>
            <p class="critic-essay-text">${escapeHtml(result.academicInsight)}</p>
          </div>
        `;
      }
      refreshLucide();
    } catch (err) {
      if (criticResultContainer) {
        criticResultContainer.innerHTML = `
          <div class="critic-error-box">
            <i data-lucide="alert-triangle"></i>
            <span>${escapeHtml(err.message || 'No se pudo completar el análisis crítico.')}</span>
          </div>
        `;
        refreshLucide();
      }
    }
  });

  // 2. NUEVOS DESCUBRIMIENTOS (3 Recomendaciones afines con inserción a Wishlist)
  btnCriticDiscoveries?.addEventListener('click', async () => {
    const item = getCurrentDetailItem();
    if (!item) return;
    if (!localStorage.getItem(API_KEY_STORAGE)) {
      return showToast('Configura tu API Key de Gemini en Ajustes.', 'error');
    }

    if (criticResultContainer) {
      criticResultContainer.innerHTML = `
        <div class="critic-loading-box">
          <div class="critic-spinner"></div>
          <span>Consultando el canon cultural y generando recomendaciones...</span>
        </div>
      `;
    }

    try {
      const data = await generateCulturalDiscoveries(item);
      if (!criticResultContainer) return;

      const discoveries = data.discoveries || [];
      if (discoveries.length === 0) {
        criticResultContainer.innerHTML = `<p class="empty-hint">No se generaron recomendaciones para esta obra.</p>`;
        return;
      }

      criticResultContainer.innerHTML = `
        <div class="critic-discoveries-grid">
          ${discoveries.map((d, idx) => `
            <div class="critic-discovery-card" data-idx="${idx}">
              <div class="discovery-card-top">
                <span class="discovery-type-badge">${d.type === 'book' ? '📖 Libro' : (d.type === 'movie' ? '🎬 Película' : '🎵 Música')}</span>
                <span class="discovery-year">${escapeHtml(String(d.releaseYear || ''))} • ${escapeHtml(d.country || '')}</span>
              </div>
              <h4 class="discovery-title">${escapeHtml(d.title)}</h4>
              <h5 class="discovery-creator">${escapeHtml(d.creator)}</h5>
              <p class="discovery-reason">${escapeHtml(d.curatorialReason)}</p>
              <button type="button" class="btn-discovery-wishlist" data-idx="${idx}">
                <i data-lucide="bookmark-plus"></i> + Lista de Deseos
              </button>
            </div>
          `).join('')}
        </div>
      `;

      // Delegación de inserción a la lista de deseos con portada automática asíncrona
      document.querySelectorAll('.btn-discovery-wishlist').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const idx = parseInt(e.currentTarget.dataset.idx);
          const rec = discoveries[idx];
          if (!rec) return;

          const newItem = {
            id: crypto.randomUUID(),
            type: rec.type || 'book',
            title: rec.title,
            originalTitle: '',
            status: 'todo',
            isWishlist: true,
            coverUrl: '',
            releaseYear: rec.releaseYear || new Date().getFullYear(),
            country: canonicalizeCountry(rec.country),
            tags: rec.tags || ['Recomendación'],
            details: {
              author: rec.type === 'book' ? rec.creator : '',
              director: rec.type === 'movie' ? rec.creator : '',
              artist: rec.type === 'music' ? rec.creator : ''
            },
            userRating: 0,
            userNotes: `Recomendado por El Crítico Cultural a partir de «${item.title}». Razón: ${rec.curatorialReason}`,
            dateStarted: '',
            dateFinished: '',
            createdAt: new Date().toISOString().split('T')[0]
          };

          fetchAutomaticCover(newItem).then(url => {
            if (url) {
              newItem.coverUrl = url;
              saveLibrary(renderActiveView);
            }
          });

          library.unshift(newItem);
          saveLibrary(renderActiveView);
          e.currentTarget.disabled = true;
          e.currentTarget.innerHTML = `<i data-lucide="check"></i> Agregado`;
          refreshLucide();
          showToast(`«${rec.title}» agregado a tu Lista de Deseos.`);
        });
      });

      refreshLucide();
    } catch (err) {
      if (criticResultContainer) {
        criticResultContainer.innerHTML = `
          <div class="critic-error-box">
            <i data-lucide="alert-triangle"></i>
            <span>${escapeHtml(err.message || 'No se pudieron obtener descubrimientos.')}</span>
          </div>
        `;
        refreshLucide();
      }
    }
  });
}