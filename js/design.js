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
export function fitPrintedContacts(contacts, spec) {
  const list = Array.isArray(contacts) ? contacts.slice(0, spec.copy.maxContacts) : [];
  const rest = Array.isArray(contacts) ? contacts.slice(spec.copy.maxContacts) : [];
  const size = spec.type.contactSize;
  const usable = faceWidthCqw(spec);
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
  const under = underAll.slice(0, spec.copy.maxUnder).map((label) => ({ label }));
  const fitted = fitPrintedContacts(brief.contacts, spec);
  const contacts = fitted.kept;

  // 设计稿主动拿掉的，加上被这套版面挤掉的，一起对用户交代。
  const omitted = [...brief.omitted];
  for (const label of underAll.slice(spec.copy.maxUnder)) {
    omitted.push({ label, reason: "这套版面的姓名下只放得下前几条" });
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
