/**
 * 设计规格（style spec）——名片样式的唯一契约。
 *
 * 规则实现（PRESETS）和大模型输出走同一份 schema，同一个 sanitizeSpec() 清洗，
 * 同一个 specToVars() / decorHtml() 渲染。换 LLM 只是换规格来源，渲染层不动。
 *
 * 所有数值都会被 clamp 到可印制区间，颜色会做对比度兜底——所以模型再放飞，
 * 90×54mm 的铁律和文字可读性也不会破。
 */

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function num(v, lo, hi, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

function pick(v, allowed, dflt) {
  return allowed.includes(v) ? v : dflt;
}

function hex(v, dflt) {
  if (typeof v !== "string") return dflt;
  const s = v.trim();
  if (!HEX.test(s)) return dflt;
  if (s.length === 4) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  }
  return s.toLowerCase();
}

function text(v, max, dflt = "") {
  if (typeof v !== "string") return dflt;
  const s = v.replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : dflt;
}

function bool(v, dflt = false) {
  return typeof v === "boolean" ? v : dflt;
}

/* ---------- 颜色工具：对比度兜底 ---------- */

function toRgb(h) {
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function luminance(h) {
  const [r, g, b] = toRgb(h).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function mix(a, b, t) {
  const ra = toRgb(a);
  const rb = toRgb(b);
  const out = ra.map((v, i) => Math.round(v + (rb[i] - v) * t));
  return `#${out.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** 把前景色往「远离底色」的方向推，直到达标；达不到就直接上黑白。 */
function ensureContrast(fg, bg, target) {
  if (contrast(fg, bg) >= target) return fg;
  const pole = luminance(bg) > 0.4 ? "#000000" : "#ffffff";
  for (const t of [0.25, 0.45, 0.65, 0.85]) {
    const cand = mix(fg, pole, t);
    if (contrast(cand, bg) >= target) return cand;
  }
  return pole;
}

function rgba(h, alpha) {
  const [r, g, b] = toRgb(h);
  return `rgba(${r},${g},${b},${alpha})`;
}

/* ---------- 规格清洗 ---------- */

const FAMILIES = { display: "var(--display)", serif: "var(--serif)", sans: "var(--sans)", mono: "var(--mono)" };
const COLOR_REFS = ["fg", "muted", "accent", "bg", "bg2", "paper"];

function colorRef(v, dflt) {
  if (typeof v === "string" && COLOR_REFS.includes(v)) return v;
  const h = hex(v, "");
  return h || dflt;
}

/** 把颜色引用（token 名或裸 hex）解析成具体 hex。 */
export function resolveColor(spec, ref, dflt = "#888888") {
  if (typeof ref === "string" && HEX.test(ref)) return hex(ref, dflt);
  const p = spec.palette;
  if (ref === "paper") return "#f4efe6";
  return p[ref] || dflt;
}

const DECOR_KINDS = ["edge", "wedge", "grid", "stripes", "frame", "corners", "rule", "seal"];

function sanitizeDecor(raw) {
  if (!raw || typeof raw !== "object") return null;
  const kind = pick(raw.kind, DECOR_KINDS, "");
  if (!kind) return null;
  const side = pick(raw.side, ["left", "right", "top", "bottom"], "left");
  const base = { kind, color: colorRef(raw.color, "accent"), opacity: num(raw.opacity, 0.04, 1, 1) };

  if (kind === "edge") {
    return {
      ...base,
      side,
      size: num(raw.size, 0.8, 42, 6),
      fade: bool(raw.fade),
      gradient: bool(raw.gradient, true),
    };
  }
  if (kind === "wedge") {
    return { ...base, side: pick(raw.side, ["left", "right"], "right"), size: num(raw.size, 8, 40, 22), skew: num(raw.skew, 0, 90, 38) };
  }
  if (kind === "grid") {
    return { ...base, cell: num(raw.cell, 3, 25, 8), opacity: num(raw.opacity, 0.04, 0.3, 0.12) };
  }
  if (kind === "stripes") {
    return { ...base, angle: num(raw.angle, 0, 180, 45), gap: num(raw.gap, 1.2, 12, 4), opacity: num(raw.opacity, 0.04, 0.35, 0.12) };
  }
  if (kind === "frame") {
    return { ...base, inset: num(raw.inset, 1.5, 12, 4.2), width: num(raw.width, 0.12, 1.2, 0.35) };
  }
  if (kind === "corners") {
    return { ...base, inset: num(raw.inset, 1.5, 12, 3.2), size: num(raw.size, 3, 18, 8), width: num(raw.width, 0.15, 1.2, 0.45) };
  }
  if (kind === "rule") {
    return { ...base, side: pick(raw.side, ["top", "bottom"], "bottom"), length: num(raw.length, 8, 100, 34), width: num(raw.width, 0.12, 1.2, 0.3), offset: num(raw.offset, 0, 40, 18) };
  }
  if (kind === "seal") {
    return {
      ...base,
      corner: pick(raw.corner, ["tl", "tr", "bl", "br"], "br"),
      size: num(raw.size, 4, 20, 10),
      shape: pick(raw.shape, ["circle", "square", "diamond"], "circle"),
      filled: bool(raw.filled, true),
    };
  }
  return null;
}

export function sanitizeSpec(raw, fallbackId = "llm") {
  const src = raw && typeof raw === "object" ? raw : {};
  const p = src.palette && typeof src.palette === "object" ? src.palette : {};
  const s = src.surface && typeof src.surface === "object" ? src.surface : {};
  const f = src.frame && typeof src.frame === "object" ? src.frame : {};
  const t = src.type && typeof src.type === "object" ? src.type : {};
  const c = src.copy && typeof src.copy === "object" ? src.copy : {};
  const pad = f.pad && typeof f.pad === "object" ? f.pad : {};

  const bg = hex(p.bg, "#f4f1ea");
  const bg2 = hex(p.bg2, bg);
  const darkBg = luminance(bg) < 0.42;
  const fg = ensureContrast(hex(p.fg, darkBg ? "#f4ead7" : "#1b2428"), bg, 5.2);
  const muted = ensureContrast(hex(p.muted, mix(fg, bg, 0.42)), bg, 2.9);
  const accent = ensureContrast(hex(p.accent, darkBg ? "#c4a574" : "#2f5d62"), bg, 2.4);

  const decor = Array.isArray(src.decor)
    ? src.decor.map(sanitizeDecor).filter(Boolean).slice(0, 4)
    : [];

  const spec = {
    id: text(src.id, 24, fallbackId),
    name: text(src.name, 16, "未命名风格"),
    layoutName: text(src.layoutName, 20, "自由构图"),
    rationale: text(src.rationale, 120, ""),
    paper: text(src.paper, 90, "本白无涂布纸，胶印"),
    // 生图提示词里唯一由模型自由发挥的一句；色值字号这些硬事实由前端附上。
    promptNote: text(src.promptNote, 80, ""),
    palette: { bg, bg2, fg, muted, accent, bgMode: pick(p.bgMode, ["flat", "linear", "radial"], bg2 === bg ? "flat" : "linear"), bgAngle: num(p.bgAngle, 0, 360, 180) },
    surface: {
      grain: num(s.grain, 0, 0.55, 0.26),
      vignette: num(s.vignette, 0, 0.4, 0),
      radius: num(s.radius, 0, 3, 0),
      monogram: num(s.monogram, 0, 0.14, 0),
    },
    frame: {
      align: pick(f.align, ["left", "center", "right"], "left"),
      anchor: pick(f.anchor, ["top", "center", "bottom"], "center"),
      pad: {
        t: num(pad.t, 4, 18, 7.5),
        r: num(pad.r, 4, 40, 7.5),
        b: num(pad.b, 4, 18, 6.5),
        l: num(pad.l, 4, 40, 7.5),
      },
    },
    type: {
      nameFamily: pick(t.nameFamily, Object.keys(FAMILIES), "display"),
      nameSize: num(t.nameSize, 4.6, 12.5, 8),
      nameTrack: num(t.nameTrack, 0, 0.5, 0.18),
      nameWeight: pick(Number(t.nameWeight), [200, 300, 400, 500, 600, 700], 600),
      nameVertical: bool(t.nameVertical),
      nameSide: pick(t.nameSide, ["left", "right"], "left"),
      nameColor: colorRef(t.nameColor, "fg"),
      mastheadSize: num(t.mastheadSize, 2.2, 3.8, 2.6),
      mastheadTrack: num(t.mastheadTrack, 0, 0.6, 0.28),
      mastheadColor: colorRef(t.mastheadColor, "muted"),
      roleSize: num(t.roleSize, 2.3, 4.2, 2.8),
      roleTrack: num(t.roleTrack, 0, 0.45, 0.1),
      roleColor: colorRef(t.roleColor, "muted"),
      contactSize: num(t.contactSize, 2.2, 3.6, 2.6),
      contactAlign: pick(t.contactAlign, ["left", "center", "right"], "left"),
      ornament: bool(t.ornament),
      upperMasthead: bool(t.upperMasthead, true),
      nameLeading: 1.35,
      roleLeading: 1.42,
    },
    decor,
    copy: {
      maxUnder: num(c.maxUnder, 1, 3, 2),
      maxContacts: num(c.maxContacts, 1, 4, 3),
      contactStyle: pick(c.contactStyle, ["bare", "row", "stack"], "bare"),
    },
  };

  fitType(spec);
  fitSides(spec);
  return spec;
}

/**
 * 中文衬线 / 海报体出格会缺笔：字距过大像漏字，行高过紧上下被裁。
 * 清洗器在这里把字距和行高收到可印区间，不把问题留给 CSS overflow。
 */
function fitType(spec) {
  const t = spec.type;
  const nameCap = t.nameFamily === "sans" ? 0.22 : 0.18;
  t.nameTrack = Math.min(t.nameTrack, nameCap);
  t.roleTrack = Math.min(t.roleTrack, 0.12);
  t.mastheadTrack = Math.min(t.mastheadTrack, t.upperMasthead ? 0.36 : 0.22);
  t.nameLeading = t.nameFamily === "sans" ? 1.32 : 1.38;
  t.roleLeading = 1.42;
}

/** 正文至少要拿到 38% 版宽，剩下的才轮到侧边装饰和竖排姓名分。 */
const SIDE_BUDGET = 62;
const VERTICAL_GUTTER = 26;
const MIN_SIZE = { wedge: 8, edge: 0.8 };

/** 哪些装饰会占掉侧边、正文必须避开：楔形，以及宽到不能压字的实心色条。 */
function sideClaims(spec) {
  const claims = { l: [], r: [] };
  for (const d of spec.decor) {
    if (d.side !== "left" && d.side !== "right") continue;
    const key = d.side === "left" ? "l" : "r";
    if (d.kind === "wedge") claims[key].push({ d, gap: 2 });
    else if (d.kind === "edge" && !d.fade && d.size > 8) claims[key].push({ d, gap: 4 });
  }
  return claims;
}

/**
 * 侧边几何协商：装饰要多宽、竖排姓名要多宽、正文还剩多少，三者会打架。
 * 超预算时缩装饰而不是缩正文——版面被挤爆比色块窄一点严重得多。
 */
function fitSides(spec) {
  const claims = sideClaims(spec);
  const t = spec.type;
  let reserve = t.nameVertical ? VERTICAL_GUTTER : 0;
  const reserveKey = t.nameVertical ? (t.nameSide === "left" ? "l" : "r") : null;

  const claimed = (key) => claims[key].reduce((m, c) => Math.max(m, c.d.size + c.gap), 0);
  const need = (key) => Math.max(claimed(key), reserveKey === key ? reserve : 0);

  const total = need("l") + need("r");
  if (total > SIDE_BUDGET) {
    const k = SIDE_BUDGET / total;
    for (const key of ["l", "r"]) {
      for (const c of claims[key]) {
        c.d.size = Math.max(MIN_SIZE[c.d.kind], (c.d.size + c.gap) * k - c.gap);
      }
    }
    reserve *= k;
    // 色块窄到撑不住竖排姓名了，就老实改回横排。
    if (reserveKey && reserve < 20) {
      t.nameVertical = false;
      reserve = 0;
    }
  }

  for (const key of ["l", "r"]) {
    const field = key === "l" ? "l" : "r";
    spec.frame.pad[field] = Math.min(40, Math.max(spec.frame.pad[field], need(key)));
  }
}

/* ---------- 渲染：规格 → CSS 变量 ---------- */

function background(spec) {
  const { bg, bg2, bgMode, bgAngle } = spec.palette;
  if (bgMode === "flat" || bg2 === bg) return bg;
  if (bgMode === "radial") return `radial-gradient(85% 75% at 30% 20%, ${bg2}, ${bg} 72%)`;
  return `linear-gradient(${bgAngle}deg, ${bg2}, ${bg})`;
}

const ANCHOR = { top: "flex-start", center: "center", bottom: "flex-end" };
const ALIGN_ITEMS = { left: "flex-start", center: "center", right: "flex-end" };

/**
 * @param flip 背面镜像：侧边装饰换边时，留白必须跟着换，否则背面文字会压在色块上。
 */
export function specToVars(spec, flip = false) {
  const t = spec.type;
  const p = spec.frame.pad;
  const pad = flip ? { ...p, l: p.r, r: p.l } : p;
  return [
    `--card-bg:${spec.palette.bg}`,
    `--card-bg-paint:${background(spec)}`,
    `--card-fg:${spec.palette.fg}`,
    `--card-muted:${spec.palette.muted}`,
    `--card-accent:${spec.palette.accent}`,
    `--card-radius:${spec.surface.radius}cqw`,
    `--grain-opacity:${spec.surface.grain}`,
    `--vignette-opacity:${spec.surface.vignette}`,
    `--mono-opacity:${spec.surface.monogram}`,
    `--pad-t:${pad.t}%`,
    `--pad-r:${pad.r}%`,
    `--pad-b:${pad.b}%`,
    `--pad-l:${pad.l}%`,
    `--face-align:${ALIGN_ITEMS[spec.frame.align]}`,
    `--face-anchor:${ANCHOR[spec.frame.anchor]}`,
    `--text-align:${spec.frame.align}`,
    `--name-font:${FAMILIES[t.nameFamily]}`,
    `--name-size:${t.nameSize}cqw`,
    `--name-track:${t.nameTrack}em`,
    `--name-leading:${t.nameLeading || 1.35}`,
    `--name-weight:${t.nameWeight}`,
    `--name-color:${resolveColor(spec, t.nameColor, spec.palette.fg)}`,
    `--masthead-size:${t.mastheadSize}cqw`,
    `--masthead-track:${t.mastheadTrack}em`,
    `--masthead-color:${resolveColor(spec, t.mastheadColor, spec.palette.muted)}`,
    `--masthead-transform:${t.upperMasthead ? "uppercase" : "none"}`,
    `--role-size:${t.roleSize}cqw`,
    `--role-track:${t.roleTrack}em`,
    `--role-leading:${t.roleLeading || 1.42}`,
    `--role-color:${resolveColor(spec, t.roleColor, spec.palette.muted)}`,
    `--contact-size:${t.contactSize}cqw`,
    `--contact-justify:${ALIGN_ITEMS[t.contactAlign]}`,
  ].join(";");
}

/* ---------- 渲染：规格 → 装饰层 HTML ---------- */

/** 只镜像左右——上下的色晕换到另一边会把设计意图整个翻掉。 */
function mirror(side, flip) {
  if (!flip) return side;
  return side === "left" ? "right" : side === "right" ? "left" : side;
}

function edgeLayer(spec, d, flip) {
  const side = mirror(d.side, flip);
  const col = resolveColor(spec, d.color, spec.palette.accent);
  const horizontal = side === "left" || side === "right";
  const box = horizontal
    ? `top:0;bottom:0;${side}:0;width:${d.size}%`
    : `left:0;right:0;${side}:0;height:${d.size}%`;
  // 色晕必须在贴边那一侧最实、往版心淡出，否则会在纸中间留一条硬边。
  const axis = horizontal ? (side === "left" ? "270deg" : "90deg") : side === "top" ? "0deg" : "180deg";
  let paint;
  if (d.fade) {
    paint = `linear-gradient(${axis}, ${rgba(col, 0)}, ${rgba(col, 0.85)})`;
  } else if (d.gradient) {
    paint = `linear-gradient(${horizontal ? "180deg" : "90deg"}, ${mix(col, "#ffffff", 0.28)}, ${col} 48%, ${mix(col, "#000000", 0.32)} 82%, ${mix(col, "#ffffff", 0.18)})`;
  } else {
    paint = col;
  }
  return `<span style="${box};background:${paint};opacity:${d.opacity}"></span>`;
}

function wedgeLayer(spec, d, flip) {
  const side = mirror(d.side, flip);
  const col = resolveColor(spec, d.color, spec.palette.accent);
  const clip =
    side === "right"
      ? `polygon(${d.skew}% 0, 100% 0, 100% 100%, 0 100%)`
      : `polygon(0 0, ${100 - d.skew}% 0, 100% 100%, 0 100%)`;
  return `<span style="top:0;${side}:0;width:${d.size}%;height:100%;background:linear-gradient(160deg, ${mix(
    col,
    "#ffffff",
    0.16,
  )}, ${mix(col, "#000000", 0.28)} 74%);clip-path:${clip};opacity:${d.opacity}"></span>`;
}

function gridLayer(spec, d) {
  const col = resolveColor(spec, d.color, spec.palette.fg);
  return `<span style="inset:0;opacity:${d.opacity};background-image:linear-gradient(${rgba(
    col,
    0.5,
  )} 1px, transparent 1px),linear-gradient(90deg, ${rgba(col, 0.5)} 1px, transparent 1px);background-size:${d.cell}% ${
    d.cell
  }%"></span>`;
}

function stripesLayer(spec, d) {
  const col = resolveColor(spec, d.color, spec.palette.fg);
  return `<span style="inset:0;opacity:${d.opacity};background-image:repeating-linear-gradient(${d.angle}deg, ${rgba(
    col,
    0.6,
  )} 0 1px, transparent 1px ${d.gap}%)"></span>`;
}

function frameLayer(spec, d) {
  const col = resolveColor(spec, d.color, spec.palette.fg);
  return `<span style="inset:${d.inset}%;border:${d.width}cqw solid ${rgba(col, 0.6 * d.opacity)}"></span>`;
}

function cornersLayer(spec, d) {
  const col = resolveColor(spec, d.color, spec.palette.accent);
  const arm = `${d.size}%`;
  const w = `${d.width}cqw`;
  return `<span style="inset:${d.inset}%;opacity:${d.opacity}">
      <span style="position:absolute;top:0;left:0;width:${arm};height:${arm};border-top:${w} solid ${col};border-left:${w} solid ${col}"></span>
      <span style="position:absolute;bottom:0;right:0;width:${arm};height:${arm};border-bottom:${w} solid ${col};border-right:${w} solid ${col}"></span>
    </span>`;
}

function ruleLayer(spec, d) {
  const col = resolveColor(spec, d.color, spec.palette.accent);
  // 细线从正文那一边起笔，不然会像掉在版面上的一根杂线。
  const anchor = spec.frame.align === "right" ? "right:var(--pad-r)" : "left:var(--pad-l)";
  return `<span style="${d.side}:${d.offset}%;${anchor};width:${d.length}%;height:${d.width}cqw;background:${col};opacity:${d.opacity}"></span>`;
}

function sealLayer(spec, d) {
  const col = resolveColor(spec, d.color, spec.palette.accent);
  const pos = {
    tl: "top:7%;left:7%",
    tr: "top:7%;right:7%",
    bl: "bottom:7%;left:7%",
    br: "bottom:7%;right:7%",
  }[d.corner];
  const shape =
    d.shape === "circle" ? "border-radius:50%" : d.shape === "diamond" ? "transform:rotate(45deg)" : "";
  const fill = d.filled ? `background:${col}` : `border:0.3cqw solid ${col}`;
  return `<span style="${pos};width:${d.size}%;aspect-ratio:1;${shape};${fill};opacity:${d.opacity}"></span>`;
}

/**
 * @param flip 背面镜像侧边装饰，让两面互为呼应而不是复印。
 */
export function decorHtml(spec, monogram, flip = false) {
  const layers = [];
  if (spec.surface.grain > 0) layers.push(`<span class="surf-grain"></span>`);
  if (spec.surface.vignette > 0) layers.push(`<span class="surf-vignette"></span>`);

  for (const d of spec.decor) {
    if (d.kind === "edge") layers.push(edgeLayer(spec, d, flip));
    else if (d.kind === "wedge") layers.push(wedgeLayer(spec, d, flip));
    else if (d.kind === "grid") layers.push(gridLayer(spec, d));
    else if (d.kind === "stripes") layers.push(stripesLayer(spec, d));
    else if (d.kind === "frame") layers.push(frameLayer(spec, d));
    else if (d.kind === "corners") layers.push(cornersLayer(spec, d));
    else if (d.kind === "rule") layers.push(ruleLayer(spec, d));
    else if (d.kind === "seal") layers.push(sealLayer(spec, d));
  }

  if (spec.surface.monogram > 0 && monogram) {
    layers.push(`<span class="surf-mono">${monogram}</span>`);
  }
  return layers.join("");
}

/* ---------- 人话描述：给 brief 面板和生图提示词用 ---------- */

const SIDE_ZH = { left: "左", right: "右", top: "上", bottom: "下" };
const CORNER_ZH = { tl: "左上", tr: "右上", bl: "左下", br: "右下" };

export function describeDecor(spec) {
  return spec.decor.map((d) => {
    const col = resolveColor(spec, d.color, spec.palette.accent);
    if (d.kind === "edge") {
      return d.fade
        ? `${SIDE_ZH[d.side]}沿 ${d.size.toFixed(0)}% 色晕（${col}）`
        : `${SIDE_ZH[d.side]}侧 ${d.size.toFixed(1)}% ${d.size > 12 ? "色块" : "色脊"}（${col}）`;
    }
    if (d.kind === "wedge") return `${SIDE_ZH[d.side]}侧 ${d.size.toFixed(0)}% 斜切色楔（${col}）`;
    if (d.kind === "grid") return `细网格 ${d.cell.toFixed(0)}% 间距，透明度 ${d.opacity.toFixed(2)}`;
    if (d.kind === "stripes") return `${d.angle.toFixed(0)}° 斜线纹，间距 ${d.gap.toFixed(1)}%`;
    if (d.kind === "frame") return `内凹版框，内缩 ${d.inset.toFixed(1)}%`;
    if (d.kind === "corners") return `对角角标（${col}）`;
    if (d.kind === "rule") return `${SIDE_ZH[d.side]}部 ${d.length.toFixed(0)}% 细线（${col}）`;
    if (d.kind === "seal") return `${CORNER_ZH[d.corner]}${d.shape === "circle" ? "圆" : d.shape === "diamond" ? "菱形" : "方"}印记（${col}）`;
    return "";
  }).filter(Boolean);
}

const FAMILY_ZH = { display: "Didot / 宋体（展示衬线）", serif: "宋体衬线", sans: "苹方 / Avenir 无衬线", mono: "等宽" };
const ANCHOR_ZH = { top: "偏上", center: "居中", bottom: "压底" };
const ALIGN_ZH = { left: "左对齐", center: "居中", right: "右对齐" };

export function describeSpec(spec) {
  const t = spec.type;
  const p = spec.palette;
  return {
    layout: `${spec.layoutName} · ${ALIGN_ZH[spec.frame.align]}，主体${ANCHOR_ZH[spec.frame.anchor]}${
      t.nameVertical ? `，姓名沿${SIDE_ZH[t.nameSide]}侧竖排` : ""
    }`,
    paper: spec.paper,
    palette: `底 ${p.bg}${p.bgMode !== "flat" ? ` → ${p.bg2}` : ""}　字 ${p.fg}　次 ${p.muted}　强调 ${p.accent}`,
    type: [
      `主名 ${FAMILY_ZH[t.nameFamily]}　${t.nameSize.toFixed(1)}cqw　字距 ${t.nameTrack.toFixed(2)}em　字重 ${t.nameWeight}`,
      `上排 ${t.mastheadSize.toFixed(1)}cqw　姓名下 ${t.roleSize.toFixed(1)}cqw　底栏 ${t.contactSize.toFixed(1)}cqw`,
    ],
    decor: describeDecor(spec),
    surface: [
      spec.surface.grain > 0.05 ? `纸纹 ${spec.surface.grain.toFixed(2)}` : "",
      spec.surface.vignette > 0.02 ? `暗角 ${spec.surface.vignette.toFixed(2)}` : "",
      spec.surface.monogram > 0.01 ? `背景首字水印 ${spec.surface.monogram.toFixed(2)}` : "",
      spec.surface.radius > 0.05 ? `圆角 ${spec.surface.radius.toFixed(1)}cqw` : "直角",
    ].filter(Boolean),
  };
}

/* ---------- 内置预设：六个立场的兜底规格（无 API key 也能用） ----------
 *
 * 每套一个独立色相，构图也分家。这是模板，不是工作室色谱——
 * 雪松绿 / 纸墨只锁 Web 界面，名片不受此限。
 */

const RAW_PRESETS = {
  authority: {
    id: "authority",
    name: "纪念碑",
    layoutName: "纪念碑式",
    paper: "厚棉纸，深墨，氧化金边，凹凸印的感觉",
    palette: { bg: "#100e0c", bg2: "#2a241c", bgMode: "radial", fg: "#f4ead7", muted: "#b9a78a", accent: "#c4a574" },
    surface: { grain: 0.28, vignette: 0.22, monogram: 0.06 },
    frame: { align: "left", anchor: "center", pad: { t: 8, r: 8, b: 7, l: 9 } },
    type: {
      nameFamily: "display", nameSize: 9.4, nameTrack: 0.16, nameWeight: 600,
      mastheadSize: 2.5, mastheadTrack: 0.22, roleSize: 2.7, roleTrack: 0.1,
      roleColor: "accent", contactSize: 2.5, contactAlign: "right", mastheadColor: "muted",
    },
    decor: [
      { kind: "edge", side: "left", size: 2.6, color: "#b08942", gradient: true },
      { kind: "corners", inset: 3.2, size: 9, width: 0.45, color: "accent" },
    ],
    copy: { maxUnder: 1, maxContacts: 2, contactStyle: "bare" },
  },
  credible: {
    id: "credible",
    name: "文件脊",
    layoutName: "文件脊",
    paper: "本白无涂布，左侧色脊，胶印",
    palette: { bg: "#ebe3d4", bg2: "#f7f2e8", bgMode: "linear", bgAngle: 0, fg: "#1b2428", muted: "#5c6a70", accent: "#2f5d62" },
    surface: { grain: 0.24 },
    frame: { align: "left", anchor: "center", pad: { t: 7, r: 7, b: 6, l: 11.5 } },
    type: {
      nameFamily: "sans", nameSize: 7.6, nameTrack: 0.18, nameWeight: 500,
      mastheadSize: 2.6, mastheadTrack: 0.28, roleSize: 2.85, roleTrack: 0.1,
      contactSize: 2.6, contactAlign: "left",
    },
    decor: [{ kind: "edge", side: "left", size: 6.4, color: "accent", gradient: true }],
    copy: { maxUnder: 2, maxContacts: 3, contactStyle: "row" },
  },
  ambitious: {
    id: "ambitious",
    name: "切角推进",
    layoutName: "切角推进",
    paper: "深海军，硬橙几何切角，细网格",
    palette: { bg: "#0a0d12", bg2: "#141821", bgMode: "linear", bgAngle: 315, fg: "#f6f5f1", muted: "#b8b6b0", accent: "#e85d04" },
    surface: { grain: 0.22 },
    frame: { align: "left", anchor: "center", pad: { t: 7.5, r: 24, b: 6.5, l: 7.5 } },
    type: {
      nameFamily: "sans", nameSize: 8.4, nameTrack: 0.08, nameWeight: 600,
      mastheadSize: 2.45, mastheadTrack: 0.24, roleSize: 2.75, roleTrack: 0.14,
      roleColor: "accent", contactSize: 2.5, contactAlign: "left",
    },
    decor: [
      { kind: "grid", cell: 8, opacity: 0.12, color: "fg" },
      { kind: "wedge", side: "right", size: 22, skew: 38, color: "accent" },
    ],
    copy: { maxUnder: 2, maxContacts: 3, contactStyle: "bare" },
  },
  warm: {
    id: "warm",
    name: "请柬",
    layoutName: "请柬式",
    paper: "暖米色，下沿色晕，柔和圆角",
    palette: { bg: "#f6eee3", bg2: "#f6eee3", bgMode: "flat", fg: "#3b2a1f", muted: "#7a5c4a", accent: "#a65d3f" },
    surface: { grain: 0.2, radius: 1.4 },
    frame: { align: "center", anchor: "center", pad: { t: 8, r: 8, b: 8, l: 8 } },
    type: {
      nameFamily: "display", nameSize: 8.8, nameTrack: 0.16, nameWeight: 500,
      mastheadSize: 2.5, mastheadTrack: 0.22, roleSize: 2.85, roleTrack: 0.1,
      contactSize: 2.65, contactAlign: "center", ornament: true,
    },
    decor: [{ kind: "edge", side: "bottom", size: 30, color: "accent", fade: true, opacity: 0.42 }],
    copy: { maxUnder: 1, maxContacts: 1, contactStyle: "bare" },
  },
  quiet: {
    id: "quiet",
    name: "印版留白",
    layoutName: "印版留白",
    paper: "纯白，内凹版痕，几乎无装饰",
    palette: { bg: "#fbfbfb", bg2: "#fbfbfb", bgMode: "flat", fg: "#111111", muted: "#6a6a6a", accent: "#111111" },
    surface: { grain: 0.16 },
    frame: { align: "left", anchor: "center", pad: { t: 9, r: 9, b: 9, l: 9 } },
    type: {
      nameFamily: "sans", nameSize: 6.6, nameTrack: 0.22, nameWeight: 400,
      mastheadSize: 2.4, mastheadTrack: 0.26, roleSize: 2.7, roleTrack: 0.1,
      contactSize: 2.5, contactAlign: "left",
    },
    decor: [{ kind: "frame", inset: 4.2, width: 0.35, color: "fg", opacity: 0.9 }],
    copy: { maxUnder: 1, maxContacts: 2, contactStyle: "bare" },
  },
  creative: {
    id: "creative",
    name: "色块对切",
    layoutName: "色块对切",
    paper: "亚麻底，左侧色块，姓名竖排",
    palette: { bg: "#ece6d8", bg2: "#ece6d8", bgMode: "flat", fg: "#161616", muted: "#5a5248", accent: "#5b2d8e" },
    surface: { grain: 0.3 },
    frame: { align: "left", anchor: "center", pad: { t: 7, r: 7, b: 7, l: 34 } },
    type: {
      nameFamily: "serif", nameSize: 6.4, nameTrack: 0.14, nameWeight: 500,
      nameVertical: true, nameSide: "left", nameColor: "#f4ead7",
      mastheadSize: 2.5, mastheadTrack: 0.24, roleSize: 3.0, roleTrack: 0.1,
      contactSize: 2.55, contactAlign: "left",
    },
    decor: [{ kind: "edge", side: "left", size: 29, color: "accent", gradient: true }],
    copy: { maxUnder: 2, maxContacts: 2, contactStyle: "stack" },
  },
};

export const PRESETS = Object.fromEntries(
  Object.entries(RAW_PRESETS).map(([k, v]) => [k, sanitizeSpec(v, k)]),
);

export function presetFor(stanceId) {
  return PRESETS[stanceId] || PRESETS.credible;
}
