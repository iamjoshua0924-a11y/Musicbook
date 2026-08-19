// CHORD-5: compact/RLE 인코딩 단일 구현.
// 예전에는 chordDoc/chordUpload/proxyChord에 3벌 복제돼 있었고 proxyChord 판은
// 블록 가사의 첫 글자만 남기는 절단 버그 + 출력 스키마(colUnit/widePad 누락) 불일치가 있었다.
// 뷰어(renderChordCompact)는 colUnit/widePad를 전제하므로 이 판을 유일한 정본으로 쓴다.

function shouldCompactBlocks(blocks) {
  // Object-per-cell blocks는 Mongo 16MB 제한을 쉽게 초과한다.
  // 대략 5만 셀 이상이면 compact 저장을 우선 시도한다.
  return Array.isArray(blocks) && blocks.length > 50_000;
}

function rleEncodeSpaces(str) {
  const s = String(str || '');
  /** @type {Array<[0,number] | [1,string]>} */
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

function compactBlocksV2(blocks) {
  /** @type {Array<{rawRle:any[], krRle:any[], chords:Array<{col:number, token:string}>}>} */
  const lines = [];
  let raw = '';
  let kr = '';
  /** @type {Array<{col:number, token:string}>} */
  let chords = [];
  let col = 0;

  const flush = () => {
    lines.push({ rawRle: rleEncodeSpaces(raw), krRle: rleEncodeSpaces(kr), chords });
    raw = '';
    kr = '';
    chords = [];
    col = 0;
  };

  for (const b of blocks || []) {
    if ((b?.lyric_raw ?? '') === '\n') {
      flush();
      continue;
    }
    const chord = String(b?.chord || '');
    const rawCh = String(b?.lyric_raw ?? ' ');
    const krCh = String(b?.lyric_kr ?? rawCh);
    if (chord) chords.push({ col, token: chord });
    raw += rawCh;
    kr += krCh;
    col += 1;
  }
  if (raw.length || kr.length || chords.length) flush();
  return { format: 'mb_chord_compact_v2', colUnit: 'cell', widePad: true, lines };
}

module.exports = { shouldCompactBlocks, rleEncodeSpaces, compactBlocksV2 };
