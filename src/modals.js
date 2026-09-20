// ============================================================================
// SRC/MODALS.JS - Barrel Module (Punto de Entrada Unificado)
// Re-exporta la API pública hacia views.js, atlas.js y main.js con 0 regresiones.
// ============================================================================

// 1. Utilidades y Sanitización
export { escapeHtml } from './modals/utils.js';

// 2. Ficha Técnica Editorial y Multimedia
export { 
  openDetailModal, 
  updateDetailStatusUI, 
  setTagFilter, 
  openStreamingHubModal 
} from './modals/modal-detail.js';

// 3. Selector Panorámico Calibre
export { openCalibreResultsModal } from './modals/modal-calibre.js';

// 4. El Anuario Cultural (Wrap Anual)
export { 
  openWrapModal, 
  checkYearlyWrapPrompt 
} from './modals/modal-wrap.js';

// 5. Configuración y Bóveda
export { 
  VAULT_NAME_STORAGE, 
  updateAppTitle, 
  initVaultName 
} from './modals/modal-settings.js';

// 6. Modales Secundarios (Portadas, Eliminación e Inspector de Día)
export { 
  openCoverModal, 
  openDeleteModal, 
  openDayInspectorModal 
} from './modals/modal-secondary.js';

// ============================================================================
// INICIALIZADOR MAESTRO DE EVENTOS
// ============================================================================
import { initDetailModalEvents } from './modals/modal-detail.js';
import { initCriticEvents } from './modals/modal-critic.js';
import { initCalibreModalEvents } from './modals/modal-calibre.js';
import { initWrapModalEvents } from './modals/modal-wrap.js';
import { initBulkModalEvents } from './modals/modal-bulk.js';
import { initBackupEvents } from './modals/backup-services.js';
import { initSettingsEvents } from './modals/modal-settings.js';
import { initSecondaryModalEvents } from './modals/modal-secondary.js';

let modalsInitialized = false;

/**
 * Inicializador maestro de eventos de todos los submódulos.
 * Protegido contra ejecuciones duplicadas y fugas de memoria.
 */
export function initModals() {
  if (modalsInitialized) return;
  modalsInitialized = true;

  initDetailModalEvents();
  initCriticEvents();
  initCalibreModalEvents();
  initWrapModalEvents();
  initBulkModalEvents();
  initBackupEvents();
  initSettingsEvents();
  initSecondaryModalEvents();
}