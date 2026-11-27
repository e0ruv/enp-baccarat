/* ══════════════════════════════════════════════════════════════
   ENP BACCARAT — App
   4 tables · virtual money · Lighthouse/Lightning/Sakura/Snow FX
   ══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const E = window.BaccaratEngine;
  const ACC = window.ENPAccount || null;   // 바카라 · 블랙잭 공용 계정 저장소
  const MODES = E.MODES;
  const SYM = E.SUIT_SYMBOL;

  const CHIPS = [1000, 5000, 10000, 50000, 100000, 500000, 1000000, 5000000, 10000000, 100000000];
  const MIN_CHIP = 1000;
  const START_BALANCE = 1000000000;   // 가상 머니 기본 지급 ₩10억
  const LS_KEY = 'enp_baccarat_v1';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const won = (n) => '₩' + Math.round(n).toLocaleString('ko-KR');
  const wonSign = (n) => (n > 0 ? '+' : n < 0 ? '-' : '') + '₩' + Math.abs(Math.round(n)).toLocaleString('ko-KR');
  /** 큰 금액은 억 단위로 줄여 표시 (상단 바·상태바) */
  const compactNum = (n) => {
    const v = Math.round(n);
    const abs = Math.abs(v);
    if (abs >= 100000000) {
      const eok = v / 100000000;
      const r = Math.round(eok * 10) / 10;
      return (Number.isInteger(r) ? String(r) : r.toFixed(1)) + '억';
    }
    return v.toLocaleString('ko-KR');
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const signed = (n) => Math.round(n).toLocaleString('ko-KR');
  /** 칩 금액 표기 — 영문 K / M / B (1K · 10K · 100K · 1M · 100M · 1B) */
  const chipLabel = (n) => {
    const v = Math.round(Math.abs(n));
    const unit = (div, suffix) => {
      const r = Math.round((v / div) * 10) / 10;
      return (Number.isInteger(r) ? String(r) : r.toFixed(1)) + suffix;
    };
    if (v >= 1000000000) return unit(1000000000, 'B');
    if (v >= 1000000) return unit(1000000, 'M');
    if (v >= 1000) return unit(1000, 'K');
    return String(v);
  };

  /** 당첨 칩 표기 — 영상처럼 97,500 → '97K+' (100M+ · 1.5B+) */
  const winChipLabel = (n) => {
    const v = Math.round(Math.abs(n));
    if (v >= 1000000000) return (Math.floor(v / 100000000) / 10) + 'B+';
    if (v >= 1000000) return Math.floor(v / 1000000) + 'M+';
    if (v >= 1000) return Math.floor(v / 1000) + 'K+';
    return v + '+';
  };

  /** 칩 글씨가 원 안에 들어가도록 길이별 크기 클래스 (ln2 · ln3 · ln4 · ln5) */
  const chipInk = (text) => `<i class="ln${text.length}">${text}</i>`;

  const SPOT_LABEL = {
    player: '플레이어',
    banker: '뱅커',
    tie: '무',
    playerPair: '플레이어 페어',
    bankerPair: '뱅커 페어',
    playerBonus: '플레이어 보너스',
    bankerBonus: '뱅커 보너스',
    perfectPair: '퍼펙트 페어',
    eitherPair: '이더 페어'
  };
  const SPOT_KEY = {
    player: 'p',
    banker: 'b',
    tie: 't',
    playerPair: 'pp',
    bankerPair: 'bp',
    playerBonus: 'pb',
    bankerBonus: 'bb',
    perfectPair: 'pf',
    eitherPair: 'ep'
  };
  const SPOT_ORDER = ['player', 'banker', 'tie', 'playerPair', 'bankerPair', 'playerBonus', 'bankerBonus', 'perfectPair', 'eitherPair'];

  /* ───────────── profiles & storage ───────────── */
  const emptyBets = () => ({
    player: 0, banker: 0, tie: 0, playerPair: 0, bankerPair: 0,
    playerBonus: 0, bankerBonus: 0, perfectPair: 0, eitherPair: 0
  });

  const DB_KEY = 'enp_baccarat_accounts_v1';
  const LEGACY_KEY = 'enp_baccarat_v1';

  const freshStats = () => ({ hands: 0, player: 0, banker: 0, tie: 0, playerPair: 0, bankerPair: 0, wagered: 0, profit: 0 });
  const freshProfile = (id, nick) => ({
    id,
    nick: nick || '',
    balance: START_BALANCE,
    stats: freshStats(),
    history: [],
    lastBets: null,
    createdAt: Date.now()
  });

  function loadDB() {
    const db = {
      users: {},
      current: null,
      guest: freshProfile('guest', '게스트'),
      settings: { sound: true, squeeze: false, noCommission: false, autoRebet: false },
      chip: 10000,
      mode: 'sakura',
      admin: { repo: '', pat: '' }
    };
    try {
      const raw = localStorage.getItem(DB_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved && typeof saved === 'object') {
          if (saved.users && typeof saved.users === 'object') db.users = saved.users;
          db.current = typeof saved.current === 'string' ? saved.current : null;
          if (saved.guest) Object.assign(db.guest, saved.guest);
          if (saved.settings) Object.assign(db.settings, saved.settings);
          if (Number.isFinite(saved.chip)) db.chip = saved.chip;
          if (saved.mode && MODES[saved.mode]) db.mode = saved.mode;
          if (saved.admin) Object.assign(db.admin, saved.admin);
        }
      } else {
        const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null');
        if (legacy) {
          if (Number.isFinite(legacy.balance)) db.guest.balance = Math.max(0, Math.round(legacy.balance));
          if (legacy.stats) db.guest.stats = Object.assign(freshStats(), legacy.stats);
          if (Array.isArray(legacy.history)) db.guest.history = legacy.history;
          if (legacy.settings) Object.assign(db.settings, legacy.settings);
          if (Number.isFinite(legacy.chip)) db.chip = legacy.chip;
          if (legacy.mode && MODES[legacy.mode]) db.mode = legacy.mode;
        }
      }
    } catch (err) { /* ignore corrupt storage */ }

    if (db.current && !db.users[db.current]) db.current = null;
    for (const u of Object.values(db.users)) {
      if (!Number.isFinite(u.balance)) u.balance = START_BALANCE;
      if (!u.stats) u.stats = freshStats();
      if (!Array.isArray(u.history)) u.history = [];
    }
    return db;
  }

  const DB = ACC ? ACC.db : loadDB();

  function activeProfile() {
    return (DB.current && DB.users[DB.current]) ? DB.users[DB.current] : DB.guest;
  }

  const S = {
    balance: activeProfile().balance,
    mode: DB.mode,
    bets: emptyBets(),
    stack: [],
    chip: DB.chip,
    lastBets: activeProfile().lastBets || null,
    stats: activeProfile().stats,
    history: activeProfile().history,
    settings: DB.settings,
    shoe: new E.Shoe(8),
    bonus: [],
    hand: null,
    phase: 'betting',
    autoTimer: null,
    shuffling: false,
    autoDealing: false,
    shoeNo: 1
  };

  let squeezeWait = null;
  let resultTimer = null;
  let celebTimer = null;

  // 마지막으로 저장소와 맞춰 본 잔액 — 블랙잭 탭과 동시에 열려 있어도 손익을 덮어쓰지 않기 위한 기준값
  let lastSavedBalance = S.balance;

  function save() {
    DB.mode = S.mode;
    DB.chip = S.chip;
    DB.settings = S.settings;
    try {
      if (ACC) {
        const res = ACC.commit(DB.current || 'guest', {
          balance: S.balance,
          baseline: lastSavedBalance,
          patch: (p) => {
            p.stats = S.stats;
            p.history = S.history.slice(-240);
            p.lastBets = S.lastBets;
          },
          meta: { mode: S.mode, chip: S.chip, settings: S.settings }
        });
        lastSavedBalance = res.balance;
        if (res.balance !== S.balance) {
          S.balance = res.balance;
          renderBalance();
        }
        return;
      }
      const p = activeProfile();
      p.balance = S.balance;
      p.stats = S.stats;
      p.history = S.history.slice(-240);
      p.lastBets = S.lastBets;
      localStorage.setItem(DB_KEY, JSON.stringify(DB));
    } catch (err) { /* storage may be unavailable */ }
  }

  /* ───────────── dom ───────────── */
  const el = {
    splash: $('#splash'),
    splashFill: $('#splashFill'),
    balance: $('#balance'),
    refillBtn: $('#refillBtn'),
    soundBtn: $('#soundBtn'),
    infoBtn: $('#infoBtn'),
    modeSwitch: $('#modeSwitch'),
    chipAmount: $('#chipAmount'),
    chipRow: $('#chipRow'),
    halfBtn: $('#halfBtn'),
    doubleBtn: $('#doubleBtn'),
    totalStake: $('#totalStake'),
    feeRow: $('#feeRow'),
    feeLabel: $('#feeLabel'),
    totalFee: $('#totalFee'),
    totalDebit: $('#totalDebit'),
    rebetBtn: $('#rebetBtn'),
    clearBtn: $('#clearBtn'),
    undoBtn: $('#undoBtn'),
    dealBtn: $('#dealBtn'),
    dealAmount: $('#dealAmount'),
    bonusStrip: $('#bonusStrip'),
    bonusIcon: $('#bonusIcon'),
    bonusTitle: $('#bonusTitle'),
    bonusTag: $('#bonusTag'),
    bonusNote: $('#bonusNote'),
    bonusCards: $('#bonusCards'),
    tableName: $('#tableName'),
    tableRule: $('#tableRule'),
    felt: $('#felt'),
    fx: $('#fx'),
    shoeCount: $('#shoeCount'),
    shoeInfo: $('#shoeInfo'),
    shoeBar: $('#shoeBar'),
    tableNote: $('#tableNote'),
    reshuffleBtn: $('#reshuffleBtn'),
    bankerCards: $('#bankerCards'),
    playerCards: $('#playerCards'),
    bankerTotal: $('#bankerTotal'),
    playerTotal: $('#playerTotal'),
    payBanker: $('#payBanker'),
    payPlayer: $('#payPlayer'),
    payTie: $('#payTie'),
    payPP: $('#payPP'),
    payBP: $('#payBP'),
    payPB: $('#payPB'),
    payBB: $('#payBB'),
    payPerfect: $('#payPerfect'),
    payEither: $('#payEither'),
    roundClock: $('#roundClock'),
    clockNum: $('#clockNum'),
    handBadge: $('#handBadge'),
    winCelebrate: $('#winCelebrate'),
    wcRibbon: $('#wcRibbon'),
    wcSide: $('#wcSide'),
    wcAmount: $('#wcAmount'),
    stakeCell: $('#stakeCell'),
    lastWinCell: $('#lastWinCell'),
    lastWin: $('#lastWin'),
    statusBar: $('.statusbar'),
    statusBalance: $('#statusBalance'),
    statusLimit: $('#statusLimit'),
    dealerView: $('#dealerView'),
    dhLayer: $('#dhLayer'),
    matArea: $('#matArea'),
    matTip: $('#matTip'),
    shuffleVeil: $('#shuffleVeil'),
    roadEye: $('#roadEye'),
    roadSmall: $('#roadSmall'),
    roadCock: $('#roadCock'),
    tieRate: $('#tieRate'),
    predP: $('#predP'),
    predB: $('#predB'),
    bonusEmpty: $('#bonusEmpty'),
    squeezeHint: $('#squeezeHint'),
    revealAllBtn: $('#revealAllBtn'),
    lightningVeil: $('#lightningVeil'),
    result: $('#result'),
    resultKicker: $('#resultKicker'),
    resultTitle: $('#resultTitle'),
    resultMult: $('#resultMult'),
    resultAmount: $('#resultAmount'),
    resultRows: $('#resultRows'),
    resultClose: $('#resultClose'),
    statHands: $('#statHands'),
    statP: $('#statP'),
    statB: $('#statB'),
    statT: $('#statT'),
    statNet: $('#statNet'),
    pPairs: $('#pPairs'),
    bPairs: $('#bPairs'),
    bead: $('#bead'),
    bigroad: $('#bigroad'),
    roadTabs: $('#roadTabs'),
    roadCount: $('#roadCount'),
    historyList: $('#historyList'),
    toast: $('#toast'),
    modalBack: $('#modalBack'),
    modalClose: $('#modalClose'),
    modalBalance: $('#modalBalance'),
    modalRefill: $('#modalRefill'),
    modalReset: $('#modalReset'),
    optSound: $('#optSound'),
    optSqueeze: $('#optSqueeze'),
    optNoComm: $('#optNoComm'),
    optAutoRebet: $('#optAutoRebet'),
    modeVeil: $('#modeVeil'),
    mvIcon: $('#mvIcon'),
    mvName: $('#mvName'),
    feltMark: $('#feltMark'),
    liveMult: $('#liveMult'),
    feltStatus: $('#feltStatus'),
    brandGlyph: $('#brandGlyph'),
    accountBtn: $('#accountBtn'),
    avatar: $('#avatar'),
    accName: $('#accName'),
    logoutBtn: $('#logoutBtn'),
    authBack: $('#authBack'),
    authProfile: $('#authProfile'),
    apAvatar: $('#apAvatar'),
    apName: $('#apName'),
    apBalance: $('#apBalance'),
    apLogout: $('#apLogout'),
    apSwitch: $('#apSwitch'),
    authClose: $('#authClose'),
    authTabs: $('#authTabs'),
    authForm: $('#authForm'),
    authId: $('#authId'),
    authNick: $('#authNick'),
    authPin: $('#authPin'),
    authPin2: $('#authPin2'),
    authMsg: $('#authMsg'),
    authSubmit: $('#authSubmit'),
    guestBtn: $('#guestBtn'),
    nickFld: $('#nickFld'),
    pin2Fld: $('#pin2Fld'),
    pinBack: $('#pinBack'),
    pinPanel: $('.pin-panel'),
    pinClose: $('#pinClose'),
    pinDots: $('#pinDots'),
    pinMsg: $('#pinMsg'),
    keypad: $('#keypad'),
    adminBack: $('#adminBack'),
    adminClose: $('#adminClose'),
    admUsers: $('#admUsers'),
    admAmount: $('#admAmount'),
    ghRepo: $('#ghRepo'),
    ghPat: $('#ghPat'),
    ghTest: $('#ghTest'),
    ghPush: $('#ghPush'),
    ghPull: $('#ghPull'),
    ghStatus: $('#ghStatus'),
    splashEn: $('#splashEn'),
    splashKo: $('#splashKo'),
    splashArch: $('#splashArch'),
    splashTag: $('#splashTag'),
    flareSpark: $('#flareSpark'),
    celebrate: $('#celebrate'),
    celKicker: $('#celKicker'),
    celMult: $('#celMult'),
    celAmount: $('#celAmount'),
    dealer: $('#dealer'),
    fxLayer: $('#fxLayer')
  };

  let roadView = 'bead';
  /* Ask the road — 다음 판을 P/B로 가정한 미리보기 */
  let previewSide = null;
  let previewTimer = 0;
  let toastTimer = 0;
  let veilTimer = 0;

  /* ───────────── small helpers ───────────── */
  function toast(msg, ms = 2000) {
    el.toast.textContent = msg;
    el.toast.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('on'), ms);
  }

  function pulseNode(node) {
    if (!node) return;
    node.style.transition = 'none';
    node.style.transform = 'scale(1.045)';
    requestAnimationFrame(() => {
      node.style.transition = 'transform .28s cubic-bezier(.2,1.4,.4,1)';
      node.style.transform = '';
    });
  }

  function feeRate() { return MODES[S.mode].fee || 0; }
  function feeFor(amount) { return Math.round(amount * feeRate()); }
  function totalStake() {
    return Object.values(S.bets).reduce((a, b) => a + (b || 0), 0);
  }
  function totalFee() {
    return S.stack.reduce((a, e) => a + (e.fee || 0), 0);
  }

  /* ───────────── render: money & bets ───────────── */
  function renderBalance() {
    el.balance.textContent = compactNum(S.balance);
    el.balance.classList.toggle('is-compact', S.balance >= 100000000);
    if (el.statusBalance) el.statusBalance.textContent = '₩' + compactNum(S.balance);
    if (el.modalBalance) el.modalBalance.textContent = won(S.balance);
  }

  /** 금액에 해당하는 칩 톤 (가장 큰 액면 칩 색) */
  function chipToneOf(amount) {
    let tone = CHIPS[0];
    for (const c of CHIPS) { if (amount >= c) tone = c; }
    return 'tone-' + tone;
  }

  function renderBetState() {
    const stake = totalStake();
    const fee = totalFee();
    el.chipAmount.textContent = chipLabel(S.chip);
    $$('.chip', el.chipRow).forEach((c) => c.classList.toggle('is-active', Number(c.dataset.chip) === S.chip));

    el.totalStake.textContent = won(stake);
    el.totalFee.textContent = won(fee);
    el.totalDebit.textContent = won(stake + fee);
    el.feeRow.classList.toggle('is-off', feeRate() === 0);

    el.dealBtn.disabled = stake <= 0 || S.phase !== 'betting';
    el.dealAmount.textContent = stake > 0 ? won(stake) : '베팅하세요';
    el.undoBtn.disabled = S.stack.length === 0 || S.phase !== 'betting';
    el.clearBtn.disabled = stake === 0 || S.phase !== 'betting';
    el.rebetBtn.disabled = !S.lastBets || S.phase !== 'betting';

    for (const spot of Object.keys(S.bets)) {
      const chip = $(`.bet-chip[data-betchip="${spot}"]`);
      const amt = S.bets[spot];
      if (chip) {
        chip.className = 'bet-chip' + (amt > 0 ? ' on ' + chipToneOf(amt) : '');
        chip.innerHTML = amt ? chipInk(chipLabel(amt)) : '';
      }
      const spotEl = $(`[data-spot="${spot}"]`);
      if (spotEl) spotEl.classList.toggle('has-bet', amt > 0);
    }

    if (el.matTip) el.matTip.classList.toggle('on', stake > 0 && S.phase === 'betting');
  }

  function renderShoe() {
    const remaining = S.shoe.remaining;
    el.shoeCount.textContent = remaining;
    el.shoeInfo.textContent = `${remaining} / ${S.shoe.total}`;
    el.shoeBar.style.width = (S.shoe.progress * 100).toFixed(1) + '%';
    el.tableNote.textContent = `8덱 슈 · ${remaining}장 남음 · 14장 이하 자동 셔플`;
  }

  function renderStats() {
    const st = S.stats;
    const hist = S.history || [];
    // 출목표 통계는 현재 슈 기준 (Evolution 방식: #핸드 = P + B + T)
    const sp = hist.filter((h) => h.winner === 'player').length;
    const sb = hist.filter((h) => h.winner === 'banker').length;
    const stt = hist.filter((h) => h.winner === 'tie').length;
    el.statHands.textContent = hist.length;
    el.statP.textContent = sp;
    el.statB.textContent = sb;
    el.statT.textContent = stt;
    if (el.pPairs) el.pPairs.textContent = st.playerPair || 0;
    if (el.bPairs) el.bPairs.textContent = st.bankerPair || 0;
    if (el.statNet) {
      el.statNet.textContent = wonSign(st.profit || 0);
      el.statNet.classList.toggle('neg', (st.profit || 0) < 0);
    }
    renderPredict();
  }

  /* ───────────── prediction strip ───────────── */
  function renderPredict() {
    const hist = S.history;
    const n = hist.length;
    const ties = hist.filter((h) => h.winner === 'tie').length;
    if (el.tieRate) el.tieRate.textContent = (n ? Math.round((ties / n) * 100) : 0) + '%';
    [[el.predP, 'player'], [el.predB, 'banker']].forEach(([box, side]) => {
      if (!box) return;
      // 3개 예고 점 = 중국점 1·2·3군: 이 진영이 다음 판에 이겼다고 가정한 출목표의 마지막 마크 색
      // (1군 = 속 빈 링, 2군 = 속 찬 점, 3군 = 빗금 · 빨강 = r, 파랑 = b)
      const dr = E.derivedRoads(hist.concat([{ winner: side }]));
      const kinds = [dr.eye, dr.small, dr.cock].map((arr) => (arr.length ? arr[arr.length - 1].kind : null));
      Array.from(box.querySelectorAll('i')).forEach((dot, i) => {
        dot.classList.remove('win', 'lose', 'tie', 'on', 'k-r', 'k-b');
        const k = kinds[i];
        if (!k) return;
        dot.classList.add(k === 'r' ? 'k-r' : 'k-b');
      });
      box.classList.toggle('is-on', previewSide === side);
      box.setAttribute('aria-pressed', previewSide === side ? 'true' : 'false');
    });
  }

  /** P/B 예측 버튼 — 다음 칸 미리보기를 켜고 4초 뒤 자동 해제 */
  function setPreview(side) {
    previewSide = previewSide === side ? null : side;
    clearTimeout(previewTimer);
    previewTimer = 0;
    if (previewSide) {
      previewTimer = window.setTimeout(() => {
        previewSide = null;
        previewTimer = 0;
        renderRoads();
      }, 4000);
    }
    renderRoads();
    renderPredict();
    window.Sound && Sound.click();
    if (previewSide) {
      toast(previewSide === 'player' ? '다음 판 플레이어 가정 · 깜박이는 칸 미리보기' : '다음 판 뱅커 가정 · 깜박이는 칸 미리보기');
    }
  }

  /* ───────────── render: mode ───────────── */
  function applyModeCopy() {
    const cfg = MODES[S.mode];
    document.body.dataset.mode = S.mode;

    el.tableName.textContent = cfg.name;
    el.feltMark.textContent = cfg.icon;
    if (el.brandGlyph) el.brandGlyph.textContent = cfg.icon;

    if (S.mode === 'speed') {
      el.tableRule.textContent = '수수료 없음 · 타이 8:1 · 페어 11:1 · 0.35초 즉시 오픈';
    } else if (S.mode === 'sakura') {
      el.tableRule.textContent = '벚꽃 카드 7장 · 2x ~ 8x 중첩 · 수수료 없음';
      el.bonusIcon.textContent = '🌸';
      el.bonusTitle.textContent = '벚꽃 보너스';
      el.bonusNote.textContent = '딜 전 피어남';
    } else {
      el.tableRule.textContent = '눈꽃 카드 7장 · 2x ~ 8x 중첩 · 수수료 없음';
      el.bonusIcon.textContent = '❄️';
      el.bonusTitle.textContent = '눈꽃 보너스';
      el.bonusNote.textContent = '딜 전 결정';
    }

    el.bonusStrip.classList.toggle('is-sakura', S.mode === 'sakura');
    el.bonusStrip.classList.toggle('is-snow', S.mode === 'snow');
    el.bonusStrip.classList.toggle('is-speed', S.mode === 'speed');

    el.feeLabel.textContent = '수수료';

    const p = cfg.payouts;
    el.payBanker.textContent = p.banker.toFixed(2).replace(/0$/, '') + ':1';
    el.payPlayer.textContent = p.player + ':1';
    el.payTie.textContent = p.tie + ':1';
    el.payPP.textContent = p.playerPair + ':1';
    el.payBP.textContent = p.bankerPair + ':1';
    if (el.payPB) el.payPB.textContent = '1~' + p.playerBonus + ':1';
    if (el.payBB) el.payBB.textContent = '1~' + p.bankerBonus + ':1';
    if (el.payPerfect) el.payPerfect.textContent = `하나 ${p.perfectPair}:1 · 더블 ${cfg.perfectDouble}:1`;
    if (el.payEither) el.payEither.textContent = p.eitherPair + ':1';

    if (el.statusLimit) el.statusLimit.textContent = '₩1K–무제한';

    $$('.mode-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.mode === S.mode));
  }

  function setMode(mode, opts) {
    const options = opts || {};
    if (!MODES[mode] || mode === S.mode && !options.force) return;
    if (S.phase === 'dealing' || S.phase === 'reveal') {
      toast('핸드가 끝난 뒤 모드를 바꿀 수 있습니다');
      return;
    }
    refundAll(true);
    clearTimeout(resultHoldTimer);
    resultHoldTimer = 0;
    S.mode = mode;
    S.bonus = [];
    S.hand = null;
    S.phase = 'betting';
    applyModeCopy();
    clearTable();
    renderBonusEmpty();
    window.FX && FX.setMode(mode);
    if (!options.instant) flashModeVeil(mode);
    renderAll();
    startRoundClock(true);
    save();
  }

  function flashModeVeil(mode) {
    const cfg = MODES[mode];
    el.mvIcon.textContent = cfg.icon;
    el.mvName.textContent = cfg.name + ' 테이블';
    el.modeVeil.classList.add('on');
    clearTimeout(veilTimer);
    veilTimer = setTimeout(() => el.modeVeil.classList.remove('on'), 620);
  }

  /* ───────────── render: bonus slots ───────────── */
  function bonusCardEl(b) {
    const d = document.createElement('div');
    d.className = 'bonus-card';
    d.dataset.card = b.id;
    d.innerHTML = `<span class="bc-rank">${b.rank}</span><span class="bc-suit">${SYM[b.suit]}</span><span class="bc-mult">${b.multiplier}x</span>`;
    return d;
  }

  // five fixed upright gold slots; revealed bonus cards fill them in order
  function buildBonusSlots() {
    el.bonusCards.innerHTML = '';
    for (let i = 0; i < BONUS_SLOTS; i++) {
      const slot = document.createElement('div');
      slot.className = 'bs-slot';
      slot.innerHTML = '<span class="bs-slot-badge"></span><span class="bs-slot-face"></span>';
      el.bonusCards.appendChild(slot);
    }
    return $$('.bs-slot', el.bonusCards);
  }

  function fillBonusSlot(slot, b) {
    if (!slot) return null;
    slot.classList.add('is-filled');
    const badge = $('.bs-slot-badge', slot);
    if (badge) badge.textContent = b.multiplier + 'x';
    const card = bonusCardEl(b);
    card.classList.add('in');
    slot.appendChild(card);
    return card;
  }

  function renderBonusEmpty() {
    buildBonusSlots();
    if (S.mode === 'speed') { el.bonusCards.innerHTML = ''; return; }
    el.bonusNote.textContent = '딜 전 공개';
  }

  function renderBonusResult() {
    const slots = buildBonusSlots();
    S.bonus.forEach((b, i) => fillBonusSlot(slots[i], b));
    const max = S.bonus.reduce((m, b) => Math.max(m, b.multiplier), 1);
    el.bonusNote.textContent = S.bonus.length ? `${S.bonus.length}장 · 최대 ${max}x` : '딜 전 공개';
  }

  /* ───────────── cards ───────────── */
  function cardEl(card, up) {
    const red = card.suit === 'h' || card.suit === 'd';
    const d = document.createElement('div');
    d.className = 'card' + (up ? ' up' : '');
    d.dataset.card = card.id;
    d._card = card;
    d.addEventListener('click', (ev) => ev.stopPropagation());
    d.innerHTML =
      '<div class="card-inner">' +
        '<div class="card-face card-back"><span class="cb-mark"></span></div>' +
        '<div class="card-face card-front' + (red ? ' red' : '') + '">' +
          '<span class="c-rank">' + card.rank + '</span>' +
          '<span class="c-suit">' + SYM[card.suit] + '</span>' +
          '<span class="c-big">' + SYM[card.suit] + '</span>' +
          '<span class="c-rank br">' + card.rank + '</span>' +
        '</div>' +
      '</div>';
    return d;
  }

  function containerFor(side) {
    return side === 'player' ? el.playerCards : el.bankerCards;
  }

  /* ───────────── dealer motion · card flight ───────────── */
  function centerOf(node) {
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  }

  function armRest() {
    window.setTimeout(() => {
      if (el.dealer) el.dealer.classList.remove('is-deal-l', 'is-deal-r');
      const shoe = $('#shoeEl');
      if (shoe) shoe.classList.remove('is-dealing');
    }, 640);
  }

  // dealer reaches into the shoe, pulls a card and lays it on the felt spot
  const HAND_BOX = { w: 160, h: 260 };
  const HAND_ANCHOR = { x: 70, y: 26 }; // fingertip grip point inside the SVG box
  const motionLog = [];

  const HAND_BACK_SVG =
    '<svg class="dh-hand dh-hand-back" viewBox="0 0 160 260" aria-hidden="true">' +
      '<defs>' +
        '<linearGradient id="dhGlove" x1=".2" y1="0" x2=".8" y2="1">' +
          '<stop offset="0" stop-color="#FFFFFF"/><stop offset=".55" stop-color="#F3EBDE"/>' +
          '<stop offset="1" stop-color="#CBBBA2"/>' +
        '</linearGradient>' +
        '<linearGradient id="dhCuffG" x1="0" y1="0" x2="1" y2="1">' +
          '<stop offset="0" stop-color="#2C2F37"/><stop offset="1" stop-color="#08090C"/>' +
        '</linearGradient>' +
        '<linearGradient id="dhGoldG" x1="0" y1="0" x2="1" y2="1">' +
          '<stop offset="0" stop-color="#F9EBC6"/><stop offset="1" stop-color="#B08332"/>' +
        '</linearGradient>' +
      '</defs>' +
      '<path d="M62 136 L104 136 L124 246 Q126 256 116 256 L50 256 Q40 256 42 246 Z" fill="url(#dhCuffG)"/>' +
      '<path d="M63 137 L103 137" stroke="url(#dhGoldG)" stroke-width="4" stroke-linecap="round"/>' +
      '<path d="M52 84 Q52 58 82 56 Q112 58 112 88 L112 132 Q110 150 84 154 Q54 150 52 128 Z" fill="url(#dhGlove)" stroke="#C6B69C" stroke-width="1.3"/>' +
      '<path d="M58 120 Q40 120 32 100 Q26 86 37 80 Q48 76 55 90 L64 108 Z" fill="url(#dhGlove)" stroke="#C6B69C" stroke-width="1.3"/>' +
      '<path d="M60 86 Q82 74 106 86" stroke="#DFD2BB" stroke-width="2" fill="none"/>' +
      '<path d="M64 100 Q82 92 104 100" stroke="#E7DCC9" stroke-width="1.4" fill="none"/>' +
    '</svg>';

  const HAND_FRONT_SVG =
    '<svg class="dh-hand dh-hand-front" viewBox="0 0 160 260" aria-hidden="true">' +
      '<g fill="#FBF6EC" stroke="#C6B69C" stroke-width="1.3">' +
        '<rect x="47" y="20" width="15" height="68" rx="7.5" transform="rotate(-6 54 86)"/>' +
        '<rect x="62" y="10" width="15" height="78" rx="7.5"/>' +
        '<rect x="77" y="16" width="15" height="72" rx="7.5" transform="rotate(4 84 86)"/>' +
        '<rect x="92" y="34" width="13" height="54" rx="6.5" transform="rotate(9 98 86)"/>' +
      '</g>' +
      '<rect x="77" y="52" width="15" height="6" rx="3" fill="url(#dhGoldG)" transform="rotate(4 84 86)"/>' +
      '<path d="M50 30 Q53 24 57 30" stroke="#E2D6C1" stroke-width="1.2" fill="none"/>' +
      '<path d="M68 18 Q71 12 75 18" stroke="#E2D6C1" stroke-width="1.2" fill="none"/>' +
      '<path d="M85 24 Q88 18 92 24" stroke="#E2D6C1" stroke-width="1.2" fill="none"/>' +
      '<path d="M101 46 Q104 41 107 46" stroke="#E2D6C1" stroke-width="1.1" fill="none"/>' +
    '</svg>';

  function clearDealerHand() {
    if (!el.dhLayer) return;
    $$('.dh-grip', el.dhLayer).forEach((n) => n.remove());
  }

  async function dealerDraw(side, node, fast) {
    const shoe = $('#shoeEl');
    if (el.dealer) {
      el.dealer.classList.remove('is-deal-l', 'is-deal-r');
      void el.dealer.offsetWidth;
      el.dealer.classList.add(side === 'player' ? 'is-deal-l' : 'is-deal-r');
    }
    if (shoe) {
      shoe.classList.remove('is-dealing');
      void shoe.offsetWidth;
      shoe.classList.add('is-dealing');
    }
    armRest();

    const target = centerOf(node);
    const mouthEl = shoe && (shoe.querySelector('.sh-mouth') || shoe);
    const mouth = centerOf(mouthEl);
    const layer = el.dhLayer;
    if (!target || !mouth || !layer || window.__BACCARAT_FLY === false) return;
    if (!('animate' in Element.prototype)) return;

    // one hand at a time
    clearDealerHand();

    const lr = layer.getBoundingClientRect();
    const cardW = target.w;
    const cardH = target.h;
    const handW = Math.round(clamp(cardW * 2.15, 62, 132));
    const handH = Math.round(handW * (HAND_BOX.h / HAND_BOX.w));
    const ax = HAND_ANCHOR.x / HAND_BOX.w * handW;
    const ay = HAND_ANCHOR.y / HAND_BOX.h * handH;
    const cardOffY = cardH * 0.34; // card centre sits just below the fingertips

    const start = { x: mouth.x - lr.left - cardW * 0.30, y: mouth.y - lr.top - cardOffY };
    const end = { x: target.x - lr.left, y: target.y - lr.top - cardOffY };
    // 딜러 손은 테이블 뒤(위쪽)에서 내려와 슈에 닿은 뒤 카드를 집습니다
    const off = { x: start.x + cardW * 0.9 + 58, y: start.y - 130 };
    const approach = { x: start.x + cardW * 0.35 + 10, y: start.y - 74 };

    const grip = document.createElement('div');
    grip.className = 'dh-grip';
    grip.dataset.side = side;
    grip.style.width = '0px';
    grip.style.height = '0px';

    const card = document.createElement('div');
    card.className = 'dh-card';
    card.style.width = cardW + 'px';
    card.style.height = cardH + 'px';
    card.style.left = (-cardW / 2) + 'px';
    card.style.top = (-cardH * 0.16) + 'px';
    card.style.transformOrigin = '50% 34%';

    const pair = document.createElement('div');
    pair.className = 'dh-handpair';
    pair.style.transformOrigin = ax + 'px ' + ay + 'px';
    pair.innerHTML = HAND_BACK_SVG + HAND_FRONT_SVG;
    $$('.dh-hand', pair).forEach((svg) => {
      svg.style.width = handW + 'px';
      svg.style.height = handH + 'px';
      svg.style.left = (-ax) + 'px';
      svg.style.top = (-ay) + 'px';
    });

    grip.appendChild(card);
    grip.appendChild(pair);
    layer.appendChild(grip);

    const total = fast ? 300 : 440;
    const lift = Math.min(52, Math.abs(end.y - start.y) * 0.6 + 18);
    const midX = start.x + (end.x - start.x) * 0.5;
    const midY = Math.min(start.y, end.y) - lift;

    // 0~36% 접근 → 40% 슈에서 집기 → 70% 운반 → 92% 내려놓기
    const motion = grip.animate([
      { transform: `translate3d(${off.x}px, ${off.y}px, 0) scale(.8)`, opacity: 0, offset: 0 },
      { transform: `translate3d(${approach.x}px, ${approach.y}px, 0) scale(.98)`, opacity: 1, offset: .18 },
      { transform: `translate3d(${start.x + 4}px, ${start.y - 5}px, 0) scale(1)`, opacity: 1, offset: .32 },
      { transform: `translate3d(${start.x}px, ${start.y}px, 0) scale(1.02)`, opacity: 1, offset: .40 },
      { transform: `translate3d(${midX}px, ${midY}px, 0) scale(1.05)`, opacity: 1, offset: .70 },
      { transform: `translate3d(${end.x}px, ${end.y - 4}px, 0) scale(1.02)`, opacity: 1, offset: .92 },
      { transform: `translate3d(${end.x}px, ${end.y}px, 0) scale(1)`, opacity: 1, offset: 1 }
    ], { duration: total, easing: 'cubic-bezier(.32,.72,.3,1)', fill: 'forwards' });

    // 카드는 슈에서 집는 순간부터 보입니다
    card.animate([
      { opacity: 0, offset: 0 },
      { opacity: 0, offset: .37 },
      { opacity: 1, offset: .44 },
      { opacity: 1, offset: 1 }
    ], { duration: total, fill: 'forwards' });

    const tilt = pair.animate([
      { transform: 'rotate(-96deg)', offset: 0 },
      { transform: 'rotate(-92deg)', offset: .32 },
      { transform: 'rotate(-80deg)', offset: .42 },
      { transform: 'rotate(-58deg)', offset: .72 },
      { transform: 'rotate(-34deg)', offset: 1 }
    ], { duration: total, easing: 'cubic-bezier(.35,.7,.3,1)', fill: 'forwards' });

    // shoe mouth flashes as the card is pulled out
    if (mouthEl) {
      const spark = document.createElement('span');
      spark.className = 'dh-spark';
      spark.style.left = (mouth.x - lr.left) + 'px';
      spark.style.top = (mouth.y - lr.top) + 'px';
      layer.appendChild(spark);
      window.setTimeout(() => spark.remove(), 520);
    }

    motionLog.push({
      side,
      fast: !!fast,
      from: [Math.round(start.x), Math.round(start.y)],
      to: [Math.round(end.x), Math.round(end.y)],
      ms: total,
      hand: true
    });
    if (motionLog.length > 16) motionLog.shift();

    try { await motion.finished; } catch (err) { /* cancelled */ }

    // card lands: the real card takes over while the hand withdraws
    node.classList.remove('is-pending');
    node.classList.add('landed');
    try {
      grip.animate([
        { opacity: 1 },
        { opacity: 0 }
      ], { duration: 130, easing: 'ease-out', fill: 'forwards' });
      pair.animate([
        { transform: 'rotate(-38deg)' },
        { transform: 'rotate(-16deg) translate3d(12px, -8px, 0)' }
      ], { duration: 150, easing: 'ease-out', fill: 'forwards' });
      card.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 90, fill: 'forwards' });
    } catch (err) { /* older browsers */ }
    window.setTimeout(() => grip.remove(), 170);
    try { await tilt.finished; } catch (err) { /* cancelled */ }
  }

  // golden light beam from a bonus slot to the matched table card
  function beamToCard(slot, card, mult) {
    if (!el.fxLayer || !slot || !card) return;
    const a = centerOf(slot);
    const b = centerOf(card);
    if (!a || !b) return;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx) * 180 / Math.PI;

    const beam = document.createElement('div');
    beam.className = 'beam';
    beam.style.left = a.x + 'px';
    beam.style.top = a.y + 'px';
    beam.style.width = len + 'px';
    beam.style.transform = `rotate(${ang}deg)`;
    el.fxLayer.appendChild(beam);
    window.setTimeout(() => beam.remove(), 900);

    const wave = document.createElement('div');
    wave.className = 'shockwave';
    wave.style.left = b.x + 'px';
    wave.style.top = b.y + 'px';
    el.fxLayer.appendChild(wave);
    window.setTimeout(() => wave.remove(), 820);

    for (let i = 0; i < 7; i++) {
      const sp = document.createElement('div');
      sp.className = 'gold-spark';
      sp.style.left = b.x + 'px';
      sp.style.top = b.y + 'px';
      const ang2 = (Math.PI * 2 * i) / 7 + Math.random() * .6;
      const dist = 26 + Math.random() * 44;
      sp.style.setProperty('--gx', Math.cos(ang2) * dist + 'px');
      sp.style.setProperty('--gy', Math.sin(ang2) * dist - 12 + 'px');
      sp.style.animationDelay = (Math.random() * .08) + 's';
      el.fxLayer.appendChild(sp);
      window.setTimeout(() => sp.remove(), 1100);
    }

    // multiplier badge pops on the slot side too
    const badge = slot.querySelector('.bs-slot-badge');
    if (badge && mult) {
      badge.animate([
        { transform: 'translateX(-50%) scale(.6)', opacity: .3 },
        { transform: 'translateX(-50%) scale(1.25)', opacity: 1, offset: .55 },
        { transform: 'translateX(-50%) scale(1)', opacity: 1 }
      ], { duration: 460, easing: 'cubic-bezier(.2,1.5,.4,1)' });
    }
  }

  function clearTable() {
    clearDealerHand();
    el.playerCards.innerHTML = '';
    el.bankerCards.innerHTML = '';
    if (el.playerTotal) el.playerTotal.innerHTML = '<i>0</i>';
    if (el.bankerTotal) el.bankerTotal.innerHTML = '<i>0</i>';
    if (el.feltStatus) el.feltStatus.textContent = 'PLACE YOUR BETS';
    for (const b of [el.playerTotal, el.bankerTotal]) {
      if (b) b.classList.remove('is-win', 'is-scored');
    }
    if (el.handBadge) {
      el.handBadge.className = 'hand-badge';
      el.handBadge.textContent = '';
    }
    renderMiniCards();
    el.squeezeHint.classList.remove('on');
    el.result.classList.remove('on');
    clearTimeout(resultTimer);
    // 테이블을 비울 때 진행 중인 쪼기 대기가 남아 있으면 풀어줍니다 (멈춤 방지)
    if (squeezeWait) {
      const fn = squeezeWait.resolve;
      squeezeWait = null;
      fn();
    }
    if (el.liveMult) el.liveMult.innerHTML = '';
    liveSig = '';
  }

  function revealedCards(side) {
    const box = containerFor(side);
    return $$('.card.up', box).map((c) => c._card);
  }

  /* 미니 카드: 베팅 매트의 플레이어/뱅커 칸에 실시간으로 같이 보임 */
  function renderMiniCards() {
    for (const side of ['player', 'banker']) {
      const box = $(`[data-mini="${side}"]`);
      if (!box) continue;
      const nodes = $$('.card', containerFor(side));
      const prev = box.childElementCount;
      box.innerHTML = '';
      nodes.forEach((node, i) => {
        const card = node._card;
        if (!card) return;
        const d = document.createElement('span');
        const up = node.classList.contains('up');
        if (!up) {
          d.className = 'mini-card back';
        } else {
          const red = card.suit === 'h' || card.suit === 'd';
          d.className = 'mini-card' + (red ? ' red' : '');
          d.innerHTML = `<b>${card.rank}</b><i>${SYM[card.suit]}</i>`;
        }
        if (i < prev) d.style.animation = 'none';
        box.appendChild(d);
      });
    }
  }

  function updateTotals() {
    for (const side of ['player', 'banker']) {
      const cards = revealedCards(side);
      const badge = side === 'player' ? el.playerTotal : el.bankerTotal;
      if (!badge) continue;
      const total = cards.length ? E.handTotal(cards) : 0;
      const shown = badge.textContent.trim();
      if (!cards.length) badge.innerHTML = '<i>0</i>';
      else badge.textContent = total;
      // 0 = 반투명 회색, 점수가 나면 선명한 파랑/빨강 (영상과 동일)
      badge.classList.toggle('is-scored', cards.length > 0 && total > 0);
      // 카드가 놓이는 그 순간 눈에 보이게: 숫자가 바뀔 때마다 배지가 톡 튄다
      if (cards.length && shown !== String(total)) {
        badge.classList.remove('is-tick');
        void badge.offsetWidth;
        badge.classList.add('is-tick');
      }
    }
    renderMiniCards();
  }

  function allUp() {
    const all = $$('.card', el.playerCards).concat($$('.card', el.bankerCards));
    return all.length > 0 && all.every((c) => c.classList.contains('up'));
  }

  function makePeekable(cardNode) {
    cardNode.classList.add('peekable');
    cardNode.addEventListener('click', (ev) => {
      ev.stopPropagation();
      revealCard(cardNode);
    });
  }

  function revealCard(node) {
    if (!node || node.classList.contains('up')) return;
    node.classList.remove('peekable');
    node.classList.add('up');
    try {
      window.Sound && Sound.flip();
      updateTotals();
      if (node._card) sparkIfHit(node, node._card);
      updateLiveMults();
    } finally {
      // 어떤 이유로 갱신이 실패해도 쪼기 대기는 반드시 풀립니다
      checkSqueezeWait();
    }
  }

  function checkSqueezeWait() {
    if (!squeezeWait) return;
    if (squeezeWait.els.every((n) => n.classList.contains('up'))) {
      const fn = squeezeWait.resolve;
      squeezeWait = null;
      fn();
    }
  }

  async function waitAllUp(nodes, timeoutMs) {
    if (!nodes.length) return Promise.resolve();
    if (nodes.every((n) => n.classList.contains('up'))) return Promise.resolve();
    return new Promise((resolve) => {
      squeezeWait = { els: nodes, resolve };
      if (timeoutMs) {
        window.setTimeout(() => {
          if (!squeezeWait || squeezeWait.els !== nodes) return;
          nodes.forEach((n) => {
            try { if (!n.classList.contains('up')) revealCard(n); } catch (err) { /* ignore */ }
          });
          // 카드 공개가 중간에 실패해도 라운드가 멈추지 않도록 대기를 확실히 풉니다
          if (squeezeWait && squeezeWait.els === nodes) {
            const fn = squeezeWait.resolve;
            squeezeWait = null;
            fn();
          }
        }, timeoutMs);
      }
    });
  }

  /* ───────────── betting ───────────── */
  function placeBet(spot, amount) {
    if (!(spot in S.bets)) return false;
    if (S.phase !== 'betting') { toast('핸드 진행 중에는 베팅할 수 없습니다'); return false; }
    const amt = Math.max(0, Math.round(amount));
    if (!amt) return false;
    const fee = feeFor(amt);
    if (amt + fee > S.balance) {
      toast('가상 머니가 부족합니다 · 충전을 눌러주세요');
      pulseNode($('#balancePill'));
      return false;
    }
    S.balance -= amt + fee;
    S.bets[spot] += amt;
    S.stack.push({ spot, amount: amt, fee });
    window.Sound && Sound.chip();
    renderBalance();
    renderBetState();
    save();
    return true;
  }

  function refundAll(silent) {
    if (!S.stack.length && totalStake() === 0) {
      S.bets = emptyBets();
      return;
    }
    for (const e of S.stack) {
      if (e.kind === 'move') continue;
      S.balance += e.amount + e.fee;
      S.bets[e.spot] = Math.max(0, (S.bets[e.spot] || 0) - e.amount);
    }
    S.stack = [];
    S.bets = emptyBets();
    if (!silent) {
      renderBalance();
      renderBetState();
      save();
    }
  }

  function undo() {
    if (S.phase !== 'betting') return;
    const last = S.stack.pop();
    if (!last) { toast('되돌릴 베팅이 없습니다'); return; }
    if (last.kind === 'move') {
      S.bets[last.to] = Math.max(0, (S.bets[last.to] || 0) - last.amount);
      S.bets[last.from] = (S.bets[last.from] || 0) + last.amount;
      window.Sound && Sound.click();
      renderBetState();
      save();
      toast('베팅 이동을 되돌렸습니다');
      return;
    }
    S.bets[last.spot] = Math.max(0, S.bets[last.spot] - last.amount);
    S.balance += last.amount + last.fee;
    window.Sound && Sound.click();
    renderBalance();
    renderBetState();
    save();
  }

  /** 베팅 금액을 다른 칸으로 통째로 옮깁니다 (잔액 변화 없음, 실행 취소 가능). */
  function moveBet(from, to) {
    if (S.phase !== 'betting') { toast('핸드 진행 중에는 옮길 수 없습니다'); return false; }
    if (!(from in S.bets) || !(to in S.bets) || from === to) return false;
    const amount = S.bets[from] || 0;
    if (!amount) { toast('옮길 베팅이 없습니다'); return false; }
    S.bets[from] = 0;
    S.bets[to] = (S.bets[to] || 0) + amount;
    S.stack.push({ kind: 'move', from, to, amount, fee: 0 });
    window.Sound && Sound.chip();
    renderBetState();
    save();
    toast(`${SPOT_LABEL[from]} → ${SPOT_LABEL[to]} · ${won(amount)} 이동`);
    return true;
  }

  function clearBets() {
    if (S.phase !== 'betting') return;
    if (!S.stack.length) { toast('베팅이 없습니다'); return; }
    refundAll();
    window.Sound && Sound.click();
    toast('베팅을 초기화했습니다');
  }

  function rebet() {
    if (S.phase !== 'betting') return;
    if (!S.lastBets) { toast('재베팅할 내역이 없습니다'); return; }
    refundAll(true);
    let placed = 0;
    for (const spot of Object.keys(S.lastBets)) {
      const amt = S.lastBets[spot];
      if (!amt) continue;
      const fee = feeFor(amt);
      if (amt + fee > S.balance) continue;
      S.balance -= amt + fee;
      S.bets[spot] = amt;
      S.stack.push({ spot, amount: amt, fee });
      placed++;
    }
    window.Sound && Sound.chip();
    renderBalance();
    renderBetState();
    save();
    if (!placed) toast('가상 머니가 부족합니다');
    else toast('지난 베팅을 다시 걸었습니다');
  }

  /** 칩 한 장의 상한 = 보유 잔액 (테이블 베팅 한도 없음) */
  function chipCeil() {
    return Math.max(MIN_CHIP, Math.floor(S.balance / 1000) * 1000);
  }

  function setChip(v) {
    S.chip = clamp(Math.round(v / 1000) * 1000, MIN_CHIP, chipCeil());
    window.Sound && Sound.click();
    renderBetState();
    save();
  }

  function refill(amount) {
    S.balance += amount || START_BALANCE;
    pulseNode($('#balancePill'));
    window.Sound && Sound.chip();
    renderBalance();
    renderBetState();
    save();
  }

  /* ───────────── bonus round ───────────── */
  function bonusCardSound(mode, i) {
    if (!window.Sound) return;
    if (mode === 'sakura') Sound.sakura();
    else if (mode === 'snow') Sound.frost();
    else Sound.speed();
  }

  async function bonusRound(cfg) {
    const cards = E.createBonusCards(cfg.bonus);
    boostBonusCards(cards, cfg);
    S.bonus = cards;
    const slots = buildBonusSlots();
    el.bonusNote.textContent = '공개 중…';

    const veil = el.lightningVeil;
    veil.classList.add('on');
    if (cfg.id === 'sakura') {
      window.Sound && Sound.sakura();
    } else {
      window.Sound && Sound.frost();
    }
    if (window.FX) FX.burst();
    await sleep(420);

    const nodes = cards.map((b, i) => {
      const node = fillBonusSlot(slots[i], b);
      if (!node) return null;
      node.style.transition = 'none';
      node.style.opacity = '0';
      node.style.transform = 'scale(.62) rotate(-8deg)';
      return node;
    }).filter(Boolean);

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      await sleep(i === 0 ? 60 : 150);
      node.style.transition = 'transform .44s cubic-bezier(.16,1,.3,1), opacity .3s';
      node.style.opacity = '1';
      node.style.transform = 'none';
      bonusCardSound(cfg.id, i);
      if (window.FX) FX.burst();
      // gold shockwave on the freshly opened slot
      const slotEl = node.closest('.bs-slot');
      const pt = centerOf(slotEl);
      if (pt && el.fxLayer) {
        const wave = document.createElement('div');
        wave.className = 'shockwave';
        wave.style.left = pt.x + 'px';
        wave.style.top = pt.y + 'px';
        el.fxLayer.appendChild(wave);
        window.setTimeout(() => wave.remove(), 820);
      }
    }
    veil.classList.remove('on');

    const max = cards.reduce((m, b) => Math.max(m, b.multiplier), 1);
    el.bonusNote.textContent = `${cards.length}장 · 최대 ×${max}`;
    await sleep(160);
  }

  /**
   * 배당 매칭이 가끔만 붙도록, 아주 낮은 확률(약 12%)로 다음 카드 중 한 장과 같은
   * 보너스 카드를 섞습니다. 게임 규칙(랭크+무늬 일치)은 그대로이고 히트 빈도만 살짝 보정합니다.
   */
  function boostBonusCards(cards, cfg) {
    if (!cards || !cards.length || !cfg || !cfg.bonus) return;
    if (S.shoe.cards.length < 8) return;
    if (Math.random() > 0.12) return;
    const peek = S.shoe.cards.slice(-6);
    if (!peek.length) return;
    const pick = peek[Math.floor(Math.random() * peek.length)];
    if (!pick || cards.some((c) => c.id === pick.id)) return;
    const idx = Math.floor(Math.random() * cards.length);
    cards[idx] = {
      rank: pick.rank,
      suit: pick.suit,
      id: pick.id,
      multiplier: E.pickMultiplier(cfg.bonus.multipliers)
    };
  }

  /* ───────────── deal ───────────── */
  function sequenceOf(result) {
    const seq = [];
    seq.push({ side: 'player', card: result.playerCards[0] });
    seq.push({ side: 'banker', card: result.bankerCards[0] });
    seq.push({ side: 'player', card: result.playerCards[1] });
    seq.push({ side: 'banker', card: result.bankerCards[1] });
    if (result.playerCards[2]) seq.push({ side: 'player', card: result.playerCards[2] });
    if (result.bankerCards[2]) seq.push({ side: 'banker', card: result.bankerCards[2] });
    return seq;
  }

  async function deal(opts) {
    const auto = !!(opts && opts.auto);
    if (S.phase !== 'betting') return;
    const stakeIn = totalStake();
    if (!auto && stakeIn <= 0) { toast('먼저 베팅하세요'); return; }

    S.phase = 'dealing';
    clockLeft = CLOCK_SECONDS;
    clearInterval(clockTimer);
    paintClock();
    if (previewSide) {
      previewSide = null;
      clearTimeout(previewTimer);
      previewTimer = 0;
      renderRoads();
    }
    if (stakeIn > 0) S.lastBets = Object.assign(emptyBets(), S.bets);
    S.stack = [];
    S.bonus = [];
    S.hand = null;
    clearTable();
    if (el.dealerView) el.dealerView.classList.add('is-focus');
    if (el.feltStatus) el.feltStatus.textContent = 'NO MORE BETS · DEALING';
    renderBetState();
    renderBonusEmpty();
    el.result.classList.remove('on');
    clearTimeout(resultTimer);

    const cfg = MODES[S.mode];
    const fast = cfg.id === 'speed';

    if (S.shoe.needsShuffle()) {
      S.shuffling = true;
      S.shoe.reshuffle();
      renderShoe();
      if (el.shuffleVeil) el.shuffleVeil.classList.add('on');
      toast('새 슈 · 셔플 후 새 출목표로 시작합니다');
      window.Sound && Sound.card();
      await sleep(fast ? 340 : 950);
      if (el.shuffleVeil) el.shuffleVeil.classList.remove('on');
      // 8덱 슈 종료 → 새 슈. 출목표는 새로 시작하고 누적 통계는 유지합니다.
      S.history.length = 0;
      S.shoeNo = (S.shoeNo || 1) + 1;
      renderRoads();
      renderStats();
      renderHistory();
      save();
      S.shuffling = false;
    }

    // bonus round (blossom / snowflake)
    if (cfg.bonus) await bonusRound(cfg);

    const result = E.dealHand(S.shoe);
    S.hand = result;
    renderShoe();

    const squeeze = !!S.settings.squeeze && !fast;
    const seq = sequenceOf(result);
    const first = seq.slice(0, 4);
    const thirds = seq.slice(4);
    const firstNodes = [];

    for (const step of first) {
      const node = cardEl(step.card, false);
      node.classList.add('is-pending');
      containerFor(step.side).appendChild(node);
      firstNodes.push(node);
      await dealerDraw(step.side, node, fast);
      node.classList.remove('is-pending');
      node.classList.add('landed');
      window.Sound && Sound.card();
      renderMiniCards();

      if (squeeze) {
        makePeekable(node);
      } else {
        await sleep(fast ? 22 : 100);
        node.classList.add('up');
        window.Sound && Sound.flip();
        updateTotals();
        sparkIfHit(node, step.card);
        updateLiveMults();
      }
      await sleep(fast ? 40 : 110);
    }

    if (squeeze) {
      S.phase = 'reveal';
      paintClock();
      el.squeezeHint.classList.add('on');
      updateTotals();
      await waitAllUp(firstNodes, SQUEEZE_TIMEOUT);
      el.squeezeHint.classList.remove('on');
      if (S.phase !== 'reveal') return; // 테이블이 정리되면 이 라운드는 중단
    }

    // third cards
    const thirdNodes = [];
    for (const step of thirds) {
      const node = cardEl(step.card, false);
      node.classList.add('is-pending');
      containerFor(step.side).appendChild(node);
      thirdNodes.push(node);
      await dealerDraw(step.side, node, fast);
      node.classList.remove('is-pending');
      node.classList.add('landed');
      window.Sound && Sound.card();
      renderMiniCards();

      if (squeeze) {
        makePeekable(node);
      } else {
        await sleep(fast ? 22 : 100);
        node.classList.add('up');
        window.Sound && Sound.flip();
        updateTotals();
        sparkIfHit(node, step.card);
        updateLiveMults();
      }
      await sleep(fast ? 40 : 110);
    }

    if (squeeze && thirdNodes.length) {
      S.phase = 'reveal';
      paintClock();
      el.squeezeHint.classList.add('on');
      await waitAllUp(thirdNodes, SQUEEZE_TIMEOUT);
      el.squeezeHint.classList.remove('on');
      if (S.phase !== 'reveal') return; // 테이블이 정리되면 이 라운드는 중단
    }

    // reveal everything (non-squeeze already up)
    $$('.card', el.felt).forEach((c) => {
      if (!c.classList.contains('up')) {
        c.classList.add('up');
        c.classList.remove('peekable');
      }
    });
    updateTotals();

    if (fast) {
      await sleep(90);
    } else {
      await sleep(160);
    }

    finishHand();
  }

  function revealAll() {
    $$('.card.peekable', el.felt).forEach((n) => revealCard(n));
  }

  /* ───────────── settle ───────────── */
  function markHits(settled) {
    for (const item of settled.items) {
      if (!item.hits || !item.hits.length) continue;
      if (item.outcome !== 'win') continue;
      const box = item.spot === 'player' ? el.playerCards : item.spot === 'banker' ? el.bankerCards : null;
      const ids = item.hits.map((h) => h.id);
      if (box) {
        $$('.card', box).forEach((c) => {
          if (ids.indexOf(c.dataset.card) >= 0) c.classList.add('is-hit');
        });
      } else if (item.spot === 'tie') {
        $$('.card', el.felt).forEach((c) => {
          if (ids.indexOf(c.dataset.card) >= 0) c.classList.add('is-hit');
        });
      }
      $$('.bonus-card', el.bonusCards).forEach((c) => {
        if (ids.indexOf(c.dataset.card) >= 0) {
          c.classList.add('is-hit');
          const slot = c.closest('.bs-slot');
          if (slot) slot.classList.add('is-hit');
        }
      });
    }
  }

  /* ───────────── live multipliers & celebration ───────────── */
  let liveSig = '';

  function sparkIfHit(node, card) {
    if (!S.bonus || !S.bonus.length) return;
    const hit = S.bonus.find((b) => b.id === card.id);
    if (!hit) return;
    node.classList.add('is-hit');
    node.classList.remove('is-spark');
    void node.offsetWidth;
    node.classList.add('is-spark');
    window.setTimeout(() => node.classList.remove('is-spark'), 620);

    // glowing gold multiplier badge floats directly above the matched card
    if (!node.querySelector('.card-mult')) {
      const badge = document.createElement('span');
      badge.className = 'card-mult';
      badge.textContent = hit.multiplier + 'x';
      node.appendChild(badge);
    }

    if (window.Sound) Sound.zap([2, 3, 4, 5, 8].indexOf(hit.multiplier));
    const bc = el.bonusCards.querySelector(`.bonus-card[data-card="${card.id}"]`);
    if (bc) {
      bc.classList.add('is-hit');
      const slot = bc.closest('.bs-slot');
      if (slot) slot.classList.add('is-hit');
      beamToCard(slot, node, hit.multiplier);
    }
    const sideZone = node.closest('#playerCards') ? 'player' : node.closest('#bankerCards') ? 'banker' : null;
    if (sideZone) fallOnZone(sideZone);
  }

  function updateLiveMults() {
    if (!el.liveMult) return;
    if (!S.bonus || !S.bonus.length) { el.liveMult.innerHTML = ''; liveSig = ''; return; }
    const pCards = revealedCards('player');
    const bCards = revealedCards('banker');
    if (!pCards.length && !bCards.length) { el.liveMult.innerHTML = ''; liveSig = ''; return; }

    const chips = [];
    const pm = E.multiplierFor(pCards, S.bonus);
    const bm = E.multiplierFor(bCards, S.bonus);
    if (pm.multiplier > 1) chips.push({ key: 'p' + pm.multiplier, cls: 'p', label: '플레이어', mult: pm.multiplier });
    if (bm.multiplier > 1) chips.push({ key: 'b' + bm.multiplier, cls: 'b', label: '뱅커', mult: bm.multiplier });

    const pPair = pCards.length >= 2 && pCards[0].rank === pCards[1].rank;
    const bPair = bCards.length >= 2 && bCards[0].rank === bCards[1].rank;
    if (pPair) {
      const m = E.multiplierFor(pCards.slice(0, 2), S.bonus).multiplier;
      if (m > 1) chips.push({ key: 'pp' + m, cls: 'pair', label: 'P페어', mult: m });
    }
    if (bPair) {
      const m = E.multiplierFor(bCards.slice(0, 2), S.bonus).multiplier;
      if (m > 1) chips.push({ key: 'bp' + m, cls: 'pair', label: 'B페어', mult: m });
    }

    const sig = chips.map((c) => c.key).join('|');
    if (sig === liveSig) return;
    liveSig = sig;
    el.liveMult.innerHTML = chips.map((c) =>
      `<span class="lm-chip ${c.cls}">⚡ <span class="lmk">${c.label}</span> ×${c.mult}</span>`
    ).join('');
  }

  /* ───────────── 보너스 배당 낙화 (벚꽃잎 · 눈송이) ───────────── */
  function petalsOn() {
    return S.mode === 'sakura' ? ['🌸', '🌸', '❀', '🌸'] : S.mode === 'snow' ? ['❄', '❅', '❆', '❄'] : null;
  }

  function spawnFall(layer, n, spread) {
    const glyphs = petalsOn();
    if (!glyphs || !layer) return;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < n; i++) {
      const s = document.createElement('span');
      s.className = 'zf';
      s.textContent = glyphs[i % glyphs.length];
      s.style.setProperty('--x', (5 + Math.random() * 90).toFixed(1) + '%');
      s.style.setProperty('--sz', (7 + Math.random() * (spread ? 9 : 7)).toFixed(1) + 'px');
      s.style.setProperty('--d', (1.05 + Math.random() * 0.9).toFixed(2) + 's');
      s.style.setProperty('--dl', (Math.random() * 0.65).toFixed(2) + 's');
      s.style.setProperty('--sw', (Math.random() * 26 - 13).toFixed(1) + 'px');
      s.style.setProperty('--rot', (80 + Math.random() * 220).toFixed(0) + 'deg');
      frag.appendChild(s);
    }
    layer.innerHTML = '';
    layer.appendChild(frag);
    clearTimeout(layer._t);
    layer._t = window.setTimeout(() => { layer.innerHTML = ''; }, 2800);
  }

  /** 베팅 칸 위로 낙화 */
  function fallOnZone(spot) {
    if (!petalsOn() || !S.bonus || !S.bonus.length) return;
    const zone = document.querySelector(`[data-spot="${spot}"]`);
    if (!zone) return;
    let layer = $('.zone-fall', zone);
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'zone-fall';
      zone.appendChild(layer);
    }
    spawnFall(layer, 9, false);
  }

  /** 당첨 배너·결과 시트 위로 낙화 */
  function fallOnPanel(panel, n) {
    if (!petalsOn() || !panel) return;
    let layer = $('.fx-fall', panel);
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'fx-fall';
      panel.appendChild(layer);
    }
    spawnFall(layer, n, true);
  }

  function celebrate(settled) {
    if (!el.celebrate) return;
    if (!(settled.bestMultiplier > 1) || settled.net <= 0) return;
    const cfg = MODES[S.mode];
    el.celKicker.textContent = cfg.icon + ' ' + (S.mode === 'sakura' ? 'BLOSSOM BONUS WIN' : S.mode === 'snow' ? 'FROST BONUS WIN' : 'SPEED WIN');
    el.celMult.textContent = '×' + settled.bestMultiplier;
    el.celAmount.textContent = wonSign(settled.net);
    el.celebrate.classList.add('on');
    if (window.FX) FX.burst();
    fallOnPanel(el.celebrate, 22);
    clearTimeout(celebTimer);
    celebTimer = window.setTimeout(() => el.celebrate.classList.remove('on'), 2800);
  }

  function finishHand() {
    if (!S.hand) return;
    const result = S.hand;
    const settled = E.settleRound({
      bets: S.bets,
      result,
      mode: S.mode,
      noCommission: S.settings.noCommission,
      bonus: S.bonus
    });

    S.balance += settled.returned;

    const st = S.stats;
    st.hands += 1;
    st[result.winner] += 1;
    if (result.playerPair) st.playerPair += 1;
    if (result.bankerPair) st.bankerPair += 1;
    st.wagered += settled.staked;
    st.profit += settled.net;

    S.history.push({
      winner: result.winner,
      p: result.playerTotal,
      b: result.bankerTotal,
      pp: result.playerPair,
      bp: result.bankerPair,
      mult: settled.bestMultiplier,
      ts: Date.now()
    });
    if (S.history.length > 240) S.history.shift();

    markHits(settled);

    // 승리한 쪽 점수 배지 강조 + 중앙 P/B/T 결과 배지
    for (const side of ['player', 'banker']) {
      const badge = side === 'player' ? el.playerTotal : el.bankerTotal;
      if (badge) badge.classList.toggle('is-win', result.winner === side);
    }
    if (el.handBadge) {
      const letter = result.winner === 'player' ? 'P' : result.winner === 'banker' ? 'B' : 'T';
      const label = result.winner === 'player' ? 'PLAYER WIN' : result.winner === 'banker' ? 'BANKER WIN' : 'TIE';
      el.handBadge.className = 'hand-badge';
      el.handBadge.textContent = '';
      const lb = document.createElement('b');
      lb.className = 'hb-letter';
      lb.textContent = letter;
      const tg = document.createElement('span');
      tg.className = 'hb-label';
      tg.textContent = label;
      el.handBadge.appendChild(lb);
      el.handBadge.appendChild(tg);
      el.handBadge.setAttribute('aria-label', label);
      void el.handBadge.offsetWidth;
      el.handBadge.className = 'hand-badge on ' + letter.toLowerCase();
    }
    if (el.dealerView) el.dealerView.classList.remove('is-focus');
    renderMiniCards();

    const betSpots = Object.keys(S.bets).filter((k) => S.bets[k] > 0);
    const hadBets = betSpots.length > 0;
    S.bets = emptyBets();
    S.stack = [];
    S.phase = 'result';
    if (el.feltStatus) el.feltStatus.textContent = 'RESULT';

    renderBalance();
    renderStats();
    renderRoads();
    renderHistory();
    renderBetState();
    renderShoe();
    save();

    // sound (관전만 한 라운드는 조용히)
    if (window.Sound && hadBets) {
      if (settled.net > 0) {
        if (settled.bestMultiplier >= 4) Sound.bigWin();
        else Sound.win();
      } else if (settled.net < 0) {
        Sound.lose();
      } else if (settled.returned > 0 || settled.staked > 0) {
        Sound.push();
      }
    }

    // 결과 시트(#result)는 띄우지 않습니다 — 당첨은 테이블 위 리본 연출로만 보여 줍니다.
    // 잃은 라운드는 가운데 승리 배지(P/B/T)만 보여주고 조용히 다음 라운드로 넘어갑니다.
    el.result.classList.remove('on');
    clearTimeout(resultTimer);
    const isWin = hadBets && settled.net > 0 && settled.returned > 0;
    if (hadBets) celebrate(settled);
    updateLiveMults();

    // 보너스 배당이 붙은 베팅 칸에는 벚꽃/눈꽃을 뿌린다
    for (const item of settled.items) {
      if (item.outcome === 'win' && item.multiplier > 1) fallOnZone(item.spot);
    }

    holdResult(isWin, settled);
    // 칩·상태바 렌더가 끝난 뒤 당첨 연출을 얹는다
    if (isWin) showWin(settled, result, betSpots);
    else hideWin();
  }

  /* ───────────── result hold → clean table → new 10s round ───────────── */
  function holdResult(showSheet, settled) {
    clearTimeout(resultHoldTimer);
    const cfg = MODES[S.mode];
    const bigWin = !!(settled && settled.bestMultiplier > 1 && settled.net > 0);
    const base = showSheet ? (RESULT_HOLD_MS[cfg.id] || 2600) : 1400;
    resultHoldTimer = window.setTimeout(endResultHold, base + (bigWin ? 1200 : 0));
    if (el.feltStatus) el.feltStatus.textContent = bigWin ? 'BONUS HIT' : 'RESULT';
    renderBetState();
    paintClock();
  }

  /** 결과 표시 종료: 테이블을 깨끗하게 비우고 새 라운드 10초 카운트다운 시작 */
  function endResultHold() {
    clearTimeout(resultHoldTimer);
    resultHoldTimer = 0;
    if (S.phase !== 'result') return;
    el.result.classList.remove('on');
    clearTimeout(resultTimer);
    hideWin();
    clearTable();
    if (el.feltStatus) el.feltStatus.textContent = 'PLACE YOUR BETS';
    S.phase = 'betting';
    clockLeft = CLOCK_SECONDS;
    startRoundClock(true);
    renderBetState();
    scheduleAutoRebet();
  }

  /** 스피드 테이블 자동 재베팅 — 새 라운드가 시작된 뒤 지난 베팅을 다시 건다 */
  function scheduleAutoRebet() {
    if (MODES[S.mode].id !== 'speed' || !S.settings.autoRebet) return;
    const prev = S.lastBets;
    if (!prev || !Object.values(prev).some((v) => v > 0)) return;
    clearTimeout(S.autoTimer);
    S.autoTimer = setTimeout(() => {
      if (S.phase !== 'betting' || totalStake() > 0) return;
      for (const spot of Object.keys(prev)) {
        const amt = prev[spot];
        if (!amt) continue;
        const fee = feeFor(amt);
        if (amt + fee > S.balance) return;
        S.balance -= amt + fee;
        S.bets[spot] = amt;
        S.stack.push({ spot, amount: amt, fee });
      }
      toast('자동 재베팅 준비');
      renderBalance();
      renderBetState();
      save();
    }, 500);
  }

  /* ───────────── 당첨 연출 (IMG_1308) ─────────────
     테이블 상단을 가로지르는 리본(승리 진영) → '이겼습니다' → 금빛 당첨 금액.
     결과 시트(#result) 대신 이 연출만 쓰고, 당첨 칸 칩은 금액대 색으로 빛난다. */
  let winTimer = 0;

  function showWin(settled, result, betSpots) {
    const payout = Math.round(settled.returned || 0);
    if (!(payout > 0) || !(settled.net > 0)) { hideWin(); return; }
    const side = result.winner;
    const label = side === 'player' ? '플레이어' : side === 'banker' ? '뱅커' : '무';
    if (el.wcSide) el.wcSide.textContent = label;
    if (el.wcRibbon) {
      el.wcRibbon.className = 'wc-ribbon ' +
        (side === 'player' ? 'is-p' : side === 'banker' ? 'is-b' : 'is-t');
    }
    if (el.wcAmount) el.wcAmount.textContent = Math.round(payout).toLocaleString('ko-KR');
    if (el.winCelebrate) {
      el.winCelebrate.classList.remove('on');
      void el.winCelebrate.offsetWidth;
      el.winCelebrate.classList.add('on');
      el.winCelebrate.setAttribute('aria-hidden', 'false');
    }
    if (el.dealerView) el.dealerView.classList.add('is-winning');
    // 하단 정보 바: 총 베팅금 자리에 '지난 우승 ₩…' (금색)
    if (el.lastWin) el.lastWin.textContent = won(payout);
    if (el.lastWinCell) el.lastWinCell.hidden = false;
    if (el.stakeCell) el.stakeCell.hidden = true;
    if (el.statusBar) el.statusBar.classList.add('is-winline');
    // 당첨된 베팅 칸: 당첨 금액대의 칩 색으로 빛나며 '97k+' 표기
    for (const item of settled.items) {
      if (item.outcome !== 'win' || !(item.returned > 0)) continue;
      const chip = $(`.bet-chip[data-betchip="${item.spot}"]`);
      if (!chip) continue;
      chip.className = 'bet-chip on is-win ' + chipToneOf(item.returned);
      chip.innerHTML = chipInk(winChipLabel(item.returned));
    }
    if (window.FX) FX.burst();
    fallOnPanel(el.winCelebrate, settled.bestMultiplier > 1 ? 18 : 8);
    clearTimeout(winTimer);
    winTimer = window.setTimeout(hideWin, 2800);
  }

  function hideWin() {
    clearTimeout(winTimer);
    winTimer = 0;
    if (el.winCelebrate) {
      el.winCelebrate.classList.remove('on');
      el.winCelebrate.setAttribute('aria-hidden', 'true');
    }
    if (el.dealerView) el.dealerView.classList.remove('is-winning');
    if (el.stakeCell) el.stakeCell.hidden = false;
    if (el.lastWinCell) el.lastWinCell.hidden = true;
    if (el.statusBar) el.statusBar.classList.remove('is-winline');
    $$('.bet-chip.is-win').forEach((c) => c.classList.remove('is-win'));
  }

  function showResult(settled, result, betSpots) {
    const cfg = MODES[S.mode];
    const winnerName = result.winner === 'player' ? '플레이어 승리' : result.winner === 'banker' ? '뱅커 승리' : '타이';
    el.resultKicker.textContent = `${cfg.name} · ${result.playerTotal} : ${result.bankerTotal}${result.natural ? ' · 내추럴' : ''}`;
    el.resultTitle.textContent = winnerName;

    if (settled.bestMultiplier > 1) {
      el.resultMult.textContent = `${cfg.icon} ×${settled.bestMultiplier} ${S.mode === 'sakura' ? 'BLOSSOM' : S.mode === 'snow' ? 'FROST' : 'SPEED'} WIN!`;
      el.resultMult.classList.add('on');
    } else {
      el.resultMult.classList.remove('on');
    }

    el.resultAmount.textContent = settled.net === 0 ? '±₩0' : wonSign(settled.net);
    el.resultAmount.className = 'result-amount' + (settled.net > 0 ? '' : settled.net < 0 ? ' lose' : ' push');

    el.resultRows.innerHTML = '';
    if (!settled.items.length) {
      el.resultRows.innerHTML = '<div class="result-row"><span>베팅 없음</span><b>—</b></div>';
    }
    for (const item of settled.items) {
      const row = document.createElement('div');
      const cls = item.outcome === 'win' ? 'win' : item.outcome === 'push' ? '' : 'lose';
      row.className = 'result-row ' + cls;
      const outcomeTxt = item.outcome === 'win' ? '승리' : item.outcome === 'push' ? '푸시' : '패배';
      const multTxt = item.multiplier > 1 ? ` · ×${item.multiplier}` : '';
      row.innerHTML = `<span>${SPOT_LABEL[item.spot]} ${won(item.stake)}<span class="rom"> · ${outcomeTxt}${multTxt}</span></span>` +
        `<b>${item.outcome === 'win' ? '+' + won(item.returned) : item.outcome === 'push' ? won(item.returned) : won(0)}</b>`;
      el.resultRows.appendChild(row);
    }

    const bigWin = settled.bestMultiplier > 1 && settled.net > 0;
    clearTimeout(resultTimer);
    // the big-win celebration (fixed overlay) plays above the result card,
    // so the card can be mounted immediately and stay until the round closes.
    el.result.classList.add('on');
    el.result.classList.toggle('is-big', bigWin);
    if (bigWin) fallOnPanel(el.result, 14);

    if (settled.net > 0) pulseNode($('#balancePill'));
  }

  /* ───────────── roads (Evolution 화이트 출목표) ───────────── */
  function renderRoads() {
    const hist = S.history;
    if (el.roadCount) el.roadCount.textContent = hist.length;

    // ── 비드로드 (우측 6행 · 큰 솔리드 원 + 굵은 흰색 글씨 · 최신 열만 선명)
    el.bead.innerHTML = '';
    const ROWS = 6;
    const beadW = el.bead.clientWidth || 58;
    const beadCols = clamp(Math.floor(beadW / 22), 2, 5);
    const beadHist = hist.slice(-beadCols * ROWS);
    const beadUsed = Math.max(1, Math.min(beadCols, Math.ceil(beadHist.length / ROWS)));
    el.bead.style.gridTemplateColumns = `repeat(${beadCols}, minmax(0, 1fr))`;
    const beadFrag = document.createDocumentFragment();
    for (let r = 1; r <= ROWS; r++) {
      for (let c = 1; c <= beadCols; c++) {
        // 최신 판이 왼쪽(빅로드 옆) 열에서부터 채워진다 — 영상과 같은 순서
        const colFromNewest = beadUsed - c;
        const h = colFromNewest >= 0 ? beadHist[colFromNewest * ROWS + (r - 1)] : null;
        const d = document.createElement('div');
        const cls = !h ? '' : h.winner === 'player' ? 'p' : h.winner === 'banker' ? 'b' : 't';
        d.className = 'bead-cell' + (cls ? ' ' + cls : '');
        if (c > 1) d.classList.add('is-past');
        d.style.gridColumn = String(c);
        d.style.gridRow = String(r);
        if (h) {
          const badge = document.createElement('span');
          badge.className = 'bch';
          badge.textContent = h.winner === 'player' ? 'P' : h.winner === 'banker' ? 'B' : 'T';
          d.appendChild(badge);
        }
        beadFrag.appendChild(d);
      }
    }
    el.bead.appendChild(beadFrag);

    // ── 빅로드 (6행 · 빈 셀까지 격자 전체)
    el.bigroad.innerHTML = '';
    const cells = [];
    let last = null;
    for (const h of hist) {
      if (h.winner === 'tie') {
        if (last) last.ties = (last.ties || 0) + 1;
        continue;
      }
      let pos;
      if (!last) pos = { c: 0, r: 0 };
      else if (h.winner === last.winner) {
        pos = last.r < 5 ? { c: last.c, r: last.r + 1 } : { c: last.c + 1, r: last.r, tail: true };
      } else {
        pos = { c: last.c + 1, r: 0 };
      }
      last = { c: pos.c, r: pos.r, winner: h.winner, pp: h.pp, bp: h.bp, ties: 0, tail: !!pos.tail };
      cells.push(last);
    }

    // Ask the road: next-round preview cell
    let previewCell = null;
    if (previewSide) {
      const lastReal = cells[cells.length - 1];
      let pos;
      if (!lastReal) pos = { c: 0, r: 0 };
      else if (previewSide === lastReal.winner) {
        pos = lastReal.r < 5 ? { c: lastReal.c, r: lastReal.r + 1 } : { c: lastReal.c + 1, r: lastReal.r };
      } else {
        pos = { c: lastReal.c + 1, r: 0 };
      }
      previewCell = { c: pos.c, r: pos.r, winner: previewSide, preview: true };
    }

    const allCells = previewCell ? cells.concat([previewCell]) : cells;
    const visible = allCells.slice(-140);
    const maxC = visible.reduce((m, c) => Math.max(m, c.c), 0);
    const boardW = el.bigroad.clientWidth || 320;
    const boardH = el.bigroad.clientHeight || 90;
    // 정사각 칸: 행 높이(6행)를 한 칸 크기로 삼아 열 수를 정한다 (영상처럼 동그란 링)
    const COLS = clamp(Math.floor(boardW / Math.max(11, boardH / 6)), 9, 40);
    const off = Math.max(0, maxC - (COLS - 1));
    const marks = new Map();
    for (const cell of visible) {
      if (cell.c < off) continue;
      marks.set((cell.c - off) + ':' + (cell.r + 1), cell);
    }
    el.bigroad.style.gridTemplateColumns = `repeat(${COLS}, minmax(0, 1fr))`;

    const frag = document.createDocumentFragment();
    for (let r = 1; r <= 6; r++) {
      for (let c = 1; c <= COLS; c++) {
        const cell = marks.get((c - 1) + ':' + r);
        const d = document.createElement('div');
        d.className = 'br-cell' + (cell ? (cell.winner === 'player' ? ' p' : ' b') : '');
        d.style.gridColumn = String(c);
        d.style.gridRow = String(r);
        if (cell && cell.preview) {
          d.classList.add('is-preview');
          d.dataset.pv = cell.winner === 'player' ? 'P' : 'B';
        }
        if (cell && !cell.preview) {
          // 글자 없는 굵은 속 빈 링 (파랑 = 플레이어 · 빨강 = 뱅커)
          const rim = document.createElement('span');
          rim.className = 'rim';
          d.appendChild(rim);
          if (cell.ties) {
            const s = document.createElement('span');
            s.className = 'slash';
            s.style.opacity = String(Math.min(1, 0.75 + cell.ties * 0.15));
            d.appendChild(s);
          }
          if (cell.pp) {
            const dot = document.createElement('span');
            dot.className = 'pd pp';
            d.appendChild(dot);
          }
          if (cell.bp) {
            const dot = document.createElement('span');
            dot.className = 'pd bp';
            d.appendChild(dot);
          }
        }
        frag.appendChild(d);
      }
    }
    el.bigroad.appendChild(frag);

    // ── 중국점 1·2·3군 (미리보기 중에는 다음 판을 가정한 출목표)
    const baseDerived = E.derivedRoads(hist);
    const derived = previewSide ? E.derivedRoads(hist.concat([{ winner: previewSide }])) : baseDerived;
    // 새 마크가 실제로 생긴 도로만 그 마지막 칸을 깜빡인다
    const lastMark = (key) => (previewSide && derived[key].length > baseDerived[key].length
      ? derived[key][derived[key].length - 1] : null);
    paintMiniRoad(el.roadEye, derived.eye, lastMark('eye'));
    paintMiniRoad(el.roadSmall, derived.small, lastMark('small'));
    paintMiniRoad(el.roadCock, derived.cock, lastMark('cock'));
  }

  function paintMiniRoad(box, marks, pvMark) {
    if (!box) return;
    box.innerHTML = '';
    const boxW = box.clientWidth || 90;
    const boxH = box.clientHeight || 46;
    // 칸 크기 = 빅로드 칸의 절반 남짓 (6행 높이에 맞춰) → 모바일에 걱 16~20열
    const cell = Math.max(5, Math.min(9, (boxH / 6) * 0.8));
    const COLS = Math.max(6, Math.min(40, Math.floor(boxW / cell)));
    box.style.gridTemplateColumns = `repeat(${COLS}, minmax(0, 1fr))`;
    const maxC = marks && marks.length ? marks.reduce((m, k) => Math.max(m, k.c), 0) : 0;
    // 새 마크가 생겨도 오른쪽 끝을 넘지 않고 최신 열이 항상 보이게 민다
    const off = Math.max(0, maxC - (COLS - 1));
    const put = new Map();
    (marks || []).forEach((k) => {
      if (k.c < off) return;
      put.set((k.c - off) + ':' + (k.r + 1), k);
    });
    const frag = document.createDocumentFragment();
    for (let r = 1; r <= 6; r++) {
      for (let c = 1; c <= COLS; c++) {
        const k = put.get((c - 1) + ':' + r);
        const d = document.createElement('div');
        d.className = 'mr-cell' + (k ? ' mr-dot ' + k.kind : '');
        d.style.gridColumn = String(c);
        d.style.gridRow = String(r);
        if (k && k === pvMark) d.classList.add('is-preview');
        if (k) d.appendChild(document.createElement('i'));
        frag.appendChild(d);
      }
    }
    box.appendChild(frag);
  }

  function renderHistory() {
    if (!el.historyList) return;
    el.historyList.innerHTML = '';
    if (!S.history.length) {
      el.historyList.innerHTML = '<span class="hist-empty">아직 기록이 없습니다</span>';
      return;
    }
    const recent = S.history.slice(-14).reverse();
    for (const h of recent) {
      const d = document.createElement('div');
      const cls = h.winner === 'player' ? 'p' : h.winner === 'banker' ? 'b' : 't';
      d.className = 'hist-item ' + cls;
      d.innerHTML = `<span class="hv"></span>${h.winner === 'player' ? 'P' : h.winner === 'banker' ? 'B' : 'T'} ${h.p}·${h.b}` +
        (h.mult > 1 ? `<span class="hm">×${h.mult}</span>` : '');
      el.historyList.appendChild(d);
    }
  }

  function renderAll() {
    renderBalance();
    renderBetState();
    renderShoe();
    renderStats();
    renderRoads();
    renderHistory();
    applyModeCopy();
    renderBonusEmpty();
    renderMiniCards();
    if (S.bonus && S.bonus.length) renderBonusResult();
  }

  /* ───────────── sound button ───────────── */
  const ICON_SOUND_ON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.2L12 5.5v13L7.2 14.5H4z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
  const ICON_SOUND_OFF =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.2L12 5.5v13L7.2 14.5H4z" fill="currentColor"/><path d="M15.5 9.5l5 5m0-5l-5 5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';

  function renderSoundBtn() {
    el.soundBtn.innerHTML = S.settings.sound ? ICON_SOUND_ON : ICON_SOUND_OFF;
    el.soundBtn.style.color = S.settings.sound ? '#CFE3EE' : '#5D7686';
    el.optSound.checked = S.settings.sound;
  }

  function applySound() {
    window.Sound && Sound.setMuted(!S.settings.sound);
    renderSoundBtn();
  }

  /* ───────────── modal ───────────── */
  let resetArmed = false;
  let resetTimer = 0;

  function openModal() {
    el.modalBack.hidden = false;
    el.modalBack.style.pointerEvents = 'auto';
    document.body.classList.add('is-locked');
    el.modalBalance.textContent = won(S.balance);
    el.optSound.checked = S.settings.sound;
    el.optSqueeze.checked = S.settings.squeeze;
    el.optNoComm.checked = S.settings.noCommission;
    el.optAutoRebet.checked = S.settings.autoRebet;
    paintClock();
    if (window.Sound) Sound.click();
  }

  function closeModal() {
    el.modalBack.hidden = true;
    document.body.classList.remove('is-locked');
    paintClock();
  }

  /* ───────────── splash ───────────── */
  function runSplash() {
    renderSplash();
    const started = performance.now();
    const dur = 1400;
    let done = false;

    function finish() {
      if (done) return;
      done = true;
      el.splash.classList.add('is-done');
      document.body.classList.remove('is-locked');
      window.setTimeout(() => {
        if (el.splash && el.splash.parentNode) el.splash.parentNode.removeChild(el.splash);
        window.__SPLASH_DONE__ = true;
      }, 430);
    }

    function tick(now) {
      const k = Math.min(1, (now - started) / dur);
      if (el.splashFill) el.splashFill.style.width = (k * 100).toFixed(0) + '%';
      if (el.flareSpark) el.flareSpark.style.left = (k * 100).toFixed(1) + '%';
      if (k < 1) requestAnimationFrame(tick);
      else window.setTimeout(finish, 110);
    }

    requestAnimationFrame(tick);
    window.setTimeout(finish, 2100);
  }

  /* ───────────── round clock · 라이브 테이블 자동 진행 ───────────── */
  const BONUS_SLOTS = 7;
  const CLOCK_SECONDS = 10;
  const SQUEEZE_TIMEOUT = 20000;
  /** 정산 후 결과를 보여주는 시간(이후 테이블을 비우고 새 10초 카운트다운 시작) */
  const RESULT_HOLD_MS = { speed: 2300, sakura: 2700, snow: 2700 };
  let resultHoldTimer = 0;
  let clockLeft = CLOCK_SECONDS;
  let clockTimer = 0;

  /** 모달·셔플·백그라운드 탭 등에서는 자동 진행을 멈춥니다. */
  function tablePaused() {
    if (document.hidden) return true;
    if (S.shuffling) return true;
    return [el.modalBack, el.authBack, el.pinBack, el.adminBack].some((b) => b && !b.hidden);
  }

  function paintClock() {
    if (!el.roundClock) return;
    const k = clamp(clockLeft / CLOCK_SECONDS, 0, 1);
    el.roundClock.style.setProperty('--deg', (k * 360).toFixed(1) + 'deg');
    const betting = S.phase === 'betting';
    if (el.clockNum) el.clockNum.textContent = betting ? String(Math.max(0, clockLeft)) : '·';
    el.roundClock.classList.toggle('is-warm', betting && clockLeft <= 5 && clockLeft > 3);
    el.roundClock.classList.toggle('is-urgent', betting && clockLeft <= 3);
    el.roundClock.classList.toggle('is-idle', !betting || tablePaused());
    el.roundClock.setAttribute('aria-label',
      betting ? `베팅 마감까지 ${Math.max(0, clockLeft)}초` : '베팅 마감');
  }

  function startRoundClock(reset) {
    if (reset) clockLeft = CLOCK_SECONDS;
    clearInterval(clockTimer);
    paintClock();
    clockTimer = setInterval(tickClock, 1000);
  }

  function tickClock() {
    if (S.phase !== 'betting') { paintClock(); return; }
    if (tablePaused()) { paintClock(); return; }
    if (clockLeft <= 0) { autoDeal(); return; }
    clockLeft -= 1;
    paintClock();
    if (clockLeft <= 0) autoDeal();
  }

  /** 카운트다운 0 → 베팅 마감 · 카드 딜링 · 정산 · 다음 라운드 (관전만 해도 반복) */
  function autoDeal() {
    if (S.phase !== 'betting' || tablePaused() || S.autoDealing) return;
    S.autoDealing = true;
    Promise.resolve(deal({ auto: true })).finally(() => { S.autoDealing = false; });
  }

  /* ───────────── betting mat: tap · drag · long-press move ───────────── */
  const MOVE_HOLD = 380;
  let moveState = null;
  let ghostEl = null;
  let suppressTap = false;
  /** 마지막으로 포인터 탭을 처리한 시각 — 직후에 오는 합성 click을 무시해 이중 베팅을 막습니다 */
  let lastPointerTap = 0;

  function zoneAtPoint(x, y) {
    const node = document.elementFromPoint(x, y);
    const zone = node && node.closest ? node.closest('[data-spot]') : null;
    return zone ? zone.dataset.spot : null;
  }

  function ensureGhost(label) {
    if (!ghostEl) {
      ghostEl = document.createElement('div');
      ghostEl.className = 'drag-chip';
      document.body.appendChild(ghostEl);
    }
    ghostEl.innerHTML = label ? chipInk(label) : '';
    return ghostEl;
  }

  function removeGhost() {
    if (ghostEl) { ghostEl.remove(); ghostEl = null; }
  }

  function clearZoneMarks() {
    $$('.mat-zone').forEach((z) => z.classList.remove('is-move-src', 'is-move-ok', 'is-drop'));
  }

  function bindZones() {
    $$('[data-spot]').forEach((zone) => {
      const spot = zone.dataset.spot;

      zone.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          placeBet(spot, S.chip);
        }
      });

      zone.addEventListener('pointerdown', (ev) => {
        if (ev.button != null && ev.button > 0) return;
        if (S.phase !== 'betting') return;
        moveState = { spot, zone, x: ev.clientX, y: ev.clientY, moved: false, hold: false, id: ev.pointerId };
        try { zone.setPointerCapture(ev.pointerId); } catch (err) { /* older browsers */ }
        moveState.timer = setTimeout(() => {
          if (!moveState || moveState.moved) return;
          moveState.hold = true;
          if ((S.bets[spot] || 0) > 0) {
            zone.classList.add('is-move-src');
            $$('.mat-zone').forEach((z) => { if (z !== zone) z.classList.add('is-move-ok'); });
            if (navigator.vibrate) { try { navigator.vibrate(12); } catch (err) { /* ignore */ } }
            toast('이동할 칸을 눌러주세요');
            window.Sound && Sound.click();
          } else {
            toast('이 칸에는 베팅이 없습니다');
          }
        }, MOVE_HOLD);
      });

      zone.addEventListener('pointermove', (ev) => {
        if (!moveState || moveState.id !== ev.pointerId) return;
        const dx = ev.clientX - moveState.x;
        const dy = ev.clientY - moveState.y;
        if (!moveState.moved && Math.hypot(dx, dy) > 9) {
          moveState.moved = true;
          clearTimeout(moveState.timer);
          const amount = S.bets[spot] || 0;
          if (amount > 0) {
            zone.classList.add('is-move-src');
            const g = ensureGhost(chipLabel(amount));
            g.style.left = ev.clientX + 'px';
            g.style.top = ev.clientY + 'px';
          }
        }
        if (moveState.moved && ghostEl) {
          ghostEl.style.left = ev.clientX + 'px';
          ghostEl.style.top = ev.clientY + 'px';
          const over = zoneAtPoint(ev.clientX, ev.clientY);
          $$('.mat-zone').forEach((z) => {
            z.classList.toggle('is-drop', !!over && over !== spot && z.dataset.spot === over);
          });
        }
      });

      const finish = (ev, cancelled) => {
        if (!moveState || moveState.id !== ev.pointerId) return;
        const ms = moveState;
        moveState = null;
        clearTimeout(ms.timer);
        const dragged = ms.moved;
        const held = ms.hold;
        const drop = cancelled ? null : zoneAtPoint(ev.clientX, ev.clientY);
        removeGhost();
        clearZoneMarks();

        if (dragged || held) {
          suppressTap = true;
          setTimeout(() => { suppressTap = false; }, 420);
          if (drop && drop !== ms.spot) moveBet(ms.spot, drop);
          else toast('이동을 취소했습니다');
          return;
        }
        if (cancelled) return;
        placeBet(ms.spot, S.chip);
        lastPointerTap = Date.now();
      };

      zone.addEventListener('pointerup', (ev) => finish(ev, false));
      zone.addEventListener('pointercancel', (ev) => finish(ev, true));

      // 키보드·프로그램 호출용 폴백. 실제 포인터 탭은 pointerup에서 이미 베팅했으므로
      // 그 직후 브라우저가 합성하는 click은 무시합니다(모바일 이중 베팅 방지).
      zone.addEventListener('click', (ev) => {
        ev.preventDefault();
        if (suppressTap) return;
        if (Date.now() - lastPointerTap < 700) return;
        if (ev.detail > 0 && ev.sourceCapabilities && ev.sourceCapabilities.firesTouchEvents) return;
        placeBet(spot, S.chip);
      });
    });
  }

  /* ───────────── events ───────────── */
  function bind() {
    // Mode switching
    el.modeSwitch.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.mode-btn');
      if (!btn) return;
      setMode(btn.dataset.mode);
    });

    // Betting spots — tap to bet, drag / long-press to move the stake
    bindZones();
    const mat = el.matArea || $('.betting-mats, .betting-mat');
    if (mat) mat.addEventListener('contextmenu', (ev) => ev.preventDefault());

    // Chips
    el.chipRow.addEventListener('click', (ev) => {
      const chip = ev.target.closest('.chip');
      if (!chip) return;
      setChip(Number(chip.dataset.chip));
    });

    el.halfBtn.addEventListener('click', () => setChip(Math.max(MIN_CHIP, S.chip / 2)));
    el.doubleBtn.addEventListener('click', () => setChip(S.chip * 2));

    el.rebetBtn.addEventListener('click', rebet);
    el.clearBtn.addEventListener('click', clearBets);
    el.undoBtn.addEventListener('click', undo);
    el.dealBtn.addEventListener('click', deal);

    el.refillBtn.addEventListener('click', () => {
      refill(START_BALANCE);
      toast('가상 머니 +' + won(START_BALANCE) + ' 충전');
    });

    if (el.reshuffleBtn) {
      el.reshuffleBtn.addEventListener('click', () => {
        if (S.phase !== 'betting') { toast('핸드 중에는 셔플할 수 없습니다'); return; }
        S.shoe.reshuffle();
        renderShoe();
        window.Sound && Sound.card();
        toast('슈를 새로 셔플했습니다 · 416장');
      });
    }

    $('#shoeEl') && $('#shoeEl').addEventListener('click', () => {
      if (S.phase !== 'betting') return;
      S.shoe.reshuffle();
      renderShoe();
      window.Sound && Sound.card();
      toast('슈를 새로 셔플했습니다 · 416장');
    });

    el.revealAllBtn.addEventListener('click', revealAll);

    // 출목표 보조 로드 접기
    const roadToggle = $('#roadToggle');
    if (roadToggle) {
      roadToggle.addEventListener('click', () => {
        const board = document.querySelector('.roadboard');
        if (!board) return;
        const min = board.classList.toggle('is-min');
        roadToggle.setAttribute('aria-expanded', String(!min));
        window.Sound && Sound.click();
      });
    }

    el.soundBtn.addEventListener('click', () => {
      S.settings.sound = !S.settings.sound;
      applySound();
      if (S.settings.sound) window.Sound && Sound.click();
      save();
    });

    el.infoBtn.addEventListener('click', openModal);
    el.modalClose.addEventListener('click', closeModal);
    el.modalBack.addEventListener('click', (ev) => {
      if (ev.target === el.modalBack) closeModal();
    });

    el.optSound.addEventListener('change', () => {
      S.settings.sound = el.optSound.checked;
      applySound();
      save();
    });
    el.optSqueeze.addEventListener('change', () => {
      S.settings.squeeze = el.optSqueeze.checked;
      if (S.settings.squeeze && S.mode === 'speed') toast('스피드 테이블은 항상 즉시 오픈입니다');
      save();
    });
    el.optNoComm.addEventListener('change', () => {
      S.settings.noCommission = el.optNoComm.checked;
      save();
    });
    el.optAutoRebet.addEventListener('change', () => {
      S.settings.autoRebet = el.optAutoRebet.checked;
      save();
    });

    el.modalRefill.addEventListener('click', () => {
      refill(START_BALANCE);
      el.modalBalance.textContent = won(S.balance);
      toast('가상 머니 +' + won(START_BALANCE));
    });

    el.modalReset.addEventListener('click', () => {
      if (!resetArmed) {
        resetArmed = true;
        el.modalReset.textContent = '한 번 더 누르면 초기화';
        clearTimeout(resetTimer);
        resetTimer = setTimeout(() => {
          resetArmed = false;
          el.modalReset.textContent = '잔액 초기화';
        }, 3000);
        return;
      }
      resetArmed = false;
      clearTimeout(resetTimer);
      el.modalReset.textContent = '잔액 초기화';
      refundAll(true);
      clearTimeout(resultHoldTimer);
      resultHoldTimer = 0;
      S.balance = START_BALANCE;
      S.stats = { hands: 0, player: 0, banker: 0, tie: 0, playerPair: 0, bankerPair: 0, wagered: 0, profit: 0 };
      S.history = [];
      S.lastBets = null;
      S.bonus = [];
      S.hand = null;
      S.phase = 'betting';
      S.shoe = new E.Shoe(8);
      clearTable();
      renderBonusEmpty();
      renderAll();
      renderSoundBtn();
      el.modalBalance.textContent = won(S.balance);
      startRoundClock(true);
      save();
      toast('가상 머니와 기록을 초기화했습니다');
    });

    el.resultClose.addEventListener('click', () => {
      el.result.classList.remove('on');
      clearTimeout(resultTimer);
      if (S.phase === 'result') endResultHold();
    });

    if (el.predP) el.predP.addEventListener('click', (ev) => { ev.preventDefault(); setPreview('player'); });
    if (el.predB) el.predB.addEventListener('click', (ev) => { ev.preventDefault(); setPreview('banker'); });

    if (el.roadTabs) {
      el.roadTabs.addEventListener('click', (ev) => {
        const tab = ev.target.closest('.road-tab');
        if (!tab) return;
        roadView = tab.dataset.road;
        $$('.road-tab', el.roadTabs).forEach((t) => t.classList.toggle('is-active', t === tab));
        el.bead.hidden = roadView !== 'bead';
        el.bigroad.hidden = roadView !== 'big';
        window.Sound && Sound.click();
      });
    }

    // ── account / auth
    el.accountBtn.addEventListener('click', () => openAuth(DB.current ? 'account' : 'login'));
    el.logoutBtn.addEventListener('click', (ev) => { ev.stopPropagation(); logout(); });
    el.authClose.addEventListener('click', closeAuth);
    el.authBack.addEventListener('click', (ev) => { if (ev.target === el.authBack) closeAuth(); });
    el.authTabs.addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-auth]');
      if (b) setAuthMode(b.dataset.auth);
    });
    el.authForm.addEventListener('submit', submitAuth);
    el.guestBtn.addEventListener('click', closeAuth);
    el.apLogout.addEventListener('click', logout);
    el.apSwitch.addEventListener('click', () => setAuthMode('login'));

    // ── hidden admin
    const brand = $('#brand');
    if (brand) {
      brand.addEventListener('click', (ev) => { ev.preventDefault(); });
      brand.addEventListener('dblclick', (ev) => { ev.preventDefault(); openPin(); });
      let lastTap = 0;
      brand.addEventListener('pointerup', () => {
        const now = Date.now();
        if (now - lastTap < 360) openPin();
        lastTap = now;
      });
    }
    el.pinClose.addEventListener('click', closePin);
    el.pinBack.addEventListener('click', (ev) => { if (ev.target === el.pinBack) closePin(); });
    el.keypad.addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-key]');
      if (b) pressKey(b.dataset.key);
    });

    el.adminClose.addEventListener('click', closeAdmin);
    el.adminBack.addEventListener('click', (ev) => { if (ev.target === el.adminBack) closeAdmin(); });
    el.admUsers.addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-op]');
      if (!b) return;
      const row = b.closest('.adm-user');
      if (!row) return;
      adjustUser(row.dataset.uid, b.dataset.op);
    });
    $$('.adm-presets button').forEach((b) => {
      b.addEventListener('click', () => {
        const preset = b.dataset.preset;
        if (preset === 'reset') {
          adjustUser(DB.current || 'guest', 'reset');
          return;
        }
        const val = Number(preset) || 0;
        el.admAmount.value = String(Math.abs(val));
        adjustUser(DB.current || 'guest', val >= 0 ? 'plus' : 'minus', Math.abs(val));
      });
    });
    el.ghTest.addEventListener('click', ghTest);
    el.ghPush.addEventListener('click', ghPush);
    el.ghPull.addEventListener('click', ghPull);

    // Unlock audio on first gesture
    const unlock = () => { window.Sound && Sound.unlock(); window.removeEventListener('pointerdown', unlock); };
    window.addEventListener('pointerdown', unlock, { once: true });

    // ── 더블탭·핀치 확대 방지 (상단 로고 더블탭 6160 은 그대로 동작)
    document.addEventListener('dblclick', (ev) => { ev.preventDefault(); }, { passive: false });
    document.addEventListener('gesturestart', (ev) => { ev.preventDefault(); });
    document.addEventListener('gesturechange', (ev) => { ev.preventDefault(); });
    const blockPinch = (ev) => { if (ev.touches && ev.touches.length > 1) ev.preventDefault(); };
    document.addEventListener('touchstart', blockPinch, { passive: false });
    document.addEventListener('touchmove', blockPinch, { passive: false });
    let lastTouchEnd = 0;
    document.addEventListener('touchend', (ev) => {
      const now = Date.now();
      const brand = ev.target && ev.target.closest ? ev.target.closest('#brand') : null;
      const typing = ev.target && ev.target.tagName && /INPUT|TEXTAREA/.test(ev.target.tagName);
      if (!brand && !typing && now - lastTouchEnd < 320) ev.preventDefault();
      lastTouchEnd = now;
    }, { passive: false });

    // Keyboard shortcuts
    window.addEventListener('keydown', (ev) => {
      if (ev.target && /INPUT|TEXTAREA|SELECT/.test(ev.target.tagName)) return;
      if (ev.code === 'Space') {
        ev.preventDefault();
        if (S.phase === 'betting') deal();
        else if (S.phase === 'reveal') revealAll();
      } else if (ev.key === 'z' || ev.key === 'Z') {
        undo();
      } else if (ev.key === 'r' || ev.key === 'R') {
        rebet();
      } else if (ev.key === 'Escape') {
        closeModal();
      }
    });

    window.addEventListener('resize', () => {
      if (window.FX) FX.refresh();
      renderAccount();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (window.FX) FX.stop();
      } else if (window.FX) {
        FX.setMode(S.mode);
      }
    });

    // 테이블을 떠날 때(블랙잭으로 이동 · 새로고침) 아직 정산되지 않은 베팅은 잔액으로 돌려줍니다
    const refundOnLeave = () => {
      const stake = totalStake();
      if (!stake) return;
      if (S.phase !== 'betting' && S.phase !== 'dealing' && S.phase !== 'reveal') return;
      S.balance += stake;
      S.bets = emptyBets();
      S.stack = [];
      S.phase = 'betting';
      save();
    };
    window.addEventListener('pagehide', refundOnLeave);
  }


  /* ───────────── accounts ───────────── */
  const ADMIN_PIN = '6160';
  let authMode = 'login';
  let pinBuffer = '';
  let pinResetTimer = 0;

  const escapeHtml = (str) => String(str == null ? '' : str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

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

  function renderAccount() {
    const p = activeProfile();
    const logged = !!DB.current;
    if (!el.accountBtn) return;
    el.avatar.textContent = String(p.nick || p.id || 'G').trim().slice(0, 1).toUpperCase() || 'G';
    const narrow = window.matchMedia('(max-width: 430px)').matches;
    el.accName.textContent = logged ? (p.nick || p.id) : (narrow ? '로그인' : '로그인·가입');
    el.accountBtn.classList.toggle('is-guest', !logged);
    el.accountBtn.title = logged ? `${p.nick || p.id} · @${p.id}` : '로그인 또는 회원가입';
    el.logoutBtn.hidden = !logged;
  }

  function applyProfile(p) {
    S.balance = p.balance;
    lastSavedBalance = p.balance;
    S.stats = p.stats || freshStats();
    S.history = Array.isArray(p.history) ? p.history : [];
    S.lastBets = p.lastBets || null;
    S.bets = emptyBets();
    S.stack = [];
    S.hand = null;
    S.bonus = [];
    S.phase = 'betting';
    S.shoe = new E.Shoe(8);
    clearTable();
    renderBonusEmpty();
    renderAll();
    renderAccount();
    startRoundClock(true);
  }

  function setAuthMsg(msg, ok) {
    el.authMsg.textContent = msg || '';
    el.authMsg.classList.toggle('ok', !!ok);
  }

  function setAuthMode(mode) {
    authMode = mode;
    const isAccount = mode === 'account';
    const isSignup = mode === 'signup';
    el.authTabs.hidden = isAccount;
    el.authForm.hidden = isAccount;
    el.authProfile.hidden = !isAccount;
    el.guestBtn.hidden = isAccount;
    el.nickFld.classList.toggle('is-hidden', !isSignup);
    el.pin2Fld.classList.toggle('is-hidden', !isSignup);
    el.authSubmit.textContent = isSignup ? '가입하고 시작하기' : '로그인';
    $$('button[data-auth]', el.authTabs).forEach((b) => b.classList.toggle('is-active', b.dataset.auth === mode));
    setAuthMsg('');
    if (isAccount) {
      const p = activeProfile();
      el.apAvatar.textContent = String(p.nick || p.id || 'E').trim().slice(0, 1).toUpperCase();
      el.apName.textContent = p.nick || p.id;
      el.apBalance.textContent = won(S.balance);
    }
  }

  function openAuth(mode) {
    setAuthMode(mode || (DB.current ? 'account' : 'login'));
    el.authBack.hidden = false;
    el.authBack.classList.remove('hidden');
    document.body.classList.add('is-locked');
    window.setTimeout(() => { if (!DB.current && el.authId) el.authId.focus(); }, 80);
    window.Sound && Sound.click();
  }

  function closeAuth() {
    el.authBack.hidden = true;
    document.body.classList.remove('is-locked');
  }

  async function submitAuth(ev) {
    ev.preventDefault();
    const id = (el.authId.value || '').trim().toLowerCase();
    const nick = (el.authNick.value || '').trim();
    const pin = (el.authPin.value || '').trim();
    const pin2 = (el.authPin2.value || '').trim();
    setAuthMsg('');

    if (!/^[a-z0-9_]{3,14}$/.test(id)) { setAuthMsg('아이디는 3~14자 영문·숫자·밑줄만 가능합니다'); return; }
    if (!/^\d{4,6}$/.test(pin)) { setAuthMsg('PIN은 4~6자리 숫자입니다'); return; }

    if (authMode === 'signup') {
      if (!ACC) { setAuthMsg('계정 저장소를 불러오지 못했습니다'); return; }
      if (DB.users[id]) { setAuthMsg('이미 사용 중인 아이디입니다'); return; }
      if (pin !== pin2) { setAuthMsg('PIN 확인이 일치하지 않습니다'); return; }
      const res = await ACC.signup(id, nick, pin, pin2);
      if (!res.ok) { setAuthMsg(res.error); return; }
      applyProfile(activeProfile());
      save();
      setAuthMsg('가입 완료 · ₩10억 가상 머니 지급', true);
      window.Sound && Sound.win();
      toast(`${nick || id}님, 가입을 환영합니다`);
      window.setTimeout(closeAuth, 620);
    } else {
      if (!ACC) { setAuthMsg('계정 저장소를 불러오지 못했습니다'); return; }
      const res = await ACC.login(id, pin);
      if (!res.ok) { setAuthMsg(res.error); return; }
      applyProfile(activeProfile());
      save();
      toast(`${DB.users[id].nick || id}님 환영합니다`);
      window.setTimeout(closeAuth, 220);
    }
  }

  function logout() {
    save();
    if (ACC) ACC.logout();
    else DB.current = null;
    applyProfile(DB.guest);
    save();
    closeAuth();
    toast('로그아웃 · 게스트로 플레이합니다');
    window.Sound && Sound.click();
  }

  /* ───────────── hidden admin (logo double-tap → 6160) ───────────── */
  function openPin() {
    pinBuffer = '';
    renderPin();
    el.pinMsg.textContent = 'PIN을 입력하세요';
    el.pinMsg.classList.remove('err');
    el.pinBack.hidden = false;
    document.body.classList.add('is-locked');
  }

  function closePin() {
    el.pinBack.hidden = true;
    document.body.classList.remove('is-locked');
  }

  function renderPin() {
    Array.from(el.pinDots.children).forEach((d, i) => d.classList.toggle('on', i < pinBuffer.length));
  }

  function pressKey(k) {
    clearTimeout(pinResetTimer);
    window.Sound && Sound.click();
    if (k === 'clear') { pinBuffer = ''; renderPin(); return; }
    if (k === 'back') { pinBuffer = pinBuffer.slice(0, -1); renderPin(); return; }
    if (pinBuffer.length >= 4) return;
    pinBuffer += k;
    renderPin();
    if (pinBuffer.length === 4) window.setTimeout(checkPin, 130);
  }

  function checkPin() {
    if (pinBuffer === ADMIN_PIN) {
      closePin();
      openAdmin();
      return;
    }
    el.pinPanel.classList.add('shake');
    el.pinMsg.textContent = 'PIN이 올바르지 않습니다';
    el.pinMsg.classList.add('err');
    window.Sound && Sound.lose();
    clearTimeout(pinResetTimer);
    pinResetTimer = window.setTimeout(() => {
      el.pinPanel.classList.remove('shake');
      pinBuffer = '';
      renderPin();
      el.pinMsg.textContent = 'PIN을 입력하세요';
      el.pinMsg.classList.remove('err');
    }, 620);
  }

  function openAdmin() {
    el.adminBack.hidden = false;
    document.body.classList.add('is-locked');
    if (el.ghRepo) el.ghRepo.value = DB.admin.repo || '';
    if (el.ghPat) el.ghPat.value = DB.admin.pat || '';
    renderAdmin();
    setSyncStatus(DB.admin.repo ? '리포지토리 설정됨' : '대기 중');
    window.Sound && Sound.click();
  }

  function closeAdmin() {
    el.adminBack.hidden = true;
    document.body.classList.remove('is-locked');
  }

  function renderAdmin() {
    const rows = [];
    const cur = DB.current || 'guest';
    if (DB.users[cur]) rows.push({ key: cur, p: DB.users[cur], guest: false });
    else rows.push({ key: 'guest', p: DB.guest, guest: true });
    for (const u of Object.values(DB.users)) {
      if (u.id === cur) continue;
      rows.push({ key: u.id, p: u, guest: false });
    }
    if (cur !== 'guest') rows.push({ key: 'guest', p: DB.guest, guest: true });

    el.admUsers.innerHTML = rows.map((r) => {
      const p = r.p;
      const label = r.guest ? '게스트' : (p.nick || p.id);
      const initial = String(label).trim().slice(0, 1).toUpperCase() || 'G';
      return `<div class="adm-user ${r.key === cur ? 'is-current' : ''}" data-uid="${escapeHtml(r.key)}">
        <span class="au-avatar">${escapeHtml(initial)}</span>
        <div class="au-id"><b>${escapeHtml(label)}</b><i>${r.guest ? 'GUEST' : '@' + escapeHtml(p.id)}${r.key === cur ? ' · 현재 세션' : ''}</i></div>
        <span class="au-bal">${won(p.balance)}</span>
        <div class="au-btns">
          <button data-op="minus" class="minus" aria-label="차감">−</button>
          <button data-op="plus" class="plus" aria-label="추가">+</button>
          <button data-op="reset" class="reset" aria-label="잔액 초기화">초기화</button>
        </div>
      </div>`;
    }).join('');
  }

  function adjustUser(uid, op, override) {
    const target = uid === 'guest' ? DB.guest : DB.users[uid];
    if (!target) return;
    const typed = override != null ? Math.abs(Math.round(override))
      : Math.abs(Math.round(Number(String(el.admAmount.value || '').replace(/[^0-9]/g, '')) || 0));
    const cur = target.balance;
    let next;
    if (op === 'plus') next = Math.round(cur + typed);
    else if (op === 'minus') next = Math.max(0, Math.round(cur - typed));
    else next = START_BALANCE;

    const activeId = DB.current || 'guest';
    if (uid === activeId) {
      // 지금 세션 — 잔액 차이만큼 저장 (다른 탭의 손익을 덮어쓰지 않음)
      S.balance = next;
      save();
    } else if (ACC) {
      // 다른 회원 — 그 회원의 잔액만 절대값으로 병합 저장
      ACC.commit(activeId, {
        balance: S.balance,
        baseline: lastSavedBalance,
        patch: (p) => {
          p.stats = S.stats;
          p.history = S.history.slice(-240);
          p.lastBets = S.lastBets;
        },
        others: [{ uid, balance: next }],
        meta: { mode: S.mode, chip: S.chip, settings: S.settings }
      });
      lastSavedBalance = S.balance;
    } else {
      target.balance = next;
      save();
    }
    renderBalance();
    renderAccount();
    renderAdmin();
    pulseNode($('#balancePill'));
    window.Sound && Sound.chip();
    toast(`${uid === 'guest' ? '게스트' : (target.nick || uid)} · ${won(next)}`);
  }

  /* ───────────── github sync (optional) ───────────── */
  function setSyncStatus(msg, cls) {
    if (!el.ghStatus) return;
    el.ghStatus.textContent = msg;
    el.ghStatus.className = 'sync-status' + (cls ? ' ' + cls : '');
  }

  function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin);
  }

  function b64decode(b64) {
    const bin = atob(String(b64).replace(/\s+/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function syncCreds() {
    DB.admin.repo = (el.ghRepo.value || '').trim();
    DB.admin.pat = (el.ghPat.value || '').trim();
    save();
    return DB.admin;
  }

  async function ghApi(path, method, body) {
    const { repo, pat } = syncCreds();
    if (!repo || !pat) throw new Error('리포지토리(owner/repo)와 PAT를 입력하세요');
    const res = await fetch('https://api.github.com/repos/' + repo + path, {
      method: method || 'GET',
      headers: {
        Authorization: 'Bearer ' + pat,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) throw new Error((data && data.message) || ('HTTP ' + res.status));
    return data;
  }

  async function ghTest() {
    try {
      setSyncStatus('확인 중…');
      const repo = await ghApi('');
      setSyncStatus('연결됨 · ' + repo.full_name + (repo.private ? ' (비공개)' : ''), 'ok');
    } catch (e) {
      setSyncStatus('실패 · ' + e.message, 'err');
    }
  }

  async function ghPush() {
    try {
      setSyncStatus('올리는 중…');
      const payload = {
        app: 'enp-baccarat',
        updatedAt: new Date().toISOString(),
        guest: { balance: DB.guest.balance, stats: DB.guest.stats, history: (DB.guest.history || []).slice(-120) },
        users: {}
      };
      for (const [k, u] of Object.entries(DB.users)) {
        payload.users[k] = {
          id: u.id, nick: u.nick, pin: u.pin, balance: u.balance,
          stats: u.stats, history: (u.history || []).slice(-120), createdAt: u.createdAt
        };
      }
      const path = '/contents/baccarat/users.json';
      let sha;
      try {
        const cur = await ghApi(path);
        sha = cur && cur.sha;
      } catch (e) {
        if (!/Not Found|404/i.test(e.message)) throw e;
      }
      const body = { message: 'ENP Baccarat: sync ' + new Date().toISOString(), content: b64encode(JSON.stringify(payload, null, 2)) };
      if (sha) body.sha = sha;
      await ghApi(path, 'PUT', body);
      setSyncStatus('완료 · ' + Object.keys(DB.users).length + '명 올림', 'ok');
      toast('GitHub에 회원 정보를 올렸습니다');
    } catch (e) {
      setSyncStatus('실패 · ' + e.message, 'err');
    }
  }

  async function ghPull() {
    try {
      setSyncStatus('불러오는 중…');
      const data = await ghApi('/contents/baccarat/users.json');
      if (!data || !data.content) throw new Error('파일이 비어 있습니다');
      const remote = JSON.parse(b64decode(data.content));
      if (!remote || !remote.users) throw new Error('형식이 올바르지 않습니다');
      DB.users = remote.users;
      if (remote.guest) DB.guest = Object.assign(DB.guest, remote.guest);
      if (DB.current && !DB.users[DB.current]) DB.current = null;
      const p = activeProfile();
      S.balance = p.balance;
      S.stats = p.stats || freshStats();
      S.history = p.history || [];
      S.lastBets = p.lastBets || null;
      lastSavedBalance = S.balance;
      if (ACC) ACC.save(); else save();   // 회원 목록 전체를 그대로 올린 경우
      renderAll();
      renderAccount();
      renderAdmin();
      setSyncStatus('완료 · ' + Object.keys(DB.users).length + '명 불러옴', 'ok');
      toast('GitHub에서 회원 정보를 불러왔습니다');
    } catch (e) {
      setSyncStatus('실패 · ' + e.message, 'err');
    }
  }

  /* ───────────── splash content ───────────── */
  function renderSplash() {
    const cfg = MODES[S.mode];
    if (el.splashEn) el.splashEn.textContent = cfg.en;
    if (el.splashKo) el.splashKo.textContent = cfg.name;
    if (el.splashArch) el.splashArch.textContent = cfg.arch;
    if (el.splashTag) el.splashTag.textContent = cfg.tag;
  }

  /* ───────────── boot ───────────── */
  function boot() {
    document.body.classList.add('is-locked');

    // 다른 페이지(블랙잭)에서 넘어올 때 ?mode=speed|sakura|snow 로 테이블을 바로 엽니다
    try {
      const want = new URLSearchParams(window.location.search).get('mode');
      if (want && MODES[want] && want !== S.mode) {
        S.mode = want;
        DB.mode = want;
        save();
      }
    } catch (err) { /* ignore */ }

    if (el.fx) el.felt.prepend(el.fx);
    if (window.FX) {
      FX.init(el.fx);
      FX.setMode(S.mode);
    }

    applyModeCopy();
    applySound();
    renderSplash();
    renderAccount();
    renderAll();
    bind();
    startRoundClock(true);
    runSplash();

    // 다른 탭/창(블랙잭 포함)에서 잔액·계정이 바뀌면 이 화면도 따라갑니다
    if (ACC) {
      ACC.subscribe((kind) => {
        if (kind !== 'external') return;
        const p = activeProfile();
        S.balance = p.balance;
        lastSavedBalance = p.balance;
        if (S.phase === 'betting') {
          S.stats = p.stats || S.stats;
          S.history = Array.isArray(p.history) ? p.history : S.history;
          S.lastBets = p.lastBets || null;
        }
        renderBalance();
        renderAccount();
        renderAll();
      });
    }

    if (S.settings.squeeze && S.mode === 'speed') {
      // speed always instant
    }

    window.__bac = {
      get state() { return S; },
      engine: E,
      deal,
      placeBet,
      moveBet,
      setMode,
      setChip,
      rebet,
      undo,
      clearBets: clearBets,
      refill,
      revealAll,
      finishHand,
      motionLog,
      setPreview,
      get preview() { return previewSide; },
      renderAll,
      renderBonusShowcase() { renderBonusResult(); updateLiveMults(); }
    };
    window.__APP_READY__ = true;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
