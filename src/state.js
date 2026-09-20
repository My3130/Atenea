// ============================================================================
// STATE.JS - Estado Global, Normalización Canónica Universal,
//             Persistencia Híbrida en IndexedDB (AteneaVaultDB) y Gestión de Caché
//             + Formateo Inteligente de Géneros, Temas Literarios y Estilos
//             + Sistema de Render Diferido Anti-Congelamiento (Drag & Drop Guard)
// ============================================================================

export const STORAGE_KEY = 'mediavault_items';
export const API_KEY_STORAGE = 'mediavault_gemini_key';
export const OMDB_KEY_STORAGE = 'mediavault_omdb_key';
export const DISCOGS_TOKEN_STORAGE = 'mediavault_discogs_token';
export const THEME_STORAGE = 'mediavault_theme';

// Claves de persistencia de Fondos Ambientales
export const BG_THEME_STORAGE = 'atenea_bg_theme';
export const BG_AUTO_STORAGE = 'atenea_bg_auto';

// Clave de persistencia de Colecciones Personalizadas
export const COLLECTIONS_STORAGE = 'atenea_custom_collections';
export let customCollections = JSON.parse(localStorage.getItem(COLLECTIONS_STORAGE)) || [];

// Memoria de trabajo síncrona en RAM
export let library = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];

export const state = {
  activeTypeFilter: 'all',
  activeStatusFilter: 'all',
  isWishlistFilterActive: false,
  activeCollectionFilter: null,
  searchQuery: '',
  activeTagFilter: null,
  currentSortOrder: 'recent',
  currentViewMode: 'grid', // 'grid' (Normal) | 'poster-medium' (Muro Medio) | 'poster-massive' (Muro Compacto) | 'list' (Lista)
  currentActiveView: 'library',
  timelineSubMode: 'calendar',
  mapProjectionMode: '3d',
  mapTypeFilter: 'all',
  mapEpochFilter: 'all',
  calYear: new Date().getFullYear(),
  calMonth: new Date().getMonth(),
  calTypeFilter: 'all',
  activeBgTheme: localStorage.getItem(BG_THEME_STORAGE) || 'auto',
  isBgAutoEnabled: localStorage.getItem(BG_AUTO_STORAGE) !== 'false',
  isDragging: false // Semáforo de interacción física activa (Drag & Drop)
};

// ============================================================================
// 0. COLA DE RENDER DIFERIDO (ANTI-BLOQUEOS POR CONCURRENCIA ASÍNCRONA)
// ============================================================================
let pendingDeferredRender = null;

/**
 * Registra una función de redibujado para ser ejecutada cuando finalice el arrastre.
 * @param {Function} callback 
 */
export function queueDeferredRender(callback) {
  if (typeof callback === 'function') {
    pendingDeferredRender = callback;
  }
}

/**
 * Despacha de forma segura cualquier redibujado que haya quedado en cola
 * mientras el usuario estaba arrastrando un elemento en el DOM.
 */
export function flushDeferredRender() {
  if (typeof pendingDeferredRender === 'function') {
    const fn = pendingDeferredRender;
    pendingDeferredRender = null;
    try {
      fn();
    } catch (err) {
      console.warn('Error al despachar render diferido:', err);
    }
  }
}

// ============================================================================
// 1. MOTOR INDEXEDDB UNIFICADO (AteneaVaultDB v2)
// ============================================================================
const IDB_NAME = 'AteneaVaultDB';
const IDB_VERSION = 2;
const STORE_BG = 'background_assets';
const STORE_LIBRARY = 'library_items';
const STORE_COVERS = 'cover_assets';

let dbInstance = null;

function openVaultDB() {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, IDB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_BG)) {
        db.createObjectStore(STORE_BG);
      }
      if (!db.objectStoreNames.contains(STORE_LIBRARY)) {
        db.createObjectStore(STORE_LIBRARY);
      }
      if (!db.objectStoreNames.contains(STORE_COVERS)) {
        db.createObjectStore(STORE_COVERS);
      }
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onerror = () => reject(request.error);
  });
}

/**
 * Inicializa y migra transparentemente los datos existentes de localStorage hacia IndexedDB.
 */
export async function initAteneaVault(onReadyCallback) {
  try {
    const db = await openVaultDB();

    const items = await new Promise((resolve) => {
      const tx = db.transaction(STORE_LIBRARY, 'readonly');
      const store = tx.objectStore(STORE_LIBRARY);
      const req = store.get('all_items');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });

    if (items && Array.isArray(items) && items.length > 0) {
      library.length = 0;
      library.push(...items);
    } else if (library.length > 0) {
      await saveLibraryToIDB();
    }

    if (typeof onReadyCallback === 'function') {
      onReadyCallback();
    }
  } catch (err) {
    console.warn('Fallback a memoria local:', err);
    if (typeof onReadyCallback === 'function') onReadyCallback();
  }
}

async function saveLibraryToIDB() {
  try {
    const db = await openVaultDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_LIBRARY, 'readwrite');
      const store = tx.objectStore(STORE_LIBRARY);
      const req = store.put(library, 'all_items');
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.error('Error al persistir en IndexedDB:', e);
    return false;
  }
}

/**
 * Guarda la biblioteca en IndexedDB (asíncrono sin límite de 5MB) y mantiene
 * una copia de respaldo en localStorage. Protege el hilo de la UI si hay Drag & Drop activo.
 */
export function saveLibrary(onSavedCallback) {
  saveLibraryToIDB().catch(() => {});

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(library));
  } catch (e) {
    console.warn('localStorage lleno, datos protegidos en IndexedDB.');
  }

  if (typeof onSavedCallback === 'function') {
    // Si el usuario está físicamente arrastrando una tarjeta, retenemos el callback visual
    // para evitar que el vaciado del DOM destruya el nodo activo y congele Chromium.
    if (state.isDragging) {
      pendingDeferredRender = onSavedCallback;
    } else {
      onSavedCallback();
    }
  }
}

// ============================================================================
// 2. MOTOR DE CACHÉ Y PURGA DE PORTADAS (OFFLINE PERMANENTE & ZERO GHOSTS)
// ============================================================================
const blobUrlCache = new Map();

/**
 * Descarga una imagen remota y la almacena localmente en IndexedDB.
 * @param {string} itemId - UUID de la obra.
 * @param {string} url - URL remota de la imagen (HTTP/HTTPS).
 */
export async function cacheCoverLocally(itemId, url) {
  if (!itemId || !url || !url.startsWith('http')) return;

  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return;

    const blob = await res.blob();
    const db = await openVaultDB();

    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_COVERS, 'readwrite');
      const store = tx.objectStore(STORE_COVERS);
      const req = store.put(blob, itemId);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });

    const blobUrl = URL.createObjectURL(blob);
    blobUrlCache.set(itemId, blobUrl);
  } catch (e) {}
}

/**
 * Recupera la imagen local de IndexedDB si existe; de lo contrario devuelve la URL remota.
 * @param {string} itemId - UUID de la obra.
 * @param {string} fallbackUrl - URL remota por defecto.
 * @returns {Promise<string>} URL de objeto local o URL remota.
 */
export async function getCoverBlobUrl(itemId, fallbackUrl) {
  if (blobUrlCache.has(itemId)) {
    return blobUrlCache.get(itemId);
  }

  try {
    const db = await openVaultDB();
    const blob = await new Promise((resolve) => {
      const tx = db.transaction(STORE_COVERS, 'readonly');
      const store = tx.objectStore(STORE_COVERS);
      const req = store.get(itemId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });

    if (blob instanceof Blob) {
      const blobUrl = URL.createObjectURL(blob);
      blobUrlCache.set(itemId, blobUrl);
      return blobUrl;
    }
  } catch (e) {}

  return fallbackUrl || '';
}

/**
 * Elimina físicamente el archivo Blob de la portada de IndexedDB y libera la memoria RAM.
 * @param {string} itemId - UUID de la obra que se elimina.
 */
export async function deleteCachedCover(itemId) {
  if (!itemId) return;

  if (blobUrlCache.has(itemId)) {
    URL.revokeObjectURL(blobUrlCache.get(itemId));
    blobUrlCache.delete(itemId);
  }

  try {
    const db = await openVaultDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_COVERS, 'readwrite');
      const store = tx.objectStore(STORE_COVERS);
      const req = store.delete(itemId);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    });
  } catch (e) {
    return false;
  }
}

export function refreshLucide() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// ============================================================================
// 3. MOTOR DE COLECCIONES PERSONALIZADAS
// ============================================================================
export function saveCustomCollections(collectionsArray) {
  customCollections.length = 0;
  customCollections.push(...collectionsArray);
  localStorage.setItem(COLLECTIONS_STORAGE, JSON.stringify(customCollections));
}

export function addCustomCollection(name) {
  const cleanName = (name || '').trim();
  if (!cleanName) return false;
  
  const exists = customCollections.some(c => c.toLowerCase() === cleanName.toLowerCase());
  if (exists) return false;

  customCollections.push(cleanName);
  localStorage.setItem(COLLECTIONS_STORAGE, JSON.stringify(customCollections));
  return true;
}

export function deleteCustomCollection(name) {
  const index = customCollections.indexOf(name);
  if (index !== -1) {
    customCollections.splice(index, 1);
    localStorage.setItem(COLLECTIONS_STORAGE, JSON.stringify(customCollections));
  }

  let modified = false;
  library.forEach(item => {
    if (item.collections && Array.isArray(item.collections) && item.collections.includes(name)) {
      item.collections = item.collections.filter(c => c !== name);
      modified = true;
    }
  });

  if (modified) {
    saveLibrary();
  }

  if (state.activeCollectionFilter === name) {
    state.activeCollectionFilter = null;
  }
}

export function addItemToCollection(itemId, collectionName) {
  const item = library.find(i => i.id === itemId);
  if (!item || !collectionName) return false;

  if (!Array.isArray(item.collections)) {
    item.collections = [];
  }

  if (!item.collections.includes(collectionName)) {
    item.collections.push(collectionName);
    saveLibrary();
    return true;
  }
  return false;
}

export function removeItemFromCollection(itemId, collectionName) {
  const item = library.find(i => i.id === itemId);
  if (!item || !Array.isArray(item.collections)) return false;

  if (item.collections.includes(collectionName)) {
    item.collections = item.collections.filter(c => c !== collectionName);
    saveLibrary();
    return true;
  }
  return false;
}

// ============================================================================
// 4. MOTOR DE FONDOS AMBIENTALES
// ============================================================================
export const BG_PRESETS = {
  winter: { 
    id: 'winter', 
    label: 'Invierno / Nieve', 
    icon: 'snowflake', 
    src: './assets/backgrounds/invierno.mp4',
    seasonMonths: [11, 0, 1]
  },
  spring: { 
    id: 'spring', 
    label: 'Primavera / Renacer', 
    icon: 'flower-2', 
    src: './assets/backgrounds/primavera.mp4',
    seasonMonths: [2, 3, 4]
  },
  summer: { 
    id: 'summer', 
    label: 'Verano / Atardecer', 
    icon: 'sun-medium', 
    src: './assets/backgrounds/verano.mp4',
    seasonMonths: [5, 6, 7]
  },
  autumn: { 
    id: 'autumn', 
    label: 'Otoño / Hojas', 
    icon: 'trees', 
    src: './assets/backgrounds/otono.mp4',
    seasonMonths: [8, 9, 10]
  },
  rain: { 
    id: 'rain', 
    label: 'Lluvia / Tormenta', 
    icon: 'cloud-rain', 
    src: './assets/backgrounds/lluvia.mp4' 
  },
  night: { 
    id: 'night', 
    label: 'Noche Despejada', 
    icon: 'moon-star', 
    src: './assets/backgrounds/noche.mp4' 
  },
  custom: { 
    id: 'custom', 
    label: 'Imagen Personalizada', 
    icon: 'image', 
    src: '' 
  },
  none: { 
    id: 'none', 
    label: 'Desactivado (Obsidian Puro)', 
    icon: 'ban', 
    src: '' 
  }
};

export function isSouthernHemisphere() {
  try {
    const tz = (Intl.DateTimeFormat().resolvedOptions().timeZone || '').toLowerCase();
    const southernPrefixes = [
      'america/argentina', 'america/buenos_aires', 'america/catamarca', 'america/cordoba',
      'america/jujuy', 'america/mendoza', 'america/santiago', 'america/punta_arenas',
      'america/montevideo', 'america/asuncion', 'america/la_paz', 'america/lima',
      'america/sao_paulo', 'america/rio_branco', 'america/manaus', 'america/belem',
      'america/fortaleza', 'america/recife', 'america/cuiaba', 'australia/',
      'pacific/auckland', 'pacific/chatham', 'pacific/fiji', 'africa/johannesburg',
      'africa/windhoek', 'africa/gaborone', 'africa/maputo', 'africa/harare'
    ];
    return southernPrefixes.some(prefix => tz.startsWith(prefix));
  } catch (e) {
    return false;
  }
}

export function detectSeasonByMonth(monthIndex = new Date().getMonth()) {
  let effectiveMonth = monthIndex;
  if (isSouthernHemisphere()) {
    effectiveMonth = (monthIndex + 6) % 12;
  }
  if (effectiveMonth === 11 || effectiveMonth === 0 || effectiveMonth === 1) return 'winter';
  if (effectiveMonth >= 2 && effectiveMonth <= 4) return 'spring';
  if (effectiveMonth >= 5 && effectiveMonth <= 7) return 'summer';
  return 'autumn';
}

const IDB_KEY_CUSTOM_IMAGE = 'custom_bg_blob';

export async function saveCustomBackgroundBlob(blob) {
  try {
    const db = await openVaultDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_BG, 'readwrite');
      const store = tx.objectStore(STORE_BG);
      const req = store.put(blob, IDB_KEY_CUSTOM_IMAGE);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.error('Error al guardar fondo en IndexedDB:', e);
    return false;
  }
}

export async function getCustomBackgroundBlob() {
  try {
    const db = await openVaultDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_BG, 'readonly');
      const store = tx.objectStore(STORE_BG);
      const req = store.get(IDB_KEY_CUSTOM_IMAGE);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    return null;
  }
}

export async function deleteCustomBackgroundBlob() {
  try {
    const db = await openVaultDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_BG, 'readwrite');
      const store = tx.objectStore(STORE_BG);
      const req = store.delete(IDB_KEY_CUSTOM_IMAGE);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    return false;
  }
}

let currentCustomBlobUrl = null;

export async function applyBackgroundTheme(themeKey, isAuto = null) {
  const videoEl = document.getElementById('bg-video');
  const imageEl = document.getElementById('bg-image');
  const containerEl = document.getElementById('bg-video-container');
  if (!containerEl) return;

  if (isAuto !== null) {
    state.isBgAutoEnabled = isAuto;
    localStorage.setItem(BG_AUTO_STORAGE, isAuto ? 'true' : 'false');
  }

  let effectiveTheme = themeKey;
  if (state.isBgAutoEnabled && (themeKey === 'auto' || !themeKey)) {
    effectiveTheme = detectSeasonByMonth();
  }

  state.activeBgTheme = effectiveTheme;
  localStorage.setItem(BG_THEME_STORAGE, state.isBgAutoEnabled ? 'auto' : effectiveTheme);

  if (currentCustomBlobUrl) {
    URL.revokeObjectURL(currentCustomBlobUrl);
    currentCustomBlobUrl = null;
  }

  if (effectiveTheme === 'none') {
    if (videoEl) {
      videoEl.pause();
      videoEl.removeAttribute('src');
      videoEl.load();
      videoEl.classList.add('hidden');
    }
    if (imageEl) {
      imageEl.removeAttribute('src');
      imageEl.classList.add('hidden');
    }
    containerEl.classList.add('bg-hidden');
    return;
  }

  if (effectiveTheme === 'custom') {
    const customBlob = await getCustomBackgroundBlob();
    if (customBlob) {
      currentCustomBlobUrl = URL.createObjectURL(customBlob);
      if (videoEl) {
        videoEl.pause();
        videoEl.removeAttribute('src');
        videoEl.load();
        videoEl.classList.add('hidden');
      }
      if (imageEl) {
        imageEl.src = currentCustomBlobUrl;
        imageEl.classList.remove('hidden');
      }
      containerEl.classList.remove('bg-hidden');
      return;
    } else {
      effectiveTheme = detectSeasonByMonth();
    }
  }

  if (imageEl) {
    imageEl.removeAttribute('src');
    imageEl.classList.add('hidden');
  }

  const targetSrc = BG_PRESETS[effectiveTheme]?.src || '';
  if (targetSrc && videoEl) {
    videoEl.classList.remove('hidden');
    containerEl.classList.remove('bg-hidden');
    if (videoEl.getAttribute('src') !== targetSrc) {
      videoEl.src = targetSrc;
      videoEl.load();
    }
    const playPromise = videoEl.play();
    if (playPromise !== undefined) {
      playPromise.catch(() => {});
    }
  } else {
    containerEl.classList.add('bg-hidden');
  }
}

// ============================================================================
// 5. HUELLA DETERMINISTA Y TAXONOMÍA CANÓNICA
// ============================================================================
export function getItemFingerprint(item) {
  const cleanStr = (s) => (s || '')
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();

  const type = item.type || 'book';
  const title = cleanStr(item.title);
  const creator = cleanStr(
    item.details?.author || 
    item.details?.director || 
    item.details?.artist || 
    item.creator
  );

  return `${type}::${title}::${creator}`;
}

export function isItemDuplicate(candidateItem, targetList = library) {
  const candidateFp = getItemFingerprint(candidateItem);
  return targetList.some(existing => getItemFingerprint(existing) === candidateFp);
}

const GENRE_CANONICAL_MAP = {
  // Cine y Literatura
  "comedy": "Comedia", "comedia": "Comedia",
  "sci-fi": "Ciencia ficción", "scifi": "Ciencia ficción", "science fiction": "Ciencia ficción",
  "horror": "Terror", "terror": "Terror",
  "adventure": "Aventura", "aventura": "Aventura",
  "action": "Acción", "accion": "Acción", "acción": "Acción",
  "thriller": "Suspenso", "suspense": "Suspenso", "suspenso": "Suspenso",
  "mystery": "Misterio", "misterio": "Misterio",
  "animation": "Animación", "animacion": "Animación", "animación": "Animación",
  "crime": "Crimen", "crimen": "Crimen",
  "drama": "Drama", "romance": "Romance", "romantic": "Romance",
  "fantasy": "Fantasía", "fantasia": "Fantasía", "fantasía": "Fantasía",
  "documentary": "Documental", "documental": "Documental",
  "biography": "Biografía", "biografia": "Biografía", "biografía": "Biografía",
  "history": "Historia", "historia": "Historia",
  "war": "Bélico", "belico": "Bélico", "bélico": "Bélico",
  "western": "Wéstern", "wéstern": "Wéstern",
  "musical": "Musical", "family": "Familiar", "familiar": "Familiar",
  "film-noir": "Cine negro", "film noir": "Cine negro", "cine negro": "Cine negro",
  "literature": "Literatura", "literatura": "Literatura",
  "fiction": "Ficción", "ficcion": "Ficción", "ficción": "Ficción",
  "non-fiction": "No ficción", "no ficcion": "No ficción",
  "poetry": "Poesía", "poesia": "Poesía", "poesía": "Poesía",
  "philosophy": "Filosofía", "filosofia": "Filosofía", "filosofía": "Filosofía",
  "essay": "Ensayo", "ensayo": "Ensayo",

  // Temas / Materias Literarias y Filosóficas (OpenLibrary / Google Books)
  "french essays": "Ensayo francés", "essays": "Ensayo",
  "existentialism": "Existencialismo", "existentialism (philosophy)": "Existencialismo",
  "absurd (philosophy)": "Absurdo", "the absurd": "Absurdo", "absurdo": "Absurdo",
  "suicide": "Filosofía", "life": "Filosofía", "meaning of life": "Filosofía",
  "history and criticism": "Crítica literaria", "criticism": "Crítica",
  "spanish literature": "Literatura española", "spanish poetry": "Poesía española",
  "latin american literature": "Literatura hispanoamericana",
  "classic literature": "Literatura clásica", "classics": "Clásicos",
  "greek literature": "Literatura griega", "greek poetry": "Poesía épica",
  "epic poetry": "Poesía épica", "mythology": "Mitología",
  "novels": "Novela", "short stories": "Cuentos", "plays": "Teatro",

  // Géneros y Subgéneros Musicales
  "alternative": "Alternativa", "alternative rock": "Rock alternativo",
  "indie": "Indie", "indie pop": "Indie Pop", "indie rock": "Indie Rock",
  "dream pop": "Dream Pop", "synth-pop": "Synthpop", "synthpop": "Synthpop",
  "alt-pop": "Alt-Pop", "art pop": "Art Pop", "bedroom pop": "Bedroom Pop",
  "shoegaze": "Shoegaze", "post-punk": "Post-Punk", "new wave": "New Wave",
  "rock": "Rock", "pop": "Pop", "electronic": "Electrónica",
  "ambient": "Ambient", "downtempo": "Downtempo", "trip hop": "Trip Hop",
  "hip hop": "Hip Hop", "hip-hop": "Hip Hop", "r&b": "R&B", "soul": "Soul",
  "jazz": "Jazz", "classical": "Clásica", "folk": "Folk", "psychedelic": "Psicodelia"
};

/**
 * Normaliza y traduce cualquier etiqueta o tema a Title Case en español.
 */
export function canonicalizeTag(tag) {
  if (!tag || typeof tag !== 'string') return null;
  const clean = tag.trim();
  if (!clean || clean === 'N/A' || clean === '--') return null;

  const lower = clean.toLowerCase();
  if (GENRE_CANONICAL_MAP[lower]) {
    return GENRE_CANONICAL_MAP[lower];
  }

  // Conversión inteligente a Title Case respetando espacios y guiones
  return clean
    .split(/([ -])/)
    .map(word => {
      if (word === ' ' || word === '-') return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join('');
}

export function canonicalizeTags(tagsArray) {
  if (!Array.isArray(tagsArray)) {
    if (typeof tagsArray === 'string') tagsArray = tagsArray.split(/[,;/]/);
    else return ['General'];
  }

  const uniqueSet = new Set();
  tagsArray.forEach(t => {
    const canonical = canonicalizeTag(t);
    if (canonical) uniqueSet.add(canonical);
  });

  return uniqueSet.size > 0 ? Array.from(uniqueSet) : ['General'];
}

// ============================================================================
// 6. NORMALIZACIÓN UNIVERSAL DE PAÍSES (ANTI-CÓDIGOS ISO "IE" / "AU")
// ============================================================================
let regionNamesEs = null;
try {
  if (typeof Intl !== 'undefined' && Intl.DisplayNames) {
    regionNamesEs = new Intl.DisplayNames(['es'], { type: 'region' });
  }
} catch (e) {}

const COUNTRY_ALIAS_TO_ISO = {
  "us": "US", "usa": "US", "united states": "US", "ee. uu.": "US", "estados unidos": "US",
  "ca": "CA", "canada": "CA", "canadá": "CA",
  "mx": "MX", "mexico": "MX", "méxico": "MX",
  "uk": "GB", "gb": "GB", "united kingdom": "GB", "england": "GB", "reino unido": "GB",
  "fr": "FR", "france": "FR", "francia": "FR",
  "de": "DE", "germany": "DE", "alemania": "DE",
  "it": "IT", "italy": "IT", "italia": "IT",
  "es": "ES", "spain": "ES", "españa": "ES",
  "ru": "RU", "russia": "RU", "rusia": "RU", "urss": "RU",
  "hu": "HU", "hungary": "HU", "hungría": "HU",
  "cz": "CZ", "czech republic": "CZ", "chequia": "CZ", "república checa": "CZ",
  "pl": "PL", "poland": "PL", "polonia": "PL",
  "se": "SE", "sweden": "SE", "suecia": "SE",
  "no": "NO", "norway": "NO", "noruega": "NO",
  "dk": "DK", "denmark": "DK", "dinamarca": "DK",
  "fi": "FI", "finland": "FI", "finlandia": "FI",
  "gr": "GR", "greece": "GR", "grecia": "GR",
  "pt": "PT", "portugal": "PT",
  "at": "AT", "austria": "AT",
  "jp": "JP", "japan": "JP", "japón": "JP",
  "kr": "KR", "south korea": "KR", "corea del sur": "KR",
  "cn": "CN", "china": "CN",
  "ar": "AR", "argentina": "AR",
  "br": "BR", "brazil": "BR", "brasil": "BR",
  "cl": "CL", "chile": "CL",
  "pe": "PE", "peru": "PE", "perú": "PE",
  "co": "CO", "colombia": "CO",
  "au": "AU", "australia": "AU",
  "ie": "IE", "ireland": "IE", "irlanda": "IE",
  "nz": "NZ", "new zealand": "NZ", "nueva zelanda": "NZ",
  "nl": "NL", "netherlands": "NL", "países bajos": "NL", "holanda": "NL",
  "be": "BE", "belgium": "BE", "bélgica": "BE",
  "ch": "CH", "switzerland": "CH", "suiza": "CH",
  "is": "IS", "iceland": "IS", "islandia": "IS",
  "uy": "UY", "uruguay": "UY",
  "ve": "VE", "venezuela": "VE",
  "cu": "CU", "cuba": "CU",
  "in": "IN", "india": "IN"
};

export function canonicalizeCountry(rawCountry = '') {
  if (!rawCountry || typeof rawCountry !== 'string') return 'Internacional';

  let clean = rawCountry.split(/[,/|]/)[0].trim();
  if (!clean || clean === 'N/A' || clean === '--') return 'Internacional';

  const lower = clean.toLowerCase();

  // 1. Si está en el mapa de alias
  const mappedIso = COUNTRY_ALIAS_TO_ISO[lower];
  if (mappedIso && regionNamesEs) {
    try {
      const canonical = regionNamesEs.of(mappedIso);
      if (canonical) {
        return canonical === 'Chequia' ? 'República Checa' : canonical;
      }
    } catch (e) {}
  }

  // 2. Si es un código ISO de 2 letras directo (ej: "IE", "AU", "JP", "US")
  if (clean.length === 2 && regionNamesEs) {
    try {
      const direct = regionNamesEs.of(clean.toUpperCase());
      if (direct) {
        return direct === 'Chequia' ? 'República Checa' : direct;
      }
    } catch (e) {}
  }

  const capitalized = clean.charAt(0).toUpperCase() + clean.slice(1);
  if (capitalized.toLowerCase() === 'chequia') return 'República Checa';
  return capitalized;
}

export function sanitizeLibraryData() {
  let modified = false;
  library.forEach(item => {
    if (!item.collections || !Array.isArray(item.collections)) {
      item.collections = [];
      modified = true;
    }
    if (!item.country) {
      item.country = 'Internacional';
      modified = true;
    } else {
      const canon = canonicalizeCountry(item.country);
      if (canon !== item.country) {
        item.country = canon;
        modified = true;
      }
    }
    if (!item.tags || !Array.isArray(item.tags)) {
      item.tags = ['General'];
      modified = true;
    }
  });

  if (modified) {
    saveLibrary();
  }
}

export function showToast(message, type = 'success') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast-pill toast-${type}`;
  
  let iconName = 'check-circle-2';
  if (type === 'error') iconName = 'alert-circle';
  if (type === 'info') iconName = 'info';

  toast.innerHTML = `<i data-lucide="${iconName}"></i> <span>${message}</span>`;
  container.appendChild(toast);
  refreshLucide();

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(12px)';
    setTimeout(() => {
      if (container.contains(toast)) container.removeChild(toast);
    }, 250);
  }, 2600);
}

export function getStatusIconName(type, status) {
  if (type === 'book') {
    if (status === 'todo') return 'book';
    if (status === 'in_progress') return 'book-open-text';
    if (status === 'completed') return 'book-check';
  } else if (type === 'movie') {
    if (status === 'todo') return 'eye-closed';
    if (status === 'in_progress') return 'film';
    if (status === 'completed') return 'eye';
  } else if (type === 'music') {
    if (status === 'todo') return 'headphone-off';
    if (status === 'in_progress') return 'audio-lines';
    if (status === 'completed') return 'headphones';
  }
  return 'circle';
}

export function cleanAccentsFor3D(str = '') {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export const COUNTRY_COORDINATES = {
  "Hungría": [47.1625, 19.5033],
  "Japón": [36.2048, 138.2529],
  "Italia": [41.8719, 12.5674],
  "Estados Unidos": [37.0902, -95.7129],
  "Reino Unido": [55.3781, -3.4360],
  "España": [40.4637, -3.7492],
  "Francia": [46.2276, 2.2137],
  "Alemania": [51.1657, 10.4515],
  "México": [23.6345, -102.5528],
  "Argentina": [-38.4161, -63.6167],
  "Rusia": [61.5240, 105.3188],
  "Colombia": [4.5709, -74.2973],
  "Corea del Sur": [35.9078, 127.7669],
  "Canadá": [56.1304, -106.3468],
  "Brasil": [-14.2350, -51.9253],
  "Chile": [-35.6751, -71.5430],
  "Perú": [-9.1899, -75.0152],
  "Suecia": [60.1282, 18.6435],
  "Noruega": [60.4720, 8.4689],
  "Dinamarca": [56.2639, 9.5018],
  "Finlandia": [61.9241, 25.7482],
  "Grecia": [39.0742, 21.8243],
  "Polonia": [51.9194, 19.1451],
  "Portugal": [39.3999, -8.2245],
  "Austria": [47.5162, 14.5501],
  "República Checa": [49.8175, 15.4730],
  "Chequia": [49.8175, 15.4730],
  "Rumanía": [45.9432, 24.9668],
  "Ucrania": [48.3794, 31.1656],
  "Turquía": [38.9637, 35.2433],
  "Australia": [-25.2744, 133.7751],
  "Nueva Zelanda": [-40.9006, 174.8860],
  "China": [35.8617, 104.1954],
  "Hong Kong": [22.3193, 114.1694],
  "Taiwán": [23.6978, 120.9605],
  "Irlanda": [53.1424, -7.6921],
  "Islandia": [64.9631, -19.0208],
  "Países Bajos": [52.1326, 5.2913],
  "Bélgica": [50.5039, 4.4699],
  "Suiza": [46.8182, 8.2275],
  "Cuba": [21.5218, -77.7812],
  "Uruguay": [-32.5228, -55.7658],
  "Venezuela": [6.4238, -66.5897],
  "India": [20.5937, 78.9629]
};

export const COUNTRY_FLAGS = {
  "Hungría": "🇭🇺",
  "Japón": "🇯🇵", "Italia": "🇮🇹", "Estados Unidos": "🇺🇸", "Reino Unido": "🇬🇧", "España": "🇪🇸",
  "Francia": "🇫🇷", "Alemania": "🇩🇪", "México": "🇲🇽", "Argentina": "🇦🇷", "Rusia": "🇷🇺",
  "Colombia": "🇨🇴", "Corea del Sur": "🇰🇷", "Canadá": "🇨🇦", "Brasil": "🇧🇷", "Chile": "🇨🇱",
  "Perú": "🇵🇪", "Suecia": "🇸🇪", "Noruega": "🇳🇴", "Dinamarca": "🇩🇰", "Finlandia": "🇫🇮",
  "Grecia": "🇬🇷", "Polonia": "🇵🇱", "Portugal": "🇵🇹", "Austria": "🇦🇹", "República Checa": "🇨🇿",
  "Chequia": "🇨🇿", "Rumanía": "🇷🇴", "Ucrania": "🇺🇦", "Turquía": "🇹🇷",
  "Australia": "🇦🇺", "Nueva Zelanda": "🇳🇿", "China": "🇨🇳", "Hong Kong": "🇭🇰", "Taiwán": "🇹🇼",
  "Irlanda": "🇮🇪", "Islandia": "🇮🇸", "Países Bajos": "🇳🇱", "Bélgica": "🇧🇪", "Suiza": "🇨🇭",
  "Cuba": "🇨🇺", "Uruguay": "🇺🇾", "Venezuela": "🇻🇪", "India": "🇮🇳"
};