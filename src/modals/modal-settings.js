// ============================================================================
// SRC/MODALS/MODAL-SETTINGS.JS - Centro de Configuración Unificado y Fondos
// ============================================================================

import { 
  state, 
  refreshLucide, 
  showToast, 
  OMDB_KEY_STORAGE, 
  DISCOGS_TOKEN_STORAGE, 
  API_KEY_STORAGE, 
  BG_PRESETS, 
  applyBackgroundTheme, 
  detectSeasonByMonth, 
  saveCustomBackgroundBlob, 
  getCustomBackgroundBlob, 
  deleteCustomBackgroundBlob 
} from '../state.js';

export const VAULT_NAME_STORAGE = 'atenea_vault_name';

/**
 * Actualiza dinámicamente el nombre de la bóveda en la barra lateral y el título de ventana.
 * @param {string} name - Nombre asignado al espacio cultural.
 */
export function updateAppTitle(name) {
  const sidebarNameEl = document.getElementById('sidebar-vault-name');
  if (sidebarNameEl) sidebarNameEl.textContent = name;
  document.title = name ? `Atenea — ${name}` : 'Atenea';
}

/**
 * Verifica si existe un nombre configurado en localStorage al arrancar la app.
 * Si es la primera vez, despliega el modal de bienvenida.
 */
export function initVaultName() {
  const savedName = localStorage.getItem(VAULT_NAME_STORAGE);
  if (!savedName) {
    document.getElementById('welcome-modal')?.showModal();
    refreshLucide();
  } else {
    updateAppTitle(savedName);
  }
}

/**
 * Sincroniza visualmente los estados de la pestaña de Fondos (switch automático,
 * tarjetas de presets y detección de imagen en IndexedDB).
 */
async function syncAmbientSettingsUI() {
  const toggleBgAuto = document.getElementById('toggle-bg-auto');
  const customBgStatusText = document.getElementById('custom-bg-status-text');
  const btnUseCustomBg = document.getElementById('btn-use-custom-bg');
  const btnDeleteCustomBg = document.getElementById('btn-delete-custom-bg');

  if (toggleBgAuto) {
    toggleBgAuto.checked = state.isBgAutoEnabled;
  }

  const activeTheme = state.isBgAutoEnabled ? detectSeasonByMonth() : state.activeBgTheme;

  document.querySelectorAll('.ambient-card').forEach(card => {
    const preset = card.dataset.preset;
    card.classList.toggle('active', preset === activeTheme);
  });

  const customBlob = await getCustomBackgroundBlob();
  if (customBlob) {
    if (customBgStatusText) {
      customBgStatusText.textContent = `Imagen guardada (${(customBlob.size / (1024 * 1024)).toFixed(1)} MB).`;
    }
    if (btnUseCustomBg) btnUseCustomBg.style.display = 'inline-flex';
    if (btnDeleteCustomBg) btnDeleteCustomBg.style.display = 'inline-flex';
  } else {
    if (customBgStatusText) customBgStatusText.textContent = 'Sin imagen personalizada guardada.';
    if (btnUseCustomBg) btnUseCustomBg.style.display = 'none';
    if (btnDeleteCustomBg) btnDeleteCustomBg.style.display = 'none';
  }

  refreshLucide();
}

/**
 * Conmuta entre las subpestañas del modal de Configuración.
 * @param {'general'|'ambient'|'api'|'backup'} tab
 */
function activateSettingsSubTab(tab) {
  const btnGen = document.getElementById('btn-settab-general');
  const btnAmb = document.getElementById('btn-settab-ambient');
  const btnApi = document.getElementById('btn-settab-api');
  const btnBak = document.getElementById('btn-settab-backup');

  const paneGen = document.getElementById('pane-settings-general');
  const paneAmb = document.getElementById('pane-settings-ambient');
  const paneApi = document.getElementById('pane-settings-api');
  const paneBak = document.getElementById('pane-settings-backup');

  btnGen?.classList.toggle('active', tab === 'general');
  btnAmb?.classList.toggle('active', tab === 'ambient');
  btnApi?.classList.toggle('active', tab === 'api');
  btnBak?.classList.toggle('active', tab === 'backup');

  paneGen?.classList.toggle('active', tab === 'general');
  paneAmb?.classList.toggle('active', tab === 'ambient');
  paneApi?.classList.toggle('active', tab === 'api');
  paneBak?.classList.toggle('active', tab === 'backup');

  if (tab === 'ambient') {
    syncAmbientSettingsUI();
  }

  refreshLucide();
}

/**
 * Inicializa todos los controladores de eventos del Centro de Configuración.
 */
export function initSettingsEvents() {
  const generalSettingsModal = document.getElementById('general-settings-modal');
  const generalVaultInput = document.getElementById('general-vault-input');
  const geminiKeyInput = document.getElementById('gemini-key-input');
  const omdbKeyInput = document.getElementById('omdb-key-input');
  const discogsTokenInput = document.getElementById('discogs-token-input');
  const toggleBgAuto = document.getElementById('toggle-bg-auto');
  const inputCustomBgFile = document.getElementById('input-custom-bg-file');
  const btnUseCustomBg = document.getElementById('btn-use-custom-bg');
  const btnDeleteCustomBg = document.getElementById('btn-delete-custom-bg');

  // Abrir modal y cargar valores guardados
  document.getElementById('btn-open-general-settings')?.addEventListener('click', () => {
    if (generalVaultInput) generalVaultInput.value = localStorage.getItem(VAULT_NAME_STORAGE) || 'Mi mundo';
    if (geminiKeyInput) geminiKeyInput.value = localStorage.getItem(API_KEY_STORAGE) || '';
    if (omdbKeyInput) omdbKeyInput.value = localStorage.getItem(OMDB_KEY_STORAGE) || '';
    if (discogsTokenInput) discogsTokenInput.value = localStorage.getItem(DISCOGS_TOKEN_STORAGE) || '';

    activateSettingsSubTab('general');
    generalSettingsModal?.showModal();
    refreshLucide();
  });

  document.getElementById('btn-close-general-settings')?.addEventListener('click', () => {
    generalSettingsModal?.close();
  });

  // Navegación de subpestañas
  document.getElementById('btn-settab-general')?.addEventListener('click', () => activateSettingsSubTab('general'));
  document.getElementById('btn-settab-ambient')?.addEventListener('click', () => activateSettingsSubTab('ambient'));
  document.getElementById('btn-settab-api')?.addEventListener('click', () => activateSettingsSubTab('api'));
  document.getElementById('btn-settab-backup')?.addEventListener('click', () => activateSettingsSubTab('backup'));

  // Guardar nombre del espacio
  document.getElementById('btn-save-general-settings')?.addEventListener('click', () => {
    const name = generalVaultInput?.value.trim() || 'Mi mundo';
    localStorage.setItem(VAULT_NAME_STORAGE, name);
    updateAppTitle(name);
    showToast('Nombre actualizado con éxito.');
  });

  // Guardar API keys y tokens
  document.getElementById('btn-save-settings')?.addEventListener('click', () => {
    if (geminiKeyInput) localStorage.setItem(API_KEY_STORAGE, geminiKeyInput.value.trim());
    if (omdbKeyInput) localStorage.setItem(OMDB_KEY_STORAGE, omdbKeyInput.value.trim());
    if (discogsTokenInput) localStorage.setItem(DISCOGS_TOKEN_STORAGE, discogsTokenInput.value.trim());
    showToast('Claves y tokens guardados con éxito.');
  });

  // Toggle de modo automático por estación
  toggleBgAuto?.addEventListener('change', async (e) => {
    const isAuto = e.target.checked;
    if (isAuto) {
      await applyBackgroundTheme('auto', true);
      showToast('Detección climática automática activada.');
    } else {
      await applyBackgroundTheme(state.activeBgTheme || 'winter', false);
      showToast('Modo manual fijado.');
    }
    syncAmbientSettingsUI();
  });

  // Selección de preset ambiental en bucle
  document.querySelectorAll('.ambient-card').forEach(card => {
    card.addEventListener('click', async () => {
      const preset = card.dataset.preset;
      if (toggleBgAuto) toggleBgAuto.checked = false;
      await applyBackgroundTheme(preset, false);
      syncAmbientSettingsUI();
      const label = BG_PRESETS[preset]?.label || preset;
      showToast(`Ambiente aplicado: ${label}`);
    });
  });

  // Subir imagen personalizada a IndexedDB (0% GPU)
  inputCustomBgFile?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.includes('image')) {
      return showToast('Por favor selecciona un archivo de imagen válido (.jpg, .png, .webp).', 'error');
    }

    const ok = await saveCustomBackgroundBlob(file);
    if (ok) {
      if (toggleBgAuto) toggleBgAuto.checked = false;
      await applyBackgroundTheme('custom', false);
      syncAmbientSettingsUI();
      showToast(`Imagen personalizada guardada (${(file.size / (1024 * 1024)).toFixed(1)} MB).`);
    } else {
      showToast('Error al guardar la imagen en la base de datos interna.', 'error');
    }
    e.target.value = '';
  });

  btnUseCustomBg?.addEventListener('click', async () => {
    if (toggleBgAuto) toggleBgAuto.checked = false;
    await applyBackgroundTheme('custom', false);
    syncAmbientSettingsUI();
    showToast('Imagen personalizada aplicada.');
  });

  btnDeleteCustomBg?.addEventListener('click', async () => {
    await deleteCustomBackgroundBlob();
    await applyBackgroundTheme('auto', true);
    syncAmbientSettingsUI();
    showToast('Imagen personalizada eliminada. Volviendo a modo automático.', 'info');
  });
}