// Генератор обложек мероприятий: векторная графика по категории и номеру записи.
// Изображения создаются на сервере (SVG), поэтому весят 2–4 КБ и не требуют внешних файлов.
const rng = (seed) => {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const TONES = {
  hot: ['#ff7a45', '#d63f12', '#8a230a'],
  ember: ['#ffb089', '#ef5a2b', '#9e2f10'],
  mono: ['#ece8e1', '#9a968f', '#55524e'],
};

function cube(cx, cy, s, [top, left, right]) {
  const w = s * 0.866, h = s / 2;
  const f = (n) => n.toFixed(1);
  return `<polygon points="${f(cx)},${f(cy - s)} ${f(cx + w)},${f(cy - h)} ${f(cx)},${f(cy)} ${f(cx - w)},${f(cy - h)}" fill="${top}"/>`
    + `<polygon points="${f(cx - w)},${f(cy - h)} ${f(cx)},${f(cy)} ${f(cx)},${f(cy + s)} ${f(cx - w)},${f(cy + h)}" fill="${left}"/>`
    + `<polygon points="${f(cx + w)},${f(cy - h)} ${f(cx)},${f(cy)} ${f(cx)},${f(cy + s)} ${f(cx + w)},${f(cy + h)}" fill="${right}"/>`;
}

const ART = {
  // IT: лестница из изометрических блоков
  it(r) {
    const tones = [TONES.hot, TONES.mono, TONES.ember];
    let o = '';
    const s = 62 + r() * 10;
    const n = 4 + Math.floor(r() * 2);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        const x = 400 + (j - i / 2) * s * 1.732 * 0.5 * 2 - s * 0.2;
        const y = 150 + i * s * 1.05 + (j % 2) * 0;
        o += cube(x, y, s * 0.5, tones[(i + j) % (r() > 0.7 ? 3 : 2) === 0 ? 0 : (i * 7 + j) % 3 === 1 ? 1 : 0]);
      }
    }
    return o;
  },
  // Образование: концентрические дуги и точка
  education(r) {
    const cx = 330 + r() * 140, cy = 330 + r() * 60;
    let o = '';
    for (let i = 6; i >= 1; i--) {
      o += `<circle cx="${cx}" cy="${cy}" r="${i * 46}" fill="none" stroke="${i === 3 ? '#ff4d1f' : '#3a3a3f'}" stroke-width="${i === 3 ? 14 : 2}"/>`;
    }
    const a = r() * Math.PI * 2;
    o += `<circle cx="${(cx + Math.cos(a) * 138).toFixed(1)}" cy="${(cy + Math.sin(a) * 138).toFixed(1)}" r="22" fill="#ece8e1"/>`;
    return o;
  },
  // Бизнес: колонки роста
  business(r) {
    let o = '';
    const n = 6;
    for (let i = 0; i < n; i++) {
      const h = 80 + i * 38 + r() * 40;
      const x = 150 + i * 92;
      const tone = i === n - 1 ? TONES.hot : i % 2 ? TONES.mono : TONES.ember;
      for (let k = 0; k * 40 < h; k++) o += cube(x, 520 - k * 40 - 34, 34, tone);
    }
    return o;
  },
  // Выставки и фестивали: наложенные рамки
  exhibition(r) {
    let o = '';
    for (let i = 0; i < 5; i++) {
      const w = 190 + r() * 150, h = 140 + r() * 140;
      const x = 120 + r() * 380, y = 80 + r() * 260, rot = (r() - 0.5) * 24;
      const fill = i === 2 ? '#ff4d1f' : 'none';
      o += `<rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}" fill="${fill}" fill-opacity="${i === 2 ? 0.92 : 1}" stroke="${i === 2 ? '#ff4d1f' : i % 2 ? '#ece8e1' : '#4a4a50'}" stroke-width="${i === 2 ? 0 : 2}" transform="rotate(${rot.toFixed(1)} ${(x + w / 2).toFixed(0)} ${(y + h / 2).toFixed(0)})"/>`;
    }
    return o;
  },
  // Спорт: беговая дорожка
  sport(r) {
    let o = '';
    const cx = 400, cy = 300;
    for (let i = 0; i < 6; i++) {
      o += `<rect x="${cx - 300 + i * 22}" y="${cy - 150 + i * 22}" width="${600 - i * 44}" height="${300 - i * 44}" rx="${150 - i * 22}" fill="none" stroke="${i === 2 ? '#ff4d1f' : '#3a3a3f'}" stroke-width="${i === 2 ? 12 : 2}"/>`;
    }
    const x = cx - 300 + 44 + r() * 180;
    o += `<circle cx="${(cx - 300 + 44 + 70).toFixed(0)}" cy="${cy - 150 + 44}" r="20" fill="#ece8e1"/>`;
    o += `<line x1="${x.toFixed(0)}" y1="${cy - 150}" x2="${x.toFixed(0)}" y2="${cy + 150}" stroke="#ece8e1" stroke-width="2" stroke-dasharray="6 8"/>`;
    return o;
  },
  // Культура: эквалайзер
  culture(r) {
    let o = '';
    const n = 21;
    for (let i = 0; i < n; i++) {
      const h = 40 + Math.abs(Math.sin(i * 0.55 + r() * 0.8)) * 280 + r() * 30;
      const x = 80 + i * 32;
      const hot = i >= 8 && i <= 12;
      o += `<rect x="${x}" y="${(300 - h / 2).toFixed(0)}" width="16" height="${h.toFixed(0)}" rx="8" fill="${hot ? '#ff4d1f' : i % 3 === 0 ? '#ece8e1' : '#3d3d43'}"/>`;
    }
    return o;
  },
};

export function coverSvg(slug, seed) {
  const r = rng(seed * 97 + 13);
  const art = (ART[slug] ?? ART.it)(r);
  let grid = '';
  for (let x = 0; x <= 800; x += 100) grid += `<line x1="${x}" y1="0" x2="${x}" y2="600" stroke="#ffffff" stroke-opacity="0.07"/>`;
  for (let y = 0; y <= 600; y += 100) grid += `<line x1="0" y1="${y}" x2="800" y2="${y}" stroke="#ffffff" stroke-opacity="0.07"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true">`
    + `<rect width="800" height="600" fill="#101012"/>${grid}${art}</svg>`;
}
