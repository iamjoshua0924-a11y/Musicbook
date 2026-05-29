// Musicbook common: deterministic initial avatar helper (no dependencies)
// Exposes window.mbAvatar = { initial(name), color(name), html({name,photoUrl,size,className}) }
(function (global) {
  const PALETTE = ['#ff2d55', '#ff9f0a', '#ffd60a', '#34c759', '#0a84ff', '#5e5ce6', '#bf5af2', '#64d2ff'];

  function hash32(str) {
    const s = String(str || '');
    let h = 2166136261;
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    // unsigned
    return h >>> 0;
  }

  function initial(name) {
    const n = String(name || '').trim();
    return (n ? n.slice(0, 1) : '?') || '?';
  }

  function color(name) {
    const idx = hash32(String(name || '').trim()) % PALETTE.length;
    return PALETTE[idx] || '#0a84ff';
  }

  function esc(s) {
    return String(s ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function html({ name, photoUrl, size = 28, className = 'mbAvatar' } = {}) {
    const n = String(name || '').trim();
    const init = initial(n);
    const bg = color(n);
    const cls = String(className || 'mbAvatar');
    const px = Math.max(16, Number(size || 28));
    if (photoUrl) {
      return `<span class="${esc(cls)}" style="width:${px}px;height:${px}px;"><img src="${esc(photoUrl)}" alt="" /></span>`;
    }
    return `<span class="${esc(cls)}" style="width:${px}px;height:${px}px;background:${esc(bg)};color:#fff;">${esc(init)}</span>`;
  }

  global.mbAvatar = { initial, color, html, esc };
})(window);

