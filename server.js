/**
 * SuleimanCraft — 3D online sandbox server.
 * Node.js + ws
 * Author: Suleiman
 * Version: 3.0.0
 *
 * Работает через туннель (localhost.run / Cloudflare / ngrok).
 * Все на одном порту: HTTP + WebSocket.
 * Tunnel: https://ab8408bb13a736.lhr.life
 */

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3001;
const VERSION = '3.0.0';
const GAME_NAME = 'SuleimanCraft';
const CHAT_FILE = path.join(__dirname, 'chat_history.json');
const MAX_CHAT_HISTORY = 100;

// ═══════════════════════════════════════════════════════════════
//  CHAT PERSISTENCE
// ═══════════════════════════════════════════════════════════════

let chatHistory = [];

function loadChat() {
  try {
    if (fs.existsSync(CHAT_FILE)) {
      chatHistory = JSON.parse(fs.readFileSync(CHAT_FILE, 'utf-8'));
      console.log(`[${GAME_NAME}] Loaded ${chatHistory.length} chat messages`);
    }
  } catch (e) { chatHistory = []; }
}

function saveChat() {
  try {
    fs.writeFileSync(CHAT_FILE, JSON.stringify(chatHistory.slice(-MAX_CHAT_HISTORY)), 'utf-8');
  } catch (e) {}
}

function addChatMessage(name, text) {
  const msg = { name, text, timestamp: Date.now() };
  chatHistory.push(msg);
  if (chatHistory.length > MAX_CHAT_HISTORY) chatHistory = chatHistory.slice(-MAX_CHAT_HISTORY);
  saveChat();
  return msg;
}

loadChat();

// ═══════════════════════════════════════════════════════════════
//  BLOCKS
// ═══════════════════════════════════════════════════════════════

const BLOCK_TYPES = {
  GRASS: 0, DIRT: 1, STONE: 2, WOOD: 3, LEAVES: 4,
  SAND: 5, WATER: 6, BRICK: 7, GLASS: 8, GOLD: 9,
};

const BLOCK_INFO = {
  0: { name: 'Трава', color: 0x4CAF50 },
  1: { name: 'Земля', color: 0x8B6F47 },
  2: { name: 'Камень', color: 0x808080 },
  3: { name: 'Дерево', color: 0x654321 },
  4: { name: 'Листва', color: 0x2E7D32 },
  5: { name: 'Песок', color: 0xF4E4A0 },
  6: { name: 'Вода', color: 0x2196F3 },
  7: { name: 'Кирпич', color: 0xB22222 },
  8: { name: 'Стекло', color: 0xADD8E6 },
  9: { name: 'Золото', color: 0xFFD700 },
};

const WORLD_SIZE = 32;
const world = new Map();
const key = (x, y, z) => `${x},${y},${z}`;

function generateWorld() {
  console.log(`[${GAME_NAME}] Generating world...`);
  for (let x = -WORLD_SIZE / 2; x < WORLD_SIZE / 2; x++) {
    for (let z = -WORLD_SIZE / 2; z < WORLD_SIZE / 2; z++) {
      const h = Math.floor(
        Math.sin(x * 0.15) * Math.cos(z * 0.15) * 3 +
        Math.sin(x * 0.07) * 2 + 4
      );
      for (let y = 0; y <= h; y++) {
        let type = BLOCK_TYPES.STONE;
        if (y === h) type = BLOCK_TYPES.GRASS;
        else if (y > h - 2) type = BLOCK_TYPES.DIRT;

        if (y === h && type === BLOCK_TYPES.GRASS && Math.random() < 0.01) {
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
  for (let i = 0; i < 5; i++) world.set(key(x, y + i, z), BLOCK_TYPES.WOOD);
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      for (let dy = 0; dy <= 2; dy++) {
        if (Math.abs(dx) + Math.abs(dz) + dy <= 3 && Math.random() > 0.3) {
          world.set(key(x + dx, y + 5 + dy, z + dz), BLOCK_TYPES.LEAVES);
        }
      }
    }
  }
}

generateWorld();

// ═══════════════════════════════════════════════════════════════
//  HTTP SERVER
// ═══════════════════════════════════════════════════════════════

const httpServer = http.createServer((req, res) => {
  // Логирование запросов (для отладки туннеля)
  console.log(`[HTTP] ${req.method} ${req.url} from ${req.socket.remoteAddress}`);

  let filePath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  filePath = path.join(__dirname, 'public', filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (!req.url.includes('favicon')) {
        console.log(`[${GAME_NAME}] 404: ${req.url}`);
      }
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
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.ico': 'image/x-icon',
    }[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': mime,
      'Access-Control-Allow-Origin': '*',   // важно для туннеля
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

// Слушаем на всех интерфейсах, чтобы туннель мог подключиться
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[${GAME_NAME}] HTTP: http://0.0.0.0:${PORT}`);
  console.log(`[${GAME_NAME}] Tunnel: https://ab8408bb13a736.lhr.life`);
});

// ═══════════════════════════════════════════════════════════════
//  WEBSOCKET SERVER (на том же порту)
// ═══════════════════════════════════════════════════════════════

const wss = new WebSocket.Server({
  server: httpServer,
  // Разрешаем подключения от любых origins (важно для туннеля)
  verifyClient: (info) => {
    console.log(`[WS] Connection attempt from origin: ${info.origin}`);
    return true;
  },
});

const clients = new Map();
const players = new Map();
let nextId = 1;

wss.on('connection', (ws, req) => {
  const playerId = `p_${nextId++}`;
  const ip = req.socket.remoteAddress;
  const origin = req.headers.origin || 'unknown';
  console.log(`[${GAME_NAME}] ${playerId} connected (ip=${ip}, origin=${origin})`);

  clients.set(ws, playerId);
  players.set(playerId, {
    id: playerId,
    name: `Player_${playerId}`,
    x: 0, y: 15, z: 0,
    yaw: 0, pitch: 0,
  });

  ws.send(JSON.stringify({
    type: 'init',
    id: playerId,
    version: VERSION,
    gameName: GAME_NAME,
    tunnel: 'https://ab8408bb13a736.lhr.life',
    world: Object.fromEntries(world),
    players: Object.fromEntries(players),
    blockTypes: BLOCK_INFO,
    chatHistory,
  }));

  broadcast({ type: 'player_join', player: players.get(playerId) }, ws);

  const sysMsg = addChatMessage('SYSTEM', `${playerId} присоединился`);
  broadcast({ type: 'chat', ...sysMsg });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      handleMessage(ws, playerId, msg);
    } catch (e) {
      console.error(`[${GAME_NAME}] Parse error:`, e.message);
    }
  });

  ws.on('close', () => {
    console.log(`[${GAME_NAME}] ${playerId} disconnected`);
    const p = players.get(playerId);
    const name = p ? p.name : playerId;
    clients.delete(ws);
    players.delete(playerId);

    broadcast({ type: 'player_leave', id: playerId });
    broadcast({ type: 'chat', ...addChatMessage('SYSTEM', `${name} покинул`) });
  });

  ws.on('error', (err) => {
    console.error(`[${GAME_NAME}] ${playerId} error:`, err.message);
  });

  // Ping-pong для поддержания соединения через туннель
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
});

// Проверка живых соединений (каждые 30 сек)
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => clearInterval(interval));

function handleMessage(ws, playerId, msg) {
  const player = players.get(playerId);
  if (!player) return;

  switch (msg.type) {
    case 'set_name': {
      const oldName = player.name;
      const name = String(msg.name || '').slice(0, 20).trim() || `Player_${playerId}`;
      player.name = name;
      broadcast({ type: 'player_update', player });

      if (oldName !== name) {
        broadcast({ type: 'chat', ...addChatMessage('SYSTEM', `${oldName} теперь ${name}`) });
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
        type: 'player_move',
        id: playerId,
        x: player.x, y: player.y, z: player.z,
        yaw: player.yaw, pitch: player.pitch,
      }, ws);
      break;
    }

    case 'block_place': {
      const { x, y, z, block } = msg;
      const k = key(x, y, z);
      if (world.has(k)) return;
      if (!Object.values(BLOCK_TYPES).includes(block)) return;

      world.set(k, block);
      broadcast({ type: 'block_place', x, y, z, block });
      break;
    }

    case 'block_remove': {
      const { x, y, z } = msg;
      const k = key(x, y, z);
      if (!world.has(k)) return;

      world.delete(k);
      broadcast({ type: 'block_remove', x, y, z });
      break;
    }

    case 'chat': {
      const text = String(msg.text || '').slice(0, 200).trim();
      if (!text) return;

      broadcast({ type: 'chat', ...addChatMessage(player.name, text) });
      break;
    }

    case 'ping': {
      ws.send(JSON.stringify({ type: 'pong', t: msg.t }));
      break;
    }
  }
}

function broadcast(msg, exclude = null) {
  const data = JSON.stringify(msg);
  for (const [ws] of clients) {
    if (ws === exclude) continue;
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
//  SHUTDOWN
// ═══════════════════════════════════════════════════════════════

process.on('SIGINT', () => {
  console.log(`\n[${GAME_NAME}] Shutting down...`);
  saveChat();
  process.exit(0);
});

console.log(`[${GAME_NAME}] WebSocket ready on port ${PORT}`);
console.log(`[${GAME_NAME}] Access via: https://ab8408bb13a736.lhr.life`);
console.log(`[${GAME_NAME}] Ready!`);
