// ============================================================================
// SRC/MODALS/MODAL-BULK.JS - Centro de Ingesta Masiva y Tabla Staging
// - Parser híbrido (JSON estructurado y texto plano con heurística semántica)
// - Detección jerárquica de años anti-mutilación de títulos numéricos (1984, 2001)
// - Tabla previa interactiva con deduplicación y auto-completado asíncrono
// ============================================================================

import { 
  library, 
  saveLibrary, 
  isItemDuplicate, 
  refreshLucide, 
  showToast, 
  canonicalizeCountry 
} from '../state.js';
import { renderActiveView } from '../views.js';
import { fetchAutomaticCover } from '../api.js';
import { escapeHtml } from './utils.js';

let bulkStagingItems = [];

const UNIVERSAL_AI_PROMPT = `Actúa como un catalogador cultural estructurado. Analiza el siguiente texto, lista o imagen y extrae todas las obras en un arreglo JSON estricto y válido (sin explicaciones ni texto introductorio) con este formato exacto:

[
  {
    "type": "book" | "movie" | "music",
    "title": "Título de la obra",
    "creator": "Autor, Director o Artista",
    "releaseYear": 1990,
    "country": "País de origen",
    "tags": ["Género 1", "Género 2"],
    "status": "completed",
    "userRating": 0,
    "isWishlist": false
  }
]

Aquí está mi lista o notas:
`;

/**
 * Parser híbrido: procesa bloques JSON directos o listas de texto plano con inferencia semántica.
 * @param {string} rawText - Texto ingresado por el usuario.
 * @returns {Array<object>} Lista de obras candidatas para la tabla de staging.
 */
function parseBulkInputText(rawText = '') {
  const text = rawText.trim();
  if (!text) return [];

  // A) Bloque JSON estructurado
  if (text.startsWith('[') || text.includes('```json')) {
    try {
      const cleanJson = text.replace(/```json/gi, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleanJson);
      if (Array.isArray(parsed)) {
        return parsed.map(item => {
          const type = item.type || 'movie';
          const creator = item.creator || item.director || item.author || item.artist || '';
          return {
            id: crypto.randomUUID(),
            type: type,
            title: item.title || 'Sin Título',
            creator: creator,
            releaseYear: parseInt(item.releaseYear, 10) || new Date().getFullYear(),
            country: canonicalizeCountry(item.country || 'Internacional'),
            tags: Array.isArray(item.tags) ? item.tags : (item.tags ? [item.tags] : ['Colección']),
            status: item.status || 'completed',
            userRating: parseInt(item.userRating, 10) || 0,
            isWishlist: item.isWishlist === true,
            coverUrl: item.coverUrl || '',
            userNotes: item.userNotes || '',
            details: {
              director: type === 'movie' ? creator : '',
              author: type === 'book' ? creator : '',
              artist: type === 'music' ? creator : ''
            },
            selected: true
          };
        });
      }
    } catch (e) {
      console.warn('Fallo al parsear entrada JSON directa en Ingesta Masiva:', e);
    }
  }

  // B) Lista de texto plano con heurística anti-colisión de títulos numéricos
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 2);
  const items = [];

  lines.forEach(line => {
    let cleanLine = line.replace(/^[-*•\d.)\s]+/, '').trim();
    let type = 'book';
    if (/^(película|pelicula|movie|film|cine):/i.test(cleanLine)) {
      type = 'movie';
      cleanLine = cleanLine.replace(/^(película|pelicula|movie|film|cine):\s*/i, '');
    } else if (/^(música|musica|music|disco|álbum|album):/i.test(cleanLine)) {
      type = 'music';
      cleanLine = cleanLine.replace(/^(música|musica|music|disco|álbum|album):\s*/i, '');
    } else if (/^(libro|book|literatura):/i.test(cleanLine)) {
      type = 'book';
      cleanLine = cleanLine.replace(/^(libro|book|literatura):\s*/i, '');
    }

    let year = null;

    // Prioridad 1: Año explícito entre paréntesis para no romper títulos como "1984" o "2001"
    const parenYearMatch = cleanLine.match(/\(((?:18|19|20)\d{2})\)/);
    if (parenYearMatch) {
      year = parseInt(parenYearMatch[1], 10);
      cleanLine = cleanLine.replace(parenYearMatch[0], '').trim();
    } else {
      // Prioridad 2: Año suelto delimitado por fronteras de palabra
      const yearMatch = cleanLine.match(/\b((?:18|19|20)\d{2})\b/);
      if (yearMatch) {
        year = parseInt(yearMatch[1], 10);
        cleanLine = cleanLine.replace(yearMatch[0], '').replace(/[()]/g, '').trim();
      }
    }

    const parts = cleanLine.split(/[-–—,]/).map(p => p.trim()).filter(Boolean);
    const title = parts[0] || 'Sin Título';
    const creator = parts[1] || '';
    const country = parts[2] ? canonicalizeCountry(parts[2]) : 'Internacional';

    items.push({
      id: crypto.randomUUID(),
      type: type,
      title: title,
      creator: creator,
      releaseYear: year || new Date().getFullYear(),
      country: country,
      tags: [type === 'book' ? 'Literatura' : (type === 'movie' ? 'Cine' : 'Música')],
      status: 'completed',
      userRating: 0,
      isWishlist: false,
      coverUrl: '',
      userNotes: '',
      details: {
        director: type === 'movie' ? creator : '',
        author: type === 'book' ? creator : '',
        artist: type === 'music' ? creator : ''
      },
      selected: true
    });
  });

  return items;
}

/**
 * Renderiza la tabla staging editable con sanitización y detección de duplicados.
 */
function renderBulkStagingTable() {
  const stagingTableWrap = document.getElementById('bulk-staging-table-wrap');
  const selectedCountEl = document.getElementById('bulk-selected-count');
  const btnCommit = document.getElementById('btn-commit-bulk');
  if (!stagingTableWrap) return;

  if (bulkStagingItems.length === 0) {
    stagingTableWrap.innerHTML = `
      <div class="bulk-empty-staging">
        <i data-lucide="clipboard-list"></i>
        <span>Pega tu lista arriba o sube un archivo JSON para revisar y editar los datos antes de importar.</span>
      </div>
    `;
    if (selectedCountEl) selectedCountEl.textContent = '0 obras detectadas';
    if (btnCommit) btnCommit.disabled = true;
    refreshLucide();
    return;
  }

  const selectedCount = bulkStagingItems.filter(i => i.selected).length;
  if (selectedCountEl) selectedCountEl.textContent = `${selectedCount} de ${bulkStagingItems.length} seleccionadas`;
  if (btnCommit) btnCommit.disabled = selectedCount === 0;

  let tableHtml = `
    <table class="bulk-staging-table">
      <thead>
        <tr>
          <th style="width:36px; text-align:center;">
            <input type="checkbox" id="bulk-toggle-all" ${selectedCount === bulkStagingItems.length ? 'checked' : ''} />
          </th>
          <th style="width:90px;">Tipo</th>
          <th>Título</th>
          <th>Creador</th>
          <th style="width:75px;">Año</th>
          <th style="width:110px;">País</th>
          <th style="width:130px;">Etiquetas</th>
          <th style="width:105px; text-align:center;">Estado DB</th>
          <th style="width:36px;"></th>
        </tr>
      </thead>
      <tbody>
  `;

  bulkStagingItems.forEach((item, idx) => {
    const isDup = isItemDuplicate(item, library);
    const dupBadge = isDup 
      ? `<span class="dup-badge-pill warning" title="Ya existe una obra idéntica en tu biblioteca">⚠️ Existe</span>` 
      : `<span class="dup-badge-pill new">✨ Nueva</span>`;

    tableHtml += `
      <tr class="bulk-row ${isDup ? 'is-duplicate' : ''}" data-idx="${idx}">
        <td style="text-align:center;">
          <input type="checkbox" class="bulk-row-check" data-idx="${idx}" ${item.selected ? 'checked' : ''} />
        </td>
        <td>
          <select class="bulk-row-input bulk-row-type" data-idx="${idx}">
            <option value="book" ${item.type === 'book' ? 'selected' : ''}>📖 Libro</option>
            <option value="movie" ${item.type === 'movie' ? 'selected' : ''}>🎬 Cine</option>
            <option value="music" ${item.type === 'music' ? 'selected' : ''}>🎵 Música</option>
          </select>
        </td>
        <td>
          <input type="text" class="bulk-row-input bulk-row-title" data-idx="${idx}" value="${escapeHtml(item.title)}" />
        </td>
        <td>
          <input type="text" class="bulk-row-input bulk-row-creator" data-idx="${idx}" value="${escapeHtml(item.creator)}" />
        </td>
        <td>
          <input type="number" class="bulk-row-input bulk-row-year" data-idx="${idx}" value="${item.releaseYear ? escapeHtml(String(item.releaseYear)) : ''}" />
        </td>
        <td>
          <input type="text" class="bulk-row-input bulk-row-country" data-idx="${idx}" value="${escapeHtml(item.country || 'Internacional')}" />
        </td>
        <td>
          <input type="text" class="bulk-row-input bulk-row-tags" data-idx="${idx}" value="${escapeHtml((item.tags || []).join(', '))}" />
        </td>
        <td style="text-align:center;">${dupBadge}</td>
        <td style="text-align:center;">
          <button type="button" class="btn-bulk-remove-row" data-idx="${idx}" title="Quitar de este lote">✕</button>
        </td>
      </tr>
    `;
  });

  tableHtml += `</tbody></table>`;
  stagingTableWrap.innerHTML = tableHtml;
  refreshLucide();
}

/**
 * Inicializa los controladores de eventos para el modal de Ingesta Masiva.
 */
export function initBulkModalEvents() {
  const bulkIngestModal = document.getElementById('bulk-ingest-modal');
  const bulkTextInput = document.getElementById('bulk-text-input');
  const stagingTableWrap = document.getElementById('bulk-staging-table-wrap');
  const btnCopyPrompt = document.getElementById('btn-copy-universal-prompt');
  const btnParse = document.getElementById('btn-parse-bulk');
  const btnCommit = document.getElementById('btn-commit-bulk');
  const bulkJsonFileInput = document.getElementById('bulk-json-file-input');

  document.getElementById('btn-open-bulk')?.addEventListener('click', () => {
    if (bulkTextInput) bulkTextInput.value = '';
    bulkStagingItems = [];
    renderBulkStagingTable();
    bulkIngestModal?.showModal();
    refreshLucide();
  });

  document.getElementById('btn-close-bulk')?.addEventListener('click', () => bulkIngestModal?.close());
  document.getElementById('btn-cancel-bulk')?.addEventListener('click', () => bulkIngestModal?.close());

  btnCopyPrompt?.addEventListener('click', () => {
    navigator.clipboard.writeText(UNIVERSAL_AI_PROMPT).then(() => {
      showToast('Prompt universal copiado al portapapeles.');
    });
  });

  bulkJsonFileInput?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const rawText = event.target.result;
      if (bulkTextInput) bulkTextInput.value = rawText;
      bulkStagingItems = parseBulkInputText(rawText);
      renderBulkStagingTable();
      if (bulkStagingItems.length > 0) {
        showToast(`Se cargaron ${bulkStagingItems.length} obra(s) del JSON.`);
      } else {
        showToast('El archivo JSON no contenía un formato de obras válido.', 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  btnParse?.addEventListener('click', () => {
    const rawText = bulkTextInput?.value || '';
    if (!rawText.trim()) return showToast('Pega texto o un JSON antes de analizar.', 'error');

    bulkStagingItems = parseBulkInputText(rawText);
    renderBulkStagingTable();

    if (bulkStagingItems.length > 0) {
      showToast(`Se detectaron ${bulkStagingItems.length} obra(s) para revisión.`);
    } else {
      showToast('No se pudieron extraer obras del texto proporcionado.', 'error');
    }
  });

  // Delegación de eventos en la tabla de staging
  if (stagingTableWrap && !stagingTableWrap.dataset.delegated) {
    stagingTableWrap.dataset.delegated = 'true';

    stagingTableWrap.addEventListener('change', (e) => {
      if (e.target.id === 'bulk-toggle-all') {
        const checked = e.target.checked;
        bulkStagingItems.forEach(i => i.selected = checked);
        renderBulkStagingTable();
        return;
      }
      if (e.target.classList.contains('bulk-row-check')) {
        const idx = parseInt(e.target.dataset.idx, 10);
        if (bulkStagingItems[idx]) {
          bulkStagingItems[idx].selected = e.target.checked;
          renderBulkStagingTable();
        }
        return;
      }
      if (e.target.classList.contains('bulk-row-type')) {
        const idx = parseInt(e.target.dataset.idx, 10);
        if (bulkStagingItems[idx]) bulkStagingItems[idx].type = e.target.value;
        return;
      }
      if (e.target.classList.contains('bulk-row-country')) {
        const idx = parseInt(e.target.dataset.idx, 10);
        if (bulkStagingItems[idx]) {
          bulkStagingItems[idx].country = canonicalizeCountry(e.target.value);
          e.target.value = bulkStagingItems[idx].country;
        }
        return;
      }
    });

    stagingTableWrap.addEventListener('input', (e) => {
      const idx = parseInt(e.target.dataset.idx, 10);
      if (isNaN(idx) || !bulkStagingItems[idx]) return;

      if (e.target.classList.contains('bulk-row-title')) {
        bulkStagingItems[idx].title = e.target.value.trim();
      } else if (e.target.classList.contains('bulk-row-creator')) {
        bulkStagingItems[idx].creator = e.target.value.trim();
      } else if (e.target.classList.contains('bulk-row-year')) {
        bulkStagingItems[idx].releaseYear = parseInt(e.target.value, 10) || null;
      } else if (e.target.classList.contains('bulk-row-tags')) {
        bulkStagingItems[idx].tags = e.target.value.split(',').map(t => t.trim()).filter(Boolean);
      }
    });

    stagingTableWrap.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-bulk-remove-row');
      if (btn) {
        const idx = parseInt(btn.dataset.idx, 10);
        if (!isNaN(idx) && bulkStagingItems[idx]) {
          bulkStagingItems.splice(idx, 1);
          renderBulkStagingTable();
        }
      }
    });
  }

  // Confirmar importación del lote seleccionado
  btnCommit?.addEventListener('click', () => {
    const toImport = bulkStagingItems.filter(i => i.selected);
    if (toImport.length === 0) return showToast('Selecciona al menos una obra.', 'error');

    let importedCount = 0;
    let skippedDuplicates = 0;
    const itemsNeedingCovers = [];

    toImport.forEach(item => {
      if (isItemDuplicate(item, library)) {
        skippedDuplicates++;
        return;
      }

      const creator = item.creator || '';
      const newItem = {
        id: crypto.randomUUID(),
        type: item.type,
        title: item.title,
        originalTitle: '',
        status: item.status || 'completed',
        isWishlist: item.isWishlist || false,
        coverUrl: item.coverUrl || '',
        releaseYear: item.releaseYear,
        country: canonicalizeCountry(item.country),
        tags: item.tags || [],
        creator: creator,
        details: {
          director: item.type === 'movie' ? creator : '',
          author: item.type === 'book' ? creator : '',
          artist: item.type === 'music' ? creator : ''
        },
        userRating: item.userRating || 0,
        userNotes: item.userNotes || '',
        dateStarted: '',
        dateFinished: item.status === 'completed' ? new Date().toISOString().split('T')[0] : '',
        createdAt: new Date().toISOString().split('T')[0]
      };

      if (!newItem.coverUrl) itemsNeedingCovers.push(newItem);
      library.unshift(newItem);
      importedCount++;
    });

    saveLibrary(renderActiveView);
    if (bulkTextInput) bulkTextInput.value = '';
    bulkStagingItems = [];
    renderBulkStagingTable();
    bulkIngestModal?.close();

    let msg = `Se importaron ${importedCount} obras a tu biblioteca.`;
    if (skippedDuplicates > 0) msg += ` Se omitieron ${skippedDuplicates} duplicadas.`;
    showToast(msg);

    // Descarga asíncrona de portadas respetando rate limits
    if (itemsNeedingCovers.length > 0) {
      (async () => {
        let updatedAny = false;
        for (const it of itemsNeedingCovers) {
          try {
            const url = await fetchAutomaticCover(it);
            if (url) {
              it.coverUrl = url;
              updatedAny = true;
            }
          } catch (err) {
            console.warn('Error al buscar carátula en lote:', err);
          }
          await new Promise(r => setTimeout(r, 350));
        }
        if (updatedAny) saveLibrary(renderActiveView);
      })();
    }
  });
}