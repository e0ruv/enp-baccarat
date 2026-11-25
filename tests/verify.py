#!/usr/bin/env python3
"""ENP BACCARAT — Playwright verification (live-table mobile UI).

Covers: splash, 3 tables, 3-stage mobile composition (dealer studio / road board /
betting mat), 9 betting zones, mat mini-cards, score + result badges, derived roads,
side-bet settlement (player/banker bonus, perfect pair 하나/더블, either pair),
bet moving between zones by drag and long-press (+ undo), double-tap zoom guards,
squeeze, accounts, hidden admin (6160), GitHub sync panel, zero console errors and
zero overflow at 390x844 and 1440x900.
"""
import functools
import http.server
import os
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
      if (b.length < 1 || b.length > 5) out.fail.push(mode + ' bonus count ' + b.length);
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
    page.click(f'#chipRow .chip[data-chip="{chip}"]')
    for spot in spots:
        page.click(f'[data-spot="{spot}"]')


def clear(page):
    tclick(page, "#resultClose")
    page.wait_for_timeout(120)
    tclick(page, "#clearBtn")
    page.wait_for_timeout(120)


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
    check("player/banker/tie payouts", page.inner_text("#payPlayer") == "1:1" and page.inner_text("#payTie") == "8:1"
          and page.inner_text("#payBanker") == "0.95:1",
          f"{page.inner_text('#payPlayer')} {page.inner_text('#payTie')} {page.inner_text('#payBanker')}")
    check("bonus side-bet payouts", page.inner_text("#payPB") == "1~30:1" and page.inner_text("#payBB") == "1~30:1",
          f"{page.inner_text('#payPB')} / {page.inner_text('#payBB')}")
    check("perfect pair payout label", "25:1" in page.inner_text("#payPerfect") and "200:1" in page.inner_text("#payPerfect"),
          page.inner_text("#payPerfect"))
    check("either pair payout", page.inner_text("#payEither") == "5:1", page.inner_text("#payEither"))
    check("tie zone labelled 무", "무" in page.inner_text('[data-spot="tie"]'), page.inner_text('[data-spot="tie"]'))

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
    page.click("#dealBtn")
    page.wait_for_function("window.__bac.state.phase === 'reveal' || window.__bac.state.phase === 'betting'", timeout=9000)
    bonus = page.evaluate("window.__bac.state.bonus")
    check("bonus round 1-5 cards", 1 <= len(bonus) <= 5, str(len(bonus)))
    check("bonus cards rendered in rail", page.eval_on_selector_all(".bonus-card", "e=>e.length") == len(bonus))
    page.wait_for_function("window.__bac.state.phase === 'betting'", timeout=20000)
    page.wait_for_timeout(500)

    state = page.evaluate("""() => { const s = window.__bac.state; return {
        balance: s.balance, hand: s.hand, bonus: s.bonus, lastBets: s.lastBets,
        stats: s.stats, hist: s.history.length }; }""")
    expected = page.evaluate("""() => { const s = window.__bac.state;
        const r = BaccaratEngine.settleRound({bets: s.lastBets, result: s.hand, mode: s.mode, noCommission: s.settings.noCommission, bonus: s.bonus});
        return {returned: r.returned, net: r.net, best: r.bestMultiplier}; }""")
    check("payout matches engine", abs(state["balance"] - (bal_before + expected["returned"])) < 1,
          f"{state['balance']} vs {bal_before + expected['returned']}")
    check("hand counted", state["stats"]["hands"] == hands0 + 1)
    check("result sheet shown", page.eval_on_selector("#result", "e=>e.classList.contains('on')"))
    check("result amount shown", page.inner_text("#resultAmount") != "")
    check("mat mini cards rendered", page.eval_on_selector_all(".mz-cards .mini-card", "e=>e.length") >= 4,
          str(page.eval_on_selector_all(".mz-cards .mini-card", "e=>e.length")))
    check("score badges show hand totals",
          page.inner_text("#playerTotal") == str(state["hand"]["playerTotal"]) and
          page.inner_text("#bankerTotal") == str(state["hand"]["bankerTotal"]),
          f"{page.inner_text('#playerTotal')} / {page.inner_text('#bankerTotal')}")
    check("centre result badge", page.eval_on_selector("#handBadge", "e=>e.classList.contains('on') && e.textContent.length===1"),
          page.eval_on_selector("#handBadge", "e=>e.textContent"))
    check("winning score badge highlighted",
          page.eval_on_selector_all(".score-badge.is-win", "e=>e.length") == (0 if state["hand"]["winner"] == "tie" else 1))
    check("bead plate updated", page.eval_on_selector_all(".bead-cell", "e=>e.length") == state["hist"])
    check("big road updated", page.eval_on_selector_all(".br-cell", "e=>e.length") >= 1)
    check("stat bar counts", page.inner_text("#statP") == str(state["stats"]["player"]) and
          page.inner_text("#statB") == str(state["stats"]["banker"]),
          f"{page.inner_text('#statP')}/{page.inner_text('#statB')}")

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
        page.click("#dealBtn")
        page.wait_for_function("window.__bac.state.phase === 'betting'", timeout=25000)
        page.wait_for_timeout(180)
    cols = page.evaluate("BaccaratEngine.bigRoadColumns(window.__bac.state.history).length")
    dots = page.eval_on_selector_all(".mr-dot", "e=>e.length")
    check("derived roads drawn", cols >= 3 and dots >= 1, f"{cols} columns / {dots} dots")

    # ── refill / reshuffle / auto reshuffle
    bal_pre = page.evaluate("window.__bac.state.balance")
    page.click("#refillBtn")
    page.wait_for_timeout(150)
    check("refill +1,000,000", page.evaluate("window.__bac.state.balance") == bal_pre + 1000000)
    page.click("#shoeEl")
    page.wait_for_timeout(200)
    check("shoe click reshuffles 416", page.evaluate("window.__bac.state.shoe.remaining") == 416)
    page.evaluate("window.__bac.state.shoe.cards.length = 10")
    page.click('[data-spot="player"]')
    page.click("#dealBtn")
    page.wait_for_function("window.__bac.state.phase === 'betting'", timeout=25000)
    page.wait_for_timeout(200)
    check("auto reshuffle <=14", page.evaluate("window.__bac.state.shoe.remaining") > 380,
          str(page.evaluate("window.__bac.state.shoe.remaining")))
    clear(page)

    # ── squeeze
    page.click("#infoBtn")
    page.wait_for_timeout(250)
    page.click("#optSqueeze + .sw")
    page.wait_for_timeout(150)
    page.click("#modalClose")
    page.wait_for_timeout(200)
    page.click('[data-spot="banker"]')
    page.click("#dealBtn")
    page.wait_for_function("window.__bac.state.phase === 'reveal'", timeout=9000)
    check("squeeze cards face down", page.eval_on_selector_all(".card.up", "e=>e.length") == 0)
    check("squeeze hint", page.eval_on_selector("#squeezeHint", "e=>e.classList.contains('on')"))
    check("mini cards face down in mat", page.eval_on_selector_all(".mz-cards .mini-card.back", "e=>e.length") >= 4)
    page.click(".card.peekable")
    page.wait_for_timeout(250)
    check("squeeze tap reveals", page.eval_on_selector_all(".card.up", "e=>e.length") == 1)
    for _ in range(4):
        tclick(page, "#revealAllBtn")
        page.wait_for_timeout(650)
        if page.evaluate("window.__bac.state.phase") == "betting":
            break
    try:
        page.wait_for_function("document.querySelector('#result').classList.contains('on')", timeout=3500)
        squeeze_settled = True
    except Exception:
        squeeze_settled = False
    check("squeeze settles", squeeze_settled)
    page.click("#infoBtn")
    page.wait_for_timeout(200)
    page.click("#optSqueeze + .sw")
    page.wait_for_timeout(150)
    page.click("#modalClose")
    page.wait_for_timeout(200)
    clear(page)

    # ── live multipliers + celebration
    page.click("#infoBtn")
    page.wait_for_timeout(250)
    page.click("#optSqueeze + .sw")
    page.wait_for_timeout(150)
    page.click("#modalClose")
    page.wait_for_timeout(200)
    page.evaluate("window.__bac.state.balance = 6000000; window.__bac.renderAll()")

    ok = False
    for attempt in range(4):
        clear(page)
        page.click('#chipRow .chip[data-chip="50000"]')
        page.click('[data-spot="player"]')
        page.click('[data-spot="banker"]')
        page.click('[data-spot="playerBonus"]')
        page.click("#dealBtn")
        page.wait_for_function("window.__bac.state.phase === 'reveal'", timeout=15000)
        winner = page.evaluate("window.__bac.state.hand.winner")
        if winner == "tie":
            for _ in range(4):
                tclick(page, "#revealAllBtn")
                page.wait_for_timeout(650)
                if page.evaluate("window.__bac.state.phase") == "betting":
                    break
            continue
        page.evaluate("""() => {
            const s = window.__bac.state; const h = s.hand;
            const hand = h.winner === 'banker' ? h.bankerCards : h.playerCards;
            const seen = new Set(); const picks = [];
            for (const c of hand) { if (!seen.has(c.id)) { seen.add(c.id); picks.push(c); } }
            s.bonus = picks.slice(0, 2).map((c, i) => Object.assign({}, c, { multiplier: i === 0 ? 8 : 5 }));
            window.__bac.renderBonusShowcase();
        }""")
        page.wait_for_timeout(250)
        for _ in range(4):
            tclick(page, "#revealAllBtn")
            page.wait_for_timeout(650)
            if page.evaluate("window.__bac.state.phase") == "betting":
                break
        ok = True
        break

    check("bonus win scenario dealt", ok)
    if ok:
        check("live multiplier chip", "×" in page.inner_text("#liveMult"), repr(page.inner_text("#liveMult")))
        check("celebration shown", page.eval_on_selector("#celebrate", "e=>e.classList.contains('on')"))
        settled_mult = page.evaluate("window.__bac.state.history[window.__bac.state.history.length-1].mult")
        check("celebration multiplier matches settlement", f"×{settled_mult}" in page.inner_text("#celMult"),
              f"×{settled_mult} vs {page.inner_text('#celMult')}")
        page.screenshot(path=os.path.join(ROOT, "preview-celebration.png"))
        page.wait_for_timeout(3300)
        check("result sheet shown after celebration", page.eval_on_selector("#result", "e=>e.classList.contains('on')"))
        tclick(page, "#resultClose")

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
    check("signup balance 1,000,000", page.evaluate("window.__bac.state.balance") == 1000000,
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
    check("admin +100,000", page.evaluate("window.__bac.state.balance") == 1100000,
          str(page.evaluate("window.__bac.state.balance")))
    check("header balance live update", page.inner_text("#balance") == "1,100,000", page.inner_text("#balance"))
    page.click('.adm-user[data-uid="enptester"] button[data-op="minus"]')
    page.wait_for_timeout(300)
    check("admin -100,000", page.evaluate("window.__bac.state.balance") == 1000000)
    page.click('.adm-presets button[data-preset="1000000"]')
    page.wait_for_timeout(300)
    check("admin preset +100만", page.evaluate("window.__bac.state.balance") == 2000000,
          str(page.evaluate("window.__bac.state.balance")))
    page.click("#adminClose")
    page.wait_for_timeout(250)

    # ── persistence
    page.reload()
    page.wait_for_function("window.__SPLASH_DONE__ === true", timeout=6000)
    page.wait_for_timeout(300)
    check("session persisted", page.inner_text("#accName") == "엔피테스터", page.inner_text("#accName"))
    check("balance persisted", page.evaluate("window.__bac.state.balance") == 2000000,
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
    check("login restores balance", page.evaluate("window.__bac.state.balance") == 2000000,
          str(page.evaluate("window.__bac.state.balance")))

    # ── mode screenshots
    for mode in ["speed", "snow"]:
        page.click(f'.mode-btn[data-mode="{mode}"]')
        page.wait_for_timeout(400)
        clear(page)
        page.click('#chipRow .chip[data-chip="50000"]')
        page.click('[data-spot="banker"]')
        page.click("#dealBtn")
        page.wait_for_function("window.__bac.state.phase === 'betting'", timeout=25000)
        page.wait_for_timeout(300)
        tclick(page, "#resultClose")
        page.screenshot(path=os.path.join(ROOT, f"preview-{mode}.png"))

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

    # ── deal + screenshots
    page.click('#chipRow .chip[data-chip="10000"]')
    page.click('[data-spot="banker"]')
    bal_before = page.evaluate("window.__bac.state.balance")
    page.click("#dealBtn")
    page.wait_for_function("window.__bac.state.phase === 'betting'", timeout=25000)
    page.wait_for_timeout(500)
    mob = page.evaluate("""() => { const s = window.__bac.state;
        const r = BaccaratEngine.settleRound({bets: s.lastBets, result: s.hand, mode: s.mode, noCommission: s.settings.noCommission, bonus: s.bonus});
        return {balance: s.balance, returned: r.returned, hist: s.history.length, bonus: s.bonus.length}; }""")
    check("mobile balance math", mob["balance"] == bal_before + mob["returned"],
          f"{mob['balance']} vs {bal_before + mob['returned']}")
    check("mobile bonus cards", 1 <= mob["bonus"] <= 5, str(mob["bonus"]))
    check("mobile mini cards after deal", page.eval_on_selector_all(".mz-cards .mini-card", "e=>e.length") >= 4)
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
    check("mobile admin adjust", page.evaluate("window.__bac.state.balance") == 1100000,
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
