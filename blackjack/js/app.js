/* ══════════════════════════════════════════════════════════════
   ENP BLACKJACK — App
   betting → deal → insurance → player → dealer → settle
   ══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const E = window.ENPBlackjack;
  const SND = window.ENPSound;
  const ACC = window.ENPAccount || null;   // 바카라와 공용 계정 · 잔액
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

  const MIN_BET = 1000;
  const START_BALANCE = (ACC && ACC.START_BALANCE) || 1000000000;
  const STORE = 'enp-blackjack-v1';
  const PIN = (ACC && ACC.ADMIN_PIN) || '6160';

  const el = {
    app: $('#app'), topbar: $('.topbar'), stage: $('#stage'),
    dealer: $('#dealer'), felt: $('#felt'),
    dealerCards: $('#dealerCards'), dealerBadge: $('#dealerBadge'), dealerBJ: $('#dealerBJ'),
    playerZone: $('#playerZone'), shoe: $('#shoeEl'), shoeCount: $('#shoeCount'),
    dhLayer: $('#dhLayer'),
    balance: $('#balance'), nickName: $('#nickName'), avatar: $('#avatar'), balancePill: $('#balancePill'),
    betDeck: $('#betDeck'), actionDeck: $('#actionDeck'), resultDeck: $('#resultDeck'), undoBtn: $('#undoBtn'),
    chipAmount: $('#chipAmount'), betTotal: $('#betTotal'), dealBtn: $('#dealBtn'), dealAmount: $('#dealAmount'),
    totalStake: $('#totalStake'), lastWinCell: $('#lastWinCell'), lastWin: $('#lastWin'),
    statusBalance: $('#statusBalance'),
    actHand: $('#actHand'), actTotal: $('#actTotal'), actNote: $('#actNote'),
    resTitle: $('#resTitle'), resNet: $('#resNet'), resRows: $('#resRows'), nextBtn: $('#nextBtn'), nextTimer: $('#nextTimer'),
    winCelebrate: $('#winCelebrate'), wcRibbon: $('#wcRibbon'), wcTitle: $('#wcTitle'),
    wcWon: $('#wcWon'), wcAmount: $('#wcAmount'),
    insure: $('#insure'), insAce: $('#inAce'), insAmount: $('#insAmount'),
    toast: $('#toast'), fxLayer: $('#fxLayer'),
    shuffleVeil: $('#shuffleVeil'),
    historyList: $('#historyList'), historyListM: $('#historyListM'),
    soundBtn: $('#soundBtn'),
    avatarEl: $('#avatar')
  };

  const state = {
    phase: 'betting',
    shoe: new E.Shoe(8),
    balance: START_BALANCE,
    chip: 10000,
    nickname: 'enp',
    bets: { main: 0, anyPair: 0, t213: 0, hot3: 0, bustIt: 0 },
    lastBets: null,
    hands: [],
    active: 0,
    dealer: [],
    holeHidden: true,
    insurance: 0,
    sideStakes: { anyPair: 0, t213: 0, hot3: 0, bustIt: 0 },
    earlySide: {},
    firstCards: [],
    round: null,
    history: [],
    stats: { rounds: 0, wins: 0, losses: 0, pushes: 0, blackjacks: 0, net: 0 },
    lastWin: 0,
    sound: true,
    motion: true,
    autoNext: true,
    busy: false,
    betLog: [],
    rig: [],
    fast: false,
    motionLog: [],
  };

  /* ── helpers ─────────────────────────────────────────────── */
  function money(n) {
    n = Math.round(n || 0);
    return '₩' + n.toLocaleString('en-US');
  }
  function shortKo(n) {
    n = Math.round(n || 0);
    const sign = n < 0 ? '-' : '';
    n = Math.abs(n);
    if (n >= 100000000) {
      const v = n / 100000000;
      return sign + (v >= 10 ? Math.round(v) : Math.round(v * 100) / 100) + '억';
    }
    if (n >= 10000) {
      const v = n / 10000;
      return sign + (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10) + '만';
    }
    return sign + n.toLocaleString('en-US');
  }
  function chipLabel(v) {
    if (v >= 1000000000) return (v / 1000000000) + 'B';
    if (v >= 1000000) return (v / 1000000) + 'M';
    if (v >= 1000) return (v / 1000) + 'K';
    return String(v);
  }
  function toneOf(amount) {
    const t = [100000000, 10000000, 5000000, 1000000, 500000, 100000, 50000, 10000, 5000, 1000];
    for (let i = 0; i < t.length; i++) if (amount >= t[i]) return 'tone-' + t[i];
    return 'tone-1000';
  }
  function labelClass(v) {
    const s = String(v);
    if (s.length >= 4) return 'ln4';
    if (s.length === 3) return 'ln3';
    if (s.length === 2) return 'ln2';
    return 'ln1';
  }
  function totalBets() {
    const b = state.bets;
    return b.main + b.anyPair + b.t213 + b.hot3 + b.bustIt;
  }
  function activeHand() { return state.hands[state.active] || null; }
  function currentStake() {
    if (state.phase === 'betting') return totalBets();
    if (state.phase === 'settle' && state.round) return state.round.stake;
    let s = state.insurance + state.sideStakes.anyPair + state.sideStakes.t213 + state.sideStakes.hot3 + state.sideStakes.bustIt;
    state.hands.forEach((h) => { s += h.bet; });
    return s;
  }
  function liveHand(h) {
    if (!h) return false;
    const v = E.handValue(h.cards);
    return !v.bust && !(E.isBlackjack(h.cards, h.fromSplit));
  }

  /* ── persistence (공용 계정 저장소) ───────────────────── */
  function load() {
    if (ACC) {
      const p = ACC.profile();
      const bj = p.bj || {};
      if (Number.isFinite(p.balance) && p.balance >= 0) state.balance = p.balance;
      state.nickname = p.nick || p.id || '게스트';
      if (Array.isArray(bj.history)) state.history = bj.history.slice(0, 40);
      if (bj.stats && typeof bj.stats === 'object') Object.assign(state.stats, bj.stats);
      if (typeof bj.sound === 'boolean') state.sound = bj.sound;
      if (typeof bj.motion === 'boolean') state.motion = bj.motion;
      if (typeof bj.autoNext === 'boolean') state.autoNext = bj.autoNext;
      if (Number.isFinite(bj.chip) && bj.chip >= MIN_BET) state.chip = bj.chip;
      return;
    }
    try {
      const raw = localStorage.getItem(STORE);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (typeof d.balance === 'number' && d.balance >= 0) state.balance = d.balance;
      if (typeof d.nickname === 'string' && d.nickname.trim()) state.nickname = d.nickname;
      if (typeof d.sound === 'boolean') state.sound = d.sound;
      if (typeof d.motion === 'boolean') state.motion = d.motion;
      if (typeof d.autoNext === 'boolean') state.autoNext = d.autoNext;
      if (Array.isArray(d.history)) state.history = d.history.slice(0, 40);
      if (d.stats && typeof d.stats === 'object') Object.assign(state.stats, d.stats);
    } catch (e) { /* ignore */ }
  }
  function save() {
    if (ACC) {
      const p = ACC.profile();
      p.balance = Math.max(0, Math.round(state.balance));
      if (!p.bj || typeof p.bj !== 'object') p.bj = {};
      p.bj.history = state.history.slice(0, 40);
      p.bj.stats = state.stats;
      p.bj.sound = state.sound;
      p.bj.motion = state.motion;
      p.bj.autoNext = state.autoNext;
      p.bj.chip = state.chip;
      p.bj.lastBets = state.lastBets;
      ACC.save();
      return;
    }
    try {
      localStorage.setItem(STORE, JSON.stringify({
        balance: state.balance, nickname: state.nickname, sound: state.sound,
        motion: state.motion, autoNext: state.autoNext,
        history: state.history.slice(0, 40), stats: state.stats
      }));
    } catch (e) { /* ignore */ }
  }

  /* ── toast / fx ──────────────────────────────────────────── */
  let toastTimer = 0;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('on'), 1700);
  }
  function burst(x, y, n) {
    for (let i = 0; i < (n || 14); i++) {
      const s = document.createElement('i');
      s.className = 'fx-spark';
      s.style.left = x + 'px';
      s.style.top = y + 'px';
      const a = Math.random() * Math.PI * 2;
      const d = 30 + Math.random() * 90;
      s.style.setProperty('--dx', Math.cos(a) * d + 'px');
      s.style.setProperty('--dy', (Math.sin(a) * d + 40) + 'px');
      s.style.animationDelay = (Math.random() * .2) + 's';
      el.fxLayer.appendChild(s);
      setTimeout(() => s.remove(), 1800);
    }
  }

  /* ── sound ───────────────────────────────────────────────── */
  const ICON_ON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.2L12 5.6v12.8L7.2 14.5H4z" fill="currentColor"/><path d="M15.4 8.6a4.6 4.6 0 0 1 0 6.8M18 6a8 8 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  const ICON_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.2L12 5.6v12.8L7.2 14.5H4z" fill="currentColor"/><path d="M16 9.6l4.4 4.8M20.4 9.6L16 14.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
  function applySound() {
    SND.setEnabled(state.sound);
    el.soundBtn.innerHTML = state.sound ? ICON_ON : ICON_OFF;
    el.soundBtn.classList.toggle('is-off', !state.sound);
    const cb = $('#optSound');
    if (cb) cb.checked = state.sound;
  }

  /* ── renderers ───────────────────────────────────────────── */
  function renderBalance() {
    el.balance.textContent = shortKo(state.balance);
    el.balancePill.title = money(state.balance);
    el.statusBalance.textContent = money(state.balance);
    el.totalStake.textContent = money(currentStake());
    el.lastWinCell.hidden = !state.lastWin;
    el.lastWin.textContent = money(state.lastWin);
    const mb = $('#modalBalance');
    if (mb) mb.textContent = money(state.balance);
    const ab = $('#admBalance');
    if (ab) ab.textContent = money(state.balance);
    const logged = !!(ACC && ACC.db.current);
    el.nickName.textContent = state.nickname;
    el.avatar.textContent = (state.nickname || 'E').slice(0, 1).toUpperCase();
    const chip = $('#userChip');
    if (chip) {
      chip.classList.toggle('is-guest', !logged);
      chip.title = logged ? (state.nickname + ' · 바카라와 공용 계정') : '로그인 또는 회원가입';
    }
  }

  function cardHTML(card, faceUp) {
    if (!faceUp) return '<div class="card back" aria-label="카드 뒷면"></div>';
    const r = card.rank;
    const face = r === 'J' || r === 'Q' || r === 'K';
    const ace = r === 'A';
    return '<div class="card' + (card.red ? ' red' : '') + (face ? ' is-face' : '') + (ace ? ' is-ace' : '') +
      '" data-card="' + card.id + '" aria-label="' + E.SUIT_NAME[card.suit] + ' ' + r + '">' +
      '<span class="c-corner c-tl"><b>' + r + '</b><i>' + card.glyph + '</i></span>' +
      '<span class="c-center"><b>' + r + '</b><i>' + card.glyph + '</i></span>' +
      '<span class="c-corner c-br"><b>' + r + '</b><i>' + card.glyph + '</i></span>' +
      '</div>';
  }

  function handValueClass(cards, fromSplit) {
    const v = E.handValue(cards);
    if (v.bust) return 'is-bust';
    if (E.isBlackjack(cards, fromSplit)) return 'is-blackjack';
    if (v.total === 21) return 'is-21';
    if (v.soft) return 'is-soft';
    return '';
  }

  function badgeText(cards) {
    const v = E.handValue(cards);
    if (E.isBlackjack(cards, false) && cards.length === 2) return 'BJ';
    if (v.soft && v.total !== 21) return v.hard + '/' + v.total;
    return String(v.total);
  }

  function renderDealer() {
    const cards = state.dealer;
    const sig = cards.map((c) => c.id).join(',') + '|' + (state.holeHidden ? 'h' : 'o') + '|' + state.dealer.length;
    const box = el.dealerCards;
    if (!cards.length) {
      if (box.dataset.sig !== 'ghost') {
        box.innerHTML = '<div class="card ghost"></div><div class="card ghost"></div>';
        box.dataset.sig = 'ghost';
        box.dataset.count = '0';
        box.dataset.hole = state.holeHidden ? '1' : '0';
      }
      el.dealerBadge.hidden = true;
      el.dealerBJ.hidden = true;
      return;
    }
    if (box.dataset.sig !== sig) {
      const prev = parseInt(box.dataset.count || '0', 10);
      const wasHidden = box.dataset.hole === '1';
      let html = '';
      cards.forEach((c, i) => {
        const down = state.holeHidden && i === 1;
        html += cardHTML(c, !down);
      });
      box.innerHTML = html;
      box.dataset.sig = sig;
      box.dataset.count = String(cards.length);
      box.dataset.hole = state.holeHidden ? '1' : '0';
      if (cards.length > prev) {
        const last = box.lastElementChild;
        if (last) last.classList.add('is-dealt');
      } else if (wasHidden && !state.holeHidden && cards.length === 2) {
        const hole = box.children[1];
        if (hole) hole.classList.add('is-flip');
      }
    }
    el.dealerBadge.hidden = !cards.length;
    if (cards.length) {
      const shown = state.holeHidden ? cards.slice(0, 1) : cards;
      const v = E.handValue(shown);
      const txt = state.holeHidden ? (shown[0].rank === 'A' ? 'A' : badgeText(shown)) : badgeText(shown);
      el.dealerBadge.querySelector('i').textContent = txt;
      el.dealerBadge.className = 'hand-badge dealer-badge ' + handValueClass(shown, false);
      el.dealerBadge.classList.toggle('is-soft', v.soft && v.total !== 21 && !state.holeHidden);
    }
    const dv = E.handValue(cards);
    el.dealerBJ.hidden = !(cards.length === 2 && !state.holeHidden && dv.total === 21);
  }

  function handSlotEl(i) {
    return $('.hand-slot[data-i="' + i + '"]', el.playerZone);
  }

  function buildSlot(i, hand) {
    const slot = document.createElement('div');
    slot.className = 'hand-slot';
    slot.dataset.i = String(i);
    slot.innerHTML =
      '<div class="cards-wrap"><div class="cards"></div></div>' +
      '<div class="score-line"><div class="hand-badge" hidden><i>0</i></div></div>' +
      '<div class="bet-spot" data-spot="main">' +
      '<span class="spot-label">BET</span>' +
      '<span class="spot-chips"></span>' +
      '<span class="spot-amt" hidden></span>' +
      '<span class="spot-out"></span>' +
      '</div>';
    return slot;
  }

  function renderPlayer() {
    const hands = state.hands.length ? state.hands : [null];
    const count = hands.length;
    // build / remove slots
    const existing = $$('.hand-slot', el.playerZone);
    if (existing.length !== count) {
      existing.forEach((n) => n.remove());
      hands.forEach((h, i) => el.playerZone.appendChild(buildSlot(i, h)));
    }
    const wide = window.innerWidth >= 900;
    const base = count === 1 ? (wide ? 76 : (window.innerWidth < 420 ? 60 : 64))
      : count === 2 ? (wide ? 68 : 52)
      : count === 3 ? (wide ? 58 : 42)
      : (wide ? 48 : 33);
    const maxCards = Math.max.apply(null, hands.map((h) => (h ? h.cards.length : 0)).concat([2]));
    const zoneW = el.playerZone.clientWidth || 374;
    const gaps = 4 * (count - 1);
    const avail = Math.max(58, (zoneW - 18 - gaps) / count);
    const ov = maxCards >= 6 ? -.42 : maxCards >= 5 ? -.34 : -.22;
    const fitted = Math.floor(avail / (1 + (maxCards - 1) * (1 + ov)));
    const zoneH = el.playerZone.clientHeight || 200;
    const spotBase = count === 1 ? (wide ? 52 : 62) : count === 2 ? 50 : count === 3 ? 44 : 38;
    const spot = Math.max(34, Math.min(spotBase, zoneH - 118));
    const room = zoneH - 27 - spot - 26;
    const cwH = Math.floor(room / 1.44);
    const cw = Math.max(24, Math.min(base, fitted, cwH));

    hands.forEach((hand, i) => {
      const slot = handSlotEl(i);
      if (!slot) return;
      slot.style.setProperty('--cw', cw + 'px');
      slot.style.setProperty('--ov', String(ov));
      slot.style.setProperty('--spot', spot + 'px');
      slot.classList.toggle('is-active', state.phase === 'playing' && i === state.active);
      slot.classList.toggle('is-done', !!(hand && hand.done));

      const cardsBox = $('.cards', slot);
      const cards = hand ? hand.cards : [];
      const sig = cards.map((c) => c.id).join(',') + '|' + cards.length;
      if (!cards.length) {
        if (cardsBox.dataset.sig !== 'ghost') {
          cardsBox.innerHTML = '<div class="card ghost"></div><div class="card ghost"></div>';
          cardsBox.dataset.sig = 'ghost';
          cardsBox.dataset.count = '0';
        }
      } else if (cardsBox.dataset.sig !== sig) {
        const prev = parseInt(cardsBox.dataset.count || '0', 10);
        cardsBox.innerHTML = cards.map((c) => cardHTML(c, true)).join('');
        cardsBox.dataset.sig = sig;
        cardsBox.dataset.count = String(cards.length);
        if (cards.length > prev) {
          const last = cardsBox.lastElementChild;
          if (last) last.classList.add('is-dealt');
        }
      }

      const badge = $('.hand-badge', slot);
      if (hand && hand.cards.length) {
        const v = E.handValue(hand.cards);
        const isBJ = E.isBlackjack(hand.cards, hand.fromSplit);
        badge.hidden = false;
        badge.querySelector('i').textContent = isBJ ? 'BLACKJACK' : badgeText(hand.cards);
        badge.className = 'hand-badge ' + handValueClass(hand.cards, hand.fromSplit);
        if (badge.dataset.v !== badge.textContent) {
          badge.classList.add('is-tick');
          setTimeout(() => badge.classList.remove('is-tick'), 400);
          badge.dataset.v = badge.textContent;
        }
      } else {
        badge.hidden = true;
      }

      const spotEl = $('.bet-spot', slot);
      const amt = hand ? hand.bet : state.bets.main;
      spotEl.classList.toggle('has-bet', amt > 0);
      spotEl.classList.toggle('is-legal', state.phase === 'betting');
      spotEl.classList.remove('is-win', 'is-lose');
      const chips = $('.spot-chips', slot);
      if (amt > 0) {
        chips.innerHTML = '<span class="stack ' + toneOf(amt) + '">' +
          '<i class="mini-chip"></i><i class="mini-chip"></i><i class="mini-chip"><b>' + chipLabel(amt) + '</b></i></span>';
      } else {
        chips.innerHTML = '';
      }
      const amtEl = $('.spot-amt', slot);
      amtEl.hidden = !amt;
      amtEl.textContent = amt ? money(amt) : '';
      $('.spot-label', slot).hidden = amt > 0;

      const out = $('.spot-out', slot);
      if (hand && hand.result) {
        slot.classList.add('is-settled');
        spotEl.classList.toggle('is-lose', hand.result.outcome === 'lose');
        spotEl.classList.toggle('is-win', hand.result.outcome !== 'lose' && hand.result.outcome !== 'push');
        const label = hand.result.outcome === 'blackjack' ? '블랙잭 ' : hand.result.outcome === 'win' ? '승 ' : hand.result.outcome === 'push' ? '푸시' : '패 ';
        const val = hand.result.outcome === 'lose' ? '−' + money(hand.result.stake) : (hand.result.outcome === 'push' ? '' : '+' + money(hand.result.net));
        out.textContent = label + val;
        out.className = 'spot-out ' + (hand.result.outcome === 'lose' ? 'lose' : hand.result.outcome === 'push' ? 'push' : 'win');
      } else {
        slot.classList.remove('is-settled');
        out.textContent = '';
        out.className = 'spot-out';
      }
    });
  }

  function renderSideBets() {
    const locked = state.phase !== 'betting';
    $$('.side-zone', $('#sideBets')).forEach((z) => {
      const key = z.dataset.side;
      const amt = state.phase === 'betting' ? state.bets[key] : state.sideStakes[key];
      z.classList.toggle('has-bet', amt > 0);
      z.classList.toggle('is-locked', locked);
      z.classList.toggle('is-legal', !locked);
      const chips = $('[data-szchips="' + key + '"]', z);
      chips.innerHTML = amt > 0
        ? '<span class="stack ' + toneOf(amt) + '"><i class="mini-chip"></i><i class="mini-chip"></i><i class="mini-chip"><b>' + chipLabel(amt) + '</b></i></span>'
        : '';
      const badge = $('[data-szbadge="' + key + '"]', z);
      const res = state.earlySide[key] || (state.round && state.round.side ? state.round.side[key] : null);
      if (res && amt > 0 && state.phase !== 'betting') {
        badge.hidden = false;
        if (res.push) {
          badge.className = 'sz-badge push';
          badge.textContent = '푸시';
        } else if (res.win) {
          badge.className = 'sz-badge';
          const net = res.net != null ? res.net : Math.floor(amt * res.pay);
          badge.textContent = '+' + chipLabel(net) + ' ' + (res.pay ? res.pay + ':1' : '');
        } else {
          badge.className = 'sz-badge lose';
          badge.textContent = '패';
        }
      } else {
        badge.hidden = true;
      }
    });
  }

  function renderChips() {
    $$('.chip', $('#chipRow')).forEach((c) => {
      c.classList.toggle('is-active', Number(c.dataset.chip) === state.chip);
    });
    el.chipAmount.textContent = chipLabel(state.chip);
  }

  function renderDeck() {
    const p = state.phase;
    el.betDeck.hidden = !(p === 'betting' || p === 'dealing');
    el.actionDeck.hidden = !(p === 'playing' || p === 'dealer');
    el.resultDeck.hidden = p !== 'settle';
    el.insure.hidden = p !== 'insurance';

    el.dealBtn.disabled = !(p === 'betting') || state.bets.main < MIN_BET || state.busy;
    const ready = p === 'betting' && state.bets.main >= MIN_BET;
    el.dealBtn.classList.toggle('is-ready', ready);
    if (p === 'insurance') {
      if (el.dealAmount) el.dealAmount.textContent = '보험 선택';
    } else if (state.bets.main > 0) {
      el.dealAmount.textContent = money(state.bets.main);
    } else {
      el.dealAmount.textContent = '베팅하세요';
    }
    el.betTotal.textContent = money(totalBets());
    $$('.ctrl-btn').forEach((b) => { if (b.id !== 'undoBtn') b.disabled = p !== 'betting'; });
    el.undoBtn.disabled = !state.betLog.length || p !== 'betting';

    if (p === 'playing' || p === 'dealer') {
      const h = activeHand();
      const n = state.hands.length;
      el.actHand.textContent = n > 1 ? '핸드 ' + (state.active + 1) + ' / ' + n : '핸드 1';
      if (h) {
        const v = E.handValue(h.cards);
        el.actTotal.textContent = v.soft && v.total !== 21 ? v.hard + '/' + v.total : String(v.total);
        el.actTotal.className = 'act-total' + (v.soft && v.total !== 21 ? ' is-soft' : '');
      }
      const playing = p === 'playing' && !state.busy;
      const canDouble = !!(h && h.cards.length === 2 && !h.done && state.balance >= h.bet);
      const canSplit = !!(h && h.cards.length === 2 && !h.done && E.canSplit(h.cards) &&
        state.hands.length < 4 && state.balance >= h.bet && !h.fromSplitAces);
      $$('.act', el.actionDeck).forEach((b) => {
        const a = b.dataset.act;
        b.disabled = !playing || (a === 'double' && !canDouble) || (a === 'split' && !canSplit);
        b.classList.remove('is-primary');
      });
      if (playing) {
        const splitBtn = $('.act[data-act="split"]', el.actionDeck);
        if (canSplit) splitBtn.classList.add('is-primary');
        el.actNote.textContent = canSplit ? '스플릿 가능' : (p === 'dealer' ? '딜러 차례' : '액션을 선택하세요');
      } else {
        el.actNote.textContent = p === 'dealer' ? '딜러 차례' : '잠시만 기다려 주세요';
      }
    }
  }

  function renderHistory() {
    const html = state.history.length ? state.history.map((h) => {
      const tag = h.tag === 'bj' ? '블랙잭' : h.tag === 'win' ? '승' : h.tag === 'push' ? '푸시' : '패';
      return '<div class="hist-item">' +
        '<span class="hi-tag ' + h.tag + '">' + tag + '</span>' +
        '<span class="hi-desc">' + h.desc + '</span>' +
        '<span class="hi-net ' + (h.net < 0 ? 'neg' : '') + '">' + (h.net > 0 ? '+' : h.net < 0 ? '−' : '') + money(Math.abs(h.net)) + '</span>' +
        '<span class="hi-time">' + h.time + '</span>' +
        '</div>';
    }).join('') : '<span class="hist-empty">아직 기록이 없습니다</span>';
    if (el.historyList) el.historyList.innerHTML = html;
    if (el.historyListM) el.historyListM.innerHTML = html;

    const st = state.stats;
    const set = (id, v) => { const n = document.getElementById(id); if (n) n.textContent = v; };
    set('statNet', (st.net > 0 ? '+' : st.net < 0 ? '−' : '') + money(Math.abs(st.net)));
    set('statWL', st.wins + ' / ' + st.losses);
    set('statBJ', String(st.blackjacks));
    set('hStatNet', (st.net > 0 ? '+' : st.net < 0 ? '−' : '') + money(Math.abs(st.net)));
    set('hStatRounds', String(st.rounds));
    set('hStatBJ', String(st.blackjacks));
    set('admRounds', String(st.rounds));
    set('admNet', (st.net > 0 ? '+' : st.net < 0 ? '−' : '') + money(Math.abs(st.net)));
    set('admBJ', String(st.blackjacks));
  }

  function render() {
    el.app.dataset.phase = state.phase;
    renderBalance();
    renderDealer();
    renderPlayer();
    renderSideBets();
    renderChips();
    renderDeck();
    renderHistory();
    el.shoeCount.textContent = String(state.shoe.remaining());
    el.lastWinCell.hidden = !state.lastWin;
    el.lastWin.textContent = money(state.lastWin);
  }

  /* ── dealer hand motion ──────────────────────────────────── */
  const HAND_BOX = { w: 160, h: 260 };
  const HAND_ANCHOR = { x: 70, y: 26 };
  const HAND_BACK_SVG =
    '<svg class="dh-hand dh-hand-back" viewBox="0 0 160 260" aria-hidden="true">' +
      '<defs>' +
        '<linearGradient id="dhGlove" x1=".2" y1="0" x2=".8" y2="1">' +
          '<stop offset="0" stop-color="#FFFFFF"/><stop offset=".55" stop-color="#F3EBDE"/><stop offset="1" stop-color="#CBBBA2"/>' +
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

  function centerOf(node) {
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  }
  function clearDealerHand() {
    if (el.dhLayer) $$('.dh-grip', el.dhLayer).forEach((n) => n.remove());
  }

  async function dealerMotion(kind, index) {
    const target = kind === 'dealer'
      ? $('#dealerCards')
      : (handSlotEl(index) ? $('.cards-wrap', handSlotEl(index)) : null);
    const fast = state.fast || !state.motion;
    if (!target || !state.motion) {
      await wait(fast ? 10 : 90);
      return;
    }
    const shoe = el.shoe;
    const mouthEl = shoe && (shoe.querySelector('.sh-mouth') || shoe);
    const mouth = centerOf(mouthEl);
    const tgt = centerOf(target);
    const layer = el.dhLayer;
    if (!mouth || !tgt || !layer || !('animate' in Element.prototype)) { await wait(80); return; }

    clearDealerHand();
    const lr = layer.getBoundingClientRect();
    const nCards = kind === 'dealer' ? state.dealer.length : (state.hands[index] ? state.hands[index].cards.length : 0);
    const slotNode = kind === 'dealer' ? null : handSlotEl(index);
    const cwCss = slotNode ? parseFloat(slotNode.style.getPropertyValue('--cw')) : 0;
    const cardW = kind === 'dealer' ? clamp(tgt.w * .30, 38, 52) : clamp(cwCss || 46, 26, 60);
    const cardH = cardW * 1.44;
    // new card sits on the right of the row
    const step = cardW * .64;
    const endX = tgt.x - lr.left + (nCards - 1) * step * .5;
    const handW = Math.round(clamp(cardW * 1.78, 50, 104));
    const handH = Math.round(handW * (HAND_BOX.h / HAND_BOX.w));
    const ax = HAND_ANCHOR.x / HAND_BOX.w * handW;
    const ay = HAND_ANCHOR.y / HAND_BOX.h * handH;

    const start = { x: mouth.x - lr.left - cardW * .2, y: mouth.y - lr.top - cardH * .34 };
    const end = { x: endX, y: tgt.y - lr.top - cardH * .05 };
    const off = { x: start.x + 48, y: start.y - 96 };
    const approach = { x: start.x + 16, y: start.y - 46 };

    const grip = document.createElement('div');
    grip.className = 'dh-grip';
    const card = document.createElement('div');
    card.className = 'dh-card';
    card.style.width = cardW + 'px';
    card.style.height = cardH + 'px';
    card.style.left = (-cardW / 2) + 'px';
    card.style.top = (-cardH * .12) + 'px';
    card.style.transformOrigin = '50% 30%';
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

    const total = state.fast ? 120 : 380;
    const midX = start.x + (end.x - start.x) * .5 - 10;
    const midY = Math.min(start.y, end.y) - 34;

    if (el.dealer) {
      el.dealer.classList.remove('is-deal-l', 'is-deal-r');
      void el.dealer.offsetWidth;
      el.dealer.classList.add(end.x > (lr.width / 2) ? 'is-deal-r' : 'is-deal-l');
      setTimeout(() => el.dealer.classList.remove('is-deal-l', 'is-deal-r'), 900);
    }
    if (shoe) {
      shoe.classList.remove('is-dealing');
      void shoe.offsetWidth;
      shoe.classList.add('is-dealing');
      setTimeout(() => shoe.classList.remove('is-dealing'), 600);
    }

    const motion = grip.animate([
      { transform: `translate3d(${off.x}px, ${off.y}px, 0) scale(.82)`, opacity: 0, offset: 0 },
      { transform: `translate3d(${approach.x}px, ${approach.y}px, 0) scale(.98)`, opacity: 1, offset: .18 },
      { transform: `translate3d(${start.x}px, ${start.y}px, 0) scale(1)`, opacity: 1, offset: .36 },
      { transform: `translate3d(${midX}px, ${midY}px, 0) scale(1.04)`, opacity: 1, offset: .70 },
      { transform: `translate3d(${end.x}px, ${end.y}px, 0) scale(1)`, opacity: 1, offset: 1 }
    ], { duration: total, easing: 'cubic-bezier(.32,.72,.3,1)', fill: 'forwards' });
    card.animate([{ opacity: 0, offset: 0 }, { opacity: 0, offset: .34 }, { opacity: 1, offset: .42 }, { opacity: 1, offset: 1 }],
      { duration: total, fill: 'forwards' });
    pair.animate([
      { transform: 'rotate(-90deg)', offset: 0 },
      { transform: 'rotate(-98deg)', offset: .34 },
      { transform: 'rotate(-118deg)', offset: .52 },
      { transform: 'rotate(-142deg)', offset: .8 },
      { transform: 'rotate(-152deg)', offset: 1 }
    ], { duration: total, easing: 'cubic-bezier(.35,.7,.3,1)', fill: 'forwards' });

    const spark = document.createElement('span');
    spark.className = 'dh-spark';
    spark.style.left = (mouth.x - lr.left) + 'px';
    spark.style.top = (mouth.y - lr.top) + 'px';
    layer.appendChild(spark);
    setTimeout(() => spark.remove(), 520);

    state.motionLog.push({ kind, to: [Math.round(end.x), Math.round(end.y)], ms: total });
    if (state.motionLog.length > 18) state.motionLog.shift();

    try { await motion.finished; } catch (e) { /* cancelled */ }
    try {
      grip.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 110, fill: 'forwards' });
      pair.animate([{ transform: 'rotate(-152deg)' }, { transform: 'rotate(-136deg) translate3d(8px, -6px, 0)' }],
        { duration: 130, fill: 'forwards' });
    } catch (e) { /* older browsers */ }
    setTimeout(() => grip.remove(), 150);
  }

  function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

  /* ── card drawing ────────────────────────────────────────── */
  function nextCard() {
    if (state.rig.length) return state.rig.shift();
    return state.shoe.draw();
  }
  function parseCard(str) {
    const m = String(str).match(/^(10|[2-9AJQK])([shdc])$/i);
    if (!m) return null;
    return E.makeCard(m[1].toUpperCase(), m[2].toLowerCase());
  }

  async function drawTo(kind, index, down) {
    const card = nextCard();
    if (!card) return;
    SND.deal();
    await dealerMotion(kind, index);
    if (kind === 'dealer') state.dealer.push(card);
    else state.hands[index].cards.push(card);
    render();
    SND.card();
    if (state.fast) await wait(10);
  }

  /* ── betting ─────────────────────────────────────────────── */
  function placeBet(spot, amount) {
    if (state.phase !== 'betting' || state.busy) return false;
    const amt = amount || state.chip;
    if (amt > state.balance) { toast('잔액이 부족합니다'); return false; }
    if (amt < MIN_BET) { toast('최소 베팅은 ₩1,000입니다'); return false; }
    if (spot === 'main') {
      state.bets.main += amt;
    } else if (spot in state.bets) {
      state.bets[spot] += amt;
    } else return false;
    state.balance -= amt;
    state.betLog.push({ spot, amt });
    SND.chip();
    render();
    return true;
  }

  function refundBet(spot, amt) {
    state.bets[spot] = Math.max(0, state.bets[spot] - amt);
    state.balance += amt;
  }

  function undoBet() {
    if (state.phase !== 'betting' || !state.betLog.length) return;
    const last = state.betLog.pop();
    refundBet(last.spot, last.amt);
    SND.click();
    render();
  }

  function clearBets(silent) {
    if (state.phase !== 'betting') return;
    let total = 0;
    Object.keys(state.bets).forEach((k) => {
      total += state.bets[k];
      state.bets[k] = 0;
    });
    state.balance += total;
    state.betLog = [];
    if (!silent) SND.click();
    render();
  }

  function halfBets() {
    if (state.phase !== 'betting') return;
    Object.keys(state.bets).forEach((k) => {
      const v = state.bets[k];
      if (v <= 0) return;
      const nv = Math.floor(v / 2 / MIN_BET) * MIN_BET;
      state.balance += v - nv;
      state.bets[k] = nv;
    });
    state.betLog = [];
    SND.click();
    render();
  }

  function doubleBets() {
    if (state.phase !== 'betting') return;
    const total = totalBets();
    if (!total) { toast('먼저 베팅하세요'); return; }
    if (total > state.balance) { toast('잔액이 부족합니다'); return; }
    Object.keys(state.bets).forEach((k) => {
      if (state.bets[k] > 0) {
        state.balance -= state.bets[k];
        state.bets[k] *= 2;
      }
    });
    state.betLog = [];
    SND.chip();
    render();
  }

  function rebet() {
    if (state.phase !== 'betting') return;
    const lb = state.lastBets;
    if (!lb) { toast('재베팅할 기록이 없습니다'); return; }
    clearBets(true);
    let need = 0;
    Object.keys(lb).forEach((k) => { need += lb[k]; });
    if (need > state.balance) { toast('잔액이 부족합니다'); return; }
    Object.keys(lb).forEach((k) => {
      if (lb[k] > 0) {
        state.bets[k] = lb[k];
        state.balance -= lb[k];
      }
    });
    SND.chip();
    render();
  }

  /* ── round flow ──────────────────────────────────────────── */
  function resetTable() {
    state.hands = [];
    state.dealer = [];
    state.holeHidden = true;
    state.active = 0;
    state.insurance = 0;
    state.sideStakes = { anyPair: 0, t213: 0, hot3: 0, bustIt: 0 };
    state.earlySide = {};
    state.round = null;
    state.firstCards = [];
    Object.keys(state.bets).forEach((k) => { state.bets[k] = 0; });
    state.betLog = [];
  }

  async function deal() {
    if (state.phase !== 'betting' || state.busy) return;
    if (state.bets.main < MIN_BET) { toast('메인 베팅을 먼저 놓아 주세요'); return; }
    state.busy = true;
    state.lastBets = Object.assign({}, state.bets);
    state.sideStakes = { anyPair: state.bets.anyPair, t213: state.bets.t213, hot3: state.bets.hot3, bustIt: state.bets.bustIt };
    state.lastWin = 0;
    state.hands = [{ cards: [], bet: state.bets.main, doubled: false, fromSplit: false, done: false, result: null }];
    state.dealer = [];
    state.holeHidden = true;
    state.active = 0;
    state.insurance = 0;
    state.earlySide = {};
    state.round = null;
    state.firstCards = [];
    state.phase = 'dealing';
    hideCelebrate();
    render();

    if (state.shoe.needsShuffle()) {
      SND.shuffle();
      el.shuffleVeil.classList.add('on');
      await wait(state.fast ? 60 : 950);
      state.shoe.reshuffle();
      el.shuffleVeil.classList.remove('on');
      render();
    }

    await wait(state.fast ? 20 : 220);
    await drawTo('player', 0);
    await drawTo('dealer', -1);
    await drawTo('player', 0);
    await drawTo('dealer', -1, true);

    state.firstCards = state.hands[0].cards.slice(0, 2);
    // side bets that only need the first three cards
    const c1 = state.firstCards[0], c2 = state.firstCards[1], up = state.dealer[0];
    state.earlySide = {
      anyPair: E.anyPair(c1, c2),
      t213: E.twentyOneThree(c1, c2, up),
      hot3: E.hot3(c1, c2, up)
    };
    render();

    const upIsAce = up.rank === 'A';
    const upIsTen = up.v >= 10;
    if (upIsAce && state.balance >= Math.floor(state.hands[0].bet / 2)) {
      offerInsurance();
      return;
    }
    await afterPeek(upIsTen || upIsAce);
  }

  function offerInsurance() {
    state.phase = 'insurance';
    const amt = Math.floor(state.hands[0].bet / 2);
    state.insurance = 0;
    el.insAmount.textContent = '보험료 ' + money(amt) + ' · 딜러 블랙잭이면 2:1';
    const up = state.dealer[0];
    el.insAce.textContent = up.rank + up.glyph;
    el.insAce.classList.toggle('is-red', !!up.red);
    el.insure.hidden = false;
    $('#insYes').disabled = state.balance < amt;
    SND.insurance();
    render();
    state.pendingInsurance = amt;
  }

  async function resolveInsurance(take) {
    if (state.phase !== 'insurance') return;
    const amt = state.pendingInsurance || 0;
    if (take && state.balance >= amt) {
      state.balance -= amt;
      state.insurance = amt;
      SND.chip();
    }
    el.insure.hidden = true;
    state.pendingInsurance = 0;
    state.busy = true;
    await afterPeek(true);
  }

  async function afterPeek(peek) {
    const dealerBJ = state.dealer.length === 2 && E.handValue(state.dealer).total === 21;
    if (peek) {
      await wait(state.fast ? 40 : 420);
      if (dealerBJ) {
        await revealHole();
        await finishRound();
        return;
      }
    }
    // player natural blackjack pays right away
    if (E.isBlackjack(state.hands[0].cards, false)) {
      await wait(state.fast ? 30 : 320);
      await revealHole();
      await finishRound();
      return;
    }
    state.phase = 'playing';
    state.active = 0;
    state.busy = false;
    render();
    SND.tick();
  }

  async function revealHole() {
    if (!state.holeHidden) return;
    state.holeHidden = false;
    render();
    SND.flip();
    await wait(state.fast ? 40 : 460);
  }

  async function act(kind) {
    if (state.phase !== 'playing' || state.busy) return;
    const hand = activeHand();
    if (!hand || hand.done) return;
    const v = E.handValue(hand.cards);

    if (kind === 'hit') {
      state.busy = true;
      SND.click();
      await drawTo('player', state.active);
      const nv = E.handValue(hand.cards);
      state.busy = false;
      if (nv.bust) {
        SND.bust();
        hand.done = true;
        render();
        await wait(state.fast ? 20 : 520);
        await nextHand();
      } else if (nv.total === 21) {
        hand.done = true;
        render();
        await wait(state.fast ? 20 : 420);
        await nextHand();
      } else {
        render();
      }
      return;
    }

    if (kind === 'stand') {
      hand.done = true;
      SND.click();
      render();
      await nextHand();
      return;
    }

    if (kind === 'double') {
      if (hand.cards.length !== 2 || state.balance < hand.bet) return;
      state.busy = true;
      state.balance -= hand.bet;
      hand.bet *= 2;
      hand.doubled = true;
      SND.chip();
      render();
      await drawTo('player', state.active);
      hand.done = true;
      const nv = E.handValue(hand.cards);
      if (nv.bust) SND.bust();
      render();
      await wait(state.fast ? 20 : 460);
      state.busy = false;
      await nextHand();
      return;
    }

    if (kind === 'split') {
      if (hand.cards.length !== 2 || !E.canSplit(hand.cards)) return;
      if (state.hands.length >= 4 || state.balance < hand.bet) return;
      state.busy = true;
      const moved = hand.cards.pop();
      state.balance -= hand.bet;
      const isAces = hand.cards[0].rank === 'A';
      const nh = {
        cards: [moved], bet: hand.bet, doubled: false, fromSplit: true, done: false,
        result: null, fromSplitAces: isAces
      };
      hand.fromSplit = true;
      hand.fromSplitAces = isAces;
      state.hands.splice(state.active + 1, 0, nh);
      SND.card();
      render();
      await wait(state.fast ? 20 : 240);
      await drawTo('player', state.active);
      if (isAces) {
        hand.done = true;
        SND.click();
        render();
        state.busy = false;
        await nextHand();
        return;
      }
      const nv = E.handValue(hand.cards);
      state.busy = false;
      if (nv.total === 21 || nv.bust) {
        hand.done = true;
        render();
        await wait(state.fast ? 20 : 320);
        await nextHand();
      } else {
        render();
      }
      return;
    }
  }

  async function nextHand() {
    state.busy = true;
    render();
    let i = state.active + 1;
    while (i < state.hands.length && state.hands[i].done) i++;
    if (i >= state.hands.length) {
      state.busy = false;
      await dealerTurn();
      return;
    }
    state.active = i;
    const h = state.hands[i];
    render();
    await wait(state.fast ? 30 : 380);
    if (h.cards.length === 1) {
      await drawTo('player', i);
      const v = E.handValue(h.cards);
      if (h.fromSplitAces) {
        h.done = true;
        SND.click();
        render();
        await wait(state.fast ? 20 : 380);
        await nextHand();
        return;
      }
      if (v.total === 21 || v.bust) {
        h.done = true;
        render();
        await wait(state.fast ? 20 : 420);
        await nextHand();
        return;
      }
    }
    state.busy = false;
    render();
    SND.tick();
  }

  async function dealerTurn() {
    state.phase = 'dealer';
    state.busy = true;
    render();
    await wait(state.fast ? 20 : 260);
    await revealHole();
    const needsPlay = state.hands.some((h) => liveHand(h));
    if (needsPlay) {
      await wait(state.fast ? 10 : 260);
      let guard = 0;
      while (state.dealer.length < 12 && E.handValue(state.dealer).total < 17 && guard++ < 12) {
        await drawTo('dealer', -1);
        await wait(state.fast ? 10 : 220);
      }
    }
    await wait(state.fast ? 20 : 300);
    await finishRound();
  }

  async function finishRound() {
    state.busy = true;
    const res = E.settle({
      hands: state.hands,
      dealer: state.dealer,
      insurance: state.insurance,
      side: state.sideStakes,
      firstCards: state.firstCards
    });
    state.round = res;
    state.balance += res.payout;
    state.phase = 'settle';
    state.lastWin = res.net > 0 ? res.payout : 0;

    state.hands.forEach((h, i) => { h.result = res.hands[i]; });
    state.earlySide = {};

    const anyBJ = res.hands.some((h) => h.outcome === 'blackjack');
    const tag = res.net > 0 ? (anyBJ ? 'bj' : 'win') : res.net === 0 ? 'push' : 'lose';
    state.stats.rounds += 1;
    state.stats.net += res.net;
    if (tag === 'win' || tag === 'bj') state.stats.wins += 1;
    else if (tag === 'push') state.stats.pushes += 1;
    else state.stats.losses += 1;
    if (anyBJ) state.stats.blackjacks += 1;

    const desc = (state.hands.length > 1 ? state.hands.length + '핸드 · ' : '') +
      '딜러 ' + res.dealerTotal + (res.dealerBust ? ' 버스트' : '');
    state.history.unshift({
      tag, net: res.net, desc,
      time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    });
    state.history = state.history.slice(0, 40);

    render();
    SND[tag === 'bj' ? 'blackjack' : tag === 'win' ? 'win' : tag === 'push' ? 'push' : 'lose']();

    if (res.net > 0) {
      showCelebrate(anyBJ ? '블랙잭!' : '플레이어 승', money(res.payout), anyBJ ? 'bj' : 'win');
      const r = el.felt.getBoundingClientRect();
      burst(r.left + r.width / 2, r.top + r.height * .34, anyBJ ? 30 : 18);
    } else if (res.net === 0) {
      showCelebrate('푸시', money(res.payout), 'push');
    }
    renderResult();
    save();
    state.busy = false;
    startNextTimer();
  }

  function showCelebrate(title, amount, kind) {
    const az = document.querySelector('.arc-zone');
    if (az) az.classList.add('is-celebrating');
    el.wcTitle.textContent = title;
    el.wcAmount.textContent = amount.replace('₩', '');
    el.wcWon.textContent = kind === 'push' ? '베팅이 돌아왔습니다' : '이겼습니다';
    el.winCelebrate.className = 'win-celebrate on' + (kind === 'bj' ? ' is-bj' : kind === 'push' ? ' is-push' : '');
  }
  function hideCelebrate() {
    el.winCelebrate.className = 'win-celebrate';
    const az = document.querySelector('.arc-zone');
    if (az) az.classList.remove('is-celebrating');
  }

  function renderResult() {
    const r = state.round;
    if (!r) return;
    el.resNet.textContent = (r.net > 0 ? '+' : r.net < 0 ? '−' : '') + money(Math.abs(r.net));
    el.resNet.className = r.net > 0 ? 'is-win' : r.net < 0 ? 'is-loss' : '';
    let title = r.net > 0 ? '라운드 승리' : r.net === 0 ? '푸시' : '라운드 패배';
    if (r.hands.some((h) => h.outcome === 'blackjack')) title = '블랙잭!';
    el.resTitle.textContent = title;

    const rows = [];
    r.hands.forEach((h, i) => {
      const k = state.hands.length > 1 ? '핸드 ' + (i + 1) : '메인 베팅';
      const v = h.outcome === 'blackjack' ? '블랙잭 +' + money(h.net)
        : h.outcome === 'win' ? '승 +' + money(h.net)
        : h.outcome === 'push' ? '푸시' : '패 −' + money(h.stake);
      rows.push({ k, v, cls: h.outcome === 'lose' ? 'lose' : h.outcome === 'push' ? 'push' : 'win' });
    });
    if (r.insurance) {
      rows.push({
        k: '인슈어런스', cls: r.insurance.win ? 'win' : 'lose',
        v: r.insurance.win ? '적중 +' + money(r.insurance.net) : '패 −' + money(r.insurance.stake)
      });
    }
    ['anyPair', 't213', 'hot3', 'bustIt'].forEach((k) => {
      const s = r.side[k];
      if (!s) return;
      const names = { anyPair: '애니 페어', t213: '21+3', hot3: '핫 3', bustIt: '버스트 잇' };
      const v = s.push ? '푸시' : s.win ? (s.name ? s.name + ' ' : '') + '+' + money(s.net) : '패 −' + money(s.stake);
      rows.push({ k: names[k], v, cls: s.push ? 'push' : s.win ? 'win' : 'lose' });
    });
    el.resRows.innerHTML = rows.map((x) =>
      '<div class="res-row ' + x.cls + '"><span class="rr-k">' + x.k + '</span><span class="rr-v">' + x.v + '</span></div>'
    ).join('');
  }

  let nextTimerId = 0;
  let nextLeft = 7;
  function startNextTimer() {
    nextLeft = 7;
    el.nextTimer.textContent = String(nextLeft);
    clearInterval(nextTimerId);
    nextTimerId = setInterval(() => {
      if (!state.autoNext || document.hidden) return;
      if ($('#modalBack') && !$('#modalBack').hidden) return;
      if (!el.insure.hidden) return;
      nextLeft -= 1;
      el.nextTimer.textContent = String(Math.max(0, nextLeft));
      if (nextLeft <= 0) {
        clearInterval(nextTimerId);
        continueRound();
      }
    }, 1000);
  }

  function continueRound() {
    if (state.phase !== 'settle') return;
    clearInterval(nextTimerId);
    hideCelebrate();
    el.insure.hidden = true;
    state.busy = false;
    state.phase = 'betting';
    state.hands = [];
    state.dealer = [];
    state.holeHidden = true;
    state.insurance = 0;
    state.sideStakes = { anyPair: 0, t213: 0, hot3: 0, bustIt: 0 };
    state.earlySide = {};
    state.round = null;
    state.firstCards = [];
    state.bets = { main: 0, anyPair: 0, t213: 0, hot3: 0, bustIt: 0 };
    state.betLog = [];
    el.resRows.innerHTML = '';
    SND.click();
    render();
    if (state.shoe.needsShuffle()) {
      el.shuffleVeil.classList.add('on');
      SND.shuffle();
      setTimeout(() => {
        state.shoe.reshuffle();
        el.shuffleVeil.classList.remove('on');
        render();
      }, 800);
    }
  }

  /* ── wiring ──────────────────────────────────────────────── */
  function setChip(v) {
    state.chip = v;
    SND.click();
    renderChips();
  }

  function bindBetDeck() {
    $$('.chip', $('#chipRow')).forEach((c) => {
      c.addEventListener('click', () => setChip(Number(c.dataset.chip)));
    });
    el.dealBtn.addEventListener('click', deal);
    $('#undoBtn').addEventListener('click', undoBet);
    $('#rebetBtn').addEventListener('click', rebet);
    $('#halfBtn').addEventListener('click', halfBets);
    $('#doubleBtn').addEventListener('click', doubleBets);
    $('#clearBtn').addEventListener('click', () => clearBets());
  }

  function bindTable() {
    el.playerZone.addEventListener('click', (e) => {
      const spot = e.target.closest('.bet-spot');
      if (!spot) return;
      if (state.phase !== 'betting') return;
      placeBet('main');
    });
    $$('.side-zone').forEach((z) => {
      z.addEventListener('click', () => {
        if (state.phase !== 'betting') return;
        placeBet(z.dataset.side);
      });
    });
    $$('.act', el.actionDeck).forEach((b) => {
      b.addEventListener('click', () => act(b.dataset.act));
    });
    el.nextBtn.addEventListener('click', continueRound);
    $('#insYes').addEventListener('click', () => resolveInsurance(true));
    $('#insNo').addEventListener('click', () => resolveInsurance(false));
    el.shoe.addEventListener('click', () => {
      if (state.phase !== 'betting' || state.busy) return;
      SND.shuffle();
      el.shuffleVeil.classList.add('on');
      setTimeout(() => {
        state.shoe.reshuffle();
        el.shuffleVeil.classList.remove('on');
        render();
        toast('슈를 새로 섞었습니다');
      }, 900);
    });
  }

  function bindChrome() {
    el.soundBtn.addEventListener('click', () => {
      state.sound = !state.sound;
      applySound();
      if (state.sound) SND.click();
      save();
    });
    $('#refillBtn').addEventListener('click', () => {
      state.balance += 1000000000;
      SND.chip();
      toast('가상 머니 +₩10억');
      render();
      save();
    });
    $('#infoBtn').addEventListener('click', openRules);

    // hidden admin: double tap/click the logo
    let taps = 0, tapTimer = 0;
    el.app.querySelector('#brand').addEventListener('click', () => {
      taps += 1;
      clearTimeout(tapTimer);
      tapTimer = setTimeout(() => { taps = 0; }, 420);
      if (taps >= 2) { taps = 0; openPin(); }
    });

    $('#modalClose').addEventListener('click', closeRules);
    $('#histClose').addEventListener('click', closeHistory);
    $('#modalBack').addEventListener('click', (e) => { if (e.target.id === 'modalBack') closeRules(); });
    $('#histBack').addEventListener('click', (e) => { if (e.target.id === 'histBack') closeHistory(); });

    $('#optSound').addEventListener('change', (e) => {
      state.sound = e.target.checked;
      applySound();
      save();
    });
    $('#optMotion').addEventListener('change', (e) => { state.motion = e.target.checked; save(); });
    $('#optAuto').addEventListener('change', (e) => { state.autoNext = e.target.checked; save(); });

    $('#modalRefill').addEventListener('click', () => {
      state.balance += 1000000000;
      SND.chip();
      render();
      save();
      toast('가상 머니 +₩10억');
    });
    $('#modalReset').addEventListener('click', () => {
      state.balance = START_BALANCE;
      render();
      save();
      toast('잔액을 ₩10억으로 초기화했습니다');
    });
  }

  /* ── member account (바카라와 공용) ───────────────────── */
  let authMode = 'login';

  function setAuthMsg(msg, ok) {
    const box = $('#authMsg');
    if (!box) return;
    box.textContent = msg || '';
    box.classList.toggle('ok', !!ok);
  }

  function setAuthMode(mode) {
    authMode = mode;
    const isAccount = mode === 'account';
    const isSignup = mode === 'signup';
    $('#authTabs').hidden = isAccount;
    $('#authForm').hidden = isAccount;
    $('#authProfile').hidden = !isAccount;
    $('#guestBtn').hidden = isAccount;
    $('#nickFld').classList.toggle('is-hidden', !isSignup);
    $('#pin2Fld').classList.toggle('is-hidden', !isSignup);
    $('#authSubmit').textContent = isSignup ? '가입하고 시작하기' : '로그인';
    $$('#authTabs button[data-auth]').forEach((b) => b.classList.toggle('is-active', b.dataset.auth === mode));
    setAuthMsg('');
    if (isAccount) {
      const p = ACC ? ACC.profile() : null;
      const name = state.nickname;
      $('#apAvatar').textContent = (name || 'E').slice(0, 1).toUpperCase();
      $('#apName').textContent = name;
      $('#apBalance').textContent = money(state.balance);
      $('#apRole').textContent = (p && ACC.db.current && p.id) ? '@' + p.id : '게스트 계정';
    }
  }

  function openAuth(mode) {
    if (!ACC) { toast('계정 저장소를 불러오지 못했습니다'); return; }
    const opened = mode || (ACC.db.current ? 'account' : 'login');
    setAuthMode(opened);
    $('#authBack').hidden = false;
    SND.click();
    if (opened !== 'account') setTimeout(() => { const f = $('#authId'); if (f) f.focus(); }, 80);
  }

  function closeAuth() { $('#authBack').hidden = true; }

  function syncFromAccount() {
    load();
    render();
    renderRulesAccount();
  }

  async function submitAuth(ev) {
    ev.preventDefault();
    if (!ACC) return;
    if (state.phase !== 'betting') { setAuthMsg('핸드가 끝난 뒤 계정을 바꿀 수 있습니다'); return; }
    const id = ($('#authId').value || '').trim();
    const nick = ($('#authNick').value || '').trim();
    const pin = ($('#authPin').value || '').trim();
    const pin2 = ($('#authPin2').value || '').trim();
    setAuthMsg('');

    const res = authMode === 'signup'
      ? await ACC.signup(id, nick, pin, pin2)
      : await ACC.login(id, pin);
    if (!res.ok) { setAuthMsg(res.error); return; }

    syncFromAccount();
    SND.win();
    toast((res.profile.nick || res.profile.id) + '님 환영합니다');
    if (authMode === 'signup') setAuthMsg('가입 완료 · ₩10억 가상 머니 지급', true);
    setTimeout(() => { closeAuth(); renderRulesAccount(); }, authMode === 'signup' ? 620 : 220);
  }

  function logoutMember() {
    if (!ACC) return;
    if (state.phase !== 'betting') { toast('핸드가 끝난 뒤 로그아웃할 수 있습니다'); return; }
    save();
    ACC.logout();
    syncFromAccount();
    closeAuth();
    toast('로그아웃 · 게스트 계정으로 플레이합니다');
    SND.click();
  }

  function renderRulesAccount() {
    if (!$('#mAccount')) return;
    const logged = !!(ACC && ACC.db.current);
    const p = ACC ? ACC.profile() : null;
    $('#maAvatar').textContent = (state.nickname || 'G').slice(0, 1).toUpperCase();
    $('#maName').textContent = state.nickname;
    $('#maRole').textContent = logged ? '@' + ((p && p.id) || '') + ' · 바카라와 같은 계정' : '로그인하면 바카라와 같은 계정을 씁니다';
    $('#maOpen').textContent = logged ? '계정 관리' : '로그인 / 가입';
  }

  function bindAccount() {
    $('#userChip').addEventListener('click', () => openAuth());
    if ($('#maOpen')) $('#maOpen').addEventListener('click', () => { closeRules(); openAuth(); });
    $('#authClose').addEventListener('click', closeAuth);
    $('#authBack').addEventListener('click', (e) => { if (e.target.id === 'authBack') closeAuth(); });
    $('#authTabs').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-auth]');
      if (b) setAuthMode(b.dataset.auth);
    });
    $('#authForm').addEventListener('submit', submitAuth);
    $('#guestBtn').addEventListener('click', closeAuth);
    $('#apLogout').addEventListener('click', logoutMember);
    $('#apSwitch').addEventListener('click', () => setAuthMode('login'));
    $('#apHistory').addEventListener('click', () => { closeAuth(); openHistory(); });
  }

  function openRules() {
    $('#modalBack').hidden = false;
    $('#modalBalance').textContent = money(state.balance);
    $('#optSound').checked = state.sound;
    $('#optMotion').checked = state.motion;
    $('#optAuto').checked = state.autoNext;
    renderRulesAccount();
  }
  function closeRules() { $('#modalBack').hidden = true; }
  function openHistory() {
    $('#histBack').hidden = false;
    renderHistory();
  }
  function closeHistory() { $('#histBack').hidden = true; }

  /* admin */
  let pinBuf = '';

  function renderAdmin() {
    const ab = $('#admBalance');
    if (ab) ab.textContent = money(state.balance);
    const rounds = $('#admRounds');
    if (rounds) rounds.textContent = state.stats.rounds || 0;
    const net = $('#admNet');
    if (net) net.textContent = money(state.stats.net || 0);
    const bj = $('#admBJ');
    if (bj) bj.textContent = state.stats.blackjacks || 0;

    const box = $('#admUsers');
    if (!box) return;
    if (!ACC) { box.innerHTML = '<div class="adm-note">계정 저장소를 불러오지 못했습니다</div>'; return; }
    const cur = ACC.db.current || 'guest';
    box.innerHTML = ACC.members().map((r) => {
      const p = r.profile;
      const label = r.guest ? '게스트' : (p.nick || p.id);
      const initial = String(label).trim().slice(0, 1).toUpperCase() || 'G';
      return '<div class="adm-user' + (r.key === cur ? ' is-current' : '') + '" data-uid="' + esc(r.key) + '">' +
        '<span class="au-avatar">' + esc(initial) + '</span>' +
        '<div class="au-id"><b>' + esc(label) + '</b><i>' + (r.guest ? 'GUEST' : '@' + esc(p.id)) + (r.key === cur ? ' · 현재 세션' : '') + '</i></div>' +
        '<span class="au-bal">' + money(p.balance) + '</span>' +
        '<div class="au-btns">' +
          '<button data-op="minus" class="minus" aria-label="차감">−</button>' +
          '<button data-op="plus" class="plus" aria-label="추가">+</button>' +
          '<button data-op="reset" class="reset" aria-label="잔액 초기화">초기화</button>' +
        '</div></div>';
    }).join('');
  }

  function esc(str) {
    return String(str == null ? '' : str).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  /** 관리자 잔액 조정 — 공용 계정 저장소에 적용하고 현재 세션이면 테이블에도 반영 */
  function adjustMember(uid, op, override) {
    if (!ACC) return;
    const typed = override != null ? Math.abs(Math.round(override))
      : Math.abs(Math.round(Number(String($('#admAmount').value || '').replace(/[^0-9]/g, '')) || 0));
    const p = ACC.adjust(uid, op, typed);
    if (!p) return;
    if (uid === (ACC.db.current || 'guest')) {
      state.balance = p.balance;
      render();
    }
    SND.chip();
    renderAdmin();
    if ($('#adminBack') && !$('#adminBack').hidden) $('#admBalance').textContent = money(state.balance);
    toast((uid === 'guest' ? '게스트' : (p.nick || p.id)) + ' · ' + money(p.balance));
  }

  function openPin() {
    pinBuf = '';
    $('#pinBack').hidden = false;
    $('#pinMsg').textContent = '비밀번호 4자리를 입력하세요';
    $('#pinMsg').classList.remove('err');
    drawDots();
  }
  function closePin() { $('#pinBack').hidden = true; }
  function drawDots() {
    $$('#pinDots i').forEach((d, i) => d.classList.toggle('on', i < pinBuf.length));
  }
  function keyPin(k) {
    if (k === 'clear') { pinBuf = ''; drawDots(); return; }
    if (k === 'back') { pinBuf = pinBuf.slice(0, -1); drawDots(); return; }
    if (pinBuf.length >= 4) return;
    pinBuf += k;
    SND.click();
    drawDots();
    if (pinBuf.length === 4) {
      if (pinBuf === PIN) {
        closePin();
        setTimeout(openAdmin, 180);
      } else {
        $('#pinMsg').textContent = '비밀번호가 올바르지 않습니다';
        $('#pinMsg').classList.add('err');
        setTimeout(() => { pinBuf = ''; drawDots(); $('#pinMsg').textContent = '다시 입력하세요'; }, 600);
      }
    }
  }
  function openAdmin() {
    $('#adminBack').hidden = false;
    $('#admBalance').textContent = money(state.balance);
    $('#admAmount').value = '100000';
    $('#admNick').value = state.nickname;
    renderAdmin();
    renderHistory();
  }
  function bindAdmin() {
    $$('#keypad button').forEach((b) => b.addEventListener('click', () => keyPin(b.dataset.key)));
    $('#pinClose').addEventListener('click', closePin);
    $('#pinBack').addEventListener('click', (e) => { if (e.target.id === 'pinBack') closePin(); });
    $('#adminClose').addEventListener('click', () => { $('#adminBack').hidden = true; save(); });
    $('#adminBack').addEventListener('click', (e) => { if (e.target.id === 'adminBack') { $('#adminBack').hidden = true; save(); } });
    $$('.adm-presets button').forEach((b) => {
      b.addEventListener('click', () => {
        const preset = b.dataset.preset;
        const uid = (ACC && ACC.db.current) || 'guest';
        if (preset === 'reset') { adjustMember(uid, 'reset'); return; }
        const n = parseInt(preset, 10) || 0;
        $('#admAmount').value = String(Math.abs(n));
        adjustMember(uid, n >= 0 ? 'plus' : 'minus', Math.abs(n));
      });
    });
    if ($('#admUsers')) {
      $('#admUsers').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-op]');
        if (!b) return;
        const row = b.closest('.adm-user');
        if (!row) return;
        adjustMember(row.dataset.uid, b.dataset.op);
      });
    }
    const applyAdmAmount = () => {
      const v = parseInt(String($('#admAmount').value).replace(/[^0-9-]/g, ''), 10);
      if (isNaN(v) || v === 0) { toast('금액을 입력하세요'); return; }
      const uid = (ACC && ACC.db.current) || 'guest';
      adjustMember(uid, v > 0 ? 'plus' : 'minus', Math.abs(v));
    };
    $('#admApply').addEventListener('click', applyAdmAmount);
    $('#admAmount').addEventListener('change', applyAdmAmount);
    $('#admNickSave').addEventListener('click', () => {
      const v = $('#admNick').value.trim().slice(0, 12);
      if (!v) return;
      state.nickname = v;
      if (ACC) { ACC.profile().nick = v; }
      save();
      render();
      renderAdmin();
      toast('닉네임을 저장했습니다');
    });
    document.addEventListener('keydown', (e) => {
      if ($('#pinBack').hidden) return;
      if (/^[0-9]$/.test(e.key)) keyPin(e.key);
      else if (e.key === 'Backspace') keyPin('back');
      else if (e.key === 'Escape') closePin();
    });
  }

  /* gestures / double-tap zoom guard */
  function bindGuards() {
    document.addEventListener('dblclick', (e) => {
      if (e.target.closest('#brand')) return;
      e.preventDefault();
    }, { passive: false });
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('touchmove', (e) => {
      if (e.touches.length > 1) e.preventDefault();
    }, { passive: false });

    // 바카라로 이동하거나 새로고침할 때, 아직 정산되지 않은 베팅은 잔액으로 돌려줍니다
    window.addEventListener('pagehide', () => {
      if (!state.phase || state.phase === 'settle') return;
      let refund = 0;
      if (state.phase === 'betting') {
        Object.keys(state.bets).forEach((k) => { refund += Math.max(0, Math.round(state.bets[k] || 0)); state.bets[k] = 0; });
      } else {
        refund += Math.max(0, Math.round(state.insurance || 0));
        Object.keys(state.sideStakes).forEach((k) => {
          refund += Math.max(0, Math.round(state.sideStakes[k] || 0));
          state.sideStakes[k] = 0;
        });
        state.hands.forEach((h) => { refund += Math.max(0, Math.round(h.bet || 0)); h.bet = 0; });
        state.insurance = 0;
      }
      if (refund > 0) { state.balance += refund; save(); }
    });
  }

  /* splash */
  function splash() {
    const sp = $('#splash');
    if (!sp) return;
    const off = () => { sp.classList.add('off'); setTimeout(() => sp.remove(), 800); };
    setTimeout(off, 2100);
    sp.addEventListener('click', off);
  }

  /* ── init ────────────────────────────────────────────────── */
  function init() {
    load();
    applySound();
    bindBetDeck();
    bindTable();
    bindChrome();
    bindAccount();
    bindAdmin();
    bindGuards();
    splash();
    render();

    // 바카라 탭에서 로그인·잔액이 바뀌면 이 화면도 따라갑니다
    if (ACC) {
      ACC.subscribe((kind) => {
        if (kind !== 'external') return;
        if (state.phase !== 'betting' || state.busy) return;
        syncFromAccount();
      });
    }

    window.__APP_READY__ = true;
  }

  /* test / debug surface */
  window.__bc = {
    state, E, account: ACC,
    placeBet, deal, act, continueRound,
    setChip, clearBets, rebet, halfBets, doubleBets, undoBet,
    takeInsurance: (v) => resolveInsurance(!!v),
    renderAll: render, render,
    openAuth, logoutMember, adjustMember, renderAdmin,
    setBalance: (n) => { state.balance = Math.max(0, Number(n) || 0); render(); save(); },
    rig: (seq) => { state.rig = (seq || []).map(parseCard).filter(Boolean); },
    fast: (v) => { state.fast = !!v; },
    motionLog: () => state.motionLog,
    reset: () => {
      clearInterval(nextTimerId);
      hideCelebrate();
      el.insure.hidden = true;
      el.resRows.innerHTML = '';
      state.phase = 'betting';
      state.busy = false;
      state.hands = []; state.dealer = []; state.holeHidden = true;
      state.insurance = 0; state.pendingInsurance = 0;
      state.sideStakes = { anyPair: 0, t213: 0, hot3: 0, bustIt: 0 };
      state.earlySide = {}; state.round = null; state.firstCards = [];
      state.bets = { main: 0, anyPair: 0, t213: 0, hot3: 0, bustIt: 0 };
      state.betLog = []; state.rig = []; state.lastWin = 0;
      state.balance = START_BALANCE;
      state.history = []; state.stats = { rounds: 0, wins: 0, losses: 0, pushes: 0, blackjacks: 0, net: 0 };
      state.shoe.reshuffle();
      render();
      save();
    },
    closeRules, openRules, openHistory
  };

  init();
})();
