/**
 * 身份档案：一份人物料 + 多份「这场相遇」方案。
 * 只给产品版首页用。工作室 studio.html 走自己的 atelier 档案。
 * 存取经 store.js：登录用户一人一份存服务器，localStorage 只做缓存。
 */

import { AUDIENCES, EMPTY_PROFILE, PURPOSES, SCENES, STAGES } from "./data.js";
import { sanitizeSpec } from "./style-spec.js";
import { loadStore, saveStore } from "./store.js";

export const ARCHIVE_KEY = "identity.flow.v1";

const byId = (list, id) => list.find((x) => x.id === id) || null;

export function blankArchive() {
  return {
    profile: { ...EMPTY_PROFILE },
    schemes: [],
    activeId: "",
  };
}

export function newScheme(over = {}) {
  return {
    id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    scene: "",
    purpose: "",
    audience: "",
    stage: "",
    custom: { audience: "", scene: "", purpose: "", stage: "" },
    brief: null,
    styleSpec: null,
    candidates: [],
    paletteDraw: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...over,
  };
}

export function labelOf(list, id, custom) {
  if (id === "other") return (custom || "").trim() || "其他";
  return byId(list, id)?.label || "";
}

export function schemeTitle(scheme) {
  const parts = [
    labelOf(SCENES, scheme.scene, scheme.custom?.scene),
    labelOf(PURPOSES, scheme.purpose, scheme.custom?.purpose),
    labelOf(AUDIENCES, scheme.audience, scheme.custom?.audience),
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "未命名相遇";
}

export function questionsFilled(scheme) {
  return ["scene", "purpose", "audience", "stage"].filter((k) => scheme[k]).length;
}

/** 产品版的 compose() 输入：档案里的人物料 + 当前方案。 */
export function toComposeState(archive, scheme) {
  const s = scheme || archive.schemes.find((x) => x.id === archive.activeId) || newScheme();
  return {
    scene: s.scene,
    purpose: s.purpose,
    audience: s.audience,
    stage: s.stage,
    stanceOverride: "",
    custom: { ...s.custom },
    edits: { masthead: "", role: "", pitch: "", backMode: "" },
    profile: { ...EMPTY_PROFILE, ...archive.profile },
    brief: s.brief,
    styleSpec: s.styleSpec,
    candidates: s.candidates || [],
  };
}

export async function loadArchive() {
  try {
    const parsed = await loadStore(ARCHIVE_KEY);
    if (!parsed) return blankArchive();
    const profile = { ...EMPTY_PROFILE, ...(parsed.profile || {}) };
    const schemes = Array.isArray(parsed.schemes)
      ? parsed.schemes.map((s) => ({
          ...newScheme(),
          ...s,
          custom: { audience: "", scene: "", purpose: "", stage: "", ...(s.custom || {}) },
          styleSpec: s.styleSpec ? sanitizeSpec(s.styleSpec, s.styleSpec.id) : null,
          candidates: Array.isArray(s.candidates)
            ? s.candidates.map((c, i) => sanitizeSpec(c, c?.id || `saved-${i}`))
            : [],
          paletteDraw: Array.isArray(s.paletteDraw) ? s.paletteDraw : [],
        }))
      : [];
    const activeId = schemes.some((s) => s.id === parsed.activeId) ? parsed.activeId : schemes[0]?.id || "";
    return { profile, schemes, activeId };
  } catch {
    return blankArchive();
  }
}

export function saveArchive(archive) {
  saveStore(ARCHIVE_KEY, archive);
}