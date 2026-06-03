import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const HOST_PASSWORD = '1234';
const MAX_PLAYERS = 3;
const AVATARS = ['🜂','🜁','🜃','🜄','🛸','🦊','🐙','🦉','🐲','🧿','⚡','🌙'];
const LOBBY_CODE_LENGTH = 5;
const FIRESTORE_STATE_TIMEOUT_MS = 5000;
const RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const FIREBASE_CONFIG = window.BANANA_FIREBASE_CONFIG || {
  apiKey: '',
  authDomain: '',
  projectId: '',
  appId: '',
};

function assertFirebaseConfig() {
  const missing = ['apiKey', 'authDomain', 'projectId', 'appId'].filter(key => !FIREBASE_CONFIG[key]);
  if (missing.length) {
    throw new Error(`Firebase не настроен: заполните FIREBASE_CONFIG (${missing.join(', ')}) или window.BANANA_FIREBASE_CONFIG.`);
  }
}

function formatFirebaseError(error) {
  const code = error?.code || error?.name || 'unknown';
  if (code === 'permission-denied') return 'Firestore permission denied: проверьте rules для lobbies/signals/candidates.';
  if (code === 'not-found') return 'Лобби не найдено';
  if (code === 'unavailable') return 'Firestore временно недоступен. Проверьте интернет или Firebase status.';
  return error?.message || String(error);
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

class FirebaseLobbyManager {
  constructor() {
    this.app = null;
    this.auth = null;
    this.db = null;
    this.user = null;
    this.unsubscribers = [];
  }

  async init() {
    if (this.db && this.user) return this;
    assertFirebaseConfig();
    this.app = this.app || initializeApp(FIREBASE_CONFIG);
    this.auth = this.auth || getAuth(this.app);
    this.db = this.db || getFirestore(this.app);
    if (!this.auth.currentUser) {
      console.log('[FIREBASE] anonymous auth start');
      await signInAnonymously(this.auth);
    }
    this.user = this.auth.currentUser;
    console.log('[FIREBASE] ready', this.user.uid);
    return this;
  }

  get userId() { return this.user?.uid; }
  lobbyRef(lobbyId) { return doc(this.db, 'lobbies', lobbyId); }
  playersRef(lobbyId) { return collection(this.lobbyRef(lobbyId), 'players'); }
  playerRef(lobbyId, playerId) { return doc(this.playersRef(lobbyId), playerId); }
  signalsRef(lobbyId) { return collection(this.lobbyRef(lobbyId), 'signals'); }
  signalRef(lobbyId, guestId) { return doc(this.signalsRef(lobbyId), guestId); }
  candidateRef(lobbyId, guestId, side) { return collection(this.signalRef(lobbyId, guestId), side); }

  generateLobbyId() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: LOBBY_CODE_LENGTH }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  }

  async createLobby(player) {
    await this.init();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const lobbyId = this.generateLobbyId();
      const lobbyRef = this.lobbyRef(lobbyId);
      const snapshot = await getDoc(lobbyRef);
      if (snapshot.exists()) continue;
      console.log('[LOBBY] creating', lobbyId);
      await setDoc(lobbyRef, {
        lobbyId,
        hostId: player.id,
        status: 'open',
        maxPlayers: MAX_PLAYERS,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        deleteAt: new Date(Date.now() + 1000 * 60 * 60),
        playerCount: 1,
      });
      await setDoc(this.playerRef(lobbyId, player.id), {
        nickname: player.name,
        avatar: player.avatar,
        online: true,
        micEnabled: Boolean(player.mic),
        isHost: true,
        joinedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      console.log('[LOBBY] created', lobbyId);
      return { lobbyId, hostId: player.id };
    }
    throw new Error('Не удалось сгенерировать свободный код лобби. Попробуйте ещё раз.');
  }

  async joinLobby(lobbyId, player) {
    await this.init();
    const normalizedId = lobbyId.trim().toUpperCase();
    const lobbyRef = this.lobbyRef(normalizedId);
    let hostId = null;
    await runTransaction(this.db, async (transaction) => {
      const lobbySnapshot = await transaction.get(lobbyRef);
      if (!lobbySnapshot.exists()) throw new Error('Лобби не найдено');
      const lobby = lobbySnapshot.data();
      if (lobby.status !== 'open') throw new Error('Лобби закрыто');
      hostId = lobby.hostId;
      const playerRef = this.playerRef(normalizedId, player.id);
      const playerSnapshot = await transaction.get(playerRef);
      const nextCount = playerSnapshot.exists() ? (lobby.playerCount || 1) : (lobby.playerCount || 1) + 1;
      if (nextCount > MAX_PLAYERS) throw new Error('Лобби заполнено: максимум 3 игрока.');
      transaction.set(playerRef, {
        nickname: player.name,
        avatar: player.avatar,
        online: true,
        micEnabled: Boolean(player.mic),
        isHost: false,
        joinedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      transaction.update(lobbyRef, { playerCount: nextCount, updatedAt: serverTimestamp() });
    });
    console.log('[LOBBY] joined', normalizedId, player.id);
    return { lobbyId: normalizedId, hostId };
  }


  mapPlayer(playerDoc) {
    const data = playerDoc.data();
    return {
      id: playerDoc.id,
      name: data.nickname || 'Игрок',
      avatar: data.avatar || AVATARS[0],
      isHost: Boolean(data.isHost),
      connected: data.online !== false,
      mic: Boolean(data.micEnabled),
    };
  }

  subscribeLobby(lobbyId, onLobby, onPlayers, onError) {
    const unsubLobby = onSnapshot(this.lobbyRef(lobbyId), (snapshot) => {
      if (!snapshot.exists()) {
        onError?.(new Error('Лобби не найдено'));
        return;
      }
      onLobby(snapshot.data());
    }, onError);
    const unsubPlayers = onSnapshot(this.playersRef(lobbyId), (snapshot) => {
      onPlayers(snapshot.docs.map(playerDoc => this.mapPlayer(playerDoc)));
    }, onError);
    this.unsubscribers.push(unsubLobby, unsubPlayers);
  }

  listenGuestSignals(lobbyId, onOffer, onError) {
    const unsubscribe = onSnapshot(this.signalsRef(lobbyId), (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        const data = change.doc.data();
        if ((change.type === 'added' || change.type === 'modified') && data.offer && !data.answer) {
          onOffer(change.doc.id, data.offer);
        }
      });
    }, onError);
    this.unsubscribers.push(unsubscribe);
  }

  listenSignal(lobbyId, guestId, onSignal, onError) {
    const unsubscribe = onSnapshot(this.signalRef(lobbyId, guestId), (snapshot) => {
      if (snapshot.exists()) onSignal(snapshot.data());
    }, onError);
    this.unsubscribers.push(unsubscribe);
  }

  listenIceCandidates(lobbyId, guestId, side, onCandidate, onError) {
    const unsubscribe = onSnapshot(this.candidateRef(lobbyId, guestId, side), (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') onCandidate(change.doc.data());
      });
    }, onError);
    this.unsubscribers.push(unsubscribe);
  }

  async setOffer(lobbyId, guestId, offer) {
    console.log('[FIREBASE] set offer', lobbyId, guestId);
    await setDoc(this.signalRef(lobbyId, guestId), { offer, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
  }

  async setAnswer(lobbyId, guestId, answer) {
    console.log('[FIREBASE] set answer', lobbyId, guestId);
    await setDoc(this.signalRef(lobbyId, guestId), { answer, updatedAt: serverTimestamp() }, { merge: true });
  }

  async addIceCandidate(lobbyId, guestId, side, candidate) {
    console.log('[ICE] add', side, guestId);
    await addDoc(this.candidateRef(lobbyId, guestId, side), { ...candidate, createdAt: serverTimestamp() });
  }

  async updatePlayer(lobbyId, playerId, patch) {
    await updateDoc(this.playerRef(lobbyId, playerId), { ...patch, updatedAt: serverTimestamp() });
  }

  async closeLobby(lobbyId) {
    if (!lobbyId) return;
    console.log('[LOBBY] closing', lobbyId);
    await updateDoc(this.lobbyRef(lobbyId), { status: 'closed', closedAt: serverTimestamp(), updatedAt: serverTimestamp(), deleteAt: new Date(Date.now() + 1000 * 60 * 10) }).catch(() => {});
  }

  async setOffline(lobbyId, playerId) {
    if (!lobbyId || !playerId) return;
    const lobbyRef = this.lobbyRef(lobbyId);
    const playerRef = this.playerRef(lobbyId, playerId);
    await runTransaction(this.db, async (transaction) => {
      const lobbySnapshot = await transaction.get(lobbyRef);
      const playerSnapshot = await transaction.get(playerRef);
      if (!lobbySnapshot.exists() || !playerSnapshot.exists()) return;
      const wasOnline = playerSnapshot.data().online !== false;
      const nextCount = wasOnline ? Math.max((lobbySnapshot.data().playerCount || 1) - 1, 0) : (lobbySnapshot.data().playerCount || 0);
      transaction.update(playerRef, { online: false, updatedAt: serverTimestamp() });
      transaction.update(lobbyRef, { playerCount: nextCount, updatedAt: serverTimestamp() });
    }).catch(() => {});
  }

  cleanup() {
    this.unsubscribers.splice(0).forEach(unsubscribe => unsubscribe());
  }
}

class WebRTCManager {
  constructor(bus, firebaseLobby) {
    this.bus = bus;
    this.firebaseLobby = firebaseLobby;
    this.role = 'offline';
    this.lobbyId = null;
    this.localPlayerId = null;
    this.hostId = null;
    this.localStream = null;
    this.peerConnections = new Map();
    this.dataChannels = new Map();
    this.pendingDataChannels = new Map();
    this.onDataMessage = null;
  }

  configure({ role, lobbyId, localPlayerId, hostId }) {
    this.role = role;
    this.lobbyId = lobbyId;
    this.localPlayerId = localPlayerId;
    this.hostId = hostId;
  }

  async startHost() {
    console.log('[WEBRTC] host ready for offers', this.lobbyId);
    this.firebaseLobby.listenGuestSignals(this.lobbyId, (guestId, offer) => this.acceptOffer(guestId, offer), error => this.emitError(error));
  }

  async connectAsGuest() {
    console.log('[WEBRTC] guest creating offer', this.lobbyId, this.localPlayerId);
    const pc = this.createPeerConnection(this.hostId, this.localPlayerId, false);
    const channel = pc.createDataChannel('banana-data', { ordered: true });
    this.attachDataChannel(this.hostId, channel);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await this.firebaseLobby.setOffer(this.lobbyId, this.localPlayerId, offer.toJSON());
    this.firebaseLobby.listenSignal(this.lobbyId, this.localPlayerId, async (signal) => {
      if (signal.answer && !pc.currentRemoteDescription) {
        console.log('[WEBRTC] answer received', this.localPlayerId);
        await pc.setRemoteDescription(new RTCSessionDescription(signal.answer));
      }
    }, error => this.emitError(error));
    this.firebaseLobby.listenIceCandidates(this.lobbyId, this.localPlayerId, 'hostCandidates', candidate => this.addRemoteIce(this.hostId, candidate), error => this.emitError(error));
    await this.waitForDataChannel(this.hostId);
  }

  async acceptOffer(guestId, offer) {
    if (this.peerConnections.has(guestId)) return;
    console.log('[WEBRTC] host accepting offer', guestId);
    const pc = this.createPeerConnection(guestId, guestId, true);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await this.firebaseLobby.setAnswer(this.lobbyId, guestId, answer.toJSON());
    this.firebaseLobby.listenIceCandidates(this.lobbyId, guestId, 'guestCandidates', candidate => this.addRemoteIce(guestId, candidate), error => this.emitError(error));
  }

  createPeerConnection(remoteId, signalId, isHost) {
    console.log('[WEBRTC] create RTCPeerConnection', remoteId);
    const pc = new RTCPeerConnection(RTC_CONFIG);
    this.peerConnections.set(remoteId, pc);
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => pc.addTrack(track, this.localStream));
    } else {
      pc.addTransceiver('audio', { direction: 'sendrecv' });
    }
    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      const side = isHost ? 'hostCandidates' : 'guestCandidates';
      console.log('[ICE] local candidate', side, remoteId);
      this.firebaseLobby.addIceCandidate(this.lobbyId, signalId, side, event.candidate.toJSON()).catch(error => this.emitError(error));
    };
    pc.onconnectionstatechange = () => {
      console.log('[WEBRTC] connection state', remoteId, pc.connectionState);
      if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) this.bus.emit('network:status', `WebRTC ${remoteId}: ${pc.connectionState}`);
    };
    pc.ondatachannel = (event) => this.attachDataChannel(remoteId, event.channel);
    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (stream) this.bus.emit('voice:remote-stream', { peerId: remoteId, stream });
    };
    return pc;
  }

  attachDataChannel(remoteId, channel) {
    console.log('[DATA_CHANNEL] attach', remoteId);
    this.dataChannels.set(remoteId, channel);
    channel.onopen = () => {
      console.log('[DATA_CHANNEL] open', remoteId);
      this.resolveDataChannel(remoteId, channel);
      this.bus.emit('network:connection-open', remoteId);
    };
    channel.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log('[DATA_CHANNEL] message', remoteId, message.type);
        this.onDataMessage?.(remoteId, message);
      } catch (error) {
        this.emitError(error);
      }
    };
    channel.onclose = () => {
      console.log('[DATA_CHANNEL] closed', remoteId);
      this.dataChannels.delete(remoteId);
      this.bus.emit('network:status', `DataChannel закрыт: ${remoteId}`);
    };
    channel.onerror = (error) => this.emitError(error);
    if (channel.readyState === 'open') channel.onopen();
  }

  waitForDataChannel(remoteId, timeoutMs = FIRESTORE_STATE_TIMEOUT_MS) {
    const existing = this.dataChannels.get(remoteId);
    if (existing?.readyState === 'open') return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingDataChannels.delete(remoteId);
        reject(new Error('WebRTC DataChannel не открылся. Проверьте STUN/WebRTC доступность сети.'));
      }, timeoutMs);
      this.pendingDataChannels.set(remoteId, { resolve, reject, timer });
    });
  }

  resolveDataChannel(remoteId, channel) {
    const pending = this.pendingDataChannels.get(remoteId);
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.resolve(channel);
    this.pendingDataChannels.delete(remoteId);
  }

  async addRemoteIce(remoteId, candidate) {
    const pc = this.peerConnections.get(remoteId);
    if (!pc || !candidate?.candidate) return;
    console.log('[ICE] remote candidate', remoteId);
    await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(error => this.emitError(error));
  }

  setLocalStream(stream) {
    this.localStream = stream;
    const [audioTrack] = stream.getAudioTracks();
    this.peerConnections.forEach((pc) => {
      const sender = pc.getSenders().find(item => item.track?.kind === 'audio' || item.track === null);
      if (sender && audioTrack) {
        sender.replaceTrack(audioTrack).catch(error => this.emitError(error));
        return;
      }
      stream.getTracks().forEach(track => pc.addTrack(track, stream));
    });
  }

  sendTo(remoteId, message) {
    const channel = this.dataChannels.get(remoteId);
    if (!channel || channel.readyState !== 'open') {
      console.warn('[DATA_CHANNEL] not open', remoteId, message.type);
      return false;
    }
    console.log('[DATA_CHANNEL] send', remoteId, message.type);
    channel.send(JSON.stringify(message));
    return true;
  }

  broadcast(message) {
    this.dataChannels.forEach((_, remoteId) => this.sendTo(remoteId, message));
  }

  close() {
    this.pendingDataChannels.forEach(({ reject, timer }) => {
      clearTimeout(timer);
      reject(new Error('WebRTC connection closed'));
    });
    this.pendingDataChannels.clear();
    this.dataChannels.forEach(channel => channel.close());
    this.peerConnections.forEach(pc => pc.close());
    this.dataChannels.clear();
    this.peerConnections.clear();
  }

  emitError(error) {
    console.log('[WEBRTC] error', error);
    this.bus.emit('network:error', formatFirebaseError(error));
  }
}

class NetworkManager {
  constructor(bus) {
    this.bus = bus;
    this.role = 'offline';
    this.connections = new Map();
    this.players = new Map();
    this.localPlayer = null;
    this.localPlayerId = null;
    this.lobbyId = null;
    this.hostId = null;
    this.pendingStateSync = null;
    this.firebaseLobby = new FirebaseLobbyManager();
    this.webrtc = new WebRTCManager(bus, this.firebaseLobby);
    this.webrtc.onDataMessage = (from, message) => this.handleDataMessage(from, message);
    window.addEventListener('beforeunload', () => this.close());
  }

  setLocalPlayer(player) { this.localPlayer = { ...this.localPlayer, ...player }; }

  async prepareLocalPlayer(isHost = false) {
    await this.firebaseLobby.init();
    this.localPlayerId = this.firebaseLobby.userId;
    this.localPlayer = {
      ...this.localPlayer,
      id: this.localPlayerId,
      isHost,
      mic: Boolean(this.localPlayer?.mic),
      connected: true,
    };
  }

  async startHost() {
    this.close(false);
    this.role = 'host';
    this.bus.emit('network:preparing-host');
    this.bus.emit('network:status', 'Создаём Firebase лобби...');
    await this.prepareLocalPlayer(true);
    const { lobbyId, hostId } = await this.firebaseLobby.createLobby(this.localPlayer);
    this.lobbyId = lobbyId;
    this.hostId = hostId;
    this.players.set(this.localPlayerId, this.localPlayer);
    this.bindLobbySnapshots();
    this.webrtc.configure({ role: 'host', lobbyId, localPlayerId: this.localPlayerId, hostId });
    await this.webrtc.startHost();
    this.bus.emit('network:ready', { role: 'host', peerId: lobbyId, lobbyId });
    this.bus.emit('network:status', 'Лобби готово');
    this.bus.emit('players:update', this.getPlayers());
    console.log('[LOBBY] host ready', lobbyId);
  }

  async join(lobbyId) {
    this.close(false);
    this.role = 'client';
    this.bus.emit('network:status', 'Ищем лобби в Firestore...');
    await this.prepareLocalPlayer(false);
    const joined = await this.firebaseLobby.joinLobby(lobbyId, this.localPlayer);
    this.lobbyId = joined.lobbyId;
    this.hostId = joined.hostId;
    this.bindLobbySnapshots();
    this.webrtc.configure({ role: 'client', lobbyId: this.lobbyId, localPlayerId: this.localPlayerId, hostId: this.hostId });
    await this.webrtc.connectAsGuest();
    const stateSync = this.waitForStateSync();
    this.send({ type: 'HELLO', player: this.localPlayer });
    console.log('[DATA_CHANNEL] HELLO sent', this.hostId);
    await stateSync;
    this.bus.emit('network:ready', { role: 'client', peerId: this.lobbyId, lobbyId: this.lobbyId });
    this.bus.emit('network:status', 'Подключено к Firebase/WebRTC лобби.');
    console.log('[LOBBY] client joined', this.lobbyId);
  }

  bindLobbySnapshots() {
    this.firebaseLobby.subscribeLobby(this.lobbyId, (lobby) => {
      console.log('[FIREBASE] lobby snapshot', lobby.status);
      if (lobby.status === 'closed') this.bus.emit('network:error', 'Лобби закрыто host-игроком.');
    }, (players) => {
      this.players = new Map(players.map(player => [player.id, player]));
      this.bus.emit('players:update', this.getPlayers());
    }, (error) => this.bus.emit('network:error', formatFirebaseError(error)));
  }

  waitForStateSync(timeoutMs = FIRESTORE_STATE_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingStateSync = null;
        reject(new Error('Host не отправил STATE_SYNC через DataChannel.'));
      }, timeoutMs);
      this.pendingStateSync = { resolve, reject, timer };
    });
  }

  handleDataMessage(from, message) {
    console.log('[DATA_CHANNEL] received', from, message.type);
    if (this.role === 'host' && message.type === 'HELLO') {
      console.log('[LOBBY] HELLO received', from);
      const stateSync = { type: 'STATE_SYNC', players: this.getPlayers(), hostId: this.lobbyId };
      this.webrtc.sendTo(from, stateSync);
      console.log('[DATA_CHANNEL] STATE_SYNC sent', from);
      this.bus.emit('system', `${message.player?.name || 'Игрок'} подключился к лобби.`);
      return;
    }
    if (message.type === 'STATE_SYNC') {
      console.log('[DATA_CHANNEL] STATE_SYNC received', from);
      if (Array.isArray(message.players)) this.players = new Map(message.players.map(player => [player.id, player]));
      if (this.pendingStateSync) {
        clearTimeout(this.pendingStateSync.timer);
        this.pendingStateSync.resolve();
        this.pendingStateSync = null;
      }
      this.bus.emit('players:update', this.getPlayers());
      return;
    }
    if (this.role === 'host' && ['CHAT', 'GAME_PROPOSAL', 'GAME_EVENT', 'MIC_STATUS', 'START_GAME', 'PROPOSAL_REJECTED'].includes(message.type)) {
      this.broadcast({ ...message, from }, true);
      return;
    }
    this.bus.emit('network:message', { from, message });
  }

  send(message) {
    if (this.role === 'host') this.broadcast({ ...message, from: this.localPlayerId }, true);
    else this.webrtc.sendTo(this.hostId, message);
  }

  broadcast(message, includeSelf = false) {
    this.webrtc.broadcast(message);
    if (includeSelf) this.bus.emit('network:message', { from: this.localPlayerId, message });
  }

  async updateMicStatus(enabled) {
    if (!this.localPlayerId || !this.lobbyId) return;
    this.localPlayer.mic = enabled;
    if (this.players.has(this.localPlayerId)) this.players.set(this.localPlayerId, { ...this.players.get(this.localPlayerId), mic: enabled });
    await this.firebaseLobby.updatePlayer(this.lobbyId, this.localPlayerId, { micEnabled: enabled }).catch(error => this.bus.emit('network:error', formatFirebaseError(error)));
    this.send({ type: 'MIC_STATUS', playerId: this.localPlayerId, enabled });
    this.bus.emit('players:update', this.getPlayers());
  }

  setLocalStream(stream) { this.webrtc.setLocalStream(stream); }
  getPlayers() { return [...this.players.values()]; }

  close(markOffline = true) {
    this.webrtc.close();
    this.firebaseLobby.cleanup();
    if (markOffline && this.lobbyId && this.localPlayerId) {
      if (this.role === 'host') this.firebaseLobby.closeLobby(this.lobbyId);
      else this.firebaseLobby.setOffline(this.lobbyId, this.localPlayerId);
    }
    this.connections.clear();
    this.players.clear();
    this.pendingStateSync = null;
  }
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
    this.bus.on('voice:remote-stream', ({ peerId, stream }) => this.mountRemote(peerId, stream));
    this.bus.on('network:connection-open', () => { if (this.stream) this.network.setLocalStream(this.stream); });
    this.paint();
  }

  async ensureStream() {
    if (this.stream) return this.stream;
    console.log('[WEBRTC] getUserMedia audio');
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
    this.stream.getAudioTracks().forEach(track => track.enabled = this.enabled);
    this.network.setLocalStream(this.stream);
    this.setupMeter();
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

  mountRemote(peerId, stream) {
    let audio = document.querySelector(`audio[data-participant="${peerId}"]`);
    if (!audio) {
      audio = document.createElement('audio');
      audio.dataset.participant = peerId;
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
    $('#openHostModalBtn').addEventListener('click', () => {
      console.log('[DEBUG] createLobby clicked');
      $('#hostPasswordModal').showModal();
    });
    $('#confirmHostBtn').addEventListener('click', (event) => { event.preventDefault(); this.createLobbyWithPassword(); });
    $('#joinLobbyBtn').addEventListener('click', () => this.joinLobby());
    $('#lobbyIdInput').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.joinLobby();
    });
    $('#copyLobbyBtn').addEventListener('click', async () => {
      await navigator.clipboard.writeText(this.network.lobbyId || '');
      this.chat.system('код лобби скопирован в буфер обмена.');
    });
    $('#backToCatalogBtn').addEventListener('click', () => this.showCatalog());
  }

  bindEvents() {
    this.bus.on('system', (text) => this.chat.system(text));
    this.bus.on('chat:send', ({ text }) => {
      const message = { type: 'CHAT', id: uid(), author: this.profile.name, authorId: this.network.localPlayerId || 'local', text, time: now() };
      this.network.send(message);
      if (this.network.role === 'offline') this.chat.add({ ...message, kind: 'own' });
    });
    this.bus.on('network:preparing-host', () => {
      $('#ownLobbyBox').classList.add('hidden');
      $('#copyLobbyBtn').textContent = '';
      $('#roleBadge').textContent = 'preparing';
      $('#roleBadge').className = 'badge warning';
    });
    this.bus.on('network:ready', ({ role, lobbyId }) => {
      $('#roleBadge').textContent = role;
      $('#roleBadge').className = `badge ${role === 'host' ? 'warning' : 'success'}`;
      $('#ownLobbyBox').classList.remove('hidden');
      $('#copyLobbyBtn').textContent = lobbyId;
      $('#connectionStatus').textContent = role === 'host' ? 'Лобби создано · поделитесь код лобби' : 'WebRTC соединение открыто · ждём состояние лобби…';
      $('#chatStatus').textContent = 'online';
      $('#chatStatus').className = 'badge success';
      this.chat.system(role === 'host' ? 'Вы создали Banana Play лобби как host.' : 'Вы подключаетесь к Banana Play лобби.');
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
    if (message.type === 'CHAT') this.chat.add({ ...message, kind: message.authorId === this.network.localPlayerId ? 'own' : '' });
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
    this.chat.system(`Профиль ${name} готов. Создайте лобби или подключитесь по коду лобби.`);
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
      console.log('[LOBBY] Firebase lobby created', this.network.lobbyId);
    } catch (error) {
      console.log('[network] Host start failed', error);
      console.log('[FIREBASE] error', error);
      this.bus.emit('network:error', formatFirebaseError(error));
    }
  }

  async joinLobby() {
    console.log('[DEBUG] joinLobby clicked');
    const lobbyId = $('#lobbyIdInput').value.trim().toUpperCase();
    console.log('[LOBBY] lobbyId =', lobbyId);
    if (!lobbyId) return this.chat.system('Введите код существующего лобби.');
    this.network.setLocalPlayer({ name: this.profile.name || 'Игрок', avatar: this.profile.avatar });
    try {
      $('#connectionStatus').textContent = 'Подключаемся к Banana Play лобби…';
      await this.network.join(lobbyId);
    } catch (error) {
      console.log('[network] Join failed', error);
      console.log('[FIREBASE] error', error);
      this.bus.emit('network:error', formatFirebaseError(error));
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
      node.querySelector('.player-meta span').textContent = player.id === this.network.localPlayerId ? 'это вы' : player.id;
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
    const proposal = { type: 'GAME_PROPOSAL', id: uid(), gameId, proposer: this.profile.name, proposerId: this.network.localPlayerId };
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
      localPlayerId: this.network.localPlayerId || 'local',
      players: this.network.getPlayers(),
      sendGameEvent: (payload) => this.network.send({ type: 'GAME_EVENT', gameId, payload, actorId: this.network.localPlayerId }),
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
