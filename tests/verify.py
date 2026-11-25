#!/usr/bin/env python3
"""ENP BACCARAT — Playwright verification.

Covers: ornate splash, 3 tables (speed / blossom / snowflake), board deals,
bonus cards & stacked multipliers, live multiplier chips, big-win celebration,
roadmaps, squeeze, accounts (sign up / login / logout), hidden admin (6160),
zero console errors, zero horizontal overflow at 1440x900 and 390x844.
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

  // shoe composition
  const shoe = new E.Shoe(8);
  out.checked++;
  const counts = {};
  shoe.cards.forEach((c) => { counts[c.id] = (counts[c.id] || 0) + 1; });
  if (shoe.cards.length !== 416) out.fail.push('shoe size ' + shoe.cards.length);
  if (Object.keys(counts).length !== 52) out.fail.push('shoe identities');
  if (Object.values(counts).some((n) => n !== 8)) out.fail.push('shoe copies');

  // bonus cards: 1-5, distinct, 2..8
  for (let i = 0; i < 150; i++) {
    for (const mode of ['sakura', 'snow']) {
      const b = E.createBonusCards(E.MODES[mode].bonus);
      out.checked++;
      if (b.length < 1 || b.length > 5) out.fail.push(mode + ' bonus count ' + b.length);
      if (new Set(b.map((x) => x.id)).size !== b.length) out.fail.push('bonus duplicates');
      if (b.some((x) => [2, 3, 4, 5, 8].indexOf(x.multiplier) < 0)) out.fail.push('bad multiplier');
    }
  }
  if (E.MODES.speed.bonus !== null) out.fail.push('speed should have no bonus');

  // settlement: player 1:1 with a single 4x card in a 2-card hand
  const result = {
    playerCards: [{rank: '5', suit: 's', id: '5s'}, {rank: '4', suit: 'h', id: '4h'}],
    bankerCards: [{rank: '9', suit: 'c', id: '9c'}, {rank: '8', suit: 'd', id: '8d'}],
    playerTotal: 9, bankerTotal: 7, winner: 'player', natural: false,
    playerPair: false, bankerPair: false
  };
  const bonus = [{rank: '5', suit: 's', id: '5s', multiplier: 4}, {rank: '4', suit: 'h', id: '4h', multiplier: 2}];
  const st = E.settleRound({bets: {player: 10000}, result, mode: 'sakura', bonus});
  out.checked++;
  if (st.returned !== 160000) out.fail.push('stacked product returned ' + st.returned);
  if (st.bestMultiplier !== 8) out.fail.push('bestMultiplier ' + st.bestMultiplier);

  // banker 0.95 no bonus
  const st2 = E.settleRound({bets: {banker: 10000}, result: {...result, winner: 'banker'}, mode: 'speed', bonus: []});
  out.checked++;
  if (st2.returned !== 19500) out.fail.push('banker 0.95 returned ' + st2.returned);

  // tie 8:1 + push
  const tieRes = {...result, winner: 'tie', playerTotal: 7, bankerTotal: 7};
  const st3 = E.settleRound({bets: {tie: 10000, player: 10000}, result: tieRes, mode: 'snow', bonus: []});
  out.checked++;
  if (st3.returned !== 90000 + 10000) out.fail.push('tie/push returned ' + st3.returned);

  // pair 11:1 plain and with 5x bonus
  const pairRes = {...result, winner: 'player', playerPair: true};
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

  // plain player 1:1
  const st7 = E.settleRound({bets: {player: 10000}, result, mode: 'sakura', bonus: []});
  out.checked++;
  if (st7.returned !== 20000) out.fail.push('plain player returned ' + st7.returned);

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


def deal_until(page, pred, tries=10, bet_chip="50000"):
    """Deal hands until pred(state) is true. Returns last state."""
    for _ in range(tries):
        tclick(page, "#resultClose")
        tclick(page, "#clearBtn")
        page.click(f'#chipRow .chip[data-chip="{bet_chip}"]')
        page.click('[data-spot="player"]')
        page.click('[data-spot="banker"]')
        page.click("#dealBtn")
        page.wait_for_function("window.__bac.state.phase === 'betting'", timeout=25000)
        page.wait_for_timeout(300)
        if page.evaluate("""(p) => {
            const s = window.__bac.state;
            const h = s.history[s.history.length - 1];
            return p === 'mult' ? !!(h && h.mult > 1) : true;
        }""", pred):
            return True
    return False


def run_desktop(browser):
    ctx, page, errors = open_page(browser, {"width": 1440, "height": 900})

    # ── splash
    page.wait_for_timeout(450)
    check("splash visible on load", page.eval_on_selector("#splash", "e=>!!e && !e.classList.contains('is-done')"))
    check("splash shows plaque wordmark", page.inner_text("#splashEn") in ("BLOSSOM", "SPEED", "SNOWFLAKE"),
          page.inner_text("#splashEn"))
    page.screenshot(path=os.path.join(ROOT, "preview-splash.png"))
    page.wait_for_function("window.__SPLASH_DONE__ === true", timeout=6000)
    page.wait_for_timeout(400)
    check("splash auto-dismissed", page.eval_on_selector_all("#splash", "e=>e.length") == 0)
    check("desktop no horizontal overflow", page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"),
          page.evaluate("[document.documentElement.scrollWidth, window.innerWidth]"))
    check("desktop fits viewport", page.evaluate("document.documentElement.scrollHeight <= window.innerHeight + 4"),
          page.evaluate("document.documentElement.scrollHeight"))

    # ── default mode
    check("default table is blossom", page.evaluate("document.body.dataset.mode") == "sakura",
          page.evaluate("document.body.dataset.mode"))
    check("three mode tabs only", page.eval_on_selector_all(".mode-btn", "e=>e.length") == 3)
    check("no lightning tab", page.eval_on_selector_all('.mode-btn[data-mode="lightning"]', "e=>e.length") == 0)

    # ── mode switching
    expects = {
        "speed": ("스피드 바카라", False, "8:1", "11:1"),
        "sakura": ("벚꽃 바카라", True, "8:1", "11:1"),
        "snow": ("눈꽃 바카라", True, "8:1", "11:1"),
    }
    for mode, (name, strip, tie_pay, pair_pay) in expects.items():
        page.click(f'.mode-btn[data-mode="{mode}"]')
        page.wait_for_timeout(320)
        check(f"mode {mode}: theme", page.evaluate("document.body.dataset.mode") == mode)
        check(f"mode {mode}: active pill",
              page.eval_on_selector(f'.mode-btn[data-mode="{mode}"]', "e=>e.classList.contains('is-active')"))
        check(f"mode {mode}: name", page.inner_text("#tableName") == name, page.inner_text("#tableName"))
        strip_shown = page.eval_on_selector("#bonusStrip", "e=>getComputedStyle(e).display !== 'none'")
        check(f"mode {mode}: bonus strip", strip_shown == strip)
        check(f"mode {mode}: tie payout", page.inner_text("#payTie") == tie_pay, page.inner_text("#payTie"))
        check(f"mode {mode}: pair payout", page.inner_text("#payPP") == pair_pay, page.inner_text("#payPP"))
        check(f"mode {mode}: fee row hidden",
              page.eval_on_selector("#feeRow", "e=>getComputedStyle(e).display === 'none'"))

    page.click('.mode-btn[data-mode="sakura"]')
    page.wait_for_timeout(300)

    # ── engine verification
    eng = page.evaluate(ENGINE_JS)
    check(f"engine rules ({eng['checked']} cases)", not eng["fail"], "; ".join(eng["fail"][:6]))

    # ── betting (no fee)
    bal0 = page.evaluate("window.__bac.state.balance")
    page.click('#chipRow .chip[data-chip="10000"]')
    page.click('[data-spot="player"]')
    check("bet stake", page.inner_text("#totalStake") == "₩10,000", page.inner_text("#totalStake"))
    check("bet debit = stake (no fee)", page.inner_text("#totalDebit") == "₩10,000", page.inner_text("#totalDebit"))
    check("balance debited", page.evaluate("window.__bac.state.balance") == bal0 - 10000)
    page.click("#undoBtn")
    check("undo refunds", page.evaluate("window.__bac.state.balance") == bal0)
    page.click('[data-spot="banker"]')
    page.click('[data-spot="playerPair"]')
    check("multi-spot stake", page.inner_text("#totalStake") == "₩20,000", page.inner_text("#totalStake"))
    page.click("#clearBtn")
    check("clear refunds all", page.evaluate("window.__bac.state.balance") == bal0)

    # ── bonus round + deal
    page.click('#chipRow .chip[data-chip="10000"]')
    page.click('[data-spot="player"]')
    bal_before = page.evaluate("window.__bac.state.balance")
    hands0 = page.evaluate("window.__bac.state.stats.hands")
    page.click("#dealBtn")
    page.wait_for_function("window.__bac.state.phase === 'reveal' || window.__bac.state.phase === 'betting'", timeout=8000)
    bonus = page.evaluate("window.__bac.state.bonus")
    check("bonus round 1-5 cards", 1 <= len(bonus) <= 5, str(len(bonus)))
    check("bonus cards distinct", len({c["id"] for c in bonus}) == len(bonus))
    check("bonus multipliers 2/3/4/5/8", all(c["multiplier"] in (2, 3, 4, 5, 8) for c in bonus),
          str([c["multiplier"] for c in bonus]))
    check("bonus strip rendered", page.eval_on_selector_all(".bonus-card", "e=>e.length") == len(bonus))
    page.wait_for_function("window.__bac.state.phase === 'betting'", timeout=20000)
    page.wait_for_timeout(400)

    state = page.evaluate("""() => { const s = window.__bac.state; return {
        balance: s.balance, hand: s.hand, bonus: s.bonus, lastBets: s.lastBets,
        stats: s.stats, hist: s.history.length,
        resultOn: document.querySelector('#result').classList.contains('on') }; }""")
    expected = page.evaluate("""() => { const s = window.__bac.state;
        const r = BaccaratEngine.settleRound({bets: s.lastBets, result: s.hand, mode: s.mode, noCommission: s.settings.noCommission, bonus: s.bonus});
        return {returned: r.returned, net: r.net, best: r.bestMultiplier}; }""")
    check("payout matches engine", abs(state["balance"] - (bal_before + expected["returned"])) < 1,
          f"{state['balance']} vs {bal_before + expected['returned']}")
    check("hand counted", state["stats"]["hands"] == hands0 + 1)
    check("result overlay shown", state["resultOn"])
    check("result amount", page.inner_text("#resultAmount") != "", page.inner_text("#resultAmount"))
    check("bead plate updated", page.eval_on_selector_all(".bead-cell", "e=>e.length") == state["hist"])
    page.click('.road-tab[data-road="big"]')
    page.wait_for_timeout(200)
    non_tie = page.evaluate("window.__bac.state.history.filter(h=>h.winner!=='tie').length")
    br_cells = page.eval_on_selector_all(".br-cell", "e=>e.length")
    check("big road updated", (br_cells >= 1) if non_tie else (br_cells == 0), f"{br_cells} cells / {non_tie} non-tie")
    page.click('.road-tab[data-road="bead"]')

    # ── rebet
    tclick(page, "#resultClose")
    stake = sum(state["lastBets"].values())
    page.click("#rebetBtn")
    page.wait_for_timeout(200)
    restored = page.evaluate("Object.values(window.__bac.state.bets).reduce((a,b)=>a+b,0)")
    check("rebet restores stake", restored == stake, f"{restored} vs {stake}")
    tclick(page, "#clearBtn")

    # ── refill / reshuffle / auto reshuffle
    bal_pre = page.evaluate("window.__bac.state.balance")
    page.click("#refillBtn")
    page.wait_for_timeout(150)
    check("refill +1,000千", page.evaluate("window.__bac.state.balance") == bal_pre + 1000000)
    page.click("#reshuffleBtn")
    page.wait_for_timeout(200)
    check("manual reshuffle 416", page.evaluate("window.__bac.state.shoe.remaining") == 416)
    page.evaluate("window.__bac.state.shoe.cards.length = 10")
    page.click('[data-spot="player"]')
    page.click("#dealBtn")
    page.wait_for_function("window.__bac.state.phase === 'betting'", timeout=20000)
    page.wait_for_timeout(200)
    check("auto reshuffle <=14", page.evaluate("window.__bac.state.shoe.remaining") > 380,
          str(page.evaluate("window.__bac.state.shoe.remaining")))
    tclick(page, "#resultClose")
    tclick(page, "#clearBtn")

    # ── squeeze
    page.click("#infoBtn")
    page.wait_for_timeout(250)
    page.click("#optSqueeze + .sw")
    page.wait_for_timeout(150)
    page.click("#modalClose")
    page.wait_for_timeout(200)
    page.click('[data-spot="banker"]')
    page.click("#dealBtn")
    page.wait_for_function("window.__bac.state.phase === 'reveal'", timeout=8000)
    check("squeeze cards face down", page.eval_on_selector_all(".card.up", "e=>e.length") == 0)
    check("squeeze hint", page.eval_on_selector("#squeezeHint", "e=>e.classList.contains('on')"))
    page.click(".card.peekable")
    page.wait_for_timeout(250)
    check("squeeze tap reveals", page.eval_on_selector_all(".card.up", "e=>e.length") == 1)
    for _ in range(4):
        tclick(page, "#revealAllBtn")
        page.wait_for_timeout(650)
        if page.evaluate("window.__bac.state.phase") == "betting":
            break
    try:
        page.wait_for_function("document.querySelector('#result').classList.contains('on')", timeout=3000)
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
    tclick(page, "#resultClose")
    tclick(page, "#clearBtn")

    # ── live multipliers + celebration (squeeze reveal, bonus cards on winning hand)
    page.click("#infoBtn")
    page.wait_for_timeout(250)
    page.click("#optSqueeze + .sw")
    page.wait_for_timeout(150)
    page.click("#modalClose")
    page.wait_for_timeout(200)
    page.evaluate("window.__bac.state.balance = 6000000; window.__bac.renderAll()")

    ok = False
    for attempt in range(4):
        tclick(page, "#resultClose")
        tclick(page, "#clearBtn")
        page.click('#chipRow .chip[data-chip="50000"]')
        page.click('[data-spot="player"]')
        page.click('[data-spot="banker"]')
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
        check("result panel shown after celebration", page.eval_on_selector("#result", "e=>e.classList.contains('on')"))
        check("multiplier pill", page.eval_on_selector("#resultMult", "e=>e.classList.contains('on')"),
              page.inner_text("#resultMult"))
        page.wait_for_timeout(400)
        page.screenshot(path=os.path.join(ROOT, "preview-desktop.png"))
        tclick(page, "#resultClose")

    # back to fast mode
    page.click("#infoBtn")
    page.wait_for_timeout(250)
    page.click("#optSqueeze + .sw")
    page.wait_for_timeout(150)
    page.click("#modalClose")
    page.wait_for_timeout(200)

    # ── accounts: sign up
    guest_before = page.evaluate("window.__bac.state.balance")
    tclick(page, "#resultClose")
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
    check("signed up", page.evaluate("window.__bac.state.balance") is not None)
    check("header shows nickname", page.inner_text("#accName") == "엔피테스터", page.inner_text("#accName"))
    check("logout button visible", page.eval_on_selector("#logoutBtn", "e=>!e.hidden"))
    check("signup balance 1,000,000", page.evaluate("window.__bac.state.balance") == 1000000,
          str(page.evaluate("window.__bac.state.balance")))

    # ── admin via logo double click + PIN 6160
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

    # ── persistence across reload
    page.reload()
    page.wait_for_function("window.__SPLASH_DONE__ === true", timeout=6000)
    page.wait_for_timeout(300)
    check("session persisted", page.inner_text("#accName") == "엔피테스터", page.inner_text("#accName"))
    check("balance persisted", page.evaluate("window.__bac.state.balance") == 2000000,
          str(page.evaluate("window.__bac.state.balance")))

    # ── logout → guest
    page.click("#logoutBtn")
    page.wait_for_timeout(400)
    check("logout -> guest header", page.inner_text("#accName") in ("로그인", "로그인·가입"), page.inner_text("#accName"))
    check("guest balance restored", page.evaluate("window.__bac.state.balance") == guest_before,
          f"{page.evaluate('window.__bac.state.balance')} vs {guest_before}")

    # ── login again restores account balance
    page.click("#accountBtn")
    page.wait_for_timeout(300)
    page.fill("#authId", "enptester")
    page.fill("#authPin", "2468")
    page.click("#authSubmit")
    page.wait_for_timeout(700)
    check("login restores balance", page.evaluate("window.__bac.state.balance") == 2000000,
          str(page.evaluate("window.__bac.state.balance")))

    # ── mode showcase screenshots
    for mode in ["speed", "snow"]:
        page.click(f'.mode-btn[data-mode="{mode}"]')
        page.wait_for_timeout(400)
        tclick(page, "#clearBtn")
        page.click('#chipRow .chip[data-chip="50000"]')
        page.click('[data-spot="banker"]')
        page.click("#dealBtn")
        page.wait_for_function("window.__bac.state.phase === 'betting'", timeout=25000)
        page.wait_for_timeout(300)
        tclick(page, "#resultClose")
        page.screenshot(path=os.path.join(ROOT, f"preview-{mode}.png"))

    check("no console/page errors (desktop)", not errors, "; ".join(errors[:5]))
    check("desktop overflow after play", page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"))
    ctx.close()


def run_mobile(browser):
    ctx, page, errors = open_page(browser, {"width": 390, "height": 844}, mobile=True, scale=3)
    page.wait_for_function("window.__SPLASH_DONE__ === true", timeout=6000)
    page.wait_for_timeout(400)

    check("mobile no horizontal overflow", page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"),
          page.evaluate("[document.documentElement.scrollWidth, window.innerWidth]"))
    box = page.eval_on_selector(".bet-panel", "e=>{const r=e.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom), window.innerHeight]}")
    check("mobile bet panel in viewport", box[0] >= 0 and box[1] <= box[2] + 1, str(box))
    check("mobile splash gone", page.eval_on_selector_all("#splash", "e=>e.length") == 0)

    small = page.evaluate("""() => {
      const bad = [];
      document.querySelectorAll('.chip, .op-btn, .btn, .deal-btn, .mode-btn, .bp-refill, .account-btn').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width && r.height && r.height < 26) bad.push(el.className + ' ' + Math.round(r.height));
      });
      return bad;
    }""")
    check("mobile touch targets", not small, str(small[:4]))

    # 3 modes on mobile
    for mode in ["speed", "sakura", "snow"]:
        page.click(f'.mode-btn[data-mode="{mode}"]')
        page.wait_for_timeout(220)
        check(f"mobile mode {mode}", page.evaluate("document.body.dataset.mode") == mode)

    # deal + screenshot
    page.click('#chipRow .chip[data-chip="10000"]')
    page.click('[data-spot="banker"]')
    bal_before = page.evaluate("window.__bac.state.balance")
    page.click("#dealBtn")
    page.wait_for_function("window.__bac.state.phase === 'betting'", timeout=25000)
    page.wait_for_timeout(400)
    mob = page.evaluate("""() => { const s = window.__bac.state;
        const r = BaccaratEngine.settleRound({bets: s.lastBets, result: s.hand, mode: s.mode, noCommission: s.settings.noCommission, bonus: s.bonus});
        return {balance: s.balance, returned: r.returned, hist: s.history.length, bonus: s.bonus.length}; }""")
    check("mobile balance math", mob["balance"] == bal_before + mob["returned"],
          f"{mob['balance']} vs {bal_before + mob['returned']}")
    check("mobile bonus cards", 1 <= mob["bonus"] <= 5, str(mob["bonus"]))
    check("mobile overflow after deal", page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"))
    tclick(page, "#resultClose")
    page.wait_for_timeout(300)
    page.screenshot(path=os.path.join(ROOT, "preview-mobile.png"))

    # mobile sign up + admin reachable
    page.click("#accountBtn")
    page.wait_for_timeout(300)
    page.click('.auth-tabs button[data-auth="signup"]')
    page.wait_for_timeout(150)
    page.fill("#authId", "mobuser")
    page.fill("#authPin", "1357")
    page.fill("#authPin2", "1357")
    page.click("#authSubmit")
    page.wait_for_timeout(800)
    check("mobile signup", page.inner_text("#accName") == "mobuser", page.inner_text("#accName"))
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
