const HOST_PASSWORD = 'nebula-owner-2026';
const MAX_PLAYERS = 3;
const AVATARS = ['🜂','🜁','🜃','🜄','🛸','🦊','🐙','🦉','🐲','🧿','⚡','🌙'];

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

const $ = (selector) => document.querySelector(selector);
const now = () => new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
const uid = () => crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const escapeHtml = (s='') => s.replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

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
  }

  setLocalPlayer(player) { this.localPlayer = player; }

  async startHost() {
    this.role = 'host';
    this.peer = new Peer();
    this.bindPeerEvents();
    await this.waitOpen();
    this.hostId = this.peer.id;
    this.localPlayer = { ...this.localPlayer, id: this.peer.id, isHost: true, mic: false, connected: true };
    this.players.set(this.peer.id, this.localPlayer);
    this.bus.emit('network:ready', { role: 'host', peerId: this.peer.id });
    this.bus.emit('players:update', this.getPlayers());
    console.log('[network] Host mode started', this.peer.id);
  }

  async join(hostId) {
    this.role = 'client';
    this.hostId = hostId;
    this.peer = new Peer();
    this.bindPeerEvents();
    await this.waitOpen();
    this.localPlayer = { ...this.localPlayer, id: this.peer.id, isHost: false, mic: false, connected: true };
    const conn = this.peer.connect(hostId, { reliable: true, metadata: { player: this.localPlayer } });
    this.registerConnection(conn);
    this.bus.emit('network:ready', { role: 'client', peerId: this.peer.id });
    console.log('[network] Client peer opened', this.peer.id, 'connecting to', hostId);
  }

  bindPeerEvents() {
    this.peer.on('connection', (conn) => this.registerConnection(conn));
    this.peer.on('call', (call) => this.bus.emit('voice:incoming-call', call));
    this.peer.on('disconnected', () => this.bus.emit('network:status', 'PeerJS disconnected. Попробуйте reconnect.'));
    this.peer.on('close', () => this.bus.emit('network:status', 'Соединение закрыто.'));
    this.peer.on('error', (error) => {
      console.log('[network] PeerJS error', error);
      this.bus.emit('network:error', error.message || String(error));
    });
  }

  waitOpen() {
    return new Promise((resolve, reject) => {
      this.peer.on('open', resolve);
      this.peer.on('error', reject);
    });
  }

  registerConnection(conn) {
    conn.on('open', () => {
      this.connections.set(conn.peer, conn);
      console.log('[network] data connection open', conn.peer);
      if (this.role === 'host') {
        const player = conn.metadata?.player || { id: conn.peer, name: 'Игрок', avatar: '🜁' };
        if (this.players.size >= MAX_PLAYERS) {
          conn.send({ type: 'LOBBY_FULL' });
          conn.close();
          return;
        }
        this.players.set(conn.peer, { ...player, id: conn.peer, isHost: false, connected: true, mic: false });
        this.broadcast({ type: 'STATE_SYNC', players: this.getPlayers(), hostId: this.hostId }, true);
        this.bus.emit('players:update', this.getPlayers());
        this.bus.emit('system', `${player.name} подключился к лобби.`);
      } else {
        conn.send({ type: 'HELLO', player: this.localPlayer });
      }
      this.bus.emit('network:connection-open', conn.peer);
    });
    conn.on('data', (message) => this.handleMessage(conn.peer, message));
    conn.on('close', () => this.handleClose(conn.peer));
    conn.on('error', (error) => this.bus.emit('network:error', error.message || String(error)));
  }

  handleMessage(from, message) {
    console.log('[network] message', from, message.type);
    if (this.role === 'host') {
      if (message.type === 'HELLO') {
        this.players.set(from, { ...message.player, id: from, isHost: false, connected: true });
        this.broadcast({ type: 'STATE_SYNC', players: this.getPlayers(), hostId: this.hostId }, true);
        this.bus.emit('players:update', this.getPlayers());
        return;
      }
      // Host is authoritative router: every lobby, chat and game event is rebroadcast to all clients.
      if (['CHAT', 'GAME_PROPOSAL', 'GAME_EVENT', 'MIC_STATUS'].includes(message.type)) this.broadcast({ ...message, from }, true);
    }
    if (message.type === 'STATE_SYNC') {
      this.players = new Map(message.players.map(p => [p.id, p]));
      this.hostId = message.hostId;
      this.bus.emit('players:update', this.getPlayers());
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
  }

  send(message) {
    if (this.role === 'host') this.broadcast({ ...message, from: this.peer.id }, true);
    else this.connections.get(this.hostId)?.send(message);
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
    if (!this.stream || !this.network.peer) return;
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
    $('#openHostModalBtn').addEventListener('click', () => $('#hostPasswordModal').showModal());
    $('#confirmHostBtn').addEventListener('click', (event) => { event.preventDefault(); this.createLobbyWithPassword(); });
    $('#joinLobbyBtn').addEventListener('click', () => this.joinLobby());
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
    this.bus.on('network:ready', ({ role, peerId }) => {
      $('#roleBadge').textContent = role;
      $('#roleBadge').className = `badge ${role === 'host' ? 'warning' : 'success'}`;
      $('#ownPeerBox').classList.remove('hidden');
      $('#copyPeerBtn').textContent = peerId;
      $('#connectionStatus').textContent = role === 'host' ? 'Лобби создано · поделитесь Peer ID' : 'Подключение к лобби…';
      $('#chatStatus').textContent = 'online';
      $('#chatStatus').className = 'badge success';
      this.chat.system(role === 'host' ? 'Вы создали лобби как host.' : 'Вы подключаетесь к host-лобби.');
    });
    this.bus.on('network:error', (text) => { $('#connectionStatus').textContent = text; this.chat.system('Ошибка: ' + text); });
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
    const stored = JSON.parse(localStorage.getItem('nebula-profile') || '{}');
    return { name: stored.name || '', avatar: stored.avatar || AVATARS[0] };
  }
  saveProfile() { localStorage.setItem('nebula-profile', JSON.stringify(this.profile)); }
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
    await this.network.startHost();
  }

  async joinLobby() {
    const hostId = $('#peerIdInput').value.trim();
    if (!hostId) return this.chat.system('Введите Peer ID существующего host-лобби.');
    this.network.setLocalPlayer({ name: this.profile.name || 'Игрок', avatar: this.profile.avatar });
    await this.network.join(hostId);
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
      <article class="game-card" style="--card-glow:${index % 3 === 0 ? 'rgba(143,91,255,.27)' : index % 3 === 1 ? 'rgba(77,230,255,.22)' : 'rgba(255,139,107,.24)'}">
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
