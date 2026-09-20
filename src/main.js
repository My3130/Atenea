// ============================================================================
// MAIN.JS - Orquestador Principal y Punto de Entrada de Atenea
// - Arranque Asíncrono con IndexedDB (AteneaVaultDB)
// - Descarga no bloqueante de portadas en segundo plano
// - Selector Cíclico de Cuadrículas: Normal ➔ Muro Medio ➔ Muro Compacto
// - Suite Global de Atajos de Teclado (Power-User / Estilo Obsidian)
// - Buscador Catálogo Rápido reactivo por disciplina (Libro, Cine, Música)
// - Reseteo automático de filtros de colección al hacer clic en Biblioteca
// ============================================================================

import { 
  state, 
  library, 
  saveLibrary, 
  refreshLucide, 
  THEME_STORAGE,
  applyBackgroundTheme,
  addCustomCollection,
  showToast,
  isItemDuplicate,
  sanitizeLibraryData,
  initAteneaVault,
  cacheCoverLocally
} from './state.js';

import { searchPublicMetadata, callGeminiChat, fetchAutomaticCover } from './api.js';
import { renderActiveView, renderCollection, initViewsEvents, renderSidebarCollections } from './views.js';
import { invalidateAtlasSizes, initAtlasEvents } from './atlas.js';
import { openCalibreResultsModal, initModals, initVaultName, checkYearlyWrapPrompt, escapeHtml } from './modals.js';

// ----------------------------------------------------------------------------
// 1. CONTROLES NATIVOS DE VENTANA (FRAMELESS TAURI V2)
// ----------------------------------------------------------------------------
document.getElementById('win-btn-minimize')?.addEventListener('click', async () => {
  try {
    if (window.__TAURI__?.window?.getCurrentWindow) {
      await window.__TAURI__.window.getCurrentWindow().minimize();
    } else if (window.__TAURI__?.webviewWindow?.getCurrentWebviewWindow) {
      await window.__TAURI__.webviewWindow.getCurrentWebviewWindow().minimize();
    } else if (window.__TAURI__?.window?.appWindow) {
      await window.__TAURI__.window.appWindow.minimize();
    }
  } catch (e) {}
});

document.getElementById('win-btn-maximize')?.addEventListener('click', async () => {
  try {
    if (window.__TAURI__?.window?.getCurrentWindow) {
      await window.__TAURI__.window.getCurrentWindow().toggleMaximize();
    } else if (window.__TAURI__?.webviewWindow?.getCurrentWebviewWindow) {
      await window.__TAURI__.webviewWindow.getCurrentWebviewWindow().toggleMaximize();
    } else if (window.__TAURI__?.window?.appWindow) {
      await window.__TAURI__.window.appWindow.toggleMaximize();
    }
  } catch (e) {}
});

document.getElementById('win-btn-close')?.addEventListener('click', async () => {
  try {
    if (window.__TAURI__?.window?.getCurrentWindow) {
      await window.__TAURI__.window.getCurrentWindow().close();
    } else if (window.__TAURI__?.webviewWindow?.getCurrentWebviewWindow) {
      await window.__TAURI__.webviewWindow.getCurrentWebviewWindow().close();
    } else if (window.__TAURI__?.window?.appWindow) {
      await window.__TAURI__.window.appWindow.close();
    }
  } catch (e) {}
});

// ----------------------------------------------------------------------------
// 2. NAVEGACIÓN ENTRE PERSPECTIVAS Y FILTROS
// ----------------------------------------------------------------------------
export function updateNavTabs() {
  document.querySelectorAll('.tab-btn[data-view]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === state.currentActiveView);
  });
  refreshLucide();
}

export function updateFilterTabs() {
  document.querySelectorAll('.filter-btn[data-filter]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === state.activeTypeFilter);
  });
  refreshLucide();
}

// Selector de Vistas / Perspectivas (Barra Lateral)
document.querySelectorAll('.tab-btn[data-view]').forEach(btn => {
  btn.addEventListener('click', () => {
    // Si el usuario pulsa en "Biblioteca", desactiva cualquier colección o wishlist activa
    if (btn.dataset.view === 'library') {
      state.activeCollectionFilter = null;
      state.isWishlistFilterActive = false;
      document.getElementById('filter-wishlist')?.classList.remove('active');
      renderSidebarCollections();
    }

    state.currentActiveView = btn.dataset.view;
    updateNavTabs();
    renderActiveView();
  });
});

// Filtros de Medio / Disciplina (Barra Superior)
document.querySelectorAll('.filter-btn[data-filter]').forEach(btn => {
  btn.addEventListener('click', () => {
    state.activeTypeFilter = btn.dataset.filter;
    updateFilterTabs();
    renderActiveView();
  });
});

// Filtros de Estado en la Barra Lateral
document.querySelectorAll('.filter-btn[data-status]').forEach(btn => {
  btn.addEventListener('click', () => {
    if (state.activeStatusFilter === btn.dataset.status) {
      state.activeStatusFilter = 'all';
      btn.classList.remove('active');
    } else {
      document.querySelectorAll('.filter-btn[data-status]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.activeStatusFilter = btn.dataset.status;
    }
    renderActiveView();
  });
});

// Filtro de Lista de Deseos
document.getElementById('filter-wishlist')?.addEventListener('click', (e) => {
  state.isWishlistFilterActive = !state.isWishlistFilterActive;
  e.currentTarget.classList.toggle('active', state.isWishlistFilterActive);
  
  if (state.isWishlistFilterActive) {
    state.activeCollectionFilter = null;
    renderSidebarCollections();
  }
  renderActiveView();
});

// Buscador General con Debounce (180ms)
let searchDebounceTimer = null;
document.getElementById('search-input')?.addEventListener('input', (e) => {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    state.searchQuery = e.target.value;
    renderActiveView();
  }, 180);
});

// Ordenamiento
document.getElementById('sort-select')?.addEventListener('change', (e) => {
  state.currentSortOrder = e.target.value;
  renderCollection();
});

// ----------------------------------------------------------------------------
// SELECTOR CÍCLICO DE VISTAS (CUADRÍCULA TRIPARTITA Y LISTA)
// ----------------------------------------------------------------------------
const btnViewGrid = document.getElementById('btn-view-grid');
const btnViewList = document.getElementById('btn-view-list');

/**
 * Actualiza el icono y tooltip del botón de cuadrícula según la densidad activa.
 * @param {'grid'|'poster-medium'|'poster-massive'} mode 
 */
function updateGridToggleUI(mode) {
  if (!btnViewGrid) return;
  let iconName = 'layout-grid';
  let titleText = 'Vista Cuadrícula (Normal)';

  if (mode === 'poster-medium') {
    iconName = 'grid';
    titleText = 'Muro de Portadas (Medio)';
  } else if (mode === 'poster-massive') {
    iconName = 'grip';
    titleText = 'Muro de Portadas (Compacto)';
  }

  btnViewGrid.innerHTML = `<i data-lucide="${iconName}"></i>`;
  btnViewGrid.title = titleText;
  refreshLucide();
}

btnViewGrid?.addEventListener('click', () => {
  if (state.currentViewMode === 'grid') {
    state.currentViewMode = 'poster-medium';
    showToast('Muro de Portadas: Medio', 'info');
  } else if (state.currentViewMode === 'poster-medium') {
    state.currentViewMode = 'poster-massive';
    showToast('Muro de Portadas: Compacto', 'info');
  } else {
    state.currentViewMode = 'grid';
    showToast('Vista Cuadrícula: Normal', 'info');
  }

  updateGridToggleUI(state.currentViewMode);
  btnViewGrid.classList.add('active');
  btnViewList?.classList.remove('active');
  renderCollection();
});

btnViewList?.addEventListener('click', () => {
  state.currentViewMode = 'list';
  btnViewList.classList.add('active');
  btnViewGrid?.classList.remove('active');
  renderCollection();
});

// Modo Claro / Oscuro
const savedTheme = localStorage.getItem(THEME_STORAGE) || 'dark';
document.documentElement.setAttribute('data-theme', savedTheme);

document.getElementById('btn-toggle-theme')?.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  const nextTheme = current === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', nextTheme);
  localStorage.setItem(THEME_STORAGE, nextTheme);
  renderActiveView();
});

// Barras Laterales Colapsables
const appLayout = document.getElementById('app-layout');
document.getElementById('btn-collapse-left')?.addEventListener('click', () => {
  appLayout?.classList.add('no-left-sidebar');
  document.getElementById('btn-expand-left')?.classList.remove('hidden');
  invalidateAtlasSizes();
});
document.getElementById('btn-expand-left')?.addEventListener('click', () => {
  appLayout?.classList.remove('no-left-sidebar');
  document.getElementById('btn-expand-left')?.classList.add('hidden');
  invalidateAtlasSizes();
});
document.getElementById('btn-collapse-right')?.addEventListener('click', () => {
  appLayout?.classList.add('no-right-sidebar');
  document.getElementById('btn-expand-right')?.classList.remove('hidden');
  invalidateAtlasSizes();
});
document.getElementById('btn-expand-right')?.addEventListener('click', () => {
  appLayout?.classList.remove('no-right-sidebar');
  document.getElementById('btn-expand-right')?.classList.add('hidden');
  invalidateAtlasSizes();
});

// ----------------------------------------------------------------------------
// 3. BUSCADOR TIPO CALIBRE (PANEL DERECHO - CON LABELS Y PLACEHOLDERS REACTIVOS)
// ----------------------------------------------------------------------------
const btnTabQuick = document.getElementById('btn-tab-quick');
const btnTabAi = document.getElementById('btn-tab-ai');
const quickCatalogPanel = document.getElementById('quick-catalog-panel');
const aiPanel = document.getElementById('ai-panel');

btnTabQuick?.addEventListener('click', () => {
  btnTabQuick.classList.add('active');
  btnTabAi?.classList.remove('active');
  quickCatalogPanel?.classList.remove('hidden');
  aiPanel?.classList.add('hidden');
  refreshLucide();
});

btnTabAi?.addEventListener('click', () => {
  btnTabAi.classList.add('active');
  btnTabQuick?.classList.remove('active');
  aiPanel?.classList.remove('hidden');
  quickCatalogPanel?.classList.add('hidden');
  refreshLucide();
});

const quickSearchForm = document.getElementById('quick-search-form');
const quickTitleInput = document.getElementById('quick-title-input');
const quickCreatorInput = document.getElementById('quick-creator-input');
const quickPublisherInput = document.getElementById('quick-publisher-input');
const btnQuickSearch = document.getElementById('btn-quick-search');

const QUICK_CATALOG_TYPES = {
  book: {
    titleLabel: 'Título o ISBN:',
    titlePlaceholder: 'Ej: Trilce, 1984, Cien años de soledad...',
    creatorLabel: 'Autor o Autora (Opcional):',
    creatorPlaceholder: 'Ej: César Vallejo, George Orwell...',
    publisherLabel: 'Editorial (Opcional):',
    publisherPlaceholder: 'Ej: Cátedra, Alianza, Penguin...'
  },
  movie: {
    titleLabel: 'Título o IMDb ID:',
    titlePlaceholder: 'Ej: Stalker, Dogma, Ciudad de M...',
    creatorLabel: 'Director o Directora (Opcional):',
    creatorPlaceholder: 'Ej: Andrei Tarkovsky, Kevin Smith...',
    publisherLabel: 'Estudio o Productora (Opcional):',
    publisherPlaceholder: 'Ej: Warner Bros, A24, Miramax...'
  },
  music: {
    titleLabel: 'Título del Álbum o Pista:',
    titlePlaceholder: 'Ej: Bucket List Project, Flying Beagle...',
    creatorLabel: 'Artista o Banda (Opcional):',
    creatorPlaceholder: 'Ej: Saba, Himiko Kikuchi, Radiohead...',
    publisherLabel: 'Sello Discográfico (Opcional):',
    publisherPlaceholder: 'Ej: 4AD, Columbia, Polydor...'
  }
};

/**
 * Actualiza dinámicamente las etiquetas y placeholders del formulario
 * según la disciplina activa (Libro, Película, Música).
 * @param {'book'|'movie'|'music'} type 
 */
function updateQuickSearchTypeUI(type) {
  const config = QUICK_CATALOG_TYPES[type] || QUICK_CATALOG_TYPES.book;
  const labelTitle = document.querySelector('label[for="quick-title-input"]');
  const labelCreator = document.querySelector('label[for="quick-creator-input"]');
  const labelPublisher = document.querySelector('label[for="quick-publisher-input"]');

  if (labelTitle) labelTitle.textContent = config.titleLabel;
  if (quickTitleInput) quickTitleInput.placeholder = config.titlePlaceholder;
  if (labelCreator) labelCreator.textContent = config.creatorLabel;
  if (quickCreatorInput) quickCreatorInput.placeholder = config.creatorPlaceholder;
  if (labelPublisher) labelPublisher.textContent = config.publisherLabel;
  if (quickPublisherInput) quickPublisherInput.placeholder = config.publisherPlaceholder;
}

// Escuchar cambios de disciplina en los botones de radio
document.querySelectorAll('input[name="quick-type"]').forEach(radio => {
  radio.addEventListener('change', (e) => {
    updateQuickSearchTypeUI(e.target.value);
  });
});

quickSearchForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = quickTitleInput?.value.trim();
  const creator = quickCreatorInput?.value.trim() || '';
  const publisher = quickPublisherInput?.value.trim() || '';
  if (!query) return;

  const type = document.querySelector('input[name="quick-type"]:checked')?.value || 'book';
  
  if (btnQuickSearch) {
    btnQuickSearch.disabled = true;
    btnQuickSearch.innerHTML = `<i data-lucide="loader-2"></i> Buscando...`;
    refreshLucide();
  }

  try {
    const results = await searchPublicMetadata(type, query, creator, publisher);
    openCalibreResultsModal(query, results);
  } catch (err) {
    showToast(`Error al consultar bases de datos: ${err.message}`, 'error');
  } finally {
    if (btnQuickSearch) {
      btnQuickSearch.disabled = false;
      btnQuickSearch.innerHTML = `<i data-lucide="search"></i> Buscar Ediciones`;
      refreshLucide();
    }
  }
});

// ----------------------------------------------------------------------------
// 4. CHAT ASISTENTE IA (MULTIMODAL CON CACHÉ LOCAL AUTOMÁTICO)
// ----------------------------------------------------------------------------
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatMessages = document.getElementById('chat-messages');
const chatFileInput = document.getElementById('chat-file-input');
const chatImgPreviewContainer = document.getElementById('chat-image-preview-container');
const chatImgPreview = document.getElementById('chat-image-preview');
let currentAttachedImageBase64 = null;
let isAiResponding = false;

chatFileInput?.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (event) => {
      currentAttachedImageBase64 = event.target.result;
      if (chatImgPreview) chatImgPreview.src = currentAttachedImageBase64;
      chatImgPreviewContainer?.classList.remove('hidden');
    };
    reader.readAsDataURL(file);
  }
});

chatInput?.addEventListener('paste', (e) => {
  const items = (e.clipboardData || e.originalEvent?.clipboardData)?.items;
  if (!items) return;
  for (let item of items) {
    if (item.type.indexOf('image') === 0) {
      const blob = item.getAsFile();
      const reader = new FileReader();
      reader.onload = (event) => {
        currentAttachedImageBase64 = event.target.result;
        if (chatImgPreview) chatImgPreview.src = currentAttachedImageBase64;
        chatImgPreviewContainer?.classList.remove('hidden');
      };
      reader.readAsDataURL(blob);
    }
  }
});

document.getElementById('btn-remove-attachment')?.addEventListener('click', () => {
  currentAttachedImageBase64 = null;
  if (chatImgPreview) chatImgPreview.src = '';
  chatImgPreviewContainer?.classList.add('hidden');
  if (chatFileInput) chatFileInput.value = '';
});

function appendMessage(text, sender = 'ai') {
  const msgDiv = document.createElement('div');
  msgDiv.className = `message ${sender}-msg`;
  msgDiv.innerHTML = text;
  chatMessages?.appendChild(msgDiv);
  if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
  refreshLucide();
}

chatForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (isAiResponding) return;

  const text = chatInput?.value.trim();
  if (!text && !currentAttachedImageBase64) return;

  const userDisplayText = text || '📸 [Imagen adjunta para catalogación]';
  appendMessage(escapeHtml(userDisplayText), 'user');
  if (chatInput) chatInput.value = '';

  const imageToSend = currentAttachedImageBase64;
  currentAttachedImageBase64 = null;
  if (chatImgPreview) chatImgPreview.src = '';
  chatImgPreviewContainer?.classList.add('hidden');
  if (chatFileInput) chatFileInput.value = '';

  isAiResponding = true;
  const submitBtn = document.getElementById('chat-send-btn');
  if (submitBtn) submitBtn.disabled = true;

  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'message ai-msg';
  loadingDiv.textContent = 'Analizando y catalogando...';
  chatMessages?.appendChild(loadingDiv);

  try {
    const result = await callGeminiChat(text, imageToSend);
    if (chatMessages?.contains(loadingDiv)) chatMessages.removeChild(loadingDiv);

    if (result.action === 'CATALOG' && result.item) {
      const resItem = result.item;

      if (isItemDuplicate(resItem, library)) {
        appendMessage(`⚠️ La obra <strong>«${escapeHtml(resItem.title)}»</strong> ya existe en tu biblioteca.`, 'ai');
        showToast(`«${resItem.title}» ya está en tu colección.`, 'info');
        return;
      }

      if (!resItem.id) resItem.id = crypto.randomUUID();
      if (!resItem.createdAt) resItem.createdAt = new Date().toISOString().split('T')[0];
      if (!resItem.coverUrl) resItem.coverUrl = await fetchAutomaticCover(resItem);

      if (resItem.coverUrl) {
        cacheCoverLocally(resItem.id, resItem.coverUrl);
      }

      library.unshift(resItem);
      saveLibrary(renderActiveView);

      const safeTitle = escapeHtml(resItem.title);
      const safeReply = escapeHtml(result.replyMessage || '');
      appendMessage(`✅ <strong>${safeTitle}</strong> añadido con éxito.<br><small>${safeReply}</small>`, 'ai');
      showToast(`«${resItem.title}» agregado a tu biblioteca.`);
    } else {
      appendMessage(escapeHtml(result.replyMessage || ''), 'ai');
    }
  } catch (error) {
    if (chatMessages?.contains(loadingDiv)) chatMessages.removeChild(loadingDiv);
    appendMessage(`❌ <strong>Error:</strong> ${escapeHtml(error.message || 'Error al procesar.')}`, 'ai');
  } finally {
    isAiResponding = false;
    if (submitBtn) submitBtn.disabled = false;
  }
});

// ----------------------------------------------------------------------------
// 5. MOTOR DE FONDOS AMBIENTALES
// ----------------------------------------------------------------------------
function initBackgroundEngine() {
  const initialTheme = state.isBgAutoEnabled ? 'auto' : state.activeBgTheme;
  applyBackgroundTheme(initialTheme, state.isBgAutoEnabled);

  document.addEventListener('visibilitychange', () => {
    const videoEl = document.getElementById('bg-video');
    if (!videoEl) return;
    if (document.hidden) {
      videoEl.pause();
    } else if (state.activeBgTheme !== 'none' && state.activeBgTheme !== 'custom') {
      videoEl.play().catch(() => {});
    }
  });

  window.addEventListener('blur', () => {
    const videoEl = document.getElementById('bg-video');
    if (videoEl && state.activeBgTheme !== 'none' && state.activeBgTheme !== 'custom') {
      videoEl.pause();
    }
  });

  window.addEventListener('focus', () => {
    const videoEl = document.getElementById('bg-video');
    if (videoEl && state.activeBgTheme !== 'none' && state.activeBgTheme !== 'custom') {
      videoEl.play().catch(() => {});
    }
  });
}

// ----------------------------------------------------------------------------
// 6. SUSPENSIÓN DE GPU DURANTE SCROLL RÁPIDO
// ----------------------------------------------------------------------------
const mainScrollArea = document.querySelector('.main-content');
const bgVideoEl = document.getElementById('bg-video');
let scrollStopTimer = null;

mainScrollArea?.addEventListener('scroll', () => {
  if (!mainScrollArea.classList.contains('is-scrolling')) {
    mainScrollArea.classList.add('is-scrolling');
  }

  if (bgVideoEl && !bgVideoEl.paused && state.activeBgTheme !== 'none' && state.activeBgTheme !== 'custom') {
    bgVideoEl.pause();
  }

  clearTimeout(scrollStopTimer);
  scrollStopTimer = setTimeout(() => {
    mainScrollArea.classList.remove('is-scrolling');
    if (bgVideoEl && bgVideoEl.paused && state.activeBgTheme !== 'none' && state.activeBgTheme !== 'custom') {
      bgVideoEl.play().catch(() => {});
    }
  }, 120);
}, { passive: true });

// ----------------------------------------------------------------------------
// 7. GESTIÓN DE COLECCIONES PERSONALIZADAS
// ----------------------------------------------------------------------------
function initCustomCollectionsUI() {
  const createCollectionModal = document.getElementById('create-collection-modal');
  const inputNewCollectionName = document.getElementById('input-new-collection-name');
  const btnAddCollection = document.getElementById('btn-add-collection');
  const btnCloseCreateCollection = document.getElementById('btn-close-create-collection');
  const btnCancelCreateCollection = document.getElementById('btn-cancel-create-collection');
  const btnConfirmCreateCollection = document.getElementById('btn-confirm-create-collection');

  function handleCreateCollection() {
    const name = inputNewCollectionName?.value.trim();
    if (!name) {
      showToast('Escribe un nombre para la colección.', 'error');
      return;
    }

    const created = addCustomCollection(name);
    if (created) {
      showToast(`Colección "${name}" creada.`);
      renderSidebarCollections();
      createCollectionModal?.close();
      if (inputNewCollectionName) inputNewCollectionName.value = '';
    } else {
      showToast('Ya existe una colección con ese nombre.', 'error');
    }
  }

  btnAddCollection?.addEventListener('click', () => {
    if (inputNewCollectionName) inputNewCollectionName.value = '';
    createCollectionModal?.showModal();
    inputNewCollectionName?.focus();
    refreshLucide();
  });

  btnCloseCreateCollection?.addEventListener('click', () => createCollectionModal?.close());
  btnCancelCreateCollection?.addEventListener('click', () => createCollectionModal?.close());
  btnConfirmCreateCollection?.addEventListener('click', handleCreateCollection);

  inputNewCollectionName?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCreateCollection();
    }
  });
}

// ----------------------------------------------------------------------------
// 8. COLA DE DESCARGA SILENCIOSA DE PORTADAS
// ----------------------------------------------------------------------------
async function cacheMissingCovers() {
  const itemsToCache = library.filter(i => i.coverUrl && i.coverUrl.startsWith('http'));
  for (const item of itemsToCache) {
    await cacheCoverLocally(item.id, item.coverUrl);
    await new Promise(r => setTimeout(r, 200));
  }
}

// ----------------------------------------------------------------------------
// 9. GESTOR DE ATAJOS DE TECLADO GLOBALES (POWER-USER / OBSIDIAN STYLE)
// ----------------------------------------------------------------------------
function initGlobalKeyboardShortcuts() {
  window.addEventListener('keydown', (e) => {
    const isMod = e.ctrlKey || e.metaKey;
    const target = e.target;
    const isEditable = target && (
      target.tagName === 'INPUT' || 
      target.tagName === 'TEXTAREA' || 
      target.isContentEditable
    );

    // ESCAPE: Cierra cualquier modal abierto o desenfoca el buscador
    if (e.key === 'Escape') {
      const openDialogs = document.querySelectorAll('dialog[open]');
      if (openDialogs.length > 0) {
        e.preventDefault();
        openDialogs.forEach(d => d.close());
        return;
      }
      if (isEditable) {
        target.blur();
        return;
      }
    }

    if (isMod) {
      const key = e.key.toLowerCase();

      // Ctrl + K o Ctrl + F: Foco en la Barra de Búsqueda
      if (key === 'k' || key === 'f') {
        e.preventDefault();
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        }
        return;
      }

      // Ctrl + N: Modal de Nueva Obra manual
      if (key === 'n' && !e.shiftKey) {
        e.preventDefault();
        const manualModal = document.getElementById('manual-modal');
        if (manualModal && !manualModal.open) {
          manualModal.showModal();
          refreshLucide();
        }
        return;
      }

      // Ctrl + I: Ingesta Masiva / Notas
      if (key === 'i') {
        e.preventDefault();
        document.getElementById('btn-open-bulk')?.click();
        return;
      }

      // Ctrl + B o Ctrl + \: Alternar Barra Lateral Izquierda
      if (key === 'b' || e.key === '\\') {
        e.preventDefault();
        const isCollapsed = appLayout?.classList.contains('no-left-sidebar');
        if (isCollapsed) {
          document.getElementById('btn-expand-left')?.click();
        } else {
          document.getElementById('btn-collapse-left')?.click();
        }
        return;
      }

      // Ctrl + J: Alternar Barra Lateral Derecha (Asistente / Catálogo)
      if (key === 'j') {
        e.preventDefault();
        const isCollapsed = appLayout?.classList.contains('no-right-sidebar');
        if (isCollapsed) {
          document.getElementById('btn-expand-right')?.click();
        } else {
          document.getElementById('btn-collapse-right')?.click();
        }
        return;
      }

      // Ctrl + G: Ciclo de Cuadrículas (Normal ➔ Medio ➔ Compacto)
      if (key === 'g') {
        e.preventDefault();
        document.getElementById('btn-view-grid')?.click();
        return;
      }

      // Ctrl + L: Cambiar a Vista Lista
      if (key === 'l') {
        e.preventDefault();
        document.getElementById('btn-view-list')?.click();
        return;
      }

      // Ctrl + Shift + T: Alternar Modo Claro / Oscuro
      if (key === 't' && e.shiftKey) {
        e.preventDefault();
        document.getElementById('btn-toggle-theme')?.click();
        return;
      }

      // Ctrl + , (Coma): Abrir Configuración
      if (e.key === ',') {
        e.preventDefault();
        document.getElementById('btn-open-general-settings')?.click();
        return;
      }

      // Ctrl + Shift + W: Abrir Anuario Cultural
      if (key === 'w' && e.shiftKey) {
        e.preventDefault();
        document.getElementById('btn-open-wrap')?.click();
        return;
      }

      // Ctrl + 1 al 5: Navegación instantánea entre perspectivas
      if (!isEditable) {
        const perspectives = {
          '1': 'library',
          '2': 'timeline',
          '3': 'graph',
          '4': 'map',
          '5': 'stats'
        };

        if (perspectives[e.key]) {
          e.preventDefault();

          // Si pulsa Ctrl+1 (Biblioteca), resetea colecciones o wishlist
          if (perspectives[e.key] === 'library') {
            state.activeCollectionFilter = null;
            state.isWishlistFilterActive = false;
            document.getElementById('filter-wishlist')?.classList.remove('active');
            renderSidebarCollections();
          }

          state.currentActiveView = perspectives[e.key];
          updateNavTabs();
          renderActiveView();
        }
      }
    }
  });
}

// ----------------------------------------------------------------------------
// 10. ARRANQUE DEL SISTEMA CON INDEXEDDB
// ----------------------------------------------------------------------------
initVaultName();
initModals();
initViewsEvents();
initAtlasEvents();
initBackgroundEngine();
initCustomCollectionsUI();
initGlobalKeyboardShortcuts();
updateNavTabs();
updateFilterTabs();
updateGridToggleUI(state.currentViewMode);

// Inicializar textos y placeholders del Catálogo Rápido según la opción activa
const initialQuickType = document.querySelector('input[name="quick-type"]:checked')?.value || 'book';
updateQuickSearchTypeUI(initialQuickType);

checkYearlyWrapPrompt();
refreshLucide();

// Carga asíncrona de IndexedDB y renderizado fluido
initAteneaVault(() => {
  renderActiveView();
  refreshLucide();

  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => {
      sanitizeLibraryData();
      cacheMissingCovers();
    });
  } else {
    setTimeout(() => {
      sanitizeLibraryData();
      cacheMissingCovers();
    }, 1000);
  }
});