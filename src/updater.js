// ============================================================================
// UPDATER.JS - Motor de Actualizaciones Seguras (Vanilla JS nativo Tauri v2)
// - Cero dependencias de Node / 100% compatible con ESM nativo
// - Acceso directo a window.__TAURI__.updater y window.__TAURI__.process
// ============================================================================

import { showToast, refreshLucide } from './state.js';
import { escapeHtml } from './modals.js';

let activeUpdate = null;
let isDownloading = false;

/**
 * Acceso seguro a las APIs globales de Tauri v2
 */
function getTauriUpdater() {
  return window.__TAURI__?.updater || null;
}

function getTauriProcess() {
  return window.__TAURI__?.process || null;
}

/**
 * Crea o retorna el elemento <dialog> del actualizador en el DOM.
 * @returns {HTMLDialogElement}
 */
function getOrCreateUpdaterModal() {
  let modal = document.getElementById('modal-updater');
  if (modal) return modal;

  modal = document.createElement('dialog');
  modal.id = 'modal-updater';
  modal.className = 'atenea-dialog modal-updater';

  modal.innerHTML = `
    <div class="updater-card">
      <header class="updater-header">
        <div class="updater-title-group">
          <div class="updater-icon-badge">
            <i data-lucide="sparkles"></i>
          </div>
          <div>
            <h2 class="updater-title">Nueva versión disponible</h2>
            <p class="updater-version-tag" id="updater-version-text">Atenea v0.0.0</p>
          </div>
        </div>
        <button type="button" class="modal-close-btn" id="btn-updater-close" title="Cerrar">
          <i data-lucide="x"></i>
        </button>
      </header>

      <section class="updater-body">
        <h4 class="updater-notes-label">Novedades y mejoras:</h4>
        <div class="updater-changelog-box" id="updater-changelog">
          <p class="updater-empty-notes">Mejoras de rendimiento, estabilidad y nuevas funciones.</p>
        </div>

        <div class="updater-progress-container hidden" id="updater-progress-wrap">
          <div class="updater-progress-labels">
            <span id="updater-progress-status">Descargando actualización...</span>
            <span id="updater-progress-percent">0%</span>
          </div>
          <div class="updater-progress-track">
            <div class="updater-progress-bar" id="updater-progress-bar" style="width: 0%;"></div>
          </div>
        </div>
      </section>

      <footer class="updater-footer">
        <button type="button" class="btn-secondary" id="btn-updater-later">Más tarde</button>
        <button type="button" class="btn-primary" id="btn-updater-action">
          <i data-lucide="download"></i>
          <span>Descargar e instalar</span>
        </button>
      </footer>
    </div>
  `;

  document.body.appendChild(modal);

  const btnClose = modal.querySelector('#btn-updater-close');
  const btnLater = modal.querySelector('#btn-updater-later');
  const btnAction = modal.querySelector('#btn-updater-action');

  const handleDismiss = () => {
    if (!isDownloading) {
      modal.close();
    }
  };

  btnClose?.addEventListener('click', handleDismiss);
  btnLater?.addEventListener('click', handleDismiss);
  btnAction?.addEventListener('click', handleUpdaterAction);

  return modal;
}

/**
 * Controla la descarga e instalación o el reinicio de Atenea.
 */
async function handleUpdaterAction() {
  if (!activeUpdate) return;

  const modal = getOrCreateUpdaterModal();
  const btnAction = modal.querySelector('#btn-updater-action');
  const btnLater = modal.querySelector('#btn-updater-later');
  const btnClose = modal.querySelector('#btn-updater-close');
  const progressWrap = modal.querySelector('#updater-progress-wrap');
  const progressBar = modal.querySelector('#updater-progress-bar');
  const progressPercent = modal.querySelector('#updater-progress-percent');
  const progressStatus = modal.querySelector('#updater-progress-status');

  // Si ya terminó de descargar, reiniciar
  if (btnAction?.dataset.state === 'restart') {
    try {
      btnAction.disabled = true;
      btnAction.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Reiniciando...`;
      refreshLucide();

      const proc = getTauriProcess();
      if (proc?.relaunch) {
        await proc.relaunch();
      } else {
        window.location.reload();
      }
    } catch (err) {
      showToast(`Error al reiniciar: ${err.message}`, 'error');
      btnAction.disabled = false;
    }
    return;
  }

  // Iniciar descarga e instalación
  try {
    isDownloading = true;
    if (btnLater) btnLater.disabled = true;
    if (btnClose) btnClose.style.display = 'none';

    btnAction.disabled = true;
    btnAction.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Instalando...`;
    progressWrap?.classList.remove('hidden');
    refreshLucide();

    let downloadedBytes = 0;
    let totalBytes = 0;

    await activeUpdate.downloadAndInstall((event) => {
      switch (event.event) {
        case 'Started':
          totalBytes = event.data?.contentLength || 0;
          if (progressStatus) progressStatus.textContent = 'Iniciando descarga segura...';
          break;

        case 'Progress':
          downloadedBytes += (event.data?.chunkLength || 0);
          if (totalBytes > 0) {
            const pct = Math.min(100, Math.round((downloadedBytes / totalBytes) * 100));
            if (progressBar) progressBar.style.width = `${pct}%`;
            if (progressPercent) progressPercent.textContent = `${pct}%`;
            if (progressStatus) {
              const mbDownloaded = (downloadedBytes / (1024 * 1024)).toFixed(1);
              const mbTotal = (totalBytes / (1024 * 1024)).toFixed(1);
              progressStatus.textContent = `Descargando: ${mbDownloaded} MB de ${mbTotal} MB`;
            }
          }
          break;

        case 'Finished':
          if (progressBar) progressBar.style.width = '100%';
          if (progressPercent) progressPercent.textContent = '100%';
          if (progressStatus) progressStatus.textContent = 'Instalación completada.';
          break;
      }
    });

    isDownloading = false;
    btnAction.disabled = false;
    btnAction.dataset.state = 'restart';
    btnAction.classList.remove('btn-primary');
    btnAction.classList.add('btn-confirm-restart');
    btnAction.innerHTML = `<i data-lucide="rotate-cw"></i> <span>Reiniciar Atenea</span>`;
    showToast('Actualización lista. Reinicia para aplicar los cambios.', 'success');
    refreshLucide();

  } catch (err) {
    isDownloading = false;
    if (btnLater) btnLater.disabled = false;
    if (btnClose) btnClose.style.display = 'block';
    if (btnAction) {
      btnAction.disabled = false;
      btnAction.innerHTML = `<i data-lucide="download"></i> <span>Reintentar</span>`;
    }
    showToast(`Error durante la actualización: ${err.message || err}`, 'error');
    refreshLucide();
  }
}

/**
 * Consulta si existen actualizaciones disponibles en GitHub Releases.
 * @param {boolean} isManual
 */
export async function checkForUpdates(isManual = false) {
  try {
    const updater = getTauriUpdater();
    if (!updater?.check) {
      if (isManual) showToast('El actualizador nativo no está disponible en este entorno.', 'info');
      return;
    }

    if (isManual) {
      showToast('Buscando actualizaciones en GitHub...', 'info');
    }

    const update = await updater.check();

    if (!update) {
      if (isManual) {
        showToast('Atenea ya está en la versión más reciente.', 'success');
      }
      return;
    }

    activeUpdate = update;

    const modal = getOrCreateUpdaterModal();
    const versionTag = modal.querySelector('#updater-version-text');
    const changelogBox = modal.querySelector('#updater-changelog');

    if (versionTag) {
      versionTag.textContent = `Versión ${update.version}`;
    }

    if (changelogBox) {
      if (update.body && update.body.trim().length > 0) {
        const formattedNotes = escapeHtml(update.body)
          .split('\n')
          .filter(line => line.trim().length > 0)
          .map(line => `<p>${line.startsWith('-') || line.startsWith('*') ? '• ' + line.substring(1).trim() : line}</p>`)
          .join('');
        changelogBox.innerHTML = formattedNotes;
      } else {
        changelogBox.innerHTML = '<p class="updater-empty-notes">Mejoras de rendimiento, estabilidad y nuevas funciones.</p>';
      }
    }

    modal.showModal();
    refreshLucide();

  } catch (err) {
    if (isManual) {
      showToast(`No se pudo verificar la actualización: ${err.message || err}`, 'error');
    } else {
      console.warn('[Atenea Updater] Comprobación omitida o sin conexión:', err);
    }
  }
}

/**
 * Inicia la comprobación automática tras un tiempo de cortesía en el arranque.
 * @param {number} delayMs 
 */
export function initAutoUpdater(delayMs = 4000) {
  setTimeout(() => {
    checkForUpdates(false);
  }, delayMs);
}