// ============================================================================
// SRC/MODALS/UTILS.JS - Utilidades de Sanitización, Fechas, IPC Tauri y Parsing
// ============================================================================

import { showToast } from '../state.js';

export const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

/**
 * Sanitiza cadenas de texto contra inyecciones DOM-XSS y rotura de atributos HTML.
 * @param {string|number|null|undefined} str - Texto o valor a sanitizar.
 * @returns {string} Cadena segura para inserción en innerHTML.
 */
export function escapeHtml(str = '') {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Abre un recurso externo (archivo local en PC o enlace web) mediante Tauri IPC
 * con fallback seguro a ventana del navegador.
 * @param {string} targetUrlOrPath - Ruta en disco (ej: "C:\libros\obra.pdf") o URL web.
 */
export async function openExternalResource(targetUrlOrPath) {
  if (!targetUrlOrPath) return;
  const clean = targetUrlOrPath.replace(/^["']|["']$/g, '').trim();
  if (!clean) return;

  try {
    // Compatibilidad nativa con Tauri v2
    if (window.__TAURI__?.core?.invoke) {
      await window.__TAURI__.core.invoke('open_external', { url: clean });
      return;
    } else if (window.__TAURI__?.invoke) {
      await window.__TAURI__.invoke('open_external', { url: clean });
      return;
    }
  } catch (err) {
    console.error('Error al invocar comando open_external de Tauri:', err);
    showToast(typeof err === 'string' ? err : 'No se pudo abrir el archivo local.', 'error');
    return;
  }

  // Fallback web estándar si se ejecuta fuera de Tauri
  window.open(clean, '_blank');
}

/**
 * Genera y descarga programáticamente un archivo Blob en el cliente.
 * @param {Blob} blob - Archivo en memoria.
 * @param {string} filename - Nombre con extensión para la descarga.
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1500);
}

/**
 * Autómata finito para parsear líneas de CSV respetando comillas dobles escapadas ("")
 * y campos vacíos consecutivos sin desfasar columnas.
 * @param {string} text - Línea en texto plano del archivo CSV.
 * @returns {string[]} Arreglo de celdas procesadas.
 */
export function parseCSVLine(text) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') {
        cur += '"';
        i++; // Saltar la comilla de escape
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      result.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur.trim());
  return result;
}