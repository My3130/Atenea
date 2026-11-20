// ============================================================================
// ATLAS.JS - Globo 3D WebGL y Mapa 2D Minimalista (Solo Pines, Sin Polígonos)
//          + Destrucción Profunda WebGL (Scene Traverse + forceContextLoss)
//          + Suspensión de Video Ambiental & Modo Reposo 0.0% GPU en Globo 3D
// ============================================================================

import { 
  state, 
  library, 
  cleanAccentsFor3D, 
  COUNTRY_COORDINATES, 
  COUNTRY_FLAGS, 
  getStatusIconName, 
  canonicalizeCountry, 
  refreshLucide 
} from './state.js';

import { escapeHtml, openDayInspectorModal, openDetailModal } from './modals.js';

let culturalMap = null;
let mapMarkersGroup = null;
let globeInstance = null;
let globeSleepTimer = null;
let isObserverAttached = false;
let atlasEventsInitialized = false;

const mapStatsText = document.getElementById('map-stats-text');

function isValidCover(url) {
  if (!url || typeof url !== 'string') return false;
  const clean = url.trim();
  if (clean.length < 5) return false;
  return (
    clean.startsWith('http://') ||
    clean.startsWith('https://') ||
    clean.startsWith('blob:') ||
    clean.startsWith('data:image/') ||
    clean.startsWith('./') ||
    clean.startsWith('/')
  );
}

function setBackgroundVideoPausedForAtlas(paused) {
  const bgVideo = document.getElementById('bg-video');
  if (!bgVideo) return;

  if (paused) {
    const currentSrc = bgVideo.getAttribute('src');
    if (currentSrc) {
      bgVideo.dataset.pausedSrc = currentSrc;
      bgVideo.pause();
      bgVideo.removeAttribute('src');
      bgVideo.load();
    }
  } else {
    const inTree3D = state.currentActiveView === 'graph' && state.graphMode === '3d' && state.isTree3DEnabled;
    const savedSrc = bgVideo.dataset.pausedSrc;
    if (savedSrc && !inTree3D && state.activeBgTheme !== 'none' && state.activeBgTheme !== 'custom') {
      bgVideo.setAttribute('src', savedSrc);
      delete bgVideo.dataset.pausedSrc;
      bgVideo.load();
      bgVideo.play().catch(() => {});
    }
  }
}

// ----------------------------------------------------------------------------
// 0. DESTRUCCIÓN PROFUNDA Y GOBERNADOR 0.0% GPU DEL GLOBO
// ----------------------------------------------------------------------------
function disposeThreeNode(obj) {
  if (!obj) return;
  if (obj.geometry && typeof obj.geometry.dispose === 'function') {
    obj.geometry.dispose();
  }
  if (obj.material) {
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    mats.forEach(mat => {
      if (!mat) return;
      for (const key of Object.keys(mat)) {
        const val = mat[key];
        if (val && typeof val.dispose === 'function') {
          val.dispose();
        }
      }
      if (typeof mat.dispose === 'function') mat.dispose();
    });
  }
}

function scheduleGlobeSleep(delayMs = 1500) {
  clearTimeout(globeSleepTimer);
  globeSleepTimer = setTimeout(() => {
    if (globeInstance && typeof globeInstance.pauseAnimation === 'function') {
      globeInstance.pauseAnimation();
    }
  }, delayMs);
}

function wakeGlobeBriefly() {
  if (globeInstance && typeof globeInstance.resumeAnimation === 'function') {
    globeInstance.resumeAnimation();
    scheduleGlobeSleep(1500);
  }
}

function destroy3DGlobe() {
  clearTimeout(globeSleepTimer);
  globeSleepTimer = null;

  const globeCanvas = document.getElementById('cultural-globe-canvas');
  if (globeCanvas && globeCanvas.__atlasCleaners) {
    globeCanvas.__atlasCleaners();
    globeCanvas.__atlasCleaners = null;
  }

  if (globeInstance) {
    try {
      if (typeof globeInstance.pauseAnimation === 'function') {
        globeInstance.pauseAnimation();
      }

      if (typeof globeInstance.controls === 'function') {
        const ctrl = globeInstance.controls();
        if (ctrl) {
          ctrl.autoRotate = false;
          if (typeof ctrl.dispose === 'function') ctrl.dispose();
        }
      }

      if (typeof globeInstance.scene === 'function') {
        const sc = globeInstance.scene();
        if (sc) {
          if (sc.background && typeof sc.background.dispose === 'function') {
            sc.background.dispose();
          }
          sc.traverse(disposeThreeNode);
        }
      }

      if (typeof globeInstance._destructor === 'function') {
        globeInstance._destructor();
      }

      if (typeof globeInstance.renderer === 'function') {
        const r = globeInstance.renderer();
        if (r) {
          r.dispose();
          r.forceContextLoss();
        }
      }
    } catch (e) {}
    globeInstance = null;
  }

  if (globeCanvas) globeCanvas.innerHTML = '';
}

function destroy2DMap() {
  if (culturalMap) {
    try {
      culturalMap.remove();
    } catch (e) {}
    culturalMap = null;
    mapMarkersGroup = null;
  }
}

export function destroyAtlas() {
  setBackgroundVideoPausedForAtlas(false);
  destroy3DGlobe();
  destroy2DMap();
}

function ensureAtlasVisibilityObserver() {
  if (isObserverAttached) return;
  const mapView = document.getElementById('map-view');
  if (!mapView) return;

  const observer = new MutationObserver(() => {
    const isHidden = mapView.classList.contains('hidden');
    if (isHidden) {
      destroyAtlas();
    }
  });

  observer.observe(mapView, { attributes: true, attributeFilter: ['class'] });

  document.addEventListener('visibilitychange', () => {
    if (!globeInstance) return;
    if (document.hidden) {
      clearTimeout(globeSleepTimer);
      if (typeof globeInstance.pauseAnimation === 'function') globeInstance.pauseAnimation();
    } else if (state.currentActiveView === 'map' && state.mapProjectionMode === '3d') {
      wakeGlobeBriefly();
    }
  });

  isObserverAttached = true;
}

// ----------------------------------------------------------------------------
// 1. MOTOR DE AGREGACIÓN GEOGRÁFICA Y TEMPORAL
// ----------------------------------------------------------------------------
export function getCountryAggregatedData() {
  const filteredItems = library.filter(it => {
    if (state.mapTypeFilter !== 'all' && it.type !== state.mapTypeFilter) return false;

    if (state.mapEpochFilter && state.mapEpochFilter !== 'all') {
      const year = it.releaseYear;
      if (!year || isNaN(year)) return false;

      if (state.mapEpochFilter === 'antiquity-1899' && year >= 1900) return false;
      if (state.mapEpochFilter === '1900-1949' && (year < 1900 || year > 1949)) return false;
      if (state.mapEpochFilter === '1950-1979' && (year < 1950 || year > 1979)) return false;
      if (state.mapEpochFilter === '1980-1999' && (year < 1980 || year > 1999)) return false;
      if (state.mapEpochFilter === '2000-present' && year < 2000) return false;
    }

    return true;
  });

  const countryGroups = {};
  filteredItems.forEach(item => {
    const country = canonicalizeCountry(item.country);
    if (!countryGroups[country]) countryGroups[country] = [];
    countryGroups[country].push(item);
  });

  const validCountries = Object.keys(countryGroups).filter(c => !!COUNTRY_COORDINATES[c]).length;
  if (mapStatsText) {
    const epochLabel = getEpochHumanLabel(state.mapEpochFilter);
    mapStatsText.textContent = `${validCountries} país(es) en ${epochLabel}`;
  }

  return countryGroups;
}

function getEpochHumanLabel(epochKey) {
  switch (epochKey) {
    case 'antiquity-1899': return '< S. XX (Hasta 1899)';
    case '1900-1949': return '1900–1949';
    case '1950-1979': return '1950–1979';
    case '1980-1999': return '1980–1999';
    case '2000-present': return 'S. XXI (2000–Hoy)';
    default: return 'Todos los tiempos';
  }
}

export function initOrUpdateAtlas() {
  ensureAtlasVisibilityObserver();

  const globeCanvas = document.getElementById('cultural-globe-canvas');
  const mapCanvas = document.getElementById('cultural-map-canvas');
  const btnProj3D = document.getElementById('btn-proj-3d');
  const btnProj2D = document.getElementById('btn-proj-2d');

  if (state.mapProjectionMode === '3d') {
    btnProj3D?.classList.add('active');
    btnProj2D?.classList.remove('active');
    globeCanvas?.classList.remove('hidden');
    mapCanvas?.classList.add('hidden');

    destroy2DMap();
    setBackgroundVideoPausedForAtlas(true);
    init3DGlobe();
  } else {
    btnProj2D?.classList.add('active');
    btnProj3D?.classList.remove('active');
    mapCanvas?.classList.remove('hidden');
    globeCanvas?.classList.add('hidden');

    destroy3DGlobe();
    setBackgroundVideoPausedForAtlas(false);
    init2DMap();
  }
}

// ----------------------------------------------------------------------------
// 2. INICIALIZACIÓN DE EVENTOS DEL ATLAS
// ----------------------------------------------------------------------------
export function initAtlasEvents() {
  if (atlasEventsInitialized) return;
  atlasEventsInitialized = true;

  document.getElementById('btn-proj-3d')?.addEventListener('click', () => {
    state.mapProjectionMode = '3d';
    initOrUpdateAtlas();
  });

  document.getElementById('btn-proj-2d')?.addEventListener('click', () => {
    state.mapProjectionMode = '2d';
    initOrUpdateAtlas();
  });

  document.querySelectorAll('.map-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.map-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.mapTypeFilter = btn.dataset.maptype;
      initOrUpdateAtlas();
    });
  });

  document.querySelectorAll('.map-epoch-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.map-epoch-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.mapEpochFilter = btn.dataset.epoch;
      initOrUpdateAtlas();
    });
  });

  const epochSelect = document.getElementById('map-epoch-select');
  epochSelect?.addEventListener('change', (e) => {
    state.mapEpochFilter = e.target.value;
    initOrUpdateAtlas();
  });
}

// ----------------------------------------------------------------------------
// 3. GLOBO 3D WEBGL OPTIMIZADO (SIN GIRO CONTINUO + 0.0% GPU EN REPOSO)
// ----------------------------------------------------------------------------
function openCountryDetail(d) {
  openDayInspectorModal(d.country, d.items);
}

function init3DGlobe() {
  const countryGroups = getCountryAggregatedData();
  const globePoints = [];

  for (const [countryName, items] of Object.entries(countryGroups)) {
    const coords = COUNTRY_COORDINATES[countryName];
    if (!coords) continue;

    const types = new Set(items.map(i => i.type));
    let dominantType = 'mixed';
    if (types.size === 1) {
      dominantType = types.has('book') ? 'book' : (types.has('movie') ? 'movie' : 'music');
    }

    globePoints.push({
      lat: coords[0],
      lng: coords[1],
      country: countryName,
      cleanCountryName: cleanAccentsFor3D(countryName),
      count: items.length,
      flag: COUNTRY_FLAGS[countryName] || '',
      type: dominantType,
      items: items
    });
  }

  if (!globeInstance) {
    const container = document.getElementById('cultural-globe-canvas');
    if (!container) return;
    container.innerHTML = '';

    globeInstance = Globe({
      rendererConfig: {
        antialias: false,
        alpha: true,
        powerPreference: 'default'
      },
      animateIn: false
    })(container)
      .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
      .bumpImageUrl('https://unpkg.com/three-globe/example/img/earth-topology.png')
      .backgroundImageUrl('https://unpkg.com/three-globe/example/img/night-sky.png')
      .showAtmosphere(true)
      .atmosphereColor('#e4e4e7')
      .atmosphereAltitude(0.18)
      .pointsData(globePoints)
      .pointLat(d => d.lat)
      .pointLng(d => d.lng)
      .pointColor(d => {
        if (d.type === 'book') return '#3b82f6';
        if (d.type === 'movie') return '#ef4444';
        if (d.type === 'music') return '#a855f7';
        return '#f59e0b';
      })
      .pointAltitude(0.01)
      .pointRadius(0.9)
      .onPointClick(d => openCountryDetail(d))
      .labelsData(globePoints)
      .labelLat(d => d.lat)
      .labelLng(d => d.lng)
      .labelText(d => `${d.cleanCountryName} (${d.count})`)
      .labelSize(1.3)
      .labelDotRadius(0.35)
      .labelColor(() => '#ffffff')
      .labelResolution(1.5)
      .labelAltitude(0.02)
      .onLabelClick(d => openCountryDetail(d))
      .onGlobeReady(() => {
        scheduleGlobeSleep(1200);
      });

    globeInstance.controls().autoRotate = false;
    globeInstance.controls().enableDamping = false;
    globeInstance.controls().enableZoom = true;
    globeInstance.pointOfView({ lat: 25, lng: 10, altitude: 2.2 });

    if (typeof globeInstance.renderer === 'function') {
      const r = globeInstance.renderer();
      if (r) r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.15));
    }

    const onInteract = () => wakeGlobeBriefly();
    container.addEventListener('pointerdown', onInteract);
    container.addEventListener('pointermove', onInteract);
    container.addEventListener('wheel', onInteract, { passive: true });

    container.__atlasCleaners = () => {
      container.removeEventListener('pointerdown', onInteract);
      container.removeEventListener('pointermove', onInteract);
      container.removeEventListener('wheel', onInteract);
    };

    scheduleGlobeSleep(2500);
  } else {
    globeInstance.pointsData(globePoints);
    globeInstance.labelsData(globePoints);
    wakeGlobeBriefly();

    setTimeout(() => {
      const container = document.getElementById('cultural-globe-canvas');
      if (container && globeInstance) {
        globeInstance.width(container.clientWidth);
        globeInstance.height(container.clientHeight);
      }
    }, 150);
  }
}

// ----------------------------------------------------------------------------
// 4. MAPA 2D GEOPOLÍTICO MINIMALISTA (LEAFLET - SOLO PINES, SIN POLÍGONOS)
// ----------------------------------------------------------------------------
function init2DMap() {
  if (!culturalMap) {
    const southWest = L.latLng(-85, -180);
    const northEast = L.latLng(85, 180);
    const worldBounds = L.latLngBounds(southWest, northEast);

    culturalMap = L.map('cultural-map-canvas', {
      center: [25.0, 10.0],
      zoom: 2,
      minZoom: 2,
      maxZoom: 6,
      maxBounds: worldBounds,
      maxBoundsViscosity: 1.0,
      worldCopyJump: false,
      zoomControl: true,
      attributionControl: false
    });

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 6,
      minZoom: 2,
      noWrap: true,
      bounds: worldBounds,
      attribution: ''
    }).addTo(culturalMap);

    mapMarkersGroup = L.layerGroup().addTo(culturalMap);

    culturalMap.on('zoomend', () => {
      render2DMapMarkers();
    });

    culturalMap.on('popupopen', () => {
      refreshLucide();
    });

    const mapContainer = culturalMap.getContainer();
    mapContainer.addEventListener('click', (e) => {
      const itemEl = e.target.closest('.map-popup-item');
      if (itemEl && itemEl.dataset.id) {
        culturalMap.closePopup();
        openDetailModal(itemEl.dataset.id);
      }
    });
  }

  setTimeout(() => {
    if (!culturalMap) return;
    culturalMap.invalidateSize();
    render2DMapMarkers();
  }, 150);
}

function render2DMapMarkers() {
  if (!mapMarkersGroup || !culturalMap) return;
  mapMarkersGroup.clearLayers();

  const countryGroups = getCountryAggregatedData();
  const currentZoom = culturalMap.getZoom();
  const isCompact = currentZoom <= 3;

  for (const [countryName, items] of Object.entries(countryGroups)) {
    const coords = COUNTRY_COORDINATES[countryName];
    if (!coords) continue;

    const types = new Set(items.map(i => i.type));
    let dominantType = 'mixed';
    if (types.size === 1) {
      dominantType = types.has('book') ? 'book' : (types.has('movie') ? 'movie' : 'music');
    }

    const flag = COUNTRY_FLAGS[countryName] || '';
    const safeCountry = escapeHtml(countryName);
    const pinTitle = `${safeCountry}: ${items.length} obra(s)`;

    const pinHtml = isCompact
      ? `<div class="pin-bubble compact type-${dominantType}" title="${pinTitle}">
           <span>📍 ${flag}</span>
           <span class="pin-count-badge">${items.length}</span>
         </div>`
      : `<div class="pin-bubble full type-${dominantType}" title="${pinTitle}">
           <span>📍 ${flag}</span>
           <span class="pin-country-title">${safeCountry}</span>
           <span class="pin-count-badge">${items.length}</span>
         </div>`;

    const pinIcon = L.divIcon({
      className: 'cultural-pin-marker',
      html: pinHtml,
      iconSize: null
    });

    const marker = L.marker(coords, { icon: pinIcon });

    let popupItemsHtml = '';
    items.forEach(it => {
      const fallback = 'https://images.unsplash.com/photo-1512820790803-83ca734da794?w=400&q=80';
      const cover = isValidCover(it.coverUrl) ? it.coverUrl : fallback;
      const creator = it.details?.author || it.details?.director || it.details?.artist || it.creator || '';
      const statusIcon = getStatusIconName(it.type, it.status);

      popupItemsHtml += `
        <div class="map-popup-item" data-id="${escapeHtml(it.id)}">
          <img src="${escapeHtml(cover)}" class="map-popup-thumb" loading="lazy" decoding="async" onerror="this.style.display='none';" />
          <div style="overflow:hidden;">
            <div class="map-popup-title"><i data-lucide="${statusIcon}"></i> ${escapeHtml(it.title)}</div>
            <div class="map-popup-creator">${escapeHtml(creator)} (${escapeHtml(String(it.releaseYear || '-'))})</div>
          </div>
        </div>
      `;
    });

    const popupHtml = `
      <div class="map-popup-box">
        <div class="map-popup-header">📍 ${flag} ${safeCountry} (${items.length} obra/s)</div>
        <div class="map-popup-list">${popupItemsHtml}</div>
      </div>
    `;

    marker.bindPopup(popupHtml, { closeButton: false, offset: [0, -10] });
    mapMarkersGroup.addLayer(marker);
  }

  refreshLucide();
}

export function invalidateAtlasSizes() {
  const mapView = document.getElementById('map-view');
  if (mapView && mapView.classList.contains('hidden')) return;

  if (culturalMap) {
    setTimeout(() => {
      if (culturalMap) culturalMap.invalidateSize();
    }, 150);
  }
  if (globeInstance) {
    setTimeout(() => {
      const container = document.getElementById('cultural-globe-canvas');
      if (container && globeInstance) {
        globeInstance.width(container.clientWidth);
        globeInstance.height(container.clientHeight);
      }
    }, 150);
  }
}