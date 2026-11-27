/* ══════════════════════════════════════════════════════════════
   ENP ACCOUNT — 바카라 · 블랙잭 공용 계정/잔액 저장소
   · localStorage 'enp_baccarat_accounts_v1' 하나를 두 게임이 함께 씁니다.
   · 회원가입 · 로그인 · 로그아웃 · 관리자(6160) 잔액 조정을 여기서 처리합니다.
   · 다른 탭/창에서 저장이 일어나면 storage 이벤트로 같은 객체를 갱신합니다.
   ══════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const DB_KEY = 'enp_baccarat_accounts_v1';
  const LEGACY_KEY = 'enp_baccarat_v1';        // 아주 첫 버전 바카라 저장 키
  const BJ_KEY = 'enp-blackjack-v1';           // 블랙잭 단독 시절 저장 키 (마이그레이션용)
  const START_BALANCE = 1000000000;
  const ADMIN_PIN = '6160';
  const MODE_IDS = ['speed', 'sakura', 'snow'];

  const modeOk = (m) => MODE_IDS.indexOf(m) >= 0;

  const freshStats = () => ({
    hands: 0, player: 0, banker: 0, tie: 0, playerPair: 0, bankerPair: 0, wagered: 0, profit: 0
  });

  const freshBj = () => ({
    history: [],
    stats: { rounds: 0, wins: 0, losses: 0, pushes: 0, blackjacks: 0, net: 0 },
    sound: true,
    motion: true,
    autoNext: true,
    chip: 10000,
    lastBets: null
  });

  const freshProfile = (id, nick) => ({
    id,
    nick: nick || '',
    balance: START_BALANCE,
    stats: freshStats(),
    history: [],
    lastBets: null,
    bj: freshBj(),
    createdAt: Date.now()
  });

  function normalize(raw, opts) {
    const options = opts || {};
    const db = {
      users: {},
      current: null,
      guest: freshProfile('guest', '게스트'),
      settings: { sound: true, squeeze: false, noCommission: false, autoRebet: false },
      chip: 10000,
      mode: 'sakura',
      admin: { repo: '', pat: '' },
      bjMigrated: false
    };

    if (raw && typeof raw === 'object') {
      if (raw.users && typeof raw.users === 'object') db.users = raw.users;
      db.current = typeof raw.current === 'string' ? raw.current : null;
      if (raw.guest) Object.assign(db.guest, raw.guest);
      if (raw.settings) Object.assign(db.settings, raw.settings);
      if (Number.isFinite(raw.chip)) db.chip = raw.chip;
      if (raw.mode && modeOk(raw.mode)) db.mode = raw.mode;
      if (raw.admin) Object.assign(db.admin, raw.admin);
      if (raw.bjMigrated) db.bjMigrated = true;
    }

    if (db.current && !db.users[db.current]) db.current = null;

    const repair = (p, id) => {
      if (!p || typeof p !== 'object') return freshProfile(id, '');
      if (!p.id) p.id = id;
      if (!Number.isFinite(p.balance)) p.balance = START_BALANCE;
      p.balance = Math.max(0, Math.round(p.balance));
      if (!p.stats || typeof p.stats !== 'object') p.stats = freshStats();
      else p.stats = Object.assign(freshStats(), p.stats);
      if (!Array.isArray(p.history)) p.history = [];
      if (!p.bj || typeof p.bj !== 'object') p.bj = freshBj();
      else {
        const base = freshBj();
        p.bj = Object.assign(base, p.bj);
        if (!Array.isArray(p.bj.history)) p.bj.history = [];
        p.bj.stats = Object.assign(base.stats, p.bj.stats || {});
      }
      return p;
    };

    db.guest = repair(db.guest, 'guest');
    for (const [id, u] of Object.entries(db.users)) db.users[id] = repair(u, id);

    if (!options.noMigrate) migrateLegacy(db);
    return db;
  }

  /* ── 옛 저장소 → 공용 계정 ─────────────────────────────
     · enp_baccarat_v1 (첫 바카라 버전) : 게스트 잔액/기록만 있던 형태
     · enp-blackjack-v1 (블랙잭 단독)   : 닉네임·잔액·기록·설정
     둘 다 게스트 프로필로 흡수하고, 남은 원본 키는 지우지 않습니다. */
  function migrateLegacy(db) {
    if (db.bjMigrated) return;

    // 1) 옛 바카라 단일 저장소 (계정 DB 가 아예 없던 시절)
    try {
      const rawBac = localStorage.getItem(DB_KEY);
      if (!rawBac) {
        const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null');
        if (legacy) {
          if (Number.isFinite(legacy.balance)) db.guest.balance = Math.max(0, Math.round(legacy.balance));
          if (legacy.stats) db.guest.stats = Object.assign(freshStats(), legacy.stats);
          if (Array.isArray(legacy.history)) db.guest.history = legacy.history;
          if (legacy.settings) Object.assign(db.settings, legacy.settings);
          if (Number.isFinite(legacy.chip)) db.chip = legacy.chip;
          if (legacy.mode && modeOk(legacy.mode)) db.mode = legacy.mode;
        }
      }
    } catch (err) { /* ignore */ }

    // 2) 블랙잭 단독 저장소
    try {
      const old = JSON.parse(localStorage.getItem(BJ_KEY) || 'null');
      if (old && typeof old === 'object') {
        const g = db.guest;
        const untouched = g.balance === START_BALANCE && !(g.history && g.history.length);
        if (typeof old.nickname === 'string' && old.nickname.trim() && (!g.nick || g.nick === '게스트')) {
          g.nick = old.nickname.trim().slice(0, 12);
        }
        g.bj = Object.assign(freshBj(), {
          history: Array.isArray(old.history) ? old.history.slice(0, 40) : [],
          stats: Object.assign(freshBj().stats, old.stats || {}),
          sound: old.sound !== false,
          motion: old.motion !== false,
          autoNext: old.autoNext !== false,
          chip: 10000,
          lastBets: null
        });
        // 바카라 계정을 한 번도 쓰지 않은 상태에서만 옛 블랙잭 잔액을 이어받습니다.
        if (Number.isFinite(old.balance) && old.balance >= 0 && untouched) {
          g.balance = Math.round(old.balance);
        }
      }
    } catch (err) { /* ignore */ }

    db.bjMigrated = true;
  }

  function readRaw() {
    try {
      const raw = localStorage.getItem(DB_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) { return null; }
  }

  const db = normalize(readRaw());

  /* ── 저장 / 구독 ─────────────────────────────────────── */
  const listeners = new Set();
  let writeAt = 0;

  function save() {
    try {
      localStorage.setItem(DB_KEY, JSON.stringify(db));
      writeAt = Date.now();
    } catch (err) { /* storage may be unavailable */ }
  }

  function emit(kind) {
    listeners.forEach((fn) => {
      try { fn(kind); } catch (err) { /* ignore */ }
    });
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function replace(next) {
    const keep = db.bjMigrated;
    for (const key of Object.keys(db)) delete db[key];
    Object.assign(db, next);
    if (keep) db.bjMigrated = true;
  }

  global.addEventListener('storage', (ev) => {
    if (ev.key !== DB_KEY || !ev.newValue) return;
    if (Date.now() - writeAt < 120) return;     // 내가 방금 쓴 값
    try {
      replace(normalize(JSON.parse(ev.newValue), { noMigrate: true }));
      emit('external');
    } catch (err) { /* ignore corrupt payload */ }
  });

  /* ── 프로필 ─────────────────────────────────────────── */
  function profile() {
    return (db.current && db.users[db.current]) ? db.users[db.current] : db.guest;
  }

  function profileOf(uid) {
    return uid === 'guest' ? db.guest : (db.users[uid] || null);
  }

  function displayName(p) {
    const prof = p || profile();
    return prof.nick || prof.id || (db.current ? prof.id : '게스트');
  }

  /* ── PIN 해시 (바카라와 같은 방식) ───────────────────── */
  async function hashPin(pin) {
    const raw = 'enp-baccarat::' + pin;
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch (err) {
      let h = 2166136261;
      for (let i = 0; i < raw.length; i++) { h ^= raw.charCodeAt(i); h = Math.imul(h, 16777619); }
      return 'fnv' + (h >>> 0).toString(16);
    }
  }

  const ID_RE = /^[a-z0-9_]{3,14}$/;
  const PIN_RE = /^\d{4,6}$/;

  function validateId(id) {
    if (!ID_RE.test(id)) return '아이디는 3~14자 영문·숫자·밑줄만 가능합니다';
    return '';
  }

  async function signup(id, nick, pin, pin2) {
    const userId = String(id || '').trim().toLowerCase();
    const name = String(nick || '').trim().slice(0, 12);
    const p1 = String(pin || '').trim();
    const p2 = String(pin2 == null ? pin : pin2).trim();

    const idErr = validateId(userId);
    if (idErr) return { ok: false, error: idErr };
    if (!PIN_RE.test(p1)) return { ok: false, error: 'PIN은 4~6자리 숫자입니다' };
    if (db.users[userId]) return { ok: false, error: '이미 사용 중인 아이디입니다' };
    if (p1 !== p2) return { ok: false, error: 'PIN 확인이 일치하지 않습니다' };

    const hash = await hashPin(p1);
    const p = freshProfile(userId, name);
    p.pin = hash;
    db.users[userId] = p;
    save();
    db.current = userId;
    save();
    return { ok: true, profile: profile() };
  }

  async function login(id, pin) {
    const userId = String(id || '').trim().toLowerCase();
    const p1 = String(pin || '').trim();
    const idErr = validateId(userId);
    if (idErr) return { ok: false, error: idErr };
    if (!PIN_RE.test(p1)) return { ok: false, error: 'PIN은 4~6자리 숫자입니다' };
    const u = db.users[userId];
    if (!u) return { ok: false, error: '아이디를 찾을 수 없습니다' };
    if (u.pin !== await hashPin(p1)) return { ok: false, error: 'PIN이 올바르지 않습니다' };
    db.current = userId;
    save();
    return { ok: true, profile: profile() };
  }

  function logout() {
    db.current = null;
    save();
    return profile();
  }

  /* ── 잔액 ───────────────────────────────────────────── */
  function setBalance(uid, value) {
    const p = profileOf(uid || (db.current || 'guest'));
    if (!p) return null;
    p.balance = Math.max(0, Math.round(Number(value) || 0));
    save();
    return p;
  }

  function adjust(uid, op, amount) {
    const p = profileOf(uid || (db.current || 'guest'));
    if (!p) return null;
    const val = Math.abs(Math.round(Number(amount) || 0));
    if (op === 'plus') p.balance = Math.round(p.balance + val);
    else if (op === 'minus') p.balance = Math.max(0, Math.round(p.balance - val));
    else p.balance = START_BALANCE;
    save();
    return p;
  }

  function refill(uid, amount) {
    const p = profileOf(uid || (db.current || 'guest'));
    if (!p) return null;
    p.balance = Math.round(p.balance + (Number(amount) || START_BALANCE));
    save();
    return p;
  }

  function resetProfile(uid) {
    const p = profileOf(uid || (db.current || 'guest'));
    if (!p) return null;
    p.balance = START_BALANCE;
    p.stats = freshStats();
    p.history = [];
    p.lastBets = null;
    p.bj = freshBj();
    save();
    return p;
  }

  function members() {
    const rows = [];
    const cur = db.current || 'guest';
    if (db.users[cur]) rows.push({ key: cur, profile: db.users[cur], guest: false });
    else rows.push({ key: 'guest', profile: db.guest, guest: true });
    for (const u of Object.values(db.users)) {
      if (u.id === cur) continue;
      rows.push({ key: u.id, profile: u, guest: false });
    }
    if (cur !== 'guest') rows.push({ key: 'guest', profile: db.guest, guest: true });
    return rows;
  }

  global.ENPAccount = {
    DB_KEY,
    BJ_KEY,
    START_BALANCE,
    ADMIN_PIN,
    db,
    save,
    subscribe,
    profile,
    profileOf,
    displayName,
    hashPin,
    signup,
    login,
    logout,
    setBalance,
    adjust,
    refill,
    resetProfile,
    members,
    freshBj,
    freshStats
  };
})(typeof window !== 'undefined' ? window : globalThis);
