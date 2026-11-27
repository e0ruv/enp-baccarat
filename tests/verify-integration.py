#!/usr/bin/env python3
"""ENP CASINO — 바카라 + 블랙잭 통합 검증.

같은 사이트 안에서
  · 상단 4개 탭(스피드 · 벚꽃 · 눈꽃 · 블랙잭)이 두 페이지에서 똑같이 동작하고
  · 회원가입 · 로그인 · 현재 유저 · 잔액 · 6160 관리자 잔액이 두 페이지에서 완전히 공유되며
  · 한쪽에서 플레이한 손익이 다른 쪽에 그대로 이어지는지
Playwright E2E 로 확인합니다. 데스크톱 1440x900, iPhone 16 Pro 390x844,
가로 844x390, 작은 폰 360x640 에서 콘솔 에러 0 · 오버플로 0 · 탭 겹침 없음도 함께 봅니다.

    LD_LIBRARY_PATH=/workspace/.libs/usr/lib/x86_64-linux-gnu python3 tests/verify-integration.py
"""
import functools
import http.server
import os
import socketserver
import threading

from playwright.sync_api import sync_playwright

ROOT = os.environ.get("ENP_SITE", "/workspace/baccarat-sim")
PORT = 8197
BIN = "/workspace/.pw-browsers/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell"
BASE = f"http://127.0.0.1:{PORT}"
BAC = BASE + "/index.html"
BJ = BASE + "/blackjack/index.html"
DB_KEY = "enp_baccarat_accounts_v1"

results = []
failures = []


def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    if not cond:
        failures.append(f"{name} — {detail}")
    print(("PASS " if cond else "FAIL ") + name + (f"  ({detail})" if detail else ""))


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def serve():
    handler = functools.partial(Quiet, directory=ROOT)

    class Q(socketserver.TCPServer):
        allow_reuse_address = True

    srv = Q(("127.0.0.1", PORT), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def open_page(browser, viewport, mobile=False):
    ctx = browser.new_context(viewport=viewport, device_scale_factor=2,
                              is_mobile=mobile, has_touch=mobile)
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append("PAGEERROR " + str(e)))
    page.on("console", lambda m: errors.append("CONSOLE " + m.text) if m.type == "error" else None)
    page.on("response", lambda r: errors.append(f"HTTP {r.status} {r.url}") if r.status >= 400 else None)
    return ctx, page, errors


def ready(page, url):
    page.goto(url, wait_until="load")
    page.wait_for_function("window.__APP_READY__ === true", timeout=20000)


def bac_ready(page):
    ready(page, BAC)
    page.evaluate("() => { const s = document.getElementById('splash'); if (s) s.remove(); }")
    page.wait_for_function("window.__bac.state.phase === 'betting'", timeout=20000)


def bj_ready(page):
    ready(page, BJ)
    page.evaluate("() => { const s = document.getElementById('splash'); if (s) s.remove(); }")
    page.evaluate("() => window.__bc.fast(true)")
    page.wait_for_function("window.__bc.state.phase === 'betting'", timeout=20000)


def nav_info(page):
    return page.evaluate("""() => {
      const nav = document.getElementById('modeSwitch');
      const btns = [...nav.querySelectorAll('.mode-btn')];
      const boxes = btns.map(b => { const r = b.getBoundingClientRect(); return {
        t: b.textContent.trim(), l: r.left, r: r.right, w: r.width, h: r.height,
        active: b.classList.contains('is-active'),
        href: b.getAttribute('href') || ''
      }; });
      const bar = document.querySelector('.topbar').getBoundingClientRect();
      const right = document.querySelector('.topbar-right, .tb-right').getBoundingClientRect();
      const left = document.querySelector('.topbar-left, .tb-left').getBoundingClientRect();
      return {
        n: btns.length, boxes, bar: [bar.left, bar.right, bar.height],
        navBox: (() => { const r = nav.getBoundingClientRect(); return [r.left, r.right, r.top, r.bottom]; })(),
        rightLeft: right.left, leftRight: left.right,
        insideBar: btns.every(b => { const r = b.getBoundingClientRect();
          return r.left >= bar.left - .5 && r.right <= bar.right + .5; }),
        overlap: boxes.some((a, i) => boxes.some((c, j) => j > i && a.r > c.l + .5)),
        aboveControls: (() => { const r = nav.getBoundingClientRect(); return r.right <= right.left + .5; })()
      };
    }""")


def layout_checks(browser, tag, viewport, mobile):
    for name, url, loader in [("baccarat", BAC, bac_ready), ("blackjack", BJ, bj_ready)]:
        ctx, page, errors = open_page(browser, viewport, mobile)
        loader(page)
        page.wait_for_timeout(500)
        dims = page.evaluate("() => ({sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, iw: innerWidth, ih: innerHeight})")
        check(f"{tag} {name}: no horizontal overflow", dims["sw"] <= dims["iw"], str(dims))
        check(f"{tag} {name}: no vertical overflow", dims["sh"] <= dims["ih"], str(dims))
        nav = nav_info(page)
        check(f"{tag} {name}: 4 table tabs", nav["n"] == 4, str([b["t"] for b in nav["boxes"]]))
        check(f"{tag} {name}: tabs never overlap", not nav["overlap"], str(nav["boxes"]))
        check(f"{tag} {name}: tabs stay inside the top bar", nav["insideBar"] and nav["navBox"][1] <= nav["rightLeft"] + .5,
              f"nav={nav['navBox']} right={nav['rightLeft']}")
        check(f"{tag} {name}: tab touch height",
              all(b["h"] >= 24 for b in nav["boxes"]), str([round(b["h"]) for b in nav["boxes"]]))
        labels = [b["t"] for b in nav["boxes"]]
        check(f"{tag} {name}: spade tab is the blackjack table",
              any("♠" in t for t in labels), str(labels))
        check(f"{tag} {name}: exactly one active tab",
              sum(1 for b in nav["boxes"] if b["active"]) == 1,
              str([(b["t"], b["active"]) for b in nav["boxes"]]))
        if name == "baccarat":
            check(f"{tag} baccarat: active tab is the table in play",
                  page.eval_on_selector(".mode-btn.is-active[data-mode]", "e=>e.dataset.mode") == page.evaluate("document.body.dataset.mode"))
        else:
            check(f"{tag} blackjack: blackjack tab is active",
                  any("♠" in b["t"] and b["active"] for b in nav["boxes"]),
                  str([(b["t"], b["active"]) for b in nav["boxes"]]))
        check(f"{tag} {name}: no console errors", not errors, " | ".join(errors[:4]))
        if tag == "desktop" and name == "baccarat":
            page.wait_for_timeout(1200)
            page.screenshot(path=os.path.join(ROOT, "preview-integrated-baccarat.png"))
        if tag == "desktop" and name == "blackjack":
            page.wait_for_timeout(600)
            page.screenshot(path=os.path.join(ROOT, "preview-integrated-blackjack.png"))
        ctx.close()


def signup_baccarat(page, uid, nick, pin="2468"):
    page.click("#accountBtn")
    page.wait_for_timeout(220)
    page.click('.auth-tabs button[data-auth="signup"]')
    page.wait_for_timeout(120)
    page.fill("#authId", uid)
    page.fill("#authNick", nick)
    page.fill("#authPin", pin)
    page.fill("#authPin2", pin)
    page.click("#authSubmit")
    page.wait_for_timeout(900)


def open_admin(page):
    page.dblclick("#brand")
    page.wait_for_timeout(240)
    for k in "6160":
        page.click(f'#keypad button[data-key="{k}"]')
        page.wait_for_timeout(60)
    page.wait_for_timeout(450)


def shared_flow(browser):
    ctx, page, errors = open_page(browser, {"width": 1440, "height": 900})
    bac_ready(page)

    # 1) 바카라에서 가입 → 블랙잭에 같은 유저 · 같은 잔액
    signup_baccarat(page, "shareduser", "공유유저")
    check("signup on baccarat shows the member", page.inner_text("#accName") == "공유유저",
          page.inner_text("#accName"))
    # 관리자(6160)로 잔액을 바꾸고, 그 값이 블랙잭까지 따라가는지 봅니다
    open_admin(page)
    page.fill("#admAmount", "777000")
    page.click('.adm-user[data-uid="shareduser"] button[data-op="plus"]')
    page.wait_for_timeout(250)
    page.click("#adminClose")
    page.wait_for_timeout(200)
    bac_bal = page.evaluate("window.__bac.state.balance")
    check("admin on baccarat adds to the member", bac_bal == 1000000000 + 777000, str(bac_bal))

    page.click("#navBlackjack")
    page.wait_for_url("**/blackjack/", timeout=10000)
    page.wait_for_function("window.__APP_READY__ === true", timeout=20000)
    page.evaluate("() => { const s = document.getElementById('splash'); if (s) s.remove(); }")
    page.wait_for_timeout(300)
    check("blackjack shows the same member", page.inner_text("#nickName") == "공유유저",
          page.inner_text("#nickName"))
    check("blackjack shows the same balance", page.evaluate("window.__bc.state.balance") == bac_bal,
          f"{page.evaluate('window.__bc.state.balance')} vs {bac_bal}")

    # 2) 블랙잭에서 한 판 (블랙잭 3:2) → 바카라 잔액에 그대로
    page.evaluate("window.__bc.setChip(10000); window.__bc.placeBet('main');")
    page.evaluate("window.__bc.rig(['As','9h','Kh','5c'])")
    page.evaluate("window.__bc.deal()")
    page.wait_for_function("window.__bc.state.phase === 'settle' || window.__bc.state.phase === 'betting'", timeout=15000)
    page.wait_for_timeout(400)
    after_bj = page.evaluate("window.__bc.state.balance")
    check("blackjack round pays 3:2 on the shared balance", after_bj == bac_bal + 15000,
          f"{after_bj} vs {bac_bal + 15000}")

    # 3) 블랙잭 관리자(6160) 잔액 조정 → 바카라에 그대로
    page.evaluate("() => window.__bc.reset()")
    page.wait_for_timeout(200)
    bj_start = page.evaluate("window.__bc.state.balance")
    open_admin(page)
    check("blackjack admin lists members", "공유유저" in page.inner_text("#admUsers"),
          page.inner_text("#admUsers")[:80])
    page.fill("#admAmount", "500000")
    page.click('.adm-user[data-uid="shareduser"] button[data-op="plus"]')
    page.wait_for_timeout(250)
    bj_after = page.evaluate("window.__bc.state.balance")
    check("blackjack admin +500,000", bj_after == bj_start + 500000, str(bj_after - bj_start))
    page.click("#adminClose")
    page.wait_for_timeout(200)

    page.click('.mode-btn[href*="mode=sakura"]')
    page.wait_for_url("**/index.html?mode=sakura", timeout=10000)
    page.wait_for_function("window.__APP_READY__ === true", timeout=20000)
    page.evaluate("() => { const s = document.getElementById('splash'); if (s) s.remove(); }")
    page.wait_for_timeout(250)
    check("blackjack admin change lands on baccarat", page.evaluate("window.__bac.state.balance") == bj_after,
          f"{page.evaluate('window.__bac.state.balance')} vs {bj_after}")
    check("baccarat still signed in as the member", page.inner_text("#accName") == "공유유저",
          page.inner_text("#accName"))
    check("mode link opens the requested table", page.evaluate("document.body.dataset.mode") == "sakura")

    # 4) 로그아웃은 두 페이지 모두에 적용, 다시 로그인하면 같은 계정
    page.click("#logoutBtn")
    page.wait_for_timeout(400)
    page.click("#navBlackjack")
    page.wait_for_url("**/blackjack/", timeout=10000)
    page.wait_for_function("window.__APP_READY__ === true", timeout=20000)
    page.evaluate("() => { const s = document.getElementById('splash'); if (s) s.remove(); }")
    page.wait_for_timeout(250)
    check("logout on baccarat reaches blackjack", page.inner_text("#nickName") == "게스트",
          page.inner_text("#nickName"))
    page.click("#userChip")
    page.wait_for_timeout(250)
    page.fill("#authId", "shareduser")
    page.fill("#authPin", "2468")
    page.click("#authSubmit")
    page.wait_for_timeout(800)
    check("login on blackjack restores the member", page.inner_text("#nickName") == "공유유저",
          page.inner_text("#nickName"))
    member_bal = page.evaluate("window.__bc.state.balance")

    page.click('.mode-btn[href*="mode=snow"]')
    page.wait_for_url("**/index.html?mode=snow", timeout=10000)
    page.wait_for_function("window.__APP_READY__ === true", timeout=20000)
    page.evaluate("() => { const s = document.getElementById('splash'); if (s) s.remove(); }")
    page.wait_for_timeout(250)
    check("blackjack login reaches baccarat", page.inner_text("#accName") == "공유유저",
          page.inner_text("#accName"))
    check("member balance follows the login", page.evaluate("window.__bac.state.balance") == member_bal,
          f"{page.evaluate('window.__bac.state.balance')} vs {member_bal}")
    check("mode link opens the snow table", page.evaluate("document.body.dataset.mode") == "snow"
          and page.inner_text("#tableName") == "눈꽃 바카라", page.inner_text("#tableName"))

    # 5) 두 페이지가 같은 저장소 키만 씁니다
    keys = page.evaluate("() => Object.keys(localStorage)")
    check("one shared account key", DB_KEY in keys, str(keys))
    check("no separate blackjack wallet is written", "enp-blackjack-v1" not in keys, str(keys))
    stored = page.evaluate(f"() => JSON.parse(localStorage.getItem('{DB_KEY}'))")
    check("stored member keeps the balance", stored["users"]["shareduser"]["balance"] == member_bal,
          str(stored["users"]["shareduser"]["balance"]))
    check("stored blackjack record is per member",
          isinstance(stored["users"]["shareduser"].get("bj"), dict) and
          "history" in stored["users"]["shareduser"]["bj"])

    check("no console errors during the shared flow", not errors, " | ".join(errors[:5]))
    ctx.close()


def realtime_flow(browser):
    ctx, page, errors = open_page(browser, {"width": 1280, "height": 800})
    bac_ready(page)
    second = ctx.new_page()
    second_errors = []
    second.on("pageerror", lambda e: second_errors.append(str(e)))
    second.on("console", lambda m: second_errors.append(m.text) if m.type == "error" else None)
    second.goto(BJ, wait_until="load")
    second.wait_for_function("window.__APP_READY__ === true", timeout=20000)
    second.evaluate("() => { const s = document.getElementById('splash'); if (s) s.remove(); }")
    second.wait_for_timeout(300)

    before = page.evaluate("window.__bac.state.balance")
    # 블랙잭 탭에서 충전(+₩10억) → 바카라 탭이 새로고침 없이 따라오는지
    second.click("#refillBtn")
    page.wait_for_timeout(800)
    check("a refill in the blackjack tab reaches the open baccarat tab",
          page.evaluate("window.__bac.state.balance") == before + 1000000000,
          f"{page.evaluate('window.__bac.state.balance')} vs {before + 1000000000}")
    check("baccarat header balance redrawn", page.inner_text("#balance").strip() != "",
          page.inner_text("#balance"))
    check("no console errors across the two tabs", not errors and not second_errors,
          " | ".join((errors + second_errors)[:4]))
    ctx.close()


def guest_flow(browser):
    ctx, page, errors = open_page(browser, {"width": 390, "height": 844}, mobile=True)
    bac_ready(page)
    start = page.evaluate("window.__bac.state.balance")
    page.click("#refillBtn")
    page.wait_for_timeout(300)
    guest = page.evaluate("window.__bac.state.balance")
    check("guest refill on baccarat", guest == start + 1000000000, str(guest - start))
    page.click("#navBlackjack")
    page.wait_for_url("**/blackjack/", timeout=10000)
    page.wait_for_function("window.__APP_READY__ === true", timeout=20000)
    page.evaluate("() => { const s = document.getElementById('splash'); if (s) s.remove(); }")
    page.wait_for_timeout(300)
    check("guest balance is shared", page.evaluate("window.__bc.state.balance") == guest,
          f"{page.evaluate('window.__bc.state.balance')} vs {guest}")
    check("guest sees the account entry point", page.inner_text("#nickName") == "게스트",
          page.inner_text("#nickName"))
    page.screenshot(path=os.path.join(ROOT, "preview-integrated-blackjack-mobile.png"))
    check("mobile blackjack has no overflow",
          page.evaluate("document.documentElement.scrollWidth <= innerWidth"))
    check("no console errors on the guest flow", not errors, " | ".join(errors[:4]))
    ctx.close()


def leave_flow(browser):
    """테이블을 옮길 때 아직 정산되지 않은 베팅이 사라지지 않는지."""
    ctx, page, errors = open_page(browser, {"width": 1280, "height": 800})
    bac_ready(page)
    start = page.evaluate("window.__bac.state.balance")
    page.click('#chipRow .chip[data-chip="50000"]')
    page.click('[data-spot="player"]')
    page.wait_for_timeout(150)
    check("baccarat: a pending bet is debited", page.evaluate("window.__bac.state.balance") == start - 50000,
          str(page.evaluate("window.__bac.state.balance")))
    page.click("#navBlackjack")
    page.wait_for_url("**/blackjack/", timeout=10000)
    page.wait_for_function("window.__APP_READY__ === true", timeout=20000)
    page.evaluate("() => { const s = document.getElementById('splash'); if (s) s.remove(); }")
    page.wait_for_timeout(400)
    check("baccarat: leaving a table returns the pending bet",
          page.evaluate("window.__bc.state.balance") == start,
          f"{page.evaluate('window.__bc.state.balance')} vs {start}")

    page.evaluate("window.__bc.setChip(10000); window.__bc.placeBet('main'); window.__bc.setChip(5000); window.__bc.placeBet('anyPair')")
    page.wait_for_timeout(150)
    mid = page.evaluate("window.__bc.state.balance")
    check("blackjack: pending bets are debited", mid == start - 15000, str(mid))
    page.click('.mode-btn[href*="mode=speed"]')
    page.wait_for_url("**/index.html?mode=speed", timeout=10000)
    page.wait_for_function("window.__APP_READY__ === true", timeout=20000)
    page.evaluate("() => { const s = document.getElementById('splash'); if (s) s.remove(); }")
    page.wait_for_timeout(400)
    check("blackjack: leaving returns the pending bets",
          page.evaluate("window.__bac.state.balance") == start,
          f"{page.evaluate('window.__bac.state.balance')} vs {start}")
    check("speed table opened from the link", page.evaluate("document.body.dataset.mode") == "speed")
    check("no console errors while changing tables", not errors, " | ".join(errors[:4]))
    ctx.close()


def capture_previews(browser):
    """두 테이블의 최신 화면을 한 판 진행한 상태로 남깁니다."""
    ctx, page, errors = open_page(browser, {"width": 1440, "height": 900})
    bac_ready(page)
    page.click('#chipRow .chip[data-chip="50000"]')
    page.click('[data-spot="banker"]')
    page.click("#dealBtn")
    try:
        page.wait_for_function("document.querySelectorAll('#playerCards .card, #bankerCards .card').length >= 4", timeout=15000)
        page.wait_for_timeout(450)
        page.screenshot(path=os.path.join(ROOT, "preview-integrated-baccarat.png"))
    except Exception:
        page.screenshot(path=os.path.join(ROOT, "preview-integrated-baccarat.png"))
    page.wait_for_function("window.__bac.state.phase === 'betting'", timeout=25000)

    page.goto(BJ, wait_until="load")
    page.wait_for_function("window.__APP_READY__ === true", timeout=20000)
    page.evaluate("() => { const s = document.getElementById('splash'); if (s) s.remove(); }")
    page.evaluate("() => { const b = window.__bc; b.fast(false); b.setChip(50000); b.placeBet('main'); b.rig(['As','9h','Kh','5c']); b.deal(); }")
    page.wait_for_function("window.__bc.state.phase === 'settle'", timeout=15000)
    page.wait_for_timeout(600)
    page.screenshot(path=os.path.join(ROOT, "preview-integrated-blackjack.png"))
    ctx.close()


def main():
    srv = serve()
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=BIN, args=["--no-sandbox"])
        layout_checks(browser, "desktop", {"width": 1440, "height": 900}, False)
        layout_checks(browser, "iphone16pro", {"width": 390, "height": 844}, True)
        layout_checks(browser, "landscape", {"width": 844, "height": 390}, True)
        layout_checks(browser, "small", {"width": 360, "height": 640}, True)
        shared_flow(browser)
        realtime_flow(browser)
        guest_flow(browser)
        leave_flow(browser)
        capture_previews(browser)
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
