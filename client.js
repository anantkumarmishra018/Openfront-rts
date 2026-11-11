/* Engineered for ITz Clipster's RTS Web Game Project */

/**
 * CLIENT RENDERING & INPUT ENGINE
 * Handles Camera Matrix, Delta State Application, Mouse Drag Painting, and HUD Sync.
 */

const socket = io();

// DOM References
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const joinModal = document.getElementById('joinModal');
const hudOverlay = document.getElementById('hudOverlay');
const commanderNameInput = document.getElementById('commanderName');
const deployBtn = document.getElementById('deployBtn');

const hudPlayerName = document.getElementById('hudPlayerName');
const playerColorSwatch = document.getElementById('playerColorSwatch');
const hudTroops = document.getElementById('hudTroops');
const hudMaxTroops = document.getElementById('hudMaxTroops');
const hudGold = document.getElementById('hudGold');
const hudTerritory = document.getElementById('hudTerritory');
const hudStructures = document.getElementById('hudStructures');
const leaderboardList = document.getElementById('leaderboardList');

const dockButtons = document.querySelectorAll('.dock-btn:not(.future-slot)');

// ==========================================
// 1. LOCAL CLIENT GAME STATE & CAMERA
// ==========================================
const clientState = {
  inGame: false,
  selfId: null,
  config: null,
  TERRAIN: { WATER: 0, PLAINS: 1, MOUNTAIN: 2 },
  STRUCTURE: { NONE: 0, CITY: 1, DEFENSE_POST: 2 },
  grid: [],
  players: new Map(),
  activeMode: 'EXPAND', // 'EXPAND' | 'BUILD_CITY' | 'BUILD_DEFENSE'
  hoverTile: { x: -1, y: -1 },
  lastActionTileKey: null
};

const camera = {
  x: 0,
  y: 0,
  zoom: 1,
  tileSize: 24,
  isPanning: false,
  panStartX: 0,
  panStartY: 0,
  keys: { w: false, a: false, s: false, d: false }
};

let isLeftMouseDown = false;

// ==========================================
// 2. INITIALIZATION & RESIZE HANDLING
// ==========================================
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

deployBtn.addEventListener('click', () => {
  const name = commanderNameInput.value.trim() || 'ITz Clipster';
  socket.emit('joinGame', { name });
});

commanderNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') deployBtn.click();
});

// Mode Switching via UI Buttons and Hotkeys (1, 2, 3)
function setActionMode(mode) {
  clientState.activeMode = mode;
  dockButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
}

dockButtons.forEach((btn) => {
  btn.addEventListener('click', () => setActionMode(btn.dataset.mode));
});

// ==========================================
// 3. SOCKET.IO EVENT LISTENERS
// ==========================================
socket.on('initGame', (data) => {
  clientState.selfId = data.selfId;
  clientState.config = data.config;
  clientState.TERRAIN = data.TERRAIN;
  clientState.STRUCTURE = data.STRUCTURE;
  clientState.grid = data.grid;
  clientState.inGame = true;

  joinModal.classList.add('hidden');
  hudOverlay.classList.remove('hidden');

  // Center camera on player's initial spawn point
  const pixelX = data.spawn.x * camera.tileSize;
  const pixelY = data.spawn.y * camera.tileSize;
  camera.zoom = 1.15;
  camera.x = (canvas.width / 2) - (pixelX * camera.zoom);
  camera.y = (canvas.height / 2) - (pixelY * camera.zoom);
});

socket.on('gameStateUpdate', ({ players, tileUpdates }) => {
  if (!clientState.inGame) return;

  // Apply dirty tile deltas
  for (const update of tileUpdates) {
    const tile = clientState.grid[update.y][update.x];
    tile.owner = update.owner;
    tile.structure = update.structure;
  }

  // Sync player metrics
  clientState.players.clear();
  for (const p of players) {
    clientState.players.set(p.id, p);
  }

  updateHUD();
});

socket.on('errorMsg', (msg) => {
  alert(msg);
});

// ==========================================
// 4. CAMERA & MOUSE INPUT CONTROLLER
// ==========================================
function screenToGrid(screenX, screenY) {
  const worldX = (screenX - camera.x) / camera.zoom;
  const worldY = (screenY - camera.y) / camera.zoom;
  return {
    x: Math.floor(worldX / camera.tileSize),
    y: Math.floor(worldY / camera.tileSize)
  };
}

function triggerTileAction(gridX, gridY) {
  if (!clientState.inGame || !clientState.config) return;
  if (
    gridX < 0 ||
    gridX >= clientState.config.MAP_WIDTH ||
    gridY < 0 ||
    gridY >= clientState.config.MAP_HEIGHT
  ) {
    return;
  }

  const tileKey = `${gridX},${gridY}:${clientState.activeMode}`;
  if (clientState.lastActionTileKey === tileKey) return;
  clientState.lastActionTileKey = tileKey;

  if (clientState.activeMode === 'EXPAND') {
    socket.emit('expandTile', { x: gridX, y: gridY });
  } else if (clientState.activeMode === 'BUILD_CITY') {
    socket.emit('buildStructure', {
      x: gridX,
      y: gridY,
      type: clientState.STRUCTURE.CITY
    });
  } else if (clientState.activeMode === 'BUILD_DEFENSE') {
    socket.emit('buildStructure', {
      x: gridX,
      y: gridY,
      type: clientState.STRUCTURE.DEFENSE_POST
    });
  }
}

// Prevent context menu on right-click pan
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('mousedown', (e) => {
  if (!clientState.inGame) return;

  if (e.button === 0) {
    // Left Click: Expand or Build
    isLeftMouseDown = true;
    clientState.lastActionTileKey = null;
    const coords = screenToGrid(e.clientX, e.clientY);
    triggerTileAction(coords.x, coords.y);
  } else if (e.button === 2 || e.button === 1) {
    // Right or Middle Click: Camera Pan
    camera.isPanning = true;
    camera.panStartX = e.clientX - camera.x;
    camera.panStartY = e.clientY - camera.y;
  }
});

window.addEventListener('mousemove', (e) => {
  if (!clientState.inGame) return;

  const coords = screenToGrid(e.clientX, e.clientY);
  clientState.hoverTile = coords;

  if (camera.isPanning) {
    camera.x = e.clientX - camera.panStartX;
    camera.y = e.clientY - camera.panStartY;
  } else if (isLeftMouseDown && clientState.activeMode === 'EXPAND') {
    // Drag-painting expansion across tiles
    triggerTileAction(coords.x, coords.y);
  }
});

window.addEventListener('mouseup', (e) => {
  if (e.button === 0) {
    isLeftMouseDown = false;
    clientState.lastActionTileKey = null;
  }
  if (e.button === 2 || e.button === 1) {
    camera.isPanning = false;
  }
});

// Smooth Zoom Towards Mouse Cursor
canvas.addEventListener('wheel', (e) => {
  if (!clientState.inGame) return;
  e.preventDefault();

  const zoomFactor = e.deltaY < 0 ? 1.12 : 0.89;
  const newZoom = Math.min(3.0, Math.max(0.4, camera.zoom * zoomFactor));

  // Keep cursor anchored to the same world point while zooming
  const mouseX = e.clientX;
  const mouseY = e.clientY;
  camera.x = mouseX - ((mouseX - camera.x) * (newZoom / camera.zoom));
  camera.y = mouseY - ((mouseY - camera.y) * (newZoom / camera.zoom));
  camera.zoom = newZoom;
}, { passive: false });

// Keyboard Navigation (WASD / Arrows + Number Hotkeys)
window.addEventListener('keydown', (e) => {
  if (!clientState.inGame) return;
  const key = e.key.toLowerCase();
  if (key === 'w' || e.key === 'ArrowUp') camera.keys.w = true;
  if (key === 's' || e.key === 'ArrowDown') camera.keys.s = true;
  if (key === 'a' || e.key === 'ArrowLeft') camera.keys.a = true;
  if (key === 'd' || e.key === 'ArrowRight') camera.keys.d = true;

  if (key === '1') setActionMode('EXPAND');
  if (key === '2') setActionMode('BUILD_CITY');
  if (key === '3') setActionMode('BUILD_DEFENSE');
});

window.addEventListener('keyup', (e) => {
  const key = e.key.toLowerCase();
  if (key === 'w' || e.key === 'ArrowUp') camera.keys.w = false;
  if (key === 's' || e.key === 'ArrowDown') camera.keys.s = false;
  if (key === 'a' || e.key === 'ArrowLeft') camera.keys.a = false;
  if (key === 'd' || e.key === 'ArrowRight') camera.keys.d = false;
});

// ==========================================
// 5. HUD & LEADERBOARD UPDATES
// ==========================================
function updateHUD() {
  const self = clientState.players.get(clientState.selfId);
  if (self) {
    hudPlayerName.textContent = self.name;
    playerColorSwatch.style.backgroundColor = self.color;
    hudTroops.textContent = self.troops.toLocaleString();
    hudMaxTroops.textContent = `/ ${self.maxTroops.toLocaleString()}`;
    hudGold.textContent = self.gold.toLocaleString();
    hudTerritory.textContent = `${self.tilesOwned} Tiles`;
    hudStructures.textContent = `${self.cities} / ${self.defensePosts}`;
  }

  // Sort leaderboard by territory owned descending
  const sorted = Array.from(clientState.players.values()).sort(
    (a, b) => b.tilesOwned - a.tilesOwned
  );

  leaderboardList.innerHTML = sorted
    .slice(0, 8)
    .map(
      (p) => `
      <li class="lb-item">
        <div class="lb-name-wrap">
          <span class="lb-dot" style="background:${p.color}"></span>
          <span>${p.name}</span>
        </div>
        <span class="lb-score">${p.tilesOwned} tiles</span>
      </li>
    `
    )
    .join('');
}

// ==========================================
// 6. MAIN RENDERING LOOP (requestAnimationFrame)
// ==========================================
function renderLoop() {
  // Handle keyboard camera panning
  const panSpeed = 9;
  if (camera.keys.w) camera.y += panSpeed;
  if (camera.keys.s) camera.y -= panSpeed;
  if (camera.keys.a) camera.x += panSpeed;
  if (camera.keys.d) camera.x -= panSpeed;

  // Clear full viewport
  ctx.fillStyle = '#09111e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (clientState.inGame && clientState.grid.length > 0) {
    ctx.save();
    ctx.translate(camera.x, camera.y);
    ctx.scale(camera.zoom, camera.zoom);

    const ts = camera.tileSize;
    const rows = clientState.config.MAP_HEIGHT;
    const cols = clientState.config.MAP_WIDTH;

    // 1. Render Terrain & Territory Ownership
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const tile = clientState.grid[y][x];
        const px = x * ts;
        const py = y * ts;

        // Base Terrain Fill
        if (tile.terrain === clientState.TERRAIN.WATER) {
          ctx.fillStyle = '#0f2942';
        } else if (tile.terrain === clientState.TERRAIN.MOUNTAIN) {
          ctx.fillStyle = '#475569';
        } else {
          ctx.fillStyle = '#1e293b';
        }
        ctx.fillRect(px, py, ts, ts);

        // Player Territory Overlay
        if (tile.owner && clientState.players.has(tile.owner)) {
          const owner = clientState.players.get(tile.owner);
          ctx.fillStyle = owner.color;
          ctx.globalAlpha = tile.terrain === clientState.TERRAIN.MOUNTAIN ? 0.65 : 0.82;
          ctx.fillRect(px, py, ts, ts);
          ctx.globalAlpha = 1.0;

          // Draw high-contrast Territory Borders against different owners
          ctx.fillStyle = '#0f172a';
          const borderThickness = 2;
          if (y === 0 || clientState.grid[y - 1][x].owner !== tile.owner) {
            ctx.fillRect(px, py, ts, borderThickness);
          }
          if (y === rows - 1 || clientState.grid[y + 1][x].owner !== tile.owner) {
            ctx.fillRect(px, py + ts - borderThickness, ts, borderThickness);
          }
          if (x === 0 || clientState.grid[y][x - 1].owner !== tile.owner) {
            ctx.fillRect(px, py, borderThickness, ts);
          }
          if (x === cols - 1 || clientState.grid[y][x + 1].owner !== tile.owner) {
            ctx.fillRect(px + ts - borderThickness, py, borderThickness, ts);
          }
        }

        // Subtle Grid Lines
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(px, py, ts, ts);

        // Mountain Peak Indicator
        if (tile.terrain === clientState.TERRAIN.MOUNTAIN) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
          ctx.beginPath();
          ctx.moveTo(px + ts * 0.5, py + ts * 0.2);
          ctx.lineTo(px + ts * 0.8, py + ts * 0.8);
          ctx.lineTo(px + ts * 0.2, py + ts * 0.8);
          ctx.closePath();
          ctx.fill();
        }

        // Render Structures (Cities & Defense Posts)
        if (tile.structure === clientState.STRUCTURE.CITY) {
          ctx.fillStyle = '#fbbf24';
          ctx.strokeStyle = '#0f172a';
          ctx.lineWidth = 1.5;
          ctx.fillRect(px + ts * 0.22, py + ts * 0.22, ts * 0.56, ts * 0.56);
          ctx.strokeRect(px + ts * 0.22, py + ts * 0.22, ts * 0.56, ts * 0.56);
        } else if (tile.structure === clientState.STRUCTURE.DEFENSE_POST) {
          ctx.fillStyle = '#38bdf8';
          ctx.strokeStyle = '#0f172a';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(px + ts / 2, py + ts / 2, ts * 0.3, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
    }

    // 2. Render Hover Selection & Defense Post Aura Preview
    const hx = clientState.hoverTile.x;
    const hy = clientState.hoverTile.y;
    if (hx >= 0 && hx < cols && hy >= 0 && hy < rows) {
      const hoveredTile = clientState.grid[hy][hx];

      // Show Defense Aura radius if hovering a Defense Post or in BUILD_DEFENSE mode
      if (
        clientState.activeMode === 'BUILD_DEFENSE' ||
        hoveredTile.structure === clientState.STRUCTURE.DEFENSE_POST
      ) {
        const r = clientState.config.DEFENSE_AURA_RADIUS;
        const auraX = (hx - r) * ts;
        const auraY = (hy - r) * ts;
        const auraSize = (r * 2 + 1) * ts;

        ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.65)';
        ctx.lineWidth = 1.5;
        ctx.fillRect(auraX, auraY, auraSize, auraSize);
        ctx.strokeRect(auraX, auraY, auraSize, auraSize);
      }

      // Highlight active hovered tile
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.strokeRect(hx * ts, hy * ts, ts, ts);
    }

    ctx.restore();
  }

  requestAnimationFrame(renderLoop);
}

requestAnimationFrame(renderLoop);