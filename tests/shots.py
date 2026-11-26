#!/usr/bin/env python3
"""ENP BACCARAT — preview captures.

영상(work/rec_1843, IMG_1308/1309/1311)과 나란히 비교할 스크린샷을 만듭니다.

    LD_LIBRARY_PATH=/workspace/.libs/usr/lib/x86_64-linux-gnu python3 tests/shots.py

만드는 파일 (저장소 루트):
  preview-mobile.png       모바일 390×844 전체 화면 (출목표가 채워진 상태)
  preview-celebration.png  모바일 당첨 연출 (리본 · 이겼습니다 · 금빛 금액)
  preview-road.png         출목표 확대
"""
import functools
import http.server
import os
import socketserver
import threading

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8173
BIN = "/workspace/.pw-browsers/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell"
URL = f"http://127.0.0.1:{PORT}/index.html"

SEQ = ['player', 'banker', 'banker', 'player', 'tie', 'player', 'banker', 'player', 'player', 'player',
       'banker', 'banker', 'tie', 'banker', 'player', 'banker', 'player', 'banker', 'banker', 'player',
       'player', 'banker', 'player', 'banker', 'banker', 'banker', 'player', 'tie', 'player', 'banker',
       'player', 'banker', 'banker', 'player', 'player', 'banker', 'player', 'banker']


def serve():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def seed(page):
    page.evaluate("""(seq) => {
      const s = window.__bac.state;
      s.history = seq.map((w, i) => ({winner: w, p: 7, b: 5,
        pp: i % 9 === 0, bp: i % 11 === 0, mult: 1, ts: Date.now() + i}));
      s.stats.hands = seq.length;
      s.stats.player = seq.filter(x => x === 'player').length;
      s.stats.banker = seq.filter(x => x === 'banker').length;
      s.stats.tie = seq.filter(x => x === 'tie').length;
      window.__bac.renderAll();
    }""", SEQ)


def main():
    httpd = serve()
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=BIN, args=["--no-sandbox"])
        ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=3,
                            is_mobile=True, has_touch=True)
        page = ctx.new_page()
        page.goto(URL, wait_until="load")
        page.wait_for_function("window.__APP_READY__ === true", timeout=25000)
        page.wait_for_timeout(4600)
        page.evaluate("() => { const s = document.getElementById('splash'); if (s) s.remove(); }")
        page.wait_for_function("window.__bac.state.phase === 'betting'", timeout=20000)
        seed(page)
        page.wait_for_timeout(350)
        page.evaluate("() => window.__bac.setPreview(null)")
        page.screenshot(path=os.path.join(ROOT, "preview-mobile.png"), animations="disabled")
        page.locator(".roadboard").screenshot(path=os.path.join(ROOT, "preview-road.png"))

        # 당첨 연출 — 실제 딜로 뱅커 50,000 베팅 → ₩97,500 지급 장면이 나올 때까지
        page.evaluate("() => window.__bac.setMode('speed')")
        page.wait_for_timeout(500)
        seed(page)
        page.wait_for_timeout(300)
        captured = False
        for attempt in range(14):
            page.wait_for_function("window.__bac.state.phase === 'betting'", timeout=25000)
            page.evaluate("() => window.__bac.placeBet('banker', 50000)")
            page.evaluate("() => window.__bac.deal({auto: true})")
            page.wait_for_function("window.__bac.state.phase === 'result'", timeout=25000)
            page.wait_for_timeout(420)
            ok = page.evaluate("""() => {
              const c = document.getElementById('winCelebrate');
              return c.classList.contains('on') && document.getElementById('wcSide').textContent.trim() === '뱅커'
                     && document.getElementById('wcAmount').textContent.replace(/,/g, '') === '97500';
            }""")
            print("attempt", attempt, page.evaluate("""() => {
              const s = window.__bac.state;
              const c = document.getElementById('winCelebrate');
              return {phase: s.phase, winner: s.hand && s.hand.winner,
                      on: c.classList.contains('on'),
                      side: document.getElementById('wcSide').textContent.trim(),
                      amt: document.getElementById('wcAmount').textContent,
                      last: s.lastBets};
            }"""))
            if ok:
                captured = True
                page.wait_for_timeout(120)
                page.screenshot(path=os.path.join(ROOT, "preview-celebration.png"), animations="disabled")
                page.locator(".dealer-view").screenshot(
                    path=os.path.join(ROOT, "preview-celebration-table.png"), animations="disabled")
                break
            page.wait_for_timeout(200)
        print("celebration captured:", captured)
        b.close()
    httpd.shutdown()
    print("saved preview-mobile.png / preview-road.png / preview-celebration.png")


main()
