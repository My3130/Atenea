// ============================================================================
// SRC/MODALS/MODAL-WRAP.JS - El Anuario Cultural (Wrap Anual)
// - Retrospectiva de obras culminadas, autores cumbre y meses pico
// - Muro de Obras Maestras con soporte de calificaciones de excelencia (★ 4.75 - 5.0)
// - Detección inteligente de ciclo anual (31 Dic - 15 Ene)
// ============================================================================

import { library, refreshLucide, showToast } from '../state.js';
import { escapeHtml, MONTH_NAMES } from './utils.js';
import { openDetailModal } from './modal-detail.js';

/**
 * Calcula y abre el anuario retrospectivo para el año seleccionado.
 * Filtra estrictamente obras completadas (status === 'completed' y no wishlist).
 * @param {number|null} targetYear - Año específico a consultar (por defecto el más reciente).
 */
export function openWrapModal(targetYear = null) {
  const wrapModal = document.getElementById('wrap-modal');
  const wrapYearSelect = document.getElementById('wrap-year-select');
  const wrapHeroTitle = document.getElementById('wrap-hero-title');
  const wrapStatsBooks = document.getElementById('wrap-stats-books');
  const wrapStatsMovies = document.getElementById('wrap-stats-movies');
  const wrapStatsMusic = document.getElementById('wrap-stats-music');
  const wrapStatsTotal = document.getElementById('wrap-stats-total');
  const wrapStar5Grid = document.getElementById('wrap-star5-grid');
  const wrapStar5Count = document.getElementById('wrap-star5-count');
  const wrapTopCreator = document.getElementById('wrap-top-creator');
  const wrapPeakMonth = document.getElementById('wrap-peak-month');
  const wrapNarrative = document.getElementById('wrap-narrative');

  if (!wrapModal) return;

  // 1. Extraer años disponibles en la base de datos con obras completadas
  const availableYears = new Set();
  library.forEach(i => {
    if (!i.isWishlist && i.status === 'completed') {
      const d = i.dateFinished || i.dateStarted || i.createdAt;
      if (d && d.length >= 4) {
        const y = parseInt(d.substring(0, 4));
        if (!isNaN(y)) availableYears.add(y);
      }
    }
  });

  const currentYear = new Date().getFullYear();
  availableYears.add(currentYear);
  const sortedYears = Array.from(availableYears).sort((a, b) => b - a);
  const activeYear = targetYear ? parseInt(targetYear) : sortedYears[0];

  if (wrapYearSelect) {
    wrapYearSelect.innerHTML = sortedYears
      .map(y => `<option value="${y}" ${y === activeYear ? 'selected' : ''}>Anuario ${y}</option>`)
      .join('');
  }

  // 2. Filtrar obras culminadas en el año activo
  const yearItems = library.filter(i => {
    if (i.isWishlist === true) return false;
    if (i.status !== 'completed') return false;
    const d = i.dateFinished || i.dateStarted || i.createdAt;
    return d && d.startsWith(String(activeYear));
  });

  if (wrapHeroTitle) wrapHeroTitle.textContent = `Tu Año Cultural ${activeYear}`;

  const books = yearItems.filter(i => i.type === 'book').length;
  const movies = yearItems.filter(i => i.type === 'movie').length;
  const music = yearItems.filter(i => i.type === 'music').length;

  if (wrapStatsBooks) wrapStatsBooks.textContent = String(books);
  if (wrapStatsMovies) wrapStatsMovies.textContent = String(movies);
  if (wrapStatsMusic) wrapStatsMusic.textContent = String(music);
  if (wrapStatsTotal) wrapStatsTotal.textContent = String(yearItems.length);

  // 3. Muro de Obras Maestras (Obras con 5 estrellas o calificación cumbre >= 4.75)
  const star5Items = yearItems.filter(i => (i.userRating || 0) >= 4.75);
  if (wrapStar5Count) wrapStar5Count.textContent = `${star5Items.length} obra(s)`;

  if (wrapStar5Grid) {
    if (star5Items.length === 0) {
      wrapStar5Grid.innerHTML = `
        <div class="wrap-empty-stars">
          <i data-lucide="sparkles"></i>
          <span>No registraste obras completadas con máxima distinción (★ 5.0) en ${activeYear}.</span>
        </div>`;
    } else {
      const fragment = document.createDocumentFragment();
      star5Items.forEach(item => {
        const cover = item.coverUrl || '';
        const creator = item.details?.author || item.details?.director || item.details?.artist || item.creator || '';
        const ratingNum = parseFloat(item.userRating);
        const ratingFormatted = (ratingNum && ratingNum === 5) 
          ? '★★★★★' 
          : `★ ${Number(ratingNum).toFixed(ratingNum % 1 === 0 ? 0 : (ratingNum % 0.5 === 0 ? 1 : 2))}`;

        const card = document.createElement('div');
        card.className = 'wrap-5star-card';
        card.dataset.id = item.id;
        card.title = `${item.title} - ${creator}`;
        card.innerHTML = `
          <img src="${escapeHtml(cover)}" class="wrap-5star-thumb" loading="lazy" decoding="async" onerror="this.style.display='none';" />
          <div class="wrap-5star-info">
            <span class="wrap-5star-title">${escapeHtml(item.title)}</span>
            <span class="wrap-5star-creator">${escapeHtml(creator)}</span>
            <span class="wrap-5star-badge">${escapeHtml(ratingFormatted)}</span>
          </div>
        `;
        fragment.appendChild(card);
      });
      wrapStar5Grid.replaceChildren(fragment);
    }
  }

  // 4. Creador Cumbre
  const creatorCounts = {};
  yearItems.forEach(i => {
    const c = i.details?.author || i.details?.director || i.details?.artist || i.creator;
    if (c && c !== 'Desconocido' && c !== 'N/A' && c !== 'Autor desconocido') {
      creatorCounts[c] = (creatorCounts[c] || 0) + 1;
    }
  });
  const topCreatorEntry = Object.entries(creatorCounts).sort((a, b) => b[1] - a[1])[0];
  if (wrapTopCreator) {
    wrapTopCreator.innerHTML = topCreatorEntry 
      ? `<strong>${escapeHtml(topCreatorEntry[0])}</strong> <small>(${topCreatorEntry[1]} obra(s) completada(s))</small>` 
      : `<span>Sin registros completados</span>`;
  }

  // 5. Mes Pico de Consumo
  const monthCounts = {};
  yearItems.forEach(i => {
    const d = i.dateFinished || i.dateStarted || i.createdAt;
    if (d && d.length >= 7) {
      const mIdx = parseInt(d.substring(5, 7)) - 1;
      if (!isNaN(mIdx) && mIdx >= 0 && mIdx < 12) {
        monthCounts[mIdx] = (monthCounts[mIdx] || 0) + 1;
      }
    }
  });
  const peakMonthEntry = Object.entries(monthCounts).sort((a, b) => b[1] - a[1])[0];
  if (wrapPeakMonth) {
    wrapPeakMonth.innerHTML = peakMonthEntry 
      ? `<strong>${MONTH_NAMES[parseInt(peakMonthEntry[0])]}</strong> <small>(${peakMonthEntry[1]} consumo(s))</small>` 
      : `<span>Sin registros completados</span>`;
  }

  // 6. Crónica Curatorial Dinámica
  if (wrapNarrative) {
    if (yearItems.length === 0) {
      wrapNarrative.textContent = `Aún no has registrado obras completadas en el ciclo ${activeYear}.`;
    } else {
      const topTags = {};
      yearItems.forEach(i => (i.tags || []).forEach(t => topTags[t] = (topTags[t] || 0) + 1));
      const popularTags = Object.entries(topTags).sort((a, b) => b[1] - a[1]).slice(0, 3).map(t => t[0]);

      let narrativeText = `Durante el ciclo ${activeYear}, tu biblioteca personal registró la culminación de ${yearItems.length} obra(s). `;
      if (books > 0 || movies > 0 || music > 0) {
        narrativeText += `Tu tiempo se distribuyó entre ${books} libro(s), ${movies} película(s) y ${music} trabajo(s) discográfico(s). `;
      }
      if (popularTags.length > 0) {
        narrativeText += `Los ejes temáticos y estilísticos predominantes transitaron alrededor de «${popularTags.join('», «')}». `;
      }
      if (star5Items.length > 0) {
        narrativeText += `Coronaste ${star5Items.length} obra(s) con la máxima distinción artística (calificación de excelencia ★), sellando un año de elevado valor curatorial.`;
      }
      wrapNarrative.textContent = narrativeText;
    }
  }

  wrapModal.showModal();
  refreshLucide();
}

/**
 * Notificación inteligente en cambio de ciclo de año (31 dic - 15 ene).
 */
export function checkYearlyWrapPrompt() {
  const now = new Date();
  const month = now.getMonth();
  const day = now.getDate();

  const isNewYearSeason = (month === 11 && day >= 31) || (month === 0 && day <= 15);
  if (!isNewYearSeason) return;

  const targetYear = month === 11 ? now.getFullYear() : now.getFullYear() - 1;
  const storageKey = `atenea_wrap_notified_${targetYear}`;

  if (!localStorage.getItem(storageKey)) {
    setTimeout(() => {
      showToast(`✨ Tu Anuario Cultural ${targetYear} está listo para ser explorado.`, 'info');
      localStorage.setItem(storageKey, 'true');
    }, 2000);
  }
}

/**
 * Inicializa los controladores de eventos para el modal del anuario.
 */
export function initWrapModalEvents() {
  const wrapModal = document.getElementById('wrap-modal');
  const wrapYearSelect = document.getElementById('wrap-year-select');
  const wrapStar5Grid = document.getElementById('wrap-star5-grid');

  if (wrapStar5Grid && !wrapStar5Grid.dataset.delegated) {
    wrapStar5Grid.dataset.delegated = 'true';
    wrapStar5Grid.addEventListener('click', (e) => {
      const card = e.target.closest('.wrap-5star-card');
      if (card && card.dataset.id) {
        wrapModal?.close();
        openDetailModal(card.dataset.id);
      }
    });
  }

  document.getElementById('btn-open-wrap')?.addEventListener('click', () => openWrapModal());
  document.getElementById('btn-close-wrap')?.addEventListener('click', () => wrapModal?.close());
  wrapYearSelect?.addEventListener('change', (e) => openWrapModal(parseInt(e.target.value)));
}