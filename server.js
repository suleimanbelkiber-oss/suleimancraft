/**
 * SuleimanCraft — 3D online sandbox server.
 * Node.js + ws
 * Author: Suleiman
 * Version: 6.0.0
 * Without Nether / without Netherite / without Obsidian.
 */

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3001;
const VERSION = '6.0.0';
const GAME_NAME = 'SuleimanCraft';
const WORLD_SIZE = 16;
const MAX_PLAYERS = 30;
const MAX_CHAT_HISTORY = 50;
const PLAYER_MAX_HP = 20;
const PLAYER_MAX_FOOD = 20;
const RESPAWN_POS = { x: 0, y: 15, z: 0 };
const ATTACK_RANGE = 4;
const ATTACK_COOLDOWN = 500;
const FOOD_DECAY_INTERVAL = 30000;
const PLAYER_INVENTORY_SIZE = 27;

// ═══════════════════════════════════════════════════════════════
//  CHAT
// ═══════════════════════════════════════════════════════════════

let chatHistory = [];
function addChatMessage(name, text) {
  const msg = { name, text, timestamp: Date.now() };
  chatHistory.push(msg);
  if (chatHistory.length > MAX_CHAT_HISTORY) chatHistory = chatHistory.slice(-MAX_CHAT_HISTORY);
  return msg;
}

// ═══════════════════════════════════════════════════════════════
//  BLOCKS
// ═══════════════════════════════════════════════════════════════

const BLOCK_TYPES = {
  GRASS: 0, DIRT: 1, STONE: 2, WOOD: 3, LEAVES: 4,
  SAND: 5, WATER: 6, BRICK: 7, GLASS: 8, GOLD: 9,
  COAL_ORE: 10, IRON_ORE: 11, GOLD_ORE: 12, DIAMOND_ORE: 13,
};

const BLOCK_INFO = {
  0:  { name: 'Трава', color: 0x4CAF50 },
  1:  { name: 'Земля', color: 0x8B6F47 },
  2:  { name: 'Камень', color: 0x808080 },
  3:  { name: 'Дерево', color: 0x654321 },
  4:  { name: 'Листва', color: 0x2E7D32 },
  5:  { name: 'Песок', color: 0xF4E4A0 },
  6:  { name: 'Вода', color: 0x2196F3 },
  7:  { name: 'Кирпич', color: 0xB22222 },
  8:  { name: 'Стекло', color: 0xADD8E6 },
  9:  { name: 'Золото', color: 0xFFD700 },
  10: { name: 'Угольная руда', color: 0x222222 },
  11: { name: 'Железная руда', color: 0xC0C0C0 },
  12: { name: 'Золотая руда', color: 0xFFD700 },
  13: { name: 'Алмазная руда', color: 0x4AEDD9 },
};

// ═══════════════════════════════════════════════════════════════
//  WEAPONS (без незерита)
// ═══════════════════════════════════════════════════════════════

const WEAPON_INFO = {
  0: { name: 'Деревянный меч', color: 0x8B6F47, damage: 2 },
  1: { name: 'Каменный меч', color: 0x808080, damage: 3 },
  2: { name: 'Железный меч', color: 0xC0C0C0, damage: 4 },
  3: { name: 'Золотой меч', color: 0xFFD700, damage: 4 },
  4: { name: 'Алмазный меч', color: 0x4AEDD9, damage: 5 },
};

// ═══════════════════════════════════════════════════════════════
//  ARMOR (без незерита)
// ═══════════════════════════════════════════════════════════════

const ARMOR_INFO = {
  0: { name: 'Кожаная', color: 0x8B6F47, defense: 1 },
  1: { name: 'Железная', color: 0xC0C0C0, defense: 2 },
  2: { name: 'Золотая', color: 0xFFD700, defense: 2 },
  3: { name: 'Алмазная', color: 0x4AEDD9, defense: 3 },
};

const ARMOR_SLOTS = ['helmet', 'chestplate', 'leggings', 'boots'];

// ═══════════════════════════════════════════════════════════════
//  FOOD
// ═══════════════════════════════════════════════════════════════

const FOOD_INFO = {
  0: { name: 'Яблоко', color: 0xFF4040, heal: 4 },
  1: { name: 'Хлеб', color: 0xD2A24A, heal: 5 },
  2: { name: 'Мясо', color: 0xA0522D, heal: 6 },
  3: { name: 'Золотое яблоко', color: 0xFFD700, heal: 10 },
};

// ═══════════════════════════════════════════════════════════════
//  MATERIALS
// ═══════════════════════════════════════════════════════════════

const MATERIAL_INFO = {
  0: { name: 'Палка', color: 0x8B6F47 },
  1: { name: 'Уголь', color: 0x222222 },
  2: { name: 'Железный слиток', color: 0xC0C0C0 },
  3: { name: 'Золотой слиток', color: 0xFFD700 },
  4: { name: 'Алмаз', color: 0x4AEDD9 },
  5: { name: 'Пшеница', color: 0xD2A24A },
};

// ═══════════════════════════════════════════════════════════════
//  CRAFTING RECIPES
// ═══════════════════════════════════════════════════════════════

const RECIPES = [
  // Блоки
  { result: { type: 'block', id: 3, count: 1 }, ingredients: [{ type: 'material', id: 0, count: 1 }] },

  // Мечи
  { result: { type: 'weapon', id: 0, count: 1 }, ingredients: [{ type: 'block', id: 3, count: 2 }, { type: 'material', id: 0, count: 1 }] },
  { result: { type: 'weapon', id: 1, count: 1 }, ingredients: [{ type: 'block', id: 2, count: 2 }, { type: 'material', id: 0, count: 1 }] },
  { result: { type: 'weapon', id: 2, count: 1 }, ingredients: [{ type: 'material', id: 2, count: 2 }, { type: 'material', id: 0, count: 1 }] },
  { result: { type: 'weapon', id: 3, count: 1 }, ingredients: [{ type: 'material', id: 3, count: 2 }, { type: 'material', id: 0, count: 1 }] },
  { result: { type: 'weapon', id: 4, count: 1 }, ingredients: [{ type: 'material', id: 4, count: 2 }, { type: 'material', id: 0, count: 1 }] },

  // Броня: железо
  { result: { type: 'armor', id: 1, slot: 'helmet', count: 1 }, ingredients: [{ type: 'material', id: 2, count: 5 }] },
  { result: { type: 'armor', id: 1, slot: 'chestplate', count: 1 }, ingredients: [{ type: 'material', id: 2, count: 8 }] },
  { result: { type: 'armor', id: 1, slot: 'leggings', count: 1 }, ingredients: [{ type: 'material', id: 2, count: 7 }] },
  { result: { type: 'armor', id: 1, slot: 'boots', count: 1 }, ingredients: [{ type: 'material', id: 2, count: 4 }] },

  // Броня: золото
  { result: { type: 'armor', id: 2, slot: 'helmet', count: 1 }, ingredients: [{ type: 'material', id: 3, count: 5 }] },
  { result: { type: 'armor', id: 2, slot: 'chestplate', count: 1 }, ingredients: [{ type: 'material', id: 3, count: 8 }] },
  { result: { type: 'armor', id: 2, slot: 'leggings', count: 1 }, ingredients: [{ type: 'material', id: 3, count: 7 }] },
  { result: { type: 'armor', id: 2, slot: 'boots', count: 1 }, ingredients: [{ type: 'material', id: 3, count: 4 }] },

  // Броня: алмаз
  { result: { type: 'armor', id: 3, slot: 'helmet', count: 1 }, ingredients: [{ type: 'material', id: 4, count: 5 }] },
  { result: { type: 'armor', id: 3, slot: 'chestplate', count: 1 }, ingredients: [{ type: 'material', id: 4, count: 8 }] },
  { result: { type: 'armor', id: 3, slot: 'leggings', count: 1 }, ingredients: [{ type: 'material', id: 4, count: 7 }] },
  { result: { type: 'armor', id: 3, slot: 'boots', count: 1 }, ingredients: [{ type: 'material', id: 4, count: 4 }] },

  // Еда
  { result: { type: 'food', id: 1, count: 1 }, ingredients: [{ type: 'material', id: 5, count: 3 }] },
];

// ═══════════════════════════════════════════════════════════════
//  WORLD
// ═══════════════════════════════════════════════════════════════

const world = new Map();
const key = (x, y, z) => `${x},${y},${z}`;

function generateWorld() {
  console.log(`[${GAME_NAME}] Generating world...`);
  for (let x = -WORLD_SIZE / 2; x < WORLD_SIZE / 2; x++) {
    for (let z = -WORLD_SIZE / 2; z < WORLD_SIZE / 2; z++) {
      const h = Math.floor(Math.sin(x * 0.3) * Math.cos(z * 0.3) * 2 + Math.sin(x * 0.15) * 1 + 3);
      for (let y = 0; y <= h; y++) {
        let type = BLOCK_TYPES.STONE;
        if (y === h) type = BLOCK_TYPES.GRASS;
        else if (y > h - 2) type = BLOCK_TYPES.DIRT;

        // Руды
        if (y < 4 && Math.random() < 0.02) type = BLOCK_TYPES.DIAMOND_ORE;
        else if (y < 6 && Math.random() < 0.03) type = BLOCK_TYPES.GOLD_ORE;
        else if (y < 10 && Math.random() < 0.05) type = BLOCK_TYPES.IRON_ORE;
        else if (y < 15 && Math.random() < 0.08) type = BLOCK_TYPES.COAL_ORE;

        if (y === h && type === BLOCK_TYPES.GRASS && Math.random() < 0.03) {
          addTree(x, y + 1, z);
        } else {
          world.set(key(x, y, z), type);
        }
      }
    }
  }
  console.log(`[${GAME_NAME}] ${world.size} blocks generated`);
}

function addTree(x, y, z) {
  for (let i = 0; i < 4; i++) world.set(key(x, y + i, z), BLOCK_TYPES.WOOD);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dy = 0; dy <= 2; dy++) {
        if (Math.abs(dx) + Math.abs(dz) + dy <= 2 && Math.random() > 0.3) {
          world.set(key(x + dx, y + 4 + dy, z + dz), BLOCK_TYPES.LEAVES);
        }
      }
    }
  }
}

generateWorld();

// ═══════════════════════════════════════════════════════════════
//  HTTP
// ═══════════════════════════════════════════════════════════════

const httpServer = http.createServer((req, res) => {
  let filePath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  filePath = path.join(__dirname, 'public', filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (!req.url.includes('favicon')) console.log(`[${GAME_NAME}] 404: ${req.url}`);
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    const mime = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
    }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Access-Control-Allow-Origin': '*' });
    res.end(data);
  });
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[${GAME_NAME}] HTTP: http://0.0.0.0:${PORT}`);
});

// ═══════════════════════════════════════════════════════════════
//  WEBSOCKET
// ═══════════════════════════════════════════════════════════════

const wss = new WebSocket.Server({ server: httpServer, verifyClient: () => true });

const clients = new Map();
const players = new Map();
let nextId = 1;

function makeEmptyInventory() {
  return new Array(PLAYER_INVENTORY_SIZE).fill(null);
}

function makeEmptyArmor() {
  return { helmet: null, chestplate: null, leggings: null, boots: null };
}

wss.on('connection', (ws) => {
  if (clients.size >= MAX_PLAYERS) {
    ws.send(JSON.stringify({ type: 'kick', reason: 'Сервер полон' }));
    ws.close();
    return;
  }

  const playerId = `p_${nextId++}`;
  console.log(`[${GAME_NAME}] ${playerId} connected`);

  clients.set(ws, playerId);
  players.set(playerId, {
    id: playerId,
    name: `Player_${playerId}`,
    x: RESPAWN_POS.x, y: RESPAWN_POS.y, z: RESPAWN_POS.z,
    yaw: 0, pitch: 0,
    hp: PLAYER_MAX_HP,
    food: PLAYER_MAX_FOOD,
    armor: makeEmptyArmor(),
    inventory: makeEmptyInventory(),
    selectedSlot: 0,
    kills: 0,
    deaths: 0,
    lastAttack: 0,
    lastFoodDecay: Date.now(),
  });

  ws.send(JSON.stringify({
    type: 'init',
    id: playerId,
    version: VERSION,
    gameName: GAME_NAME,
    maxPlayers: MAX_PLAYERS,
    world: Object.fromEntries(world),
    players: Object.fromEntries(players),
    blockTypes: BLOCK_INFO,
    weaponTypes: WEAPON_INFO,
    armorTypes: ARMOR_INFO,
    foodTypes: FOOD_INFO,
    materialTypes: MATERIAL_INFO,
    recipes: RECIPES,
    chatHistory,
    respawn: RESPAWN_POS,
    maxHp: PLAYER_MAX_HP,
    maxFood: PLAYER_MAX_FOOD,
    inventorySize: PLAYER_INVENTORY_SIZE,
  }));

  broadcast({ type: 'player_join', player: players.get(playerId) }, ws);
  broadcast({ type: 'chat', ...addChatMessage('SYSTEM', `${playerId} присоединился`) });

  ws.on('message', (raw) => {
    try { handleMessage(ws, playerId, JSON.parse(raw)); }
    catch (e) { console.error('Parse error:', e.message); }
  });

  ws.on('close', () => {
    const p = players.get(playerId);
    const name = p ? p.name : playerId;
    clients.delete(ws);
    players.delete(playerId);
    broadcast({ type: 'player_leave', id: playerId });
    broadcast({ type: 'chat', ...addChatMessage('SYSTEM', `${name} покинул`) });
  });

  ws.on('error', (err) => console.error(`[${GAME_NAME}] ${playerId} error:`, err.message));
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
});

const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);
wss.on('close', () => clearInterval(interval));

// ═══ Еда / голод ═══
setInterval(() => {
  const now = Date.now();
  for (const player of players.values()) {
    if (player.hp <= 0) continue;

    if (now - player.lastFoodDecay > FOOD_DECAY_INTERVAL) {
      player.lastFoodDecay = now;
      player.food = Math.max(0, player.food - 1);
      broadcast({ type: 'player_food', id: player.id, food: player.food });
    }

    if (player.food >= 18 && player.hp < PLAYER_MAX_HP) {
      player.hp = Math.min(PLAYER_MAX_HP, player.hp + 1);
      broadcast({ type: 'player_health', id: player.id, hp: player.hp });
    }
  }
}, 1000);

// ═══════════════════════════════════════════════════════════════
//  HANDLE MESSAGES
// ═══════════════════════════════════════════════════════════════

function handleMessage(ws, playerId, msg) {
  const player = players.get(playerId);
  if (!player) return;

  switch (msg.type) {
    case 'set_name': {
      const oldName = player.name;
      player.name = String(msg.name || '').slice(0, 20).trim() || `Player_${playerId}`;
      broadcast({ type: 'player_update', player });
      if (oldName !== player.name) {
        broadcast({ type: 'chat', ...addChatMessage('SYSTEM', `${oldName} теперь ${player.name}`) });
      }
      break;
    }

    case 'move': {
      player.x = +msg.x || 0;
      player.y = +msg.y || 0;
      player.z = +msg.z || 0;
      player.yaw = +msg.yaw || 0;
      player.pitch = +msg.pitch || 0;
      broadcast({
        type: 'player_move', id: playerId,
        x: player.x, y: player.y, z: player.z,
        yaw: player.yaw, pitch: player.pitch,
      }, ws);
      break;
    }

    case 'block_place': {
      const { x, y, z, block } = msg;
      const k = key(x, y, z);
      if (world.has(k)) return;
      if (!(block in BLOCK_INFO)) return;
      world.set(k, block);
      broadcast({ type: 'block_place', x, y, z, block });
      break;
    }

    case 'block_remove': {
      const { x, y, z } = msg;
      const k = key(x, y, z);
      if (!world.has(k)) return;
      const type = world.get(k);
      world.delete(k);
      broadcast({ type: 'block_remove', x, y, z });

      // Добыча руд → материалы
      if (type === BLOCK_TYPES.COAL_ORE) addInventoryItem(player, 'material', 1, 1);
      if (type === BLOCK_TYPES.IRON_ORE) addInventoryItem(player, 'material', 2, 1);
      if (type === BLOCK_TYPES.GOLD_ORE) addInventoryItem(player, 'material', 3, 1);
      if (type === BLOCK_TYPES.DIAMOND_ORE) addInventoryItem(player, 'material', 4, 1);
      break;
    }

    case 'chat': {
      const text = String(msg.text || '').slice(0, 200).trim();
      if (!text) return;
      broadcast({ type: 'chat', ...addChatMessage(player.name, text) });
      break;
    }

    // ═══ АТАКА ═══
    case 'attack': {
      const target = players.get(msg.target);
      if (!target) return;
      if (target.id === playerId) return;
      if (target.hp <= 0) return;

      const now = Date.now();
      if (now - player.lastAttack < ATTACK_COOLDOWN) return;
      player.lastAttack = now;

      const dx = target.x - player.x;
      const dy = target.y - player.y;
      const dz = target.z - player.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > ATTACK_RANGE) return;

      // Оружие
      const weapon = player.inventory[player.selectedSlot];
      const weaponDamage = (weapon && weapon.type === 'weapon') ? WEAPON_INFO[weapon.id].damage : 1;

      // Броня цели
      let armorPoints = 0;
      for (const slot of ARMOR_SLOTS) {
        const piece = target.armor[slot];
        if (piece && piece.type !== undefined) armorPoints += ARMOR_INFO[piece.type]?.defense || 0;
      }
      const reduction = Math.min(0.8, armorPoints * 0.04);
      const damage = Math.max(1, Math.round(weaponDamage * (1 - reduction)));

      target.hp -= damage;

      broadcast({
        type: 'attack',
        attacker: playerId, attackerName: player.name,
        target: target.id, targetName: target.name,
        hp: target.hp, damage,
      });

      if (target.hp <= 0) {
        target.hp = 0;
        target.deaths++;
        player.kills++;

        broadcast({ type: 'player_death', id: target.id, name: target.name, killerName: player.name });
        broadcast({ type: 'chat', ...addChatMessage('SYSTEM', `${target.name} убит игроком ${player.name}`) });
        broadcast({ type: 'leaderboard', data: getLeaderboard() });

        setTimeout(() => {
          if (!players.has(target.id)) return;
          target.hp = PLAYER_MAX_HP;
          target.food = PLAYER_MAX_FOOD;
          target.x = RESPAWN_POS.x;
          target.y = RESPAWN_POS.y;
          target.z = RESPAWN_POS.z;
          broadcast({
            type: 'player_respawn', id: target.id,
            x: target.x, y: target.y, z: target.z,
            hp: target.hp, food: target.food,
          });
          broadcast({ type: 'chat', ...addChatMessage('SYSTEM', `${target.name} возродился`) });
        }, 2000);
      }
      break;
    }

    case 'armor_equip': {
      const { slot, armorType } = msg;
      if (!ARMOR_SLOTS.includes(slot)) return;
      if (!(armorType in ARMOR_INFO)) return;
      player.armor[slot] = { type: armorType };
      broadcast({ type: 'player_armor', id: playerId, armor: player.armor });
      break;
    }

    case 'armor_unequip': {
      const { slot } = msg;
      if (!ARMOR_SLOTS.includes(slot)) return;
      player.armor[slot] = null;
      broadcast({ type: 'player_armor', id: playerId, armor: player.armor });
      break;
    }

    case 'eat': {
      const slot = msg.slot;
      const item = player.inventory[slot];
      if (!item || item.type !== 'food') return;
      const foodInfo = FOOD_INFO[item.id];
      if (!foodInfo) return;
      player.food = Math.min(PLAYER_MAX_FOOD, player.food + foodInfo.heal);
      player.hp = Math.min(PLAYER_MAX_HP, player.hp + foodInfo.heal);
      player.inventory[slot] = null;
      broadcast({ type: 'player_health', id: playerId, hp: player.hp });
      broadcast({ type: 'player_food', id: playerId, food: player.food });
      broadcast({ type: 'inventory_update', id: playerId, inventory: player.inventory });
      broadcast({ type: 'chat', ...addChatMessage('SYSTEM', `${player.name} съел ${foodInfo.name}`) });
      break;
    }

    case 'select_slot': {
      player.selectedSlot = Math.max(0, Math.min(PLAYER_INVENTORY_SIZE - 1, +msg.slot || 0));
      ws.send(JSON.stringify({ type: 'selected_slot', slot: player.selectedSlot }));
      break;
    }

    case 'craft': {
      const recipeIndex = msg.recipeIndex;
      const recipe = RECIPES[recipeIndex];
      if (!recipe) return;
      if (!hasIngredients(player, recipe.ingredients)) {
        ws.send(JSON.stringify({ type: 'craft_fail', reason: 'Нет материалов' }));
        return;
      }
      removeIngredients(player, recipe.ingredients);
      const item = { ...recipe.result };
      addInventoryItem(player, item.type, item.id, item.count, item.slot);
      broadcast({ type: 'inventory_update', id: playerId, inventory: player.inventory });
      ws.send(JSON.stringify({ type: 'craft_success', result: item }));
      break;
    }

    case 'leaderboard': {
      ws.send(JSON.stringify({ type: 'leaderboard', data: getLeaderboard() }));
      break;
    }

    case 'ping':
      ws.send(JSON.stringify({ type: 'pong', t: msg.t }));
      break;
  }
}

// ═══ INVENTORY HELPERS ═══
function addInventoryItem(player, type, id, count, slot) {
  if (slot !== undefined && slot !== null) {
    player.inventory[slot] = { type, id, count };
    return;
  }
  // Ищем свободный слот
  for (let i = 0; i < player.inventory.length; i++) {
    if (!player.inventory[i]) {
      player.inventory[i] = { type, id, count };
      return;
    }
  }
}

function hasIngredients(player, ingredients) {
  for (const ing of ingredients) {
    let found = 0;
    for (const item of player.inventory) {
      if (item && item.type === ing.type && item.id === ing.id) {
        found += item.count;
      }
    }
    if (found < ing.count) return false;
  }
  return true;
}

function removeIngredients(player, ingredients) {
  for (const ing of ingredients) {
    let needed = ing.count;
    for (let i = 0; i < player.inventory.length && needed > 0; i++) {
      const item = player.inventory[i];
      if (item && item.type === ing.type && item.id === ing.id) {
        const take = Math.min(item.count, needed);
        item.count -= take;
        needed -= take;
        if (item.count <= 0) player.inventory[i] = null;
      }
    }
  }
}

function getLeaderboard() {
  return Array.from(players.values())
    .sort((a, b) => b.kills - a.kills)
    .slice(0, 10)
    .map(p => ({ name: p.name, kills: p.kills, deaths: p.deaths }));
}

function broadcast(msg, exclude = null) {
  const data = JSON.stringify(msg);
  for (const [ws] of clients) {
    if (ws === exclude) continue;
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

process.on('SIGINT', () => {
  console.log(`\n[${GAME_NAME}] Shutting down...`);
  process.exit(0);
});

console.log(`[${GAME_NAME}] WebSocket ready on port ${PORT}`);
console.log(`[${GAME_NAME}] Max players: ${MAX_PLAYERS}`);
console.log(`[${GAME_NAME}] Ready!`);
