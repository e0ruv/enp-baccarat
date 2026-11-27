/* ══════════════════════════════════════════════════════════════
   ENP BLACKJACK — Engine
   8-deck shoe · S17 blackjack · split / double / insurance ·
   Any Pair · 21+3 · Hot 3 · Bust It side bets
   Pure rules. No DOM. Every payout is computed here.
   ══════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  const DECKS = 8;
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const SUITS = ['s', 'h', 'd', 'c'];
  const SUIT_GLYPH = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const SUIT_NAME = { s: '스페이드', h: '하트', d: '다이아', c: '클럽' };
  const RED = { h: 1, d: 1 };

  /* ── paytables (Evolution Infinite Blackjack) ─────────────── */
  const PAY = {
    blackjack: 1.5,
    win: 1,
    insurance: 2,
    anyPair: { suited: 25, pair: 8 },
    t213: { suitedTrips: 100, straightFlush: 40, trips: 30, straight: 10, flush: 5 },
    hot3: { triple7: 100, suited21: 20, unsuited21: 4, total20: 2, total19: 1 },
    bustIt: { 3: 1, 4: 2, 5: 9, 6: 50, 7: 100, 8: 250 }
  };

  /* ── cards ────────────────────────────────────────────────── */
  function rankValue(rank) {
    if (rank === 'A') return 1;
    if (rank === 'K' || rank === 'Q' || rank === 'J' || rank === '10') return 10;
    return parseInt(rank, 10);
  }

  function makeCard(rank, suit) {
    return {
      rank: rank,
      suit: suit,
      v: rankValue(rank),
      glyph: SUIT_GLYPH[suit],
      red: !!RED[suit],
      id: rank + suit
    };
  }

  function buildShoe(decks) {
    const cards = [];
    const n = decks || DECKS;
    for (let d = 0; d < n; d++) {
      for (let s = 0; s < SUITS.length; s++) {
        for (let r = 0; r < RANKS.length; r++) cards.push(makeCard(RANKS[r], SUITS[s]));
      }
    }
    return cards;
  }

  function shuffle(cards, rng) {
    const rand = rng || Math.random;
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = cards[i];
      cards[i] = cards[j];
      cards[j] = t;
    }
    return cards;
  }

  /* Deterministic RNG for tests / reproducible shoes (mulberry32). */
  function seeded(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function Shoe(decks, rng) {
    this.decks = decks || DECKS;
    this.rng = rng || Math.random;
    this.cards = shuffle(buildShoe(this.decks), this.rng);
    this.dealt = 0;
    this.cut = 52; // reshuffle before a round when fewer than this remain
  }
  Shoe.prototype.remaining = function () { return this.cards.length - this.dealt; };
  Shoe.prototype.draw = function () {
    if (this.remaining() <= 0) {
      this.cards = shuffle(buildShoe(this.decks), this.rng);
      this.dealt = 0;
    }
    return this.cards[this.dealt++];
  };
  Shoe.prototype.needsShuffle = function () { return this.remaining() < this.cut; };
  Shoe.prototype.reshuffle = function () {
    this.cards = shuffle(buildShoe(this.decks), this.rng);
    this.dealt = 0;
  };

  /* ── hand math ────────────────────────────────────────────── */
  function handValue(cards) {
    let total = 0;
    let aces = 0;
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      if (c.v === 1) { aces++; total += 11; } else total += c.v;
    }
    while (total > 21 && aces > 0) { total -= 10; aces--; }
    return {
      total: total,
      soft: aces > 0 && total <= 21,
      hard: aces > 0 ? total - 10 : total,
      bust: total > 21
    };
  }

  function label(cards) {
    const v = handValue(cards);
    if (v.bust) return String(v.total);
    if (v.soft && v.total !== 21) return v.hard + '/' + v.total;
    return String(v.total);
  }

  function isBlackjack(cards, fromSplit) {
    return cards.length === 2 && !fromSplit && handValue(cards).total === 21;
  }

  function isPair(cards) {
    return cards.length >= 2 && cards[0].rank === cards[1].rank;
  }

  /* Split is allowed on equal values, so 10-J-Q-K mix freely. */
  function canSplit(cards) {
    return cards.length === 2 && cards[0].v === cards[1].v;
  }

  function dealerShouldHit(cards) {
    return handValue(cards).total < 17; // dealer stands on all 17s (incl. soft 17)
  }

  /* ── side bet: Any Pair ───────────────────────────────────── */
  function anyPair(c1, c2) {
    if (!c1 || !c2 || c1.rank !== c2.rank) return { win: false, pay: 0, name: '노 페어' };
    const suited = c1.suit === c2.suit;
    return {
      win: true,
      pay: suited ? PAY.anyPair.suited : PAY.anyPair.pair,
      name: suited ? '수티드 페어' : '애니 페어'
    };
  }

  /* ── side bet: 21+3 (three-card poker) ────────────────────── */
  const STRAIGHT_ORDER = { A: 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13 };

  function isStraight(ranks) {
    const vals = ranks.map((r) => STRAIGHT_ORDER[r]).sort((a, b) => a - b);
    if (vals[0] + 1 === vals[1] && vals[1] + 1 === vals[2]) return true;
    // A-K-Q (ace high) and A-2-3 (ace low)
    const set = vals.join(',');
    return set === '1,12,13' || set === '1,2,3';
  }

  function twentyOneThree(c1, c2, up) {
    const cards = [c1, c2, up];
    if (!c1 || !c2 || !up) return { win: false, pay: 0, name: '-' };
    const ranks = cards.map((c) => c.rank);
    const suited = cards.every((c) => c.suit === cards[0].suit);
    const trips = ranks[0] === ranks[1] && ranks[1] === ranks[2];
    const straight = isStraight(ranks);
    if (trips && suited) return { win: true, pay: PAY.t213.suitedTrips, name: '수티드 트립스' };
    if (trips) return { win: true, pay: PAY.t213.trips, name: '트리플' };
    if (straight && suited) return { win: true, pay: PAY.t213.straightFlush, name: '스트레이트 플러시' };
    if (straight) return { win: true, pay: PAY.t213.straight, name: '스트레이트' };
    if (suited) return { win: true, pay: PAY.t213.flush, name: '플러시' };
    return { win: false, pay: 0, name: '-' };
  }

  /* ── side bet: Hot 3 ──────────────────────────────────────── */
  function hot3(c1, c2, up) {
    const cards = [c1, c2, up];
    if (!c1 || !c2 || !up) return { win: false, pay: 0, name: '-' };
    const total = handValue(cards).total;
    const suited = cards.every((c) => c.suit === cards[0].suit);
    const triple7 = cards.every((c) => c.rank === '7');
    if (triple7) return { win: true, pay: PAY.hot3.triple7, name: '777' };
    if (total === 21 && suited) return { win: true, pay: PAY.hot3.suited21, name: '21 수티드' };
    if (total === 21) return { win: true, pay: PAY.hot3.unsuited21, name: '21' };
    if (total === 20) return { win: true, pay: PAY.hot3.total20, name: '20' };
    if (total === 19) return { win: true, pay: PAY.hot3.total19, name: '19' };
    return { win: false, pay: 0, name: '-' };
  }

  /* ── side bet: Bust It ────────────────────────────────────── */
  function bustIt(dealerCards, playerNatural) {
    if (playerNatural) return { push: true, win: false, pay: 0, name: '블랙잭 푸시' };
    const v = handValue(dealerCards);
    if (!v.bust) return { win: false, pay: 0, name: '버스트 없음' };
    const n = dealerCards.length;
    const pay = PAY.bustIt[Math.min(Math.max(n, 3), 8)];
    return { win: true, pay: pay, name: n + '장 버스트' };
  }

  /* ── settlement ───────────────────────────────────────────── */
  /*
    round = {
      hands: [{ cards, bet, doubled, fromSplit, blackjack }],
      dealer: [cards],
      insurance: amount,
      side: { anyPair, t213, hot3, bustIt },
      firstCards: [c1, c2]  // the original two player cards (side bets)
    }
    returns { stake, payout, net, hands:[{...}], side:{...}, insurance:{...} }
  */
  function settle(round) {
    const dealer = round.dealer || [];
    const dv = handValue(dealer);
    const dealerBJ = dealer.length === 2 && dv.total === 21;
    const dealerBust = dv.bust;
    const first = round.firstCards || (round.hands[0] && round.hands[0].cards.slice(0, 2)) || [];
    const playerNatural = isBlackjack(first, false);

    const out = { stake: 0, payout: 0, net: 0, hands: [], side: {}, insurance: null };

    (round.hands || []).forEach(function (h, i) {
      const bet = h.bet;
      const hv = handValue(h.cards);
      const bj = isBlackjack(h.cards, h.fromSplit);
      let res;
      if (hv.bust) res = { outcome: 'lose', pay: 0, label: '버스트' };
      else if (bj && dealerBJ) res = { outcome: 'push', pay: 0, label: '푸시' };
      else if (bj) res = { outcome: 'blackjack', pay: PAY.blackjack, label: '블랙잭' };
      else if (dealerBJ) res = { outcome: 'lose', pay: 0, label: '딜러 블랙잭' };
      else if (dealerBust) res = { outcome: 'win', pay: PAY.win, label: '딜러 버스트' };
      else if (hv.total > dv.total) res = { outcome: 'win', pay: PAY.win, label: hv.total + ' 대 ' + dv.total };
      else if (hv.total === dv.total) res = { outcome: 'push', pay: 0, label: hv.total + ' 동점' };
      else res = { outcome: 'lose', pay: 0, label: hv.total + ' 대 ' + dv.total };

      const stake = bet;
      const payout = res.outcome === 'push' ? bet
        : res.outcome === 'lose' ? 0
        : Math.floor(bet * (1 + res.pay));
      out.stake += stake;
      out.payout += payout;
      out.hands.push({
        index: i, bet: bet, total: hv.total, soft: hv.soft, bust: hv.bust,
        blackjack: bj, outcome: res.outcome, label: res.label,
        pay: res.pay, stake: stake, payout: payout, net: payout - stake
      });
    });

    /* insurance */
    if (round.insurance && round.insurance > 0) {
      const insStake = round.insurance;
      const insPayout = dealerBJ ? Math.floor(insStake * (1 + PAY.insurance)) : 0;
      out.stake += insStake;
      out.payout += insPayout;
      out.insurance = {
        stake: insStake, payout: insPayout, net: insPayout - insStake,
        win: dealerBJ, label: dealerBJ ? '인슈어런스 적중' : '인슈어런스 패'
      };
    }

    /* side bets */
    const side = round.side || {};
    const c1 = first[0];
    const c2 = first[1];
    const up = dealer[0];

    if (side.anyPair > 0) {
      const r = anyPair(c1, c2);
      const payout = r.win ? Math.floor(side.anyPair * (1 + r.pay)) : 0;
      out.stake += side.anyPair; out.payout += payout;
      out.side.anyPair = {
        stake: side.anyPair, payout: payout, net: payout - side.anyPair,
        win: r.win, pay: r.pay, name: r.name, label: r.win ? '애니 페어 ' + r.name : '애니 페어 패'
      };
    }
    if (side.t213 > 0) {
      const r = twentyOneThree(c1, c2, up);
      const payout = r.win ? Math.floor(side.t213 * (1 + r.pay)) : 0;
      out.stake += side.t213; out.payout += payout;
      out.side.t213 = {
        stake: side.t213, payout: payout, net: payout - side.t213,
        win: r.win, pay: r.pay, name: r.name, label: r.win ? '21+3 ' + r.name : '21+3 패'
      };
    }
    if (side.hot3 > 0) {
      const r = hot3(c1, c2, up);
      const payout = r.win ? Math.floor(side.hot3 * (1 + r.pay)) : 0;
      out.stake += side.hot3; out.payout += payout;
      out.side.hot3 = {
        stake: side.hot3, payout: payout, net: payout - side.hot3,
        win: r.win, pay: r.pay, name: r.name, label: r.win ? '핫 3 ' + r.name : '핫 3 패'
      };
    }
    if (side.bustIt > 0) {
      const r = bustIt(dealer, playerNatural);
      const payout = r.push ? side.bustIt : (r.win ? Math.floor(side.bustIt * (1 + r.pay)) : 0);
      out.stake += side.bustIt; out.payout += payout;
      out.side.bustIt = {
        stake: side.bustIt, payout: payout, net: payout - side.bustIt,
        win: r.win, push: !!r.push, pay: r.pay, name: r.name,
        label: r.push ? '버스트 잇 푸시' : (r.win ? '버스트 잇 ' + r.name : '버스트 잇 패')
      };
    }

    out.net = out.payout - out.stake;
    out.dealerBlackjack = dealerBJ;
    out.dealerBust = dealerBust;
    out.dealerTotal = dv.total;
    out.playerNatural = playerNatural;
    return out;
  }

  const api = {
    DECKS, RANKS, SUITS, SUIT_GLYPH, SUIT_NAME, PAY,
    rankValue, makeCard, buildShoe, shuffle, seeded, Shoe,
    handValue, label, isBlackjack, isPair, canSplit, dealerShouldHit,
    isStraight, anyPair, twentyOneThree, hot3, bustIt, settle
  };

  root.ENPBlackjack = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
