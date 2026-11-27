/* ══════════════════════════════════════════════════════════════
   그림장 분석기 — app
   입력 · 그림장 렌더(빅로드 / 1·2·3군 / 비드로드) · 분석 패널 · 세션 저장
   ══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const E = window.BaccaratEngine;
  const A = window.BaccaratAnalyzer;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const STORE = 'enp.baccarat-analyzer.v1';
  const isValidWin = (w) => w === 'player' || w === 'banker' || w === 'tie';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ─────────────── state ─────────────── */
  const freshShoe = (no) => ({ no: no || 1, startedAt: Date.now(), hist: [] });

  const S = { shoe: freshShoe(1), archive: [], nextNo: 2 };
  let previewSide = null;
  let previewTimer = 0;
  let railRO = null;

  function load() {
    let raw = null;
    try { raw = localStorage.getItem(STORE); } catch (e) { return; }
    if (!raw) return;
    try {
      const o = JSON.parse(raw);
      if (!o || typeof o !== 'object') return;
      const shoe = o.shoe;
      if (shoe && Array.isArray(shoe.hist)) {
        S.shoe = {
          no: Number(shoe.no) || 1,
          startedAt: Number(shoe.startedAt) || Date.now(),
          hist: shoe.hist.filter((h) => h && isValidWin(h.winner))
            .map((h) => ({ winner: h.winner, ts: Number(h.ts) || undefined }))
        };
      }
      if (Array.isArray(o.archive)) {
        S.archive = o.archive.filter((a) => a && Array.isArray(a.hist))
          .map((a) => ({
            no: Number(a.no) || 1,
            startedAt: Number(a.startedAt) || Date.now(),
            endedAt: Number(a.endedAt) || Date.now(),
            hist: a.hist.filter((h) => h && isValidWin(h.winner)).map((h) => ({ winner: h.winner }))
          }));
      }
      S.nextNo = Math.max(Number(o.nextNo) || 2, S.shoe.no + 1, ...S.archive.map((a) => a.no + 1));
    } catch (e) { /* corrupted store → start clean */ }
  }

  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(STORE, JSON.stringify({
          v: 1, shoe: S.shoe, archive: S.archive.slice(-40), nextNo: S.nextNo
        }));
      } catch (e) { /* storage full / blocked — app keeps working */ }
    }, 90);
  }

  /* ─────────────── dom refs ─────────────── */
  const el = {
    shoeNo: $('#shoeNo'),
    handCount: $('#handCount'),
    cP: $('#cP'), cB: $('#cB'), cT: $('#cT'),
    bigroad: $('#bigroad'),
    roadEye: $('#roadEye'), roadSmall: $('#roadSmall'), roadCock: $('#roadCock'),
    bead: $('#bead'),
    recCard: $('#recCard'), recBadge: $('#recBadge'), recSide: $('#recSide'),
    recConf: $('#recConf'), recWhy: $('#recWhy'),
    barP: $('#barP'), barB: $('#barB'), barPv: $('#barPv'), barBv: $('#barBv'),
    agCells: $$('.ag-cell'), agBtns: $$('[data-pv]'), agFoot: $('#agFoot'),
    recentStrip: $('#recentStrip'),
    patChips: $('#patChips'), patNow: $('#patNow'),
    s10: $('#s10'), s20: $('#s20'), sRun: $('#sRun'), sBest: $('#sBest'),
    s10p: $('#s10p'), s10b: $('#s10b'), s20p: $('#s20p'), s20b: $('#s20b'),
    sumCard: $('#sumCard'), sumHint: $('#sumHint'), sumHands: $('#sumHands'), sumPB: $('#sumPB'),
    sumT: $('#sumT'), sumAvg: $('#sumAvg'), sumPat: $('#sumPat'), sumBest: $('#sumBest'),
    sumBarP: $('#sumBarP'), sumBarB: $('#sumBarB'), sumBarT: $('#sumBarT'),
    btnUndo: $('#btnUndo'), btnReset: $('#btnReset'),
    btnHistory: $('#btnHistory'),
    veil: $('#veil'),
    sheetReset: $('#sheetReset'), sheetHistory: $('#sheetHistory'),
    confirmReset: $('#confirmReset'), resetSub: $('#resetSub'),
    histList: $('#histList'), btnClearAll: $('#btnClearAll'),
    toast: $('#toast')
  };

  /* ─────────────── toast ─────────────── */
  let toastTimer = 0;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => el.toast.classList.remove('is-on'), 1900);
  }

  /* ─────────────── input ─────────────── */
  function add(winner) {
    S.shoe.hist.push({ winner, ts: Date.now() });
    clearPreview(false);
    bustHit(winner);
    render();
  }

  function undo() {
    if (!S.shoe.hist.length) { toast('되돌릴 판이 없습니다'); return; }
    const gone = S.shoe.hist.pop();
    clearPreview(false);
    render();
    toast(`${gone.winner === 'player' ? 'P' : gone.winner === 'banker' ? 'B' : 'T'} 한 판을 되돌렸습니다`);
  }

  /* 탭 피드백 — offsetWidth 강제 리플로우 없이 Web Animations 로만 (1탭 지연 없음) */
  function bustHit(winner) {
    const btn = document.querySelector(`.key[data-add="${winner}"]`);
    if (!btn || typeof btn.animate !== 'function') return;
    try {
      btn.animate(
        [{ boxShadow: '0 0 0 0 rgba(255,255,255,.5)' }, { boxShadow: '0 0 0 15px rgba(255,255,255,0)' }],
        { duration: 320, easing: 'ease-out' }
      );
      btn.animate([{ transform: 'scale(.985)' }, { transform: 'scale(1)' }], { duration: 150, easing: 'ease-out' });
    } catch (e) { /* no-op */ }
  }

  /* ─────────────── preview (다음 판 P/B 가정) ─────────────── */
  function setPreview(side) {
    previewSide = previewSide === side ? null : side;
    clearTimeout(previewTimer);
    previewTimer = 0;
    if (previewSide) {
      previewTimer = window.setTimeout(() => { previewSide = null; previewTimer = 0; render(); }, 6000);
    }
    render();
    if (previewSide) toast(previewSide === 'player' ? '다음 판 P 가정 · 깜빡이는 칸 미리보기' : '다음 판 B 가정 · 깜빡이는 칸 미리보기');
  }

  function clearPreview(rerender) {
    if (!previewSide) return;
    previewSide = null;
    clearTimeout(previewTimer);
    previewTimer = 0;
    if (rerender !== false) render();
  }

  /* ─────────────── big-road cells ─────────────── */
  function bigCells(hist) {
    const out = [];
    let last = null;
    for (const h of hist) {
      if (!h) continue;
      if (h.winner === 'tie') { if (last) last.ties = (last.ties || 0) + 1; continue; }
      if (h.winner !== 'player' && h.winner !== 'banker') continue;
      let pos;
      if (!last) pos = { c: 0, r: 0 };
      else if (h.winner === last.w) pos = last.r < 5 ? { c: last.c, r: last.r + 1 } : { c: last.c + 1, r: last.r };
      else pos = { c: last.c + 1, r: 0 };
      last = { c: pos.c, r: pos.r, w: h.winner, ties: 0 };
      out.push(last);
    }
    return out;
  }

  /* ─────────────── grid painter ─────────────── */
  /* 칸 노드를 한 번만 만들고(열 수가 바뀔 때만 재구성) 이후에는 class/글자만 갈아끼운다.
     렌더 중에 레이아웃을 읽지 않도록 크기는 렌더 시작에 한 번만 잰다 → 1탭 ~수 ms */
  const gridState = new WeakMap();

  function paintGrid(box, rows, marks, opts, size) {
    if (!box || !size || !size.w || !size.h) return;
    const gap = 1;
    const cellH = Math.max(4, (size.h - (rows - 1) * gap) / rows);
    const cols = clamp(Math.floor((size.w + gap) / (cellH + gap)), opts.minCols || 4, opts.maxCols || 48);

    let st = gridState.get(box);
    if (!st || st.rows !== rows || st.cols !== cols) {
      box.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
      box.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
      const frag = document.createDocumentFragment();
      const cells = new Array(rows * cols);
      for (let i = 0; i < rows * cols; i++) {
        cells[i] = opts.blank();
        frag.appendChild(cells[i]);
      }
      box.replaceChildren(frag);
      st = { rows, cols, cells, keys: new Array(rows * cols).fill('#') };
      gridState.set(box, st);
    }

    let maxC = 0;
    for (const m of marks) if (m.c > maxC) maxC = m.c;
    const off = Math.max(0, maxC - (cols - 1));
    const put = new Map();
    for (const m of marks) {
      if (m.c < off) continue;
      put.set((m.c - off) + ':' + m.r, m);
    }

    const { cells, keys } = st;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const m = put.get(c + ':' + r);
        const k = opts.key(m);
        if (keys[i] === k) continue;
        keys[i] = k;
        opts.apply(cells[i], m);
      }
    }
  }

  const readSize = (node) => (node ? { w: node.clientWidth, h: node.clientHeight } : null);

  /* 칸 크기는 레이아웃이 끝난 시점(ResizeObserver)에만 잰다 → 렌더 중 강제 레이아웃 0 */
  const SIZES = { big: null, eye: null, small: null, cock: null, bead: null };
  function measureSizes() {
    SIZES.big = readSize(el.bigroad);
    SIZES.eye = readSize(el.roadEye);
    SIZES.small = readSize(el.roadSmall);
    SIZES.cock = readSize(el.roadCock);
    SIZES.bead = readSize(el.bead);
  }

  /* 빅로드 한 칸: 속 빈 링 + (타이면) 초록 슬래시 */
  function bigBlank() {
    const d = document.createElement('div');
    d.className = 'br-cell';
    const rim = document.createElement('span');
    rim.className = 'rim';
    const slash = document.createElement('span');
    slash.className = 'slash';
    slash.hidden = true;
    d.append(rim, slash);
    return d;
  }
  function bigApply(d, m) {
    d.className = 'br-cell'
      + (m ? (m.w === 'player' ? ' p' : ' b') : '')
      + (m && m.preview ? ' is-preview' : '')
      + (m && m.ties ? ' has-tie' : '');
    if (m && m.ties) {
      const slash = d.lastChild;
      slash.hidden = false;
      slash.style.opacity = String(Math.min(1, 0.8 + m.ties * 0.1));
    } else {
      d.lastChild.hidden = true;
    }
  }
  const bigKey = (m) => (m ? m.w + '|' + (m.ties || 0) + '|' + (m.preview ? 1 : 0) : '');

  /* 1·2·3군 한 칸: 빈 원 / 찬 점 / 빗금 */
  function miniBlank() {
    const d = document.createElement('div');
    d.className = 'mr-cell';
    d.appendChild(document.createElement('i'));
    return d;
  }
  function miniApply(d, m, pv) {
    d.className = 'mr-cell' + (m ? ' ' + m.kind : '') + (m && pv ? ' is-preview' : '');
  }

  /* 비드로드 한 칸: 색 원 + P/B/T */
  function beadBlank() {
    const d = document.createElement('div');
    d.className = 'bead-cell';
    const b = document.createElement('span');
    b.className = 'bch';
    d.appendChild(b);
    return d;
  }
  function beadApply(d, m) {
    const w = m ? m.w : null;
    d.className = 'bead-cell' + (w ? ' ' + (w === 'player' ? 'p' : w === 'banker' ? 'b' : 't') : '')
      + (m && m.preview ? ' is-preview' : '');
    d.firstChild.textContent = w === 'player' ? 'P' : w === 'banker' ? 'B' : w === 'tie' ? 'T' : '';
  }
  const beadKey = (m) => (m ? m.w + (m.preview ? '*' : '') : '');

  function renderRoads() {
    const hist = S.shoe.hist;

    if (!SIZES.big || !SIZES.big.w || !SIZES.big.h) measureSizes();

    /* 빅로드 + 다음 판 미리보기 칸 */
    const cells = bigCells(hist);
    let pv = null;
    if (previewSide) {
      const last = cells[cells.length - 1];
      let pos;
      if (!last) pos = { c: 0, r: 0 };
      else if (previewSide === last.w) pos = last.r < 5 ? { c: last.c, r: last.r + 1 } : { c: last.c + 1, r: last.r };
      else pos = { c: last.c + 1, r: 0 };
      pv = { c: pos.c, r: pos.r, w: previewSide, preview: true };
    }
    paintGrid(el.bigroad, 6, pv ? cells.concat([pv]) : cells,
      { minCols: 9, maxCols: 64, blank: bigBlank, apply: bigApply, key: bigKey }, SIZES.big);

    /* 중국점 1·2·3군 */
    const base = E.derivedRoads(hist);
    const dr = previewSide ? E.derivedRoads(hist.concat([{ winner: previewSide }])) : base;

    const paintMini = (box, key, size) => {
      const marks = dr[key] || [];
      const before = (base[key] || []).length;
      const pvMark = (previewSide && marks.length > before) ? marks[marks.length - 1] : null;
      paintGrid(box, 6, marks, {
        minCols: 5, maxCols: 48,
        blank: miniBlank,
        apply: (d, m) => miniApply(d, m, m === pvMark),
        key: (m) => (m ? m.kind + (m === pvMark ? '*' : '') : '')
      }, size);
    };
    paintMini(el.roadEye, 'eye', SIZES.eye);
    paintMini(el.roadSmall, 'small', SIZES.small);
    paintMini(el.roadCock, 'cock', SIZES.cock);

    /* 비드로드 (6행 · 좌→우 시간순 · 최신 열이 오른쪽 끝) */
    const beadHist = pv ? hist.concat([{ winner: previewSide }]) : hist;
    const beads = [];
    beadHist.forEach((h, i) => {
      if (!h || !h.winner) return;
      beads.push({ c: Math.floor(i / 6), r: i % 6, w: h.winner, preview: !!pv && i === beadHist.length - 1 });
    });
    paintGrid(el.bead, 6, beads, { minCols: 1, maxCols: 14, blank: beadBlank, apply: beadApply, key: beadKey }, SIZES.bead);
  }

  /* ─────────────── header / counts ─────────────── */
  function renderHeader() {
    const hist = S.shoe.hist;
    let p = 0, b = 0, t = 0;
    for (const h of hist) {
      if (h.winner === 'player') p++;
      else if (h.winner === 'banker') b++;
      else if (h.winner === 'tie') t++;
    }
    el.shoeNo.textContent = S.shoe.no;
    el.handCount.textContent = hist.length;
    el.cP.textContent = p;
    el.cB.textContent = b;
    el.cT.textContent = t;
    el.btnUndo.disabled = hist.length === 0;
  }

  /* ─────────────── recommendation ─────────────── */
  function renderRec(rec) {
    const mode = rec.mode;
    el.recCard.dataset.side = mode;
    const badge = mode === 'player' ? 'PLAYER 우세' : mode === 'banker' ? 'BANKER 우세'
      : mode === 'hold' ? '관망 (혼조)' : '입력 대기';
    el.recBadge.textContent = badge;
    el.recBadge.dataset.side = mode;
    el.recSide.textContent = mode === 'player' ? 'PLAYER' : mode === 'banker' ? 'BANKER'
      : mode === 'hold' ? '관망' : '—';
    el.recConf.textContent = mode === 'empty' ? '—' : Math.round(rec.confidence);

    const pPct = Math.round(rec.pPct);
    el.barP.style.width = pPct + '%';
    el.barB.style.width = (100 - pPct) + '%';
    el.barPv.textContent = pPct;
    el.barBv.textContent = 100 - pPct;

    const why = rec.factors.slice(0, 4);
    el.recWhy.replaceChildren();
    if (!why.length) {
      const li = document.createElement('li');
      li.className = 'is-empty';
      li.textContent = S.shoe.hist.length ? '뚜렷한 패턴 근거가 아직 없습니다' : 'P · B · T 를 입력하면 바로 분석됩니다';
      el.recWhy.appendChild(li);
      return;
    }
    for (const f of why) {
      const li = document.createElement('li');
      li.className = f.side === 'player' ? 'p' : 'b';
      const bar = document.createElement('i');
      const txt = document.createElement('span');
      txt.textContent = f.label;
      const dir = document.createElement('em');
      dir.textContent = (f.side === 'player' ? 'P' : 'B') + ' ↑';
      li.append(bar, txt, dir);
      el.recWhy.appendChild(li);
    }
  }

  /* ─────────────── 1·2·3군 일치도 ─────────────── */
  function renderAgree(ag) {
    const order = ['eye', 'small', 'cock'];
    // 양쪽이 동시에 일치하면 거울상(유지/꺾임)일 뿐이라 하이라이트하지 않는다
    const mirror = ag.player.uniform && ag.banker.uniform;
    el.agCells.forEach((cell) => {
      const side = cell.dataset.col === 'p' ? 'player' : 'banker';
      const i = Number(cell.dataset.row);
      const a = ag[side];
      const row = a.rows[i];
      cell.className = 'ag-cell ' + (side === 'player' ? 'p' : 'b');
      cell.replaceChildren();
      if (row.kind) {
        const dot = document.createElement('span');
        dot.className = 'dot ' + row.kind;
        const lab = document.createElement('span');
        lab.className = 'na';
        lab.textContent = row.kind === 'r' ? '빨강' : '파랑';
        cell.append(dot, lab);
      } else {
        const na = document.createElement('span');
        na.className = 'na';
        na.textContent = '–';
        cell.appendChild(na);
      }
      if (a.uniform && !mirror && row.kind) cell.classList.add('is-hot');
      if (previewSide === side) cell.classList.add('is-pv');
    });

    el.agBtns.forEach((btn) => {
      const on = previewSide === btn.dataset.pv;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    const hot = mirror ? [] : ['player', 'banker'].filter((s) => ag[s].uniform);
    el.agFoot.classList.toggle('is-hot', hot.length > 0);
    if (mirror) {
      el.agFoot.textContent = 'P·B 양쪽 일치 — 판단 보류 (P = 흐름 유지 · B = 꺾임)';
      el.agFoot.classList.remove('is-hot');
    } else if (hot.length === 1) {
      const side = hot[0];
      const a = ag[side];
      const flow = a.kind === 'r' ? '흐름 유지' : '꺾임';
      el.agFoot.textContent = `${side === 'player' ? 'P' : 'B'} 가정 ${a.count}군 올${a.kind === 'r' ? '빨강' : '파랑'} · ${flow}`;
    } else if (ag.player.count || ag.banker.count) {
      el.agFoot.textContent = '1·2·3군 색이 갈립니다 (혼조)';
      el.agFoot.classList.remove('is-hot');
    } else {
      el.agFoot.textContent = '그림장이 더 쌓이면 1·2·3군이 표시됩니다';
      el.agFoot.classList.remove('is-hot');
    }
    return order.length;
  }

  /* ─────────────── patterns ─────────────── */
  function renderPatterns(det) {
    const hist = S.shoe.hist;
    el.patChips.replaceChildren();
    if (!hist.filter((h) => h.winner === 'player' || h.winner === 'banker').length) {
      const chip = document.createElement('span');
      chip.className = 'chip is-empty';
      chip.textContent = 'P/B를 입력하면 패턴을 감지합니다';
      el.patChips.appendChild(chip);
    } else {
      for (const t of det.tags) {
        const chip = document.createElement('span');
        chip.className = 'chip' + (t.active ? ' on' + (t.side ? ' ' + (t.side === 'player' ? 'p' : 'b') : '') : '');
        chip.textContent = t.active ? t.label : t.short;
        chip.title = t.label;
        el.patChips.appendChild(chip);
      }
    }

    el.patNow.textContent = det.lead
      ? det.lead.label
      : (hist.length ? '특이 패턴 없음' : '—');

    if (el.recentStrip) {
      el.recentStrip.replaceChildren();
      const seq = hist.slice(-12);
      seq.forEach((h, i) => {
        const s = document.createElement('span');
        s.className = h.winner === 'player' ? 'p' : h.winner === 'banker' ? 'b' : 't';
        s.textContent = h.winner === 'player' ? 'P' : h.winner === 'banker' ? 'B' : 'T';
        if (i === seq.length - 1) s.classList.add('is-now');
        el.recentStrip.appendChild(s);
      });
    }

    const w10 = A.windowStats(hist, 10);
    const w20 = A.windowStats(hist, 20);
    const fmt = (w) => (w.n ? `P ${w.p} : B ${w.b}${w.t ? ` · T ${w.t}` : ''}` : '—');
    el.s10.textContent = fmt(w10);
    el.s20.textContent = fmt(w20);
    el.s10p.style.width = w10.pPct + '%';
    el.s10b.style.width = (100 - w10.pPct) + '%';
    el.s20p.style.width = w20.pPct + '%';
    el.s20b.style.width = (100 - w20.pPct) + '%';

    const KO = { player: 'P', banker: 'B' };
    el.sRun.textContent = det.streak.len ? `${KO[det.streak.side]} ${det.streak.len}연` : '—';
    const best = det.runs.reduce((m, r) => Math.max(m, r.n), 0);
    el.sBest.textContent = best ? `${best}연` : '—';
  }

  /* ─────────────── 슈 요약 ─────────────── */
  function renderSummary(hist) {
    if (!el.sumCard) return;
    const sm = A.summary(hist);
    const total = hist.length;
    el.sumHands.textContent = total;
    const pDec = hist.filter((h) => h.winner === 'player').length;
    const bDec = hist.filter((h) => h.winner === 'banker').length;
    el.sumPB.textContent = sm.dec ? `P ${Math.round((pDec / sm.dec) * 100)}% : B ${Math.round((bDec / sm.dec) * 100)}%` : '—';
    el.sumT.textContent = sm.ties ? `${sm.ties}판` : '—';
    el.sumAvg.textContent = sm.groups ? sm.avg.toFixed(1) + '연' : '—';
    el.sumBest.textContent = sm.best ? `${sm.best}연` : '—';
    el.sumPat.textContent = sm.groups ? `${sm.pingpong} / ${sm.twotwo} / ${sm.onetwo}` : '—';
    el.sumHint.textContent = total ? `${sm.groups}개 장줄` : '기록 없음';
    const tP = total ? (pDec / total) * 100 : 0;
    const tB = total ? (bDec / total) * 100 : 0;
    const tT = total ? (sm.ties / total) * 100 : 0;
    el.sumBarP.style.width = tP + '%';
    el.sumBarB.style.width = tB + '%';
    el.sumBarT.style.width = tT + '%';
  }

  /* ─────────────── render ─────────────── */
  function render() {
    const hist = S.shoe.hist;
    renderHeader();
    renderRoads();
    const ag = A.agreements(hist);
    const rec = A.recommend(hist, ag);
    renderRec(rec);
    renderAgree(ag);
    renderPatterns(A.detect(hist));
    renderSummary(hist);
    save();
  }

  let rafId = 0;
  function renderRoadsSoon() {
    if (rafId) return;
    rafId = window.requestAnimationFrame(() => { rafId = 0; renderRoads(); });
  }

  /* ─────────────── sheets ─────────────── */
  let openSheet = null;

  function showSheet(sheet) {
    openSheet = sheet;
    el.veil.hidden = false;
    sheet.hidden = false;
    requestAnimationFrame(() => {
      el.veil.classList.add('is-on');
      sheet.classList.add('is-on');
    });
  }

  function hideSheets() {
    const sheet = openSheet;
    openSheet = null;
    el.veil.classList.remove('is-on');
    if (sheet) {
      sheet.classList.remove('is-on');
      window.setTimeout(() => { if (openSheet !== sheet) sheet.hidden = true; }, 280);
    }
    window.setTimeout(() => { if (!openSheet) el.veil.hidden = true; }, 240);
  }

  function openReset() {
    const n = S.shoe.hist.length;
    el.resetSub.textContent = n
      ? `현재 ${n}판 기록은 세션 기록에 저장되고, 새 슈가 시작됩니다.`
      : '아직 기록이 없습니다. 바로 새 슈를 시작합니다.';
    showSheet(el.sheetReset);
  }

  function doReset() {
    if (S.shoe.hist.length) {
      S.archive.push({
        no: S.shoe.no,
        startedAt: S.shoe.startedAt,
        endedAt: Date.now(),
        hist: S.shoe.hist.slice()
      });
    }
    S.shoe = freshShoe(S.nextNo);
    S.nextNo += 1;
    previewSide = null;
    hideSheets();
    render();
    toast(`#${S.shoe.no} 슈 시작`);
  }

  /* ─────────────── history ─────────────── */
  function fingerHistory(hist) {
    const out = document.createElement('div');
    out.className = 'hist-dots';
    const seq = hist.slice(-22);
    for (const h of seq) {
      const i = document.createElement('i');
      i.className = h.winner === 'player' ? 'p' : h.winner === 'banker' ? 'b' : 't';
      out.appendChild(i);
    }
    return out;
  }

  const p2 = (n) => String(n).padStart(2, '0');
  function fmtDate(ts) {
    const d = new Date(ts);
    return `${p2(d.getMonth() + 1)}/${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  }

  function shoeSummary(item) {
    let p = 0, b = 0, t = 0;
    for (const h of item.hist) {
      if (h.winner === 'player') p++;
      else if (h.winner === 'banker') b++;
      else t++;
    }
    return { p, b, t, n: item.hist.length };
  }

  function renderHistory() {
    el.histList.replaceChildren();

    const addItem = (item, isCurrent, idx) => {
      const s = shoeSummary(item);
      const box = document.createElement('div');
      box.className = 'hist-item' + (isCurrent ? ' is-current' : '');

      const left = document.createElement('div');
      const top = document.createElement('div');
      top.className = 'hist-top';
      top.textContent = `#${item.no} 슈`;
      if (isCurrent) {
        const em = document.createElement('em');
        em.textContent = '진행 중';
        top.appendChild(em);
      }
      const meta = document.createElement('div');
      meta.className = 'hist-meta';
      meta.textContent = `${fmtDate(item.startedAt)} · ${s.n}판 · P ${s.p} B ${s.b} T ${s.t}`;
      left.append(top, meta, fingerHistory(item.hist));

      box.appendChild(left);

      if (!isCurrent) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'hist-load';
        btn.textContent = '불러오기';
        btn.addEventListener('click', () => {
          const item2 = S.archive[idx];
          if (!item2) return;
          if (S.shoe.hist.length) {
            S.archive.push({
              no: S.shoe.no, startedAt: S.shoe.startedAt, endedAt: Date.now(), hist: S.shoe.hist.slice()
            });
          }
          S.archive = S.archive.filter((a) => a !== item2);
          S.shoe = { no: item2.no, startedAt: item2.startedAt, hist: item2.hist.map((h) => ({ winner: h.winner })) };
          hideSheets();
          render();
          toast(`#${item2.no} 슈를 불러왔습니다`);
        });
        box.appendChild(btn);
      }
      el.histList.appendChild(box);
    };

    addItem(S.shoe, true, -1);
    if (!S.archive.length) {
      const empty = document.createElement('div');
      empty.className = 'hist-empty';
      empty.textContent = '지난 슈 기록이 없습니다. 「새 슈」를 누르면 여기에 저장됩니다.';
      el.histList.appendChild(empty);
    } else {
      for (let i = S.archive.length - 1; i >= 0; i--) addItem(S.archive[i], false, i);
    }
  }

  /* ─────────────── events ─────────────── */
  $$('.key[data-add]').forEach((btn) => {
    btn.addEventListener('click', () => add(btn.dataset.add));
  });
  el.btnUndo.addEventListener('click', undo);
  el.btnReset.addEventListener('click', openReset);
  el.confirmReset.addEventListener('click', doReset);

  el.btnHistory.addEventListener('click', () => { renderHistory(); showSheet(el.sheetHistory); });

  el.agBtns.forEach((btn) => btn.addEventListener('click', () => setPreview(btn.dataset.pv)));

  $$('[data-close]').forEach((btn) => btn.addEventListener('click', hideSheets));
  el.veil.addEventListener('click', hideSheets);

  let clearArmed = 0;
  el.btnClearAll.addEventListener('click', () => {
    if (!clearArmed) {
      clearArmed = window.setTimeout(() => {
        clearArmed = 0;
        el.btnClearAll.textContent = '전체 삭제';
      }, 2600);
      el.btnClearAll.textContent = '한 번 더 누르면 삭제';
      return;
    }
    clearTimeout(clearArmed);
    clearArmed = 0;
    el.btnClearAll.textContent = '전체 삭제';
    S.archive = [];
    save();
    renderHistory();
    toast('세션 기록을 모두 지웠습니다');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { hideSheets(); return; }
    if (openSheet) return;
    if (e.metaKey || e.ctrlKey) {
      if (e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
      return;
    }
    if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (k === 'p') { e.preventDefault(); add('player'); }
    else if (k === 'b') { e.preventDefault(); add('banker'); }
    else if (k === 't') { e.preventDefault(); add('tie'); }
    else if (e.key === 'Backspace' || k === 'z') { e.preventDefault(); undo(); }
  });

  document.addEventListener('visibilitychange', () => { if (!document.hidden) renderRoadsSoon(); });

  function watchSize() {
    const targets = [el.bigroad, el.roadEye, el.roadSmall, el.roadCock, el.bead];
    if (typeof ResizeObserver === 'function') {
      if (railRO) railRO.disconnect();
      railRO = new ResizeObserver(() => {
        measureSizes();
        renderRoadsSoon();
      });
      targets.forEach((t) => t && railRO.observe(t));
    }
    const onResize = () => {
      measureSizes();
      renderRoadsSoon();
    };
    window.addEventListener('resize', onResize);
    window.visualViewport && window.visualViewport.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', () => window.setTimeout(onResize, 200));
  }

  /* ─────────────── boot ─────────────── */
  load();
  measureSizes();
  render();
  watchSize();
  window.setTimeout(() => { measureSizes(); renderRoads(); }, 80);
  window.setTimeout(() => { measureSizes(); renderRoads(); }, 350);

  /* 디버그/검증용 (테스트에서 읽는다) */
  window.__analyzer = {
    state: S,
    render,
    parts: {
      header: renderHeader, roads: renderRoads, rec: renderRec,
      agree: renderAgree, patterns: renderPatterns, summary: renderSummary
    },
    api: A,
    engine: E,
    setPreview: (s) => setPreview(s),
    add
  };
})();
