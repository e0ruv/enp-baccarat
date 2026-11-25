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

  /** Table configurations — three tables, all virtual money. */
  const MODES = {
    speed: {
      id: 'speed',
      name: '스피드 바카라',
      en: 'SPEED',
      short: '스피드',
      icon: '🚀',
      fee: 0,
      payouts: { player: 1, banker: 0.95, tie: 8, playerPair: 11, bankerPair: 11 },
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
      payouts: { player: 1, banker: 0.95, tie: 8, playerPair: 11, bankerPair: 11 },
      bonus: { min: 1, max: 5, multipliers: [2, 3, 4, 5, 8], noun: '벚꽃 카드' },
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
      payouts: { player: 1, banker: 0.95, tie: 8, playerPair: 11, bankerPair: 11 },
      bonus: { min: 1, max: 5, multipliers: [2, 3, 4, 5, 8], noun: '눈꽃 크리스탈' },
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

    return {
      playerCards: player,
      bankerCards: banker,
      playerTotal,
      bankerTotal,
      winner,
      natural,
      playerThird,
      bankerThird,
      playerPair: player.length >= 2 && player[0].rank === player[1].rank,
      bankerPair: banker.length >= 2 && banker[0].rank === banker[1].rank,
      trace
    };
  }

  /** Deal a hand directly from a shoe. */
  function dealHand(shoe) {
    return playHand(() => shoe.draw());
  }

  /** Create 1..N bonus cards with random multipliers. */
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
      multiplier: config.multipliers[Math.floor(rand() * config.multipliers.length)]
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

    return {
      items,
      returned,
      staked,
      net: returned - staked,
      bestMultiplier: bonusWinHit ? bestMultiplier : 1,
      bonusWin: bonusWinHit
    };
  }

  global.BaccaratEngine = {
    RANKS, SUITS, SUIT_SYMBOL, VALUES, MODES,
    buildDeck, shuffle, cardValue, handTotal, Shoe,
    playHand, dealHand, createBonusCards, multiplierFor, settleRound
  };
})(typeof window !== 'undefined' ? window : globalThis);
