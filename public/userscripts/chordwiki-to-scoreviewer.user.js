// ==UserScript==
// @name         ChordWiki → ScoreViewer Exporter (docId)
// @namespace    musicbook
// @version      0.2.0
// @description  ChordWiki 페이지에서 악보 텍스트를 DOM에서 추출해 ScoreViewer로 전송하고 docId로 엽니다.
// @match        *://*.chordwiki.org/wiki/*
// @match        *://*.chordwiki.jp/wiki/*
// @grant        GM_xmlhttpRequest
// @connect      scoreviewer.onrender.com
// ==/UserScript==

(function () {
  'use strict';

  // 배포 도메인에 맞게 수정 가능
  const SCORE_VIEWER_ORIGIN = 'https://scoreviewer.onrender.com';
  const API_ENDPOINT = `${SCORE_VIEWER_ORIGIN}/api/proxy-chord`;

  function pickText(s) {
    return String(s || '').replace(/\r\n/g, '\n').trimEnd();
  }

  function looksLikeChordSheet(text) {
    const t = String(text || '');
    if (t.length < 80) return false;
    const chordRe = /\b(?:N\.C\.|NC|N\.C|[A-G](?:#|b)?(?:maj|min|m|dim|aug|sus|add)?\d*(?:\/[A-G](?:#|b)?)?)\b/g;
    const hits = t.match(chordRe) || [];
    return hits.length >= 8 && t.includes('\n');
  }

  function collectCandidates() {
    const out = [];
    const pre = document.querySelector('pre');
    if (pre) out.push(pickText(pre.innerText || pre.textContent));
    const ta = document.querySelector('textarea');
    if (ta) out.push(pickText(ta.value || ta.textContent));
    const mains = document.querySelectorAll('main, article, #content, #main');
    mains.forEach((el) => out.push(pickText(el.innerText || el.textContent)));
    out.push(pickText(document.body && (document.body.innerText || document.body.textContent)));
    return out.filter((x) => x && x.length > 0);
  }

  function selectBestCandidate(list) {
    let best = '';
    for (const x of list) {
      if (!looksLikeChordSheet(x)) continue;
      if (x.length > best.length) best = x;
    }
    if (!best && list.length) best = list.sort((a, b) => b.length - a.length)[0];
    return best;
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
        const candidates = collectCandidates();
        const rawText = selectBestCandidate(candidates);
        if (!rawText || rawText.length < 20) {
          alert('악보 본문 텍스트를 찾지 못했습니다.');
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
              window.open(`${SCORE_VIEWER_ORIGIN}/viewer?${qs.toString()}`, '_blank');
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
