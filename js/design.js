/**
 * 排版层：把设计稿（brief）放进视觉规格（spec）的版面约束里。
 *
 * 「什么字上卡、为什么」已经由 brief.js 决定（规则草稿或大模型）；
 * 视觉本身由 style-spec.js 决定（内置预设或大模型）。这一层只做两者的仲裁：
 * 场合的信息密度、规格的条目上限、以及被版面挤掉的条目要记进「不上卡」。
 */

import { describeSpec, presetFor, sanitizeSpec } from "./style-spec.js";

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
  const contacts = brief.contacts.slice(0, spec.copy.maxContacts);

  // 设计稿主动拿掉的，加上被这套版面挤掉的，一起对用户交代。
  const omitted = [...brief.omitted];
  for (const label of underAll.slice(spec.copy.maxUnder)) {
    omitted.push({ label, reason: "这套版面的姓名下只放得下前几条" });
  }
  for (const c of brief.contacts.slice(spec.copy.maxContacts)) {
    omitted.push({ label: c.label, reason: "超出这套版面的底栏容量，主通道优先" });
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
