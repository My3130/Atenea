// ============================================================================
// GRAPH.JS - Gestor de Conexiones Culturales (Red 2D + Árbol Celestial 3D)
// ============================================================================

import { state, library, refreshLucide } from './state.js';
import { escapeHtml, openDetailModal } from './modals.js';
import { mountTree3D, destroyTree3D, isTree3DMounted } from './tree3d.js';

let graphInstance = null;
let graphEventsInitialized = false;

function getNodeColor(node) {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  if (node.group === 'book') return '#3b82f6';
  if (node.group === 'movie') return '#ef4444';
  if (node.group === 'music') return '#a855f7';
  if (node.group === 'country') return '#10b981';
  if (node.group === 'tag') return '#f59e0b';
  return isLight ? '#475569' : '#e2e8f0';
}

function setBackgroundVideoPaused(paused) {
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
    const savedSrc = bgVideo.dataset.pausedSrc;
    if (savedSrc && state.activeBgTheme !== 'none') {
      bgVideo.setAttribute('src', savedSrc);
      delete bgVideo.dataset.pausedSrc;
      bgVideo.load();
      bgVideo.play().catch(() => {});
    }
  }
}

export async function initOrUpdateGraph() {
  initGraphEvents();

  const graphCanvas2D = document.getElementById('cultural-graph-canvas');
  const treeCanvas3D = document.getElementById('cultural-tree-canvas');
  const btnMode2D = document.getElementById('btn-graph-mode-2d');
  const btnMode3D = document.getElementById('btn-graph-mode-3d');
  const graphStatsText = document.getElementById('graph-stats-text');

  const activeMode = state.graphMode || '2d';
  const activeGraphType = state.graphTypeFilter || 'all';

  btnMode2D?.classList.toggle('active', activeMode === '2d');
  btnMode3D?.classList.toggle('active', activeMode === '3d');

  document.querySelectorAll('.graph-filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.graphtype === activeGraphType);
  });

  const filteredItems = library.filter(item => {
    if (activeGraphType === 'all') return true;
    return item.type === activeGraphType;
  });

  if (activeMode === '3d') {
    graphCanvas2D?.classList.add('hidden');
    treeCanvas3D?.classList.remove('hidden');

    if (graphInstance && typeof graphInstance.pauseAnimation === 'function') {
      graphInstance.pauseAnimation();
    }

    if (graphStatsText) {
      graphStatsText.textContent = state.isTree3DEnabled
        ? `${filteredItems.length} estrellas en el árbol`
        : `Visor 3D en reposo (0 MB)`;
    }

    if (treeCanvas3D) {
      if (!state.isTree3DEnabled) {
        setBackgroundVideoPaused(false);
        if (isTree3DMounted()) destroyTree3D();
        renderHardwareWarningCard(treeCanvas3D);
      } else {
        setBackgroundVideoPaused(true);
        await mountTree3D(treeCanvas3D, filteredItems, () => {
          state.isTree3DEnabled = false;
          initOrUpdateGraph();
        });
      }
    }
  } else {
    treeCanvas3D?.classList.add('hidden');
    graphCanvas2D?.classList.remove('hidden');

    if (isTree3DMounted()) {
      destroyTree3D();
    }

    setBackgroundVideoPaused(false);
    render2DForceGraph(graphCanvas2D, filteredItems, graphStatsText);
  }

  refreshLucide();
}

function renderHardwareWarningCard(container) {
  container.innerHTML = `
    <div style="position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; background:rgba(4, 7, 6, 0.94); color:#e0e6ed; padding:24px; text-align:center;">
      <div style="width:56px; height:56px; border-radius:50%; background:rgba(94, 255, 163, 0.1); border:1px solid rgba(94, 255, 163, 0.3); display:flex; align-items:center; justify-content:center; margin-bottom:16px;">
        <i data-lucide="sparkles" style="color:#5effa3; width:26px; height:26px;"></i>
      </div>
      <h3 style="font-size:18px; font-weight:600; color:#dfcaa0; margin-bottom:10px; letter-spacing:0.04em;">Árbol Celestial · Aceleración 3D</h3>
      <p style="font-size:13px; color:#9eb3a6; max-width:460px; line-height:1.6; margin-bottom:8px;">
        Esta perspectiva inmersiva utiliza aceleración por hardware (WebGL) para renderizar la constelación tridimensional.
      </p>
      <p style="font-size:12px; color:#d9b870; max-width:440px; line-height:1.5; margin-bottom:22px; background:rgba(217, 184, 112, 0.08); border:1px solid rgba(217, 184, 112, 0.25); padding:8px 14px; border-radius:8px;">
        ⚡ ⚡ Tendrá un consumo moderado de RAM y memoria gráfica (GPU) adicional mientras esté activo. Puedes apagarlo en cualquier momento para regresar al reposo total.
      </p>
      <button type="button" id="btn-enable-tree-3d" class="btn-primary" style="display:inline-flex; align-items:center; gap:8px; cursor:pointer; padding:11px 22px; font-weight:600; border-radius:8px;">
        <i data-lucide="power"></i> Encender Árbol Cósmico
      </button>
    </div>
  `;

  refreshLucide();

  document.getElementById('btn-enable-tree-3d')?.addEventListener('click', () => {
    state.isTree3DEnabled = true;
    initOrUpdateGraph();
  });
}

function render2DForceGraph(graphCanvas, filteredItems, graphStatsText) {
  if (!graphCanvas) return;

  if (filteredItems.length === 0) {
    if (graphInstance && typeof graphInstance.pauseAnimation === 'function') {
      graphInstance.pauseAnimation();
      graphInstance = null;
    }
    graphCanvas.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding:50px;">No hay obras disponibles para esta vista del grafo.</div>`;
    if (graphStatsText) graphStatsText.textContent = `0 nodos conectados`;
    return;
  }

  const nodes = [];
  const links = [];
  const nodeSet = new Set();

  const addNode = (id, name, group, val = 4) => {
    if (!nodeSet.has(id)) {
      nodeSet.add(id);
      nodes.push({ id, name, group, val });
    }
  };

  filteredItems.forEach(item => {
    const workId = `work-${item.id}`;
    const safeTitle = escapeHtml(item.title || 'Sin título');
    addNode(workId, safeTitle, item.type, 5);

    if (item.country) {
      const safeCountry = escapeHtml(item.country);
      const countryId = `country-${safeCountry}`;
      addNode(countryId, safeCountry, 'country', 4);
      links.push({ source: workId, target: countryId });
    }

    (item.tags || []).forEach(tag => {
      const safeTag = escapeHtml(tag);
      const tagId = `tag-${safeTag}`;
      addNode(tagId, safeTag, 'tag', 3);
      links.push({ source: workId, target: tagId });
    });
  });

  if (graphStatsText) graphStatsText.textContent = `${nodes.length} nodos conectados`;

  if (!graphInstance) {
    graphCanvas.innerHTML = '';
    graphInstance = ForceGraph()(graphCanvas)
      .graphData({ nodes, links })
      .nodeId('id')
      .nodeVal('val')
      .d3AlphaDecay(0.03)
      .d3VelocityDecay(0.6)
      .cooldownTicks(80)
      .backgroundColor('rgba(0, 0, 0, 0)')
      .linkColor(() => {
        const isLight = document.documentElement.getAttribute('data-theme') === 'light';
        return isLight ? 'rgba(15, 23, 42, 0.45)' : 'rgba(255, 255, 255, 0.40)';
      })
      .linkWidth(1.4)
      .onNodeClick(node => {
        if (node.id.startsWith('work-')) {
          openDetailModal(node.id.replace('work-', ''));
        }
      })
      .nodeCanvasObject((node, ctx, globalScale) => {
        const isLight = document.documentElement.getAttribute('data-theme') === 'light';
        const label = node.name || '';
        const radius = node.val || 4;

        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
        ctx.fillStyle = getNodeColor(node);
        ctx.fill();

        ctx.strokeStyle = isLight ? 'rgba(0, 0, 0, 0.30)' : 'rgba(255, 255, 255, 0.60)';
        ctx.lineWidth = 1.2 / globalScale;
        ctx.stroke();

        if (globalScale > 0.85) {
          const fontSize = Math.max(10 / globalScale, 2.5);
          ctx.font = `600 ${fontSize}px 'Inter', system-ui, -apple-system, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';

          const textY = node.y + radius + (2.5 / globalScale);

          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';
          ctx.strokeStyle = isLight ? 'rgba(255, 255, 255, 0.95)' : 'rgba(0, 0, 0, 0.95)';
          ctx.lineWidth = 1.2 / globalScale;
          ctx.strokeText(label, node.x, textY);

          ctx.fillStyle = isLight ? '#0f172a' : '#ffffff';
          ctx.fillText(label, node.x, textY);
        }
      })
      .nodeCanvasObjectMode(() => 'replace')
      .nodePointerAreaPaint((node, color, ctx) => {
        const radius = (node.val || 4) + 3;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
        ctx.fill();
      });

    graphInstance.d3Force('charge').strength(-180);
    graphInstance.d3Force('link').distance(45);
  } else {
    if (typeof graphInstance.resumeAnimation === 'function') {
      graphInstance.resumeAnimation();
    }
    graphInstance
      .graphData({ nodes, links })
      .backgroundColor('rgba(0, 0, 0, 0)');

    setTimeout(() => {
      if (graphCanvas && graphInstance) {
        graphInstance.width(graphCanvas.clientWidth);
        graphInstance.height(graphCanvas.clientHeight);
        if (typeof graphInstance.zoomToFit === 'function') {
          graphInstance.zoomToFit(250, 40);
        }
      }
    }, 80);
  }
}

export function pauseGraph() {
  setBackgroundVideoPaused(false);
  if (isTree3DMounted()) {
    destroyTree3D();
  }
  if (graphInstance && typeof graphInstance.pauseAnimation === 'function') {
    graphInstance.pauseAnimation();
  }
}

export function resumeGraph() {
  if (state.graphMode === '3d') {
    initOrUpdateGraph();
  } else if (graphInstance && typeof graphInstance.resumeAnimation === 'function') {
    graphInstance.resumeAnimation();
  }
}

export function initGraphEvents() {
  if (graphEventsInitialized) return;
  graphEventsInitialized = true;

  document.getElementById('btn-graph-mode-2d')?.addEventListener('click', () => {
    state.graphMode = '2d';
    initOrUpdateGraph();
  });

  document.getElementById('btn-graph-mode-3d')?.addEventListener('click', () => {
    state.graphMode = '3d';
    initOrUpdateGraph();
  });

  document.querySelectorAll('.graph-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.graphTypeFilter = btn.dataset.graphtype;
      initOrUpdateGraph();
    });
  });
  document.getElementById('btn-toggle-graph-toolbar')?.addEventListener('click', () => {
    const toolbar = document.getElementById('graph-toolbar');
    if (toolbar) {
      toolbar.classList.toggle('collapsed');
    }
  });
}
