/* ══════════════════════════════════════════════════════════════
   그림장 분석기 — pattern engine (pure logic, UI-free)
   · 빅로드/중국점 계산은 BaccaratEngine(baccarat-sim/js/engine.js) 그대로 사용
   · 여기서는 그 위에서 "다음 판" 분석만 만든다
   ══════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const E = global.BaccaratEngine;
  const P = 'player';
  const B = 'banker';
  const T = 'tie';
  const KO = { player: 'P', banker: 'B', tie: 'T' };
  const NAME = { player: '플레이어', banker: '뱅커' };

  const opp = (w) => (w === P ? B : w === B ? P : null);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /** 타이를 뺀 P/B 런(run) 목록 — [{w, n}] (장줄 길이 제한 없음) */
  function runs(hist) {
    const out = [];
    for (const h of hist || []) {
      if (!h) continue;
      const w = h.winner;
      if (w !== P && w !== B) continue;
      const last = out[out.length - 1];
      if (last && last.w === w) last.n += 1;
      else out.push({ w, n: 1 });
    }
    return out;
  }

  function tailIs(arr, value, min) {
    if (arr.length < min) return false;
    for (let i = arr.length - min; i < arr.length; i++) if (arr[i] !== value) return false;
    return true;
  }

  /**
   * 현재 슈의 패턴 감지.
   * 반환: { runs, streak:{side,len}, tags:[{id,label,side,weight,active}], lead:tag|null }
   */
  function detect(hist) {
    const r = runs(hist);
    const n = r.length;
    const last = n ? r[n - 1] : null;
    const lens = r.map((x) => x.n);
    const tags = [];

    // ── 장줄 (연승 진행 중)
    const streakLen = last ? last.n : 0;
    const streakSide = last ? last.w : null;
    const streakTag = {
      id: 'streak',
      label: streakLen >= 2 ? `장줄 ${KO[streakSide]} ${streakLen}연` : '장줄 없음',
      short: '장줄',
      active: streakLen >= 3,
      side: streakLen >= 3 ? streakSide : null,
      weight: streakLen >= 3 ? clamp(0.20 + 0.09 * (streakLen - 2), 0, 0.62) : 0
    };
    tags.push(streakTag);

    // ── 퐁당 = 1-1 교차 (최근 4런 이상 전부 길이 1)
    const ping = tailIs(lens, 1, 4);
    tags.push({
      id: 'pingpong',
      label: ping ? '퐁당 (P-B 교차)' : '퐁당',
      short: '퐁당',
      active: ping,
      side: ping ? opp(streakSide) : null,
      weight: ping ? 0.45 : 0
    });

    // ── 투투 = 2-2 교차 (최근 4런 이상 전부 길이 2, 또는 2-2-2 뒤 한 판 진행 중)
    const twoDone = tailIs(lens, 2, 4);
    const twoGoing = !twoDone && lens.length >= 4 &&
      lens.slice(-4, -1).every((x) => x === 2) && lens[lens.length - 1] === 1;
    tags.push({
      id: 'twotwo',
      label: twoDone ? '투투 (2연승 교차)' : twoGoing ? '투투 진행 (2연승 중)' : '투투',
      short: '투투',
      active: twoDone || twoGoing,
      side: twoDone ? opp(streakSide) : twoGoing ? streakSide : null,
      weight: twoDone ? 0.40 : twoGoing ? 0.30 : 0
    });

    // ── 원투 = 1-2 교차 (최근 4런 이상 1,2,1,2 …)
    let oneTwo = false;
    if (lens.length >= 4) {
      const t4 = lens.slice(-4);
      oneTwo = (t4[0] === 1 && t4[1] === 2 && t4[2] === 1 && t4[3] === 2) ||
               (t4[0] === 2 && t4[1] === 1 && t4[2] === 2 && t4[3] === 1);
    }
    tags.push({
      id: 'onetwo',
      label: oneTwo ? '원투 (1-2 교차)' : '원투',
      short: '원투',
      active: oneTwo,
      side: oneTwo ? opp(streakSide) : null,
      weight: oneTwo ? 0.35 : 0
    });

    const lead = tags.filter((t) => t.active && t.side).sort((a, b) => b.weight - a.weight)[0] || null;
    return {
      runs: r,
      streak: { side: streakSide, len: streakLen },
      tags,
      lead
    };
  }

  /** 최근 n판(타이 포함) 승률 요약 */
  function windowStats(hist, n) {
    const w = (hist || []).slice(-n);
    let p = 0, b = 0, t = 0;
    for (const h of w) {
      if (h.winner === P) p++;
      else if (h.winner === B) b++;
      else if (h.winner === T) t++;
    }
    const dec = p + b;
    return { n: w.length, p, b, t, dec, pPct: dec ? Math.round((p / dec) * 100) : 50 };
  }

  /**
   * 1·2·3군 일치도 — 다음 판을 P/B로 가정했을 때 각 군에 새로 찍히는 색.
   * kind: 'r'(빨강) | 'b'(파랑) | null(이번 판에는 표시 없음)
   */
  function agreements(hist) {
    const base = E.derivedRoads(hist || []);
    const out = {};
    for (const side of [P, B]) {
      const d = E.derivedRoads((hist || []).concat([{ winner: side }]));
      const rows = ['eye', 'small', 'cock'].map((key, i) => {
        const arr = d[key] || [];
        const before = (base[key] || []).length;
        const fresh = arr.length > before ? arr[arr.length - 1] : null;
        const newest = arr.length ? arr[arr.length - 1] : null;
        return {
          key,
          kind: fresh ? fresh.kind : null,
          newestKind: newest ? newest.kind : null,
          fresh: !!fresh
        };
      });
      const solid = rows.map((r) => r.kind).filter(Boolean);
      const uniform = solid.length >= 2 && solid.every((k) => k === solid[0]);
      out[side] = {
        rows,
        count: solid.length,
        uniform,
        kind: uniform ? solid[0] : null
      };
    }
    return out;
  }

  /**
   * 종합 추천.
   * 각 근거를 P(+) / B(−) 방향 가중치로 더해 방향성 비율(dir)을 만들고
   * 신뢰도 %로 환산한다. 화면에는 "참고용 패턴 분석"으로만 표기한다.
   */
  function recommend(hist, ag) {
    const h = hist || [];
    const dec = h.filter((x) => x.winner === P || x.winner === B);
    const det = detect(h);
    const factors = [];

    const add = (id, label, side, weight, detail) => {
      if (!side || !(weight > 0)) return;
      factors.push({ id, label, side, weight, detail: detail || '' });
    };

    // 1 · 1·2·3군 일치도 — 양쪽(P가정/B가정)이 동시에 일치하면 판별력이 없으므로 근거에서 뺀다
    if (ag && !(ag[P] && ag[B] && ag[P].uniform && ag[B].uniform)) {
      for (const side of [P, B]) {
        const a = ag[side];
        if (!a || !a.uniform) continue;
        const red = a.kind === 'r';
        const w = a.count >= 3 ? (red ? 0.62 : 0.52) : 0.26;
        add(
          'agree',
          a.count >= 3
            ? `1·2·3군 올${red ? '빨강' : '파랑'} (${red ? '흐름 유지' : '꺾임'})`
            : `1·2군 ${red ? '빨강' : '파랑'} 일치`,
          side, w,
          `${a.count}군 일치`
        );
      }
    }

    // 2 · 장줄
    const st = det.tags.find((t) => t.id === 'streak');
    if (st && st.active) add('streak', st.label, st.side, st.weight, '연승 흐름');

    // 3 · 교차 패턴 (퐁당 · 투투 · 원투)
    for (const id of ['pingpong', 'twotwo', 'onetwo']) {
      const t = det.tags.find((x) => x.id === id);
      if (t && t.active && t.side) add(id, t.label, t.side, t.weight, '반전 흐름');
    }

    // 4 · 최근 10판
    const w10 = windowStats(h, 10);
    if (w10.dec >= 6) {
      const diff = (w10.p - w10.b) / w10.dec;
      add('r10', `최근 10판 P ${w10.p} : B ${w10.b}`,
        diff > 0 ? P : diff < 0 ? B : null,
        0.18 * Math.abs(diff), '최근 흐름');
    }

    // 5 · 슈 전체 편향
    if (dec.length >= 20) {
      const pAll = dec.filter((x) => x.winner === P).length;
      const share = (pAll / dec.length) * 2 - 1; // -1(전부 B) … +1(전부 P)
      add('bias', `슈 전체 P ${Math.round((pAll / dec.length) * 100)}% : B ${Math.round(((dec.length - pAll) / dec.length) * 100)}%`,
        share > 0 ? P : share < 0 ? B : null,
        0.12 * Math.abs(share), '슈 편향');
    }

    const totalW = factors.reduce((s, f) => s + f.weight, 0);
    const netP = factors.reduce((s, f) => s + (f.side === P ? f.weight : -f.weight), 0);
    const dir = totalW > 0 ? netP / totalW : 0; // + = P 우세, − = B 우세
    // 근거가 적을수록 신뢰도를 낮춘다 (약한 근거 2개로 74%가 나오지 않도록)
    const evidence = clamp(totalW / 1.0, 0, 1);
    const swing = 45 * dir * Math.pow(evidence, 0.75);

    const pPct = clamp(50 + swing, 18, 82);
    const bPct = 100 - pPct;
    const lead = dir > 0 ? P : dir < 0 ? B : null;
    const strength = Math.abs(swing) / 45;

    let mode = 'none';
    if (h.length === 0) mode = 'empty';
    else if (strength >= 0.16) mode = lead === P ? 'player' : 'banker';
    else mode = 'hold';

    return {
      pPct,
      bPct,
      lead: mode === 'player' ? P : mode === 'banker' ? B : null,
      mode,                       // player | banker | hold | empty
      strength,
      confidence: Math.round(Math.max(pPct, bPct)),
      dir,
      factors: factors.sort((a, b) => b.weight - a.weight),
      covered: totalW > 0
    };
  }

  /** 슈 요약 — 판수 · 타이 · 평균/최장 장줄 · 교차 패턴 발생 횟수 */
  function summary(hist) {
    const h = hist || [];
    let dec = 0, ties = 0;
    for (const x of h) {
      if (x.winner === P || x.winner === B) dec++;
      else if (x.winner === T) ties++;
    }
    const lens = runs(h).map((r) => r.n);
    const best = lens.reduce((m, n) => Math.max(m, n), 0);
    const avg = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 0;
    let pingpong = 0, twotwo = 0, onetwo = 0;
    for (let i = 0; i + 2 < lens.length; i++) {
      const a = lens[i], b = lens[i + 1], c = lens[i + 2];
      if (a === 1 && b === 1 && c === 1) pingpong++;
      if (a === 2 && b === 2 && c === 2) twotwo++;
      if ((a === 1 && b === 2 && c === 1) || (a === 2 && b === 1 && c === 2)) onetwo++;
    }
    return { dec, ties, groups: lens.length, best, avg, pingpong, twotwo, onetwo };
  }

  global.BaccaratAnalyzer = { runs, detect, windowStats, agreements, recommend, summary, opp, KO, NAME };
})(typeof window !== 'undefined' ? window : globalThis);
