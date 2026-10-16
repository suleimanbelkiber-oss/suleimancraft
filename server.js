/**
 * SuleimanCraft — 3D online sandbox server.
 * Node.js + ws
 * Author: Suleiman
 * Version: 10.0.0
 *
 * Без БД. Аккаунты в памяти. Вайп при git push = новый сезон.
 * Админ: SuleimanPvP. Команды: /ban /unban /wipe /resetdata
 */

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { filterBadWords } = require('./badwords');

const PORT = process.env.PORT || 3001;
const VERSION = '10.0.0';
const SEASON = 1;
const GAME_NAME = 'SuleimanCraft';
const WORLD_SIZE = 16;
const MAX_PLAYERS = 100;
const MAX_CHAT_HISTORY = 50;
const PLAYER_MAX_HP = 20;
const PLAYER_MAX_FOOD = 20;
const RESPAWN_POS = { x: 0, y: 15, z: 0 };
const ATTACK_RANGE = 4;
const ATTACK_COOLDOWN = 500;
const FOOD_DECAY_INTERVAL = 30000;
const PLAYER_INVENTORY_SIZE = 27;

// Оптимизация
const RATE_LIMIT = 20;
const RATE_WINDOW = 1000;
const BROADCAST_INTERVAL = 50;
const NEARBY_RADIUS = 64;
const NEARBY_RADIUS_SQ = NEARBY_RADIUS * NEARBY_RADIUS;

// ═══ CHAT ═══
let chatHistory = [];
function addChatMessage(name, text) {
  const msg = { name, text, timestamp: Date.now() };
  chatHistory.push(msg);
  if (chatHistory.length > MAX_CHAT_HISTORY) chatHistory = chatHistory.slice(-MAX_CHAT_HISTORY);
  return msg;
}

// ═══ ACCOUNTS (в памяти) ═══
const accounts = new Map();     // username -> user
const sessions = new Map();     // token -> userId
const bannedUsers = new Map();  // username -> { reason, bannedBy, bannedAt }
let nextUserId = 1;

function hashPassword(p) { return bcrypt.hashSync(p, 10); }
function verifyPassword(p, h) { return bcrypt.compareSync(p, h); }
function makeToken() { return crypto.randomBytes(32).toString('hex'); }

function isBanned(username) {
  if (!username) return false;
  return bannedUsers.has(String(username).toLowerCase().trim());
}

function banUser(username, reason, bannedBy) {
  username = String(username).toLowerCase().trim();
  bannedUsers.set(username, {
    reason: reason || 'Без причины',
    bannedBy: bannedBy || 'ADMIN',
    bannedAt: Date.now(),
  });
}

function unbanUser(username) {
  username = String(username).toLowerCase().trim();
  return bannedUsers.delete(username);
}

function resetUserData(user) {
  user.stats = {
    kills: 0,
    deaths: 0,
    blocksPlaced: 0,
    blocksBroken: 0,
    playtime: 0,
    createdAt: user.stats.createdAt,
    lastSeen: Date.now(),
  };
}

function registerUser(username, password, nickname) {
  username = String(username).toLowerCase().trim();
  nickname = String(nickname).slice(0, 20).trim();

  if (isBanned(username)) return { error: 'Этот логин забанен' };
  if (username.length < 3 || username.length > 20) return { error: 'Логин 3-20 символов' };
  if (password.length < 4) return { error: 'Пароль минимум 4 символа' };
  if (!nickname) return { error: 'Введи ник' };
  if (accounts.has(username)) return { error: 'Логин занят' };

  const { clean: cleanNick, found } = filterBadWords(nickname);
  if (found) nickname = cleanNick;

  const user = {
    id: nextUserId++,
    username,
    passwordHash: hashPassword(password),
    nickname,
    role: 'player',
    stats: {
      kills: 0, deaths: 0,
      blocksPlaced: 0, blocksBroken: 0,
      playtime: 0,
      createdAt: Date.now(),
      lastSeen: Date.now(),
    },
  };
  accounts.set(username, user);
  return { user };
}

function loginUser(username, password) {
  username = String(username).toLowerCase().trim();

  if (isBanned(username)) {
    const info = bannedUsers.get(username);
    return { error: `Ты забанен. Причина: ${info.reason}` };
  }

  const user = accounts.get(username);
  if (!user) return { error: 'Неверный логин' };
  if (!verifyPassword(password, user.passwordHash)) return { error: 'Неверный пароль' };
  user.stats.lastSeen = Date.now();
  return { user };
}

function getSession(token) {
  const userId = sessions.get(token);
  if (!userId) return null;
  for (const user of accounts.values()) {
    if (user.id === userId) return user;
  }
  return null;
}

// ═══ ADMIN ═══
const ADMIN_USERNAME = 'suleimanpvp';
const ADMIN_NICKNAME = 'SuleimanPvP';
const ADMIN_PASSWORD = 'suleiman123';   // ← СМЕНИ!

(function createAdmin() {
  if (!accounts.has(ADMIN_USERNAME)) {
    accounts.set(ADMIN_USERNAME, {
      id: nextUserId++,
      username: ADMIN_USERNAME,
      passwordHash: hashPassword(ADMIN_PASSWORD),
      nickname: ADMIN_NICKNAME,
      role: 'admin',
      stats: {
        kills: 0, deaths: 0,
        blocksPlaced: 0, blocksBroken: 0,
        playtime: 0,
        createdAt: Date.now(),
        lastSeen: Date.now(),
      },
    });
    console.log(`[${GAME_NAME}] Admin created: ${ADMIN_USERNAME}`);
  }
})();

function isAdmin(player) {
  return player && player.role === 'admin';
}

// ═══ BLOCKS ═══
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

// ═══ WEAPONS ═══
const WEAPON_INFO = {
  0: { name: 'Деревянный меч', color: 0x8B6F47, damage: 2 },
  1: { name: 'Каменный меч', color: 0x808080, damage: 3 },
  2: { name: 'Железный меч', color: 0xC0C0C0, damage: 4 },
  3: { name: 'Золотой меч', color: 0xFFD700, damage: 4 },
  4: { name: 'Алмазный меч', color: 0x4AEDD9, damage: 5 },
};

// ═══ ARMOR ═══
const ARMOR_INFO = {
  0: { name: 'Кожаная', color: 0x8B6F47, defense: 1 },
  1: { name: 'Железная', color: 0xC0C0C0, defense: 2 },
  2: { name: 'Золотая', color: 0xFFD700, defense: 2 },
  3: { name: 'Алмазная', color: 0x4AEDD9, defense: 3 },
};
const ARMOR_SLOTS = ['helmet', 'chestplate', 'leggings', 'boots'];

// ═══ FOOD ═══
const FOOD_INFO = {
  0: { name: 'Яблоко', color: 0xFF4040, heal: 4 },
  1: { name: 'Хлеб', color: 0xD2A24A, heal: 5 },
  2: { name: 'Мясо', color: 0xA0522D, heal: 6 },
  3: { name: 'Золотое яблоко', color: 0xFFD700, heal: 10 },
};

// ═══ MATERIALS ═══
const MATERIAL_INFO = {
  0: { name: 'Палка', color: 0x8B6F47 },
  1: { name: 'Уголь', color: 0x222222 },
  2: { name: 'Железный слиток', color: 0xC0C0C0 },
  3: { name: 'Золотой слиток', color: 0xFFD700 },
  4: { name: 'Алмаз', color: 0x4AEDD9 },
  5: { name: 'Пшеница', color: 0xD2A24A },
};

// ═══ RECIPES ═══
const RECIPES = [
  { result: { type: 'block', id: 3, count: 1 }, ingredients: [{ type: 'material', id: 0, count: 1 }] },
  { result: { type: 'weapon', id: 0, count: 1 }, ingredients: [{ type: 'block', id: 3, count: 2 }, { type: 'material', id: 0, count: 1 }] },
  { result: { type: 'weapon', id: 1, count: 1 }, ingredients: [{ type: 'block', id: 2, count: 2 }, { type: 'material', id: 0, count: 1 }] },
  { result: { type: 'weapon', id: 2, count: 1 }, ingredients: [{ type: 'material', id: 2, count: 2 }, { type: 'material', id: 0, count: 1 }] },
  { result: { type: 'weapon', id: 3, count: 1 }, ingredients: [{ type: 'material', id: 3, count: 2 }, { type: 'material', id: 0, count: 1 }] },
  { result: { type: 'weapon', id: 4, count: 1 }, ingredients: [{ type: 'material', id: 4, count: 2 }, { type: 'material', id: 0, count: 1 }] },
  { result: { type: 'armor', id: 1, slot: 'helmet', count: 1 }, ingredients: [{ type: 'material', id: 2, count: 5 }] },
  { result: { type: 'armor', id: 1, slot: 'chestplate', count: 1 }, ingredients: [{ type: 'material', id: 2, count: 8 }] },
  { result: { type: 'armor', id: 1, slot: 'leggings', count: 1 }, ingredients: [{ type: 'material', id: 2, count: 7 }] },
  { result: { type: 'armor', id: 1, slot: 'boots', count: 1 }, ingredients: [{ type: 'material', id: 2, count: 4 }] },
  { result: { type: 'armor', id: 2, slot: 'helmet', count: 1 }, ingredients: [{ type: 'material', id: 3, count: 5 }] },
  { result: { type: 'armor', id: 2, slot: 'chestplate', count: 1 }, ingredients: [{ type: 'material', id: 3, count: 8 }] },
  { result: { type: 'armor', id: 2, slot: 'leggings', count: 1 }, ingredients: [{ type: 'material', id: 3, count: 7 }] },
  { result: { type: 'armor', id: 2, slot: 'boots', count: 1 }, ingredients: [{ type: 'material', id: 3, count: 4 }] },
  { result: { type: 'armor', id: 3, slot: 'helmet', count: 1 }, ingredients: [{ type: 'material', id: 4, count: 5 }] },
  { result: { type: 'armor', id: 3, slot: 'chestplate', count: 1 }, ingredients: [{ type: 'material', id: 4, count: 8 }] },
  { result: { type: 'armor', id: 3, slot: 'leggings', count: 1 }, ingredients: [{ type: 'material', id: 4, count: 7 }] },
  { result: { type: 'armor', id: 3, slot: 'boots', count: 1 }, ingredients: [{ type: 'material', id: 4, count: 4 }] },
  { result: { type: 'food', id: 1, count: 1 }, ingredients: [{ type: 'material', id: 5, count: 3 }] },
];

// ═══ WORLD ═══
const world = new Map();
const key = (x, y, z) => `${x},${y},${z}`;

function generateWorld() {
  console.log(`[${GAME_NAME}] Generating world...`);
  world.clear();
  for (let x = -WORLD_SIZE / 2; x < WORLD_SIZE / 2; x++) {
    for (let z = -WORLD_SIZE / 2; z < WORLD_SIZE / 2; z++) {
      const h = Math.floor(Math.sin(x * 0.3) * Math.cos(z * 0.3) * 2 + Math.sin(x * 0.15) * 1 + 3);
      for (let y = 0; y <= h; y++) {
        let type = BLOCK_TYPES.STONE;
        if (y === h) type = BLOCK_TYPES.GRASS;
        else if (y > h - 2) type = BLOCK_TYPES.DIRT;

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

// ═══ HTTP ═══
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

// ═══ WEBSOCKET ═══
const wss = new WebSocket.Server({
  server: httpServer,
  verifyClient: () => true,
  perMessageDeflate: false,
  maxPayload: 1024 * 64,
});

const clients = new Map();
const players = new Map();
const playerRates = new Map();
let nextId = 1;

function makeEmptyInventory() {
  return new Array(PLAYER_INVENTORY_SIZE).fill(null);
}

function makeEmptyArmor() {
  return { helmet: null, chestplate: null, leggings: null, boots: null };
}

function checkRate(playerId) {
  const now = Date.now();
  if (!playerRates.has(playerId)) playerRates.set(playerId, []);
  const arr = playerRates.get(playerId).filter(t => now - t < RATE_WINDOW);
  arr.push(now);
  playerRates.set(playerId, arr);
  return arr.length <= RATE_LIMIT;
}

function findPlayerByName(name) {
  const lower = String(name).toLowerCase();
  for (const p of players.values()) {
    if (p.name && p.name.toLowerCase() === lower) return p;
    if (p.username && p.username.toLowerCase() === lower) return p;
  }
  return null;
}

// ═══ CONNECTION ═══
wss.on('connection', (ws) => {
  if (clients.size >= MAX_PLAYERS) {
    ws.send(JSON.stringify({ type: 'kick', reason: 'Сервер полон' }));
    ws.close();
    return;
  }

  const playerId = `p_${nextId++}`;
  console.log(`[${GAME_NAME}] ${playerId} connected (${clients.size + 1}/${MAX_PLAYERS})`);

  clients.set(ws, playerId);
  players.set(playerId, {
    id: playerId,
    name: `Player_${playerId}`,
    username: null,
    userId: null,
    role: 'player',
    x: RESPAWN_POS.x, y: RESPAWN_POS.y, z: RESPAWN_POS.z,
    yaw: 0, pitch: 0,
    hp: PLAYER_MAX_HP,
    food: PLAYER_MAX_FOOD,
    armor: makeEmptyArmor(),
    inventory: makeEmptyInventory(),
    selectedSlot: 0,
    kills: 0,
    deaths: 0,
    blocksPlaced: 0,
    blocksBroken: 0,
    lastAttack: 0,
    lastFoodDecay: Date.now(),
  });

  ws.send(JSON.stringify({
    type: 'init',
    id: playerId,
    version: VERSION,
    season: SEASON,
    gameName: GAME_NAME,
    maxPlayers: MAX_PLAYERS,
    currentPlayers: clients.size,
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
    networkRate: 3,
    broadcastRadius: NEARBY_RADIUS,
  }));

  broadcast({ type: 'player_join', player: players.get(playerId) }, ws);
  broadcast({ type: 'chat', ...addChatMessage('SYSTEM', `${playerId} присоединился`) });
  broadcastOnline();

  ws.on('message', (raw) => {
    if (!checkRate(playerId)) return;
    try { handleMessage(ws, playerId, JSON.parse(raw)); }
    catch (e) { console.error('Parse error:', e.message); }
  });

  ws.on('close', () => {
    const p = players.get(playerId);
    const name = p ? p.name : playerId;
    clients.delete(ws);
    players.delete(playerId);
    playerRates.delete(playerId);
    broadcast({ type: 'player_leave', id: playerId });
    broadcast({ type: 'chat', ...addChatMessage('SYSTEM', `${name} покинул`) });
    broadcastOnline();
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

// ═══ FOOD / HP ═══
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

// ═══ BROADCAST (batching) ═══
let broadcastQueue = [];
function broadcast(msg, exclude = null) {
  broadcastQueue.push({ msg, exclude });
}

setInterval(() => {
  if (broadcastQueue.length === 0) return;
  const queue = broadcastQueue;
  broadcastQueue = [];
  for (const { msg, exclude } of queue) {
    const data = JSON.stringify(msg);
    for (const [ws] of clients) {
      if (ws === exclude) continue;
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  }
}, BROADCAST_INTERVAL);

function broadcastNearby(msg, x, y, z, exclude = null) {
  const data = JSON.stringify(msg);
  for (const [ws, id] of clients) {
    if (ws === exclude) continue;
    const p = players.get(id);
    if (!p) continue;
    const dx = p.x - x, dy = p.y - y, dz = p.z - z;
    if (dx * dx + dy * dy + dz * dz < NEARBY_RADIUS_SQ) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  }
}

function broadcastOnline() {
  broadcast({ type: 'online', count: clients.size, max: MAX_PLAYERS });
}

// ═══ INVENTORY HELPERS ═══
function addInventoryItem(player, type, id, count, slot) {
  if (slot !== undefined && slot !== null) {
    player.inventory[slot] = { type, id, count };
    return;
  }
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
      if (item && item.type === ing.type && item.id === ing.id) found += item.count;
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

// ═══ HANDLE MESSAGES ═══
function handleMessage(ws, playerId, msg) {
  const player = players.get(playerId);
  if (!player) return;

  switch (msg.type) {

    // ═══ РЕГИСТРАЦИЯ ═══
    case 'register': {
      const { username, password, nickname } = msg;
      const result = registerUser(username, password, nickname);
      if (result.error) {
        ws.send(JSON.stringify({ type: 'auth_error', reason: result.error }));
        return;
      }

      const user = result.user;
      const token = makeToken();
      sessions.set(token, user.id);

      player.userId = user.id;
      player.username = user.username;
      player.name = user.nickname;
      player.role = user.role;

      ws.send(JSON.stringify({
        type: 'auth_ok',
        token,
        user: {
          username: user.username,
          nickname: user.nickname,
          role: user.role,
        },
        stats: user.stats,
        season: SEASON,
      }));

      broadcast({ type: 'player_update', player });
      broadcast({ type: 'chat', ...addChatMessage('SYSTEM', `${user.nickname} зарегистрировался`) });
      break;
    }

    // ═══ ВХОД ═══
    case 'login': {
      const { username, password } = msg;
      const result = loginUser(username, password);
      if (result.error) {
        ws.send(JSON.stringify({ type: 'auth_error', reason: result.error }));
        return;
      }

      const user = result.user;
      const token = makeToken();
      sessions.set(token, user.id);

      player.userId = user.id;
      player.username = user.username;
      player.name = user.nickname;
      player.role = user.role;
      player.kills = user.stats.kills;
      player.deaths = user.stats.deaths;
      player.blocksPlaced = user.stats.blocksPlaced;
      player.blocksBroken = user.stats.blocksBroken;

      ws.send(JSON.stringify({
        type: 'auth_ok',
        token,
        user: {
          username: user.username,
          nickname: user.nickname,
          role: user.role,
        },
        stats: user.stats,
        season: SEASON,
      }));

      broadcast({ type: 'player_update', player });
      broadcast({ type: 'chat', ...addChatMessage('SYSTEM', `${user.nickname} зашёл в игру`) });
      break;
    }

    // ═══ АВТО-ВХОД ПО ТОКЕНУ ═══
    case 'auth_token': {
      const { token } = msg;
      const user = getSession(token);
      if (!user) {
        ws.send(JSON.stringify({ type: 'auth_error', reason: 'Сессия устарела' }));
        return;
      }

      player.userId = user.id;
      player.username = user.username;
      player.name = user.nickname;
      player.role = user.role;
      player.kills = user.stats.kills;
      player.deaths = user.stats.deaths;
      player.blocksPlaced = user.stats.blocksPlaced;
      player.blocksBroken = user.stats.blocksBroken;

      ws.send(JSON.stringify({
        type: 'auth_ok',
        token,
        user: {
          username: user.username,
          nickname: user.nickname,
          role: user.role,
        },
        stats: user.stats,
        season: SEASON,
      }));

      broadcast({ type: 'player_update', player });
      break;
    }

    // ═══ СМЕНА НИКА ═══
    case 'set_name': {
      if (!player.username) {
        ws.send(JSON.stringify({ type: 'chat', name: 'SYSTEM', text: 'Сначала войди или зарегистрируйся', timestamp: Date.now() }));
        return;
      }
      const oldName = player.name;
      let name = String(msg.name || '').slice(0, 20).trim() || player.name;

      const { clean, found } = filterBadWords(name);
      if (found) name = clean;

      player.name = name;
      broadcast({ type: 'player_update', player });
      if (oldName !== player.name) {
        broadcast({ type: 'chat', ...addChatMessage('SYSTEM', `${oldName} теперь ${player.name}`) });
      }
      break;
    }

    // ═══ ДВИЖЕНИЕ ═══
    case 'move': {
      player.x = +msg.x || 0;
      player.y = +msg.y || 0;
      player.z = +msg.z || 0;
      player.yaw = +msg.yaw || 0;
      player.pitch = +msg.pitch || 0;

      broadcastNearby({
        type: 'player_move', id: playerId,
        x: player.x, y: player.y, z: player.z,
        yaw: player.yaw, pitch: player.pitch,
      }, player.x, player.y, player.z, ws);
      break;
    }

    // ═══ БЛОКИ ═══
    case 'block_place': {
      const { x, y, z, block } = msg;
      const k = key(x, y, z);
      if (world.has(k)) return;
      if (!(block in BLOCK_INFO)) return;
      world.set(k, block);
      player.blocksPlaced = (player.blocksPlaced || 0) + 1;
      broadcastNearby({ type: 'block_place', x, y, z, block }, x, y, z);
      break;
    }

    case 'block_remove': {
      const { x, y, z } = msg;
      const k = key(x, y, z);
      if (!world.has(k)) return;
      const type = world.get(k);
      world.delete(k);
      player.blocksBroken = (player.blocksBroken || 0) + 1;

      broadcastNearby({ type: 'block_remove', x, y, z }, x, y, z);

      if (type === BLOCK_TYPES.COAL_ORE) addInventoryItem(player, 'material', 1, 1);
      if (type === BLOCK_TYPES.IRON_ORE) addInventoryItem(player, 'material', 2, 1);
      if (type === BLOCK_TYPES.GOLD_ORE) addInventoryItem(player, 'material', 3, 1);
      if (type === BLOCK_TYPES.DIAMOND_ORE) addInventoryItem(player, 'material', 4, 1);
      break;
    }

    // ═══ ЧАТ / АДМИН-КОМАНДЫ ═══
    case 'chat': {
      const text = String(msg.text || '').slice(0, 200).trim();
      if (!text) return;

      // Админ-команды
      if (text.startsWith('/') && isAdmin(player)) {
        const parts = text.slice(1).split(/\s+/);
        const cmd = parts[0].toLowerCase();
        const args = parts.slice(1);

        switch (cmd) {

          // /ban <ник> [причина]
          case 'ban': {
            const targetName = args[0];
            const reason = args.slice(1).join(' ') || 'Без причины';
            if (!targetName) {
              ws.send(JSON.stringify({ type: 'chat', name: 'SYSTEM', text: 'Использование: /ban <ник> [причина]', timestamp: Date.now() }));
              break;
            }
            const target = findPlayerByName(targetName);
            if (target && target.username) {
              banUser(target.username, reason, player.name);
              broadcast({ type: 'chat', ...addChatMessage('SYSTEM', `🔨 ${target.name} забанен. Причина: ${reason}`) });
              const targetWs = [...clients.entries()].find(([ws2, id]) => id === target.id)?.[0];
              if (targetWs) {
                targetWs.send(JSON.stringify({ type: 'kick', reason: `Забанен: ${reason}` }));
                targetWs.close();
              }
            } else if (args[0]) {
              // Бан по логину
              banUser(args[0], reason, player.name);
              broadcast({ type: 'chat', ...addChatMessage('SYSTEM', `🔨 Логин ${args[0]} забанен. Причина: ${reason}`) });
            }
            break;
          }

          // /unban <ник>
          case 'unban': {
            const targetName = args[0];
            if (!targetName) {
              ws.send(JSON.stringify({ type: 'chat', name: 'SYSTEM', text: 'Использование: /unban <ник>', timestamp: Date.now() }));
              break;
            }
            const removed = unbanUser(targetName);
            if (removed) {
              broadcast({ type: 'chat', ...addChatMessage('SYSTEM', `✅ Логин ${targetName} разбанен`) });
            } else {
              ws.send(JSON.stringify({ type: 'chat', name: 'SYSTEM', text: 'Не найден в бане', timestamp: Date.now() }));
            }
            break;
          }

          // /wipe — сброс всего
          case 'wipe': {
            accounts.clear();
            sessions.clear();
            bannedUsers.clear();
            chatHistory = [];
            nextUserId = 1;

            // Восстанавливаем админа
            accounts.set(ADMIN_USERNAME, {
              id: nextUserId++,
              username: ADMIN_USERNAME,
              passwordHash: hashPassword(ADMIN_PASSWORD),
              nickname: ADMIN_NICKNAME,
              role: 'admin',
              stats: {
                kills: 0, deaths: 0,
                blocksPlaced: 0, blocksBroken: 0,
                playtime: 0,
                createdAt: Date.now(),
                lastSeen: Date.now(),
              },
            });

            // Кикаем всех
            for (const [ws2] of clients) {
              ws2.send(JSON.stringify({ type: 'kick', reason: 'Сервер вайпнут. Новый сезон!' }));
              ws2.close();
            }
            console.log(`[${GAME_NAME}] WIPE by ${player.name}`);
            break;
          }

          // /resetdata <ник>
          case 'resetdata': {
            const targetName = args[0];
            if (!targetName) {
              ws.send(JSON.stringify({ type: 'chat', name: 'SYSTEM', text: 'Использование: /resetdata <ник>', timestamp: Date.now() }));
              break;
            }
            const target = findPlayerByName(targetName);
            if (target && target.userId) {
              for (const user of accounts.values()) {
                if (user.id === target.userId) {
                  resetUserData(user);
                  target.kills = 0;
                  target.deaths = 0;
                  broadcast({ type: 'chat', ...addChatMessage('SYSTEM', `♻️ Данные ${target.name} сброшены`) });
                  broadcast({ type: 'player_update', player: target });
                  break;
                }
              }
            } else {
              const user = accounts.get(String(targetName).toLowerCase());
              if (user) {
                resetUserData(user);
                broadcast({ type: 'chat', ...addChatMessage('SYSTEM', `♻️ Данные ${user.nickname} сброшены`) });
              } else {
                ws.send(JSON.stringify({ type: 'chat', name: 'SYSTEM', text: 'Игрок не найден', timestamp: Date.now() }));
              }
            }
            break;
          }

          case 'help': {
            ws.send(JSON.stringify({
              type: 'chat', name: 'SYSTEM',
              text: 'Админ: /ban /unban /wipe /resetdata',
              timestamp: Date.now(),
            }));
            break;
          }

          default:
            ws.send(JSON.stringify({ type: 'chat', name: 'SYSTEM', text: 'Неизвестная админ-команда', timestamp: Date.now() }));
        }
        return;
      }

      // Обычный чат
      const { clean, found } = filterBadWords(text);
      if (clean.replace(/\*/g, '').trim() === '') {
        ws.send(JSON.stringify({ type: 'chat_warning', text: 'Сообщение отклонено (мат)' }));
        return;
      }
      broadcast({ type: 'chat', ...addChatMessage(player.name, clean) });
      if (found) {
        ws.send(JSON.stringify({ type: 'chat_warning', text: 'Мат запрещён. Сообщение изменено.' }));
      }
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

      const weapon = player.inventory[player.selectedSlot];
      const weaponDamage = (weapon && weapon.type === 'weapon') ? WEAPON_INFO[weapon.id].damage : 1;

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

        // Обновляем статы в аккаунтах
        if (player.userId) {
          for (const u of accounts.values()) {
            if (u.id === player.userId) { u.stats.kills++; break; }
          }
        }
        if (target.userId) {
          for (const u of accounts.values()) {
            if (u.id === target.userId) { u.stats.deaths++; break; }
          }
        }

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

    // ═══ БРОНЯ ═══
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

    // ═══ ЕДА ═══
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
      break;
    }

    // ═══ СЛОТ ═══
    case 'select_slot': {
      player.selectedSlot = Math.max(0, Math.min(PLAYER_INVENTORY_SIZE - 1, +msg.slot || 0));
      ws.send(JSON.stringify({ type: 'selected_slot', slot: player.selectedSlot }));
      break;
    }

    // ═══ КРАФТ ═══
    case 'craft': {
      const recipe = RECIPES[msg.recipeIndex];
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

    // ═══ ЛИДЕРБОРД ═══
    case 'leaderboard': {
      ws.send(JSON.stringify({ type: 'leaderboard', data: getLeaderboard() }));
      break;
    }

    // ═══ ПИНГ ═══
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong', t: msg.t }));
      break;
  }
}

// ═══ SHUTDOWN ═══
process.on('SIGINT', () => {
  console.log(`\n[${GAME_NAME}] Shutting down...`);
  process.exit(0);
});

// ═══ START ═══
console.log(`[${GAME_NAME}] WebSocket ready on port ${PORT}`);
console.log(`[${GAME_NAME}] Season: ${SEASON}`);
console.log(`[${GAME_NAME}] Max players: ${MAX_PLAYERS}`);
console.log(`[${GAME_NAME}] Admin: ${ADMIN_NICKNAME} (login: ${ADMIN_USERNAME})`);
console.log(`[${GAME_NAME}] Ready!`);
