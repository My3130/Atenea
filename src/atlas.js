// ============================================================================
// ATLAS.JS - Globo 3D WebGL y Mapa 2D Geopolítico Limpio (Zero Watermarks)
//          + Carga Local Offline (src/assets/world.geojson)
//          + Suspensión Automática de GPU por MutationObserver y Delegación
//          + Detección Universal de Portadas (HTTP, Blob, Data-URI y Local)
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
let geoJsonLayer = null; // Capa vectorial estática independiente para polígonos 2D
let globeInstance = null;
let cachedGeoJsonCountries = null;
let isObserverAttached = false;
let atlasEventsInitialized = false; // Guarda contra acumulación de eventos

const GEOJSON_CACHE_KEY = 'atenea_cached_world_geojson';
const mapStatsText = document.getElementById('map-stats-text');

/**
 * Valida si la URL de la portada es válida (HTTP, HTTPS, Blob URL, Data-URI o ruta local).
 * @param {string|null|undefined} url 
 * @returns {boolean}
 */
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

// ----------------------------------------------------------------------------
// 0. GOBERNADOR DE GPU: SUSPENSIÓN REACTIVA DEL MOTOR THREE.JS
// ----------------------------------------------------------------------------
function ensureAtlasVisibilityObserver() {
  if (isObserverAttached) return;
  const mapView = document.getElementById('map-view');
  if (!mapView) return;

  const observer = new MutationObserver(() => {
    const isHidden = mapView.classList.contains('hidden');
    if (isHidden) {
      // Apagar inmediatamente el bucle requestAnimationFrame de Three.js
      if (globeInstance && typeof globeInstance.pauseAnimation === 'function') {
        globeInstance.pauseAnimation();
      }
    } else {
      // Reanudar el motor 3D únicamente si está en proyección 3D
      if (state.mapProjectionMode === '3d' && globeInstance && typeof globeInstance.resumeAnimation === 'function') {
        globeInstance.resumeAnimation();
      }
    }
  });

  observer.observe(mapView, { attributes: true, attributeFilter: ['class'] });
  isObserverAttached = true;
}

// ----------------------------------------------------------------------------
// 1. MOTOR DE AGREGACIÓN GEOGRÁFICA Y TEMPORAL
// ----------------------------------------------------------------------------
export function getCountryAggregatedData() {
  const filteredItems = library.filter(it => {
    // A) Filtro por Disciplina (Libro, Cine, Música, Todos)
    if (state.mapTypeFilter !== 'all' && it.type !== state.mapTypeFilter) return false;

    // B) Filtro Temporal por Épocas / Siglos
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

    if (globeInstance) {
      if (typeof globeInstance.resumeAnimation === 'function') globeInstance.resumeAnimation();
      globeInstance.controls().autoRotate = true;
    }
    init3DGlobe();
  } else {
    btnProj2D?.classList.add('active');
    btnProj3D?.classList.remove('active');
    mapCanvas?.classList.remove('hidden');
    globeCanvas?.classList.add('hidden');

    if (globeInstance) {
      globeInstance.controls().autoRotate = false;
      if (typeof globeInstance.pauseAnimation === 'function') globeInstance.pauseAnimation();
    }
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

  // Filtro por Medio / Disciplina
  document.querySelectorAll('.map-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.map-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.mapTypeFilter = btn.dataset.maptype;
      initOrUpdateAtlas();
    });
  });

  // Filtro Temporal por Épocas Históricas
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
// 3. GLOBO 3D WEBGL (THREE.JS AISLADO Y CONFIGURACIÓN UNIFICADA DE POLÍGONOS)
// ----------------------------------------------------------------------------
function applyGlobePolygons(globe, countryGroups) {
  if (!globe || !cachedGeoJsonCountries?.features) return;

  globe
    .polygonsData(cachedGeoJsonCountries.features)
    .polygonAltitude(0.006)
    .polygonCapColor(feat => {
      const rawName = feat.properties.NAME || feat.properties.ADMIN;
      const canonicalGeoName = canonicalizeCountry(rawName);
      return countryGroups[canonicalGeoName]
        ? 'rgba(124, 58, 237, 0.38)'
        : 'rgba(20, 20, 25, 0.05)';
    })
    .polygonSideColor(() => 'rgba(0, 0, 0, 0.15)')
    .polygonStrokeColor(() => 'rgba(180, 180, 210, 0.45)')
    .polygonLabel(({ properties: d }) => `<b>${escapeHtml(canonicalizeCountry(d.NAME || d.ADMIN))}</b>`);
}

/**
 * Carga de datos vectoriales GeoJSON:
 * 1. Intenta cargar desde el archivo local offline en `src/assets/world.geojson`.
 * 2. Si no lo encuentra, usa la caché en memoria local (localStorage).
 * 3. Fallback de red como último recurso.
 */
async function loadGeoJsonWithCache() {
  if (cachedGeoJsonCountries) return cachedGeoJsonCountries;

  // Intento 1: Carga desde archivo local estático (100% Offline)
  try {
    const localAssetRes = await fetch('./assets/world.geojson');
    if (localAssetRes.ok) {
      cachedGeoJsonCountries = await localAssetRes.json();
      return cachedGeoJsonCountries;
    }
  } catch (e) {}

  // Intento 2: Recuperar de la memoria local persistente
  try {
    const localData = localStorage.getItem(GEOJSON_CACHE_KEY);
    if (localData) {
      cachedGeoJsonCountries = JSON.parse(localData);
      return cachedGeoJsonCountries;
    }
  } catch (e) {}

  // Intento 3: Descargar de la red y guardar en caché local como fallback
  try {
    const res = await fetch('https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson');
    if (res.ok) {
      const data = await res.json();
      cachedGeoJsonCountries = data;
      try {
        localStorage.setItem(GEOJSON_CACHE_KEY, JSON.stringify(data));
      } catch (e) {}
      return cachedGeoJsonCountries;
    }
  } catch (e) {}

  return null;
}

async function init3DGlobe() {
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

  await loadGeoJsonWithCache();

  if (!globeInstance) {
    const container = document.getElementById('cultural-globe-canvas');
    if (!container) return;
    container.innerHTML = '';

    globeInstance = Globe()(container)
      .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
      .bumpImageUrl('https://unpkg.com/three-globe/example/img/earth-topology.png')
      .backgroundImageUrl('https://unpkg.com/three-globe/example/img/night-sky.png')
      .showAtmosphere(true)
      .atmosphereColor('#6366f1')
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
      .labelResolution(3)
      .labelAltitude(0.02)
      .onLabelClick(d => openCountryDetail(d));

    applyGlobePolygons(globeInstance, countryGroups);

    globeInstance.controls().autoRotate = true;
    globeInstance.controls().autoRotateSpeed = 0.4;
    globeInstance.controls().enableZoom = true;
    globeInstance.pointOfView({ lat: 25, lng: 10, altitude: 2.2 });
  } else {
    globeInstance.pointsData(globePoints);
    globeInstance.labelsData(globePoints);
    applyGlobePolygons(globeInstance, countryGroups);

    setTimeout(() => {
      const container = document.getElementById('cultural-globe-canvas');
      if (container && globeInstance) {
        globeInstance.width(container.clientWidth);
        globeInstance.height(container.clientHeight);
      }
    }, 150);
  }
}

function openCountryDetail(d) {
  openDayInspectorModal(d.country, d.items);
}

// ----------------------------------------------------------------------------
// 4. MAPA 2D GEOPOLÍTICO (LEAFLET OPTIMIZADO Y BLINDADO ANTI-XSS)
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

  setTimeout(async () => {
    culturalMap.invalidateSize();
    await loadGeoJsonWithCache();
    const countryGroups = getCountryAggregatedData();
    updateGeoJsonPolygons(countryGroups);
    render2DMapMarkers();
  }, 150);
}

function updateGeoJsonPolygons(countryGroups) {
  if (!culturalMap) return;

  if (geoJsonLayer) {
    culturalMap.removeLayer(geoJsonLayer);
    geoJsonLayer = null;
  }

  if (cachedGeoJsonCountries) {
    geoJsonLayer = L.geoJSON(cachedGeoJsonCountries, {
      style: function (feature) {
        const rawName = feature.properties.NAME || feature.properties.ADMIN;
        const canonicalGeoName = canonicalizeCountry(rawName);
        const isExplored = Boolean(countryGroups[canonicalGeoName]);
        return {
          color: isExplored ? '#7c3aed' : '#3a3a48',
          weight: isExplored ? 1.8 : 0.8,
          fillColor: isExplored ? '#7c3aed' : '#141418',
          fillOpacity: isExplored ? 0.35 : 0.04
        };
      }
    }).addTo(culturalMap);

    if (geoJsonLayer.bringToBack) {
      geoJsonLayer.bringToBack();
    }
  }
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
    setTimeout(() => culturalMap.invalidateSize(), 150);
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