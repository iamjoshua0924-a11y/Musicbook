// ==UserScript==
// @name         ChordWiki → ScoreViewer Exporter (docId)
// @namespace    musicbook
// @version      0.6.1
// @description  ChordWiki 페이지에서 악보 텍스트를 DOM에서 추출해 ScoreViewer로 전송하고 docId로 엽니다.
// @match        *://*.chordwiki.org/wiki/*
// @match        *://*.chordwiki.jp/wiki/*
// @grant        GM_xmlhttpRequest
// @connect      scoreviewer.onrender.com
// @connect      *
// @downloadURL  https://scoreviewer.onrender.com/public/userscripts/chordwiki-to-scoreviewer.user.js
// @updateURL    https://scoreviewer.onrender.com/public/userscripts/chordwiki-to-scoreviewer.user.js
// ==/UserScript==

(function () {
  'use strict';

  // 배포 도메인에 맞게 수정 가능
  const SCORE_VIEWER_ORIGIN = 'https://scoreviewer.onrender.com';
  const API_ENDPOINT = `${SCORE_VIEWER_ORIGIN}/api/proxy-chord`;

  function pickText(s) {
    // NBSP(웹에서 흔함) -> 일반 스페이스로 정규화해서 "공백 인덱스"가 보존되게 한다.
    return String(s || '').replace(/\u00A0/g, ' ').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd();
  }

  function normalizeFragment(s) {
    // DOM 텍스트 노드 조각을 합칠 때는 trim을 하면 공백 인덱스가 깨진다.
    return String(s || '').replace(/\u00A0/g, ' ').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  }

  function median(nums) {
    const a = (nums || []).filter((x) => Number.isFinite(Number(x))).map((x) => Number(x)).sort((x, y) => x - y);
    if (!a.length) return 0;
    const mid = Math.floor(a.length / 2);
    return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  }

  function isVisibleEl(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (!style) return true;
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    return true;
  }

  function isNoiseText(t) {
    const s = String(t || '').trim();
    if (!s) return true;
    if (s === 'ja.chordwiki.org' || s === 'chordwiki.org') return true;
    if (s.includes('Performing security verification')) return true;
    if (s.includes('security verification')) return true;
    return false;
  }

  function isMetaText(t) {
    const s = String(t || '').trim();
    if (!s) return false;
    if (/^\s*(?:BPM|Key)\s*[:=]/i.test(s)) return true;
    if (s.includes('拍子')) return true;
    if (s.includes('アクセント')) return true;
    return false;
  }

  function isScoreMonoText(t) {
    const s = String(t || '').trim();
    if (!s) return false;
    if (isMetaText(s)) return false;
    // 코드/리듬 영역에서 쓰이는 문자셋(가사/설명 제외)
    if (!/^[A-Za-z0-9#b/|().+\-_=><:\s]+$/.test(s)) return false;
    // 의미 있는 토큰이 하나는 있어야 한다.
    return /[A-G]|N\.C|NC|\||\-|=|>/.test(s);
  }

  function pickBestGrid(colW, xs) {
    const candidates = [];
    for (let i = 0; i < Math.min(40, xs.length); i += 1) {
      const x = xs[i];
      const ph = ((x % colW) + colW) % colW;
      candidates.push(Math.round(ph * 10) / 10);
    }
    const uniq = Array.from(new Set(candidates)).slice(0, 16);
    if (!uniq.length) return 0;
    let best = uniq[0];
    let bestErr = Infinity;
    for (const off of uniq) {
      let err = 0;
      for (let i = 0; i < Math.min(200, xs.length); i += 1) {
        const x = xs[i];
        const k = Math.round((x - off) / colW);
        err += Math.abs((x - off) - k * colW);
      }
      if (err < bestErr) {
        bestErr = err;
        best = off;
      }
    }
    return best;
  }

  function getScoreRoot() {
    const candidates = [
      document.querySelector('#wikibody'),
      document.querySelector('#wiki-body'),
      document.querySelector('#content'),
      document.querySelector('main'),
      document.querySelector('article'),
      document.body
    ].filter(Boolean);

    let best = document.body;
    let bestScore = -Infinity;
    for (const el of candidates) {
      const t = pickText(el.textContent || '');
      const hits = chordHitCount(t);
      const score = hits * 10 + Math.min(15000, t.length) / 80;
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return best || document.body;
  }

  /**
   * (핵심) 화면 배치(좌표) 기반으로 줄을 복원한다.
   * ChordWiki는 복사하면 1줄로 뭉개지는 케이스가 있어, DOM 텍스트가 아니라 "렌더링 위치"로 라인을 재구성한다.
   */
  function extractTextByLayout(root) {
    const r0 = root?.getBoundingClientRect ? root.getBoundingClientRect() : null;
    const rootLeft = r0 ? r0.left : 0;
    const rootTop = r0 ? r0.top : 0;
    const rootRight = r0 ? r0.right : window.innerWidth;
    const rootBottom = r0 ? r0.bottom : window.innerHeight * 5;

    /** @type {Array<{text:string,x:number,y:number,w:number,h:number,fs:number}>} */
    const segs = [];

    // 1) 텍스트 노드 기반 수집(좌표 정밀도를 위해)
    const tStart = performance.now ? performance.now() : Date.now();
    const overBudget = () => {
      const now = performance.now ? performance.now() : Date.now();
      return now - tStart > 650; // 모바일에서도 클릭이 멈추지 않게 예산 제한
    };
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let tn = tw.nextNode();
    while (tn) {
      if (overBudget() || segs.length > 9000) break;
      const textRaw = normalizeFragment(tn.nodeValue || '');
      const t = pickText(textRaw);
      if (t && !isNoiseText(t) && t.length <= 260) {
        const parent = tn.parentElement;
        if (parent && isVisibleEl(parent)) {
          const rectP = parent.getBoundingClientRect();
          if (
            rectP &&
            rectP.width > 0 &&
            rectP.height > 0 &&
            rectP.left >= rootLeft - 10 &&
            rectP.right <= rootRight + 10 &&
            rectP.top >= rootTop - 120 &&
            rectP.top <= rootBottom + 120
          ) {
            const fs = parseFloat(window.getComputedStyle(parent).fontSize || '16') || 16;
            // Score/리듬 라인은 "문자 단위 rect"를 써서 x를 더 정확히 잡는다 (전략 2)
            if (isScoreMonoText(t) && t.length <= 220) {
              try {
                const range = document.createRange();
                const str = String(tn.nodeValue || '');
                // code unit index로 range를 잡되, ascii 위주(스코어)라 안전
                for (let i = 0; i < str.length; i += 1) {
                  if (overBudget() || segs.length > 9000) break;
                  const ch = str[i];
                  if (ch === '\n' || ch === '\r') continue;
                  if (!ch.trim()) continue; // 공백은 x로 간접 복원
                  range.setStart(tn, i);
                  range.setEnd(tn, i + 1);
                  const rr = range.getBoundingClientRect();
                  if (rr && rr.width > 0 && rr.height > 0) {
                    segs.push({ text: pickText(ch), x: rr.left, y: rr.top, w: rr.width, h: rr.height, fs });
                  }
                }
              } catch {
                // fallback: parent rect
                segs.push({ text: t.replace(/\n/g, ' '), x: rectP.left, y: rectP.top, w: rectP.width, h: rectP.height, fs });
              }
            } else {
              // 일반 텍스트는 parent rect 기반(속도)
              segs.push({ text: t.replace(/\n/g, ' '), x: rectP.left, y: rectP.top, w: rectP.width, h: rectP.height, fs });
            }
          }
        }
      }
      tn = tw.nextNode();
    }

    // 일부 페이지는 leaf 조건이 너무 빡세서 비어버릴 수 있다. 그때는 span/div 등의 "짧은 텍스트"를 2차 수집
    if (segs.length < 10) {
      const els = root.querySelectorAll('span, a, b, i, em, strong, div, p');
      els.forEach((el) => {
        if (!isVisibleEl(el)) return;
        const text = normalizeFragment(el.textContent || '');
        const t = pickText(text);
        if (!t || t.length > 80 || isNoiseText(t)) return;
        const rect = el.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) return;
        if (rect.left < rootLeft - 10 || rect.right > rootRight + 10) return;
        const fs = parseFloat(window.getComputedStyle(el).fontSize || '16') || 16;
        segs.push({ text: t, x: rect.left, y: rect.top, w: rect.width, h: rect.height, fs });
      });
    }

    if (!segs.length) return '';

    // ===== 그리드(배열) 추정 개선 =====
    // 1) 스코어/리듬 문자셋에 해당하는 조각만으로 "컬럼 폭"을 추정한다(가사/설명 제외).
    const monoSegs = segs.filter((s) => isScoreMonoText(s.text) && s.w > 0);
    const baseForGrid = monoSegs.length >= 12 ? monoSegs : segs;

    const charWs = baseForGrid
      .filter((s) => s.text && s.text.length >= 1 && s.w > 0)
      .map((s) => s.w / Math.max(1, s.text.length))
      .filter((x) => x > 4 && x < 40);
    const colW = Math.max(6, Math.min(26, median(charWs) || 12));

    // 2) x 좌표를 colW 격자에 맞추기 위한 offset(phase)을 추정한다.
    const xs = baseForGrid.map((s) => s.x).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    const gridX0 = pickBestGrid(colW, xs);

    // 3) y 클러스터 임계는 폰트 크기 기반으로 유지
    const lineH = Math.max(10, Math.min(40, median(segs.map((s) => s.fs)) * 1.15 || 18));
    const yThresh = Math.max(6, lineH * 0.65);

    segs.sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));

    /** @type {Array<{y:number, segs: Array<typeof segs[number]>}>} */
    const lines = [];
    for (const s of segs) {
      const y = s.y;
      const last = lines.length ? lines[lines.length - 1] : null;
      if (!last || Math.abs(y - last.y) > yThresh) {
        // 큰 gap이면 빈줄로 문단 분리
        if (last && y - last.y > lineH * 1.9) lines.push({ y: last.y + lineH * 1.2, segs: [] });
        lines.push({ y, segs: [s] });
      } else {
        last.segs.push(s);
      }
    }

    const outLines = [];
    for (const ln of lines) {
      if (!ln.segs.length) {
        outLines.push('');
        continue;
      }
      ln.segs.sort((a, b) => a.x - b.x);
      let line = '';
      for (const s of ln.segs) {
        const col = Math.max(0, Math.round((s.x - gridX0) / colW));
        if (line.length < col) line += ' '.repeat(col - line.length);
        // 이미 같은 위치에 뭔가 있으면 1칸 띄우고 붙이기(겹침 방지)
        if (line.length === col && line.length > 0 && line[line.length - 1] !== ' ') line += ' ';
        line += s.text;
      }
      outLines.push(line.replace(/[ \t]+$/g, ''));
    }

    // (중요) 과도한 좌측 여백 제거:
    // 빈 줄로 구분되는 "문단 블록"별로 최소 공통 indent를 계산해 왼쪽으로 당긴다.
    const normalized = [];
    let buf = [];
    const flush = () => {
      if (!buf.length) return;
      const nonEmpty = buf.filter((x) => String(x || '').trim().length);
      let minIndent = Infinity;
      for (const l of nonEmpty) {
        const m = String(l).match(/^[ \t]*/);
        const ind = m ? m[0].length : 0;
        if (ind < minIndent) minIndent = ind;
      }
      if (!Number.isFinite(minIndent)) minIndent = 0;
      for (const l of buf) normalized.push(String(l || '').slice(minIndent).replace(/[ \t]+$/g, ''));
      buf = [];
    };
    for (const l of outLines) {
      if (!String(l || '').trim().length) {
        flush();
        normalized.push('');
      } else {
        buf.push(l);
      }
    }
    flush();

    return normalized.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
  }

  // ===== 간단 가나→한글(독음) 변환(클라이언트 블록 전송용) =====
  function kataToHira(str) {
    return String(str || '').replace(/[\u30A1-\u30F6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  }
  const KANA_TO_KR = new Map(
    Object.entries({
      あ: '아', い: '이', う: '우', え: '에', お: '오',
      か: '카', き: '키', く: '쿠', け: '케', こ: '코',
      さ: '사', し: '시', す: '스', せ: '세', そ: '소',
      た: '타', ち: '치', つ: '츠', て: '테', と: '토',
      な: '나', に: '니', ぬ: '누', ね: '네', の: '노',
      は: '하', ひ: '히', ふ: '후', へ: '헤', ほ: '호',
      ま: '마', み: '미', む: '무', め: '메', も: '모',
      や: '야', ゆ: '유', よ: '요',
      ら: '라', り: '리', る: '루', れ: '레', ろ: '로',
      わ: '와', を: '오', ん: '응',
      が: '가', ぎ: '기', ぐ: '구', げ: '게', ご: '고',
      ざ: '자', じ: '지', ず: '즈', ぜ: '제', ぞ: '조',
      だ: '다', ぢ: '지', づ: '즈', で: '데', ど: '도',
      ば: '바', び: '비', ぶ: '부', べ: '베', ぼ: '보',
      ぱ: '파', ぴ: '피', ぷ: '푸', ぺ: '페', ぽ: '포',
      ぁ: '아', ぃ: '이', ぅ: '우', ぇ: '에', ぉ: '오',
      ゃ: '야', ゅ: '유', ょ: '요'
    })
  );
  const YOON = new Map(
    Object.entries({
      きゃ: '캬', きゅ: '큐', きょ: '쿄',
      しゃ: '샤', しゅ: '슈', しょ: '쇼',
      ちゃ: '챠', ちゅ: '츄', ちょ: '쵸',
      にゃ: '냐', にゅ: '뉴', にょ: '뇨',
      ひゃ: '햐', ひゅ: '휴', ひょ: '효',
      みゃ: '먀', みゅ: '뮤', みょ: '묘',
      りゃ: '랴', りゅ: '류', りょ: '료',
      ぎゃ: '갸', ぎゅ: '규', ぎょ: '교',
      じゃ: '쟈', じゅ: '쥬', じょ: '죠',
      びゃ: '뱌', びゅ: '뷰', びょ: '뵤',
      ぴゃ: '퍄', ぴゅ: '퓨', ぴょ: '표'
    })
  );
  function toKoreanReadingMvp(input) {
    const s = String(input ?? '');
    if (!s) return '';
    const hasKana = /[\u3040-\u30ff]/.test(s);
    if (!hasKana) return s;
    const hira = kataToHira(s);
    let out = '';
    for (let i = 0; i < hira.length; i += 1) {
      const two = hira.slice(i, i + 2);
      if (YOON.has(two)) {
        out += YOON.get(two);
        i += 1;
        continue;
      }
      const ch = hira[i];
      if (ch === 'ー' || ch === 'っ') continue;
      out += KANA_TO_KR.get(ch) || ch;
    }
    return out;
  }

  function isEmoji(ch) {
    try {
      return /\p{Extended_Pictographic}/u.test(ch);
    } catch {
      // fallback: naive surrogate pair range
      return /[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(ch);
    }
  }

  function splitCols(line) {
    const out = [];
    for (const ch of Array.from(String(line || ''))) {
      out.push(ch);
      if (isEmoji(ch)) out.push(' '); // emoji는 2칸으로 취급(전략 3)
    }
    return out;
  }

  function looksLikeChordToken(tok) {
    const t = String(tok || '').trim();
    if (!t) return false;
    if (/^(?:N\.C\.|N\.C|NC)$/i.test(t)) return true;
    return /^\/?[A-G](?:#|b)?(?:maj|min|m|dim|aug|sus|add)?\d*(?:\/[A-G](?:#|b)?)?$/i.test(t);
  }
  function buildChordStartMapFromLine(chordLine) {
    const s = String(chordLine || '');
    const map = new Map();
    let i = 0;
    while (i < s.length) {
      if (s[i] === ' ' || s[i] === '\t') {
        i += 1;
        continue;
      }
      let j = i;
      while (j < s.length && /[A-Za-z0-9#b/.()+]/.test(s[j])) j += 1;
      const tok = s.slice(i, j).trim();
      if (looksLikeChordToken(tok)) map.set(i, tok);
      i = Math.max(j, i + 1);
    }
    return map;
  }
  function isChordLineSimple(line) {
    const s = String(line || '');
    const t = s.trim();
    if (!t) return false;
    if (isMetaText(t)) return false;
    if (/[\u3040-\u30ff\u3400-\u9fff\uAC00-\uD7AF]/.test(s)) return false;
    if (!/^[A-Za-z0-9#b/|().+\-_=><:\s]+$/.test(s)) return false;
    // 코드 토큰이 실제로 존재하거나 리듬만 있는 라인
    if (/^[\s|=:_\-–—~.*+\\/><]+$/.test(s)) return true;
    return /\b(?:N\.C\.|NC|N\.C)\b|\b\/?[A-G][#b]?(?:maj|min|m|dim|aug|sus|add)?\d*(?:\/[A-G][#b]?)?\b/.test(s);
  }

  function buildBlocksFromRawText(rawText) {
    const lines = String(rawText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    /** @type {Array<{chord:string,lyric_raw:string,lyric_kr:string}>} */
    const blocks = [];
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? '';
      const next = lines[i + 1] ?? '';

      if (isChordLineSimple(line) && next && !isChordLineSimple(next) && next.trim() !== '') {
        const chordMap = buildChordStartMapFromLine(line);
        const lyricCols = splitCols(next);
        const maxLen = Math.max(line.length, lyricCols.length);
        for (let col = 0; col < maxLen; col += 1) {
          const chord = chordMap.get(col) || '';
          const raw = col < lyricCols.length ? lyricCols[col] : ' ';
          const kr = toKoreanReadingMvp(raw);
          blocks.push({ chord, lyric_raw: raw, lyric_kr: kr });
        }
        blocks.push({ chord: '', lyric_raw: '\n', lyric_kr: '\n' });
        i += 1;
        continue;
      }

      if (isChordLineSimple(line)) {
        // chord-only: 코드 토큰은 위, 나머지 문자는 아래에 그대로
        const chordMap = buildChordStartMapFromLine(line);
        for (let col = 0; col < line.length; col += 1) {
          const chord = chordMap.get(col) || '';
          const ch = line[col] || ' ';
          // 코드 토큰이 시작되는 칸이면 아래는 공백 처리
          const raw = chord ? ' ' : ch;
          blocks.push({ chord, lyric_raw: raw, lyric_kr: raw });
        }
        blocks.push({ chord: '', lyric_raw: '\n', lyric_kr: '\n' });
        continue;
      }

      const lyricCols = splitCols(line);
      for (let col = 0; col < lyricCols.length; col += 1) {
        const raw = lyricCols[col];
        blocks.push({ chord: '', lyric_raw: raw, lyric_kr: toKoreanReadingMvp(raw) });
      }
      blocks.push({ chord: '', lyric_raw: '\n', lyric_kr: '\n' });
    }
    return blocks;
  }

  function rleEncodeSpaces(str) {
    const s = String(str || '');
    const out = [];
    let i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (ch === ' ') {
        let j = i + 1;
        while (j < s.length && s[j] === ' ') j += 1;
        out.push([0, j - i]);
        i = j;
        continue;
      }
      let j = i + 1;
      while (j < s.length && s[j] !== ' ') j += 1;
      out.push([1, s.slice(i, j)]);
      i = j;
    }
    return out;
  }

  // blocks(Object per cell)는 payload가 너무 커질 수 있어 compact(v2)로 직접 전송한다.
  function buildCompactV2FromRawText(rawText) {
    const lines = String(rawText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const outLines = [];
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? '';
      const next = lines[i + 1] ?? '';

      const pushLine = (rawStr, krStr, chords) => {
        outLines.push({
          rawRle: rleEncodeSpaces(rawStr),
          krRle: rleEncodeSpaces(krStr),
          chords: chords || []
        });
      };

      if (isChordLineSimple(line) && next && !isChordLineSimple(next) && next.trim() !== '') {
        const chordMap = buildChordStartMapFromLine(line);
        const lyricCols = splitCols(next);
        const maxLen = Math.max(line.length, lyricCols.length);
        let raw = '';
        let kr = '';
        const chords = [];
        for (let col = 0; col < maxLen; col += 1) {
          const chord = chordMap.get(col) || '';
          const rawCh = col < lyricCols.length ? lyricCols[col] : ' ';
          raw += rawCh;
          kr += toKoreanReadingMvp(rawCh);
          if (chord) chords.push({ col, token: chord });
        }
        pushLine(raw, kr, chords);
        i += 1;
        continue;
      }

      if (isChordLineSimple(line)) {
        const chordMap = buildChordStartMapFromLine(line);
        let raw = '';
        let kr = '';
        const chords = [];
        for (let col = 0; col < line.length; col += 1) {
          const chord = chordMap.get(col) || '';
          const ch = line[col] || ' ';
          const rawCh = chord ? ' ' : ch;
          raw += rawCh;
          kr += rawCh;
          if (chord) chords.push({ col, token: chord });
        }
        pushLine(raw, kr, chords);
        continue;
      }

      // lyric-only
      const lyricCols = splitCols(line);
      let raw = '';
      let kr = '';
      for (const ch of lyricCols) {
        raw += ch;
        kr += toKoreanReadingMvp(ch);
      }
      pushLine(raw, kr, []);
    }

    return { format: 'mb_chord_compact_v2', lines: outLines };
  }

  // Rollback: 안정적인 docId 방식(서버 저장)으로 복귀한다.
  // - postMessage 직송은 브라우저별로 payload 유실이 발생해 불안정.
  function openViewerByDocId(docId, room) {
    const qs = new URLSearchParams();
    qs.set('mode', 'chord');
    qs.set('docId', String(docId));
    if (String(room || '').trim()) qs.set('room', String(room || '').trim().toUpperCase());
    const wn = String(room || '').trim() ? `mb_viewer_room_${String(room || '').trim().toUpperCase()}` : '_blank';
    window.open(`${SCORE_VIEWER_ORIGIN}/viewer?${qs.toString()}`, wn);
  }

  function chordHitCount(text) {
    const t = String(text || '');
    const chordRe = /\b(?:N\.C\.|NC|N\.C|[A-G](?:#|b)?(?:maj|min|m|dim|aug|sus|add)?\d*(?:\/[A-G](?:#|b)?)?)\b/g;
    return (t.match(chordRe) || []).length;
  }

  function looksLikeChordSheet(text) {
    const t = String(text || '');
    if (t.length < 80) return false;
    const hits = chordHitCount(t);
    return hits >= 8 && t.includes('\n');
  }

  function collectCandidates() {
    /** @type {Array<{src:string,text:string}>} */
    const out = [];
    const pre = document.querySelector('pre');
    // innerText는 화면 줄바꿈/레이아웃에 의해 줄이 합쳐지거나 공백이 변형될 수 있어 textContent 우선
    if (pre) out.push({ src: 'pre', text: pickText(pre.textContent) });
    const ta = document.querySelector('textarea');
    if (ta) out.push({ src: 'textarea', text: pickText(ta.value || ta.textContent) });
    // chordwiki 구조 변경 대비(가능한 경우 특정 컨테이너도 후보로)
    const wikiBody = document.querySelector('#wikibody, #wiki-body, #body, #content');
    if (wikiBody) out.push({ src: 'wikibody', text: extractTextPreserveBr(wikiBody) });
    const mains = document.querySelectorAll('main, article, #content, #main');
    mains.forEach((el) => out.push({ src: 'main', text: extractTextPreserveBr(el) || pickText(el.textContent) }));
    // body는 최후 후보(대부분 노이즈가 많아서 점수를 강하게 깎는다)
    out.push({ src: 'body', text: pickText(document.body && (document.body.innerText || document.body.textContent)) });
    return out.filter((x) => x && x.text && x.text.length > 0);
  }

  function extractTextPreserveBr(root) {
    const out = [];
    const walk = (node) => {
      if (!node) return;
      const nt = node.nodeType;
      if (nt === Node.TEXT_NODE) {
        out.push(normalizeFragment(node.nodeValue || ''));
        return;
      }
      if (nt !== Node.ELEMENT_NODE) return;
      const el = /** @type {HTMLElement} */ (node);
      const tag = (el.tagName || '').toUpperCase();
      if (tag === 'BR') {
        out.push('\n');
        return;
      }
      const isBlock = ['DIV', 'P', 'TR', 'TABLE', 'SECTION', 'ARTICLE', 'UL', 'OL', 'LI', 'HR'].includes(tag);
      if (isBlock) out.push('\n');
      for (const ch of Array.from(el.childNodes || [])) walk(ch);
      if (isBlock) out.push('\n');
    };
    walk(root);
    return pickText(out.join('').replace(/\n{3,}/g, '\n\n'));
  }

  async function fetchWikiSourceText() {
    // chordwiki는 페이지 구조가 케이스마다 달라서(줄바꿈이 <br> 기반/가공된 경우),
    // 가장 안정적인 방법은 "원문(source/edit)"을 같은 도메인에서 가져오는 것이다.
    const tryParseHtmlForTextarea = async (url) => {
      try {
        const html = await fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.text() : ''));
        if (!html) return '';
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const ta =
          doc.querySelector('textarea[name="msg"]') ||
          doc.querySelector('textarea[name="source"]') ||
          doc.querySelector('textarea#msg') ||
          doc.querySelector('textarea');
        const v = ta ? String(ta.value || ta.textContent || '') : '';
        return pickText(v);
      } catch {
        return '';
      }
    };

    // 1) ?cmd=edit (보통 textarea로 원문이 있음)
    const u1 = `${location.href}${location.search ? '&' : '?'}cmd=edit`;
    const t1 = await tryParseHtmlForTextarea(u1);
    if (t1 && t1.includes('\n')) return t1;

    // 2) ?cmd=source (구현에 따라 pre 또는 plain text)
    try {
      const u2 = `${location.href}${location.search ? '&' : '?'}cmd=source`;
      const res = await fetch(u2, { credentials: 'include' });
      if (!res.ok) return '';
      const ct = String(res.headers.get('content-type') || '').toLowerCase();
      const body = await res.text();
      if (!body) return '';
      if (ct.includes('text/plain')) return pickText(body);
      // html일 수도 있음
      const doc = new DOMParser().parseFromString(body, 'text/html');
      const pre = doc.querySelector('pre');
      if (pre) return pickText(pre.textContent || '');
      return '';
    } catch {
      return '';
    }
  }

  function trimToChordArea(text) {
    const t = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = t.split('\n');
    const isChordLine = (line) => chordHitCount(line) >= 3 && !/[\u3040-\u30ff\u3400-\u9fff]/.test(line);

    // 사용자 지시 변경:
    // - Key: 위쪽은 곡 정보이므로 유지(일반 텍스트로 출력)
    // - BPM 위를 잘라내지 않는다.
    const start = 0;

    let end = lines.length;
    // 2) copyright 라인부터 아래는 모두 버린다(사용자 규칙)
    for (let i = start; i < lines.length; i++) {
      const s = String(lines[i] || '').trim();
      if (!s) continue;
      if (/\bcopyright\b/i.test(s) || /©|Ⓒ|\(c\)/i.test(s) || /all rights reserved/i.test(s)) {
        end = i;
        break;
      }
    }
    // 2-2) 추가적인 푸터 노이즈(링크/이용규약)는 보조적으로 컷
    if (end === lines.length) {
      for (let i = lines.length - 1; i >= start; i--) {
        const s = String(lines[i] || '').trim();
        if (!s) continue;
        if (s.includes('ChordWiki') || s.includes('http://') || s.includes('https://') || s.includes('利用規約')) {
          end = i;
          continue;
        }
        break;
      }
    }
    return lines.slice(start, Math.max(start + 1, end + 1)).join('\n').trimEnd();
  }

  function scoreCandidate(c) {
    const text = String(c.text || '');
    const hits = chordHitCount(text);
    const lines = text.split('\n').length;
    let score = hits * 20 + lines + Math.min(8000, text.length) / 40;
    // 후보 소스 가중치
    if (c.src === 'pre') score += 250;
    if (c.src === 'textarea') score += 200;
    if (c.src === 'main') score += 20;
    if (c.src === 'body') score -= 300;
    // 노이즈 패널티
    if (text.includes('ChordWiki')) score -= 80;
    if (text.includes('利用規約')) score -= 120;
    return score;
  }

  function selectBestCandidate(list) {
    // pre/textarea가 있고 그 중 하나라도 chord-sheet로 보이면, main/body는 아예 배제한다.
    const preferred = list.filter((c) => c.src === 'pre' || c.src === 'textarea');
    const preferredChordy = preferred.filter((c) => looksLikeChordSheet(c.text));
    const pool = preferredChordy.length ? preferredChordy : preferred.length ? preferred : list;

    let best = null;
    let bestScore = -Infinity;
    for (const c of pool) {
      const s = scoreCandidate(c);
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    return best ? trimToChordArea(best.text) : '';
  }

  function ensureButton() {
    if (document.getElementById('mbExportBtn')) return;
    const btn = document.createElement('button');
    btn.id = 'mbExportBtn';
    btn.textContent = '🎵 ScoreViewer로 열기';
    btn.style.cssText =
      'position:fixed; right:18px; bottom:18px; z-index:999999;' +
      'padding:12px 16px; border-radius:12px; border:0;' +
      'background:#4f46e5; color:#fff; font-weight:800; cursor:pointer;' +
      'box-shadow:0 10px 30px rgba(0,0,0,0.25);';

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = '전송 중...';
      try {
        // (요청 반영) 좌표 기반 복원은 공백 폭발/용량 문제를 유발해 안정성이 떨어져,
        // 기본 경로에서는 사용하지 않는다. (원문 source/edit 또는 DOM의 <br> 기반 텍스트를 우선)
        let rawText = '';
        let debugSrc = 'layout';

        // 2) source/edit 원문(가능한 경우)로 보정
        const src = await fetchWikiSourceText();
        if (src && src.length > 20) {
          const srcLines = src.split('\n').length;
          const rawLines = String(rawText || '').split('\n').length;
          const srcSeemsBetter =
            srcLines >= 10 ||
            (srcLines >= rawLines + 4) ||
            (src.length > 800 && srcLines >= 6 && chordHitCount(src) >= Math.max(6, chordHitCount(rawText)));
          if (srcSeemsBetter) {
            rawText = trimToChordArea(src);
            debugSrc = 'cmd=edit/source';
          }
        }

        // 3) DOM 후보 선택(pre/textarea/wikibody 등)
        if (!rawText) {
          const candidates = collectCandidates();
          rawText = selectBestCandidate(candidates);
          if (rawText) debugSrc = 'dom-candidates';
        }

        // 최종 방어: 그래도 너무 약하면 실패 처리
        const weak =
          !rawText ||
          rawText.length < 20 ||
          rawText.split('\n').length < 4 ||
          (rawText.length > 2000 && rawText.split('\n').length < 6) ||
          chordHitCount(rawText) < 6;
        if (weak) {
          const info = `src=${debugSrc}, lines=${String(rawText || '').split('\n').length}, hits=${chordHitCount(rawText)}, len=${String(rawText || '').length}`;
          const head = String(rawText || '').slice(0, 220);
          alert('악보 본문 추출/복원에 실패했습니다.\n' + info + '\n\n' + head);
          return;
        }

        // viewer에서 링크로 열었을 때 ?mb_room=ROOM 을 붙여줄 수 있다.
        let room = '';
        try {
          const ru = new URL(window.location.href);
          room = String(ru.searchParams.get('mb_room') || '').trim().toUpperCase();
        } catch {}
        if (!room) {
          room = (prompt('세션 코드(선택): 세션에서 바로 따라오게 하려면 입력', '') || '').trim().toUpperCase();
        }
        // Rollback: 서버에 rawText를 전송해 docId를 발급받는다.
        // (payload/브라우저 postMessage 유실 문제 제거)
        const payload = JSON.stringify({ rawText, sourceUrl: location.href });
        GM_xmlhttpRequest({
          method: 'POST',
          url: API_ENDPOINT,
          headers: { 'Content-Type': 'application/json' },
          data: payload,
          onload: function (resp) {
            try {
              const status = Number(resp.status || 0);
              const txt = String(resp.responseText || '');
              const data = txt ? JSON.parse(txt) : {};
              if (!data?.ok || !data?.docId) {
                alert(`전송 실패 (status=${status}): ${data?.error || 'UNKNOWN'}\n${txt.slice(0, 500)}`);
                return;
              }
              openViewerByDocId(String(data.docId), room);
            } catch (e) {
              alert('응답 처리 실패: ' + String(e?.message || e));
            }
          },
          onerror: function (err) {
            alert('전송 실패(onerror): ' + JSON.stringify(err));
          }
        });
      } finally {
        btn.disabled = false;
        btn.textContent = '🎵 ScoreViewer로 열기';
      }
    });

    document.body.appendChild(btn);
  }

  setTimeout(ensureButton, 1000);
})();
