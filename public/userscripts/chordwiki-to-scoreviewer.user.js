// ==UserScript==
// @name         ChordWiki → ScoreViewer Exporter (docId)
// @namespace    musicbook
// @version      0.3.0
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

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
    let node = walker.currentNode;
    while (node) {
      const el = /** @type {HTMLElement} */ (node);
      // leaf-ish element: has no element children (text-only)
      if (
        el &&
        isVisibleEl(el) &&
        !el.querySelector?.('*') &&
        typeof el.textContent === 'string' &&
        el.textContent.trim().length
      ) {
        const text = normalizeFragment(el.textContent).replace(/\s+\n/g, '\n').replace(/\n\s+/g, '\n').replace(/\n+/g, '\n');
        if (!isNoiseText(text)) {
          const rect = el.getBoundingClientRect();
          if (
            rect &&
            rect.width > 0 &&
            rect.height > 0 &&
            rect.left >= rootLeft - 10 &&
            rect.right <= rootRight + 10 &&
            rect.top >= rootTop - 80 &&
            rect.top <= rootBottom + 80
          ) {
            const fs = parseFloat(window.getComputedStyle(el).fontSize || '16') || 16;
            // 아주 긴 텍스트 덩어리는 leaf가 아니거나 노이즈일 가능성이 높음
            if (text.length <= 200) segs.push({ text: pickText(text).replace(/\n/g, ' '), x: rect.left, y: rect.top, w: rect.width, h: rect.height, fs });
          }
        }
      }
      node = walker.nextNode();
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

    // 글자 폭 추정(전역 중앙값)
    const charWs = segs
      .filter((s) => s.text && s.text.length >= 1 && s.w > 0)
      .map((s) => s.w / Math.max(1, s.text.length))
      .filter((x) => x > 2 && x < 40);
    const charW = Math.max(6, Math.min(24, median(charWs) || 12));
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

    const minX = Math.min(...segs.map((s) => s.x));
    const outLines = [];
    for (const ln of lines) {
      if (!ln.segs.length) {
        outLines.push('');
        continue;
      }
      ln.segs.sort((a, b) => a.x - b.x);
      let line = '';
      for (const s of ln.segs) {
        const col = Math.max(0, Math.round((s.x - minX) / charW));
        if (line.length < col) line += ' '.repeat(col - line.length);
        // 이미 같은 위치에 뭔가 있으면 1칸 띄우고 붙이기(겹침 방지)
        if (line.length === col && line.length > 0 && line[line.length - 1] !== ' ') line += ' ';
        line += s.text;
      }
      outLines.push(line.replace(/[ \t]+$/g, ''));
    }

    return outLines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
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
        const root = getScoreRoot();
        // 1) 모든 페이지에 적용: "좌표 기반 라인 복원"을 1순위로 시도한다.
        let rawText = extractTextByLayout(root);

        // 2) source/edit 원문(가능한 경우)로 보정
        const src = await fetchWikiSourceText();
        if (src && src.length > 20) {
          const srcLines = src.split('\n').length;
          const rawLines = String(rawText || '').split('\n').length;
          const srcSeemsBetter =
            srcLines >= 10 ||
            (srcLines >= rawLines + 4) ||
            (src.length > 800 && srcLines >= 6 && chordHitCount(src) >= Math.max(6, chordHitCount(rawText)));
          if (srcSeemsBetter) rawText = trimToChordArea(src);
        }

        // 3) 최후: 기존 후보 선택
        if (!rawText || rawText.split('\n').length < 4 || chordHitCount(rawText) < 6) {
          const candidates = collectCandidates();
          rawText = rawText && rawText.length > 20 ? rawText : selectBestCandidate(candidates);
        }

        // 최종 방어: 그래도 너무 약하면 실패 처리
        const weak =
          !rawText ||
          rawText.length < 20 ||
          rawText.split('\n').length < 4 ||
          (rawText.length > 2000 && rawText.split('\n').length < 6) ||
          chordHitCount(rawText) < 6;
        if (!rawText || rawText.length < 20) {
          alert('악보 본문 텍스트를 찾지 못했습니다. (source/edit에서도 원문을 찾지 못함)');
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
        const payload = JSON.stringify({ rawText, sourceUrl: location.href });

        GM_xmlhttpRequest({
          method: 'POST',
          url: API_ENDPOINT,
          headers: { 'Content-Type': 'application/json' },
          data: payload,
          onload: function (resp) {
            try {
              const data = JSON.parse(resp.responseText || '{}');
              if (!data.ok || !data.docId) {
                alert('전송 실패: ' + (data.error || 'UNKNOWN'));
                return;
              }
              const qs = new URLSearchParams();
              qs.set('mode', 'chord');
              qs.set('docId', String(data.docId));
              if (String(room || '').trim()) qs.set('room', String(room || '').trim().toUpperCase());
              // 디버그 UI는 기본 숨김이지만, 렌더 자체는 mode/docId로 동작한다.
              const wn = String(room || '').trim() ? `mb_viewer_room_${String(room || '').trim().toUpperCase()}` : '_blank';
              window.open(`${SCORE_VIEWER_ORIGIN}/viewer?${qs.toString()}`, wn);
            } catch (e) {
              alert('응답 처리 실패: ' + (e && e.message ? e.message : e));
            }
          },
          onerror: function (err) {
            alert('전송 실패: ' + JSON.stringify(err));
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
