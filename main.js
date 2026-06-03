const HOST_PASSWORD = '1234';
const MAX_PLAYERS = 3;
const AVATARS = ['🜂','🜁','🜃','🜄','🛸','🦊','🐙','🦉','🐲','🧿','⚡','🌙'];


// Keep PeerJS transport options centralized so the app can switch from PeerJS Cloud
// to a self-hosted PeerServer by filling host/path without changing lobby logic.
const PEER_CONFIG = {
  host: '',
  port: 443,
  path: '/peerjs',
  secure: true,
  debug: 2,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' },
    ],
  },
};

const PING_TIMEOUT_MS = 5000;
const STATE_SYNC_TIMEOUT_MS = 5000;
const CLIENT_RECONNECT_INTERVAL_MS = 3000;
const CLIENT_RECONNECT_MAX_ATTEMPTS = 10;

function formatPeerError(error) {
  const type = error?.type || error?.name || '';
  const rawMessage = typeof error === 'string' ? error : (error?.message || '');
  const message = rawMessage && rawMessage !== 'Error' ? rawMessage : '';
  const hints = {
    'browser-incompatible': 'Браузер не поддерживает WebRTC/PeerJS. Попробуйте актуальный Chrome, Edge или Firefox.',
    disconnected: 'PeerJS-сервер временно недоступен или соединение оборвалось. Проверьте интернет и попробуйте ещё раз.',
    'invalid-id': 'Некорректный Peer ID. Проверьте ID хоста и повторите подключение.',
    'invalid-key': 'PeerJS cloud отклонил ключ подключения. Попробуйте обновить страницу.',
    network: 'Не удалось подключиться к PeerJS-серверу. Откройте сайт через http:// или https://, проверьте интернет/VPN/блокировщики и попробуйте снова.',
    'peer-unavailable': 'Лобби не найдено. Проверьте Peer ID или попросите host пересоздать лобби.',
    'server-error': 'PeerJS Cloud сейчас недоступен из вашей сети или временно отвечает ошибкой. Приложение уже повторило подключение; попробуйте обновить страницу, отключить VPN/proxy/блокировщик или открыть сайт в другой сети.',
    'socket-error': 'WebSocket до PeerJS-сервера не открылся. Проверьте сеть, VPN, proxy или блокировщики.',
    'socket-closed': 'WebSocket до PeerJS-сервера закрылся. Попробуйте переподключиться.',
    'ssl-unavailable': 'Защищённое соединение с PeerJS-сервером недоступно. Откройте сайт через https://.',
    'unavailable-id': 'Этот Peer ID уже занят. Обновите страницу и попробуйте снова.',
    webrtc: 'WebRTC-соединение не установилось. Проверьте разрешения браузера и сетевые ограничения.',
  };
  if (type === 'Error' && !message) {
    return 'Не удалось запустить P2P-подключение. Чаще всего это блокировка PeerJS/WebSocket сетью, VPN, proxy или расширением браузера. Попробуйте обновить страницу или открыть сайт через GitHub Pages/http(s).';
  }
  const hint = hints[type] || message || 'Неизвестная ошибка PeerJS. Проверьте интернет, откройте сайт через http(s) и попробуйте обновить страницу.';
  return type && type !== 'Error' && !hint.includes(type) ? `${hint} (${type})` : hint;
}

const GAMES = [
  { id: 'monopoly', title: 'Монополия', icon: '🏙️', status: 'soon', description: 'Большая экономическая классика с торгами, арендой и сделками. Экран будущего расширения.' },
  { id: 'machi', title: 'Мачи Коро', icon: '🏗️', status: 'soon', description: 'Городская карточная стратегия. В каталоге подготовлен премиальный preview и заглушка.' },
  { id: 'chess', title: 'Шахматы', icon: '♟️', status: 'soon', description: 'Полноценный шахматный модуль запланирован как отдельное крупное расширение.' },
  { id: 'durak', title: 'Дурак', icon: '🂡', status: 'soon', description: 'Карточная игра пока не притворяется готовой: только аккуратный экран разработки.' },
  { id: 'duelist', title: 'Числовой дуэлянт', icon: '🔢', status: 'ready', description: 'Быстрые раунды: выбирайте число, усиливайте ход и пытайтесь перебить соперника.' },
  { id: 'imaginarium', title: 'Имаджинариум', icon: '🪐', status: 'soon', description: 'Ассоциации и атмосферные карты появятся в будущем модуле.' },
  { id: 'battleship', title: 'Морской бой', icon: '⚓', status: 'ready', description: 'Упрощённая, но полноценная версия: корабли, выстрелы, попадания и победа.' },
  { id: 'hangman', title: 'Виселица', icon: '🔤', status: 'ready', description: 'Общее слово, банк букв, ошибки и синхронизированный прогресс для всех игроков.' },
  { id: 'gomoku', title: 'Гомоку', icon: '◯', status: 'ready', description: 'Компактное поле 5×5, очередность ходов и победа по линии из четырёх.' },
  { id: 'believe', title: 'Верю — не верю', icon: '✨', status: 'ready', description: 'Факты, быстрые ответы, очки и общий темп партии.' },
  { id: 'kingdom', title: 'Королевство', icon: '👑', status: 'soon', description: 'Большая социальная стратегия в разработке: сейчас доступен визуальный экран.' },
];

const $ = (selector) => {
  const element = document.querySelector(selector);
  if (!element) {
    console.error(`[DEBUG] Missing DOM element: ${selector}`);
  }
  return element;
};
const now = () => new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
const uid = () => crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const escapeHtml = (s='') => s.replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

window.addEventListener('error', (event) => {
  console.error('[DEBUG] Uncaught error', event.error || event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[DEBUG] Unhandled promise rejection', event.reason);
});

function inspectFirebaseState() {
  const hasFirebase = Boolean(window.firebase);
  const hasFirebaseConfig = Boolean(window.firebaseConfig || window.__FIREBASE_CONFIG__);
  if (hasFirebase && hasFirebaseConfig) {
    console.log('[DEBUG] Firebase initialized');
  } else {
    console.log('[DEBUG] Firebase not configured; lobby uses PeerJS/WebRTC only', { hasFirebase, hasFirebaseConfig });
  }
}


class EventBus extends EventTarget {
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  on(type, callback) { this.addEventListener(type, (event) => callback(event.detail)); }
}

class ChatManager {
  constructor(bus) {
    this.bus = bus;
    this.messages = $('#chatMessages');
    $('#chatForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const input = $('#chatInput');
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      this.bus.emit('chat:send', { text });
    });
  }
  add(message) {
    if (this.messages.classList.contains('empty-state')) {
      this.messages.classList.remove('empty-state');
      this.messages.textContent = '';
    }
    const node = document.createElement('article');
    node.className = `chat-message ${message.kind || ''}`;
    if (message.kind === 'system') {
      node.textContent = message.text;
    } else {
      node.innerHTML = `<small>${escapeHtml(message.author)} · ${message.time || now()}</small>${escapeHtml(message.text)}`;
    }
    this.messages.append(node);
    this.messages.scrollTop = this.messages.scrollHeight;
  }
  system(text) { this.add({ kind: 'system', text }); }
}

class NetworkManager {
  constructor(bus) {
    this.bus = bus;
    this.peer = null;
    this.role = 'offline';
    this.connections = new Map();
    this.players = new Map();
    this.localPlayer = null;
    this.hostId = null;
    this.isOpening = false;
    this.isHostReady = false;
    this.isReconnectingHost = false;
    this.isClosingPeer = false;
    this.clientReconnectTimer = null;
    this.clientReconnectAttempts = 0;
    this.pendingPings = new Map();
    this.pendingStateSync = null;
  }

  setLocalPlayer(player) { this.localPlayer = player; }

  async startHost() {
    this.closeExistingPeer();
    this.role = 'host';
    this.isHostReady = false;
    this.bus.emit('network:preparing-host');
    this.bus.emit('network:status', 'Подготовка лобби...');
    await this.openPeerWithRetry('host');
    console.log('[DEBUG] HOST OPEN', this.peer.id);
    this.hostId = this.peer.id;
    this.localPlayer = { ...this.localPlayer, id: this.peer.id, isHost: true, mic: false, connected: true };
    this.players.set(this.peer.id, this.localPlayer);
    this.isHostReady = true;
    console.log('[DEBUG] HOST READY', this.peer.id);
    this.bus.emit('network:ready', { role: 'host', peerId: this.peer.id });
    this.bus.emit('network:status', 'Лобби готово');
    this.bus.emit('players:update', this.getPlayers());
    console.log('[network] Host mode started', this.peer.id);
  }

  async join(hostId) {
    this.closeExistingPeer();
    this.role = 'client';
    this.hostId = hostId;
    this.clientReconnectAttempts = 0;
    await this.openPeerWithRetry('guest');
    this.localPlayer = { ...this.localPlayer, id: this.peer.id, isHost: false, mic: false, connected: true };
    const conn = await this.connectToHost(hostId);
    await this.pingHost(conn);
    conn.send({ type: 'HELLO', player: this.localPlayer });
    console.log('[DEBUG] HELLO SENT', hostId);
    await this.waitForStateSync();
    this.bus.emit('network:ready', { role: 'client', peerId: this.peer.id });
    console.log('[DEBUG] CLIENT CONNECTED', this.peer.id, 'connected to', hostId);
  }

  async openPeerWithRetry(rolePrefix, maxAttempts = 4) {
    let lastError = null;
    let peerId = this.generatePeerId(rolePrefix);
    this.isOpening = true;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      this.peer = this.createPeer(peerId);
      this.bindPeerEvents();
      try {
        await this.waitOpen();
        this.isOpening = false;
        return;
      } catch (error) {
        lastError = error;
        const type = error?.type || error?.name;
        console.log(`[network] Peer open attempt ${attempt} failed for ${peerId}`, error);
        this.isClosingPeer = true;
        if (this.peer && !this.peer.destroyed && typeof this.peer.destroy === 'function') this.peer.destroy();
        setTimeout(() => { this.isClosingPeer = false; }, 0);
        this.peer = null;
        if (!this.isRetryableOpenError(error) || attempt === maxAttempts) break;
        if (type === 'unavailable-id') {
          peerId = this.generatePeerId(rolePrefix);
          this.bus.emit('network:status', `Peer ID занят, пробуем новый ID ${attempt + 1}/${maxAttempts}…`);
        } else {
          this.bus.emit('network:status', `PeerJS Cloud не открыл соединение, повторяем тот же Peer ID ${attempt + 1}/${maxAttempts}…`);
        }
        await sleep(650 * attempt);
      }
    }
    this.isOpening = false;
    throw lastError || new Error('PeerJS open failed');
  }

  isRetryableOpenError(error) {
    return ['Error', 'server-error', 'network', 'socket-error', 'socket-closed', 'unavailable-id'].includes(error?.type || error?.name);
  }

  generatePeerId(rolePrefix) {
    const random = uid().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 10);
    return `banana-${rolePrefix}-${random}`;
  }

  createPeer(peerId) {
    if (!window.Peer) {
      throw new Error('PeerJS не загрузился. Проверьте интернет, доступ к CDN unpkg.com или подключите библиотеку локально.');
    }
    if (location.protocol === 'file:') {
      console.warn('[network] App is opened via file://; PeerJS/WebRTC can be unstable. Use a local http server or GitHub Pages.');
    }
    // Empty host means PeerJS Cloud. Fill PEER_CONFIG.host later to use a self-hosted PeerServer.
    const options = PEER_CONFIG.host ? PEER_CONFIG : (({ host, port, path, secure, ...cloudConfig }) => cloudConfig)(PEER_CONFIG);
    return new Peer(peerId, options);
  }

  closeExistingPeer() {
    this.isClosingPeer = true;
    this.stopClientReconnect();
    this.pendingPings.forEach(({ reject, timer }) => {
      clearTimeout(timer);
      reject(new Error('Peer connection closed.'));
    });
    this.pendingPings.clear();
    if (this.pendingStateSync) {
      clearTimeout(this.pendingStateSync.timer);
      this.pendingStateSync.reject(new Error('Peer connection closed before STATE_SYNC.'));
      this.pendingStateSync = null;
    }
    this.connections.forEach(conn => conn.close());
    this.connections.clear();
    if (this.peer && !this.peer.destroyed && typeof this.peer.destroy === 'function') this.peer.destroy();
    this.peer = null;
    this.players.clear();
    this.isHostReady = false;
    setTimeout(() => { this.isClosingPeer = false; }, 0);
  }

  bindPeerEvents() {
    this.peer.on('connection', (conn) => this.registerConnection(conn));
    this.peer.on('call', (call) => this.bus.emit('voice:incoming-call', call));
    this.peer.on('disconnected', () => this.handlePeerDisconnected('disconnected'));
    this.peer.on('close', () => {
      if (!this.isClosingPeer && this.role === 'client') this.scheduleClientReconnect();
      this.bus.emit('network:status', 'Соединение закрыто.');
    });
    this.peer.on('error', (error) => {
      console.log('[network] PeerJS error', error);
      const type = error?.type || error?.name;
      if (this.role === 'host' && ['network', 'socket-closed', 'disconnected'].includes(type)) this.reconnectHost();
      if (!this.isOpening) this.bus.emit('network:error', formatPeerError(error));
    });
    this.peer.on('open', () => {
      if (this.isReconnectingHost) {
        this.isReconnectingHost = false;
        this.isHostReady = true;
        console.log('[DEBUG] RECONNECT SUCCESS', this.peer.id);
        this.bus.emit('network:status', 'Лобби восстановлено');
      }
    });
  }

  waitOpen() {
    return new Promise((resolve, reject) => {
      this.peer.on('open', resolve);
      this.peer.on('error', reject);
    });
  }

  waitConnectionOpen(conn, hostId, timeoutMs = PING_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const snapshot = { exists: () => Boolean(conn.open) };
      if (snapshot.exists()) {
        console.log('[DEBUG] Room snapshot', true);
        resolve();
        return;
      }
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        console.log('[DEBUG] Room snapshot', snapshot.exists());
        callback(value);
      };
      const timer = setTimeout(() => {
        finish(reject, new Error('Хост не отвечает. Возможно он закрыл вкладку или потерял соединение.'));
      }, timeoutMs);
      conn.on('open', () => finish(resolve));
      conn.on('error', (error) => finish(reject, error));
      conn.on('close', () => finish(reject, new Error('Хост недоступен или уже закрыл лобби')));
    });
  }


  connectToHost(hostId) {
    console.log('[DEBUG] CLIENT CONNECTING', hostId);
    console.log('[DEBUG] Joining room...');
    const conn = this.peer.connect(hostId, { reliable: true, metadata: { player: this.localPlayer } });
    this.registerConnection(conn);
    return this.waitConnectionOpen(conn, hostId).then(() => conn);
  }

  pingHost(conn, timeoutMs = PING_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const pingId = uid();
      const timer = setTimeout(() => {
        this.pendingPings.delete(pingId);
        reject(new Error('Хост недоступен или уже закрыл лобби'));
      }, timeoutMs);
      this.pendingPings.set(pingId, {
        resolve: () => {
          clearTimeout(timer);
          this.pendingPings.delete(pingId);
          console.log('[DEBUG] PONG RECEIVED', conn.peer);
          resolve();
        },
        reject,
        timer,
      });
      console.log('[DEBUG] PING SENT', conn.peer);
      conn.send({ type: 'PING', pingId });
    });
  }

  waitForStateSync(timeoutMs = STATE_SYNC_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        console.warn('[DEBUG] STATE_SYNC not received in 5 seconds', this.hostId);
        this.pendingStateSync = null;
        reject(new Error('Хост не отвечает. Возможно он закрыл вкладку или потерял соединение.'));
      }, timeoutMs);
      this.pendingStateSync = { resolve, reject, timer };
    });
  }

  handlePeerDisconnected(reason) {
    console.log('[DEBUG] RECONNECT START', reason);
    if (this.role === 'host') {
      this.reconnectHost();
      return;
    }
    if (this.role === 'client') this.scheduleClientReconnect();
    this.bus.emit('network:status', 'PeerJS disconnected. Пытаемся восстановить соединение…');
  }

  reconnectHost() {
    if (!this.peer || this.peer.destroyed || this.isReconnectingHost) return;
    this.isReconnectingHost = true;
    this.isHostReady = false;
    console.log('[DEBUG] RECONNECT START', this.peer.id);
    this.bus.emit('network:status', 'Восстанавливаем лобби…');
    try {
      this.peer.reconnect();
    } catch (error) {
      this.isReconnectingHost = false;
      console.log('[DEBUG] RECONNECT FAILED', error);
      this.bus.emit('network:error', formatPeerError(error));
    }
  }

  stopClientReconnect() {
    if (this.clientReconnectTimer) clearTimeout(this.clientReconnectTimer);
    this.clientReconnectTimer = null;
  }

  scheduleClientReconnect() {
    if (this.role !== 'client' || !this.hostId || this.clientReconnectTimer || this.isClosingPeer) return;
    if (this.clientReconnectAttempts >= CLIENT_RECONNECT_MAX_ATTEMPTS) {
      console.log('[DEBUG] RECONNECT FAILED', this.hostId);
      this.bus.emit('network:error', 'Хост не отвечает. Возможно он закрыл вкладку или потерял соединение.');
      return;
    }
    this.clientReconnectAttempts += 1;
    console.log('[DEBUG] RECONNECT START', `${this.clientReconnectAttempts}/${CLIENT_RECONNECT_MAX_ATTEMPTS}`, this.hostId);
    this.bus.emit('network:status', `Переподключаемся к лобби… ${this.clientReconnectAttempts}/${CLIENT_RECONNECT_MAX_ATTEMPTS}`);
    this.clientReconnectTimer = setTimeout(async () => {
      this.clientReconnectTimer = null;
      try {
        if (!this.peer || this.peer.destroyed) await this.openPeerWithRetry('guest');
        else if (this.peer.disconnected && typeof this.peer.reconnect === 'function') {
          this.peer.reconnect();
          await Promise.race([
            this.waitOpen(),
            sleep(5000).then(() => { throw new Error('PeerJS reconnect timeout'); }),
          ]);
        }
        const conn = await this.connectToHost(this.hostId);
        await this.pingHost(conn);
        conn.send({ type: 'HELLO', player: this.localPlayer });
        console.log('[DEBUG] HELLO SENT', this.hostId);
        await this.waitForStateSync();
        this.clientReconnectAttempts = 0;
        console.log('[DEBUG] RECONNECT SUCCESS', this.hostId);
        this.bus.emit('network:status', 'Подключение к лобби восстановлено.');
      } catch (error) {
        console.log('[DEBUG] RECONNECT FAILED', error);
        this.scheduleClientReconnect();
      }
    }, CLIENT_RECONNECT_INTERVAL_MS);
  }

  registerConnection(conn) {
    conn.on('open', () => {
      this.connections.set(conn.peer, conn);
      console.log('[network] data connection open', conn.peer);
      if (this.role === 'client') console.log('[DEBUG] CLIENT CONNECTED', conn.peer);
      if (this.role === 'host') {
        setTimeout(() => {
          if (this.connections.has(conn.peer) && !this.players.has(conn.peer)) {
            console.warn('[DEBUG] HELLO not received in 5 seconds', conn.peer);
          }
        }, STATE_SYNC_TIMEOUT_MS);
      }
      this.bus.emit('network:connection-open', conn.peer);
    });
    conn.on('data', (message) => this.handleMessage(conn.peer, message));
    conn.on('close', () => this.handleClose(conn.peer));
    conn.on('error', (error) => {
      const type = error?.type || error?.name;
      if (this.role === 'client' && ['peer-unavailable', 'network', 'socket-closed', 'disconnected'].includes(type)) this.scheduleClientReconnect();
      this.bus.emit('network:error', formatPeerError(error));
    });
  }

  handleMessage(from, message) {
    console.log('[network] message', from, message.type);
    if (message.type === 'PING') {
      if (this.role === 'host' && this.isHostReady) {
        this.connections.get(from)?.send({ type: 'PONG', pingId: message.pingId });
      }
      return;
    }
    if (message.type === 'PONG') {
      this.pendingPings.get(message.pingId)?.resolve();
      return;
    }
    if (this.role === 'host') {
      if (message.type === 'HELLO') {
        const player = message.player || { id: from, name: 'Игрок', avatar: '🜁' };
        if (this.players.size >= MAX_PLAYERS && !this.players.has(from)) {
          this.connections.get(from)?.send({ type: 'LOBBY_FULL' });
          this.connections.get(from)?.close();
          return;
        }
        this.players.set(from, { ...player, id: from, isHost: false, connected: true });
        this.broadcast({ type: 'STATE_SYNC', players: this.getPlayers(), hostId: this.hostId }, true);
        this.bus.emit('players:update', this.getPlayers());
        this.bus.emit('system', `${player.name} подключился к лобби.`);
        return;
      }
      // Host is authoritative router: every lobby, chat and game event is rebroadcast to all clients.
      if (['CHAT', 'GAME_PROPOSAL', 'GAME_EVENT', 'MIC_STATUS'].includes(message.type)) this.broadcast({ ...message, from }, true);
    }
    if (message.type === 'STATE_SYNC') {
      this.players = new Map(message.players.map(p => [p.id, p]));
      this.hostId = message.hostId;
      this.bus.emit('players:update', this.getPlayers());
      this.bus.emit('network:status', 'Подключено к Banana Play лобби.');
      if (this.pendingStateSync) {
        clearTimeout(this.pendingStateSync.timer);
        this.pendingStateSync.resolve();
        this.pendingStateSync = null;
      }
    }
    if (message.type === 'LOBBY_FULL') this.bus.emit('network:error', 'Лобби заполнено: максимум 3 игрока.');
    this.bus.emit('network:message', { from, message });
  }

  handleClose(peerId) {
    this.connections.delete(peerId);
    const player = this.players.get(peerId);
    if (this.role === 'host' && player) {
      this.players.delete(peerId);
      this.broadcast({ type: 'STATE_SYNC', players: this.getPlayers(), hostId: this.hostId }, true);
      this.bus.emit('players:update', this.getPlayers());
      this.bus.emit('system', `${player.name} отключился.`);
    }
    if (this.role === 'client' && peerId === this.hostId && !this.isClosingPeer) this.scheduleClientReconnect();
  }

  send(message) {
    if (this.role === 'host') this.broadcast({ ...message, from: this.peer.id }, true);
    else {
      const conn = this.connections.get(this.hostId);
      if (conn?.open) conn.send(message);
      else this.scheduleClientReconnect();
    }
  }

  broadcast(message, includeSelf = false) {
    this.connections.forEach((conn) => conn.open && conn.send(message));
    if (includeSelf) this.bus.emit('network:message', { from: this.peer?.id, message });
  }

  updateMicStatus(enabled) {
    if (!this.localPlayer?.id) return;
    this.localPlayer.mic = enabled;
    if (this.players.has(this.localPlayer.id)) this.players.set(this.localPlayer.id, { ...this.players.get(this.localPlayer.id), mic: enabled });
    this.send({ type: 'MIC_STATUS', playerId: this.localPlayer.id, enabled });
    this.bus.emit('players:update', this.getPlayers());
  }

  getPlayers() { return [...this.players.values()]; }
}

class VoiceManager {
  constructor(bus, network) {
    this.bus = bus;
    this.network = network;
    this.stream = null;
    this.enabled = false;
    this.audioContext = null;
    this.analyser = null;
    this.levelData = null;
    this.raf = null;
    $('#globalMuteBtn').addEventListener('click', () => this.toggle());
    document.addEventListener('keydown', (event) => {
      if (event.key.toLowerCase() === 'm' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) this.toggle();
    });
    this.bus.on('voice:incoming-call', (call) => this.answerCall(call));
    this.bus.on('network:connection-open', () => this.callPeers());
    this.paint();
  }

  async ensureStream() {
    if (this.stream) return this.stream;
    // Voice is pure WebRTC: getUserMedia creates one local stream, PeerJS transports it as media calls.
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
    this.stream.getAudioTracks().forEach(track => track.enabled = this.enabled);
    this.setupMeter();
    this.callPeers();
    return this.stream;
  }

  async toggle() {
    try {
      await this.ensureStream();
      this.enabled = !this.enabled;
      this.stream.getAudioTracks().forEach(track => track.enabled = this.enabled);
      this.network.updateMicStatus(this.enabled);
      this.paint();
    } catch (error) {
      this.bus.emit('network:error', 'Не удалось включить микрофон: ' + error.message);
    }
  }

  async answerCall(call) {
    const stream = await this.ensureStream().catch(() => null);
    if (stream) call.answer(stream);
    call.on('stream', remoteStream => this.mountRemote(call.peer, remoteStream));
  }

  callPeers() {
    if (!this.stream || !this.network.peer || typeof this.network.peer.call !== 'function') return;
    this.network.connections.forEach((_, peerId) => {
      const call = this.network.peer.call(peerId, this.stream);
      call?.on('stream', remoteStream => this.mountRemote(peerId, remoteStream));
    });
  }

  mountRemote(peerId, stream) {
    let audio = document.querySelector(`audio[data-peer="${peerId}"]`);
    if (!audio) {
      audio = document.createElement('audio');
      audio.dataset.peer = peerId;
      audio.autoplay = true;
      audio.playsInline = true;
      $('#remoteAudioMount').append(audio);
    }
    audio.srcObject = stream;
  }

  setupMeter() {
    this.audioContext = new AudioContext();
    const source = this.audioContext.createMediaStreamSource(this.stream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    this.levelData = new Uint8Array(this.analyser.frequencyBinCount);
    source.connect(this.analyser);
    const tick = () => {
      this.analyser.getByteFrequencyData(this.levelData);
      const avg = this.levelData.reduce((a, b) => a + b, 0) / this.levelData.length;
      $('#micLevel').style.height = `${this.enabled ? clamp(avg / 1.6, 8, 100) : 7}%`;
      this.raf = requestAnimationFrame(tick);
    };
    tick();
  }

  paint() {
    $('#globalMuteBtn').classList.toggle('is-live', this.enabled);
    $('#globalMuteBtn').setAttribute('aria-pressed', String(this.enabled));
    $('#muteLabel').textContent = this.enabled ? 'Mic on' : 'Mic off';
    $('#voiceStatus').textContent = this.enabled ? 'mic on' : 'mic off';
    $('#voiceStatus').className = `badge ${this.enabled ? 'success' : 'warning'}`;
  }
}

class LobbyApp {
  constructor() {
    inspectFirebaseState();
    this.bus = new EventBus();
    this.profile = this.loadProfile();
    this.network = new NetworkManager(this.bus);
    this.chat = new ChatManager(this.bus);
    this.voice = new VoiceManager(this.bus, this.network);
    this.currentGame = null;
    this.pendingProposal = null;
    this.bindUi();
    this.bindEvents();
    this.renderAvatars();
    this.renderCatalog();
    this.updateProfilePreview();
    this.showOnboarding();
  }

  bindUi() {
    $('#nicknameInput').addEventListener('input', () => this.updateProfilePreview());
    $('#enterHubBtn').addEventListener('click', () => this.enterHub());
    $('#editProfileBtn').addEventListener('click', () => this.showOnboarding());
    $('#openHostModalBtn').addEventListener('click', () => {
      console.log('[DEBUG] createLobby clicked');
      $('#hostPasswordModal').showModal();
    });
    $('#confirmHostBtn').addEventListener('click', (event) => { event.preventDefault(); this.createLobbyWithPassword(); });
    $('#joinLobbyBtn').addEventListener('click', () => this.joinLobby());
    $('#peerIdInput').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.joinLobby();
    });
    $('#copyPeerBtn').addEventListener('click', async () => {
      await navigator.clipboard.writeText(this.network.peer?.id || '');
      this.chat.system('Peer ID скопирован в буфер обмена.');
    });
    $('#backToCatalogBtn').addEventListener('click', () => this.showCatalog());
  }

  bindEvents() {
    this.bus.on('system', (text) => this.chat.system(text));
    this.bus.on('chat:send', ({ text }) => {
      const message = { type: 'CHAT', id: uid(), author: this.profile.name, authorId: this.network.peer?.id || 'local', text, time: now() };
      this.network.send(message);
      if (this.network.role === 'offline') this.chat.add({ ...message, kind: 'own' });
    });
    this.bus.on('network:preparing-host', () => {
      $('#ownPeerBox').classList.add('hidden');
      $('#copyPeerBtn').textContent = '';
      $('#roleBadge').textContent = 'preparing';
      $('#roleBadge').className = 'badge warning';
    });
    this.bus.on('network:ready', ({ role, peerId }) => {
      $('#roleBadge').textContent = role;
      $('#roleBadge').className = `badge ${role === 'host' ? 'warning' : 'success'}`;
      $('#ownPeerBox').classList.remove('hidden');
      $('#copyPeerBtn').textContent = peerId;
      $('#connectionStatus').textContent = role === 'host' ? 'Лобби создано · поделитесь Peer ID' : 'Соединение открыто · ждём состояние лобби…';
      $('#chatStatus').textContent = 'online';
      $('#chatStatus').className = 'badge success';
      this.chat.system(role === 'host' ? 'Вы создали Banana Play лобби как host.' : 'Вы подключаетесь к Banana Play host-лобби.');
    });
    this.bus.on('network:status', (text) => { $('#connectionStatus').textContent = text; });
    this.bus.on('network:error', (text) => {
      $('#connectionStatus').textContent = text;
      $('#roleBadge').textContent = 'error';
      $('#roleBadge').className = 'badge danger';
      this.chat.system('Ошибка подключения: ' + text);
    });
    this.bus.on('players:update', (players) => this.renderPlayers(players));
    this.bus.on('network:message', ({ message }) => this.routeMessage(message));
  }

  routeMessage(message) {
    if (message.type === 'CHAT') this.chat.add({ ...message, kind: message.authorId === this.network.peer?.id ? 'own' : '' });
    if (message.type === 'MIC_STATUS') {
      const player = this.network.players.get(message.playerId);
      if (player) this.network.players.set(message.playerId, { ...player, mic: message.enabled });
      this.renderPlayers(this.network.getPlayers());
    }
    if (message.type === 'GAME_PROPOSAL') this.renderProposal(message);
    if (message.type === 'PROPOSAL_REJECTED') { this.chat.system(`Host отклонил запуск «${this.gameTitle(message.gameId)}».`); this.clearProposal(); }
    if (message.type === 'START_GAME') this.startGame(message.gameId, message.initialState);
    if (message.type === 'GAME_EVENT' && this.currentGame) this.currentGame.onNetworkMessage(message);
  }

  loadProfile() {
    try {
      const stored = JSON.parse(localStorage.getItem('banana-play-profile') || '{}');
      return { name: stored.name || '', avatar: stored.avatar || AVATARS[0] };
    } catch (error) {
      console.error('[DEBUG] localStorage profile read failed', error);
      return { name: '', avatar: AVATARS[0] };
    }
  }
  saveProfile() {
    try {
      localStorage.setItem('banana-play-profile', JSON.stringify(this.profile));
    } catch (error) {
      console.error('[DEBUG] localStorage profile write failed', error);
    }
  }
  showOnboarding() {
    $('#onboarding').classList.add('is-active');
    $('#lobby').classList.remove('is-active');
    $('#nicknameInput').value = this.profile.name;
    this.renderAvatars();
    this.updateProfilePreview();
  }
  enterHub() {
    const name = $('#nicknameInput').value.trim() || 'Игрок';
    this.profile = { name, avatar: this.profile.avatar };
    this.saveProfile();
    this.network.setLocalPlayer({ name, avatar: this.profile.avatar });
    $('#onboarding').classList.remove('is-active');
    $('#lobby').classList.add('is-active');
    this.chat.system(`Профиль ${name} готов. Создайте лобби или подключитесь по Peer ID.`);
  }
  renderAvatars() {
    $('#avatarGrid').innerHTML = AVATARS.map(a => `<button class="avatar-option ${a === this.profile.avatar ? 'is-selected' : ''}" data-avatar="${a}" role="radio" aria-checked="${a === this.profile.avatar}">${a}</button>`).join('');
    document.querySelectorAll('.avatar-option').forEach(btn => btn.addEventListener('click', () => {
      this.profile.avatar = btn.dataset.avatar;
      this.saveProfile();
      this.renderAvatars();
      this.updateProfilePreview();
    }));
  }
  updateProfilePreview() {
    $('#previewName').textContent = $('#nicknameInput').value.trim() || this.profile.name || 'Игрок';
    $('#previewAvatar').textContent = this.profile.avatar;
  }

  async createLobbyWithPassword() {
    console.log('[DEBUG] createLobby clicked');
    const password = $('#hostPasswordInput').value;
    // Client-side UX lock: only the owner password unlocks host mode and lobby creation.
    if (password !== HOST_PASSWORD) {
      $('#passwordError').classList.remove('hidden');
      $('#connectionStatus').textContent = 'Создание лобби заблокировано: неверный пароль владельца.';
      return;
    }
    $('#passwordError').classList.add('hidden');
    $('#hostPasswordModal').close();
    this.network.setLocalPlayer({ name: this.profile.name || 'Host', avatar: this.profile.avatar });
    try {
      $('#connectionStatus').textContent = 'Создаём Banana Play лобби…';
      await this.network.startHost();
      const roomRef = { id: this.network.peer?.id };
      console.log('[DEBUG] Room created', roomRef.id);
    } catch (error) {
      console.log('[network] Host start failed', error);
      this.bus.emit('network:error', formatPeerError(error));
    }
  }

  async joinLobby() {
    console.log('[DEBUG] joinLobby clicked');
    const hostId = $('#peerIdInput').value.trim();
    console.log('[DEBUG] roomId =', hostId);
    if (!hostId) return this.chat.system('Введите Peer ID существующего host-лобби.');
    this.network.setLocalPlayer({ name: this.profile.name || 'Игрок', avatar: this.profile.avatar });
    try {
      $('#connectionStatus').textContent = 'Подключаемся к Banana Play лобби…';
      await this.network.join(hostId);
    } catch (error) {
      console.log('[network] Join failed', error);
      this.bus.emit('network:error', formatPeerError(error));
    }
  }

  renderPlayers(players) {
    $('#playerCount').textContent = `${players.length}/${MAX_PLAYERS}`;
    const list = $('#playersList');
    if (!players.length) { list.className = 'players-list empty-state'; list.textContent = 'Игроки появятся после создания или подключения к лобби.'; return; }
    list.className = 'players-list';
    list.innerHTML = '';
    players.forEach(player => {
      const node = $('#playerTemplate').content.firstElementChild.cloneNode(true);
      node.classList.toggle('is-host', player.isHost);
      node.querySelector('.avatar').textContent = player.avatar;
      node.querySelector('strong').textContent = player.name;
      node.querySelector('.player-meta span').textContent = player.id === this.network.peer?.id ? 'это вы' : player.id;
      node.querySelector('.player-flags').innerHTML = `${player.isHost ? '<span class="flag host">host</span>' : ''}<span class="flag ${player.mic ? 'mic-on' : 'mic-off'}">${player.mic ? 'mic' : 'mute'}</span>`;
      list.append(node);
    });
  }

  renderCatalog() {
    $('#gameCatalog').innerHTML = GAMES.map((game, index) => `
      <article class="game-card" style="--card-glow:${index % 3 === 0 ? 'rgba(255,212,59,.28)' : index % 3 === 1 ? 'rgba(126,224,90,.24)' : 'rgba(255,159,28,.24)'}">
        <div>
          <div class="game-preview" data-icon="${game.icon}"></div>
          <h3>${game.title}</h3>
          <p>${game.description}</p>
        </div>
        <div class="game-card-footer">
          <span class="status-pill ${game.status === 'soon' ? 'soon' : ''}">${game.status === 'soon' ? 'В разработке' : 'Готово'}</span>
          <button class="btn btn-secondary" data-open-game="${game.id}">${game.status === 'soon' ? 'Открыть' : 'Предложить'}</button>
        </div>
      </article>`).join('');
    document.querySelectorAll('[data-open-game]').forEach(btn => btn.addEventListener('click', () => this.openGameCard(btn.dataset.openGame)));
  }

  openGameCard(gameId) {
    const game = GAMES.find(g => g.id === gameId);
    if (game.status === 'soon') return this.openStub(game);
    this.proposeGame(gameId);
  }

  proposeGame(gameId) {
    if (this.network.role === 'offline') return this.chat.system('Сначала создайте или подключитесь к лобби.');
    const proposal = { type: 'GAME_PROPOSAL', id: uid(), gameId, proposer: this.profile.name, proposerId: this.network.peer.id };
    this.network.send(proposal);
    this.chat.system(`Предложена игра «${this.gameTitle(gameId)}». Host должен подтвердить запуск.`);
  }

  renderProposal(proposal) {
    this.pendingProposal = proposal;
    const isHost = this.network.role === 'host';
    $('#proposalPanel').classList.remove('hidden');
    $('#proposalPanel').innerHTML = `<div><strong>${escapeHtml(proposal.proposer)} предлагает «${this.gameTitle(proposal.gameId)}»</strong><p class="hint">${isHost ? 'Подтвердите или отклоните запуск для всех игроков.' : 'Ожидаем решения host-пользователя.'}</p></div>
      <div class="proposal-actions">${isHost ? '<button id="approveProposalBtn" class="btn btn-primary">Запустить</button><button id="rejectProposalBtn" class="btn btn-danger">Отклонить</button>' : '<span class="badge warning">waiting for host</span>'}</div>`;
    if (isHost) {
      $('#approveProposalBtn').addEventListener('click', () => this.approveProposal());
      $('#rejectProposalBtn').addEventListener('click', () => this.rejectProposal());
    }
  }
  approveProposal() {
    if (!this.pendingProposal || this.network.role !== 'host') return;
    const gameId = this.pendingProposal.gameId;
    const initialState = GameRegistry[gameId].createInitialState?.(this.network.getPlayers()) || null;
    this.network.broadcast({ type: 'START_GAME', gameId, initialState }, true);
    this.chat.system(`Host подтвердил запуск «${this.gameTitle(gameId)}».`);
    this.clearProposal();
  }
  rejectProposal() {
    if (!this.pendingProposal || this.network.role !== 'host') return;
    this.network.broadcast({ type: 'PROPOSAL_REJECTED', gameId: this.pendingProposal.gameId }, true);
    this.clearProposal();
  }
  clearProposal() { $('#proposalPanel').classList.add('hidden'); $('#proposalPanel').innerHTML = ''; this.pendingProposal = null; }

  startGame(gameId, initialState) {
    this.clearProposal();
    this.currentGame?.destroy();
    const Game = GameRegistry[gameId];
    this.currentGame = new Game();
    $('#gameCatalog').classList.add('hidden');
    $('#gameContainer').classList.remove('hidden');
    $('#backToCatalogBtn').classList.remove('hidden');
    $('#stageTitle').textContent = this.gameTitle(gameId);
    const context = {
      localPlayerId: this.network.peer?.id || 'local',
      players: this.network.getPlayers(),
      sendGameEvent: (payload) => this.network.send({ type: 'GAME_EVENT', gameId, payload, actorId: this.network.peer?.id }),
      system: (text) => this.chat.system(text),
    };
    this.currentGame.init($('#gameContainer'), context, initialState);
  }
  showCatalog() {
    this.currentGame?.destroy();
    this.currentGame = null;
    $('#gameContainer').classList.add('hidden');
    $('#gameCatalog').classList.remove('hidden');
    $('#backToCatalogBtn').classList.add('hidden');
    $('#stageTitle').textContent = 'Игровой хаб';
  }
  openStub(game) {
    this.currentGame?.destroy();
    $('#gameCatalog').classList.add('hidden');
    $('#gameContainer').classList.remove('hidden');
    $('#backToCatalogBtn').classList.remove('hidden');
    $('#stageTitle').textContent = game.title;
    $('#gameContainer').innerHTML = `<section class="stub-screen"><div><span class="status-pill soon">В разработке</span><h2>${game.title}</h2><p class="hero-copy">${game.description}</p><p class="hint">Этот модуль представлен как честная заглушка будущего расширения: без сломанных кнопок и псевдо-логики.</p><button class="btn btn-primary" id="stubBackBtn">Вернуться в хаб</button></div></section>`;
    $('#stubBackBtn').addEventListener('click', () => this.showCatalog());
  }
  gameTitle(gameId) { return GAMES.find(g => g.id === gameId)?.title || gameId; }
}

class BaseGame {
  init(container, context, initialState) { this.container = container; this.context = context; this.state = JSON.parse(JSON.stringify(initialState || {})); this.render(); }
  destroy() { this.container.innerHTML = ''; }
  getState() { return this.state; }
  emit(payload) { this.context.sendGameEvent(payload); }
  onNetworkMessage(message) { this.apply(message.payload, message.actorId); this.render(); }
}

class DuelistGame extends BaseGame {
  static createInitialState(players) { return { round: 1, target: 50, scores: Object.fromEntries(players.map(p => [p.id, 0])), picks: {}, log: 'Выберите число от 1 до 100.' }; }
  apply(payload, actorId) {
    if (payload.kind !== 'pick' || this.state.picks[actorId]) return;
    this.state.picks[actorId] = { value: payload.value, power: payload.power };
    const active = this.context.players.map(p => p.id);
    if (active.every(id => this.state.picks[id])) {
      let best = active[0], bestScore = -Infinity;
      active.forEach(id => {
        const pick = this.state.picks[id];
        const penalty = pick.power === 'risk' ? this.riskPenalty(id, pick.value) : 0;
        const score = 100 - Math.abs(this.state.target - pick.value) + (pick.power === 'focus' ? 8 : 0) + (pick.power === 'risk' ? 20 - penalty : 0);
        if (score > bestScore) { bestScore = score; best = id; }
      });
      this.state.scores[best] = (this.state.scores[best] || 0) + 1;
      this.state.log = `${this.context.players.find(p => p.id === best)?.name || 'Игрок'} забирает раунд.`;
      this.state.round += 1; this.state.target = this.nextTarget(); this.state.picks = {};
      if (this.state.scores[best] >= 3) this.state.winner = best;
    }
  }
  riskPenalty(playerId, value) {
    return (Array.from(playerId).reduce((sum, ch) => sum + ch.charCodeAt(0), 0) + value + this.state.round * 13) % 22;
  }
  nextTarget() {
    return 10 + ((this.state.target * 17 + this.state.round * 23) % 81);
  }
  render() {
    const mePicked = this.state.picks?.[this.context.localPlayerId];
    this.container.innerHTML = `<section class="game-shell"><div class="game-hero"><div><p class="eyebrow">числовой дуэлянт</p><h2>Цель раунда: ${this.state.target}</h2><p class="hint">Побеждает ближайшее число. Focus даёт +8, Risk даёт +20 с нестабильным штрафом.</p></div><span class="badge warning">Раунд ${this.state.round}</span></div><div class="game-grid-two"><div class="game-panel"><h3>Ход</h3><label class="field-label">Число</label><input id="duelValue" class="input" type="number" min="1" max="100" value="50" ${mePicked || this.state.winner ? 'disabled' : ''}><div class="action-row" style="margin-top:12px"><button class="btn btn-primary" data-power="none">Играть</button><button class="btn btn-secondary" data-power="focus">Focus</button><button class="btn btn-secondary" data-power="risk">Risk</button></div><p class="hint">${this.state.winner ? 'Партия завершена.' : mePicked ? 'Ход принят, ждём остальных.' : 'Выберите способность и отправьте ход.'}</p></div><div class="game-panel"><h3>Счёт</h3>${this.context.players.map(p => `<div class="stat-row"><span>${p.avatar} ${p.name}</span><strong>${this.state.scores[p.id] || 0}</strong></div>`).join('')}<p class="hint">${this.state.winner ? 'Победитель: ' + (this.context.players.find(p=>p.id===this.state.winner)?.name || '') : this.state.log}</p></div></div></section>`;
    this.container.querySelectorAll('[data-power]').forEach(btn => btn.addEventListener('click', () => { const v = clamp(Number($('#duelValue').value), 1, 100); this.emit({ kind: 'pick', value: v, power: btn.dataset.power }); }));
  }
}

class HangmanGame extends BaseGame {
  static createInitialState() { const words = ['КОСМОС','НЕБУЛА','ПИКСЕЛЬ','ОРБИТА','КВАНТ']; const word = words[Math.floor(Math.random()*words.length)]; return { word, used: [], wrong: 0, maxWrong: 6, done: false }; }
  apply(payload) { if (payload.kind !== 'letter' || this.state.done) return; const l = payload.letter; if (this.state.used.includes(l)) return; this.state.used.push(l); if (!this.state.word.includes(l)) this.state.wrong++; const open = [...this.state.word].every(ch => this.state.used.includes(ch)); if (open || this.state.wrong >= this.state.maxWrong) this.state.done = true; }
  render() {
    const letters = 'АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЭЮЯ'.split('');
    const display = [...this.state.word].map(ch => this.state.used.includes(ch) ? ch : '＿').join(' ');
    const won = this.state.done && !display.includes('＿');
    this.container.innerHTML = `<section class="game-shell"><div class="game-hero"><div><p class="eyebrow">виселица</p><h2 class="word-display">${display}</h2><p class="hint">Ошибки: ${this.state.wrong}/${this.state.maxWrong}</p></div><span class="badge ${this.state.done ? (won?'success':'danger') : 'warning'}">${this.state.done ? (won?'победа':'поражение') : 'идёт игра'}</span></div><div class="game-panel"><div class="letter-bank">${letters.map(l => `<button class="mini-btn" data-letter="${l}" ${this.state.used.includes(l)||this.state.done?'disabled':''}>${l}</button>`).join('')}</div></div></section>`;
    this.container.querySelectorAll('[data-letter]').forEach(b => b.addEventListener('click', () => this.emit({ kind: 'letter', letter: b.dataset.letter })));
  }
}

class BattleshipGame extends BaseGame {
  static createInitialState(players) {
    const boards = {}; const shots = {}; const ships = [[0,0],[0,1],[0,2],[3,4],[4,4],[8,7],[8,8]];
    players.forEach((p,i) => { boards[p.id] = ships.map(([r,c]) => `${(r+i*2)%10}:${(c+i*3)%10}`); shots[p.id] = []; });
    return { turn: players[0]?.id, boards, shots, winner: null };
  }
  apply(payload, actorId) { if (payload.kind !== 'shot' || this.state.winner || actorId !== this.state.turn) return; const target = payload.target; const cell = payload.cell; if (this.state.shots[target]?.includes(cell)) return; this.state.shots[target].push(cell); const alive = this.state.boards[target].some(ship => !this.state.shots[target].includes(ship)); if (!alive) this.state.winner = actorId; const ids = this.context.players.map(p=>p.id); this.state.turn = ids[(ids.indexOf(actorId)+1)%ids.length]; }
  render() {
    const me = this.context.localPlayerId; const opponents = this.context.players.filter(p=>p.id!==me); const target = opponents[0]?.id || me; const myShots = this.state.shots[me] || []; const targetShots = this.state.shots[target] || [];
    const board = (owner, clickable) => Array.from({length:100},(_,i)=>{ const cell=`${Math.floor(i/10)}:${i%10}`; const shot=(this.state.shots[owner]||[]).includes(cell); const ship=(this.state.boards[owner]||[]).includes(cell); return `<button class="cell ${shot?(ship?'hit':'miss'):''} ${owner===me&&ship&&!shot?'ship':''}" data-shot="${cell}" ${!clickable||shot?'disabled':''}>${shot?(ship?'✹':'•'):(owner===me&&ship?'◆':'')}</button>`; }).join('');
    this.container.innerHTML = `<section class="game-shell"><div class="game-hero"><div><p class="eyebrow">морской бой</p><h2>${this.state.winner ? 'Победитель: '+(this.context.players.find(p=>p.id===this.state.winner)?.name||'') : 'Ход: '+(this.context.players.find(p=>p.id===this.state.turn)?.name||'')}</h2><p class="hint">Слева ваша сетка, справа поле первого соперника.</p></div></div><div class="game-grid-two"><div class="game-panel"><h3>Ваш флот</h3><div class="board" style="grid-template-columns:repeat(10,1fr)">${board(me,false)}</div></div><div class="game-panel"><h3>Цель: ${this.context.players.find(p=>p.id===target)?.name||'—'}</h3><div class="board" style="grid-template-columns:repeat(10,1fr)">${board(target,this.state.turn===me && !this.state.winner && target!==me)}</div></div></div></section>`;
    this.container.querySelectorAll('[data-shot]').forEach(b => b.addEventListener('click', () => this.emit({ kind:'shot', target, cell:b.dataset.shot })));
  }
}

class GomokuGame extends BaseGame {
  static createInitialState(players) { return { board: Array(25).fill(''), turn: players[0]?.id, marks: Object.fromEntries(players.map((p,i)=>[p.id, i===0?'X':'O'])), winner:null, moves:0 }; }
  apply(payload, actorId) { if (payload.kind !== 'move' || this.state.winner || actorId !== this.state.turn || this.state.board[payload.index]) return; this.state.board[payload.index] = this.state.marks[actorId] || 'O'; this.state.moves++; this.state.winner = this.check(); const ids=this.context.players.map(p=>p.id); this.state.turn=ids[(ids.indexOf(actorId)+1)%ids.length]; }
  check() { const b=this.state.board, lines=[]; for(let r=0;r<5;r++) for(let c=0;c<2;c++) lines.push([0,1,2,3].map(i=>(r*5+c+i))); for(let c=0;c<5;c++) for(let r=0;r<2;r++) lines.push([0,1,2,3].map(i=>((r+i)*5+c))); for(let r=0;r<2;r++) for(let c=0;c<2;c++){lines.push([0,1,2,3].map(i=>((r+i)*5+c+i)));lines.push([0,1,2,3].map(i=>((r+3-i)*5+c+i)));} const line=lines.find(l=>b[l[0]]&&l.every(i=>b[i]===b[l[0]])); if(!line) return this.state.moves===25?'draw':null; return Object.keys(this.state.marks).find(id=>this.state.marks[id]===b[line[0]]); }
  render() { this.container.innerHTML = `<section class="game-shell"><div class="game-hero"><div><p class="eyebrow">гомоку 5×5</p><h2>${this.state.winner ? (this.state.winner==='draw'?'Ничья':'Победил '+(this.context.players.find(p=>p.id===this.state.winner)?.name||'')) : 'Ход: '+(this.context.players.find(p=>p.id===this.state.turn)?.name||'')}</h2></div></div><div class="game-panel"><div class="board" style="grid-template-columns:repeat(5,1fr);max-width:380px">${this.state.board.map((m,i)=>`<button class="cell ${m==='X'?'mark-x':m==='O'?'mark-o':''}" data-index="${i}" ${m||this.state.turn!==this.context.localPlayerId||this.state.winner?'disabled':''}>${m}</button>`).join('')}</div></div></section>`; this.container.querySelectorAll('[data-index]').forEach(b=>b.addEventListener('click',()=>this.emit({kind:'move',index:Number(b.dataset.index)}))); }
}

class BelieveGame extends BaseGame {
  static createInitialState(players) { return { index:0, scores:Object.fromEntries(players.map(p=>[p.id,0])), answers:{}, facts:[['Осьминог имеет три сердца',true],['Молния никогда не бьёт дважды в одно место',false],['Венера вращается в обратную сторону',true],['Золото легче алюминия',false],['У коал есть уникальные отпечатки пальцев',true]], done:false }; }
  apply(payload, actorId) { if(payload.kind!=='answer'||this.state.done||this.state.answers[actorId]!==undefined) return; this.state.answers[actorId]=payload.value; if(this.context.players.every(p=>this.state.answers[p.id]!==undefined)){ const correct=this.state.facts[this.state.index][1]; Object.entries(this.state.answers).forEach(([id,v])=>{ if(v===correct) this.state.scores[id]++; }); this.state.answers={}; this.state.index++; if(this.state.index>=this.state.facts.length) this.state.done=true; } }
  render() { const fact=this.state.facts[this.state.index]||['Финал',true]; const answered=this.state.answers[this.context.localPlayerId]!==undefined; this.container.innerHTML=`<section class="game-shell"><div class="game-hero"><div><p class="eyebrow">верю — не верю</p><h2>${this.state.done?'Партия завершена':`Вопрос ${this.state.index+1}/${this.state.facts.length}`}</h2></div></div><div class="game-grid-two"><div class="game-panel truth-card"><strong>${this.state.done?'Смотрите итоговый счёт':fact[0]}</strong></div><div class="game-panel"><h3>Ответ</h3><div class="action-row"><button class="btn btn-primary" data-answer="true" ${answered||this.state.done?'disabled':''}>Верю</button><button class="btn btn-danger" data-answer="false" ${answered||this.state.done?'disabled':''}>Не верю</button></div><p class="hint">${answered?'Ответ принят, ждём остальных.':'Выберите вариант.'}</p><h3>Счёт</h3>${this.context.players.map(p=>`<div class="stat-row"><span>${p.avatar} ${p.name}</span><strong>${this.state.scores[p.id]||0}</strong></div>`).join('')}</div></div></section>`; this.container.querySelectorAll('[data-answer]').forEach(b=>b.addEventListener('click',()=>this.emit({kind:'answer',value:b.dataset.answer==='true'}))); }
}

const GameRegistry = { duelist: DuelistGame, hangman: HangmanGame, battleship: BattleshipGame, gomoku: GomokuGame, believe: BelieveGame };
new LobbyApp();
