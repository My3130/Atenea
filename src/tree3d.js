// ============================================================================
// TREE3D.JS - Árbol Celestial Híbrido (Edición Final Paso 4)
//             + Títulos de Obras Siempre Visibles (Limpios y Ligeros)
//             + Iluminación Selectiva de Constelaciones (Sin Líneas ni Saturación)
//             + Etiquetas/Autor Dinámicas por Hover o Zoom de Proximidad
//             + Actualización Diferencial (0 Reinicios) & 0.0% GPU en Reposo
// ============================================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { openDetailModal } from './modals.js';

let scene = null;
let camera = null;
let renderer = null;
let controls = null;
let activeContainer = null;
let resizeObserver = null;
let isMounted = false;
let isLoadingModel = false;

// Estado en caché para actualizaciones sin recargar el tronco .glb
let savedBranchAnchors = [];
let savedTreeHeight = 0;
let savedWorldBox = null;
let lastRenderedSignature = '';

// Grupo exclusivo para estrellas/etiquetas
let starsGroup = null;
const starDisposables = [];

// Tope de 60 FPS durante movimiento
let isRenderPending = false;
let isThrottleQueued = false;
let lastRenderTime = 0;

// Objetos interactivos y sistemas de etiquetas
let starPointsMesh = null;
let starDataList = []; // { item, position, index, titleSprite, titleMat }
let hoveredStarIndex = -1;
let zoomMetaPool = []; // Pool de 3 fichas reutilizables para etiquetas en hover/zoom

// Colores calibrados (Sin saturación ni blanco quemado)
const COL_STAR_NORMAL = new THREE.Color(0.84, 0.86, 0.82);   // Blanco marfil suave
const COL_STAR_ACTIVE = new THREE.Color(1.00, 0.84, 0.44);   // Oro cálido protagonista
const COL_STAR_LINKED = new THREE.Color(0.96, 0.88, 0.62);   // Dorado suave en hermanas
const COL_STAR_DIMMED = new THREE.Color(0.20, 0.22, 0.21);   // Atenuado elegante en fondo

const envDisposables = [];

export function requestTreeRender() {
  if (!isMounted || !renderer || !scene || !camera) return;

  const now = performance.now();
  const elapsed = now - lastRenderTime;

  const renderFrame = () => {
    updateProximityMetadata();
    renderer.render(scene, camera);
  };

  if (elapsed >= 16) {
    if (!isRenderPending) {
      isRenderPending = true;
      requestAnimationFrame(() => {
        isRenderPending = false;
        if (!isMounted || !renderer) return;
        lastRenderTime = performance.now();
        renderFrame();
      });
    }
  } else if (!isThrottleQueued) {
    isThrottleQueued = true;
    setTimeout(() => {
      isThrottleQueued = false;
      if (!isMounted || !renderer) return;
      lastRenderTime = performance.now();
      renderFrame();
    }, Math.max(1, 16 - elapsed));
  }
}

function computeItemsSignature(items = []) {
  return items
    .map(i => `${i.id}:${i.title || ''}:${i.userRating || 0}:${(i.tags || []).join(',')}:${i.country || ''}`)
    .join('|');
}

// ----------------------------------------------------------------------------
// 1. TEXTURAS PROCEDURALES
// ----------------------------------------------------------------------------
function createCelestialStarTexture(targetPool) {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');

  const grad = ctx.createRadialGradient(48, 48, 0, 48, 48, 48);
  grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
  grad.addColorStop(0.20, 'rgba(255, 248, 220, 0.90)');
  grad.addColorStop(0.48, 'rgba(155, 240, 190, 0.36)');
  grad.addColorStop(0.80, 'rgba(65, 175, 115, 0.09)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 96, 96);
  const texture = new THREE.CanvasTexture(canvas);
  targetPool.push(texture);
  return texture;
}

function createGreenMistTexture(targetPool) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(72, 220, 140, 0.28)');
  grad.addColorStop(0.38, 'rgba(52, 185, 115, 0.14)');
  grad.addColorStop(0.72, 'rgba(30, 120, 75, 0.04)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  const texture = new THREE.CanvasTexture(canvas);
  targetPool.push(texture);
  return texture;
}

/**
 * Crea un sprite ligero y compacto únicamente con el título de la obra.
 */
function createWorkTitleSprite(rawTitle) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 48;
  const ctx = canvas.getContext('2d');

  const cleanTitle = (rawTitle || 'Sin título').trim();
  const displayTitle = cleanTitle.length > 24 ? `${cleanTitle.slice(0, 22)}…` : cleanTitle;

  ctx.font = '600 18px "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillStyle = '#eef4f0';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
  ctx.shadowBlur = 5;
  ctx.fillText(displayTitle, 8, 30);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  starDisposables.push(texture);

  const spriteMat = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 0.76,
    depthWrite: false
  });
  starDisposables.push(spriteMat);

  const sprite = new THREE.Sprite(spriteMat);
  const baseScale = savedTreeHeight || 8;
  sprite.scale.set(baseScale * 0.17, baseScale * 0.032, 1);
  return { sprite, mat: spriteMat };
}

/**
 * Crea una ficha reutilizable de etiquetas/autor (oculta hasta Hover o Zoom cercano).
 */
function createPooledMetaSprite() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 84;

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  starDisposables.push(texture);

  const mat = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 0,
    depthWrite: false
  });
  starDisposables.push(mat);

  const sprite = new THREE.Sprite(mat);
  const baseScale = savedTreeHeight || 8;
  sprite.scale.set(baseScale * 0.25, baseScale * 0.041, 1);

  return { sprite, mat, canvas, texture, assignedStarIdx: -1 };
}

function drawMetaIntoPoolSlot(slot, starNode) {
  if (slot.assignedStarIdx === starNode.index) return;
  slot.assignedStarIdx = starNode.index;

  const item = starNode.item;
  const ctx = slot.canvas.getContext('2d');
  ctx.clearRect(0, 0, slot.canvas.width, slot.canvas.height);

  const creator = item.details?.author || item.details?.director || item.details?.artist || item.creator || 'Autor';
  const year = item.releaseYear || '';
  const country = item.country || '';
  const line1 = [creator, year, country].filter(Boolean).join(' · ');

  const tags = Array.isArray(item.tags) && item.tags.length > 0
    ? item.tags.slice(0, 4).map(t => `#${t}`).join('  ')
    : '';

  ctx.font = '600 20px monospace';
  ctx.fillStyle = '#ffe28a';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.98)';
  ctx.shadowBlur = 5;
  ctx.fillText(line1.slice(0, 46), 10, 28);

  if (tags) {
    ctx.font = '500 18px "Inter", -apple-system, sans-serif';
    ctx.fillStyle = '#8fe8b8';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.98)';
    ctx.shadowBlur = 5;
    ctx.fillText(tags.slice(0, 52), 10, 62);
  }

  slot.texture.needsUpdate = true;
}

// ----------------------------------------------------------------------------
// 2. MONTAJE INTELIGENTE (SIN REINICIOS INNECESARIOS)
// ----------------------------------------------------------------------------
export async function mountTree3D(container, libraryItems = [], onPowerOff = null) {
  const newSignature = computeItemsSignature(libraryItems);

  if (isMounted && renderer && scene && activeContainer === container) {
    if (newSignature === lastRenderedSignature) {
      return;
    }
    if (!isLoadingModel && savedBranchAnchors.length > 0) {
      lastRenderedSignature = newSignature;
      rebuildStarsLayer(libraryItems);
      requestTreeRender();
      return;
    }
  }

  destroyTree3D();

  activeContainer = container;
  isMounted = true;
  isLoadingModel = true;
  lastRenderedSignature = newSignature;
  container.innerHTML = '';

  const width = container.clientWidth || window.innerWidth;
  const height = container.clientHeight || window.innerHeight;

  scene = new THREE.Scene();
  scene.background = new THREE.Color('#030605');
  scene.fog = new THREE.FogExp2('#030605', 0.012);

  camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 200);

  renderer = new THREE.WebGLRenderer({
    antialias: false,
    powerPreference: 'default'
  });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  container.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  controls.maxPolarAngle = Math.PI / 2 + 0.05;
  controls.autoRotate = false;
  controls.addEventListener('change', requestTreeRender);

  const ambientLight = new THREE.AmbientLight('#1a2920', 1.45);
  scene.add(ambientLight);

  const topLight = new THREE.DirectionalLight('#e0ece0', 1.55);
  topLight.position.set(5, 14, 5);
  scene.add(topLight);

  const rightFill = new THREE.DirectionalLight('#ccb995', 1.05);
  rightFill.position.set(9, 6, 3);
  scene.add(rightFill);

  const rimLight = new THREE.DirectionalLight('#4fc78a', 1.0);
  rimLight.position.set(-6, 6, -6);
  scene.add(rimLight);

  starsGroup = new THREE.Group();
  scene.add(starsGroup);

  const loader = new GLTFLoader();
  const maxAnisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());

  loader.load(
    './assets/tree.glb',
    (gltf) => {
      isLoadingModel = false;
      if (!isMounted) return;

      const model = gltf.scene;

      const initialBox = new THREE.Box3().setFromObject(model);
      const center = initialBox.getCenter(new THREE.Vector3());

      model.position.x = -center.x;
      model.position.z = -center.z;
      model.position.y = -initialBox.min.y;

      scene.add(model);
      scene.updateMatrixWorld(true);

      savedWorldBox = new THREE.Box3().setFromObject(model);
      savedTreeHeight = savedWorldBox.max.y - savedWorldBox.min.y;

      controls.minDistance = savedTreeHeight * 0.40;
      controls.maxDistance = savedTreeHeight * 3.8;
      controls.target.set(0, savedTreeHeight * 0.60, 0);
      camera.position.set(0, savedTreeHeight * 0.68, savedTreeHeight * 1.95);
      controls.update();

      const innerForkY = savedWorldBox.min.y + savedTreeHeight * 0.48;
      const innerGlowLight = new THREE.PointLight('#4ade80', 1.45, savedTreeHeight * 1.4, 1.7);
      innerGlowLight.position.set(0, innerForkY, 0.2);
      scene.add(innerGlowLight);

      savedBranchAnchors = [];
      const rootAnchors = [];
      const branchCutoffY = savedWorldBox.min.y + savedTreeHeight * 0.46;
      const rootCutoffY = savedWorldBox.min.y + savedTreeHeight * 0.16;

      model.traverse((child) => {
        if (child.isMesh) {
          if (child.material) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach(mat => {
              envDisposables.push(mat);
              if (mat.map) {
                mat.map.anisotropy = maxAnisotropy;
                envDisposables.push(mat.map);
              }
              ['normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'].forEach(k => {
                if (mat[k]) envDisposables.push(mat[k]);
              });
            });
          }

          if (child.geometry) {
            envDisposables.push(child.geometry);
            const pos = child.geometry.attributes.position;
            const matrix = child.matrixWorld;
            const v = new THREE.Vector3();

            for (let i = 0; i < pos.count; i += 4) {
              v.fromBufferAttribute(pos, i);
              v.applyMatrix4(matrix);

              if (v.y > branchCutoffY) {
                savedBranchAnchors.push(v.clone());
              } else if (v.y < rootCutoffY) {
                rootAnchors.push(v.clone());
              }
            }
          }
        }
      });

      buildEnvironmentFoliage(savedBranchAnchors, rootAnchors, savedTreeHeight, savedWorldBox);
      rebuildStarsLayer(libraryItems);
      addPowerOffButton(container, onPowerOff);

      requestTreeRender();
    },
    undefined,
    (err) => {
      isLoadingModel = false;
      console.error('Error al cargar ./assets/tree.glb:', err);
      container.innerHTML = `<div style="display:flex; height:100%; align-items:center; justify-content:center; color:#ff7b7b;">No se encontró src/assets/tree.glb.</div>`;
    }
  );

  setupInteractionEvents(container);
}

// ----------------------------------------------------------------------------
// 3. CAPA AMBIENTAL FIJA (NIEBLA VERDE, ROCÍO Y RAÍCES)
// ----------------------------------------------------------------------------
function buildEnvironmentFoliage(branchAnchors, rootAnchors, treeHeight, worldBox) {
  if (branchAnchors.length === 0) return;

  const starTexture = createCelestialStarTexture(envDisposables);
  const mistTexture = createGreenMistTexture(envDisposables);

  const mistCount = 12;
  for (let m = 0; m < mistCount; m++) {
    const anchor = branchAnchors[Math.floor((m / mistCount) * branchAnchors.length)];
    const mistMat = new THREE.SpriteMaterial({
      map: mistTexture,
      transparent: true,
      opacity: 0.30,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    envDisposables.push(mistMat);

    const mistSprite = new THREE.Sprite(mistMat);
    const scale = treeHeight * (0.42 + Math.random() * 0.42);
    mistSprite.scale.set(scale * 1.45, scale * 0.85, 1);
    mistSprite.position.set(
      anchor.x + (Math.random() - 0.5) * 1.1,
      anchor.y + 0.25 + Math.random() * 0.55,
      anchor.z - 0.2 + (Math.random() - 0.5) * 0.8
    );
    scene.add(mistSprite);
  }

  const dustCount = 5500;
  const dustPos = new Float32Array(dustCount * 3);
  const dustCol = new Float32Array(dustCount * 3);

  const colorEmerald = new THREE.Color('#4ef59b');
  const colorMint = new THREE.Color('#8affcb');
  const colorWarmGold = new THREE.Color('#ffe594');

  for (let i = 0; i < dustCount; i++) {
    const anchor = branchAnchors[Math.floor(Math.random() * branchAnchors.length)];
    const spreadRad = Math.pow(Math.random(), 1.6) * (treeHeight * 0.26);
    const angle = Math.random() * Math.PI * 2;

    dustPos[i * 3] = anchor.x + Math.cos(angle) * spreadRad;
    dustPos[i * 3 + 1] = anchor.y + Math.random() * (treeHeight * 0.28);
    dustPos[i * 3 + 2] = anchor.z + Math.sin(angle) * spreadRad;

    const r = Math.random();
    const c = r < 0.50 ? colorEmerald : (r < 0.82 ? colorMint : colorWarmGold);

    dustCol[i * 3] = c.r;
    dustCol[i * 3 + 1] = c.g;
    dustCol[i * 3 + 2] = c.b;
  }

  const dustGeom = new THREE.BufferGeometry();
  dustGeom.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  dustGeom.setAttribute('color', new THREE.BufferAttribute(dustCol, 3));
  envDisposables.push(dustGeom);

  const dustMat = new THREE.PointsMaterial({
    size: 0.09,
    map: starTexture,
    vertexColors: true,
    transparent: true,
    opacity: 0.75,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  envDisposables.push(dustMat);
  scene.add(new THREE.Points(dustGeom, dustMat));

  if (rootAnchors.length > 0) {
    const rootCount = 700;
    const rPos = new Float32Array(rootCount * 3);
    const rCol = new Float32Array(rootCount * 3);
    for (let i = 0; i < rootCount; i++) {
      const rAnchor = rootAnchors[Math.floor(Math.random() * rootAnchors.length)];
      const angle = Math.random() * Math.PI * 2;
      const rSpread = Math.random() * (treeHeight * 0.08);
      rPos[i * 3] = rAnchor.x + Math.cos(angle) * rSpread;
      rPos[i * 3 + 1] = rAnchor.y + Math.random() * 0.08;
      rPos[i * 3 + 2] = rAnchor.z + Math.sin(angle) * rSpread;
      rCol[i * 3] = colorEmerald.r * 0.85;
      rCol[i * 3 + 1] = colorEmerald.g * 0.95;
      rCol[i * 3 + 2] = colorEmerald.b * 0.85;
    }
    const rootGeom = new THREE.BufferGeometry();
    rootGeom.setAttribute('position', new THREE.BufferAttribute(rPos, 3));
    rootGeom.setAttribute('color', new THREE.BufferAttribute(rCol, 3));
    envDisposables.push(rootGeom);

    const rootMat = new THREE.PointsMaterial({
      size: 0.07,
      map: starTexture,
      vertexColors: true,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    envDisposables.push(rootMat);
    scene.add(new THREE.Points(rootGeom, rootMat));
  }
}

// ----------------------------------------------------------------------------
// 4. CAPA ESTELAR: TÍTULOS SIEMPRE VISIBLES + POOL DE ETIQUETAS
// ----------------------------------------------------------------------------
function clearStarsLayer() {
  hoveredStarIndex = -1;
  starPointsMesh = null;
  starDataList = [];
  zoomMetaPool = [];

  if (starsGroup) {
    while (starsGroup.children.length > 0) {
      starsGroup.remove(starsGroup.children[0]);
    }
  }

  starDisposables.forEach(item => {
    if (item && typeof item.dispose === 'function') {
      try { item.dispose(); } catch (e) {}
    }
  });
  starDisposables.length = 0;
}

function rebuildStarsLayer(libraryItems) {
  clearStarsLayer();
  if (!starsGroup || savedBranchAnchors.length === 0 || !savedWorldBox) return;

  const starCount = libraryItems.length;
  if (starCount === 0) return;

  const starTexture = createCelestialStarTexture(starDisposables);
  const starPositions = [];
  const starColors = [];

  const branchCount = Math.floor(starCount * 0.40);
  const roofCount = starCount - branchCount;

  const roofBaseY = savedWorldBox.min.y + savedTreeHeight * 0.86;
  const maxRoofRadius = savedTreeHeight * 0.72;
  const step = Math.max(1, Math.floor(savedBranchAnchors.length / Math.max(1, branchCount)));

  for (let i = 0; i < starCount; i++) {
    const item = libraryItems[i];
    let pos;

    if (i < branchCount) {
      const anchorIdx = (i * step + Math.floor((i * 13) % Math.min(15, step))) % savedBranchAnchors.length;
      const anchor = savedBranchAnchors[anchorIdx];
      const angle = i * 2.399963;
      const rad = (0.08 + ((i * 0.37) % 1) * 0.14) * savedTreeHeight;

      pos = new THREE.Vector3(
        anchor.x + Math.cos(angle) * rad,
        anchor.y + (0.04 + ((i * 0.61) % 1) * 0.12) * savedTreeHeight,
        anchor.z + Math.sin(angle) * rad
      );
    } else {
      const roofIdx = i - branchCount;
      const t = (roofIdx + 0.5) / Math.max(1, roofCount);
      const radius = Math.sqrt(t) * maxRoofRadius + (savedTreeHeight * 0.08);
      const angle = roofIdx * 2.399963;

      const archHeight = (1 - t * 0.45) * (savedTreeHeight * 0.25);
      const jitterY = (((i * 0.73) % 1) - 0.5) * (savedTreeHeight * 0.08);

      pos = new THREE.Vector3(
        Math.cos(angle) * radius,
        roofBaseY + archHeight + jitterY,
        Math.sin(angle) * radius * 0.72
      );
    }

    starPositions.push(pos);
    starColors.push(COL_STAR_NORMAL.r, COL_STAR_NORMAL.g, COL_STAR_NORMAL.b);

    // Crear el título minimalista siempre visible para cada obra
    const { sprite: titleSprite, mat: titleMat } = createWorkTitleSprite(item.title);
    titleSprite.position.set(
      pos.x + (savedTreeHeight * 0.045),
      pos.y + (savedTreeHeight * 0.015),
      pos.z
    );
    starsGroup.add(titleSprite);

    starDataList.push({ item, position: pos, index: i, titleSprite, titleMat });
  }

  const starGeom = new THREE.BufferGeometry().setFromPoints(starPositions);
  starGeom.setAttribute('color', new THREE.Float32BufferAttribute(starColors, 3));
  starDisposables.push(starGeom);

  const starMat = new THREE.PointsMaterial({
    size: savedTreeHeight * 0.082,
    map: starTexture,
    vertexColors: true,
    transparent: true,
    opacity: 0.96,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  starDisposables.push(starMat);

  starPointsMesh = new THREE.Points(starGeom, starMat);
  starsGroup.add(starPointsMesh);

  // Pool de 3 fichas reutilizables para etiquetas de autor y temas (Hover / Zoom)
  for (let p = 0; p < 3; p++) {
    const slot = createPooledMetaSprite();
    starsGroup.add(slot.sprite);
    zoomMetaPool.push(slot);
  }
}

// ----------------------------------------------------------------------------
// 5. ILUMINACIÓN SELECTIVA DE CONSTELACIONES (SIN LÍNEAS NI SATURACIÓN)
// ----------------------------------------------------------------------------
function areItemsRelated(itemA, itemB) {
  const creatorA = (itemA.details?.author || itemA.details?.director || itemA.details?.artist || itemA.creator || '').toLowerCase().trim();
  const creatorB = (itemB.details?.author || itemB.details?.director || itemB.details?.artist || itemB.creator || '').toLowerCase().trim();
  if (creatorA && creatorB && creatorA === creatorB) return true;

  const countryA = (itemA.country || '').toLowerCase().trim();
  const countryB = (itemB.country || '').toLowerCase().trim();
  if (countryA && countryB && countryA === countryB) return true;

  const tagsA = Array.isArray(itemA.tags) ? itemA.tags.map(t => t.toLowerCase()) : [];
  if (tagsA.length > 0 && Array.isArray(itemB.tags)) {
    const setA = new Set(tagsA);
    if (itemB.tags.some(t => setA.has(t.toLowerCase()))) return true;
  }
  return false;
}

function highlightConstellation(centerIdx) {
  const centerNode = starDataList[centerIdx];
  if (!centerNode || !starPointsMesh) return;

  const colorAttr = starPointsMesh.geometry.attributes.color;
  const itemA = centerNode.item;

  // Contraste por atenuación: las no conectadas bajan su luz, las hermanas destacan suave
  for (let i = 0; i < starDataList.length; i++) {
    const node = starDataList[i];
    if (i === centerIdx) {
      colorAttr.setXYZ(i, COL_STAR_ACTIVE.r, COL_STAR_ACTIVE.g, COL_STAR_ACTIVE.b);
      node.titleMat.opacity = 1.0;
    } else if (areItemsRelated(itemA, node.item)) {
      colorAttr.setXYZ(i, COL_STAR_LINKED.r, COL_STAR_LINKED.g, COL_STAR_LINKED.b);
      node.titleMat.opacity = 0.96;
    } else {
      colorAttr.setXYZ(i, COL_STAR_DIMMED.r, COL_STAR_DIMMED.g, COL_STAR_DIMMED.b);
      node.titleMat.opacity = 0.20;
    }
  }
  colorAttr.needsUpdate = true;
}

function clearConstellationHighlight() {
  if (!starPointsMesh) return;
  const colorAttr = starPointsMesh.geometry.attributes.color;

  for (let i = 0; i < starDataList.length; i++) {
    colorAttr.setXYZ(i, COL_STAR_NORMAL.r, COL_STAR_NORMAL.g, COL_STAR_NORMAL.b);
    starDataList[i].titleMat.opacity = 0.76;
  }
  colorAttr.needsUpdate = true;
}

/**
 * Muestra autor y etiquetas temáticas en Hover o al acercar el Zoom a una zona.
 */
function updateProximityMetadata() {
  if (!camera || zoomMetaPool.length === 0 || starDataList.length === 0) return;

  // Caso 1: Si el usuario tiene el puntero sobre una estrella, mostrar su ficha en slot 0
  if (hoveredStarIndex !== -1 && starDataList[hoveredStarIndex]) {
    const targetNode = starDataList[hoveredStarIndex];
    const slot0 = zoomMetaPool[0];
    drawMetaIntoPoolSlot(slot0, targetNode);
    slot0.mat.opacity = 0.98;
    slot0.sprite.position.set(
      targetNode.position.x + (savedTreeHeight * 0.045),
      targetNode.position.y - (savedTreeHeight * 0.015),
      targetNode.position.z
    );

    // Ocultar los demás slots
    for (let k = 1; k < zoomMetaPool.length; k++) {
      zoomMetaPool[k].mat.opacity = 0;
    }
    return;
  }

  // Caso 2: Sin hover -> detectar cercanía por Zoom hacia un sector del árbol
  const zoomRevealThreshold = savedTreeHeight * 0.95;
  const closeNodes = [];

  for (let i = 0; i < starDataList.length; i++) {
    const dist = camera.position.distanceTo(starDataList[i].position);
    if (dist < zoomRevealThreshold) {
      closeNodes.push({ node: starDataList[i], dist });
    }
  }

  closeNodes.sort((a, b) => a.dist - b.dist);

  for (let p = 0; p < zoomMetaPool.length; p++) {
    const slot = zoomMetaPool[p];
    if (p < closeNodes.length) {
      const { node, dist } = closeNodes[p];
      drawMetaIntoPoolSlot(slot, node);
      // Desvanecimiento suave según la proximidad de la cámara
      const fade = Math.min(1.0, Math.max(0.0, (zoomRevealThreshold - dist) / (savedTreeHeight * 0.35)));
      slot.mat.opacity = fade * 0.95;
      slot.sprite.position.set(
        node.position.x + (savedTreeHeight * 0.045),
        node.position.y - (savedTreeHeight * 0.015),
        node.position.z
      );
    } else {
      slot.mat.opacity = 0;
    }
  }
}

// ----------------------------------------------------------------------------
// 6. INTERACCIÓN Y BOTÓN DE APAGADO
// ----------------------------------------------------------------------------
function setupInteractionEvents(container) {
  const raycaster = new THREE.Raycaster();
  raycaster.params.Points.threshold = 0.45;
  const mouse = new THREE.Vector2();

  function onPointerMove(e) {
    if (!isMounted || !starPointsMesh || starDataList.length === 0) return;

    const rect = container.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObject(starPointsMesh);

    if (intersects.length > 0) {
      const hitIndex = intersects[0].index;
      if (hitIndex !== hoveredStarIndex) {
        hoveredStarIndex = hitIndex;
        container.style.cursor = 'pointer';
        highlightConstellation(hitIndex);
        requestTreeRender();
      }
    } else {
      if (hoveredStarIndex !== -1) {
        hoveredStarIndex = -1;
        container.style.cursor = 'default';
        clearConstellationHighlight();
        requestTreeRender();
      }
    }
  }

  function onPointerDown(e) {
    if (e.button !== 0) return;
    if (hoveredStarIndex !== -1 && starDataList[hoveredStarIndex]) {
      const selectedItem = starDataList[hoveredStarIndex].item;
      if (selectedItem && selectedItem.id) {
        openDetailModal(selectedItem.id);
      }
    }
  }

  function updateSize() {
    if (!isMounted || !camera || !renderer) return;
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    if (w === 0 || h === 0) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    requestTreeRender();
  }

  resizeObserver = new ResizeObserver(() => {
    updateSize();
  });
  resizeObserver.observe(container);

  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('resize', updateSize);

  container.__treeCleaners = () => {
    container.removeEventListener('pointermove', onPointerMove);
    container.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('resize', updateSize);
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
  };
}

function addPowerOffButton(container, onPowerOff) {
  let btn = container.querySelector('.btn-power-off-tree');
  if (!btn) {
    btn = document.createElement('button');
    btn.className = 'btn-power-off-tree';
    btn.innerHTML = '<i data-lucide="power"></i> Apagar Visor 3D';
    btn.title = 'Apagar el motor WebGL para liberar RAM y GPU inmediatamente';
    btn.setAttribute('style', `
      position: absolute;
      bottom: 20px;
      right: 20px;
      z-index: 15;
      background: rgba(15, 20, 18, 0.78);
      border: 1px solid rgba(255, 255, 255, 0.14);
      color: #c4d6cb;
      font-size: 11px;
      font-weight: 600;
      padding: 7px 14px;
      border-radius: 8px;
      cursor: pointer;
      backdrop-filter: blur(10px);
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s ease;
    `);

    btn.addEventListener('mouseenter', () => {
      btn.style.borderColor = 'rgba(239, 68, 68, 0.6)';
      btn.style.color = '#fca5a5';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.borderColor = 'rgba(255, 255, 255, 0.14)';
      btn.style.color = '#c4d6cb';
    });

    btn.addEventListener('click', () => {
      destroyTree3D();
      if (typeof onPowerOff === 'function') {
        onPowerOff();
      }
    });

    container.appendChild(btn);
    if (window.lucide) window.lucide.createIcons();
  }
}

// ----------------------------------------------------------------------------
// 7. DESTRUCCIÓN TOTAL Y LIBERACIÓN DE VRAM
// ----------------------------------------------------------------------------
export function destroyTree3D() {
  isMounted = false;
  isLoadingModel = false;
  lastRenderedSignature = '';
  savedBranchAnchors = [];
  savedWorldBox = null;
  savedTreeHeight = 0;

  clearStarsLayer();

  if (activeContainer && activeContainer.__treeCleaners) {
    activeContainer.__treeCleaners();
    activeContainer.__treeCleaners = null;
  }

  if (controls) {
    controls.dispose();
    controls = null;
  }

  envDisposables.forEach((item) => {
    if (item && typeof item.dispose === 'function') {
      try { item.dispose(); } catch (e) {}
    }
  });
  envDisposables.length = 0;

  if (renderer) {
    try {
      renderer.dispose();
      renderer.forceContextLoss();
    } catch (e) {}
    if (renderer.domElement && renderer.domElement.parentNode) {
      renderer.domElement.parentNode.removeChild(renderer.domElement);
    }
    renderer = null;
  }

  scene = null;
  camera = null;
  starsGroup = null;

  if (activeContainer) {
    activeContainer.innerHTML = '';
    activeContainer = null;
  }
}

export function isTree3DMounted() {
  return isMounted;
}