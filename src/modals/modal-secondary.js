// ============================================================================
// SRC/MODALS/MODAL-SECONDARY.JS - Modales de Portada, Borrado, Día y Manual
// - Purga y reemplazo físico de carátulas en IndexedDB (cero imágenes huérfanas)
// - Cierre seguro de modales anti-bug en selección de texto y exclusión de bienvenida
// - Calificación por estrellas con decimales en el Inspector de Día
// ============================================================================

import { 
  library, 
  saveLibrary, 
  getStatusIconName, 
  refreshLucide, 
  showToast, 
  canonicalizeCountry, 
  isItemDuplicate,
  deleteCachedCover,
  cacheCoverLocally
} from '../state.js';
import { renderActiveView } from '../views.js';
import { fetchAutomaticCover } from '../api.js';
import { escapeHtml, MONTH_NAMES } from './utils.js';
import { openDetailModal } from './modal-detail.js';
import { updateAppTitle, VAULT_NAME_STORAGE } from './modal-settings.js';

let itemToEditCoverId = null;
let itemToDeleteId = null;

/**
 * Abre el modal para editar manualmente la URL de la portada de una obra.
 * @param {string} id - UUID de la obra.
 */
export function openCoverModal(id) {
  const item = library.find(i => i.id === id);
  const coverModal = document.getElementById('cover-modal');
  const coverModalSubtitle = document.getElementById('cover-modal-subtitle');
  const coverModalInput = document.getElementById('cover-modal-input');
  if (!item || !coverModal || !coverModalSubtitle || !coverModalInput) return;

  itemToEditCoverId = id;
  coverModalSubtitle.innerHTML = `Pega la URL directa de la imagen para <strong>"${escapeHtml(item.title)}"</strong>:`;
  coverModalInput.value = item.coverUrl || '';
  coverModal.showModal();
}

/**
 * Abre el modal de confirmación antes de eliminar una obra.
 * @param {string} id - UUID de la obra.
 */
export function openDeleteModal(id) {
  const item = library.find(i => i.id === id);
  const deleteModal = document.getElementById('delete-modal');
  if (!item || !deleteModal) return;

  itemToDeleteId = id;
  const delText = document.getElementById('delete-modal-text');
  if (delText) {
    delText.innerHTML = `¿Deseas eliminar <strong>"${escapeHtml(item.title)}"</strong> de tu biblioteca?`;
  }
  deleteModal.showModal();
  refreshLucide();
}

/**
 * Abre el inspector de día del calendario o de la vista del mapa/globo.
 * @param {string} dateStr - Fecha ISO (YYYY-MM-DD) o nombre del país.
 * @param {Array<object>} items - Lista de obras registradas en esa fecha/país.
 */
export function openDayInspectorModal(dateStr, items) {
  const calendarDayModal = document.getElementById('calendar-day-modal');
  const dayTitle = document.getElementById('day-modal-title');
  const daySubtitle = document.getElementById('day-modal-subtitle');
  const dayItemsList = document.getElementById('day-modal-items');
  if (!calendarDayModal || !dayTitle || !daySubtitle || !dayItemsList) return;

  let formattedDate = dateStr;
  if (dateStr && dateStr.includes('-')) {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const [y, m, d] = parts;
      const monthName = MONTH_NAMES[parseInt(m, 10) - 1] || m;
      formattedDate = `${parseInt(d, 10)} de ${monthName}, ${y}`;
    }
  }

  dayTitle.innerHTML = `<i data-lucide="calendar"></i> Obras del ${escapeHtml(formattedDate)}`;
  daySubtitle.textContent = `${items.length} obra(s) registradas`;

  const fragment = document.createDocumentFragment();

  items.forEach(it => {
    const row = document.createElement('div');
    row.className = 'day-item-row';
    row.dataset.id = it.id;
    const cover = it.coverUrl || '';
    
    const creatorRaw = it.details?.author || it.details?.director || it.details?.artist || it.creator || 'Creador';
    const creatorText = (it.type === 'movie' ? 'Dir. ' : '') + creatorRaw;
    const statusIcon = getStatusIconName(it.type, it.status);

    const starsHtml = it.userRating 
      ? `<span style="color:var(--star-gold); font-size:0.85rem; font-weight:700; letter-spacing:0.5px; margin-left:auto; flex-shrink:0;">★ ${Number(it.userRating).toFixed(it.userRating % 1 === 0 ? 0 : (it.userRating % 0.5 === 0 ? 1 : 2))}</span>` 
      : '';

    row.innerHTML = `
      <img src="${escapeHtml(cover)}" class="day-item-thumb" loading="lazy" decoding="async" onerror="this.style.display='none';" />
      <div class="day-item-info" style="flex:1; min-width:0;">
        <div class="day-item-title"><i data-lucide="${statusIcon}"></i> ${escapeHtml(it.title)}</div>
        <div class="day-item-creator">${escapeHtml(creatorText)} • 📍 ${escapeHtml(it.country || 'N/A')}</div>
      </div>
      ${starsHtml}
    `;

    fragment.appendChild(row);
  });

  dayItemsList.replaceChildren(fragment);
  calendarDayModal.showModal();
  refreshLucide();
}

/**
 * Inicializa los controladores de eventos para los modales secundarios.
 */
export function initSecondaryModalEvents() {
  const coverModal = document.getElementById('cover-modal');
  const coverModalInput = document.getElementById('cover-modal-input');
  const deleteModal = document.getElementById('delete-modal');
  const calendarDayModal = document.getElementById('calendar-day-modal');
  const manualModal = document.getElementById('manual-modal');
  const welcomeModal = document.getElementById('welcome-modal');
  const welcomeVaultInput = document.getElementById('welcome-vault-input');
  const dayItemsList = document.getElementById('day-modal-items');

  // Modal de Bienvenida
  document.getElementById('btn-confirm-welcome')?.addEventListener('click', () => {
    const name = welcomeVaultInput?.value.trim() || 'Mi mundo';
    localStorage.setItem(VAULT_NAME_STORAGE, name);
    updateAppTitle(name);
    welcomeModal?.close();
    showToast(`¡Bienvenido a ${name}!`);
  });

  // Cierre robusto al hacer clic en el backdrop con protección de selección de texto
  document.querySelectorAll('dialog.modal').forEach(dialog => {
    dialog.addEventListener('mousedown', (e) => {
      dialog._clickStartedOnBackdrop = (e.target === dialog);
    });

    dialog.addEventListener('click', (e) => {
      // Excluir el modal de bienvenida del auto-cierre
      if (dialog.id === 'welcome-modal') return;

      // Cerrar únicamente si el clic empezó y terminó sobre el backdrop exterior
      if (e.target === dialog && dialog._clickStartedOnBackdrop) {
        dialog.close();
      }
    });
  });

  // Modal Portada: actualiza y purga la anterior si queda vacía
  document.getElementById('btn-close-cover-modal')?.addEventListener('click', () => coverModal?.close());
  document.getElementById('btn-cancel-cover')?.addEventListener('click', () => coverModal?.close());
  document.getElementById('btn-save-cover')?.addEventListener('click', async () => {
    if (itemToEditCoverId) {
      const targetItem = library.find(i => i.id === itemToEditCoverId);
      if (targetItem) {
        const newCover = coverModalInput?.value.trim() || '';
        targetItem.coverUrl = newCover;

        if (newCover) {
          await cacheCoverLocally(targetItem.id, newCover);
        } else {
          await deleteCachedCover(targetItem.id);
        }

        saveLibrary(renderActiveView);
        showToast('Portada actualizada y guardada localmente.');
      }
    }
    coverModal?.close();
    itemToEditCoverId = null;
  });

  // Modal Eliminación: elimina del catálogo y purga el Blob de IndexedDB
  document.getElementById('btn-cancel-delete')?.addEventListener('click', () => deleteModal?.close());
  document.getElementById('btn-confirm-delete')?.addEventListener('click', () => {
    if (itemToDeleteId) {
      const idx = library.findIndex(i => i.id === itemToDeleteId);
      if (idx !== -1) library.splice(idx, 1);
      
      deleteCachedCover(itemToDeleteId);
      saveLibrary(renderActiveView);
      deleteModal?.close();
      itemToDeleteId = null;
      showToast('Obra eliminada y memoria liberada.', 'info');
    }
  });

  // Delegación de clics en filas del inspector de día
  if (dayItemsList && !dayItemsList.dataset.delegated) {
    dayItemsList.dataset.delegated = 'true';
    dayItemsList.addEventListener('click', (e) => {
      const row = e.target.closest('.day-item-row');
      if (row && row.dataset.id) {
        calendarDayModal?.close();
        openDetailModal(row.dataset.id);
      }
    });
  }

  document.getElementById('btn-close-day-modal')?.addEventListener('click', () => calendarDayModal?.close());

  // Modal de Agregado Manual
  document.getElementById('btn-open-manual-add')?.addEventListener('click', () => {
    manualModal?.showModal();
    refreshLucide();
  });
  document.getElementById('btn-close-manual')?.addEventListener('click', () => manualModal?.close());
  document.getElementById('btn-cancel-manual')?.addEventListener('click', () => manualModal?.close());
  
  document.getElementById('manual-add-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn) {
      if (submitBtn.disabled) return;
      submitBtn.disabled = true;
    }

    try {
      const type = document.getElementById('manual-type').value;
      const title = document.getElementById('manual-title').value.trim();
      const creator = document.getElementById('manual-creator').value.trim();
      const country = canonicalizeCountry(document.getElementById('manual-country').value.trim());
      const year = parseInt(document.getElementById('manual-year').value, 10) || new Date().getFullYear();
      const status = document.getElementById('manual-status').value;
      const isWishlist = document.getElementById('manual-is-wishlist').checked;
      const tags = document.getElementById('manual-tags').value.split(',').map(t => t.trim()).filter(Boolean);
      let coverUrl = document.getElementById('manual-cover').value.trim();

      const candidate = { type, title, creator, releaseYear: year, country };
      if (isItemDuplicate(candidate, library)) {
        return showToast(`«${title}» ya existe en tu biblioteca.`, 'error');
      }

      const newItem = {
        id: crypto.randomUUID(),
        type,
        title,
        originalTitle: '',
        status,
        isWishlist,
        coverUrl,
        releaseYear: year,
        country,
        tags,
        details: {
          author: type === 'book' ? creator : '',
          director: type === 'movie' ? creator : '',
          artist: type === 'music' ? creator : ''
        },
        userRating: 0,
        userNotes: '',
        dateStarted: '',
        dateFinished: status === 'completed' ? new Date().toISOString().split('T')[0] : '',
        createdAt: new Date().toISOString().split('T')[0]
      };

      if (!newItem.coverUrl) {
        newItem.coverUrl = await fetchAutomaticCover(newItem);
      }

      if (newItem.coverUrl) {
        cacheCoverLocally(newItem.id, newItem.coverUrl);
      }

      library.unshift(newItem);
      saveLibrary(renderActiveView);
      manualModal?.close();
      document.getElementById('manual-add-form').reset();
      showToast('Obra agregada manualmente.');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}