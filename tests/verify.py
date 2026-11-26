#!/usr/bin/env python3
"""ENP BACCARAT — Playwright verification (live-table mobile UI).

Covers: splash, 3 tables, 3-stage mobile composition (dealer studio / road board /
betting mat), 9 betting zones, mat mini-cards, score + result badges, derived roads,
side-bet settlement (player/banker bonus, perfect pair 하나/더블, either pair),
bet moving between zones by drag and long-press (+ undo), double-tap zoom guards,
squeeze, accounts, hidden admin (6160), GitHub sync panel, zero console errors and
zero overflow at 390x844 and 1440x900.

NEW: Evolution-style white road board (full 6-row grid, circular bead badges),
photo dealer, 10 circular casino chips (`1K`~`100M`, English K/M/B units), 10억 table
limit, and the auto-running live shoe (10s countdown → auto deal → settle → result hold →
clean table → next 10s round, paused while modals are open and restarted with a
fresh road on a new shoe).

NEW (this pass): dealer glove pulling each card out of the shoe with a flight arc,
per-card live score badges, big unobstructed 10s countdown (gold/red emphasis),
centre P/B/T winner badge, result sheet only when there is a payout, table cleared
at the next round, 7 bonus cards per round, petal/snow fall on bonus-win zones and
banners, Ask-the-road P/B next-cell preview, and one-tap-one-bet protection.
"""
import functools
import http.server
import os
import re
import socketserver
import threading

from playwright.sync_api import sync_playwright

ROOT = "/workspace/baccarat-sim"
PORT = 8171
BIN = "/workspace/.pw-browsers/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell"
URL = f"http://127.0.0.1:{PORT}/index.html"

results = []
failures = []


def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    if not cond:
        failures.append(f"{name} — {detail}")
    print(("PASS " if cond else "FAIL ") + name + (f"  ({detail})" if detail else ""))


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve():
    handler = functools.partial(QuietHandler, directory=ROOT)

    class Q(socketserver.TCPServer):
        allow_reuse_address = True

    srv = Q(("127.0.0.1", PORT), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def tclick(page, sel):
    page.evaluate("(s)=>{const e=document.querySelector(s); if(e) e.click();}", sel)


ENGINE_JS = r"""
() => {
  const E = window.BaccaratEngine;
  const out = {fail: [], checked: 0};
  const rankOf = (v) => (v === 0 ? '10' : v === 1 ? 'A' : String(v));
  const card = (v, s) => ({rank: rankOf(v), suit: s || 's', id: rankOf(v) + (s || 's')});
  const run = (draws) => { let i = 0; return E.playHand(() => draws[i++]); };

  // player rule
  for (let pt = 0; pt <= 9; pt++) {
    for (let bt = 0; bt <= 7; bt++) {
      const r = run([card(pt), card(bt), card(0), card(0), card(3), card(1), card(1)]);
      out.checked++;
      const shouldDraw = pt <= 5;
      if (shouldDraw !== (r.playerCards.length === 3)) out.fail.push(`player pt=${pt} bt=${bt}`);
      if (!shouldDraw && pt < 8) {
        if ((bt <= 5) !== (r.bankerCards.length === 3)) out.fail.push(`banker-stand pt=${pt} bt=${bt}`);
      }
    }
  }
  // banker tableau
  const tableau = (bt, p3) => {
    if (bt <= 2) return true;
    if (bt === 3) return p3 !== 8;
    if (bt === 4) return p3 >= 2 && p3 <= 7;
    if (bt === 5) return p3 >= 4 && p3 <= 7;
    if (bt === 6) return p3 === 6 || p3 === 7;
    return false;
  };
  for (let bt = 0; bt <= 7; bt++) {
    for (let p3 = 0; p3 <= 9; p3++) {
      const r = run([card(5), card(bt), card(0), card(0), card(p3), card(4), card(4)]);
      out.checked++;
      if (tableau(bt, p3) !== (r.bankerCards.length === 3)) out.fail.push(`tableau bt=${bt} p3=${p3}`);
    }
  }
  // naturals
  for (const [pt, bt] of [[8, 3], [3, 9], [9, 8], [8, 9]]) {
    const r = run([card(pt), card(bt), card(0), card(0), card(2), card(2), card(2)]);
    out.checked++;
    if (r.playerCards.length !== 2 || r.bankerCards.length !== 2 || !r.natural) out.fail.push(`natural ${pt}/${bt}`);
  }
  // totals & pairs
  if (E.handTotal([{rank: 'K'}, {rank: '9'}]) !== 9) out.fail.push('total K+9');
  if (E.handTotal([{rank: '7'}, {rank: '8'}]) !== 5) out.fail.push('total 15');
  const pr = run([card(4), card(6), card(4), card(6), card(0), card(0)]);
  out.checked++;
  if (!pr.playerPair || !pr.bankerPair) out.fail.push('pair detection');

  // ── perfect / colored / mixed pair classification
  const pk = E.pairKind({rank: '7', suit: 'h'}, {rank: '7', suit: 'h'});
  const ck = E.pairKind({rank: '7', suit: 'h'}, {rank: '7', suit: 'd'});
  const mk = E.pairKind({rank: '7', suit: 'h'}, {rank: '7', suit: 's'});
  const nk = E.pairKind({rank: '7', suit: 'h'}, {rank: '8', suit: 's'});
  out.checked++;
  if (pk !== 'perfect' || ck !== 'colored' || mk !== 'mixed' || nk !== null) out.fail.push('pairKind ' + [pk, ck, mk, nk]);

  // shoe composition
  const shoe = new E.Shoe(8);
  out.checked++;
  const counts = {};
  shoe.cards.forEach((c) => { counts[c.id] = (counts[c.id] || 0) + 1; });
  if (shoe.cards.length !== 416) out.fail.push('shoe size ' + shoe.cards.length);
  if (Object.keys(counts).length !== 52) out.fail.push('shoe identities');
  if (Object.values(counts).some((n) => n !== 8)) out.fail.push('shoe copies');

  // bonus cards: 1-5, distinct, 2..8
  for (let i = 0; i < 120; i++) {
    for (const mode of ['sakura', 'snow']) {
      const b = E.createBonusCards(E.MODES[mode].bonus);
      out.checked++;
      if (b.length !== 7) out.fail.push(mode + ' bonus count ' + b.length);
      if (new Set(b.map((x) => x.id)).size !== b.length) out.fail.push('bonus duplicates');
      if (b.some((x) => [2, 3, 4, 5, 8].indexOf(x.multiplier) < 0)) out.fail.push('bad multiplier');
    }
  }
  if (E.MODES.speed.bonus !== null) out.fail.push('speed should have no bonus');

  // ── settlement fixtures
  const result = {
    playerCards: [{rank: '5', suit: 's', id: '5s'}, {rank: '4', suit: 'h', id: '4h'}],
    bankerCards: [{rank: '9', suit: 'c', id: '9c'}, {rank: '8', suit: 'd', id: '8d'}],
    playerTotal: 9, bankerTotal: 7, winner: 'player', natural: false,
    playerPair: false, bankerPair: false, playerPerfect: false, bankerPerfect: false
  };
  const bonus = [{rank: '5', suit: 's', id: '5s', multiplier: 4}, {rank: '4', suit: 'h', id: '4h', multiplier: 2}];
  const st = E.settleRound({bets: {player: 10000}, result, mode: 'sakura', bonus});
  out.checked++;
  if (st.returned !== 160000) out.fail.push('stacked product returned ' + st.returned);
  if (st.bestMultiplier !== 8) out.fail.push('bestMultiplier ' + st.bestMultiplier);

  const st2 = E.settleRound({bets: {banker: 10000}, result: {...result, winner: 'banker'}, mode: 'speed', bonus: []});
  out.checked++;
  if (st2.returned !== 19500) out.fail.push('banker 0.95 returned ' + st2.returned);

  const tieRes = {...result, winner: 'tie', playerTotal: 7, bankerTotal: 7};
  const st3 = E.settleRound({bets: {tie: 10000, player: 10000}, result: tieRes, mode: 'snow', bonus: []});
  out.checked++;
  if (st3.returned !== 90000 + 10000) out.fail.push('tie/push returned ' + st3.returned);

  // pair 11:1 plain and with 5x bonus
  const pairRes = {...result, winner: 'player', playerPair: true, playerPairKind: 'mixed'};
  const st4 = E.settleRound({bets: {playerPair: 10000}, result: pairRes, mode: 'snow', bonus: []});
  out.checked++;
  if (st4.returned !== 120000) out.fail.push('pair 11:1 returned ' + st4.returned);
  const pairBonus = [{rank: '5', suit: 's', id: '5s', multiplier: 4}, {rank: '4', suit: 'h', id: '4h', multiplier: 4}];
  const st5 = E.settleRound({bets: {playerPair: 10000}, result: pairRes, mode: 'sakura', bonus: pairBonus});
  out.checked++;
  if (st5.returned !== 120000 * 16) out.fail.push('pair bonus returned ' + st5.returned);

  // no-commission banker 6
  const res6 = {...result, winner: 'banker', bankerTotal: 6};
  const st6 = E.settleRound({bets: {banker: 10000}, result: res6, mode: 'sakura', bonus: [], noCommission: true});
  out.checked++;
  if (st6.returned !== 15000) out.fail.push('no-commission returned ' + st6.returned);

  // ── NEW: player / banker bonus pays by hand total (4→2:1 … 9→30:1)
  const bonusTable = {9: 30, 8: 10, 7: 6, 6: 4, 5: 3, 4: 2};
  for (const [total, ratio] of Object.entries(bonusTable)) {
    const res = {...result, playerTotal: Number(total), bankerTotal: 3, winner: 'player'};
    const a = E.settleRound({bets: {playerBonus: 10000}, result: res, mode: 'speed', bonus: []});
    const b = E.settleRound({bets: {bankerBonus: 10000}, result: {...res, playerTotal: 2, bankerTotal: Number(total), winner: 'banker'}, mode: 'speed', bonus: []});
    out.checked += 2;
    if (a.returned !== 10000 * (ratio + 1)) out.fail.push(`playerBonus ${total} returned ${a.returned}`);
    if (b.returned !== 10000 * (ratio + 1)) out.fail.push(`bankerBonus ${total} returned ${b.returned}`);
  }
  const lowBonus = E.settleRound({bets: {playerBonus: 10000}, result: {...result, playerTotal: 3}, mode: 'speed', bonus: []});
  out.checked++;
  if (lowBonus.returned !== 0) out.fail.push('bonus total 3 should lose');

  // ── NEW: perfect pair 하나 25:1 / 더블 200:1
  const perfectOne = {
    ...result, playerCards: [{rank: '7', suit: 'h', id: '7h'}, {rank: '7', suit: 'h', id: '7h2'}],
    playerPair: true, playerPairKind: 'perfect', playerPerfect: true, bankerPerfect: false
  };
  const pp1 = E.settleRound({bets: {perfectPair: 10000}, result: perfectOne, mode: 'speed', bonus: []});
  out.checked++;
  if (pp1.returned !== 10000 * 26) out.fail.push('perfect 하나 returned ' + pp1.returned);
  const perfectBoth = {
    ...perfectOne,
    bankerCards: [{rank: '9', suit: 'c', id: '9c'}, {rank: '9', suit: 'c', id: '9c2'}],
    bankerPair: true, bankerPairKind: 'perfect', bankerPerfect: true
  };
  const pp2 = E.settleRound({bets: {perfectPair: 10000}, result: perfectBoth, mode: 'speed', bonus: []});
  out.checked++;
  if (pp2.returned !== 10000 * 201) out.fail.push('perfect 더블 returned ' + pp2.returned);
  const coloredOnly = {...perfectOne, playerPairKind: 'colored', playerPerfect: false};
  const pp3 = E.settleRound({bets: {perfectPair: 10000}, result: coloredOnly, mode: 'speed', bonus: []});
  out.checked++;
  if (pp3.returned !== 0) out.fail.push('colored pair must not win perfect pair');

  // ── NEW: either pair 5:1
  const ep1 = E.settleRound({bets: {eitherPair: 10000}, result: {...result, bankerPair: true}, mode: 'speed', bonus: []});
  const ep2 = E.settleRound({bets: {eitherPair: 10000}, result: {...result, bankerPair: false}, mode: 'speed', bonus: []});
  out.checked += 2;
  if (ep1.returned !== 60000) out.fail.push('either pair returned ' + ep1.returned);
  if (ep2.returned !== 0) out.fail.push('either pair no-pair returned ' + ep2.returned);

  // ── NEW: derived roads
  const h = (w) => ({winner: w});
  const cols = E.bigRoadColumns([h('player'), h('player'), h('player'), h('banker'), h('banker'), h('tie'), h('player')]);
  out.checked++;
  if (cols.length !== 3 || cols[0].len !== 3 || cols[1].len !== 2 || cols[2].len !== 1) out.fail.push('bigRoadColumns ' + JSON.stringify(cols));
  const dr = E.derivedRoads([h('player'), h('player'), h('banker'), h('banker'), h('player')]);
  out.checked++;
  if (dr.eye.length !== 2 || dr.small.length !== 1 || dr.cock.length !== 0) out.fail.push('derivedRoads ' + JSON.stringify(dr));
  if (dr.eye.some((m) => ['r', 'b'].indexOf(m.kind) < 0)) out.fail.push('derived kind');
  const emptyRoad = E.derivedRoads([]);
  out.checked++;
  if (emptyRoad.eye.length || emptyRoad.small.length || emptyRoad.cock.length) out.fail.push('empty derived roads');

  return out;
}
"""


def open_page(browser, viewport, mobile=False, scale=2):
    ctx = browser.new_context(viewport=viewport, device_scale_factor=scale, is_mobile=mobile, has_touch=mobile)
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.on("console", lambda m: errors.append(f"console: {m.text}") if m.type == "error" else None)
    page.goto(URL)
    return ctx, page, errors


def bet(page, chip, spots):
    page.wait_for_function("window.__bac.state.phase === 'betting'", timeout=30000)
    if page.eval_on_selector("#result", "e=>e.classList.contains('on')"):
        tclick(page, "#resultClose")
        page.wait_for_timeout(120)
    page.click(f'#chipRow .chip[data-chip="{chip}"]')
    for spot in spots:
        page.click(f'[data-spot="{spot}"]')


def deal_now(page):
    page.wait_for_function("window.__bac.state.phase === 'betting'", timeout=30000)
    page.click("#dealBtn")


def hand_counts(page):
    return page.evaluate("""() => {
      const h = window.__bac.state.history;
      return {n: h.length,
              p: h.filter(x => x.winner === 'player').length,
              b: h.filter(x => x.winner === 'banker').length,
              t: h.filter(x => x.winner === 'tie').length};
    }""")


def clear(page):
    tclick(page, "#resultClose")
    page.wait_for_timeout(120)
    tclick(page, "#clearBtn")
    page.wait_for_timeout(120)


def clock_probe(pg):
    return pg.evaluate("""() => {
      const c = document.getElementById('roundClock');
      const d = document.getElementById('dealerView');
      const n = document.getElementById('clockNum');
      const r = c.getBoundingClientRect(), b = d.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const cs = getComputedStyle(c), ns = getComputedStyle(n);
      return {w: Math.round(r.width), h: Math.round(r.height),
              inside: r.left >= b.left - 1 && r.right <= b.right + 1 && r.top >= b.top - 1 && r.bottom <= b.bottom + 1,
              onTop: !!hit && (hit === c || c.contains(hit)),
              z: Number(cs.zIndex), font: parseFloat(ns.fontSize),
              radius: cs.borderRadius, num: n.textContent.trim(),
              urgent: (() => { c.classList.add('is-urgent'); const g = getComputedStyle(c).backgroundImage;
                                c.classList.remove('is-urgent'); return g; })(),
              warm: (() => { c.classList.add('is-warm'); const g = getComputedStyle(c).backgroundImage;
                              c.classList.remove('is-warm'); return g; })()};
    }""")


def run_desktop(browser):
    ctx, page, errors = open_page(browser, {"width": 1440, "height": 900})

    # ── splash
    page.wait_for_timeout(450)
    check("splash visible on load", page.eval_on_selector("#splash", "e=>!!e && !e.classList.contains('is-done')"))
    page.screenshot(path=os.path.join(ROOT, "preview-splash.png"))
    page.wait_for_function("window.__SPLASH_DONE__ === true", timeout=6000)
    page.wait_for_timeout(400)
    check("splash auto-dismissed", page.eval_on_selector_all("#splash", "e=>e.length") == 0)
    check("desktop no horizontal overflow", page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"),
          page.evaluate("[document.documentElement.scrollWidth, window.innerWidth]"))
    check("desktop fits viewport", page.evaluate("document.documentElement.scrollHeight <= window.innerHeight + 4"),
          page.evaluate("document.documentElement.scrollHeight"))

    # ── three-stage composition
    ids = page.evaluate("""() => ({
      dealer: !!document.querySelector('.dealer-view'),
      roads: !!document.querySelector('.roadboard'),
      mat: !!document.querySelector('.betting-mat'),
      controls: !!document.querySelector('.bet-controls'),
      status: !!document.querySelector('.statusbar')
    })""")
    check("three-stage structure", all(ids.values()), str(ids))

    # ── 우상단 10초 카운트다운: 크고, 가리지 않고, 위험 구간에서 색이 바뀜
    clk = clock_probe(page)
    check("desktop clock is big and inside the table", clk["w"] >= 44 and clk["inside"], str(clk))
    check("desktop clock is never covered", clk["onTop"] and clk["z"] >= 20, str(clk))
    check("desktop clock number is legible", clk["font"] >= 18, str(clk["font"]))
    check("clock turns gold near the end", "255, 194, 74" in clk["warm"] or "rgb(255, 194, 74)" in clk["warm"], clk["warm"][:70])
    check("clock turns red at the last seconds", "255, 75, 92" in clk["urgent"] or "rgb(255, 75, 92)" in clk["urgent"], clk["urgent"][:70])

    # ── NEW: white Evolution-style road board (grid drawn even when empty)
    road = page.evaluate("""() => {
      const b = document.querySelector('.roadboard');
      const big = document.querySelector('.bigroad');
      const cells = document.querySelectorAll('.br-cell');
      const cs = getComputedStyle(b);
      return { bg: cs.backgroundColor,
               bigBg: getComputedStyle(big).backgroundColor,
               cells: cells.length,
               blank: cells.length - document.querySelectorAll('.br-cell.p, .br-cell.b').length,
               cols: getComputedStyle(big).gridTemplateColumns.split(' ').length,
               rows: getComputedStyle(big).gridTemplateRows.split(' ').length,
               beadRows: getComputedStyle(document.querySelector('.bead')).gridTemplateRows.split(' ').length };
    }""")
    check("road board white background", road["bg"] == "rgb(255, 255, 255)", road["bg"])
    check("big road draws 6 rows", road["rows"] == 6, str(road["rows"]))
    check("big road empty grid cells", road["cols"] >= 9 and road["cells"] == road["cols"] * 6,
          f"{road['cells']} cells / {road['cols']} cols")
    check("big road cells blank before play", road["blank"] == road["cells"], str(road["blank"]))
    check("bead plate 6 rows", road["beadRows"] == 6, str(road["beadRows"]))
    check("derived roads drawn as grids", page.eval_on_selector_all(".mr-cell", "e=>e.length") >= 3 * 6 * 6)

    # ── NEW: photo dealer replaces the SVG illustration
    dealer = page.evaluate("""() => {
      const img = document.querySelector('.dp-img');
      const f = document.getElementById('dealer');
      return {src: img ? img.getAttribute('src') : null, nat: img ? img.naturalWidth : 0,
              svg: document.querySelectorAll('.dealer-svg').length,
              h: img ? Math.round(img.getBoundingClientRect().height) : 0,
              top: img ? Math.round(img.getBoundingClientRect().top - f.getBoundingClientRect().top) : 0,
              feltTop: Math.round(document.getElementById('felt').getBoundingClientRect().top - f.getBoundingClientRect().top)};
    }""")
    check("dealer photo loaded", dealer["nat"] > 0 and dealer["src"].endswith("dealer.jpg"), str(dealer))
    check("SVG dealer removed", dealer["svg"] == 0, str(dealer["svg"]))
    check("dealer photo bleeds into the table", dealer["top"] <= 20 and dealer["h"] > dealer["feltTop"] - 20,
          str(dealer))
    boxes = page.evaluate("""() => {
      const r = (s) => { const e = document.querySelector(s); const b = e.getBoundingClientRect();
        return [Math.round(b.top), Math.round(b.bottom), Math.round(b.left), Math.round(b.right)]; };
      return {dealer: r('.dealer-view'), roads: r('.roadboard'), mat: r('.betting-mat'), ctrl: r('.bet-controls'),
              status: r('.statusbar'), z: getComputedStyle(document.querySelector('.bet-controls')).zIndex};
    }""")
    check("desktop order dealer→roads", boxes["dealer"][1] <= boxes["roads"][0] + 1, str(boxes))

    # ── default table
    check("default table is blossom", page.evaluate("document.body.dataset.mode") == "sakura",
          page.evaluate("document.body.dataset.mode"))
    check("three mode tabs only", page.eval_on_selector_all(".mode-btn", "e=>e.length") == 3)
    check("no lightning tab", page.eval_on_selector_all('.mode-btn[data-mode="lightning"]', "e=>e.length") == 0)

    # ── 9 betting zones
    zones = page.evaluate("""() => Array.from(document.querySelectorAll('[data-spot]')).map(z => z.dataset.spot)""")
    expect_zones = ["player", "banker", "tie", "playerPair", "bankerPair", "playerBonus", "bankerBonus", "perfectPair", "eitherPair"]
    check("9 betting zones", sorted(zones) == sorted(expect_zones), str(zones))
    pays = page.evaluate("() => ({p: document.getElementById('payPlayer').textContent.trim(),"
                                     " b: document.getElementById('payBanker').textContent.trim(),"
                                     " t: document.getElementById('payTie').textContent.trim()})")
    check("player/banker/tie payouts", pays["p"] == "1:1" and pays["t"] == "8:1" and pays["b"] == "0.95:1", str(pays))
    check("mat hides player/banker payout like the video",
          page.eval_on_selector("#payPlayer", "e=>getComputedStyle(e).display === 'none'")
          and page.eval_on_selector("#payBanker", "e=>getComputedStyle(e).display === 'none'"))
    tie_line = page.evaluate("""() => { const n = document.querySelector('.mz-tie .mz-name').getBoundingClientRect();
        const p = document.querySelector('.mz-tie .mz-pay').getBoundingClientRect();
        return {sameRow: n.top < p.bottom && p.top < n.bottom, gap: Math.round(p.left - n.right),
                bottom: Math.round(Math.abs(n.bottom - p.bottom))}; }""")
    check("tie name and payout on one line",
          tie_line["sameRow"] and tie_line["gap"] >= -1 and tie_line["bottom"] <= 4, str(tie_line))
    check("bonus side-bet payouts", page.inner_text("#payPB") == "1~30:1" and page.inner_text("#payBB") == "1~30:1",
          f"{page.inner_text('#payPB')} / {page.inner_text('#payBB')}")
    check("perfect pair payout label", "25:1" in page.inner_text("#payPerfect") and "200:1" in page.inner_text("#payPerfect"),
          page.inner_text("#payPerfect"))
    check("either pair payout", page.inner_text("#payEither") == "5:1", page.inner_text("#payEither"))
    check("tie zone labelled 무", "무" in page.inner_text('[data-spot="tie"]'), page.inner_text('[data-spot="tie"]'))

    # ── NEW: 영상(Stake Korean Speed Baccarat) 화면 맞춤 — 고딕 산세리프 통일
    typo = page.evaluate("""() => ['body', '.mz-player .mz-name', '.mz-tie .mz-name', '.mz-tie .mz-pay',
        '.mz-side .mz-name', '.mz-side .mz-pay', '.statusbar', '.rc-num', '.result-title', '.brand-text b',
        '.bigroad', '.chip']
      .map(s => { const e = document.querySelector(s); return [s, e ? getComputedStyle(e).fontFamily : null]; })""")
    def _sans(v):
        low = (v or "").lower()
        return bool(low) and "serif" not in low.replace("sans-serif", "")
    check("every UI family is a clean gothic sans", all(_sans(v) for _, v in typo),
          str([t for t in typo if not _sans(t[1])]))
    check("felt watermark keeps a serif face",
          "serif" in page.eval_on_selector(".felt-label", "e=>getComputedStyle(e).fontFamily").lower(),
          page.eval_on_selector(".felt-label", "e=>getComputedStyle(e).fontFamily"))

    # ── NEW: 점수 배지 — 0은 반투명 회색, 점수는 선명한 파랑/빨강 각진 라운드
    sb = page.evaluate("""() => { const p = document.getElementById('playerTotal');
      const off = getComputedStyle(p).backgroundColor;
      p.classList.add('is-scored');
      const on = getComputedStyle(p).backgroundImage; p.classList.remove('is-scored');
      const b = document.getElementById('bankerTotal');
      b.classList.add('is-scored'); const onB = getComputedStyle(b).backgroundImage; b.classList.remove('is-scored');
      return {off, on, onB, radius: getComputedStyle(p).borderRadius};
    }""")
    check("empty score badge is translucent grey", sb["off"] == "rgba(90, 90, 90, 0.6)", sb["off"])
    check("score badge turns bright blue / red",
          "linear-gradient" in sb["on"] and "linear-gradient" in sb["onB"] and sb["on"] != sb["onB"],
          sb["on"][:70] + " | " + sb["onB"][:70])
    check("score badge corners are 6px rounded squares", sb["radius"].startswith("6px"), sb["radius"])

    # ── NEW: 사이드 베팅 2줄 중앙 정렬 (이름 / 배당)
    side = page.evaluate("""() => ['playerPair', 'playerBonus', 'bankerBonus', 'bankerPair', 'perfectPair', 'eitherPair']
      .map(k => {
        const z = document.querySelector(`[data-spot="${k}"]`);
        const n = z.querySelector('.mz-name').getBoundingClientRect();
        const p = z.querySelector('.mz-pay').getBoundingClientRect();
        const zr = z.getBoundingClientRect();
        const cx = (r) => r.left + r.width / 2, zc = zr.left + zr.width / 2;
        return {k, nC: Math.round(cx(n) - zc), pC: Math.round(cx(p) - zc), twoLines: p.top >= n.bottom - 1};
      })""")
    check("side bets are two centred lines",
          all(abs(s["nC"]) <= 2 and abs(s["pC"]) <= 2 and s["twoLines"] for s in side), str(side))

    # ── NEW: 10 circular casino chips — 영문 K / M / B 라벨 (1K ~ 100M)
    chips = page.evaluate("() => Array.from(document.querySelectorAll('#chipRow .chip')).map(c => Number(c.dataset.chip))")
    check("ten casino chips", chips == [1000, 5000, 10000, 50000, 100000, 500000, 1000000, 5000000, 10000000, 100000000],
          str(chips))
    want_labels = ["1K", "5K", "10K", "50K", "100K", "500K", "1M", "5M", "10M", "100M"]
    labels = page.evaluate("""() => Array.from(document.querySelectorAll('#chipRow .chip'))
        .map(c => ({t: c.textContent.trim(), a: (c.getAttribute('aria-label') || '').trim()}))""")
    check("chip tray reads in K / M / B",
          [l["t"] for l in labels] == want_labels and [l["a"] for l in labels] == want_labels, str(labels))
    check("no Korean 천/만/억 left on the chips",
          re.search("[천만억]", page.inner_text("#chipRow")) is None, page.inner_text("#chipRow"))
    check("chip line under the tray shows the selected chip in K/M/B",
          page.inner_text("#chipAmount").strip() == "10K", page.inner_text("#chipAmount"))
    chip_fit = page.evaluate("""() => Array.from(document.querySelectorAll('#chipRow .chip i')).map(i => ({
        t: i.textContent, ink: i.offsetWidth,
        inner: Math.round(i.parentElement.clientWidth * 0.6 * 10) / 10,
        fs: getComputedStyle(i).fontSize}))""")
    check("chip text fits inside the solid centre of every chip",
          all(f["ink"] <= f["inner"] for f in chip_fit), str(chip_fit))
    chip_shape = page.evaluate("""() => {
      const c = document.querySelector('.chip');
      const r = c.getBoundingClientRect();
      return { radius: getComputedStyle(c).borderRadius, w: Math.round(r.width), h: Math.round(r.height),
               stripe: getComputedStyle(c, '::before').backgroundImage,
               tones: new Set(Array.from(document.querySelectorAll('#chipRow .chip'))
                        .map(x => getComputedStyle(x).getPropertyValue('--c-bg').trim())).size };
    }""")
    check("chips are round", chip_shape["radius"].startswith("50%") and abs(chip_shape["w"] - chip_shape["h"]) <= 1, str(chip_shape))
    check("chip edge stripes", "repeating-conic-gradient" in chip_shape["stripe"], chip_shape["stripe"][:40])
    check("each chip has its own colour", chip_shape["tones"] == 10, str(chip_shape["tones"]))
    check("table limit label 10억", "10억" in page.inner_text("#statusLimit"), page.inner_text("#statusLimit"))

    # 1억 칩으로 여러 번 베팅 (테이블 한도 10억)
    page.evaluate("window.__bac.state.balance = 3000000000; window.__bac.renderAll()")
    page.click('#chipRow .chip[data-chip="100000000"]')
    check("100M chip selected", page.evaluate("window.__bac.state.chip") == 100000000)
    page.click('[data-spot="player"]')
    page.click('[data-spot="player"]')
    check("100M chip places ₩2억", page.evaluate("window.__bac.state.bets.player") == 200000000,
          str(page.evaluate("window.__bac.state.bets.player")))
    badge = page.evaluate("""() => { const b = document.querySelector('.bet-chip[data-betchip="player"]');
        const i = b.querySelector('i');
        return {cls: b.className, txt: b.textContent.trim(), round: getComputedStyle(b).borderRadius,
                w: Math.round(b.getBoundingClientRect().width),
                ink: i.offsetWidth, inner: Math.round(b.clientWidth * 0.6 * 10) / 10}; }""")
    check("bet badge is a chip and reads 200M",
          "tone-100000000" in badge["cls"] and badge["round"].startswith("50%") and badge["txt"] == "200M", str(badge))
    check("bet badge text fits inside the chip", badge["ink"] <= badge["inner"], str(badge))
    for _ in range(9):
        page.click('[data-spot="player"]')
    check("stake stops at the 10억 table limit", page.evaluate("window.__bac.state.bets.player") == 1000000000,
          str(page.evaluate("window.__bac.state.bets.player")))
    big_badge = page.evaluate("""() => { const b = document.querySelector('.bet-chip[data-betchip="player"]');
        const i = b.querySelector('i');
        return {txt: b.textContent.trim(), fs: getComputedStyle(i).fontSize,
                ink: i.offsetWidth, inner: Math.round(b.clientWidth * 0.6 * 10) / 10}; }""")
    check("1B betting chip reads 1B", big_badge["txt"] == "1B", str(big_badge))
    check("1B betting chip text fits", big_badge["ink"] <= big_badge["inner"], str(big_badge))
    page.click('[data-spot="player"]')
    check("over-limit bet rejected", page.evaluate("window.__bac.state.bets.player") == 1000000000)
    tclick(page, "#clearBtn")
    page.click('#chipRow .chip[data-chip="10000"]')
    check("clear refunds 1억 chips", page.evaluate("window.__bac.state.balance") == 3000000000,
          str(page.evaluate("window.__bac.state.balance")))

    # ── mode switching
    expects = {"speed": ("스피드 바카라", False), "sakura": ("벚꽃 바카라", True), "snow": ("눈꽃 바카라", True)}
    for mode, (name, strip) in expects.items():
        page.click(f'.mode-btn[data-mode="{mode}"]')
        page.wait_for_timeout(300)
        check(f"mode {mode}: theme", page.evaluate("document.body.dataset.mode") == mode)
        check(f"mode {mode}: active pill",
              page.eval_on_selector(f'.mode-btn[data-mode="{mode}"]', "e=>e.classList.contains('is-active')"))
        check(f"mode {mode}: name", page.inner_text("#tableName") == name, page.inner_text("#tableName"))
        strip_shown = page.eval_on_selector("#bonusStrip", "e=>getComputedStyle(e).display !== 'none'")
        check(f"mode {mode}: bonus rail", strip_shown == strip)
        check(f"mode {mode}: fee row hidden",
              page.eval_on_selector("#feeRow", "e=>getComputedStyle(e).display === 'none'"))
    page.click('.mode-btn[data-mode="sakura"]')
    page.wait_for_timeout(300)

    # ── engine verification
    eng = page.evaluate(ENGINE_JS)
    check(f"engine rules + side bets ({eng['checked']} cases)", not eng["fail"], "; ".join(eng["fail"][:6]))

    # ── betting
    bal0 = page.evaluate("window.__bac.state.balance")
    bet(page, 10000, ["player"])
    check("bet stake", page.inner_text("#totalStake") == "₩10,000", page.inner_text("#totalStake"))
    check("balance debited", page.evaluate("window.__bac.state.balance") == bal0 - 10000)
    check("chip badge on zone", page.eval_on_selector('.bet-chip[data-betchip="player"]',
                                                       "e=>e.classList.contains('on') && e.textContent.trim() !== ''"))
    page.click("#undoBtn")
    check("undo refunds", page.evaluate("window.__bac.state.balance") == bal0)
    bet(page, 10000, ["banker", "playerPair", "perfectPair"])
    check("multi-spot stake", page.inner_text("#totalStake") == "₩30,000", page.inner_text("#totalStake"))
    page.click("#clearBtn")
    check("clear refunds all", page.evaluate("window.__bac.state.balance") == bal0)

    # ── NEW: move a bet by drag (desktop mouse) player → banker
    bet(page, 50000, ["player"])
    before = page.evaluate("window.__bac.state.balance")
    src = page.query_selector('[data-spot="player"]').bounding_box()
    dst = page.query_selector('[data-spot="banker"]').bounding_box()
    page.mouse.move(src["x"] + src["width"] / 2, src["y"] + src["height"] / 2)
    page.mouse.down()
    page.mouse.move(src["x"] + src["width"] / 2 + 24, src["y"] + src["height"] / 2 + 12, steps=4)
    page.mouse.move(dst["x"] + dst["width"] / 2, dst["y"] + dst["height"] / 2, steps=8)
    page.wait_for_timeout(120)
    check("drag ghost visible", page.eval_on_selector_all(".drag-chip", "e=>e.length") == 1)
    ghost = page.evaluate("""() => { const g = document.querySelector('.drag-chip'); if (!g) return null;
        const i = g.querySelector('i');
        return {txt: g.textContent.trim(), fs: i ? getComputedStyle(i).fontSize : '',
                ink: i ? i.offsetWidth : 0, inner: Math.round(g.clientWidth * 0.6 * 10) / 10}; }""")
    check("drag ghost labels the chip in K / M / B and fits",
          bool(ghost) and ghost["txt"] == "50K" and ghost["ink"] <= ghost["inner"], str(ghost))
    page.mouse.up()
    page.wait_for_timeout(250)
    moved = page.evaluate("window.__bac.state.bets")
    check("drag moved player stake to banker", moved["player"] == 0 and moved["banker"] == 50000, str(moved["player"]) + "/" + str(moved["banker"]))
    check("move keeps balance", page.evaluate("window.__bac.state.balance") == before,
          f"{page.evaluate('window.__bac.state.balance')} vs {before}")
    check("move recorded in undo stack",
          page.evaluate("window.__bac.state.stack.some(e=>e.kind==='move')"))
    page.click("#undoBtn")
    page.wait_for_timeout(200)
    back = page.evaluate("window.__bac.state.bets")
    check("undo restores moved stake", back["player"] == 50000 and back["banker"] == 0,
          str(back["player"]) + "/" + str(back["banker"]))
    check("undo of move keeps balance", page.evaluate("window.__bac.state.balance") == before)

    # ── NEW: long-press then tap another zone
    box = page.query_selector('[data-spot="player"]').bounding_box()
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.mouse.down()
    page.wait_for_timeout(520)
    check("long press marks source zone",
          page.eval_on_selector('[data-spot="player"]', "e=>e.classList.contains('is-move-src')"))
    tie = page.query_selector('[data-spot="tie"]').bounding_box()
    page.mouse.move(tie["x"] + tie["width"] / 2, tie["y"] + tie["height"] / 2, steps=6)
    page.mouse.up()
    page.wait_for_timeout(250)
    held = page.evaluate("window.__bac.state.bets")
    check("long-press move to tie", held["player"] == 0 and held["tie"] == 50000, str(held))
    page.click("#clearBtn")
    page.wait_for_timeout(150)

    # ── deal: bonus round, mat mini cards, score badges, result badge
    bet(page, 10000, ["player"])
    bal_before = page.evaluate("window.__bac.state.balance")
    hands0 = page.evaluate("window.__bac.state.stats.hands")
    deal_now(page)
    page.wait_for_function("window.__bac.state.phase === 'result'", timeout=15000)
    page.wait_for_timeout(350)
    bonus = page.evaluate("window.__bac.state.bonus")
    check("bonus round deals 7 cards", len(bonus) == 7, str(len(bonus)))
    check("bonus cards rendered in rail", page.eval_on_selector_all(".bonus-card", "e=>e.length") == len(bonus))
    check("bonus rail has 7 slots", page.eval_on_selector_all(".bs-slot", "e=>e.length") == 7,
          str(page.eval_on_selector_all(".bs-slot", "e=>e.length")))

    state = page.evaluate("""() => { const s = window.__bac.state; return {
        balance: s.balance, hand: s.hand, bonus: s.bonus, lastBets: s.lastBets,
        stats: s.stats, hist: s.history.length }; }""")
    expected = page.evaluate("""() => { const s = window.__bac.state;
        const r = BaccaratEngine.settleRound({bets: s.lastBets, result: s.hand, mode: s.mode, noCommission: s.settings.noCommission, bonus: s.bonus});
        return {returned: r.returned, net: r.net, best: r.bestMultiplier}; }""")
    check("payout matches engine", abs(state["balance"] - (bal_before + expected["returned"])) < 1,
          f"{state['balance']} vs {bal_before + expected['returned']}")
    check("hand counted", state["stats"]["hands"] == hands0 + 1)
    # 결과 시트(#result)는 쓰지 않습니다 — 당첨은 테이블 위 리본 연출(IMG_1308)로만 보여 줍니다.
    expect_win = expected["net"] > 0 and expected["returned"] > 0
    sheet_on = page.eval_on_selector("#result", "e=>e.classList.contains('on')")
    check("result sheet never pops up", sheet_on is False, f"sheet={sheet_on}")
    win_line = page.evaluate("""() => {
      const c = document.getElementById('winCelebrate');
      const chip = document.querySelector('.bet-chip.is-win');
      return {on: c.classList.contains('on'),
              side: document.getElementById('wcSide').textContent.trim(),
              ribbon: document.getElementById('wcRibbon').className,
              amount: document.getElementById('wcAmount').textContent.trim(),
              lastwin: document.getElementById('lastWinCell').hidden ? '' : document.getElementById('lastWin').textContent.trim(),
              winline: document.querySelector('.statusbar').classList.contains('is-winline'),
              chip: chip ? {label: chip.textContent.trim(), cls: chip.className} : null};
    }""")
    check("win ribbon appears exactly on a winning round", win_line["on"] == expect_win, str(win_line))
    if expect_win:
        check("win ribbon names the winning side",
              win_line["side"] == {"player": "플레이어", "banker": "뱅커", "tie": "무"}[state["hand"]["winner"]],
              win_line["side"])
        check("win amount is the round payout",
              win_line["amount"].replace(",", "") == str(int(round(expected["returned"]))), win_line["amount"])
        check("status bar shows the last win in gold",
              win_line["winline"] and win_line["lastwin"].startswith("₩"), str(win_line))
        check("winning chip glows in its amount colour",
              bool(win_line["chip"]) and "is-win" in win_line["chip"]["cls"] and win_line["chip"]["label"].endswith("+"),
              str(win_line["chip"]))
    check("mat mini cards rendered", page.eval_on_selector_all(".mz-cards .mini-card", "e=>e.length") >= 4,
          str(page.eval_on_selector_all(".mz-cards .mini-card", "e=>e.length")))
    check("score badges show hand totals",
          page.inner_text("#playerTotal") == str(state["hand"]["playerTotal"]) and
          page.inner_text("#bankerTotal") == str(state["hand"]["bankerTotal"]),
          f"{page.inner_text('#playerTotal')} / {page.inner_text('#bankerTotal')}")
    check("centre winner badge shows the result letter",
          page.eval_on_selector("#handBadge", "e=>e.classList.contains('on') && !!e.querySelector('.hb-letter')"),
          page.eval_on_selector("#handBadge", "e=>e.className + ' | ' + e.textContent"))
    badge_letter = page.eval_on_selector("#handBadge .hb-letter", "e=>e.textContent")
    check("centre winner badge matches winner",
          badge_letter == {"player": "P", "banker": "B", "tie": "T"}[state["hand"]["winner"]], badge_letter)
    check("winning score badge highlighted",
          page.eval_on_selector_all(".score-badge.is-win", "e=>e.length") == (0 if state["hand"]["winner"] == "tie" else 1))

    # ── 라운드 종료 → 테이블 비우고 새 10초 카운트다운
    page.wait_for_function("window.__bac.state.phase === 'betting'", timeout=15000)
    page.wait_for_timeout(200)
    clean = page.evaluate("""() => ({
      cards: document.querySelectorAll('#playerCards .card, #bankerCards .card').length,
      minis: document.querySelectorAll('.mz-cards .mini-card').length,
      p: document.querySelector('#playerTotal').textContent.trim(),
      b: document.querySelector('#bankerTotal').textContent.trim(),
      badge: document.getElementById('handBadge').classList.contains('on'),
      sheet: document.getElementById('result').classList.contains('on'),
      win: document.querySelectorAll('.score-badge.is-win').length,
      clock: document.getElementById('clockNum').textContent
    })""")
    check("next round clears the table cards", clean["cards"] == 0, str(clean))
    check("next round clears mat mini cards", clean["minis"] == 0, str(clean))
    check("next round resets score badges", clean["p"] == "0" and clean["b"] == "0" and clean["win"] == 0, str(clean))
    check("next round hides the winner badge", clean["badge"] is False, str(clean))
    check("next round hides the result sheet", clean["sheet"] is False, str(clean))
    check("fresh 10s countdown starts", clean["clock"] == "10", str(clean["clock"]))

    # ── 딜러 손 모션: 슈에서 카드를 뽑아 테이블로
    page.evaluate("window.__bac.motionLog.length = 0")
    page.evaluate("() => { window.__bac.deal({auto: true}); }")
    hand_seen = False
    try:
        page.wait_for_function("!!document.querySelector('.dh-grip')", timeout=6000)
        hand_seen = True
    except Exception:
        hand_seen = False
    check("dealer hand overlay appears while dealing", hand_seen)
    hand_style = page.evaluate("""() => {
      const g = document.querySelector('.dh-grip');
      if (!g) return null;
      const h = g.querySelector('.dh-hand');
      const c = g.querySelector('.dh-card');
      const r = h ? h.getBoundingClientRect() : null;
      return {hand: !!h, card: !!c, w: r ? Math.round(r.width) : 0,
              svg: g.querySelectorAll('svg').length};
    }""")
    check("dealer hand is a drawn glove with a card", hand_style and hand_style["hand"] and hand_style["card"]
          and hand_style["w"] >= 40, str(hand_style))
    page.wait_for_function("window.__bac.state.phase === 'result'", timeout=20000)
    motion = page.evaluate("window.__bac.motionLog")
    check("every dealt card has a pull motion", len(motion) >= 4 and all(m["hand"] and m["ms"] >= 200 for m in motion),
          str(len(motion)))
    mouth_x = page.evaluate("() => { const r = document.querySelector('#shoeEl .sh-mouth').getBoundingClientRect(); const l = document.getElementById('dhLayer').getBoundingClientRect(); return r.left + r.width / 2 - l.left; }")
    check("card is pulled from the shoe mouth",
          all(abs(m["from"][0] - mouth_x) < 90 for m in motion),
          f"{[m['from'] for m in motion[:3]]} vs mouth {mouth_x}")

    # ── 점수 배지 실시간 합산
    page.wait_for_function("window.__bac.state.phase === 'betting'", timeout=15000)
    page.evaluate("""() => {
      window.__score_log = [];
      window.__tick_log = 0;
      for (const id of ['playerTotal', 'bankerTotal']) {
        const el = document.getElementById(id);
        new MutationObserver(() => {
          window.__score_log.push([id, el.textContent.trim()]);
          if (el.classList.contains('is-tick')) window.__tick_log++;
        }).observe(el, {childList: true, characterData: true, subtree: true, attributes: true,
                        attributeFilter: ['class']});
      }
    }""")
    page.evaluate("() => { window.__bac.deal({auto: true}); }")
    page.wait_for_function("window.__bac.state.phase === 'result'", timeout=20000)
    score_log = page.evaluate("window.__score_log")
    p_seq = [v for (i, v) in score_log if i == "playerTotal"]
    b_seq = [v for (i, v) in score_log if i == "bankerTotal"]
    hand = page.evaluate("window.__bac.state.hand")
    running = []
    tot = 0
    for c in hand["playerCards"]:
        tot = (tot + ({"A": 1, "10": 0, "J": 0, "Q": 0, "K": 0}.get(c["rank"], int(c["rank"]) if c["rank"].isdigit() else 0))) % 10
        running.append(str(tot))
    check("score badge counts every flipped card", all(v in p_seq for v in running) and p_seq[-1] == str(hand["playerTotal"]),
          f"{p_seq} vs {running}")
    check("each card makes the badge pop (live add)", page.evaluate("window.__tick_log") >= 2,
          str(page.evaluate("window.__tick_log")))
    b_run = []
    tot = 0
    for c in hand["bankerCards"]:
        tot = (tot + ({"A": 1, "10": 0, "J": 0, "Q": 0, "K": 0}.get(c["rank"], int(c["rank"]) if c["rank"].isdigit() else 0))) % 10
        b_run.append(str(tot))
    check("banker badge counts every flipped card", all(v in b_seq for v in b_run) and b_seq[-1] == str(hand["bankerTotal"]),
          f"{b_seq} vs {b_run}")
    check("score badges are not stuck at zero for a scoring hand",
          not any(v != "0" for v in running + b_run) or
          any(v != "0" for v in p_seq) or any(v != "0" for v in b_seq),
          f"{p_seq} / {b_seq} vs {running} / {b_run}")
    counts = hand_counts(page)
    bead_cap = page.eval_on_selector_all(".bead-cell", "e=>e.length")
    check("bead plate holds every hand",
          page.eval_on_selector_all(".bead-cell.p, .bead-cell.b, .bead-cell.t", "e=>e.length") == min(counts["n"], bead_cap),
          f"{page.eval_on_selector_all('.bead-cell.p, .bead-cell.b, .bead-cell.t', 'e=>e.length')} vs {counts['n']} / cap {bead_cap}")
    bead_style = page.evaluate("""() => {
      const b = document.querySelector('.bead-cell .bch');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return {radius: getComputedStyle(b).borderRadius, w: Math.round(r.width), h: Math.round(r.height),
              bg: getComputedStyle(b).backgroundColor};
    }""")
    check("bead badges are round", bead_style and bead_style["radius"].startswith("50%") and abs(bead_style["w"] - bead_style["h"]) <= 1,
          str(bead_style))
    check("bead badge colour by side",
          bead_style and bead_style["bg"] in ("rgb(26, 108, 240)", "rgb(224, 27, 37)", "rgb(23, 163, 91)"),
          str(bead_style and bead_style["bg"]))
    check("big road marks drawn", page.eval_on_selector_all(".br-cell.p, .br-cell.b", "e=>e.length") >= 1)

    # ── 그림장 디자인 (f_06 · IMG_1309): 글자 없는 굵은 링 · 라벨 없는 3등분 중국점 · 큰 비드 · 떠 있는 접기 버튼
    road_ui = page.evaluate("""() => {
      const rim = document.querySelector('.br-cell .rim');
      const rs = rim ? getComputedStyle(rim) : null;
      const cell = rim ? rim.closest('.br-cell') : null;
      const chev = document.querySelector('.road-chev');
      const big = document.querySelector('.bigroad').getBoundingClientRect();
      const cr = chev.getBoundingClientRect();
      const mr = [...document.querySelectorAll('.mini-roads .mr')];
      const bead = document.querySelector('.bead-cell .bch');
      const bcs = bead ? getComputedStyle(bead) : null;
      const shapeOf = (roadSel) => {
        const box = document.querySelector(roadSel + ' .mr-grid');
        if (!box) return null;
        const cell = document.createElement('div');
        cell.className = 'mr-cell mr-dot r';
        const icon = document.createElement('i');
        cell.appendChild(icon);
        box.appendChild(cell);
        const st = getComputedStyle(icon);
        const rect = icon.getBoundingClientRect();
        const out = {w: +rect.width.toFixed(1), h: +rect.height.toFixed(1),
                     hh: parseFloat(st.height), tr: st.transform !== 'none',
                     r: st.borderRadius, bw: parseFloat(st.borderTopWidth), bg: st.backgroundColor};
        cell.remove();
        return out;
      };
      const shape = (el) => el ? {w: +el.getBoundingClientRect().width.toFixed(1),
                                  h: +el.getBoundingClientRect().height.toFixed(1),
                                  r: getComputedStyle(el).borderRadius,
                                  bw: parseFloat(getComputedStyle(el).borderTopWidth),
                                  bg: getComputedStyle(el).backgroundColor} : null;
      return {
        rimText: rim ? rim.textContent.trim() : 'none',
        rimBorder: rs ? parseFloat(rs.borderTopWidth) : 0,
        rimRound: rs ? rs.borderRadius : '',
        labels: document.querySelectorAll('.mr-label').length,
        mrCount: mr.length,
        mrWidths: mr.map(m => Math.round(m.getBoundingClientRect().width)),
        chevTopRight: cr.right <= big.right + 2 && cr.left > big.left + big.width * 0.45 &&
                      cr.top <= big.top + big.height * 0.4 && cr.bottom < big.bottom,
        bead: bcs ? {color: bcs.color, weight: parseInt(bcs.fontWeight, 10), radius: bcs.borderRadius,
                     solid: bcs.backgroundImage === 'none' && bcs.backgroundColor !== 'rgba(0, 0, 0, 0)'} : null,
        eye: shapeOf('.eye'),
        small: shapeOf('.small'),
        cock: shapeOf('.cock')
      };
    }""")
    check("big road rings carry no letters", road_ui["rimText"] == "", str(road_ui["rimText"]))
    check("big road rings are bold hollow circles",
          road_ui["rimBorder"] >= 1.6 and road_ui["rimRound"].startswith("50%"),
          f"{road_ui['rimBorder']} / {road_ui['rimRound']}")
    check("china roads lose their labels", road_ui["labels"] == 0 and road_ui["mrCount"] == 3, str(road_ui))
    check("china roads split the width in three",
          max(road_ui["mrWidths"]) - min(road_ui["mrWidths"]) <= 2, str(road_ui["mrWidths"]))
    check("road fold button floats inside the big road's top right", road_ui["chevTopRight"] is True)
    check("bead badges are bold white letters on a solid circle",
          road_ui["bead"] and road_ui["bead"]["color"] == "rgb(255, 255, 255)" and road_ui["bead"]["weight"] >= 800
          and road_ui["bead"]["radius"].startswith("50%") and road_ui["bead"]["solid"],
          str(road_ui["bead"]))
    check("china 1군 draws hollow circles", road_ui["eye"] and road_ui["eye"]["bw"] >= 1 and road_ui["eye"]["r"].startswith("50%"),
          str(road_ui["eye"]))
    check("china 2군 draws filled dots",
          road_ui["small"] and road_ui["small"]["bw"] == 0 and road_ui["small"]["r"].startswith("50%")
          and road_ui["small"]["bg"] not in ("rgba(0, 0, 0, 0)", "transparent"), str(road_ui["small"]))
    check("china 3군 draws thin slashes",
          road_ui["cock"] and road_ui["cock"]["hh"] <= 3 and road_ui["cock"]["tr"], str(road_ui["cock"]))
    check("stat bar counts", page.inner_text("#statP") == str(counts["p"]) and
          page.inner_text("#statB") == str(counts["b"]) and
          page.inner_text("#statHands") == str(counts["n"]),
          f"{page.inner_text('#statP')}/{page.inner_text('#statB')}/{page.inner_text('#statHands')}")

    # ── 잃은 라운드: 결과 시트 없이 승리 배지만
    page.wait_for_function("window.__bac.state.phase === 'betting'", timeout=15000)
    page.evaluate("""() => {
      const s = window.__bac.state;
      s.bets = { player: 10000 };
      s.balance -= 10000;
      s.phase = 'dealing';
      s.hand = {
        playerCards: [{rank: '2', suit: 's', id: '2s'}, {rank: '3', suit: 'h', id: '3h'}],
        bankerCards: [{rank: '9', suit: 's', id: '9s'}, {rank: 'K', suit: 'd', id: 'Kd'}],
        playerTotal: 5, bankerTotal: 9, winner: 'banker', natural: false,
        playerThird: null, bankerThird: null, playerPair: false, bankerPair: false,
        playerPerfect: false, bankerPerfect: false, trace: ['banker-stand']
      };
      window.__bac.finishHand();
    }""")
    page.wait_for_timeout(350)
    check("losing round shows no result sheet",
          not page.eval_on_selector("#result", "e=>e.classList.contains('on')"))
    check("losing round still shows the winner badge",
          page.eval_on_selector("#handBadge", "e=>e.classList.contains('on') && e.querySelector('.hb-letter').textContent === 'B'"),
          page.eval_on_selector("#handBadge", "e=>e.textContent"))
    page.wait_for_function("window.__bac.state.phase === 'betting'", timeout=8000)

    # ── 당첨 라운드: 테이블 위 리본 + '이겼습니다' + 금빛 금액 + 금액대 색 당첨 칩 + 지난 우승
    page.evaluate("""() => {
      const s = window.__bac.state;
      s.bets = { banker: 50000 };
      s.balance -= 50000;
      s.bonus = [];
      s.phase = 'dealing';
      s.hand = {
        playerCards: [{rank: '8', suit: 'h', id: '8h'}, {rank: '4', suit: 'd', id: '4d'}],
        bankerCards: [{rank: '7', suit: 'c', id: '7c'}, {rank: '10', suit: 'h', id: '10h'}],
        playerTotal: 2, bankerTotal: 7, winner: 'banker', natural: false,
        playerThird: null, bankerThird: null, playerPair: false, bankerPair: false,
        playerPerfect: false, bankerPerfect: false, trace: ['player-draw']
      };
      window.__bac.finishHand();
    }""")
    page.wait_for_timeout(400)
    win_probe = page.evaluate("""() => {
      const c = document.getElementById('winCelebrate');
      const amt = document.getElementById('wcAmount');
      const st = document.querySelector('.statusbar');
      const chip = document.querySelector('.bet-chip.is-win');
      const cs = getComputedStyle(amt);
      const bigRow = document.querySelector('.bigroad .br-cell.p, .bigroad .br-cell.b');
      return {
        on: c.classList.contains('on'),
        ribbon: document.getElementById('wcRibbon').className,
        side: document.getElementById('wcSide').textContent.trim(),
        amount: amt.textContent.trim(),
        gold: getComputedStyle(document.querySelector('.wc-amount')).backgroundImage.indexOf('gradient') >= 0
              && cs.webkitTextFillColor.replace(/\s/g, '') === 'rgba(0,0,0,0)',
        won: document.getElementById('wcWon').textContent.trim(),
        sheet: document.getElementById('result').classList.contains('on'),
        lastwin: document.getElementById('lastWin').textContent.trim(),
        stakeHidden: document.getElementById('stakeCell').hidden,
        winline: st.classList.contains('is-winline'),
        chip: chip ? {label: chip.textContent.trim(), cls: chip.className,
                      bg: getComputedStyle(chip).getPropertyValue('--c-bg').trim()} : null,
        badgeHidden: getComputedStyle(document.getElementById('handBadge')).opacity
      };
    }""")
    check("winning round shows the ribbon celebration", win_probe["on"] is True, str(win_probe))
    check("ribbon names banker and turns red", win_probe["side"] == "뱅커" and "is-b" in win_probe["ribbon"], str(win_probe))
    check("ribbon is followed by '이겼습니다'", win_probe["won"] == "이겼습니다", win_probe["won"])
    check("win amount is the payout (₩97,500 for 50,000 @0.95)",
          win_probe["amount"].replace(",", "") == "97500", win_probe["amount"])
    check("win amount is drawn in gold", win_probe["gold"] is True, str(win_probe["gold"]))
    check("winning round keeps the result sheet hidden", win_probe["sheet"] is False)
    check("status bar swaps stake for '지난 우승'",
          win_probe["winline"] and win_probe["stakeHidden"] and win_probe["lastwin"] == "₩97,500", str(win_probe))
    check("winning chip shows the payout in the amount colour",
          bool(win_probe["chip"]) and win_probe["chip"]["label"] == "97K+" and
          win_probe["chip"]["bg"] == "#1B8A3A", str(win_probe["chip"]))
    check("ribbon replaces the centre winner badge", float(win_probe["badgeHidden"]) < 0.2, win_probe["badgeHidden"])
    page.wait_for_function("window.__bac.state.phase === 'betting'", timeout=8000)
    page.wait_for_timeout(250)
    after = page.evaluate("""() => ({
      on: document.getElementById('winCelebrate').classList.contains('on'),
      winline: document.querySelector('.statusbar').classList.contains('is-winline'),
      chips: document.querySelectorAll('.bet-chip.is-win').length,
      stakeBack: !document.getElementById('stakeCell').hidden
    })""")
    check("next round clears the win celebration",
          after["on"] is False and after["winline"] is False and after["chips"] == 0 and after["stakeBack"] is True,
          str(after))

    # ── rebet
    tclick(page, "#resultClose")
    stake = sum(state["lastBets"].values())
    page.click("#rebetBtn")
    page.wait_for_timeout(200)
    restored = page.evaluate("Object.values(window.__bac.state.bets).reduce((a,b)=>a+b,0)")
    check("rebet restores stake", restored == stake, f"{restored} vs {stake}")
    tclick(page, "#clearBtn")

    # ── derived roads after several hands
    for _ in range(6):
        clear(page)
        page.click('[data-spot="banker"]')
        deal_now(page)
        page.wait_for_function("window.__bac.state.phase === 'betting'", timeout=25000)
        page.wait_for_timeout(180)
    cols = page.evaluate("BaccaratEngine.bigRoadColumns(window.__bac.state.history).length")
    dots = page.eval_on_selector_all(".mr-dot", "e=>e.length")
    check("derived roads drawn", cols >= 3 and dots >= 1, f"{cols} columns / {dots} dots")

    # ── Ask the road: P/B 예측 버튼 → 다음 칸 깜빡이 미리보기
    page.wait_for_function("window.__bac.state.phase === 'betting'", timeout=20000)
    tclick(page, "#predP")
    page.wait_for_timeout(150)
    check("P preview marks one big-road cell", page.eval_on_selector_all(".br-cell.is-preview", "e=>e.length") == 1,
          str(page.eval_on_selector_all(".br-cell.is-preview", "e=>e.length")))
    check("P preview cell is player", page.eval_on_selector(".br-cell.is-preview", "e=>e.classList.contains('p')"))
    check("P preview blinks (animation)", page.eval_on_selector(".br-cell.is-preview",
          "e=>getComputedStyle(e, '::after').animationName !== 'none'"))
    check("P preview marks the derived roads", page.eval_on_selector_all(".mr-cell.is-preview", "e=>e.length") >= 1,
          str(page.eval_on_selector_all(".mr-cell.is-preview", "e=>e.length")))
    check("P button shows pressed state", page.eval_on_selector("#predP", "e=>e.classList.contains('is-on') && e.getAttribute('aria-pressed') === 'true'"))
    tclick(page, "#predB")
    page.wait_for_timeout(150)
    check("B preview switches to banker", page.eval_on_selector(".br-cell.is-preview", "e=>e.classList.contains('b')"),
          page.eval_on_selector(".br-cell.is-preview", "e=>e.className"))
    check("B button pressed, P released",
          page.eval_on_selector("#predB", "e=>e.classList.contains('is-on')") and
          page.eval_on_selector("#predP", "e=>!e.classList.contains('is-on')"))
    page.wait_for_timeout(4400)
    check("preview clears itself after a few seconds",
          page.eval_on_selector_all(".is-preview", "e=>e.length") == 0,
          str(page.eval_on_selector_all(".is-preview", "e=>e.length")))

    # ── refill / reshuffle / auto reshuffle
    bal_pre = page.evaluate("window.__bac.state.balance")
    page.click("#refillBtn")
    page.wait_for_timeout(150)
    check("refill +₩10억", page.evaluate("window.__bac.state.balance") == bal_pre + 1000000000,
          str(page.evaluate("window.__bac.state.balance") - bal_pre))
    page.click("#shoeEl")
    page.wait_for_timeout(200)
    check("shoe click reshuffles 416", page.evaluate("window.__bac.state.shoe.remaining") == 416)
    page.evaluate("window.__bac.state.shoe.cards.length = 10")
    page.click('[data-spot="player"]')
    deal_now(page)
    page.wait_for_function("window.__bac.state.phase === 'betting'", timeout=25000)
    page.wait_for_timeout(200)
    check("auto reshuffle <=14", page.evaluate("window.__bac.state.shoe.remaining") > 380,
          str(page.evaluate("window.__bac.state.shoe.remaining")))
    check("new shoe starts a fresh road", page.evaluate("window.__bac.state.history.length") == 1,
          str(page.evaluate("window.__bac.state.history.length")))
    clear(page)

    # ── NEW: live shoe auto-progress (관전만 해도 슈가 계속 돈다)
    clear(page)
    h_before = page.evaluate("window.__bac.state.history.length")
    bal_before = page.evaluate("window.__bac.state.balance")
    page.wait_for_function(f"window.__bac.state.history.length > {h_before}", timeout=40000)
    page.wait_for_function("window.__bac.state.phase === 'betting'", timeout=30000)
    page.wait_for_timeout(400)
    check("auto deal fires at countdown 0 without a bet",
          page.evaluate("window.__bac.state.history.length") == h_before + 1)
    check("spectator round costs nothing", page.evaluate("window.__bac.state.balance") == bal_before)
    check("spectator round shows no result sheet",
          not page.eval_on_selector("#result", "e=>e.classList.contains('on')"))
    clock_now = page.inner_text("#clockNum")
    check("countdown restarts for the next round", clock_now.isdigit() and int(clock_now) == 10, clock_now)
    page.wait_for_timeout(1300)
    clock_next = page.inner_text("#clockNum")
    check("countdown is 10 seconds and ticks down", clock_next.isdigit() and int(clock_next) <= 9, clock_next)

    # 모달이 열려 있으면 자동 진행 정지
    page.click("#infoBtn")
    page.wait_for_timeout(400)
    c1 = page.inner_text("#clockNum")
    h1 = page.evaluate("window.__bac.state.history.length")
    page.wait_for_timeout(3400)
    c2 = page.inner_text("#clockNum")
    h2 = page.evaluate("window.__bac.state.history.length")
    check("countdown paused while a modal is open", c1 == c2 and h1 == h2, f"{c1}->{c2}, {h1}->{h2}")
    page.click("#modalClose")
    page.wait_for_timeout(300)

    # 베팅해 둔 라운드도 카운트다운이 끝나면 자동 정산
    page.evaluate("window.__bac.state.balance = 1000000000; window.__bac.renderAll()")
    page.click('#chipRow .chip[data-chip="1000000"]')
    page.click('[data-spot="banker"]')
    bal_bet = page.evaluate("window.__bac.state.balance")
    page.wait_for_function(f"window.__bac.state.history.length > {h2}", timeout=40000)
    page.wait_for_function("window.__bac.state.phase === 'betting'", timeout=30000)
    page.wait_for_timeout(400)
    auto_settle = page.evaluate("""() => { const s = window.__bac.state;
        const r = BaccaratEngine.settleRound({bets: s.lastBets, result: s.hand, mode: s.mode, noCommission: s.settings.noCommission, bonus: s.bonus});
        return {balance: s.balance, returned: r.returned, lastBets: s.lastBets.banker}; }""")
    check("auto deal settles the placed bet", auto_settle["lastBets"] == 1000000 and
          auto_settle["balance"] == bal_bet + auto_settle["returned"],
          str(auto_settle))
    clear(page)

    # ── squeeze
    page.click("#infoBtn")
    page.wait_for_timeout(250)
    page.click("#optSqueeze + .sw")
    page.wait_for_timeout(150)
    page.click("#modalClose")
    page.wait_for_timeout(200)
    page.click('[data-spot="banker"]')
    deal_now(page)
    page.wait_for_function("window.__bac.state.phase === 'reveal'", timeout=9000)
    check("squeeze cards face down", page.eval_on_selector_all(".card.up", "e=>e.length") == 0)
    check("squeeze hint", page.eval_on_selector("#squeezeHint", "e=>e.classList.contains('on')"))
    check("mini cards face down in mat", page.eval_on_selector_all(".mz-cards .mini-card.back", "e=>e.length") >= 4)
    page.click(".card.peekable")
    page.wait_for_timeout(250)
    check("squeeze tap reveals", page.eval_on_selector_all(".card.up", "e=>e.length") == 1)
    for _ in range(4):
        tclick(page, "#revealAllBtn")
        page.wait_for_timeout(400)
        if page.evaluate("window.__bac.state.phase") != "reveal":
            break
    try:
        page.wait_for_function("window.__bac.state.phase === 'result'", timeout=8000)
        squeeze_settled = True
    except Exception:
        squeeze_settled = False
    check("squeeze settles", squeeze_settled)
    check("squeeze round still shows the winner badge",
          page.eval_on_selector("#handBadge", "e=>e.classList.contains('on') && !!e.querySelector('.hb-letter')"),
          page.eval_on_selector("#handBadge", "e=>e.className"))
    page.wait_for_function("window.__bac.state.phase === 'betting'", timeout=10000)
    page.click("#infoBtn")
    page.wait_for_timeout(200)
    page.click("#optSqueeze + .sw")
    page.wait_for_timeout(150)
    page.click("#modalClose")
    page.wait_for_timeout(200)
    clear(page)

    # ── live multipliers + celebration (쪼기 없이 자동 오픈으로 진행)
    page.click("#infoBtn")
    page.wait_for_timeout(250)
    if page.eval_on_selector("#optSqueeze", "e=>e.checked"):
        page.click("#optSqueeze + .sw")
        page.wait_for_timeout(150)
    page.click("#modalClose")
    page.wait_for_timeout(200)
    page.evaluate("window.__bac.state.balance = 6000000; window.__bac.renderAll()")

    ok = False
    for attempt in range(4):
        clear(page)
        page.wait_for_function("window.__bac.state.phase === 'betting'", timeout=30000)
        page.click('#chipRow .chip[data-chip="50000"]')
        page.click('[data-spot="player"]')
        page.click('[data-spot="banker"]')
        page.click('[data-spot="playerBonus"]')
        deal_now(page)
        page.wait_for_function("window.__bac.state.hand && (window.__bac.state.phase === 'dealing' || window.__bac.state.phase === 'result')", timeout=12000)
        winner = page.evaluate("window.__bac.state.hand.winner")
        if winner == "tie":
            page.wait_for_function("window.__bac.state.phase === 'betting'", timeout=20000)
            continue
        page.evaluate("""() => {
            const s = window.__bac.state; const h = s.hand;
            const hand = h.winner === 'banker' ? h.bankerCards : h.playerCards;
            const seen = new Set(); const picks = [];
            for (const c of hand) { if (!seen.has(c.id)) { seen.add(c.id); picks.push(c); } }
            s.bonus = picks.slice(0, 2).map((c, i) => Object.assign({}, c, { multiplier: i === 0 ? 8 : 5 }));
            window.__bac.renderBonusShowcase();
        }""")
        page.wait_for_function("window.__bac.state.phase === 'result'", timeout=15000)
        page.wait_for_timeout(220)
        ok = True
        break

    check("bonus win scenario dealt", ok)
    if ok:
        settled_mult = page.evaluate("window.__bac.state.history[window.__bac.state.history.length-1].mult")
        check("bonus cards matched the winning hand", settled_mult >= 8, str(settled_mult))
        check("live multiplier chip", "×" in page.inner_text("#liveMult"), repr(page.inner_text("#liveMult")))
        check("petals fall on the winning bet zone",
              page.evaluate("() => Array.from(document.querySelectorAll('.zone-fall')).some(z => z.querySelectorAll('.zf').length > 0)"),
              str(page.eval_on_selector_all(".zone-fall .zf", "e=>e.length")))
        check("celebration shown", page.eval_on_selector("#celebrate", "e=>e.classList.contains('on')"))
        check("celebration multiplier matches settlement", f"×{settled_mult}" in page.inner_text("#celMult"),
              f"×{settled_mult} vs {page.inner_text('#celMult')}")
        check("win ribbon shown with the bonus win",
              page.eval_on_selector("#winCelebrate", "e=>e.classList.contains('on')"))
        check("ribbon amount is shown with the bonus win",
              page.inner_text("#wcAmount").replace(",", "").isdigit(), page.inner_text("#wcAmount"))
        check("petals fall on the win ribbon", page.eval_on_selector_all("#winCelebrate .fx-fall .zf", "e=>e.length") > 0,
              str(page.eval_on_selector_all("#winCelebrate .fx-fall .zf", "e=>e.length")))
        check("petals fall on the win banner", page.eval_on_selector_all("#celebrate .fx-fall .zf", "e=>e.length") > 0,
              str(page.eval_on_selector_all("#celebrate .fx-fall .zf", "e=>e.length")))
        page.screenshot(path=os.path.join(ROOT, "preview-celebration.png"))
        tclick(page, "#resultClose")
        page.wait_for_function("window.__bac.state.phase === 'betting'", timeout=10000)

    # back to fast mode
    page.click("#infoBtn")
    page.wait_for_timeout(250)
    page.click("#optSqueeze + .sw")
    page.wait_for_timeout(150)
    page.click("#modalClose")
    page.wait_for_timeout(200)

    # ── accounts
    guest_before = page.evaluate("window.__bac.state.balance")
    clear(page)
    page.click("#accountBtn")
    page.wait_for_timeout(300)
    check("auth modal opens", page.eval_on_selector("#authBack", "e=>!e.hidden"))
    page.click('.auth-tabs button[data-auth="signup"]')
    page.wait_for_timeout(180)
    page.fill("#authId", "enptester")
    page.fill("#authNick", "엔피테스터")
    page.fill("#authPin", "2468")
    page.fill("#authPin2", "2468")
    page.click("#authSubmit")
    page.wait_for_timeout(900)
    check("header shows nickname", page.inner_text("#accName") == "엔피테스터", page.inner_text("#accName"))
    check("logout button visible", page.eval_on_selector("#logoutBtn", "e=>!e.hidden"))
    check("signup balance ₩10억", page.evaluate("window.__bac.state.balance") == 1000000000,
          str(page.evaluate("window.__bac.state.balance")))

    # ── hidden admin
    check("no admin hint in UI", "6160" not in page.inner_text("body"))
    page.dblclick("#brand")
    page.wait_for_timeout(400)
    check("PIN pad opens", page.eval_on_selector("#pinBack", "e=>!e.hidden"))
    for k in ["1", "2", "3", "4"]:
        page.click(f'#keypad button[data-key="{k}"]')
        page.wait_for_timeout(60)
    page.wait_for_timeout(900)
    check("wrong PIN rejected", page.eval_on_selector("#adminBack", "e=>e.hidden"))
    for k in ["6", "1", "6", "0"]:
        page.click(f'#keypad button[data-key="{k}"]')
        page.wait_for_timeout(70)
    page.wait_for_timeout(600)
    check("admin opens with 6160", page.eval_on_selector("#adminBack", "e=>!e.hidden"))
    check("admin lists the user", "엔피테스터" in page.inner_text("#admUsers"), page.inner_text("#admUsers")[:60])
    check("github sync panel present", page.eval_on_selector_all("#ghRepo, #ghPat, #ghPush", "e=>e.length") == 3)
    page.screenshot(path=os.path.join(ROOT, "preview-admin.png"))

    page.fill("#admAmount", "100000")
    page.click('.adm-user[data-uid="enptester"] button[data-op="plus"]')
    page.wait_for_timeout(350)
    check("admin +100,000", page.evaluate("window.__bac.state.balance") == 1000100000,
          str(page.evaluate("window.__bac.state.balance")))
    check("header balance live update", page.inner_text("#balance") == "10억", page.inner_text("#balance"))
    page.click('.adm-user[data-uid="enptester"] button[data-op="minus"]')
    page.wait_for_timeout(300)
    check("admin -100,000", page.evaluate("window.__bac.state.balance") == 1000000000)
    page.click('.adm-presets button[data-preset="1000000"]')
    page.wait_for_timeout(300)
    check("admin preset +100만", page.evaluate("window.__bac.state.balance") == 1001000000,
          str(page.evaluate("window.__bac.state.balance")))
    page.click("#adminClose")
    page.wait_for_timeout(250)

    # ── persistence
    page.reload()
    page.wait_for_function("window.__SPLASH_DONE__ === true", timeout=6000)
    page.wait_for_timeout(300)
    check("session persisted", page.inner_text("#accName") == "엔피테스터", page.inner_text("#accName"))
    check("balance persisted", page.evaluate("window.__bac.state.balance") == 1001000000,
          str(page.evaluate("window.__bac.state.balance")))

    # ── logout / login
    page.click("#logoutBtn")
    page.wait_for_timeout(400)
    check("logout -> guest header", page.inner_text("#accName") in ("로그인", "로그인·가입"), page.inner_text("#accName"))
    check("guest balance restored", page.evaluate("window.__bac.state.balance") == guest_before,
          f"{page.evaluate('window.__bac.state.balance')} vs {guest_before}")
    page.click("#accountBtn")
    page.wait_for_timeout(300)
    page.fill("#authId", "enptester")
    page.fill("#authPin", "2468")
    page.click("#authSubmit")
    page.wait_for_timeout(700)
    check("login restores balance", page.evaluate("window.__bac.state.balance") == 1001000000,
          str(page.evaluate("window.__bac.state.balance")))

    # ── mode screenshots (배속 화면용 — 쪼기 끄고 한 라운드씩)
    page.click("#infoBtn")
    page.wait_for_timeout(220)
    if page.eval_on_selector("#optSqueeze", "e=>e.checked"):
        page.click("#optSqueeze + .sw")
        page.wait_for_timeout(150)
    page.click("#modalClose")
    page.wait_for_timeout(200)
    for mode in ["speed", "snow"]:
        page.wait_for_function("window.__bac.state.phase === 'betting'", timeout=40000)
        page.click(f'.mode-btn[data-mode="{mode}"]')
        page.wait_for_timeout(500)
        clear(page)
        page.click('#chipRow .chip[data-chip="50000"]')
        page.click('[data-spot="banker"]')
        deal_now(page)
        page.wait_for_function("window.__bac.state.phase === 'result'", timeout=25000)
        # 결과 유지 시간이 짧은 스피드 테이블에서도 카드가 지워지기 전에 잡습니다
        page.wait_for_timeout(150)
        page.screenshot(path=os.path.join(ROOT, f"preview-{mode}.png"), animations="disabled")
        page.wait_for_function("window.__bac.state.phase === 'betting'", timeout=15000)

    page.click('.mode-btn[data-mode="sakura"]')
    page.wait_for_timeout(400)
    clear(page)
    page.screenshot(path=os.path.join(ROOT, "preview-desktop.png"))

    check("no console/page errors (desktop)", not errors, "; ".join(errors[:5]))
    check("desktop overflow after play", page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"))
    check("desktop height after play", page.evaluate("document.documentElement.scrollHeight <= window.innerHeight + 4"),
          page.evaluate("document.documentElement.scrollHeight"))
    ctx.close()


def run_mobile(browser):
    ctx, page, errors = open_page(browser, {"width": 390, "height": 844}, mobile=True, scale=3)
    page.wait_for_function("window.__SPLASH_DONE__ === true", timeout=6000)
    page.wait_for_timeout(400)

    check("mobile no horizontal overflow", page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"),
          page.evaluate("[document.documentElement.scrollWidth, window.innerWidth]"))
    check("mobile fits one screen", page.evaluate("document.documentElement.scrollHeight <= window.innerHeight + 4"),
          page.evaluate("[document.documentElement.scrollHeight, window.innerHeight]"))

    boxes = page.evaluate("""() => {
      const r = (s) => { const e = document.querySelector(s); const b = e.getBoundingClientRect();
        return [Math.round(b.top), Math.round(b.bottom), Math.round(b.height)]; };
      return {dealer: r('.dealer-view'), roads: r('.roadboard'), mat: r('.betting-mat'),
              ctrl: r('.bet-controls'), status: r('.statusbar')};
    }""")
    ok_order = (boxes["dealer"][0] >= 44 and boxes["dealer"][1] <= boxes["roads"][0] + 1
                and boxes["roads"][1] <= boxes["mat"][0] + 1 and boxes["mat"][1] <= boxes["ctrl"][0] + 1
                and boxes["ctrl"][1] <= boxes["status"][0] + 1 and boxes["status"][1] <= 845)
    check("mobile 3-stage vertical order", ok_order, str(boxes))
    check("dealer stage keeps height", boxes["dealer"][2] >= 180, str(boxes["dealer"]))
    check("roads always visible (no drawer)", boxes["roads"][2] >= 120, str(boxes["roads"]))

    mclk = clock_probe(page)
    check("mobile clock stays big", mclk["w"] >= 40 and mclk["inside"], str(mclk))
    check("mobile clock is never covered", mclk["onTop"], str(mclk))
    check("mobile clock number is legible", mclk["font"] >= 16, str(mclk["font"]))

    chip_row = page.evaluate("""() => {
      const row = document.querySelector('.chip-row').getBoundingClientRect();
      const chips = Array.from(document.querySelectorAll('#chipRow .chip')).map(c => c.getBoundingClientRect());
      return {n: chips.length, rowRight: Math.round(row.right), lastRight: Math.round(chips[chips.length-1].right),
              min: Math.round(Math.min(...chips.map(c => c.width))),
              rowH: Math.round(row.height)};
    }""")
    check("mobile shows all 10 chips in one row", chip_row["n"] == 10 and chip_row["lastRight"] <= chip_row["rowRight"] + 1,
          str(chip_row))
    check("mobile chip touch size", chip_row["min"] >= 26, str(chip_row["min"]))

    small = page.evaluate("""() => {
      const bad = [];
      document.querySelectorAll('.chip, .ctrl-btn, .deal-btn, .mode-btn, .bp-refill, .account-btn, .mini-btn').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width && r.height && r.height < 24) bad.push(el.className + ' ' + Math.round(r.height));
      });
      return bad;
    }""")
    check("mobile touch targets", not small, str(small[:4]))

    # ── NEW: zoom guards
    meta = page.eval_on_selector("meta[name=viewport]", "e=>e.getAttribute('content')")
    check("viewport blocks zoom", "maximum-scale=1" in meta and "user-scalable=no" in meta, meta)
    ta = page.evaluate("""() => ({
      html: getComputedStyle(document.documentElement).touchAction,
      body: getComputedStyle(document.body).touchAction,
      chip: getComputedStyle(document.querySelector('.chip')).touchAction,
      ctrl: getComputedStyle(document.querySelector('.ctrl-btn')).touchAction,
      zone: getComputedStyle(document.querySelector('[data-spot="player"]')).touchAction,
      btn: getComputedStyle(document.querySelector('.mode-btn')).touchAction
    })""")
    check("touch-action manipulation on controls",
          ta["html"] == "manipulation" and ta["body"] == "manipulation" and ta["chip"] == "manipulation"
          and ta["ctrl"] == "manipulation" and ta["btn"] == "manipulation", str(ta))
    check("betting zones suppress native gestures", ta["zone"] in ("none", "manipulation"), str(ta["zone"]))
    prevented = page.evaluate("""() => {
      const ev = new MouseEvent('dblclick', {bubbles: true, cancelable: true});
      const zone = document.querySelector('[data-spot="player"]');
      zone.dispatchEvent(ev);
      const ev2 = new MouseEvent('dblclick', {bubbles: true, cancelable: true});
      document.querySelector('.bet-controls').dispatchEvent(ev2);
      return [ev.defaultPrevented, ev2.defaultPrevented];
    }""")
    check("double-tap zoom default prevented", prevented == [True, True], str(prevented))

    # double tap on a chip must still register twice (no click swallowing)
    chip = page.query_selector('#chipRow .chip[data-chip="50000"]')
    cb = chip.bounding_box()
    page.mouse.click(cb["x"] + cb["width"] / 2, cb["y"] + cb["height"] / 2, click_count=2)
    page.wait_for_timeout(200)
    check("double click chip selects it", page.evaluate("window.__bac.state.chip") == 50000,
          str(page.evaluate("window.__bac.state.chip")))

    # logo double tap still opens the admin PIN
    page.dblclick("#brand")
    page.wait_for_timeout(350)
    check("logo double-tap opens PIN on mobile", page.eval_on_selector("#pinBack", "e=>!e.hidden"))
    page.click("#pinClose")
    page.wait_for_timeout(200)

    # ── 모바일 실탭: P·B 예측 버튼 → 그림장 깜빡이 링이 화면에 보인다
    page.evaluate("() => window.__bac.setPreview(null)")
    page.wait_for_timeout(120)
    box = page.query_selector("#predP").bounding_box()
    check("P button is big enough to tap", box and box["width"] >= 44 and box["height"] >= 22, str(box))
    page.touchscreen.tap(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.wait_for_timeout(500)
    pv = page.evaluate("""() => {
      const cell = document.querySelector('.br-cell.is-preview');
      if (!cell) return null;
      const r = cell.getBoundingClientRect();
      const after = getComputedStyle(cell, '::after');
      return {x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
              inView: r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth + .5 && r.bottom <= window.innerHeight + .5,
              anim: after.animationName, op: after.opacity};
    }""")
    check("mobile P tap marks the next big-road cell", pv is not None, str(pv))
    check("the preview cell sits inside the screen", pv and pv["inView"] and pv["w"] > 0 and pv["h"] > 0, str(pv))
    check("the preview ring blinks", pv and pv["anim"] != "none", str(pv))
    if pv:
        page.wait_for_timeout(430)
        op2 = page.evaluate("() => { const c = document.querySelector('.br-cell.is-preview'); return c ? getComputedStyle(c, '::after').opacity : null; }")
        check("the preview ring fades in and out", op2 is not None and op2 != pv["op"], f"{pv['op']} -> {op2}")
    # 중국점이 시작된 이후에도 함께 점멸하는지: 긴 출목표를 잠시 넣어 확인하고 되돌린다
    mr = page.evaluate("""() => {
      const s = window.__bac.state;
      const saved = s.history.slice();
      const seq = ['player','banker','banker','player','player','banker','player','banker','banker','player','player','banker'];
      s.history = seq.map((w, i) => ({winner: w, p: 7, b: 5, pp: false, bp: false, mult: 1, ts: Date.now() + i}));
      window.__bac.renderAll();
      const cells = [...document.querySelectorAll('.mr-cell.is-preview')].filter(c => {
        const r = c.getBoundingClientRect();
        return r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth + .5 && r.bottom <= window.innerHeight + .5;
      });
      const n = cells.length;
      s.history = saved;
      window.__bac.renderAll();
      return n;
    }""")
    check("the preview also marks the china roads on screen", mr >= 1, str(mr))
    boxb = page.query_selector("#predB").bounding_box()
    page.touchscreen.tap(boxb["x"] + boxb["width"] / 2, boxb["y"] + boxb["height"] / 2)
    page.wait_for_timeout(400)
    check("mobile B tap switches the preview to banker",
          page.eval_on_selector(".br-cell.is-preview", "e=>e.classList.contains('b')"))
    page.evaluate("() => window.__bac.setPreview(null)")
    page.wait_for_timeout(150)

    # ── 3 modes on mobile
    for mode in ["speed", "sakura", "snow"]:
        page.click(f'.mode-btn[data-mode="{mode}"]')
        page.wait_for_timeout(220)
        check(f"mobile mode {mode}", page.evaluate("document.body.dataset.mode") == mode)
        check(f"mobile mode {mode} no overflow",
              page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"))
    page.click('.mode-btn[data-mode="sakura"]')
    page.wait_for_timeout(250)

    # ── touch drag moves a bet
    page.click('#chipRow .chip[data-chip="50000"]')
    page.click('[data-spot="player"]')
    page.wait_for_timeout(150)
    bal = page.evaluate("window.__bac.state.balance")
    src = page.query_selector('[data-spot="player"]').bounding_box()
    dst = page.query_selector('[data-spot="banker"]').bounding_box()
    page.touchscreen.tap(src["x"] + src["width"] / 2, src["y"] + src["height"] / 2)
    page.wait_for_timeout(150)
    check("mobile tap places a bet", page.evaluate("window.__bac.state.bets.player") == 100000,
          str(page.evaluate("window.__bac.state.bets.player")))
    bal = page.evaluate("window.__bac.state.balance")
    page.mouse.move(src["x"] + src["width"] / 2, src["y"] + src["height"] / 2)
    page.mouse.down()
    page.mouse.move(dst["x"] + dst["width"] / 2, dst["y"] + dst["height"] / 2, steps=10)
    page.mouse.up()
    page.wait_for_timeout(250)
    mb = page.evaluate("window.__bac.state.bets")
    check("mobile drag moves stake", mb["banker"] == 100000 and mb["player"] == 0, str(mb["banker"]) + "/" + str(mb["player"]))
    check("mobile move keeps balance", page.evaluate("window.__bac.state.balance") == bal)
    page.click("#undoBtn")
    page.wait_for_timeout(150)
    check("mobile undo restores", page.evaluate("window.__bac.state.bets")["player"] == 100000)
    page.click("#clearBtn")
    page.wait_for_timeout(150)

    # ── 한 번의 탭 = 한 번의 베팅 (pointerup + 합성 click 중복 방지)
    page.click('#chipRow .chip[data-chip="1000"]')
    before_tap = page.evaluate("window.__bac.state.bets.player")
    page.evaluate("""() => {
      const z = document.querySelector('[data-spot="player"]');
      const r = z.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const base = {bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 7,
                    pointerType: 'touch', isPrimary: true, button: 0};
      z.dispatchEvent(new PointerEvent('pointerdown', Object.assign({}, base, {buttons: 1})));
      z.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, base, {buttons: 0})));
      z.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, clientX: x, clientY: y}));
    }""")
    page.wait_for_timeout(200)
    after_tap = page.evaluate("window.__bac.state.bets.player")
    check("one tap places exactly one bet", after_tap - before_tap == 1000,
          f"{before_tap} -> {after_tap}")
    # 의도적인 빠른 2연타는 2회 베팅
    page.click('[data-spot="player"]')
    page.wait_for_timeout(140)
    page.click('[data-spot="player"]')
    page.wait_for_timeout(200)
    after_two = page.evaluate("window.__bac.state.bets.player")
    check("double tap still bets twice", after_two - before_tap == 3000, f"{before_tap} -> {after_two}")
    page.click("#clearBtn")
    page.wait_for_timeout(150)

    # ── deal + screenshots
    page.click('#chipRow .chip[data-chip="10000"]')
    page.click('[data-spot="banker"]')
    bal_before = page.evaluate("window.__bac.state.balance")
    deal_now(page)
    page.wait_for_function("window.__bac.state.phase === 'result'", timeout=20000)
    page.wait_for_timeout(400)
    mob = page.evaluate("""() => { const s = window.__bac.state;
        const r = BaccaratEngine.settleRound({bets: s.lastBets, result: s.hand, mode: s.mode, noCommission: s.settings.noCommission, bonus: s.bonus});
        return {balance: s.balance, returned: r.returned, hist: s.history.length, bonus: s.bonus.length}; }""")
    check("mobile balance math", mob["balance"] == bal_before + mob["returned"],
          f"{mob['balance']} vs {bal_before + mob['returned']}")
    check("mobile bonus cards", mob["bonus"] == 7, str(mob["bonus"]))
    check("mobile mini cards after deal", page.eval_on_selector_all(".mz-cards .mini-card", "e=>e.length") >= 4)
    check("mobile 7 bonus slots fit without overflow",
          page.eval_on_selector_all(".bs-slot", "e=>e.length") == 7 and
          page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"))
    check("mobile overflow after deal", page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"))
    check("mobile no scroll after deal", page.evaluate("document.documentElement.scrollHeight <= window.innerHeight + 4"),
          page.evaluate("document.documentElement.scrollHeight"))
    tclick(page, "#resultClose")
    page.wait_for_timeout(350)
    page.screenshot(path=os.path.join(ROOT, "preview-mobile.png"))

    # ── signup + admin on mobile
    page.click("#accountBtn")
    page.wait_for_timeout(300)
    page.click('.auth-tabs button[data-auth="signup"]')
    page.wait_for_timeout(150)
    page.fill("#authId", "mobuser")
    page.fill("#authPin", "1357")
    page.fill("#authPin2", "1357")
    page.click("#authSubmit")
    page.wait_for_timeout(800)
    check("mobile signup", page.inner_text("#accName") in ("mobuser", "로그인"), page.inner_text("#accName"))
    page.dblclick("#brand")
    page.wait_for_timeout(350)
    for k in ["6", "1", "6", "0"]:
        page.click(f'#keypad button[data-key="{k}"]')
        page.wait_for_timeout(70)
    page.wait_for_timeout(600)
    check("mobile admin opens", page.eval_on_selector("#adminBack", "e=>!e.hidden"))
    page.click('.adm-user[data-uid="mobuser"] button[data-op="plus"]')
    page.wait_for_timeout(300)
    check("mobile admin adjust", page.evaluate("window.__bac.state.balance") == 1000100000,
          str(page.evaluate("window.__bac.state.balance")))
    page.screenshot(path=os.path.join(ROOT, "preview-admin-mobile.png"))
    page.click("#adminClose")
    page.wait_for_timeout(200)
    check("mobile overflow after admin", page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"))

    check("no console/page errors (mobile)", not errors, "; ".join(errors[:5]))
    ctx.close()


def main():
    srv = serve()
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=BIN, args=["--no-sandbox"])
        run_desktop(browser)
        run_mobile(browser)
        browser.close()
    srv.shutdown()

    print("\n%d checks, %d failures" % (len(results), len(failures)))
    if failures:
        print("FAILURES:")
        for f in failures:
            print(" -", f)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
