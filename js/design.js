/**
 * 排版层：把设计稿（brief）放进视觉规格（spec）的版面约束里。
 *
 * 「什么字上卡、为什么」已经由 brief.js 决定（规则草稿或大模型）；
 * 视觉本身由 style-spec.js 决定（内置预设或大模型）。这一层只做两者的仲裁：
 * 场合的信息密度、规格的条目上限、以及被版面挤掉的条目要记进「不上卡」。
 */

import { describeSpec, presetFor, sanitizeSpec } from "./style-spec.js";

/** 正文区宽度，和 CSS 的 cqw 同一刻度（左右 pad 是百分比）。 */
export function faceWidthCqw(spec) {
  const p = spec.frame.pad;
  return Math.max(18, 100 - p.l - p.r);
}

/**
 * 二维码贴上后占掉底栏一角的宽度，和 CSS 的让位 margin 同一刻度。
 * 没贴图时前端不渲染，排版约束也当它不存在。
 */
export function qrReserveCqw(spec, profile = {}) {
  if (!spec.qr?.show || !profile?.qrImage) return 0;
  return spec.qr.size + 5;
}

/**
 * 90×54 上 padding 百分比相对的是宽度，换成 cqh 要乘宽高比。
 * 用来检查「这套字号 + 这些条目」会不会在卡面上叠在一起。
 */
const CARD_AR = 90 / 54;

export function faceHeightCqh(spec) {
  const p = spec.frame.pad;
  return Math.max(28, 100 - (p.t + p.b) * CARD_AR);
}

function lineCqh(sizeCqw, leading) {
  return sizeCqw * CARD_AR * leading;
}

/** 设计稿按这套规格排完之后，正文实际占用的高度（不含页边）。 */
export function usedContentCqh(design, profile = {}) {
  const spec = design.spec;
  const t = spec.type;
  let h = 0;
  if (design.top.length) h += lineCqh(t.mastheadSize, 1.45) + 1;
  if (!t.nameVertical) h += lineCqh(t.nameSize, t.nameLeading || 1.35) + 1.8;
  if (design.showNameEn && profile.nameEn?.trim()) h += 4.2;
  if (t.ornament) h += 5.2;
  h += design.under.length * (lineCqh(t.roleSize, t.roleLeading || 1.42) + 2.8);
  if (spec.copy.contactStyle === "stack") {
    h += Math.max(0, design.contacts.length) * (lineCqh(t.contactSize, 1.35) + 0.8);
  } else if (design.contacts.length) {
    h += lineCqh(t.contactSize, 1.35) + (spec.copy.contactStyle === "row" ? 2.2 : 0.8);
  }
  return h;
}

/**
 * 印制规则：过不了就不该拿给用户看（叠字、裁字、省略号、超出版心）。
 * 清洗器只夹数值；这一层看排完之后的卡面。
 */
export function printIssues(design, profile = {}) {
  const spec = design.spec;
  const t = spec.type;
  const issues = [];
  const texts = [
    ...(profile.name ? [profile.name] : []),
    ...design.top.map((x) => x.label),
    ...design.under.map((x) => x.label),
    ...design.contacts.map((c) => c.value),
  ];
  for (const s of texts) {
    if (/\.\.\.|…/.test(s)) issues.push("卡面出现省略号");
  }
  if ((t.nameLeading || 0) < 1.28) issues.push("姓名行高过紧，字会被裁");
  if ((t.roleLeading || 0) < 1.28) issues.push("头衔行高过紧，字会被裁");
  if (t.nameFamily !== "sans" && t.nameTrack > 0.181) issues.push("姓名字距过大，会缺笔");
  if (t.roleTrack > 0.121) issues.push("头衔字距过大，会缺笔");

  const usable = faceWidthCqw(spec);
  const name = (profile.name || "").trim();
  if (name && !t.nameVertical && lineWidthCqw(name, t.nameSize, t.nameTrack) > usable) {
    issues.push("姓名超出版宽");
  }
  for (const row of design.top) {
    if (lineWidthCqw(row.label, t.mastheadSize, t.mastheadTrack) > usable) issues.push("上排超出版宽");
  }
  const underLine = design.under.map((x) => x.label).join("  ·  ");
  if (underLine && lineWidthCqw(underLine, t.roleSize, t.roleTrack) > usable) {
    issues.push("姓名下超出版宽");
  }
  if (spec.copy.contactStyle === "stack") {
    const usableBottom = usable - qrReserveCqw(spec, profile);
    for (const c of design.contacts) {
      if (lineWidthCqw(c.value, t.contactSize) > usableBottom) issues.push("底栏有一条超出版宽");
    }
  } else if (design.contacts.length) {
    const gap = 1.6;
    const used =
      design.contacts.reduce((sum, c) => sum + lineWidthCqw(c.value, t.contactSize), 0) +
      Math.max(0, design.contacts.length - 1) * gap;
    if (used > usable - qrReserveCqw(spec, profile) + 0.05) issues.push("底栏一行超出版宽");
  }

  if (usedContentCqh(design, profile) > faceHeightCqh(spec)) {
    issues.push("上排、姓名、头衔和底栏在 90×54 上叠在一起");
  }
  return [...new Set(issues)];
}

/** 底栏一行的占宽。拉丁字母按窄字估计，宁可少放一条，不许用省略号。 */
export function lineWidthCqw(text, sizeCqw, trackEm = 0.06) {
  let w = 0;
  for (const ch of String(text)) {
    const wide = ch.charCodeAt(0) > 0x2e7f;
    w += sizeCqw * (wide ? 1.02 : 0.62) * (1 + trackEm);
  }
  return w;
}

/**
 * 按这套规格的左右留白和字号，决定底栏实际能印几条。
 * 条目上限只是上限；一行排不下就从后面拿掉，记进不上卡。
 */
export function fitPrintedContacts(contacts, spec, reserveCqw = 0) {
  const list = Array.isArray(contacts) ? contacts.slice(0, spec.copy.maxContacts) : [];
  const rest = Array.isArray(contacts) ? contacts.slice(spec.copy.maxContacts) : [];
  const size = spec.type.contactSize;
  const usable = faceWidthCqw(spec) - reserveCqw;
  const gap = 1.6;
  const kept = [];
  const overflow = [...rest];

  if (spec.copy.contactStyle === "stack") {
    for (const c of list) {
      if (lineWidthCqw(c.value, size) <= usable) kept.push(c);
      else overflow.push(c);
    }
  } else {
    let used = 0;
    for (const c of list) {
      const w = lineWidthCqw(c.value, size);
      const extra = kept.length ? gap : 0;
      if (used + extra + w <= usable) {
        kept.push(c);
        used += extra + w;
      } else {
        overflow.push(c);
      }
    }
  }

  if (!kept.length && list.length) {
    const first = overflow.indexOf(list[0]);
    if (first >= 0) overflow.splice(first, 1);
    kept.push(list[0]);
  }
  return { kept, overflow };
}

/** 姓名下一行按版宽裁切，避免「商务负责人…」这种印不出去的省略。 */
export function fitPrintedLine(labels, sizeCqw, trackEm, spec, joiner = "  ·  ") {
  const list = Array.isArray(labels) ? labels : [];
  const usable = faceWidthCqw(spec);
  const kept = [];
  for (const label of list) {
    const trial = [...kept, label].join(joiner);
    if (lineWidthCqw(trial, sizeCqw, trackEm) <= usable) kept.push(label);
    else break;
  }
  if (!kept.length && list.length) kept.push(list[0]);
  return { kept, overflow: list.slice(kept.length) };
}

/** 场合的信息密度会覆盖规格里的条目上限：饭桌上字多等于没人看。 */
function densityCap(spec, scene) {
  const d = scene?.density ?? 0.55;
  const copy = { ...spec.copy };
  const type = { ...spec.type };

  if (d < 0.45) {
    copy.maxUnder = 1;
    copy.maxContacts = Math.min(copy.maxContacts, 1);
  } else if (d > 0.68) {
    copy.maxUnder = Math.min(copy.maxUnder, 2);
    if (!type.nameVertical) type.nameSize = Math.min(12.5, type.nameSize * 1.1);
  }
  return { ...spec, copy, type };
}

/** 采纳过的大模型规格优先；否则回落到立场对应的内置预设。 */
export function resolveSpec(identity, state) {
  const adopted = state?.styleSpec;
  if (adopted && typeof adopted === "object") {
    return { spec: sanitizeSpec(adopted, adopted.id || "llm"), source: "llm" };
  }
  return { spec: presetFor(identity.stanceId), source: "preset" };
}

export function designCard(identity, state, override) {
  const brief = identity.brief;
  const profile = state.profile || {};
  const edits = state.edits || {};
  const resolved = override
    ? { spec: sanitizeSpec(override, override.id || "llm"), source: "llm" }
    : resolveSpec(identity, state);
  const spec = densityCap(resolved.spec, identity.scene);

  const masthead = (edits.masthead ?? "").trim() || brief.masthead;
  const top = masthead ? [{ label: masthead }] : [];

  // 手改的职能覆盖设计稿的第一条；其余标签按规格上限截断。
  const underAll = brief.under.map((u) => u.label);
  const editedRole = (edits.role ?? "").trim();
  if (editedRole) underAll[0] = editedRole;
  const fittedUnder = fitPrintedLine(
    underAll.slice(0, spec.copy.maxUnder),
    spec.type.roleSize,
    spec.type.roleTrack,
    spec,
  );
  const under = fittedUnder.kept.map((label) => ({ label }));
  const fitted = fitPrintedContacts(brief.contacts, spec, qrReserveCqw(spec, profile));
  const contacts = fitted.kept;

  // 设计稿主动拿掉的，加上被这套版面挤掉的，一起对用户交代。
  const omitted = [...brief.omitted];
  for (const label of [...underAll.slice(spec.copy.maxUnder), ...fittedUnder.overflow]) {
    omitted.push({ label, reason: "这套版面的姓名下排不下，主身份优先" });
  }
  for (const c of fitted.overflow) {
    omitted.push({
      label: c.label,
      reason: spec.copy.contactStyle === "stack" ? "这条联系方式比底栏更长，不上卡" : "这套版面底栏一行排不下，主通道优先",
    });
  }

  const described = describeSpec(spec);

  return {
    spec,
    source: resolved.source,
    briefSource: brief.source,
    top,
    under,
    showNameEn: brief.showNameEn && Boolean(profile.nameEn?.trim()),
    backTags: brief.backTags,
    contacts,
    omitted,
    contactStyle: spec.copy.contactStyle,
    monogram: (profile.name || "名").trim().slice(0, 1),
    described,
    typeNote: described.type,
    layoutNote: `${described.layout} · ${spec.paper}`,
  };
}
