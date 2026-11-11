/* Engineered for ITz Clipster's RTS Web Game Project */

/**
 * AUTHORITATIVE MULTIPLAYER RTS SERVER
 * Lead Designer & Owner: ITz Clipster (Anant Kumar Mishra)
 * Architecture: Node.js + Express + Socket.io (20 TPS Delta-Sync Engine)
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// 1. GAME CONFIGURATION & CONSTANTS
// ==========================================
const CONFIG = {
  TICK_RATE: 20,                // 20 ticks per second (50ms per tick)
  MAP_WIDTH: 80,                // Grid width in tiles
  MAP_HEIGHT: 80,               // Grid height in tiles
  STARTING_TROOPS: 150,
  STARTING_GOLD: 200,
  NEUTRAL_CAPTURE_COST: 10,     // Troops required to claim an empty plains tile
  MOUNTAIN_CAPTURE_COST: 25,    // Troops required to claim a mountain tile
  ENEMY_BASE_COMBAT_COST: 22,   // Base troop cost to take an enemy tile
  DEFENSE_AURA_RADIUS: 3,       // Tile radius for Defense Post protection
  DEFENSE_AURA_MULTIPLIER: 2.0, // Combat cost multiplier inside enemy Defense Post radius
  COSTS: {
    CITY: 150,                  // Gold cost
    DEFENSE_POST: 100           // Gold cost
  },
  ECONOMY: {
    BASE_TROOP_GEN: 2.0,        // Passive troops per second
    TROOPS_PER_TILE: 0.18,      // Additional troops per owned tile per second
    TROOPS_PER_CITY: 4.5,       // Additional troops per City per second
    TROOP_CAP_PER_TILE: 35,     // Max troop capacity per owned tile
    TROOP_CAP_PER_CITY: 500,    // Bonus troop capacity per City
    GOLD_PER_TILE: 0.35,        // Passive gold per owned tile per second
    GOLD_PER_CITY: 8.0          // Additional gold per City per second
  }
};

const TERRAIN = {
  WATER: 0,     // Impassable by land (Reserved for future Naval Trade expansion)
  PLAINS: 1,    // Standard buildable/capturable land
  MOUNTAIN: 2   // High-defense terrain
};

const STRUCTURE = {
  NONE: 0,
  CITY: 1,         // Boosts Gold & Troop generation + Max Troop Cap
  DEFENSE_POST: 2  // Grants defensive combat multiplier to nearby tiles
};

// ==========================================
// 2. AUTHORITATIVE STATE STORAGE
// ==========================================
const gameState = {
  grid: [],                   // 2D array [y][x] of Tile objects
  players: new Map(),         // socket.id -> Player object
  dirtyTiles: new Map()       // "x,y" -> Tile delta object queued for next tick broadcast
};

/**
 * Generates a procedural island map with water borders, plains, and mountain clusters.
 */
function initMap() {
  gameState.grid = [];
  const centerX = CONFIG.MAP_WIDTH / 2;
  const centerY = CONFIG.MAP_HEIGHT / 2;
  const maxDist = Math.min(centerX, centerY) * 0.92;

  for (let y = 0; y < CONFIG.MAP_HEIGHT; y++) {
    const row = [];
    for (let x = 0; x < CONFIG.MAP_WIDTH; x++) {
      // Radial island falloff + organic noise for coastline (ready for Naval Trade ports)
      const dx = x - centerX;
      const dy = y - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const noise = Math.sin(x * 0.25) * Math.cos(y * 0.25) * 6;

      let terrain = TERRAIN.PLAINS;
      if (dist + noise > maxDist) {
        terrain = TERRAIN.WATER;
      } else if (Math.random() < 0.09 && dist < maxDist * 0.8) {
        terrain = TERRAIN.MOUNTAIN;
      }

      row.push({
        x,
        y,
        terrain,
        owner: null,
        structure: STRUCTURE.NONE
      });
    }
    gameState.grid.push(row);
  }
}

// ==========================================
// 3. SPATIAL & GAMEPLAY HELPER FUNCTIONS
// ==========================================
function isValidCoord(x, y) {
  return x >= 0 && x < CONFIG.MAP_WIDTH && y >= 0 && y < CONFIG.MAP_HEIGHT;
}

function markTileDirty(tile) {
  gameState.dirtyTiles.set(`${tile.x},${tile.y}`, {
    x: tile.x,
    y: tile.y,
    owner: tile.owner,
    structure: tile.structure
  });
}

/**
 * Checks if a coordinate is orthogonally adjacent to at least one tile owned by playerId.
 */
function isAdjacentToPlayer(x, y, playerId) {
  const dirs = [
    [0, -1], [1, 0], [0, 1], [-1, 0]
  ];
  for (const [dx, dy] of dirs) {
    const nx = x + dx;
    const ny = y + dy;
    if (isValidCoord(nx, ny) && gameState.grid[ny][nx].owner === playerId) {
      return true;
    }
  }
  return false;
}

/**
 * Checks if a tile is protected by a friendly Defense Post within CONFIG.DEFENSE_AURA_RADIUS.
 */
function hasDefenseAura(x, y, ownerId) {
  if (!ownerId) return false;
  const r = CONFIG.DEFENSE_AURA_RADIUS;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (isValidCoord(nx, ny)) {
        const neighbor = gameState.grid[ny][nx];
        if (neighbor.owner === ownerId && neighbor.structure === STRUCTURE.DEFENSE_POST) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Finds a random unowned plains region and grants a 3x3 starting territory to the player.
 */
function spawnPlayerTerritory(playerId) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const rx = Math.floor(Math.random() * (CONFIG.MAP_WIDTH - 10)) + 5;
    const ry = Math.floor(Math.random() * (CONFIG.MAP_HEIGHT - 10)) + 5;
    const centerTile = gameState.grid[ry][rx];

    if (centerTile.terrain === TERRAIN.PLAINS && centerTile.owner === null) {
      let claimed = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const tile = gameState.grid[ry + dy][rx + dx];
          if (tile.terrain !== TERRAIN.WATER && tile.owner === null) {
            tile.owner = playerId;
            // Place a starting City in the center tile
            if (dx === 0 && dy === 0) {
              tile.structure = STRUCTURE.CITY;
            }
            markTileDirty(tile);
            claimed++;
          }
        }
      }
      return { x: rx, y: ry, claimed };
    }
  }
  return null;
}

/**
 * Recalculates owned tiles and structure counts for all players.
 */
function recalculateTerritoryMetrics() {
  for (const player of gameState.players.values()) {
    player.tilesOwned = 0;
    player.cities = 0;
    player.defensePosts = 0;
  }

  for (let y = 0; y < CONFIG.MAP_HEIGHT; y++) {
    for (let x = 0; x < CONFIG.MAP_WIDTH; x++) {
      const tile = gameState.grid[y][x];
      if (tile.owner && gameState.players.has(tile.owner)) {
        const p = gameState.players.get(tile.owner);
        p.tilesOwned++;
        if (tile.structure === STRUCTURE.CITY) p.cities++;
        if (tile.structure === STRUCTURE.DEFENSE_POST) p.defensePosts++;
      }
    }
  }
}

// ==========================================
// 4. SOCKET.IO NETWORKING & INPUT HANDLERS
// ==========================================
io.on('connection', (socket) => {
  console.log(`[CONNECT] Commander connected: ${socket.id}`);

  socket.on('joinGame', (payload) => {
    const rawName = (payload && payload.name) ? String(payload.name).trim() : '';
    const playerName = rawName.substring(0, 18) || `Commander_${socket.id.slice(0, 4)}`;
    const hue = Math.floor(Math.random() * 360);
    const color = `hsl(${hue}, 75%, 52%)`;

    const spawnInfo = spawnPlayerTerritory(socket.id);
    if (!spawnInfo) {
      socket.emit('errorMsg', 'Map is currently full!');
      return;
    }

    const newPlayer = {
      id: socket.id,
      name: playerName,
      color: color,
      troops: CONFIG.STARTING_TROOPS,
      maxTroops: 500,
      gold: CONFIG.STARTING_GOLD,
      tilesOwned: spawnInfo.claimed,
      cities: 1,
      defensePosts: 0,
      spawnX: spawnInfo.x,
      spawnY: spawnInfo.y
    };

    gameState.players.set(socket.id, newPlayer);

    // Send full initial snapshot to the joining client
    socket.emit('initGame', {
      selfId: socket.id,
      config: CONFIG,
      TERRAIN,
      STRUCTURE,
      grid: gameState.grid,
      spawn: { x: spawnInfo.x, y: spawnInfo.y }
    });
  });

  /**
   * Handles Territory Expansion & Combat on a target tile (x, y).
   */
  socket.on('expandTile', ({ x, y }) => {
    const player = gameState.players.get(socket.id);
    if (!player || !isValidCoord(x, y)) return;

    const targetTile = gameState.grid[y][x];

    // Cannot capture water (until Naval update) or already owned tiles
    if (targetTile.terrain === TERRAIN.WATER || targetTile.owner === player.id) return;

    // Must be orthogonally adjacent to existing territory
    if (!isAdjacentToPlayer(x, y, player.id)) return;

    // Calculate required troops based on terrain, enemy ownership, and Defense Posts
    let troopCost = targetTile.terrain === TERRAIN.MOUNTAIN
      ? CONFIG.MOUNTAIN_CAPTURE_COST
      : CONFIG.NEUTRAL_CAPTURE_COST;

    if (targetTile.owner !== null) {
      const defender = gameState.players.get(targetTile.owner);
      troopCost = CONFIG.ENEMY_BASE_COMBAT_COST;

      if (targetTile.terrain === TERRAIN.MOUNTAIN) {
        troopCost *= 1.5;
      }

      // Check if enemy tile is fortified by an active Defense Post aura
      if (hasDefenseAura(x, y, targetTile.owner)) {
        troopCost *= CONFIG.DEFENSE_AURA_MULTIPLIER;
      }

      // Defender density scaling: defenders with high troop-to-tile ratios resist harder
      if (defender && defender.tilesOwned > 0) {
        const defenderDensity = Math.min(2.5, 1 + (defender.troops / (defender.tilesOwned * 25)));
        troopCost = Math.ceil(troopCost * defenderDensity);
        // Drain a portion of defender's garrisoned troops during combat
        defender.troops = Math.max(0, defender.troops - Math.floor(troopCost * 0.45));
      }
    }

    // Verify attacker has enough troops
    if (player.troops < troopCost) return;

    // Deduct troops & transfer ownership
    player.troops -= troopCost;
    targetTile.owner = player.id;
    markTileDirty(targetTile);
  });

  /**
   * Handles Structure Construction (City or Defense Post) on an owned tile.
   */
  socket.on('buildStructure', ({ x, y, type }) => {
    const player = gameState.players.get(socket.id);
    if (!player || !isValidCoord(x, y)) return;

    const tile = gameState.grid[y][x];

    // Must own the tile, must be land, and must not already have a structure
    if (tile.owner !== player.id || tile.terrain === TERRAIN.WATER || tile.structure !== STRUCTURE.NONE) {
      return;
    }

    if (type === STRUCTURE.CITY) {
      if (player.gold < CONFIG.COSTS.CITY) return;
      player.gold -= CONFIG.COSTS.CITY;
      tile.structure = STRUCTURE.CITY;
      markTileDirty(tile);
    } else if (type === STRUCTURE.DEFENSE_POST) {
      if (player.gold < CONFIG.COSTS.DEFENSE_POST) return;
      player.gold -= CONFIG.COSTS.DEFENSE_POST;
      tile.structure = STRUCTURE.DEFENSE_POST;
      markTileDirty(tile);
    }
  });

  /**
   * Extension Hook for Future Mechanics (Alliances, Naval Trade, Nukes)
   */
  socket.on('specialAction', (data) => {
    // Future implementation hook for Nuke launch coordinates, Naval Trade routes, or Alliance pacts
  });

  socket.on('disconnect', () => {
    console.log(`[DISCONNECT] Commander left: ${socket.id}`);
    if (gameState.players.has(socket.id)) {
      gameState.players.delete(socket.id);
      // Neutralize disconnected player's tiles
      for (let y = 0; y < CONFIG.MAP_HEIGHT; y++) {
        for (let x = 0; x < CONFIG.MAP_WIDTH; x++) {
          const tile = gameState.grid[y][x];
          if (tile.owner === socket.id) {
            tile.owner = null;
            markTileDirty(tile);
          }
        }
      }
    }
  });
});

// ==========================================
// 5. MASTER AUTHORITATIVE GAME LOOP (20 TPS)
// ==========================================
const dt = 1 / CONFIG.TICK_RATE;

setInterval(() => {
  recalculateTerritoryMetrics();

  const playersSummary = [];

  for (const player of gameState.players.values()) {
    // Calculate dynamic troop cap
    player.maxTroops = Math.floor(
      100 +
      (player.tilesOwned * CONFIG.ECONOMY.TROOP_CAP_PER_TILE) +
      (player.cities * CONFIG.ECONOMY.TROOP_CAP_PER_CITY)
    );

    // Passive Troop Generation
    if (player.tilesOwned > 0) {
      const troopGain = (
        CONFIG.ECONOMY.BASE_TROOP_GEN +
        (player.tilesOwned * CONFIG.ECONOMY.TROOPS_PER_TILE) +
        (player.cities * CONFIG.ECONOMY.TROOPS_PER_CITY)
      ) * dt;

      player.troops = Math.min(player.maxTroops, player.troops + troopGain);

      // Passive Gold Generation
      const goldGain = (
        (player.tilesOwned * CONFIG.ECONOMY.GOLD_PER_TILE) +
        (player.cities * CONFIG.ECONOMY.GOLD_PER_CITY)
      ) * dt;

      player.gold += goldGain;
    }

    playersSummary.push({
      id: player.id,
      name: player.name,
      color: player.color,
      troops: Math.floor(player.troops),
      maxTroops: player.maxTroops,
      gold: Math.floor(player.gold),
      tilesOwned: player.tilesOwned,
      cities: player.cities,
      defensePosts: player.defensePosts
    });
  }

  // Broadcast delta state to all clients
  const tileUpdates = Array.from(gameState.dirtyTiles.values());
  gameState.dirtyTiles.clear();

  io.emit('gameStateUpdate', {
    players: playersSummary,
    tileUpdates
  });
}, 1000 / CONFIG.TICK_RATE);

// Initialize Map & Start Server
initMap();
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`ITz Clipster RTS Server running on http://localhost:${PORT}`);
  console.log(`Tick Rate: ${CONFIG.TICK_RATE} TPS | Map Size: ${CONFIG.MAP_WIDTH}x${CONFIG.MAP_HEIGHT}`);
  console.log(`====================================================`);
});