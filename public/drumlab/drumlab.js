/* 리니어 드럼 랩 — 과제 생성 → 기보(VexFlow) → 오디오 스케줄(Web Audio)
   시간 단위: 1박 = 24틱 (2·3·4·6·8분할 모두 정수). 과제는 항상 2마디(192틱) 루프. */
(() => {
  'use strict';
  const VF = Vex.Flow;
  const BEAT = 24, BAR = 96, LOOP = 192;
  const $ = (id) => document.getElementById(id);

  /* ---------- 설정 상태 ---------- */
  const DEF = {
    theme: 'linear',
    tp: {
      linear: { len: 4, place: 'repeat', filler: 'rest' },
      para: { len: 4, place: 'repeat', filler: 'rest' },
      sext: { len: 2, place: 'end', filler: 'groove' },
    },
    units: [12, 6, 4], cells: [3, 4, 5], kickDouble: true,
    rudiments: ['single', 'pdd'], subs: [6], kickSub: false,
    sextCells: ['RLRLKK', 'RLK', 'RLKK'],
    insts: ['ht', 'ft'], moveGap: 12, accent: true, sticking: true, lead: 'R',
    feel: 'straight', swing: 66,
    bpm: 80, sub: 1, beats: [2, 1, 1, 1, 2, 1, 1, 1], subOn: [1, 1, 1, 1, 1, 1],
    clickVol: 80, noteVol: 60, noteOn: true, countIn: true, offset: 0,
    cleared: 0,
  };
  const STORE = 'drumlab.v1';
  let S = structuredClone(DEF);
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (saved) S = { ...S, ...saved, tp: { ...S.tp, ...(saved.tp || {}) } };
  } catch (e) { /* 저장소를 못 쓰는 환경에서도 동작 */ }
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) {} };

  const TP_KEYS = ['len', 'place', 'filler'];
  const get = (k) => (TP_KEYS.includes(k) ? S.tp[S.theme][k] : S[k]);
  const set = (k, v) => { if (TP_KEYS.includes(k)) S.tp[S.theme][k] = v; else S[k] = v; };

  /* ---------- 난수 ---------- */
  function mulberry32(a) {
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
  const other = (h) => (h === 'R' ? 'L' : 'R');
  const mirror = (s) => s.replace(/[RL]/g, (c) => other(c));

  /* ---------- 과제 생성 ---------- */
  // 손 음표가 놓일 악기: 스네어 가중치 + 선택한 악기
  function handVoice(rng, snareW) {
    const pool = [];
    for (let i = 0; i < snareW; i++) pool.push('sn');
    return pick(rng, pool.concat(S.insts));
  }

  // 균일 분할 리듬 (파라디들·6연음 필인)
  function uniform(len, u) {
    const on = [];
    for (let p = 0; p < len; p += u) {
      let tup = null;
      const b = Math.floor(p / BEAT);
      if (u === 8) tup = { id: 'b' + b, n: 3, occ: 2, d: '8' };
      if (u === 4) tup = { id: 'b' + b, n: 6, occ: 4, d: '16' };
      on.push({ t: p, tup });
    }
    return on;
  }

  // 리니어: 선택한 음가로 리듬 뼈대를 만든다. 잇단음은 항상 완결된 묶음으로만 넣는다.
  function linearRhythm(rng, len) {
    const units = S.units.length ? S.units : [6];
    const ok = (u, p, R) => {
      switch (u) {
        case 36: return p % 12 === 0 && R >= 36;
        case 24: return p % 12 === 0 && R >= 24;
        case 18: return p % 6 === 0 && R >= 18;
        case 12: return p % 6 === 0 && R >= 12;
        case 6: return R >= 6;
        case 3: return R >= 6;
        case 8: return p % 24 === 0 && R >= 24;
        case 4: return p % 12 === 0 && R >= 12;
      }
      return false;
    };
    const on = [];
    let p = 0, tid = 0;
    const run = (n, u) => { for (let i = 0; i < n; i++) { on.push({ t: p, tup: null }); p += u; } };
    while (p < len) {
      const R = len - p;
      let c = units.filter((u) => ok(u, p, R));
      if (!c.length) c = [24, 12, 6].filter((u) => ok(u, p, R));
      const u = pick(rng, c);
      if (u === 8) {
        tid++;
        for (let i = 0; i < 3; i++) on.push({ t: p + 8 * i, tup: { id: 't' + tid, n: 3, occ: 2, d: '8' } });
        p += 24;
      } else if (u === 4) {
        tid++;
        const full = p % 24 === 0 && R >= 24 && rng() < 0.7;
        const n = full ? 6 : 3;
        for (let i = 0; i < n; i++) on.push({ t: p + 4 * i, tup: { id: 't' + tid, n, occ: full ? 4 : 2, d: '16' } });
        p += n * 4;
      } else if (u === 3) run(R >= 12 && p % 12 === 0 && rng() < 0.5 ? 4 : 2, 3);
      else if (u === 6) run(1 + Math.floor(rng() * Math.min(4, Math.floor(R / 6))), 6);
      else if (u === 12) run(1 + Math.floor(rng() * Math.min(2, Math.floor(R / 12))), 12);
      else run(1, u);
    }
    return on;
  }

  // 리니어: 손 n음 + 베이스 1~2음 묶음(셀)을 이어 붙인다. 동시에 울리는 사지는 없다.
  function genLinear(rng, len) {
    const on = linearRhythm(rng, len);
    const sizes = S.cells.length ? S.cells : [3];
    const n = on.length;
    const gap = (i) => (i + 1 < n ? on[i + 1].t : len) - on[i].t;
    let i = 0;
    while (i < n) {
      let size = Math.min(pick(rng, sizes), n - i);
      let k = size === 1 ? 0 : 1;
      if (S.kickDouble && size >= 4 && rng() < 0.4) k = 2;
      if (k === 2 && gap(i + size - 2) <= 3) k = 1; // 32분 베이스 더블은 피한다
      const h = size - k;
      const v = handVoice(rng, 3);
      const split = v !== 'sn' && rng() < 0.25;
      for (let j = 0; j < h; j++) {
        Object.assign(on[i + j], {
          stick: j % 2 === 0 ? S.lead : other(S.lead),
          insts: [split && j % 2 === 1 ? 'sn' : v],
          accent: S.accent && j === 0,
        });
      }
      for (let j = h; j < size; j++) Object.assign(on[i + j], { stick: 'K', insts: ['bd'], accent: false });
      i += size;
    }
    return on;
  }

  const RUD = { single: 'RLRR', double: 'RLRLRR', triple: 'RLRLRLRR', pdd: 'RLRRLL', inv: 'RLLR', rev: 'RRLR' };
  function genPara(rng, len) {
    const u = pick(rng, S.subs.length ? S.subs : [6]);
    const on = uniform(len, u);
    const ruds = S.rudiments.length ? S.rudiments : ['single'];
    let lead = S.lead, i = 0;
    while (i < on.length) {
      const base = RUD[pick(rng, ruds)];
      const s = lead === 'R' ? base : mirror(base);
      const v = handVoice(rng, 2);
      for (let j = 0; j < s.length && i < on.length; j++, i++) {
        const diddle = s[j] === s[j + 1] || s[j] === s[j - 1];
        const kick = S.kickSub && diddle && u > 3;
        Object.assign(on[i], {
          stick: kick ? 'K' : s[j],
          insts: [kick ? 'bd' : (j === 0 ? v : 'sn')],
          accent: S.accent && j === 0,
        });
      }
      lead = other(s[s.length - 1]);
    }
    return on;
  }

  function genSext(rng, len) {
    const on = uniform(len, 4);
    const cells = S.sextCells.length ? S.sextCells : ['RLRLKK'];
    let i = 0;
    while (i < on.length) {
      const base = pick(rng, cells);
      const s = S.lead === 'R' ? base : mirror(base);
      const v = handVoice(rng, 2);
      for (let j = 0; j < s.length && i < on.length; j++, i++) {
        const kick = s[j] === 'K';
        Object.assign(on[i], { stick: s[j], insts: [kick ? 'bd' : v], accent: S.accent && j === 0 && !kick });
      }
    }
    return on;
  }

  // 프레이즈를 2마디 안에 배치한다: 반복 / 앞 정렬 / 끝(필 자리). 빈 구간은 쉼표나 기본 그루브.
  function makeTask(seed) {
    const rng = mulberry32(seed);
    const tp = S.tp[S.theme];
    const len = tp.len * BEAT;
    const ph = S.theme === 'para' ? genPara(rng, len) : S.theme === 'sext' ? genSext(rng, len) : genLinear(rng, len);
    const ev = [];
    const add = (off, tag) => ph.forEach((e) => {
      const t = e.t + off;
      if (t < LOOP) ev.push({ ...e, t, tup: e.tup ? { ...e.tup, id: tag + e.tup.id } : null });
    });
    if (len >= LOOP || tp.place === 'repeat') {
      for (let k = 0; k * len < LOOP; k++) add(k * len, k + '-');
    } else {
      const off = tp.place === 'end' ? LOOP - len : 0;
      add(off, '');
      if (tp.filler === 'groove') {
        const from = tp.place === 'end' ? 0 : len, to = tp.place === 'end' ? off : LOOP;
        for (let t = from; t < to; t += BEAT) {
          const b = (t / BEAT) % 4;
          ev.push({ t, tup: null, stick: '', accent: false, insts: [b % 2 === 0 ? 'bd' : 'sn', 'hh'] });
          ev.push({ t: t + 12, tup: null, stick: '', accent: false, insts: ['hh'] });
        }
      }
    }
    ev.sort((a, b) => a.t - b.t);
    fixHands(ev);
    ev.forEach((e, i) => { e.ioi = (i + 1 < ev.length ? ev[i + 1].t : LOOP) - e.t; });
    return { seed, events: ev, written: buildWritten(ev) };
  }

  // 같은 손이 직전 타격 뒤 moveGap 틱 안에 다른 북으로 옮겨야 하면, 옮기지 않고 치던 북에 머문다.
  // 루프 끝 → 처음으로 넘어가는 지점까지 보려고 두 번 돈다(첫 바퀴는 직전 루프 역할).
  function fixHands(ev) {
    const last = {};
    for (let pass = 0; pass < 2; pass++) {
      for (const e of ev) {
        if (e.stick !== 'R' && e.stick !== 'L') continue;
        const t = e.t + (pass ? 0 : -LOOP), l = last[e.stick];
        if (l && e.insts[0] !== l.inst && t - l.t < S.moveGap) e.insts = [l.inst];
        last[e.stick] = { inst: e.insts[0], t };
      }
    }
  }

  /* ---------- 기보용 변환: 온셋 간격 → 음표 + 쉼표 ---------- */
  const CODE = { 96: 'w', 48: 'h', 36: 'qd', 24: 'q', 18: '8d', 12: '8', 6: '16', 3: '32' };
  function buildWritten(ev) {
    const out = [];
    const rests = (q, end) => {
      while (q < end) {
        const v = [96, 48, 24, 12, 6, 3].find((x) => q % x === 0 && q + x <= end);
        if (!v) break;
        out.push({ t: q, len: v, code: CODE[v], rest: true });
        q += v;
      }
    };
    if (!ev.length) { rests(0, LOOP); return out; }
    rests(0, ev[0].t);
    for (const e of ev) {
      let len;
      if (e.tup) len = e.tup.d === '8' ? 8 : 4;
      else {
        const t = e.t, barEnd = (Math.floor(t / BAR) + 1) * BAR, beatEnd = (Math.floor(t / BEAT) + 1) * BEAT;
        const c = [];
        if (t % 24 === 0) { if (t + 36 <= barEnd) c.push(36); c.push(24); }
        if (t % 6 === 0 && t + 18 <= beatEnd) c.push(18);
        if (t % 6 === 0 && t + 12 <= beatEnd) c.push(12);
        if (t + 6 <= beatEnd) c.push(6);
        c.push(3);
        len = c.find((x) => x <= e.ioi) || 3;
      }
      out.push({ t: e.t, len, code: e.tup ? e.tup.d : CODE[len], rest: false, ev: e, tup: e.tup });
      rests(e.t + len, e.t + e.ioi);
    }
    return out;
  }

  /* ---------- 필(feel): 틱 → 박 위치 변환 ---------- */
  // 스윙은 8분 단위, 바운스는 16분 단위로 뒤쪽 음을 늦춘다. 잇단음 묶음은 변환하지 않는다.
  function warp(t) {
    if (S.feel === 'straight') return t;
    const U = S.feel === 'swing' ? 24 : 12, s = S.swing / 100;
    const base = Math.floor(t / U) * U, x = (t - base) / U;
    return base + (x < 0.5 ? x * 2 * s : s + (x - 0.5) * 2 * (1 - s)) * U;
  }
  const beatPos = (t, tuplet) => (tuplet ? t : warp(t)) / BEAT;

  /* ---------- 기보 렌더 ---------- */
  const KEY = { bd: 'f/4', ft: 'a/4', sn: 'c/5', mt: 'd/5', ht: 'e/5', hh: 'g/5/x2' };
  const ORDER = ['bd', 'ft', 'sn', 'mt', 'ht', 'hh'];
  const SYS_H = 178, STAVE_Y = 36;
  let anchors = [], cursorEl = null, svgEl = null;

  function render() {
    const host = $('score');
    host.innerHTML = '';
    anchors = []; cursorEl = null;
    if (!task) return;
    const cw = host.clientWidth, ch = host.clientHeight;
    if (cw < 50 || ch < 50) return;
    const ink = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#000';
    const bars = [0, 1].map((b) => task.written.filter((w) => w.t >= b * BAR && w.t < (b + 1) * BAR));
    const n0 = bars[0].length, n1 = bars[1].length;
    // 한 줄(2마디)과 두 줄(마디당 한 줄) 중 화면에서 더 크게 보이는 쪽을 고른다
    const need1 = Math.max(520, 150 + 24 * (n0 + n1)), need2 = Math.max(360, 110 + 24 * Math.max(n0, n1));
    const sc1 = Math.min(cw / need1, ch / SYS_H), sc2 = Math.min(cw / need2, ch / (SYS_H * 2));
    const systems = sc2 > sc1 * 1.1 ? 2 : 1;
    const Lh = SYS_H * systems;
    const Lw = Math.max(systems === 1 ? need1 : need2, (Lh * cw) / ch);

    const r = new VF.Renderer(host, VF.Renderer.Backends.SVG);
    r.resize(Lw, Lh);
    const ctx = r.getContext();
    ctx.setFillStyle(ink); ctx.setStrokeStyle(ink);
    svgEl = host.querySelector('svg');
    svgEl.setAttribute('viewBox', `0 0 ${Lw} ${Lh}`);
    svgEl.removeAttribute('width'); svgEl.removeAttribute('height');
    svgEl.style.width = '100%'; svgEl.style.height = '100%';

    const pad = 8, avail = Lw - pad * 2;
    let w0 = avail, w1 = avail;
    if (systems === 1) {
      w0 = 70 + (avail - 70) * ((n0 + 3) / (n0 + n1 + 6));
      w1 = avail - w0;
    }
    bars.forEach((items, b) => {
      const sys = systems === 2 ? b : 0;
      const x = systems === 1 && b === 1 ? pad + w0 : pad;
      const stave = new VF.Stave(x, sys * SYS_H + STAVE_Y, b === 0 ? w0 : w1);
      if (b === 0 || systems === 2) stave.addClef('percussion');
      if (b === 0) stave.addTimeSignature('4/4');
      if (b === 1) stave.setEndBarType(VF.Barline.type.REPEAT_END);
      if (b === 0) stave.setBegBarType(VF.Barline.type.REPEAT_BEGIN);
      stave.setContext(ctx).draw();

      const notes = [], beams = [], tupGroups = new Map();
      let grp = [], grpKey = null;
      const flush = () => { if (grp.length > 1) beams.push(new VF.Beam(grp)); grp = []; };
      for (const it of items) {
        let n;
        if (it.rest) {
          n = new VF.StaveNote({ keys: [it.code === 'w' ? 'd/5' : 'b/4'], duration: it.code + 'r' });
          flush();
        } else {
          const keys = [...it.ev.insts].sort((a, c) => ORDER.indexOf(a) - ORDER.indexOf(c)).map((i) => KEY[i]);
          n = new VF.StaveNote({ keys, duration: it.code, stem_direction: 1 });
          if (it.code.endsWith('d')) VF.Dot.buildAndAttach([n], { all: true });
          if (it.ev.accent) n.addModifier(new VF.Articulation('a>').setPosition(3), 0);
          if (S.sticking && it.ev.stick && it.ev.stick !== 'K') {
            n.addModifier(new VF.Annotation(it.ev.stick).setFont('Arial', 11, 'bold')
              .setVerticalJustification(VF.Annotation.VerticalJustify.BOTTOM), 0);
          }
          const key = it.tup ? it.tup.id : 'beat' + Math.floor(it.t / BEAT);
          if (key !== grpKey) flush();
          grpKey = key;
          if (it.len < 24) grp.push(n); else flush();
          if (it.tup) {
            if (!tupGroups.has(it.tup.id)) tupGroups.set(it.tup.id, { tup: it.tup, notes: [] });
            tupGroups.get(it.tup.id).notes.push(n);
          }
        }
        n.setStyle({ fillStyle: ink, strokeStyle: ink });
        notes.push(n);
        it._n = n; it._sys = sys;
      }
      flush();
      const tuplets = [...tupGroups.values()].map((g) =>
        new VF.Tuplet(g.notes, { num_notes: g.tup.n, notes_occupied: g.tup.occ, ratioed: false }));
      const voice = new VF.Voice({ num_beats: 4, beat_value: 4 }).setMode(VF.Voice.Mode.SOFT);
      voice.addTickables(notes);
      new VF.Formatter().joinVoices([voice]).format([voice], stave.getNoteEndX() - stave.getNoteStartX() - 12);
      voice.draw(ctx, stave);
      beams.forEach((bm) => { bm.setStyle({ fillStyle: ink, strokeStyle: ink }); bm.setContext(ctx).draw(); });
      tuplets.forEach((t) => t.setContext(ctx).draw());

      for (const it of items) anchors.push({ b: beatPos(it.t, !!it.tup), x: it._n.getAbsoluteX() + 6, sys });
      if (b === 1 || systems === 2) anchors.push({ b: (b + 1) * 4, x: stave.getX() + stave.getWidth() - 4, sys, end: true });
    });
    anchors.sort((a, c) => a.b - c.b || (a.end ? -1 : 1));

    const NS = 'http://www.w3.org/2000/svg';
    if (S.feel !== 'straight') {
      const tx = document.createElementNS(NS, 'text');
      tx.setAttribute('x', pad + 4); tx.setAttribute('y', 14);
      tx.setAttribute('class', 'feel-mark');
      tx.textContent = (S.feel === 'swing' ? 'Swing 8th ' : 'Bounce 16th ') + S.swing + '%';
      svgEl.appendChild(tx);
    }
    cursorEl = document.createElementNS(NS, 'rect');
    cursorEl.setAttribute('class', 'cursor');
    cursorEl.setAttribute('width', 14); cursorEl.setAttribute('height', 96); cursorEl.setAttribute('rx', 4);
    cursorEl.style.display = 'none';
    svgEl.appendChild(cursorEl);
  }

  function moveCursor(pos) {
    if (!cursorEl || !anchors.length) return;
    let i = 0;
    while (i + 1 < anchors.length && anchors[i + 1].b <= pos) i++;
    const a = anchors[i], c = anchors[i + 1];
    let x = a.x;
    if (c && c.sys === a.sys && c.b > a.b) x = a.x + ((c.x - a.x) * (pos - a.b)) / (c.b - a.b);
    cursorEl.setAttribute('x', x - 7);
    cursorEl.setAttribute('y', a.sys * SYS_H + STAVE_Y + 16);
    cursorEl.style.display = '';
  }

  /* ---------- 오디오 ---------- */
  let ac = null, noiseBuf = null;
  function ensureAudio() {
    if (!ac) {
      ac = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
      noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.4, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ac.state !== 'running') ac.resume();
  }
  function env(t, peak, dur) {
    const g = ac.createGain();
    g.gain.setValueAtTime(Math.max(peak, 0.0002), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(ac.destination);
    return g;
  }
  function tone(t, f0, f1, dur, peak, type) {
    const o = ac.createOscillator();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    o.connect(env(t, peak, dur));
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(t, dur, peak, type, freq) {
    const s = ac.createBufferSource(); s.buffer = noiseBuf;
    const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    s.connect(f); f.connect(env(t, peak, dur));
    s.start(t); s.stop(t + dur + 0.02);
  }
  const CLICK = { hi: [1760, 1], mid: [1175, 0.75], lo: [880, 0.4], ci: [1320, 0.8] };
  function click(t, lv) {
    const v = (S.clickVol / 100) * CLICK[lv][1];
    if (v > 0.001) tone(t, CLICK[lv][0], CLICK[lv][0], 0.045, v * 0.6, 'triangle');
  }
  function drum(t, inst, acc) {
    const v = (S.noteVol / 100) * (acc ? 1 : 0.6);
    if (v <= 0.001) return;
    if (inst === 'bd') tone(t, 130, 45, 0.16, v * 0.9);
    else if (inst === 'sn') { noise(t, 0.12, v * 0.5, 'bandpass', 2600); tone(t, 210, 160, 0.08, v * 0.35); }
    else if (inst === 'hh') noise(t, 0.04, v * 0.3, 'highpass', 7500);
    else { const f = { ht: 230, mt: 170, ft: 105 }[inst]; tone(t, f * 1.25, f, 0.2, v * 0.7); }
  }

  /* ---------- 트랜스포트 / 스케줄러 ---------- */
  let task = null, hist = [], hi = -1;
  let playing = false, timer = null, wakeLock = null;
  let anchorTime = 0, anchorBeat = 0, schedBeat = 0;
  let origin = 0;         // 현재 울리는 과제의 루프 시작 박
  let dispOrigin = 0;     // 화면에 보이는 과제의 루프 시작 박
  let pending = null, muteNotes = false;
  let clickItems = [], noteItems = [];

  const timeAt = (b) => anchorTime + ((b - anchorBeat) * 60) / S.bpm;
  const beatAt = (t) => anchorBeat + ((t - anchorTime) * S.bpm) / 60;

  function buildClicks() {
    clickItems = [];
    const n = S.sub;
    for (let b = 0; b < 8; b++) {
      const st = S.beats[b];
      if (!st) continue; // 박 음소거는 그 박의 분할까지 함께 끈다
      for (let j = 0; j < n; j++) {
        if (j > 0 && !S.subOn[j]) continue;
        const tk = (j * BEAT) / n;
        clickItems.push({ o: b + (n % 3 === 0 ? tk : warp(tk)) / BEAT, lv: j ? 'lo' : st === 2 ? 'hi' : 'mid' });
      }
    }
  }
  const itemsOf = (tk) => tk.events.map((e) => ({ o: beatPos(e.t, !!e.tup), insts: e.insts, acc: e.accent }));

  function scheduleRange(a, b) {
    for (let k = Math.floor((a - origin) / 8); origin + 8 * k < b; k++) {
      const base = origin + 8 * k;
      if (base < 0 && origin === 0 && k < 0) { // 카운트인 1마디
        for (let i = 4; i < 8; i++) { const g = base + i; if (g >= a && g < b) click(timeAt(g), i === 4 ? 'hi' : 'ci'); }
        continue;
      }
      for (const it of clickItems) { const g = base + it.o; if (g >= a && g < b) click(timeAt(g), it.lv); }
      if (!muteNotes && S.noteOn) {
        for (const it of noteItems) {
          const g = base + it.o;
          if (g >= a && g < b) it.insts.forEach((ins) => drum(timeAt(g), ins, it.acc));
        }
      }
    }
  }
  function tick() {
    if (!playing) return;
    const h = beatAt(ac.currentTime + 0.15);
    if (h <= schedBeat) return;
    let a = schedBeat;
    if (pending && pending.origin < h) {
      if (pending.origin > a) scheduleRange(a, pending.origin);
      a = Math.max(a, pending.origin);
      origin = pending.origin; noteItems = itemsOf(pending.task); muteNotes = false; pending = null;
    }
    scheduleRange(a, h);
    schedBeat = h;
  }

  function start() {
    ensureAudio();
    buildClicks(); noteItems = itemsOf(task);
    origin = 0; dispOrigin = 0; pending = null; muteNotes = false;
    anchorBeat = S.countIn ? -4 : 0;
    anchorTime = ac.currentTime + 0.12;
    schedBeat = anchorBeat;
    playing = true;
    timer = setInterval(tick, 25);
    requestAnimationFrame(frame);
    if (navigator.wakeLock) navigator.wakeLock.request('screen').then((l) => { wakeLock = l; }).catch(() => {});
    document.body.classList.add('playing');
    $('play').setAttribute('aria-label', '정지');
  }
  function stop() {
    playing = false;
    clearInterval(timer);
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    document.body.classList.remove('playing');
    $('play').setAttribute('aria-label', '재생');
    $('count').hidden = true;
    if (cursorEl) cursorEl.style.display = 'none';
    [...$('dots').children].forEach((d) => d.classList.remove('on'));
  }

  function setBpm(v) {
    v = Math.max(30, Math.min(300, Math.round(v)));
    if (playing) { anchorTime = timeAt(schedBeat); anchorBeat = schedBeat; } // 이미 예약한 구간 뒤부터 새 템포
    S.bpm = v;
    $('bpmVal').textContent = v;
    save();
  }

  // 새 과제를 화면에 올린다. 재생 중이면 악보는 바로 바꾸고, 소리와 커서는 2박 이상 뒤의 마디 시작부터 붙인다.
  function showTask(t) {
    task = t;
    render(); updateMeta();
    if (!playing) return;
    const g = beatAt(ac.currentTime);
    if (g - origin < 0 && !pending) { noteItems = itemsOf(t); return; }
    const nb = pending ? pending.origin : origin + Math.ceil((g - origin + 2) / 4) * 4;
    pending = { origin: nb, task: t };
    muteNotes = true;
    dispOrigin = nb;
  }
  function newTask() {
    const t = makeTask((Math.random() * 2 ** 31) | 0);
    hist = hist.slice(0, hi + 1); hist.push(t);
    if (hist.length > 50) hist.shift();
    hi = hist.length - 1;
    showTask(t);
  }

  function frame() {
    if (!playing) return;
    const lat = (ac.outputLatency || ac.baseLatency || 0) + S.offset / 1000;
    const g = beatAt(ac.currentTime - lat);
    const rel = g - dispOrigin;
    const cnt = $('count');
    if (rel < 0) {
      if (cursorEl) cursorEl.style.display = 'none';
      const n = Math.ceil(-rel);
      if (n <= 4) { cnt.textContent = n; cnt.hidden = false; } else cnt.hidden = true;
    } else {
      cnt.hidden = true;
      moveCursor(rel % 8);
    }
    const bi = Math.floor((((g - origin) % 8) + 8) % 8);
    const dots = $('dots').children;
    for (let i = 0; i < dots.length; i++) dots[i].classList.toggle('on', i === bi);
    requestAnimationFrame(frame);
  }

  /* ---------- UI 바인딩 ---------- */
  const REGEN = ['theme', 'len', 'place', 'filler', 'units', 'cells', 'kickDouble', 'rudiments', 'subs', 'kickSub', 'sextCells', 'insts', 'moveGap', 'accent', 'lead'];
  const REQUIRED = ['units', 'cells', 'rudiments', 'subs', 'sextCells'];
  const parse = (v) => (v !== '' && !isNaN(v) ? Number(v) : v);

  function changed(key) {
    save();
    if (REGEN.includes(key)) newTask();
    else if (key === 'sticking') render();
    else if (['feel', 'swing', 'sub', 'beats', 'subOn'].includes(key)) {
      buildClicks();
      if (task) { noteItems = pending ? noteItems : itemsOf(task); render(); }
    }
    syncUI();
  }

  const NAMES = {
    theme: { linear: '리니어', para: '파라디들', sext: '6연음 필인' },
    place: { repeat: '반복', start: '앞 정렬', end: '필 자리' },
    feel: { straight: '스트레이트', swing: '스윙', bounce: '바운스' },
  };
  function updateMeta() {
    const tp = S.tp[S.theme];
    const parts = [NAMES.theme[S.theme], tp.len + '박'];
    if (tp.len < 8) parts.push(NAMES.place[tp.place]);
    if (S.feel !== 'straight') parts.push(NAMES.feel[S.feel]);
    $('metaText').textContent = parts.join(' · ');
    $('stat').textContent = '달성 ' + S.cleared;
  }

  function syncUI() {
    document.querySelectorAll('.seg[data-key]').forEach((g) => {
      const v = String(get(g.dataset.key));
      g.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.val === v));
    });
    document.querySelectorAll('.chips[data-key]').forEach((g) => {
      const arr = get(g.dataset.key).map(String);
      g.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', arr.includes(b.dataset.val)));
    });
    document.querySelectorAll('input[data-key]').forEach((el) => {
      if (el.type === 'checkbox') el.checked = !!get(el.dataset.key);
      else el.value = get(el.dataset.key);
      const out = document.querySelector(`[data-out="${el.dataset.key}"]`);
      if (out) out.textContent = el.value;
    });
    document.querySelectorAll('[data-theme-only]').forEach((el) => { el.hidden = el.dataset.themeOnly !== S.theme; });
    $('swingRow').hidden = S.feel === 'straight';
    $('fillerRow').hidden = get('len') >= 8 || get('place') === 'repeat';
    $('placeRow').hidden = get('len') >= 8;
    // 메트로놈 격자
    const bg = $('beatGrid');
    [...bg.children].forEach((b, i) => { b.dataset.st = S.beats[i]; b.setAttribute('aria-label', `${i + 1}번째 박: ${['음소거', '보통', '강세'][S.beats[i]]}`); });
    const sg = $('subGrid');
    sg.innerHTML = '';
    const lab = { 1: ['1'], 2: ['1', '&'], 3: ['1', '2', '3'], 4: ['1', 'e', '&', 'a'], 6: ['1', '2', '3', '4', '5', '6'] }[S.sub];
    lab.forEach((t, j) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = t; b.disabled = j === 0;
      b.setAttribute('aria-pressed', j === 0 || !!S.subOn[j]);
      b.onclick = () => { S.subOn[j] = S.subOn[j] ? 0 : 1; changed('subOn'); };
      sg.appendChild(b);
    });
    $('subRow').hidden = S.sub === 1;
    $('bpmVal').textContent = S.bpm;
    updateMeta();
  }

  function bind() {
    document.querySelectorAll('.seg[data-key]').forEach((g) => g.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      set(g.dataset.key, parse(b.dataset.val)); changed(g.dataset.key);
    }));
    document.querySelectorAll('.chips[data-key]').forEach((g) => g.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const k = g.dataset.key, v = parse(b.dataset.val), arr = get(k).slice();
      const i = arr.indexOf(v);
      if (i >= 0) { if (arr.length === 1 && REQUIRED.includes(k)) return; arr.splice(i, 1); } else arr.push(v);
      set(k, arr); changed(k);
    }));
    document.querySelectorAll('input[data-key]').forEach((el) => el.addEventListener('input', () => {
      set(el.dataset.key, el.type === 'checkbox' ? el.checked : Number(el.value)); changed(el.dataset.key);
    }));
    const bg = $('beatGrid');
    for (let i = 0; i < 8; i++) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = (i % 4) + 1;
      b.onclick = () => { S.beats[i] = (S.beats[i] + 2) % 3; changed('beats'); };
      bg.appendChild(b);
      $('dots').appendChild(document.createElement('i'));
    }

    $('play').onclick = () => (playing ? stop() : start());
    $('next').onclick = () => { S.cleared++; save(); newTask(); };
    $('prev').onclick = () => { if (hi > 0) { hi--; showTask(hist[hi]); } };
    $('stat').onclick = () => { S.cleared = 0; save(); updateMeta(); };

    // 템포: 누르고 있으면 연속 변경
    document.querySelectorAll('[data-d]').forEach((b) => {
      let to = null, iv = null;
      const d = Number(b.dataset.d);
      const end = () => { clearTimeout(to); clearInterval(iv); };
      b.addEventListener('pointerdown', () => {
        setBpm(S.bpm + d);
        to = setTimeout(() => { iv = setInterval(() => setBpm(S.bpm + d), 70); }, 400);
      });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, end));
      b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setBpm(S.bpm + d); } });
    });
    let taps = [];
    $('tap').onclick = () => {
      const now = performance.now();
      taps = taps.filter((t) => now - t < 2500); taps.push(now);
      if (taps.length >= 2) {
        const iv = (taps[taps.length - 1] - taps[Math.max(0, taps.length - 5)]) / (Math.min(taps.length, 5) - 1);
        setBpm(60000 / iv);
      }
    };

    // 설정 패널
    const panel = (open) => { document.body.classList.toggle('panel-open', open); $('scrim').hidden = !open; };
    $('openSet').onclick = () => panel(!document.body.classList.contains('panel-open'));
    $('closeSet').onclick = () => panel(false);
    $('scrim').onclick = () => panel(false);

    // 전체화면: API가 없는 기기(iPhone 등)에서는 화면 안 집중 모드로 대체
    const root = document.documentElement;
    const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
    $('fs').onclick = async () => {
      if (fsEl()) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
      if (document.body.classList.contains('focus')) { document.body.classList.remove('focus'); queueRender(); return; }
      document.body.classList.add('focus');
      panel(false);
      try {
        const req = root.requestFullscreen || root.webkitRequestFullscreen;
        if (req) await req.call(root, { navigationUI: 'hide' });
        if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
      } catch (e) { /* 집중 모드만 유지 */ }
      queueRender();
    };
    ['fullscreenchange', 'webkitfullscreenchange'].forEach((ev) => document.addEventListener(ev, () => {
      if (!fsEl()) document.body.classList.remove('focus');
      queueRender();
    }));

    document.addEventListener('keydown', (e) => {
      if (e.target.matches('input, button')) return;
      if (e.code === 'Space') { e.preventDefault(); $('play').click(); }
      if (e.key === 'ArrowRight' || e.key === 'n') $('next').click();
      if (e.key === 'ArrowUp') setBpm(S.bpm + 1);
      if (e.key === 'ArrowDown') setBpm(S.bpm - 1);
    });
    document.addEventListener('visibilitychange', () => {
      if (playing && !document.hidden && navigator.wakeLock) navigator.wakeLock.request('screen').then((l) => { wakeLock = l; }).catch(() => {});
    });
    new ResizeObserver(queueRender).observe($('score'));
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', queueRender);
    new MutationObserver(queueRender).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  }
  let rq = 0;
  function queueRender() { cancelAnimationFrame(rq); rq = requestAnimationFrame(render); }

  bind();
  syncUI();
  newTask();
  window.__drumlab = { S, makeTask, get task() { return task; } };
})();
