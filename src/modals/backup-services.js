// ============================================================================
// SRC/MODALS/BACKUP-SERVICES.JS - Exportadores e Importadores
// (Bóveda Completa .atenea, Obsidian ZIP, Zotero BibTeX, CSV y JSON Universal)
// - Empaquetado completo de base de datos + colecciones + carátulas Blob (IndexedDB)
// - Claves de citación normalizadas en ASCII puro para compatibilidad con LaTeX/Zotero
// - Autómata finito para importación de CSV con comillas escapadas y saltos de línea
// ============================================================================

import { 
  library, 
  saveLibrary, 
  customCollections,
  saveCustomCollections,
  showToast, 
  isItemDuplicate, 
  canonicalizeCountry 
} from '../state.js';
import { renderActiveView, renderSidebarCollections } from '../views.js';
import { downloadBlob, parseCSVLine } from './utils.js';

const IDB_NAME = 'AteneaVaultDB';
const IDB_VERSION = 2;
const STORE_COVERS = 'cover_assets';

/**
 * Abre de forma segura el almacén de carátulas en IndexedDB.
 * @param {'readonly'|'readwrite'} mode 
 * @returns {Promise<{db: IDBDatabase, tx: IDBTransaction, store: IDBObjectStore}|null>}
 */
function openCoversStore(mode = 'readonly') {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_COVERS)) {
        return resolve(null);
      }
      const tx = db.transaction(STORE_COVERS, mode);
      const store = tx.objectStore(STORE_COVERS);
      resolve({ db, tx, store });
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Extrae todas las carátulas en formato Blob almacenadas en IndexedDB.
 * @returns {Promise<Array<{id: string, blob: Blob}>>}
 */
async function getAllCachedCovers() {
  try {
    const handle = await openCoversStore('readonly');
    if (!handle) return [];
    const { store } = handle;

    return new Promise((resolve) => {
      const covers = [];
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          if (cursor.value instanceof Blob) {
            covers.push({ id: String(cursor.key), blob: cursor.value });
          }
          cursor.continue();
        } else {
          resolve(covers);
        }
      };
      cursorReq.onerror = () => resolve([]);
    });
  } catch (err) {
    console.warn('No se pudieron leer las carátulas de IndexedDB:', err);
    return [];
  }
}

/**
 * Guarda un archivo Blob de carátula en IndexedDB bajo su UUID.
 * @param {string} itemId 
 * @param {Blob} blob 
 * @returns {Promise<boolean>}
 */
async function saveCoverBlobToIDB(itemId, blob) {
  if (!itemId || !(blob instanceof Blob)) return false;
  try {
    const handle = await openCoversStore('readwrite');
    if (!handle) return false;
    const { store } = handle;

    return new Promise((resolve) => {
      const putReq = store.put(blob, itemId);
      putReq.onsuccess = () => resolve(true);
      putReq.onerror = () => resolve(false);
    });
  } catch (err) {
    return false;
  }
}

/**
 * Inicializa los controladores de eventos para los servicios de exportación e importación.
 */
export function initBackupEvents() {
  
  // ==========================================================================
  // 1. EXPORTAR E IMPORTAR BÓVEDA COMPLETA (.ATENEA / .ZIP CON IMÁGENES INDEXEDDB)
  // ==========================================================================
  document.getElementById('btn-export-vault')?.addEventListener('click', async () => {
    if (library.length === 0) return showToast('Tu biblioteca está vacía.', 'error');
    if (typeof JSZip === 'undefined') return showToast('Librería de compresión JSZip no disponible.', 'error');

    const btn = document.getElementById('btn-export-vault');
    const originalText = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<i data-lucide="loader-2"></i> Empaquetando Bóveda...`;
    }

    try {
      const zip = new JSZip();

      // A) Base de datos principal de obras y notas
      zip.file('database.json', JSON.stringify(library, null, 2));

      // B) Colecciones personalizadas
      zip.file('collections.json', JSON.stringify(customCollections, null, 2));

      // C) Carátulas físicas guardadas en IndexedDB
      const covers = await getAllCachedCovers();
      const coversFolder = zip.folder('covers');
      covers.forEach(c => {
        coversFolder.file(c.id, c.blob);
      });

      const today = new Date().toISOString().split('T')[0];
      const blob = await zip.generateAsync({ 
        type: 'blob', 
        compression: 'DEFLATE', 
        compressionOptions: { level: 6 } 
      });

      downloadBlob(blob, `Atenea_Boveda_Completa_${today}.atenea`);
      showToast(`Bóveda exportada: ${library.length} obras y ${covers.length} portadas en disco.`);
    } catch (err) {
      console.error('Error al exportar la bóveda completa:', err);
      showToast(`Error al exportar la bóveda: ${err.message}`, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalText;
      }
    }
  });

  document.getElementById('input-import-vault')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (typeof JSZip === 'undefined') {
      showToast('Librería de compresión JSZip no disponible.', 'error');
      e.target.value = '';
      return;
    }

    showToast('Restaurando Bóveda Completa...', 'info');

    try {
      const zip = await JSZip.loadAsync(file);

      // 1. Restaurar Base de Datos de Obras (database.json)
      const dbFile = zip.file('database.json');
      if (!dbFile) {
        showToast('El archivo no contiene un database.json válido de Atenea.', 'error');
        e.target.value = '';
        return;
      }

      const dbText = await dbFile.async('text');
      const parsedItems = JSON.parse(dbText);
      if (!Array.isArray(parsedItems)) {
        showToast('Estructura de obras no válida en database.json.', 'error');
        e.target.value = '';
        return;
      }

      let restoredCount = 0;
      let skippedDuplicates = 0;

      parsedItems.forEach(item => {
        if (isItemDuplicate(item, library)) {
          skippedDuplicates++;
        } else {
          if (item.country) item.country = canonicalizeCountry(item.country);
          library.push(item);
          restoredCount++;
        }
      });

      // 2. Restaurar Colecciones Personalizadas (collections.json)
      const colFile = zip.file('collections.json');
      let restoredCollections = 0;
      if (colFile) {
        try {
          const colText = await colFile.async('text');
          const parsedCols = JSON.parse(colText);
          if (Array.isArray(parsedCols)) {
            const combinedCols = Array.from(new Set([...customCollections, ...parsedCols]));
            saveCustomCollections(combinedCols);
            restoredCollections = parsedCols.length;
          }
        } catch (colErr) {
          console.warn('No se pudieron restaurar las colecciones:', colErr);
        }
      }

      // 3. Restaurar Carátulas Físicas a IndexedDB (/covers/{id})
      let restoredCovers = 0;
      const coversFolder = zip.folder('covers');
      if (coversFolder) {
        const coverFilePromises = [];
        coversFolder.forEach((relativePath, fileEntry) => {
          if (!fileEntry.dir) {
            const itemId = relativePath.replace(/^covers\//, '').trim();
            if (itemId) {
              coverFilePromises.push(
                fileEntry.async('blob').then(blob => saveCoverBlobToIDB(itemId, blob))
              );
            }
          }
        });
        const results = await Promise.all(coverFilePromises);
        restoredCovers = results.filter(Boolean).length;
      }

      saveLibrary(() => {
        renderSidebarCollections();
        renderActiveView();
      });

      let msg = `Bóveda restaurada: ${restoredCount} obra(s), ${restoredCollections} colección(es) y ${restoredCovers} portada(s) local(es).`;
      if (skippedDuplicates > 0) msg += ` Se omitieron ${skippedDuplicates} obras duplicadas.`;
      showToast(msg);
    } catch (err) {
      console.error('Error al restaurar la bóveda completa:', err);
      showToast(`Error al restaurar la bóveda: ${err.message}`, 'error');
    } finally {
      e.target.value = '';
    }
  });

  // ==========================================================================
  // 2. EXPORTAR A OBSIDIAN (.ZIP CON FRONTMATTER YAML)
  // ==========================================================================
  document.getElementById('btn-export-obsidian')?.addEventListener('click', async () => {
    if (library.length === 0) return showToast('Tu biblioteca está vacía.', 'error');
    if (typeof JSZip === 'undefined') return showToast('Librería de compresión JSZip no disponible.', 'error');

    const zip = new JSZip();

    library.forEach(item => {
      const safeTitle = (item.title || 'Obra').replace(/[\\/:*?"<>|]/g, '_');
      const fileName = `${safeTitle}.md`;
      const creator = item.details?.author || item.details?.director || item.details?.artist || item.creator || '';

      const content = `---
title: "${item.title || ''}"
type: ${item.type}
creator: "${creator}"
country: "${item.country || ''}"
releaseYear: ${item.releaseYear || ''}
status: ${item.status}
isWishlist: ${item.isWishlist ? true : false}
rating: ${item.userRating || 0}
dateStarted: "${item.dateStarted || ''}"
dateFinished: "${item.dateFinished || ''}"
tags: [${(item.tags || []).map(t => `"${t}"`).join(', ')}]
cover: "${item.coverUrl || ''}"
---

# ${item.title || ''}

![Portada](${item.coverUrl || ''})

- **Tipo:** ${item.type}
- **Creador:** ${creator}
- **País:** ${item.country || 'N/A'}
- **Año:** ${item.releaseYear || 'N/A'}
- **Estado:** ${item.status}
- **Calificación:** ${'★'.repeat(Math.round(item.userRating || 0))}

## 📝 Bitácora y Notas Personales
${item.userNotes || 'Sin notas registradas.'}
`;
      zip.file(fileName, content);
    });

    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(blob, 'Atenea_Coleccion_Obsidian.zip');
    showToast('Exportación para Obsidian completada.');
  });

  // ==========================================================================
  // 3. EXPORTAR E IMPORTAR BIBTEX (ZOTERO / LATEX)
  // ==========================================================================
  document.getElementById('btn-export-bibtex')?.addEventListener('click', () => {
    if (library.length === 0) return showToast('Tu biblioteca está vacía.', 'error');

    let bibtexStr = '';
    library.forEach(item => {
      const rawAuthor = (item.details?.author || item.creator || 'item').split(' ')[0];
      const cleanAuthorKey = rawAuthor
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]/g, "")
        .toLowerCase() || 'obra';

      const citeKey = `${cleanAuthorKey}${item.releaseYear || 'sf'}`;
      const creator = item.details?.author || item.details?.director || item.details?.artist || item.creator || 'Unknown';
      
      if (item.type === 'book') {
        bibtexStr += `@book{${citeKey},\n  title = {${item.title}},\n  author = {${creator}},\n  year = {${item.releaseYear || ''}},\n  publisher = {${item.details?.publisher || ''}},\n  note = {${item.userNotes || ''}}\n}\n\n`;
      } else if (item.type === 'movie') {
        bibtexStr += `@misc{${citeKey},\n  title = {${item.title}},\n  director = {${creator}},\n  year = {${item.releaseYear || ''}},\n  howpublished = {Film}\n}\n\n`;
      } else {
        bibtexStr += `@misc{${citeKey},\n  title = {${item.title}},\n  author = {${creator}},\n  year = {${item.releaseYear || ''}},\n  howpublished = {Audio/Album}\n}\n\n`;
      }
    });

    const blob = new Blob([bibtexStr], { type: 'text/plain;charset=utf-8;' });
    downloadBlob(blob, 'Atenea_Zotero_Referencias.bib');
    showToast('Archivo BibTeX generado con éxito.');
  });

  document.getElementById('input-import-bibtex')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      const entries = text.split(/@\w+\s*\{/).filter(Boolean);
      let count = 0;
      let skippedDuplicates = 0;

      entries.forEach(entry => {
        const getField = (f) => {
          const m = entry.match(new RegExp(`${f}\\s*=\\s*[\"{](.*?)[\"}]`, 'i'));
          return m ? m[1].trim() : '';
        };

        const title = getField('title');
        const author = getField('author') || getField('director') || getField('artist');
        const year = parseInt(getField('year'), 10) || new Date().getFullYear();
        const publisher = getField('publisher');

        if (title) {
          const candidate = {
            type: publisher ? 'book' : 'movie',
            title,
            creator: author,
            releaseYear: year
          };

          if (isItemDuplicate(candidate, library)) {
            skippedDuplicates++;
            return;
          }

          library.push({
            id: crypto.randomUUID(),
            type: candidate.type,
            title,
            originalTitle: '',
            status: 'completed',
            isWishlist: false,
            coverUrl: '',
            releaseYear: year,
            country: 'Internacional',
            tags: ['Zotero'],
            creator: author,
            details: { 
              author: candidate.type === 'book' ? author : '',
              director: candidate.type === 'movie' ? author : '',
              publisher: publisher || '' 
            },
            userRating: 0,
            userNotes: '',
            dateStarted: '',
            dateFinished: new Date().toISOString().split('T')[0],
            createdAt: new Date().toISOString().split('T')[0]
          });
          count++;
        }
      });

      saveLibrary(renderActiveView);
      e.target.value = '';
      let msg = `Se importaron ${count} referencias de Zotero.`;
      if (skippedDuplicates > 0) msg += ` Se omitieron ${skippedDuplicates} duplicadas.`;
      showToast(msg);
    };
    reader.readAsText(file);
  });

  // ==========================================================================
  // 4. EXPORTAR E IMPORTAR CSV CON AUTÓMATA FINITO (RFC 4180)
  // ==========================================================================
  document.getElementById('btn-export-csv')?.addEventListener('click', () => {
    if (library.length === 0) return showToast('Tu biblioteca está vacía.', 'error');

    const headers = ['id', 'type', 'title', 'creator', 'country', 'releaseYear', 'status', 'isWishlist', 'userRating', 'dateStarted', 'dateFinished', 'tags', 'coverUrl', 'userNotes'];
    const csvRows = [headers.join(',')];
    const escapeCSV = (val) => `"${String(val ?? '').replace(/"/g, '""')}"`;

    library.forEach(i => {
      const creator = i.details?.author || i.details?.director || i.details?.artist || i.creator || '';
      const tagsStr = (i.tags || []).join(';');
      const row = [
        escapeCSV(i.id),
        escapeCSV(i.type),
        escapeCSV(i.title),
        escapeCSV(creator),
        escapeCSV(i.country),
        escapeCSV(i.releaseYear),
        escapeCSV(i.status || 'todo'),
        escapeCSV(i.isWishlist ? 'true' : 'false'),
        escapeCSV(i.userRating || 0),
        escapeCSV(i.dateStarted || ''),
        escapeCSV(i.dateFinished || ''),
        escapeCSV(tagsStr),
        escapeCSV(i.coverUrl || ''),
        escapeCSV(i.userNotes || '')
      ];
      csvRows.push(row.join(','));
    });

    const blob = new Blob(['\uFEFF' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    downloadBlob(blob, 'Atenea_Coleccion.csv');
    showToast('Archivo CSV generado con éxito.');
  });

  document.getElementById('input-import-csv')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length <= 1) return showToast('El archivo CSV no contiene registros válidos.', 'error');

      let importedCount = 0;
      let skippedDuplicates = 0;

      for (let idx = 1; idx < lines.length; idx++) {
        const line = lines[idx];
        const cols = parseCSVLine(line);
        if (cols.length >= 3) {
          const cleanCol = (c) => (c || '').replace(/^"|"$/g, '').trim();
          const type = cleanCol(cols[1]) || 'book';
          const title = cleanCol(cols[2]) || 'Sin Título';
          const creator = cleanCol(cols[3]) || '';
          const country = canonicalizeCountry(cleanCol(cols[4]));
          const year = parseInt(cleanCol(cols[5]), 10) || new Date().getFullYear();
          const status = cleanCol(cols[6]) || 'todo';
          const isWishlist = cleanCol(cols[7]) === 'true';
          const rating = parseInt(cleanCol(cols[8]), 10) || 0;
          const dateStarted = cleanCol(cols[9]) || '';
          const dateFinished = cleanCol(cols[10]) || '';
          const tags = cleanCol(cols[11]).split(';').map(t => t.trim()).filter(Boolean);
          const coverUrl = cleanCol(cols[12]) || '';
          const notes = cleanCol(cols[13]) || '';

          const candidate = { type, title, creator, releaseYear: year };
          if (isItemDuplicate(candidate, library)) {
            skippedDuplicates++;
            continue;
          }

          const item = {
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
            creator,
            details: {
              author: type === 'book' ? creator : '',
              director: type === 'movie' ? creator : '',
              artist: type === 'music' ? creator : ''
            },
            userRating: rating,
            userNotes: notes,
            dateStarted,
            dateFinished,
            createdAt: new Date().toISOString().split('T')[0]
          };

          library.push(item);
          importedCount++;
        }
      }

      saveLibrary(renderActiveView);
      e.target.value = '';
      let msg = `Se importaron ${importedCount} obras a tu biblioteca.`;
      if (skippedDuplicates > 0) msg += ` Se omitieron ${skippedDuplicates} duplicadas.`;
      showToast(msg);
    };
    reader.readAsText(file);
  });

  // ==========================================================================
  // 5. EXPORTAR E IMPORTAR JSON UNIVERSAL
  // ==========================================================================
  document.getElementById('btn-export-json')?.addEventListener('click', () => {
    if (library.length === 0) return showToast('Tu biblioteca está vacía.', 'error');
    const jsonStr = JSON.stringify(library, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    downloadBlob(blob, 'Atenea_Copia_Seguridad.json');
    showToast('Copia de seguridad JSON guardada.');
  });

  document.getElementById('input-import-json')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        if (Array.isArray(parsed)) {
          let mergedCount = 0;
          let skippedDuplicates = 0;

          parsed.forEach(item => {
            if (isItemDuplicate(item, library)) {
              skippedDuplicates++;
            } else {
              if (item.country) item.country = canonicalizeCountry(item.country);
              library.push(item);
              mergedCount++;
            }
          });

          saveLibrary(renderActiveView);
          e.target.value = '';
          let msg = `Se restauraron e integraron ${mergedCount} obras con éxito.`;
          if (skippedDuplicates > 0) msg += ` Se omitieron ${skippedDuplicates} duplicadas.`;
          showToast(msg);
        } else {
          showToast('Formato JSON no válido.', 'error');
        }
      } catch (err) {
        showToast('Error al leer el archivo JSON.', 'error');
      }
    };
    reader.readAsText(file);
  });
}