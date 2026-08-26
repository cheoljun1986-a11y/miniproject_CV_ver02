// Isometric drawing primitives for the slide illustrations.
// World axes: +x right-down on screen, +z left-down, +y up.

const P = {
  ink: '#1c2430',
  ink2: '#3d4757',
  muted: '#78849a',
  faint: '#aab4c4',
  line: '#ccd4e0',
  paper: '#ffffff',
  blue: '#2f6fed',
  blueL: '#7ea6f7',
  teal: '#0f9b8e',
  amber: '#e08b26',
  red: '#d1495b',
  green: '#2e9e5b',
  pink: '#ef6ea6',
  pinkD: '#c8447e',
  floor: '#e9edf3',
  floorD: '#dae1ea',
  wall: '#dde3ec',
};

const COS30 = Math.cos(Math.PI / 6);
const SIN30 = Math.sin(Math.PI / 6);

function makeView({ scale = 56, ox = 600, oy = 380 } = {}) {
  const pt = (x, y, z) => [
    ox + (x - z) * COS30 * scale,
    oy + ((x + z) * SIN30 - y) * scale,
  ];
  pt.scale = scale;
  return pt;
}

const f = (n) => Math.round(n * 100) / 100;
const poly = (pts) => pts.map(([x, y]) => `${f(x)},${f(y)}`).join(' ');

function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = amount >= 0 ? c + (255 - c) * amount : c * (1 + amount);
    return Math.max(0, Math.min(255, Math.round(v)));
  });
  return `#${ch.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── canvas ───────────────────────────────────────────────────
function canvas(w, h) {
  const defs = [];
  const body = [];
  let uid = 0;
  return {
    w,
    h,
    id: (p) => `${p}${(uid += 1)}`,
    def: (s) => { defs.push(s); },
    add: (s) => { body.push(s); },
    svg() {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs>
<filter id="soft" x="-40%" y="-40%" width="180%" height="180%">
  <feDropShadow dx="0" dy="7" stdDeviation="9" flood-color="#1c2430" flood-opacity="0.14"/>
</filter>
<filter id="soft2" x="-40%" y="-40%" width="180%" height="180%">
  <feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#1c2430" flood-opacity="0.16"/>
</filter>
${defs.join('\n')}
</defs>
<rect width="${w}" height="${h}" fill="${P.paper}"/>
${body.join('\n')}
</svg>`;
    },
  };
}

// ── text ─────────────────────────────────────────────────────
function text(x, y, s, {
  size = 21, fill = P.ink2, weight = 400, anchor = 'start', italic = false, opacity = 1,
} = {}) {
  return `<text x="${f(x)}" y="${f(y)}" font-family="Malgun Gothic, Segoe UI, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${italic ? ' font-style="italic"' : ''}${opacity !== 1 ? ` opacity="${opacity}"` : ''}>${esc(s)}</text>`;
}

// Text with a soft halo so it stays readable over artwork.
function label(x, y, s, opts = {}) {
  const o = { size: 20, fill: P.ink, weight: 600, anchor: 'middle', ...opts };
  const halo = `<text x="${f(x)}" y="${f(y)}" font-family="Malgun Gothic, Segoe UI, sans-serif" font-size="${o.size}" font-weight="${o.weight}" fill="#ffffff" stroke="#ffffff" stroke-width="6" stroke-linejoin="round" text-anchor="${o.anchor}" opacity="0.92">${esc(s)}</text>`;
  return halo + text(x, y, s, o);
}

// ── 3D box ───────────────────────────────────────────────────
// Visible faces from this viewpoint: top (y+h), right (x+w), left (z+d).
function box(c, pt, x, y, z, w, h, d, color, {
  opacity = 1, stroke = null, dash = null,
} = {}) {
  const top = shade(color, 0.2);
  const right = shade(color, -0.06);
  const left = shade(color, -0.26);
  const gTop = c.id('g');
  const gR = c.id('g');
  const gL = c.id('g');
  c.def(`<linearGradient id="${gTop}" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="${shade(top, 0.12)}"/><stop offset="1" stop-color="${top}"/></linearGradient>`);
  c.def(`<linearGradient id="${gR}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(right, 0.08)}"/><stop offset="1" stop-color="${shade(right, -0.1)}"/></linearGradient>`);
  c.def(`<linearGradient id="${gL}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(left, 0.06)}"/><stop offset="1" stop-color="${shade(left, -0.12)}"/></linearGradient>`);
  const sa = stroke ? ` stroke="${stroke}" stroke-width="1.4" stroke-linejoin="round"` : '';
  const da = dash ? ` stroke-dasharray="${dash}"` : '';
  const faces = [
    [gL, [pt(x, y, z + d), pt(x + w, y, z + d), pt(x + w, y + h, z + d), pt(x, y + h, z + d)]],
    [gR, [pt(x + w, y, z), pt(x + w, y, z + d), pt(x + w, y + h, z + d), pt(x + w, y + h, z)]],
    [gTop, [pt(x, y + h, z), pt(x + w, y + h, z), pt(x + w, y + h, z + d), pt(x, y + h, z + d)]],
  ];
  return `<g opacity="${opacity}">${faces.map(([g, q]) => `<polygon points="${poly(q)}" fill="url(#${g})"${sa}${da}/>`).join('')}</g>`;
}

// Flat quad on the ground plane (y constant).
function tile(pt, x, z, w, d, y, fill, { opacity = 1, stroke = null, sw = 1.2 } = {}) {
  const q = [pt(x, y, z), pt(x + w, y, z), pt(x + w, y, z + d), pt(x, y, z + d)];
  return `<polygon points="${poly(q)}" fill="${fill}" opacity="${opacity}"${stroke ? ` stroke="${stroke}" stroke-width="${sw}"` : ''}/>`;
}

// ── room ─────────────────────────────────────────────────────
function floorGrid(pt, { x0 = 0, z0 = 0, w = 7, d = 7, step = 1, color = '#c3ccd9', y = 0 } = {}) {
  const out = [];
  for (let x = x0; x <= x0 + w + 1e-6; x += step) {
    const a = pt(x, y, z0);
    const b = pt(x, y, z0 + d);
    out.push(`<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}" stroke="${color}" stroke-width="1"/>`);
  }
  for (let z = z0; z <= z0 + d + 1e-6; z += step) {
    const a = pt(x0, y, z);
    const b = pt(x0 + w, y, z);
    out.push(`<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}" stroke="${color}" stroke-width="1"/>`);
  }
  return out.join('');
}

// A room shell: floor slab + the two far walls, drawn back-to-front.
function room(c, pt, { w = 7, d = 7, h = 2.4, grid = true } = {}) {
  const out = [];
  out.push(tile(pt, 0, 0, w, d, 0, P.floor));
  if (grid) out.push(floorGrid(pt, { w, d }));
  // Far wall along x (at z = 0) and along z (at x = 0).
  out.push(box(c, pt, 0, 0, -0.14, w, h, 0.14, P.wall, { opacity: 0.95 }));
  out.push(box(c, pt, -0.14, 0, 0, 0.14, h, d, shade(P.wall, -0.05), { opacity: 0.95 }));
  out.push(tile(pt, 0, 0, w, d, 0, 'none', { stroke: '#aab4c4', sw: 1.6 }));
  return out.join('');
}

// ── furniture ────────────────────────────────────────────────
function sofa(c, pt, x, z, { color = '#8fa0bb', rot = 0 } = {}) {
  const out = [];
  if (rot === 0) {
    out.push(box(c, pt, x, 0, z, 1.9, 0.45, 0.85, color));
    out.push(box(c, pt, x, 0.45, z, 1.9, 0.45, 0.28, shade(color, 0.08)));
    out.push(box(c, pt, x, 0.45, z + 0.57, 0.24, 0.3, 0.28, shade(color, 0.08)));
    out.push(box(c, pt, x + 1.66, 0.45, z + 0.57, 0.24, 0.3, 0.28, shade(color, 0.08)));
  } else {
    out.push(box(c, pt, x, 0, z, 0.85, 0.45, 1.9, color));
    out.push(box(c, pt, x, 0.45, z, 0.28, 0.45, 1.9, shade(color, 0.08)));
  }
  return out.join('');
}

function table(c, pt, x, z, { w = 1.3, d = 0.8, color = '#b08d6a' } = {}) {
  const out = [];
  const legs = [[0.04, 0.04], [w - 0.14, 0.04], [0.04, d - 0.14], [w - 0.14, d - 0.14]];
  for (const [lx, lz] of legs) out.push(box(c, pt, x + lx, 0, z + lz, 0.1, 0.62, 0.1, shade(color, -0.25)));
  out.push(box(c, pt, x, 0.62, z, w, 0.08, d, color));
  return out.join('');
}

function shelf(c, pt, x, z, { color = '#9aa7bd' } = {}) {
  const out = [];
  out.push(box(c, pt, x, 0, z, 0.35, 1.7, 1.1, color));
  for (let i = 1; i <= 2; i += 1) {
    out.push(tile(pt, x, z + 0.04, 0.36, 1.02, i * 0.55, shade(color, -0.3), { opacity: 0.55 }));
  }
  return out.join('');
}

// ── phone / camera ───────────────────────────────────────────
// Drawn as a flat billboard at the projected position so it reads clearly.
function phone(c, pt, x, y, z, { scale = 1, facing = 'right', label: lb = null } = {}) {
  const [px, py] = pt(x, y, z);
  const s = 34 * scale;
  const g = c.id('g');
  c.def(`<linearGradient id="${g}" x1="0" y1="0" x2="0.6" y2="1"><stop offset="0" stop-color="#4a5568"/><stop offset="1" stop-color="#232b39"/></linearGradient>`);
  const tilt = facing === 'right' ? 14 : -14;
  const out = [`<g transform="translate(${f(px)},${f(py)}) rotate(${tilt})" filter="url(#soft2)">
<rect x="${-s * 0.34}" y="${-s * 0.62}" width="${s * 0.68}" height="${s * 1.24}" rx="${s * 0.12}" fill="url(#${g})"/>
<rect x="${-s * 0.26}" y="${-s * 0.52}" width="${s * 0.52}" height="${s * 1.0}" rx="${s * 0.06}" fill="#9fd0f5" opacity="0.85"/>
<circle cx="0" cy="${s * 0.56}" r="${s * 0.05}" fill="#6b7684"/>
</g>`];
  if (lb) out.push(label(px, py + s * 1.15, lb, { size: 19, fill: P.ink }));
  return out.join('');
}

// Translucent view cone from a camera point toward a direction on the ground.
function frustum(c, pt, from, to, { spread = 0.85, color = '#7ea6f7', opacity = 0.3 } = {}) {
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  const len = Math.hypot(dx, dz) || 1;
  const nx = -dz / len;
  const nz = dx / len;
  const a = pt(from[0], from[1], from[2]);
  const b = pt(to[0] + nx * spread, to[1], to[2] + nz * spread);
  const d = pt(to[0] - nx * spread, to[1], to[2] - nz * spread);
  const g = c.id('g');
  c.def(`<linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="${opacity + 0.2}"/><stop offset="1" stop-color="${color}" stop-opacity="0.04"/></linearGradient>`);
  return `<polygon points="${poly([a, b, d])}" fill="url(#${g})" stroke="${color}" stroke-width="1.1" stroke-opacity="0.4"/>`;
}

// ── Hachuping ────────────────────────────────────────────────
// A billboard sprite: round pink body, heart tufts, simple face.
function hachu(c, pt, x, y, z, {
  scale = 1, opacity = 1, ghost = false, flip = false,
} = {}) {
  const [px, py] = pt(x, y, z);
  const s = 30 * scale;
  const gb = c.id('g');
  c.def(`<radialGradient id="${gb}" cx="0.35" cy="0.3" r="0.85"><stop offset="0" stop-color="${shade(P.pink, 0.3)}"/><stop offset="1" stop-color="${P.pinkD}"/></radialGradient>`);
  const body = `
<ellipse cx="0" cy="${f(-s * 0.16)}" rx="${f(s * 0.56)}" ry="${f(s * 0.52)}" fill="url(#${gb})"/>
<ellipse cx="0" cy="${f(-s * 0.66)}" rx="${f(s * 0.62)}" ry="${f(s * 0.58)}" fill="url(#${gb})"/>
<path d="M ${f(-s * 0.5)} ${f(-s * 1.02)} q ${f(-s * 0.3)} ${f(-s * 0.42)} ${f(s * 0.04)} ${f(-s * 0.46)} q ${f(s * 0.22)} ${f(-s * 0.02)} ${f(s * 0.2)} ${f(s * 0.3)} z" fill="${shade(P.pink, 0.12)}"/>
<path d="M ${f(s * 0.5)} ${f(-s * 1.02)} q ${f(s * 0.3)} ${f(-s * 0.42)} ${f(-s * 0.04)} ${f(-s * 0.46)} q ${f(-s * 0.22)} ${f(-s * 0.02)} ${f(-s * 0.2)} ${f(s * 0.3)} z" fill="${shade(P.pink, 0.12)}"/>
<ellipse cx="${f(-s * 0.22)}" cy="${f(-s * 0.72)}" rx="${f(s * 0.075)}" ry="${f(s * 0.1)}" fill="#3a2130"/>
<ellipse cx="${f(s * 0.22)}" cy="${f(-s * 0.72)}" rx="${f(s * 0.075)}" ry="${f(s * 0.1)}" fill="#3a2130"/>
<ellipse cx="${f(-s * 0.4)}" cy="${f(-s * 0.55)}" rx="${f(s * 0.11)}" ry="${f(s * 0.07)}" fill="#ff9ec2" opacity="0.75"/>
<ellipse cx="${f(s * 0.4)}" cy="${f(-s * 0.55)}" rx="${f(s * 0.11)}" ry="${f(s * 0.07)}" fill="#ff9ec2" opacity="0.75"/>
<path d="M ${f(-s * 0.1)} ${f(-s * 0.55)} q ${f(s * 0.1)} ${f(s * 0.09)} ${f(s * 0.2)} 0" stroke="#3a2130" stroke-width="${f(s * 0.05)}" fill="none" stroke-linecap="round"/>
<ellipse cx="${f(-s * 0.24)}" cy="${f(s * 0.3)}" rx="${f(s * 0.16)}" ry="${f(s * 0.09)}" fill="${shade(P.pinkD, -0.15)}"/>
<ellipse cx="${f(s * 0.24)}" cy="${f(s * 0.3)}" rx="${f(s * 0.16)}" ry="${f(s * 0.09)}" fill="${shade(P.pinkD, -0.15)}"/>`;
  const shadow = ghost ? '' : `<ellipse cx="${f(px)}" cy="${f(py + 4)}" rx="${f(s * 0.5)}" ry="${f(s * 0.16)}" fill="#1c2430" opacity="0.16"/>`;
  const dashed = ghost ? ` stroke="${P.pinkD}" stroke-width="2" stroke-dasharray="5 4"` : '';
  const inner = ghost
    ? `<g opacity="${opacity}">${body}</g><ellipse cx="0" cy="${f(-s * 0.5)}" rx="${f(s * 0.7)}" ry="${f(s * 0.95)}" fill="none"${dashed}/>`
    : `<g opacity="${opacity}">${body}</g>`;
  return `${shadow}<g transform="translate(${f(px)},${f(py)})${flip ? ' scale(-1,1)' : ''}">${inner}</g>`;
}

// ── annotation ───────────────────────────────────────────────
function arrow(c, x1, y1, x2, y2, { color = P.ink2, width = 2.4, dash = null, curve = 0 } = {}) {
  const m = c.id('m');
  c.def(`<marker id="${m}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9 z" fill="${color}"/></marker>`);
  const da = dash ? ` stroke-dasharray="${dash}"` : '';
  if (curve) {
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const cx = mx - (dy / len) * curve;
    const cy = my + (dx / len) * curve;
    return `<path d="M ${f(x1)} ${f(y1)} Q ${f(cx)} ${f(cy)} ${f(x2)} ${f(y2)}" fill="none" stroke="${color}" stroke-width="${width}"${da} marker-end="url(#${m})" stroke-linecap="round"/>`;
  }
  return `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="${color}" stroke-width="${width}"${da} marker-end="url(#${m})" stroke-linecap="round"/>`;
}

// Korean glyphs are full-width; latin is roughly half. Measure accordingly or
// the pill clips its own text.
function textWidth(s, size) {
  let em = 0;
  for (const ch of String(s)) em += /[ᄀ-ᇿ　-鿿가-힯]/.test(ch) ? 1.02 : 0.55;
  return em * size;
}

function badge(x, y, s, { fill = P.blue, size = 19, pad = 15, h = 34 } = {}) {
  const w = textWidth(s, size) + pad * 2;
  return `<g><rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${h}" rx="${h / 2}" fill="${fill}"/>${text(x + w / 2, y + h * 0.68, s, { size, fill: '#fff', weight: 700, anchor: 'middle' })}</g>`;
}

function panel(c, x, y, w, h, { fill = '#f7f9fc', stroke = P.line, r = 14 } = {}) {
  return `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1.4"/>`;
}

function caption(x, y, lines, { size = 20, fill = P.ink2, anchor = 'start', gap = 27 } = {}) {
  return lines.map((l, i) => text(x, y + i * gap, l, { size, fill, anchor })).join('');
}

module.exports = {
  P, makeView, canvas, text, label, box, tile, floorGrid, room, sofa, table, shelf,
  phone, frustum, hachu, arrow, badge, panel, caption, shade, poly, f, textWidth,
};
