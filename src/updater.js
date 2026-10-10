// ============================================================================
// UPDATER.JS - Motor de Actualizaciones Seguras (Vanilla JS nativo Tauri v2)
// - Integración con diseño nativo de Atenea (modal modal-md + modal-box)
// - Diálogo centrado, tema oscuro y barra de progreso fluida
// - Blindaje anti-cierre accidental con Escape durante la descarga
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
 * Crea o retorna el elemento <dialog> del actualizador integrado en el tema de Atenea.
 * @returns {HTMLDialogElement}
 */
function getOrCreateUpdaterModal() {
  let modal = document.getElementById('modal-updater');
  if (modal) return modal;

  modal = document.createElement('dialog');
  modal.id = 'modal-updater';
  modal.className = 'modal modal-md';

  modal.innerHTML = `
    <div class="modal-box updater-modal-box">
      <button class="modal-close-x" id="btn-updater-close" title="Cerrar">✕</button>
      
      <div class="updater-header">
        <div class="updater-title-group">
          <div class="updater-icon-badge">
            <i data-lucide="sparkles"></i>
          </div>
          <div>
            <h3 class="updater-title" style="margin:0; font-size:1.15rem; font-weight:600;">Nueva versión disponible</h3>
            <p class="updater-version-tag" id="updater-version-text" style="margin:2px 0 0 0; font-size:0.8rem; color:#a78bfa; font-weight:500;">Atenea v0.0.0</p>
          </div>
        </div>
      </div>

      <div class="updater-body" style="margin: 14px 0 6px 0; display:flex; flex-direction:column; gap:10px;">
        <h4 class="updater-notes-label" style="margin:0; font-size:0.8rem; font-weight:600; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em;">Novedades y mejoras:</h4>
        <div class="updater-changelog-box" id="updater-changelog">
          <p class="updater-empty-notes">Mejoras de rendimiento, estabilidad y nuevas funciones.</p>
        </div>

        <div class="updater-progress-container hidden" id="updater-progress-wrap" style="margin-top:6px;">
          <div class="updater-progress-labels" style="display:flex; justify-content:space-between; font-size:0.78rem; color:var(--text-muted); margin-bottom:6px;">
            <span id="updater-progress-status">Descargando actualización...</span>
            <span id="updater-progress-percent">0%</span>
          </div>
          <div class="updater-progress-track" style="width:100%; height:7px; background:rgba(255,255,255,0.08); border-radius:999px; overflow:hidden;">
            <div class="updater-progress-bar" id="updater-progress-bar" style="width:0%; height:100%; background:linear-gradient(90deg, #7c3aed, #a855f7); border-radius:999px; transition:width 0.2s ease;"></div>
          </div>
        </div>
      </div>

      <div class="modal-actions" style="margin-top:16px; display:flex; justify-content:flex-end; gap:10px;">
        <button type="button" class="btn-secondary" id="btn-updater-later">Más tarde</button>
        <button type="button" class="btn-primary" id="btn-updater-action" style="display:inline-flex; align-items:center; gap:8px;">
          <i data-lucide="download"></i>
          <span>Descargar e instalar</span>
        </button>
      </div>
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

  // Bloqueo de cierre con Escape durante la descarga
  modal.addEventListener('cancel', (e) => {
    if (isDownloading) {
      e.preventDefault();
    }
  });

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

  // 1. Si ya terminó la descarga, reiniciar la aplicación
  if (btnAction?.dataset.state === 'restart') {
    try {
      btnAction.disabled = true;
      btnAction.innerHTML = `<i data-lucide="loader-2" class="spin"></i> <span>Reiniciando...</span>`;
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

  // 2. Descargar e instalar el paquete firmado
  try {
    isDownloading = true;
    if (btnLater) btnLater.disabled = true;
    if (btnClose) btnClose.style.display = 'none';

    btnAction.disabled = true;
    btnAction.innerHTML = `<i data-lucide="loader-2" class="spin"></i> <span>Instalando...</span>`;
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

    // 3. Listo para reiniciar
    isDownloading = false;
    btnAction.disabled = false;
    btnAction.dataset.state = 'restart';
    btnAction.classList.remove('btn-primary');
    btnAction.classList.add('btn-confirm-restart');
    btnAction.style.background = '#10b981';
    btnAction.style.color = '#ffffff';
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