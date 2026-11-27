/* ══════════════════════════════════════════════════════════════
   ENP BACCARAT — Core engine
   8-deck Punto Banco shoe + Punto Banco 3rd-card tableau
   + bonus-card multipliers for Lightning / Sakura / Snow tables
   ══════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const SUITS = ['s', 'h', 'd', 'c'];
  const SUIT_SYMBOL = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const VALUES = {
    A: 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
    '10': 0, J: 0, Q: 0, K: 0
  };

  /** Player / Banker bonus side bet: payout by the hand's point total. */
  const BONUS_TOTALS = { 9: 30, 8: 10, 7: 6, 6: 4, 5: 3, 4: 2 };

  /** Pair flavour used by Perfect Pair / Either Pair side bets. */
  function pairKind(a, b) {
    if (!a || !b || a.rank !== b.rank) return null;
    if (a.suit === b.suit) return 'perfect';
    const red = (c) => c.suit === 'h' || c.suit === 'd';
    return red(a) === red(b) ? 'colored' : 'mixed';
  }

  /** Table configurations — three tables, all virtual money. */
  const MODES = {
    speed: {
      id: 'speed',
      name: '스피드 바카라',
      en: 'SPEED',
      short: '스피드',
      icon: '🚀',
      fee: 0,
      payouts: { player: 1, banker: 0.95, tie: 8, playerPair: 11, bankerPair: 11, playerBonus: 30, bankerBonus: 30, perfectPair: 25, eitherPair: 5 },
      perfectDouble: 200,
      bonusTotals: BONUS_TOTALS,
      bonus: null,
      dealDelay: 55,
      flipDelay: 0,
      arch: '0.35s INSTANT DEAL',
      tag: 'CLASSIC PAYOUTS'
    },
    sakura: {
      id: 'sakura',
      name: '벚꽃 바카라',
      en: 'BLOSSOM',
      short: '벚꽃',
      icon: '🌸',
      fee: 0,
      payouts: { player: 1, banker: 0.95, tie: 8, playerPair: 11, bankerPair: 11, playerBonus: 30, bankerBonus: 30, perfectPair: 25, eitherPair: 5 },
      perfectDouble: 200,
      bonusTotals: BONUS_TOTALS,
      bonus: { min: 7, max: 7, multipliers: [2, 3, 4, 4, 5, 5, 8], noun: '벚꽃 카드' },
      dealDelay: 260,
      flipDelay: 190,
      arch: '2x ~ 512x',
      tag: 'BLOSSOM BONUS'
    },
    snow: {
      id: 'snow',
      name: '눈꽃 바카라',
      en: 'SNOWFLAKE',
      short: '눈꽃',
      icon: '❄️',
      fee: 0,
      payouts: { player: 1, banker: 0.95, tie: 8, playerPair: 11, bankerPair: 11, playerBonus: 30, bankerBonus: 30, perfectPair: 25, eitherPair: 5 },
      perfectDouble: 200,
      bonusTotals: BONUS_TOTALS,
      bonus: { min: 7, max: 7, multipliers: [2, 3, 4, 4, 5, 5, 8], noun: '눈꽃 크리스탈' },
      dealDelay: 260,
      flipDelay: 190,
      arch: '2x ~ 512x',
      tag: 'FROST BONUS'
    }
  };

  /** Build one fresh deck (52 cards). */
  function buildDeck() {
    const deck = [];
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push({ rank, suit, id: rank + suit });
      }
    }
    return deck;
  }

  /** Fisher–Yates shuffle (in place). */
  function shuffle(cards, rng) {
    const rand = rng || Math.random;
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = cards[i];
      cards[i] = cards[j];
      cards[j] = tmp;
    }
    return cards;
  }

  function cardValue(card) { return VALUES[card.rank]; }

  function handTotal(cards) {
    let sum = 0;
    for (const c of cards) sum += cardValue(c);
    return sum % 10;
  }

  /** 8-deck shoe with cut-card reshuffle. */
  class Shoe {
    constructor(decks = 8, rng) {
      this.decks = decks;
      this.total = decks * 52;
      this.rng = rng || Math.random;
      this.cards = [];
      this.shuffleCount = 0;
      this.build();
    }

    build() {
      const cards = [];
      for (let d = 0; d < this.decks; d++) cards.push(...buildDeck());
      this.cards = shuffle(cards, this.rng);
      this.shuffleCount++;
      return this;
    }

    get remaining() { return this.cards.length; }

    get progress() { return this.cards.length / this.total; }

    needsShuffle() { return this.cards.length <= 14; }

    reshuffle() { return this.build(); }

    draw() {
      if (this.cards.length === 0) this.build();
      return this.cards.pop();
    }
  }

  /**
   * Play one Punto Banco hand.
   * Returns the full hand state including the third-card tableau decisions.
   */
  function playHand(drawFn) {
    const player = [];
    const banker = [];
    const trace = [];

    player.push(drawFn());
    banker.push(drawFn());
    player.push(drawFn());
    banker.push(drawFn());

    let playerTotal = handTotal(player);
    let bankerTotal = handTotal(banker);
    const natural = playerTotal >= 8 || bankerTotal >= 8;

    let playerThird = null;
    let bankerThird = null;

    if (!natural) {
      // Player: 0–5 draws, 6–7 stands
      if (playerTotal <= 5) {
        playerThird = drawFn();
        player.push(playerThird);
        trace.push('player-draw');
        playerTotal = handTotal(player);
      } else {
        trace.push('player-stand');
      }

      if (!playerThird) {
        // Player stood: Banker 0–5 draws, 6–7 stands
        if (bankerTotal <= 5) {
          bankerThird = drawFn();
          banker.push(bankerThird);
          trace.push('banker-draw-stand');
          bankerTotal = handTotal(banker);
        } else {
          trace.push('banker-stand');
        }
      } else {
        const p3 = cardValue(playerThird);
        let draw = false;
        if (bankerTotal <= 2) draw = true;
        else if (bankerTotal === 3) draw = p3 !== 8;
        else if (bankerTotal === 4) draw = p3 >= 2 && p3 <= 7;
        else if (bankerTotal === 5) draw = p3 >= 4 && p3 <= 7;
        else if (bankerTotal === 6) draw = p3 === 6 || p3 === 7;
        // banker 7 always stands
        if (draw) {
          bankerThird = drawFn();
          banker.push(bankerThird);
          trace.push('banker-draw-tableau');
          bankerTotal = handTotal(banker);
        } else {
          trace.push('banker-stand-tableau');
        }
      }
    } else {
      trace.push('natural');
    }

    const winner = playerTotal > bankerTotal ? 'player' : bankerTotal > playerTotal ? 'banker' : 'tie';

    const playerPairKind = pairKind(player[0], player[1]);
    const bankerPairKind = pairKind(banker[0], banker[1]);

    return {
      playerCards: player,
      bankerCards: banker,
      playerTotal,
      bankerTotal,
      winner,
      natural,
      playerThird,
      bankerThird,
      playerPair: !!playerPairKind,
      bankerPair: !!bankerPairKind,
      playerPairKind,
      bankerPairKind,
      playerPerfect: playerPairKind === 'perfect',
      bankerPerfect: bankerPairKind === 'perfect',
      trace
    };
  }

  /** Deal a hand directly from a shoe. */
  function dealHand(shoe) {
    return playHand(() => shoe.draw());
  }

  /**
   * 배당 가중치 — 낮은 배당 위주로, ×8 같은 고배당은 가끔만 나온다.
   * (×2 약 35% · ×3 약 29% · ×4 약 18% · ×5 약 12% · ×8 약 6%)
   */
  const MULTIPLIER_WEIGHTS = { 2: 6, 3: 5, 4: 3, 5: 2, 8: 1 };

  /** 목록에서 가중치대로 배당 하나를 뽑는다. */
  function pickMultiplier(list, rng) {
    const values = Array.from(new Set(list && list.length ? list : [2, 3, 4, 5, 8]));
    const pool = values.map((m) => ({ m, w: MULTIPLIER_WEIGHTS[m] || 1 }));
    const total = pool.reduce((a, b) => a + b.w, 0);
    let roll = (rng || Math.random)() * total;
    for (const p of pool) {
      roll -= p.w;
      if (roll < 0) return p.m;
    }
    return pool[pool.length - 1].m;
  }

  /** Create 1..N bonus cards with weighted multipliers. */
  function createBonusCards(config, rng) {
    if (!config) return [];
    const rand = rng || Math.random;
    const n = config.min + Math.floor(rand() * (config.max - config.min + 1));
    const pool = [];
    for (const suit of SUITS) {
      for (const rank of RANKS) pool.push({ rank, suit, id: rank + suit });
    }
    shuffle(pool, rand);
    const picks = pool.slice(0, n);
    return picks.map((c) => ({
      rank: c.rank,
      suit: c.suit,
      id: c.id,
      multiplier: pickMultiplier(config.multipliers, rand)
    }));
  }

  /** Multiplier product for the cards of one hand against the bonus set. */
  function multiplierFor(cards, bonusCards) {
    if (!bonusCards || !bonusCards.length || !cards || !cards.length) {
      return { multiplier: 1, hits: [] };
    }
    const byId = new Map();
    for (const b of bonusCards) byId.set(b.id, b);
    let multiplier = 1;
    const hits = [];
    for (const c of cards) {
      const b = byId.get(c.id);
      if (b) {
        multiplier *= b.multiplier;
        hits.push(b);
      }
    }
    return { multiplier, hits };
  }

  /**
   * Settle a round.
   * opts: { bets, result, mode, noCommission, bonus }
   * bets are stake amounts (the 20% fee is charged separately at placement).
   */
  function settleRound(opts) {
    const cfg = MODES[opts.mode] || MODES.sakura;
    const result = opts.result;
    const bets = opts.bets || {};
    const bonus = opts.bonus || [];
    const useNoComm = !!opts.noCommission;

    const items = [];
    let returned = 0;
    let staked = 0;
    let bestMultiplier = 1;
    let bonusWinHit = false;

    const add = (spot, stake, outcome, ratio, multiplier, hits) => {
      if (!stake) return;
      staked += stake;
      let ret = 0;
      let profit = 0;
      if (outcome === 'win') {
        const baseProfit = Math.round(stake * ratio);
        ret = Math.round((stake + baseProfit) * multiplier);
        profit = ret - stake;
      } else if (outcome === 'push') {
        ret = stake;
        profit = 0;
      }
      returned += ret;
      if (multiplier > 1 && outcome === 'win') {
        bonusWinHit = true;
        bestMultiplier = Math.max(bestMultiplier, multiplier);
      }
      items.push({
        spot,
        stake,
        outcome,
        ratio,
        multiplier,
        hits: hits || [],
        returned: ret,
        profit
      });
    };

    // Main bets: player / banker
    for (const spot of ['player', 'banker']) {
      const stake = bets[spot] || 0;
      if (!stake) continue;

      let outcome = 'lose';
      if (result.winner === spot) outcome = 'win';
      else if (result.winner === 'tie') outcome = 'push';

      let ratio = cfg.payouts[spot];
      if (spot === 'banker' && useNoComm && result.winner === 'banker' && result.bankerTotal === 6) {
        ratio = 0.5;
      }

      let multiplier = 1;
      let hits = [];
      if (outcome === 'win' && cfg.bonus) {
        const hand = spot === 'player' ? result.playerCards : result.bankerCards;
        const m = multiplierFor(hand, bonus);
        multiplier = m.multiplier;
        hits = m.hits;
      }
      add(spot, stake, outcome, ratio, multiplier, hits);
    }

    // Tie bet
    if (bets.tie) {
      const outcome = result.winner === 'tie' ? 'win' : 'lose';
      let multiplier = 1;
      let hits = [];
      if (outcome === 'win' && cfg.bonus) {
        const m1 = multiplierFor(result.playerCards, bonus);
        const m2 = multiplierFor(result.bankerCards, bonus);
        multiplier = m1.multiplier * m2.multiplier;
        hits = m1.hits.concat(m2.hits);
      }
      add('tie', bets.tie, outcome, cfg.payouts.tie, multiplier, hits);
    }

    // Pair side bets — bonus cards on the pair stack their multipliers too
    if (bets.playerPair) {
      let mult = 1;
      let hits = [];
      if (cfg.bonus && result.playerPair) {
        const m = multiplierFor(result.playerCards.slice(0, 2), bonus);
        mult = m.multiplier;
        hits = m.hits;
      }
      add('playerPair', bets.playerPair, result.playerPair ? 'win' : 'lose', cfg.payouts.playerPair, mult, hits);
    }
    if (bets.bankerPair) {
      let mult = 1;
      let hits = [];
      if (cfg.bonus && result.bankerPair) {
        const m = multiplierFor(result.bankerCards.slice(0, 2), bonus);
        mult = m.multiplier;
        hits = m.hits;
      }
      add('bankerPair', bets.bankerPair, result.bankerPair ? 'win' : 'lose', cfg.payouts.bankerPair, mult, hits);
    }

    // Player / Banker bonus — pays by that hand's final point total (4–9)
    for (const [spot, cardsKey, totalKey] of [
      ['playerBonus', 'playerCards', 'playerTotal'],
      ['bankerBonus', 'bankerCards', 'bankerTotal']
    ]) {
      const stake = bets[spot] || 0;
      if (!stake) continue;
      const total = result[totalKey];
      const table = cfg.bonusTotals || BONUS_TOTALS;
      const ratio = table[total] || 0;
      let mult = 1;
      let hits = [];
      if (ratio > 0 && cfg.bonus) {
        const m = multiplierFor(result[cardsKey], bonus);
        mult = m.multiplier;
        hits = m.hits;
      }
      add(spot, stake, ratio > 0 ? 'win' : 'lose', ratio, mult, hits);
    }

    // Perfect pair — 하나(25:1) for one perfect pair, 더블(200:1) for both hands
    if (bets.perfectPair) {
      const perfects = [];
      if (result.playerPerfect) perfects.push(...result.playerCards.slice(0, 2));
      if (result.bankerPerfect) perfects.push(...result.bankerCards.slice(0, 2));
      const both = result.playerPerfect && result.bankerPerfect;
      const ratio = perfects.length ? (both ? cfg.perfectDouble : cfg.payouts.perfectPair) : 0;
      let mult = 1;
      let hits = [];
      if (ratio > 0 && cfg.bonus) {
        const m = multiplierFor(perfects, bonus);
        mult = m.multiplier;
        hits = m.hits;
      }
      add('perfectPair', bets.perfectPair, ratio > 0 ? 'win' : 'lose', ratio, mult, hits);
    }

    // Either pair — any pair on either hand, 5:1
    if (bets.eitherPair) {
      const pairCards = result.playerPair ? result.playerCards.slice(0, 2)
        : result.bankerPair ? result.bankerCards.slice(0, 2) : [];
      let mult = 1;
      let hits = [];
      if (pairCards.length && cfg.bonus) {
        const m = multiplierFor(pairCards, bonus);
        mult = m.multiplier;
        hits = m.hits;
      }
      add('eitherPair', bets.eitherPair, pairCards.length ? 'win' : 'lose', cfg.payouts.eitherPair, mult, hits);
    }

    return {
      items,
      returned,
      staked,
      net: returned - staked,
      bestMultiplier: bonusWinHit ? bestMultiplier : 1,
      bonusWin: bonusWinHit
    };
  }

  /**
   * Big road columns: consecutive runs of the same side (max 6 tall).
   * Ties are skipped (they hang off the previous cell in the visual road).
   */
  function bigRoadColumns(history) {
    const cols = [];
    for (const h of history || []) {
      if (!h || (h.winner !== 'player' && h.winner !== 'banker')) continue;
      const last = cols[cols.length - 1];
      if (last && last.winner === h.winner && last.len < 6) last.len += 1;
      else cols.push({ winner: h.winner, len: 1 });
    }
    return cols;
  }

  /**
   * Big-road path, hand by hand (ties skipped): every non-tie hand owns one
   * grid cell, including the dragon-tail cell that hangs off a full 6-row
   * column. Returns [{ c, r, winner }] with 0-indexed columns and rows.
   */
  function bigRoadPath(history) {
    const path = [];
    let last = null;
    for (const h of history || []) {
      if (!h || (h.winner !== 'player' && h.winner !== 'banker')) continue;
      let pos;
      if (!last) pos = { c: 0, r: 0 };
      else if (h.winner === last.winner) {
        pos = last.r < 5 ? { c: last.c, r: last.r + 1 } : { c: last.c + 1, r: last.r };
      } else {
        pos = { c: last.c + 1, r: 0 };
      }
      last = { c: pos.c, r: pos.r, winner: h.winner };
      path.push(last);
    }
    return path;
  }

  /** First big-road cell that opens each derived road (1군 · 2군 · 3군). */
  const DERIVED_START = {
    1: (c, r) => (c === 1 && r >= 1) || c >= 2,
    2: (c, r) => (c === 2 && r >= 1) || c >= 3,
    3: (c, r) => (c === 3 && r >= 1) || c >= 4
  };

  /**
   * Derived roads (중국점 1·2·3군) — Evolution / Macau style, one mark per HAND.
   * Every non-tie hand after the road's start cell adds exactly one mark, also
   * while the same side keeps winning straight down a big-road column.
   *  · 새 열 첫 칸(r = 0): 기준 열 c-1 과 c-1-offset 의 길이가 같으면 빨강, 다르면 파랑
   *  · 열 아래로(r >= 1): 비교 열 c-offset 의 길이 L 이 r 과 같으면 파랑, 아니면 빨강
   *  · 같은 색은 아래로, 6행 바닥·이미 찬 칸이면 오른쪽 용꼬리, 색이 바뀌면 새 열
   */
  function derivedRoad(history, offset) {
    const path = bigRoadPath(history);
    const colLen = [];
    for (const cell of path) colLen[cell.c] = (colLen[cell.c] || 0) + 1;
    const started = DERIVED_START[offset] || DERIVED_START[1];

    const marks = [];
    const used = new Set();
    let col = 0;
    let row = 0;
    let prevKind = null;

    for (const cell of path) {
      const c = cell.c;
      const r = cell.r;
      if (c - offset < 0 || !started(c, r)) continue;

      let kind;
      if (r === 0) {
        kind = (colLen[c - 1] || 0) === (colLen[c - 1 - offset] || 0) ? 'r' : 'b';
      } else {
        const L = colLen[c - offset] || 0;
        kind = L === r ? 'b' : 'r';
      }

      if (!marks.length) {
        col = 0; row = 0;
      } else if (kind === prevKind) {
        if (row < 5 && !used.has(col + ':' + (row + 1))) {
          row += 1;
        } else {
          let nc = col + 1;
          while (used.has(nc + ':' + row)) nc += 1;
          col = nc;
        }
      } else {
        let nc = col + 1;
        row = 0;
        while (used.has(nc + ':' + row)) nc += 1;
        col = nc;
      }
      used.add(col + ':' + row);
      marks.push({ c: col, r: row, kind });
      prevKind = kind;
    }
    return marks;
  }

  /** All three derived roads in one call. */
  function derivedRoads(history) {
    return {
      eye: derivedRoad(history, 1),
      small: derivedRoad(history, 2),
      cock: derivedRoad(history, 3)
    };
  }

  global.BaccaratEngine = {
    RANKS, SUITS, SUIT_SYMBOL, VALUES, MODES, BONUS_TOTALS,
    buildDeck, shuffle, cardValue, handTotal, pairKind, Shoe,
    playHand, dealHand, createBonusCards, pickMultiplier, multiplierFor, settleRound,
    bigRoadColumns, bigRoadPath, derivedRoad, derivedRoads
  };
})(typeof window !== 'undefined' ? window : globalThis);
