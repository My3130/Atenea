// ============================================================================
// API.JS - Motor Universal de Metadatos, Tracklists y Curaduría Cultural
// - Búsqueda Concurrente Multifuente sin Canibalización (Supabase + Google + OpenLib)
// - Estado inicial de catálogo natural: 'todo' (Por empezar)
// - Normalización de idiomas a nombres canónicos en español (ES -> Español)
// - Enriquecimiento Curatorial Multimodal en Segundo Plano con Gemini (Flash & Pro)
// - Extracción Automática de Tracklists y Duraciones MM:SS (Discogs + MusicBrainz)
// ============================================================================

import { 
  API_KEY_STORAGE, 
  OMDB_KEY_STORAGE, 
  DISCOGS_TOKEN_STORAGE, 
  canonicalizeCountry, 
  canonicalizeTags, 
  isItemDuplicate 
} from './state.js';

function cleanTitle(str = '') {
  return str.replace(/\(.*?\)/g, '').replace(/\[.*?\]/g, '').trim();
}

function formatMillisToMMSS(ms) {
  if (!ms || isNaN(ms)) return '--:--';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

function removeAccents(str = '') {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Traduce códigos ISO o nombres crudos de idioma a nombres formales en español.
 * @param {string} lang 
 * @returns {string}
 */
export function normalizeLanguage(lang = '') {
  if (!lang) return 'Español';
  const clean = lang.trim().toLowerCase();
  const map = {
    'es': 'Español', 'spa': 'Español', 'spanish': 'Español',
    'en': 'Inglés', 'eng': 'Inglés', 'english': 'Inglés',
    'fr': 'Francés', 'fre': 'Francés', 'fra': 'Francés', 'french': 'Francés',
    'de': 'Alemán', 'ger': 'Alemán', 'deu': 'Alemán', 'german': 'Alemán',
    'it': 'Italiano', 'ita': 'Italiano', 'italian': 'Italiano',
    'ja': 'Japonés', 'jpn': 'Japonés', 'japanese': 'Japonés',
    'pt': 'Portugués', 'por': 'Portugués', 'portuguese': 'Portugués',
    'ru': 'Ruso', 'rus': 'Ruso', 'russian': 'Ruso',
    'zh': 'Chino', 'chi': 'Chino', 'zho': 'Chino', 'chinese': 'Chino',
    'el': 'Griego', 'gre': 'Griego', 'ell': 'Griego',
    'la': 'Latín', 'lat': 'Latín'
  };
  return map[clean] || (clean.charAt(0).toUpperCase() + clean.slice(1));
}

// ----------------------------------------------------------------------------
// PARSER ROBUSTO DE JSON PARA RESPUESTAS DE IA (ANTI-CRASHEOS)
// ----------------------------------------------------------------------------
function safeParseJson(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('La respuesta de la IA llegó vacía.');
  }

  let clean = rawText
    .replace(/```json\s*/gi, '')
    .replace(/```\s*$/g, '')
    .replace(/```/g, '')
    .trim();

  const match = clean.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (match) {
    clean = match[0];
  }

  try {
    return JSON.parse(clean);
  } catch (err) {
    try {
      const sanitized = clean.replace(/,\s*([\]}])/g, '$1');
      return JSON.parse(sanitized);
    } catch (err2) {
      console.error('Error al parsear JSON devuelto por Gemini. Texto recibido:', clean);
      throw new Error(`La IA devolvió una estructura no válida: ${err.message}`);
    }
  }
}

// ----------------------------------------------------------------------------
// PUENTE DE LOCALIZACIÓN CINEMATOGRÁFICA (ESPAÑOL ➔ INGLÉS / TÍTULO ORIGINAL)
// ----------------------------------------------------------------------------
async function resolveEnglishMovieTitle(spanishQuery) {
  const cleanQ = cleanTitle(spanishQuery);
  if (!cleanQ) return null;

  try {
    const wikiSearchUrl = `https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(cleanQ + ' película')}&utf8=&format=json&origin=*`;
    const sRes = await fetch(wikiSearchUrl);
    if (sRes.ok) {
      const sData = await sRes.json();
      const firstHit = sData.query?.search?.[0]?.title;
      if (firstHit) {
        const langLinkUrl = `https://es.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(firstHit)}&prop=langlinks&lllang=en&format=json&origin=*`;
        const lRes = await fetch(langLinkUrl);
        if (lRes.ok) {
          const lData = await lRes.json();
          const pages = lData.query?.pages || {};
          const pageKey = Object.keys(pages)[0];
          const enTitle = pages[pageKey]?.langlinks?.[0]?.['*'];
          if (enTitle) {
            return enTitle.replace(/\s*\([^)]*film[^)]*\)/i, '').replace(/\s*\([^)]*movie[^)]*\)/i, '').trim();
          }
        }
      }
    }
  } catch (e) {}

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);
    const transUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(cleanQ)}`;
    const tRes = await fetch(transUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (tRes.ok) {
      const tData = await tRes.json();
      const translated = tData?.[0]?.[0]?.[0];
      if (translated && translated.toLowerCase() !== cleanQ.toLowerCase()) {
        return translated;
      }
    }
  } catch (e) {}

  return null;
}

// ----------------------------------------------------------------------------
// 1. EXTRACTOR AUTOMÁTICO DE TRACKLISTS (MUSICBRAINZ & DISCOGS)
// ----------------------------------------------------------------------------
export async function fetchAlbumTracklist(item) {
  if (!item) return [];
  const discogsToken = localStorage.getItem(DISCOGS_TOKEN_STORAGE);
  const mbid = item.details?.mbid;
  const discogsId = item.details?.discogsId;

  if (mbid) {
    try {
      const res = await fetch(`https://musicbrainz.org/ws/2/release/${mbid}?inc=recordings+genres+tags&fmt=json`, {
        headers: { 'User-Agent': 'AteneaCulturalApp/2.0 ( contacto@atenea.local )' }
      });
      if (res.ok) {
        const data = await res.json();
        const tracks = [];
        (data.media || []).forEach(medium => {
          (medium.tracks || []).forEach(tr => {
            tracks.push({
              position: String(tr.number || tr.position || tracks.length + 1),
              title: tr.title || tr.recording?.title || 'Sin título',
              duration: formatMillisToMMSS(tr.length || tr.recording?.length)
            });
          });
        });
        if (tracks.length > 0) return tracks;
      }
    } catch (e) {}
  }

  if (discogsId && discogsToken) {
    try {
      const res = await fetch(`https://api.discogs.com/releases/${discogsId}?token=${encodeURIComponent(discogsToken)}`);
      if (res.ok) {
        const data = await res.json();
        const tracks = (data.tracklist || []).map((t, idx) => ({
          position: t.position || String(idx + 1),
          title: t.title || 'Pista',
          duration: t.duration || '--:--'
        }));
        if (tracks.length > 0) return tracks;
      }
    } catch (e) {}
  }

  try {
    const cleanQ = cleanTitle(item.title);
    const cleanC = cleanTitle(item.details?.artist || item.creator || '');
    const query = cleanC ? `release:"${cleanQ}" AND artist:"${cleanC}"` : `release:"${cleanQ}"`;
    const searchRes = await fetch(`https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(query)}&fmt=json&limit=1`, {
      headers: { 'User-Agent': 'AteneaCulturalApp/2.0 ( contacto@atenea.local )' }
    });
    if (searchRes.ok) {
      const searchData = await searchRes.json();
      const firstId = searchData.releases?.[0]?.id;
      if (firstId) {
        const detailRes = await fetch(`https://musicbrainz.org/ws/2/release/${firstId}?inc=recordings+genres+tags&fmt=json`, {
          headers: { 'User-Agent': 'AteneaCulturalApp/2.0 ( contacto@atenea.local )' }
        });
        if (detailRes.ok) {
          const detailData = await detailRes.json();
          const tracks = [];
          (detailData.media || []).forEach(medium => {
            (medium.tracks || []).forEach(tr => {
              tracks.push({
                position: String(tr.number || tr.position || tracks.length + 1),
                title: tr.title || tr.recording?.title || 'Sin título',
                duration: formatMillisToMMSS(tr.length || tr.recording?.length)
              });
            });
          });
          if (tracks.length > 0) return tracks;
        }
      }
    }
  } catch (e) {}

  return [];
}

// ----------------------------------------------------------------------------
// 2. MOTOR DE BÚSQUEDA DE METADATOS TIPO CALIBRE (MULTIFUENTE PARALELO)
// ----------------------------------------------------------------------------
export async function searchPublicMetadata(type, query, creator = '', publisher = '') {
  const cleanQ = cleanTitle(query);
  const cleanC = cleanTitle(creator);
  const cleanP = cleanTitle(publisher);
  let results = [];

  // ==========================================================================
  // 📚 1. LITERATURA: Supabase + Google Books + OpenLibrary (Sin Canibalización)
  // ==========================================================================

  if (type === 'book') {
    const cleanDigits = cleanQ.replace(/[-\s]/g, '');
    const isIsbnSearch = (cleanDigits.length === 10 || cleanDigits.length === 13) && /^\d+X?$/i.test(cleanDigits);
    const searchTerm = cleanQ.replace(/^(el|la|los|las|the)\s+/i, '').trim() || cleanQ;

    // --- Tarea A: Supabase vía Rust Backend ---
    const fetchSupabase = async () => {
      try {
        let rawJson = '[]';
        const invokeParams = {
          query: isIsbnSearch ? cleanDigits : searchTerm,
          creator: cleanC || null,
          isIsbn: isIsbnSearch
        };

        if (window.__TAURI__?.core?.invoke) {
          rawJson = await window.__TAURI__.core.invoke('search_supabase_catalog', invokeParams);
        } else if (window.__TAURI__?.invoke) {
          rawJson = await window.__TAURI__.invoke('search_supabase_catalog', invokeParams);
        }

        const dbRows = JSON.parse(rawJson || '[]');
        if (Array.isArray(dbRows)) {
          return dbRows.map(row => {
            const translatorClean = (row.translator && row.translator.toUpperCase() !== 'EMPTY') ? row.translator : '';
            return {
              type: 'book',
              source: 'Bóveda',
              title: row.title || cleanQ,
              creator: row.author || cleanC || 'Autor desconocido',
              releaseYear: parseInt(row.release_year, 10) || new Date().getFullYear(),
              publisher: row.publisher || 'Cátedra',
              country: canonicalizeCountry(row.country || 'Internacional'),
              coverUrl: row.cover_url || '',
              synopsis: `Edición registrada en catálogo (${row.publisher || 'Cátedra'}).`,
              tags: canonicalizeTags(row.tags ? [row.tags] : ['Clásica', 'Literatura']),
              status: 'todo',
              isWishlist: false,
              userRating: 0,
              userNotes: '',
              details: {
                author: row.author || cleanC,
                publisher: row.publisher || 'Cátedra',
                editionNumber: row.edition || 'Letras Hispánicas',
                editionYear: parseInt(row.release_year, 10) || null,
                translator: translatorClean,
                pageCount: parseInt(row.pages, 10) || null,
                isbn: row.isbn || (isIsbnSearch ? cleanDigits : '--'),
                language: normalizeLanguage(row.language || 'Español')
              }
            };
          });
        }
      } catch (e) {
        console.warn('Supabase no respondió:', e);
      }
      return [];
    };

    // --- Tarea B: Google Books vía Rust Backend ---
    const fetchGoogleBooks = async () => {
      const gbResults = [];
      try {
        let rawJson = '{"items":[]}';
        const invokeParams = {
          query: isIsbnSearch ? cleanDigits : cleanQ,
          creator: cleanC || null,
          publisher: cleanP || null,
          isIsbn: isIsbnSearch
        };

        if (window.__TAURI__?.core?.invoke) {
          rawJson = await window.__TAURI__.core.invoke('search_google_books', invokeParams);
        } else if (window.__TAURI__?.invoke) {
          rawJson = await window.__TAURI__.invoke('search_google_books', invokeParams);
        } else {
          let searchQuery = isIsbnSearch ? `isbn:${cleanDigits}` : cleanQ;
          if (!isIsbnSearch) {
            if (cleanC) searchQuery += ` inauthor:${cleanC}`;
            if (cleanP) searchQuery += ` inpublisher:${cleanP}`;
          }
          const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(searchQuery)}&maxResults=25`);
          if (res.ok) rawJson = await res.text();
        }

        const data = JSON.parse(rawJson || '{"items":[]}');
        (data.items || []).forEach(it => {
          const info = it.volumeInfo || {};
          let img = info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail || '';
          if (img) {
            img = img.replace('http://', 'https://').replace('&edge=curl', '');
          }
          const year = info.publishedDate ? parseInt(info.publishedDate.substring(0, 4), 10) || null : null;
          
          let isbn = '--';
          (info.industryIdentifiers || []).forEach(id => {
            if (id.type === 'ISBN_13') isbn = id.identifier;
            else if (id.type === 'ISBN_10' && isbn === '--') isbn = id.identifier;
          });

          gbResults.push({
            type: 'book',
            source: 'Google Books',
            title: info.title || cleanQ,
            creator: (info.authors || []).join(', ') || cleanC || 'Autor desconocido',
            releaseYear: year || new Date().getFullYear(),
            publisher: info.publisher || 'Editorial independiente',
            country: 'Internacional',
            coverUrl: img,
            synopsis: info.description || 'Sin sinopsis disponible.',
            tags: canonicalizeTags(info.categories || ['Literatura', 'Libro']),
            status: 'todo',
            isWishlist: false,
            userRating: 0,
            userNotes: '',
            details: {
              author: (info.authors || []).join(', ') || cleanC,
              publisher: info.publisher || '',
              editionNumber: '',
              editionYear: year,
              translator: '',
              pageCount: info.pageCount || null,
              isbn: isbn !== '--' ? isbn : (isIsbnSearch ? cleanDigits : '--'),
              language: normalizeLanguage(info.language || 'es'),
              synopsis: info.description || ''
            }
          });
        });
      } catch (e) {
        console.warn('Google Books no respondió:', e);
      }
      return gbResults;
    };

    // --- Tarea C: OpenLibrary (Extracción de Año Original y Ediciones) ---
    const fetchOpenLibrary = async () => {
      const olResults = [];
      try {
        const fieldsList = 'key,title,author_name,first_publish_year,publisher,isbn,number_of_pages_median,number_of_pages,language,cover_i,subject,first_sentence,edition_count,publish_year';
        let olUrl = '';

        if (isIsbnSearch) {
          olUrl = `https://openlibrary.org/search.json?isbn=${encodeURIComponent(cleanDigits)}&fields=${fieldsList}&limit=25`;
        } else {
          const searchTokens = [cleanQ];
          if (cleanC) searchTokens.push(cleanC);
          olUrl = `https://openlibrary.org/search.json?q=${encodeURIComponent(searchTokens.join(' '))}&fields=${fieldsList}&limit=35`;
        }

        const res = await fetch(olUrl);
        if (res.ok) {
          const data = await res.json();
          (data.docs || []).forEach(doc => {
            const pubList = Array.isArray(doc.publisher) ? doc.publisher : (doc.publisher ? [doc.publisher] : []);
            let pubName = 'Editorial independiente';
            if (pubList.length > 0) {
              if (cleanP) {
                const matchPub = pubList.find(p => p.toLowerCase().includes(cleanP.toLowerCase()));
                pubName = matchPub || pubList[0];
              } else {
                pubName = pubList[0];
              }
            }

            const isbnList = Array.isArray(doc.isbn) ? doc.isbn : (doc.isbn ? [doc.isbn] : []);
            const isbn13 = isbnList.find(id => String(id).replace(/[-\s]/g, '').length === 13);
            const isbn10 = isbnList.find(id => String(id).replace(/[-\s]/g, '').length === 10);
            const finalIsbn = isbn13 || isbn10 || isbnList[0] || (isIsbnSearch ? cleanDigits : '--');

            let coverImg = '';
            if (doc.cover_i) {
              coverImg = `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`;
            } else if (finalIsbn !== '--') {
              coverImg = `https://covers.openlibrary.org/b/isbn/${finalIsbn}-L.jpg?default=false`;
            }

            const rawLang = doc.language?.[0] || 'spa';
            const pagesNum = parseInt(doc.number_of_pages_median || doc.number_of_pages, 10) || null;
            const editionNum = doc.edition_count ? `${doc.edition_count}ª edición` : '1ª edición';

            // DUALIDAD TEMPORAL: Año original histórico vs año del ejemplar
            const originalYear = doc.first_publish_year || (doc.publish_year ? Math.min(...doc.publish_year) : null);
            const editionYear = doc.publish_year ? Math.max(...doc.publish_year) : originalYear;

            let synopsisText = `Edición registrada en OpenLibrary (${pubName}).`;
            if (doc.first_sentence) {
              const sentenceVal = typeof doc.first_sentence === 'object' ? doc.first_sentence.value : doc.first_sentence;
              if (sentenceVal) synopsisText = `«${sentenceVal}»`;
            }

            const rawSubjects = Array.isArray(doc.subject) ? doc.subject.slice(0, 5) : [];
            const tagsList = rawSubjects.length > 0 ? rawSubjects : ['Literatura', 'Libro'];

            olResults.push({
              type: 'book',
              source: 'OpenLibrary',
              title: doc.title || cleanQ,
              creator: (doc.author_name || []).join(', ') || cleanC || 'Autor desconocido',
              releaseYear: originalYear || editionYear || new Date().getFullYear(),
              publisher: pubName,
              country: 'Internacional',
              coverUrl: coverImg,
              synopsis: synopsisText,
              tags: canonicalizeTags(tagsList),
              status: 'todo',
              isWishlist: false,
              userRating: 0,
              userNotes: '',
              details: {
                author: (doc.author_name || []).join(', ') || cleanC,
                publisher: pubName,
                editionNumber: editionNum,
                editionYear: editionYear,
                translator: '',
                pageCount: pagesNum,
                isbn: finalIsbn,
                language: normalizeLanguage(rawLang),
                synopsis: synopsisText
              }
            });
          });
        }
      } catch (e) {
        console.warn('OpenLibrary no respondió:', e);
      }
      return olResults;
    };

    const [supabaseHits, googleHits, openLibHits] = await Promise.all([
      fetchSupabase(),
      fetchGoogleBooks(),
      fetchOpenLibrary()
    ]);

    const combined = [...supabaseHits, ...googleHits, ...openLibHits];
    const seenSignatures = new Set();

    // DEDUPLICACIÓN INTELIGENTE: Preserva ediciones distintas y fuentes diferentes
    combined.forEach(item => {
      const isbnKey = (item.details?.isbn && item.details.isbn !== '--') ? item.details.isbn : '';
      const sig = `${item.source}::${item.title.toLowerCase()}::${(item.publisher || '').toLowerCase()}::${item.details?.editionYear || item.releaseYear}::${isbnKey}`;
      if (!seenSignatures.has(sig)) {
        seenSignatures.add(sig);
        results.push(item);
      }
    });

    if (cleanP || cleanC) {
      const lowerP = cleanP.toLowerCase();
      const lowerC = cleanC.toLowerCase();

      results.sort((a, b) => {
        const aPub = (a.publisher || a.details?.publisher || '').toLowerCase();
        const bPub = (b.publisher || b.details?.publisher || '').toLowerCase();
        const aCreator = (a.creator || a.details?.author || '').toLowerCase();
        const bCreator = (b.creator || b.details?.author || '').toLowerCase();

        let aScore = 0;
        let bScore = 0;

        if (lowerP && aPub.includes(lowerP)) aScore += 50;
        if (lowerP && bPub.includes(lowerP)) bScore += 50;
        if (lowerC && aCreator.includes(lowerC)) aScore += 10;
        if (lowerC && bCreator.includes(lowerC)) bScore += 10;
        if (a.coverUrl) aScore += 2;
        if (b.coverUrl) bScore += 2;

        return bScore - aScore;
      });
    }
  }

  // ==========================================================================
  // 🎬 2. CINE: OMDb API
  // ==========================================================================
  else if (type === 'movie') {
    const omdbKey = localStorage.getItem(OMDB_KEY_STORAGE);

    if (omdbKey) {
      const resolvedEnTitle = await resolveEnglishMovieTitle(cleanQ);
      const searchTerms = [cleanQ];
      if (resolvedEnTitle && resolvedEnTitle.toLowerCase() !== cleanQ.toLowerCase()) {
        searchTerms.push(resolvedEnTitle);
      }

      const seenImdbIds = new Set();
      const rawCandidates = [];

      await Promise.all(searchTerms.map(async (term) => {
        try {
          const searchUrl = `https://www.omdbapi.com/?apikey=${omdbKey}&s=${encodeURIComponent(term)}&type=movie`;
          const res = await fetch(searchUrl);
          if (res.ok) {
            const data = await res.json();
            if (data.Search && Array.isArray(data.Search)) {
              data.Search.slice(0, 10).forEach(m => {
                if (!seenImdbIds.has(m.imdbID)) {
                  seenImdbIds.add(m.imdbID);
                  rawCandidates.push(m);
                }
              });
            }
          }
        } catch (e) {}
      }));

      await Promise.all(rawCandidates.map(async (m) => {
        try {
          const detailRes = await fetch(`https://www.omdbapi.com/?apikey=${omdbKey}&i=${m.imdbID}&plot=full`);
          if (detailRes.ok) {
            const d = await detailRes.json();
            const year = parseInt(d.Year, 10) || (m.Year ? parseInt(m.Year, 10) : new Date().getFullYear());
            const poster = (d.Poster && d.Poster !== 'N/A') ? d.Poster : ((m.Poster && m.Poster !== 'N/A') ? m.Poster : '');
            const runtimeNum = parseInt(d.Runtime, 10) || null;
            const cast = d.Actors && d.Actors !== 'N/A' ? d.Actors.split(',').map(a => a.trim()) : [];
            const rawCountry = (d.Country && d.Country !== 'N/A') ? d.Country : 'Internacional';
            const director = d.Director && d.Director !== 'N/A' ? d.Director : (cleanC || 'Director');
            const rawGenreArray = d.Genre && d.Genre !== 'N/A' 
              ? d.Genre.split(',').map(g => g.trim()) 
              : ['Cine'];

            const candidate = {
              type: 'movie',
              title: d.Title || m.Title,
              creator: director,
              releaseYear: year
            };

            if (!isItemDuplicate(candidate, results)) {
              results.push({
                type: 'movie',
                source: 'OMDb',
                title: d.Title || m.Title,
                creator: director,
                releaseYear: year,
                publisher: d.Production && d.Production !== 'N/A' ? d.Production : (d.Genre || 'Cine'),
                country: canonicalizeCountry(rawCountry),
                coverUrl: poster,
                synopsis: d.Plot && d.Plot !== 'N/A' ? d.Plot : 'Sin sinopsis disponible.',
                tags: canonicalizeTags(rawGenreArray),
                status: 'todo',
                isWishlist: false,
                userRating: 0,
                userNotes: '',
                details: {
                  director: director,
                  runtime: runtimeNum,
                  voteAverage: d.imdbRating && d.imdbRating !== 'N/A' ? d.imdbRating : null,
                  cast: cast,
                  studio: d.Production && d.Production !== 'N/A' ? d.Production : 'Estudio Cinematográfico'
                }
              });
            }
          }
        } catch (err) {}
      }));
    }
  }

  // ==========================================================================
  // 🎵 3. MÚSICA: Discogs + MusicBrainz
  // ==========================================================================
  else if (type === 'music') {
    const discogsToken = localStorage.getItem(DISCOGS_TOKEN_STORAGE);

    const fetchDiscogs = async () => {
      const hits = [];
      if (discogsToken) {
        try {
          const cleanArtistPlain = removeAccents(cleanC);
          const cleanTitlePlain = removeAccents(cleanQ);
          const cleanPubPlain = removeAccents(cleanP);
          const fullQuery = `${cleanArtistPlain} ${cleanTitlePlain} ${cleanPubPlain}`.trim() || cleanTitlePlain;

          const discogsUrl = `https://api.discogs.com/database/search?q=${encodeURIComponent(fullQuery)}&type=release&per_page=15&token=${encodeURIComponent(discogsToken)}`;
          const res = await fetch(discogsUrl);
          if (res.ok) {
            const data = await res.json();
            for (const rel of (data.results || [])) {
              let artist = cleanC || 'Artista';
              let albumTitle = rel.title || cleanQ;

              if (rel.title && rel.title.includes(' - ')) {
                const parts = rel.title.split(' - ');
                artist = parts[0].trim();
                albumTitle = parts.slice(1).join(' - ').trim();
              }

              const labelStr = (rel.label || [])[0] || 'Discográfica';
              const formatStr = (rel.format || []).join(', ') || 'Álbum';
              const rawGenres = Array.isArray(rel.genre) ? rel.genre : (rel.genre ? [rel.genre] : []);
              const rawStyles = Array.isArray(rel.style) ? rel.style : (rel.style ? [rel.style] : []);
              const combinedMusicTags = [...rawGenres, ...rawStyles];

              hits.push({
                type: 'music',
                source: 'Discogs',
                title: albumTitle,
                creator: artist,
                releaseYear: parseInt(rel.year, 10) || new Date().getFullYear(),
                publisher: labelStr,
                country: canonicalizeCountry(rel.country || 'Internacional'),
                coverUrl: rel.cover_image || rel.thumb || '',
                synopsis: `Lanzamiento discográfico en Discogs. Sello: ${labelStr}. Formato: ${formatStr}.`,
                tags: canonicalizeTags(combinedMusicTags.length > 0 ? combinedMusicTags : ['Música']),
                status: 'todo',
                isWishlist: false,
                userRating: 0,
                userNotes: '',
                details: {
                  artist: artist,
                  format: formatStr,
                  discogsId: rel.id,
                  tracklist: []
                }
              });
            }
          }
        } catch (e) {}
      }
      return hits;
    };

    const fetchMusicBrainz = async () => {
      const hits = [];
      try {
        let mbQuery = '';
        if (cleanC && cleanQ) {
          mbQuery = `release:"${cleanQ}" AND (artist:"${cleanC}" OR artistname:"${cleanC}")`;
        } else if (cleanC) {
          mbQuery = `artist:"${cleanC}" OR artistname:"${cleanC}"`;
        } else {
          mbQuery = `release:"${cleanQ}" OR "${cleanQ}"`;
        }

        const mbUrl = `https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(mbQuery)}&fmt=json&limit=15`;
        const res = await fetch(mbUrl, {
          headers: { 'User-Agent': 'AteneaCulturalApp/2.0 ( contacto@atenea.local )' }
        });

        if (res.ok) {
          const data = await res.json();
          for (const rel of (data.releases || [])) {
            const artist = (rel['artist-credit'] || []).map(a => a.name).join(', ') || cleanC || 'Artista';
            const year = rel.date ? parseInt(rel.date.substring(0, 4), 10) || null : null;
            const coverUrl = `https://coverartarchive.org/release/${rel.id}/front-500`;
            const trackCount = rel['track-count'] || '--';
            const mbTags = (rel.tags || []).map(t => (typeof t === 'string' ? t : (t.name || '')));
            const mbGenres = (rel.genres || []).map(g => (typeof g === 'string' ? g : (g.name || '')));
            const rawMbTags = [...mbGenres, ...mbTags];

            hits.push({
              type: 'music',
              source: 'MusicBrainz',
              title: rel.title || cleanQ,
              creator: artist,
              releaseYear: year || new Date().getFullYear(),
              publisher: rel['label-info-list']?.[0]?.label?.name || 'Sello discográfico',
              country: canonicalizeCountry(rel.country || 'Internacional'),
              coverUrl: coverUrl,
              synopsis: `Álbum registrado en MusicBrainz. Pistas: ${trackCount}.`,
              tags: canonicalizeTags(rawMbTags.length > 0 ? rawMbTags : ['Música', 'Álbum']),
              status: 'todo',
              isWishlist: false,
              userRating: 0,
              userNotes: '',
              details: {
                artist: artist,
                format: 'Álbum',
                mbid: rel.id,
                tracklist: []
              }
            });
          }
        }
      } catch (e) {}
      return hits;
    };

    const [dHits, mbHits] = await Promise.all([fetchDiscogs(), fetchMusicBrainz()]);
    results = [...dHits, ...mbHits];
  }

  return results;
}

// ----------------------------------------------------------------------------
// 3. BUSCADOR AUTOMÁTICO DE PORTADAS
// ----------------------------------------------------------------------------
export async function fetchAutomaticCover(item) {
  const titleClean = cleanTitle(item.title);
  const creatorClean = cleanTitle(item.details?.author || item.details?.artist || item.details?.director || item.creator || '');
  const year = item.releaseYear ? parseInt(item.releaseYear, 10) : null;

  try {
    if (item.type === 'movie') {
      const omdbKey = localStorage.getItem(OMDB_KEY_STORAGE);
      if (omdbKey) {
        async function fetchPosterFromOMDb(term) {
          try {
            let omdbUrl = `https://www.omdbapi.com/?apikey=${omdbKey}&t=${encodeURIComponent(term)}&type=movie`;
            if (year) omdbUrl += `&y=${year}`;

            const res = await fetch(omdbUrl);
            if (res.ok) {
              const data = await res.json();
              if (data.Poster && data.Poster !== 'N/A') return data.Poster;
            }

            const sRes = await fetch(`https://www.omdbapi.com/?apikey=${omdbKey}&s=${encodeURIComponent(term)}&type=movie`);
            if (sRes.ok) {
              const sData = await sRes.json();
              if (sData.Search && sData.Search.length > 0) {
                let match = sData.Search[0];
                if (year) {
                  const ym = sData.Search.find(m => m.Year && m.Year.startsWith(String(year)));
                  if (ym) match = ym;
                }
                if (match.Poster && match.Poster !== 'N/A') return match.Poster;
              }
            }
          } catch (e) {}
          return '';
        }

        let poster = await fetchPosterFromOMDb(titleClean);
        if (poster) return poster;

        const enTitle = await resolveEnglishMovieTitle(titleClean);
        if (enTitle) {
          poster = await fetchPosterFromOMDb(enTitle);
          if (poster) return poster;
        }
      }
    } 
    else if (item.type === 'music') {
      try {
        const mbQuery = creatorClean 
          ? `releasegroup:"${encodeURIComponent(titleClean)}"+AND+artist:"${encodeURIComponent(creatorClean)}"`
          : `releasegroup:"${encodeURIComponent(titleClean)}"`;
        const res = await fetch(`https://musicbrainz.org/ws/2/release-group/?query=${mbQuery}&fmt=json&limit=1`, {
          headers: { 'User-Agent': 'AteneaCulturalApp/2.0 ( contacto@atenea.local )' }
        });
        if (res.ok) {
          const data = await res.json();
          const rgId = data['release-groups']?.[0]?.id;
          if (rgId) return `https://coverartarchive.org/release-group/${rgId}/front-500`;
        }
      } catch (e) {}
    } 
    else if (item.type === 'book') {
      try {
        const gbQuery = creatorClean
          ? `intitle:${encodeURIComponent(titleClean)}+inauthor:${encodeURIComponent(creatorClean)}`
          : encodeURIComponent(titleClean);
        const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${gbQuery}&maxResults=1`);
        if (res.ok) {
          const data = await res.json();
          const info = data.items?.[0]?.volumeInfo || {};
          let img = info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail || '';
          if (img) {
            return img.replace('http://', 'https://').replace('&edge=curl', '');
          }
        }
      } catch (e) {}

      try {
        const olRes = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(titleClean + ' ' + creatorClean)}&limit=1`);
        if (olRes.ok) {
          const olData = await olRes.json();
          const doc = olData.docs?.[0];
          if (doc?.cover_i) {
            return `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`;
          }
          const isbnList = Array.isArray(doc?.isbn) ? doc.isbn : [];
          if (isbnList.length > 0) {
            return `https://covers.openlibrary.org/b/isbn/${isbnList[0]}-L.jpg?default=false`;
          }
        }
      } catch (e) {}
    }
  } catch (e) {}

  return '';
}

// ----------------------------------------------------------------------------
// 4. ASISTENTE IA GEMINI (CHAT Y VISIÓN) & CRÍTICA CULTURAL AVANZADA
// ----------------------------------------------------------------------------

// Modelos rápidos y masivos (Para chat, importación y enriquecimiento con cuotas altas)
const FAST_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-flash-lite-latest'
];

// Modelos de alto razonamiento (Exclusivos para El Crítico Cultural y Ensayos Comparativos)
const PRO_MODELS = [
  'gemini-pro-latest',
  'gemini-3.5-flash-lite'
];

let chatHistory = [];

async function callGeminiRaw(payload, apiKey, candidateModels = FAST_MODELS) {
  let responseData = null;
  let lastError = null;

  for (const model of candidateModels) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        responseData = await response.json();
        break;
      } else {
        const err = await response.json();
        lastError = err.error?.message;
      }
    } catch (e) {
      lastError = e.message;
    }
  }

  if (!responseData) throw new Error(lastError || 'Error al comunicarse con Gemini');
  return responseData.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
}

const SYSTEM_PROMPT = `
Eres un archivista cultural experto en catalogar libros, películas y música.
Tu objetivo es registrar las obras que el usuario menciona en español o mediante imágenes/capturas.

TAXONOMÍA ESTRICTA:
- Libros: "movement", "author", "publisher", "country".
- Películas: TMDb/Letterboxd, "genres", "director", "country", "releaseYear".
- Música: RateYourMusic (RYM), "artist", "format", "country".

RESPONDE EXCLUSIVAMENTE CON ESTE FORMATO JSON:
{
  "action": "CATALOG" | "QUESTION",
  "replyMessage": "Mensaje amable para el usuario",
  "item": {
    "id": "uuid",
    "type": "book" | "movie" | "music",
    "title": "Título de la obra",
    "originalTitle": "Título original",
    "status": "todo" | "in_progress" | "completed",
    "isWishlist": false,
    "coverUrl": "",
    "releaseYear": 1990,
    "country": "País",
    "tags": ["Etiqueta 1", "Etiqueta 2"],
    "details": {
      "author": "...",
      "publisher": "...",
      "director": "...",
      "artist": "...",
      "format": "..."
    }
  }
}
`;

export async function callGeminiChat(userText, imageBase64 = null) {
  const apiKey = localStorage.getItem(API_KEY_STORAGE);
  if (!apiKey) throw new Error('Configura tu API Key de Gemini en Ajustes.');

  const userParts = [];
  if (userText) userParts.push({ text: userText });
  if (imageBase64) {
    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    userParts.push({
      inline_data: {
        mime_type: 'image/jpeg',
        data: cleanBase64
      }
    });
  }

  const currentRequestHistory = [...chatHistory, { role: 'user', parts: userParts }];

  const payload = {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: currentRequestHistory
  };

  // Usa los modelos rápidos y de alta cuota (FAST_MODELS)
  const rawJson = await callGeminiRaw(payload, apiKey, FAST_MODELS);
  const parsed = safeParseJson(rawJson);

  const historyUserParts = userParts.map(p => {
    if (p.inline_data) {
      return { text: '[Imagen de portada o lomo analizada previamente]' };
    }
    return p;
  });

  chatHistory.push({ role: 'user', parts: historyUserParts });
  chatHistory.push({ role: 'model', parts: [{ text: rawJson }] });

  if (chatHistory.length > 8) {
    chatHistory = chatHistory.slice(-8);
  }
  
  if (parsed.item) {
    if (parsed.item.country) parsed.item.country = canonicalizeCountry(parsed.item.country);
    if (parsed.item.tags) parsed.item.tags = canonicalizeTags(parsed.item.tags);
  }
  return parsed;
}

// ----------------------------------------------------------------------------
// 5. "EL CRÍTICO CULTURAL": MUESTREO CURADO Y EXTRACCIÓN PROTEGIDA (PRO)
// ----------------------------------------------------------------------------
export async function analyzeDeepConnections(targetItem, allItems) {
  const apiKey = localStorage.getItem(API_KEY_STORAGE);
  if (!apiKey) throw new Error('Configura tu API Key de Gemini en Ajustes.');

  const otherItems = allItems.filter(i => i.id !== targetItem.id);
  if (otherItems.length === 0) {
    return {
      hasConnections: false,
      message: 'No hay suficientes obras en tu biblioteca para trazar puentes comparativos.'
    };
  }

  const sampleItems = otherItems
    .map(item => {
      let score = 0;
      if (item.type === targetItem.type) score += 1;
      if (item.country === targetItem.country) score += 2;
      const sharedTags = (item.tags || []).filter(t => (targetItem.tags || []).includes(t)).length;
      score += sharedTags * 3;
      if (item.userRating && item.userRating >= 4) score += 2;
      return { item, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 35)
    .map(entry => entry.item);

  const catalogSummary = sampleItems.map(i => ({
    id: i.id,
    type: i.type,
    title: i.title,
    creator: i.details?.author || i.details?.director || i.details?.artist || i.creator || 'Desconocido',
    year: i.releaseYear,
    country: i.country,
    tags: i.tags || [],
    userNotes: i.userNotes ? i.userNotes.substring(0, 120) : ''
  }));

  const targetCreator = targetItem.details?.author || targetItem.details?.director || targetItem.details?.artist || targetItem.creator || 'Desconocido';

  const prompt = `
Actúa como un catedrático de literatura comparada, teoría cinematográfica y musicología histórica.
Tu misión es encontrar conexiones conceptuales, estéticas, filosóficas, sociopolíticas o intertextuales PROFUNDAS entre la OBRA OBJETIVO y UNA o DOS obras de la COLECCIÓN LOCAL DEL USUARIO.

OBRA OBJETIVO:
- Tipo: ${targetItem.type}
- Título: "${targetItem.title}"
- Creador: ${targetCreator}
- Año: ${targetItem.releaseYear || 's.f.'}
- País: ${targetItem.country || 'N/A'}
- Etiquetas: ${(targetItem.tags || []).join(', ')}
- Notas del usuario: ${targetItem.userNotes || 'Sin notas'}

COLECCIÓN DEL USUARIO (Muestra curada de obras disponibles):
${JSON.stringify(catalogSummary)}

REGLAS ACADÉMICAS ESTRICTAS (ANTI-ALUCINACIÓN):
1. No inventes influencias directas si históricamente no ocurrieron. Si la conexión es temática (ej: "ambas exploran el existencialismo y el absurdo institucional" o "ambas usan la polifonía estilística"), explicítalo con precisión analítica.
2. Si NO EXISTE ningún paralelismo artístico, temático o conceptual sólido y verídico entre la obra objetivo y el catálogo del usuario, responde estrictamente con hasConnections: false y NO inventes relaciones forzadas.
3. Si existe una conexión genuina, el campo "academicInsight" debe ser un texto de 1 a 2 párrafos redactado con prosa ensayística elegante, profunda y rigurosa.

RESPONDE EXCLUSIVAMENTE CON ESTE FORMATO JSON:
{
  "hasConnections": true | false,
  "relatedItemTitle": "Título exacto de la obra de la colección con la que conecta" | null,
  "connectionTheme": "Frase sintética del puente temático (ej: La soledad ontológica en la posguerra)" | null,
  "academicInsight": "Análisis comparativo profundo..." | "No se encontraron puentes temáticos directos entre esta obra y el resto de tu colección."
}
`;

  const payload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }]
  };

  // Utiliza el modelo Pro de alto razonamiento (PRO_MODELS) para ensayos de máxima calidad
  const raw = await callGeminiRaw(payload, apiKey, PRO_MODELS);
  return safeParseJson(raw);
}

export async function generateCulturalDiscoveries(targetItem) {
  const apiKey = localStorage.getItem(API_KEY_STORAGE);
  if (!apiKey) throw new Error('Configura tu API Key de Gemini en Ajustes.');

  const targetCreator = targetItem.details?.author || targetItem.details?.director || targetItem.details?.artist || targetItem.creator || 'Desconocido';

  const prompt = `
Actúa como un curador cultural de vanguardia y crítico de arte.
Con base en la siguiente obra de referencia, sugiere EXACTAMENTE 3 obras afines de alta calidad artística (pueden ser libros, películas o álbumes de música) que compartan resonancias estéticas, estructurales, filosóficas o estilísticas profundas.

OBRA DE REFERENCIA:
- Tipo: ${targetItem.type}
- Título: "${targetItem.title}"
- Creador: ${targetCreator}
- Año: ${targetItem.releaseYear || 's.f.'}
- Géneros/Tags: ${(targetItem.tags || []).join(', ')}

REQUISITOS ESTRICTOS:
1. Las 3 obras recomendadas DEBEN SER OBRAS REALES Y VERIFICABLES (con títulos, autores/directores/artistas y años exactos). Prohibido inventar datos ficticios.
2. No sugieras la misma obra de referencia.
3. Para cada sugerencia, incluye una justificación curatorial rigurosa y concisa de por qué conecta con la obra de referencia.

RESPONDE EXCLUSIVAMENTE CON ESTE FORMATO JSON:
{
  "discoveries": [
    {
      "type": "book" | "movie" | "music",
      "title": "Título de la obra",
      "creator": "Autor / Director / Artista",
      "releaseYear": 1980,
      "country": "País de origen",
      "tags": ["Género 1", "Género 2"],
      "curatorialReason": "Justificación académica/artística de la recomendación..."
    }
  ]
}
`;

  const payload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }]
  };

  // Utiliza el modelo Pro (PRO_MODELS) para curaduría de alto nivel
  const raw = await callGeminiRaw(payload, apiKey, PRO_MODELS);
  const data = safeParseJson(raw);
  
  if (data.discoveries && Array.isArray(data.discoveries)) {
    data.discoveries.forEach(d => {
      if (d.country) d.country = canonicalizeCountry(d.country);
      if (d.tags) d.tags = canonicalizeTags(d.tags);
    });
  }

  return data;
}

// ----------------------------------------------------------------------------
// 6. ENRIQUECEDOR CURATORIAL EN SEGUNDO PLANO (PAÍS, AÑO HISTÓRICO Y ETIQUETAS)
// ----------------------------------------------------------------------------
export async function enrichBookMetadataWithAi(item, coverBase64 = null) {
  const apiKey = localStorage.getItem(API_KEY_STORAGE);
  if (!apiKey || !item) return null;

  const author = item.details?.author || item.creator || 'Desconocido';
  const publisher = item.details?.publisher || item.publisher || '';
  const synopsis = item.synopsis || item.details?.synopsis || '';

  const prompt = `
Actúa como un archivista literario enciclopédico de élite.
Analiza la siguiente obra y proporciona sus metadatos canónicos históricos exactos.

DATOS DE ENTRADA:
- Título: "${item.title}"
- Autor registrado: "${author}"
- Editorial registrada: "${publisher}"
- Sinopsis/Contexto: "${synopsis.substring(0, 350)}"

REGLAS CURATORIALES ESTRICTAS:
1. "country": Debe ser el PAÍS REAL de origen o nacionalidad del autor principal (ej: Gabriel García Márquez -> "Colombia", Jorge Luis Borges -> "Argentina", Mario Vargas Llosa -> "Perú", Albert Camus -> "Francia", Yukio Mishima -> "Japón", Shakespeare -> "Reino Unido"). NUNCA asumas el país por el idioma.
2. "originalReleaseYear": Año entero de la PRIMERA publicación histórica de la obra original (ej: "Cien años de soledad" -> 1967, "1984" -> 1949, "Don Quijote" -> 1605).
3. "canonicalAuthor": Nombre canónico y formal del autor (ej: "Gabriel García Márquez").
4. "tags": Arreglo de EXACTAMENTE entre 3 y 4 etiquetas canónicas en español (género, movimiento o corriente: ej: ["Realismo mágico", "Literatura hispanoamericana", "Novela"]).
5. "editionSubtype": Si el título o contexto indica una edición especial (ej: "Edición ilustrada", "Edición crítica", "Edición conmemorativa"), indícalo. Si es estándar, déjalo vacío ("").

RESPONDE EXCLUSIVAMENTE CON ESTE FORMATO JSON:
{
  "country": "País legítimo",
  "originalReleaseYear": 1967,
  "canonicalAuthor": "Autor",
  "tags": ["Tag 1", "Tag 2", "Tag 3"],
  "editionSubtype": ""
}
`;

  const parts = [{ text: prompt }];

  if (coverBase64) {
    const cleanB64 = coverBase64.replace(/^data:image\/\w+;base64,/, '');
    parts.push({
      inline_data: {
        mime_type: 'image/jpeg',
        data: cleanB64
      }
    });
  }

  const payload = {
    contents: [{ role: 'user', parts }]
  };

  try {
    // Usa los modelos rápidos (FAST_MODELS)
    const raw = await callGeminiRaw(payload, apiKey, FAST_MODELS);
    const parsed = safeParseJson(raw);
    if (parsed && typeof parsed === 'object') {
      return {
        country: parsed.country ? canonicalizeCountry(parsed.country) : null,
        originalReleaseYear: parseInt(parsed.originalReleaseYear, 10) || null,
        canonicalAuthor: parsed.canonicalAuthor || author,
        tags: Array.isArray(parsed.tags) ? canonicalizeTags(parsed.tags) : null,
        editionSubtype: parsed.editionSubtype || ''
      };
    }
  } catch (err) {
    console.warn('Error en segundo plano al enriquecer metadatos literarios con IA:', err);
  }

  return null;
}

export async function enrichBookTagsWithAi(title, creator = '', synopsis = '') {
  const result = await enrichBookMetadataWithAi({ title, creator, synopsis });
  return result?.tags || null;
}