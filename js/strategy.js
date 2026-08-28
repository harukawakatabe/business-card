/**
 * 策略层：把四个问题的答案解成一次具体相遇，然后交给设计稿。
 *
 * 这一层不再决定「什么字上卡」——那是设计稿（brief.js）的事，可能出自规则草稿，
 * 也可能出自大模型。这里只做三件事：解析四维、算出兜底立场、给出提醒与完成度。
 */

import { AUDIENCES, PURPOSES, SCENES, STAGES, STANCES } from "./data.js";
import { draftBrief, sanitizeBrief } from "./brief.js";
import { designCard } from "./design.js";

const byId = (list, id) => list.find((x) => x.id === id) || null;

function resolve(list, id, customText) {
  const found = byId(list, id);
  if (found) return found;
  if (id === "other") {
    return {
      id: "other",
      label: (customText || "").trim() || "其他",
      hint: "",
      cares: ["被正确看见"],
      formality: 0.6,
      density: 0.55,
      energy: 0.5,
      stealth: false,
      company: "optional",
    };
  }
  return null;
}

const argmax = (scores) => {
  let best = "credible";
  let n = -Infinity;
  for (const [k, v] of Object.entries(scores)) {
    if (v > n) {
      n = v;
      best = k;
    }
  }
  return best;
};

/** 兜底立场：没有大模型设计稿时用它，有设计稿时它只是模型的对照与默认值。 */
function pickStance(audience, scene, purpose, stage) {
  const scores = {
    authority: 0,
    credible: 1.2,
    ambitious: 0,
    warm: 0,
    quiet: 0.2,
    creative: 0,
  };

  if (purpose?.id === "negotiate") scores.authority += 3.2;
  if (audience?.id === "institution") scores.authority += 2.4;
  if (audience?.id === "vendor") scores.authority += 0.8;
  if (scene?.id === "visit" && purpose?.id === "deal") scores.authority += 0.6;

  if (purpose?.id === "fundraise" || audience?.id === "investor") {
    scores.ambitious += 3.1;
  }
  if (purpose?.id === "job") scores.credible += 1.4;
  if (audience?.id === "recruiter" || audience?.id === "client") {
    scores.credible += 1.6;
  }
  if (scene?.id === "interview") scores.credible += 1.2;
  if (scene?.id === "visit") scores.credible += 0.8;

  if (scene?.id === "banquet" || scene?.id === "salon") scores.warm += 2.2;
  if (purpose?.id === "network") scores.warm += 2.0;
  if (audience?.id === "peer") scores.warm += 0.6;

  if (stage?.id === "stealth") scores.quiet += 4.5;
  if (stage?.id === "transition") scores.quiet += 1.4;
  if (purpose?.id === "negotiate") scores.quiet += 0.8;
  if (audience?.id === "institution") scores.quiet += 0.4;

  if (audience?.id === "peer" && (scene?.id === "salon" || scene?.id === "conference")) {
    scores.creative += 2.2;
  }
  if (audience?.id === "media") scores.creative += 1.6;
  if (purpose?.id === "authority" && audience?.id === "peer") scores.creative += 1.1;

  if (stage?.id === "founder" && purpose?.id === "fundraise") scores.ambitious += 1.2;
  if (stage?.id === "independent") scores.quiet += 0.7;

  return argmax(scores);
}

function companyPolicy(stage, purpose, audience) {
  if (!stage) return "optional";
  if (stage.company === "hide") return "hide";
  if (stage.company === "past") return "past";
  if (stage.company === "careful") {
    if (purpose?.id === "job" || audience?.id === "recruiter") return "hide";
    return "optional";
  }
  if (stage.stealth) return "hide";
  return "show";
}

function showPhoto({ scene, stance, hasPortrait }) {
  if (!hasPortrait) return false;
  if (scene?.id === "visit" || scene?.id === "interview") return false;
  if (stance === "authority" || stance === "quiet" || stance === "credible") return false;
  return stance === "creative";
}

function rationale(ctx, brief, stanceId) {
  const { audience, scene, purpose, stage, companyMode } = ctx;
  const stance = STANCES[stanceId];
  const lines = [];

  if (brief.read) {
    lines.push(`${brief.read}立场取「${stance.label}」：${brief.stanceWhy || stance.blurb}`);
  } else {
    lines.push("四个问题答得越完整，形象会从「通用商务」收成一次具体相遇的设计。");
  }

  if (stage?.stealth) {
    lines.push("你在职且不想暴露动向：现公司不印，工作邮箱慎用，名片看起来像独立专业人士。");
  } else if (companyMode === "hide") {
    lines.push("这一段不宜把组织写死在卡上。让头衔或一句定位承担身份，组织留给口头。");
  } else if (companyMode === "past") {
    lines.push("求职已公开：过往组织可以「曾任」出现，但不要印成你还在替他们说话。");
  } else if (companyMode === "show" && stage?.id === "founder") {
    lines.push("创始人的脸就是公司的脸。名字与组织同框，别把卡做成个人作品集封面。");
  } else if (audience && scene) {
    lines.push(`${scene.label}的阅读时间很短。卡上只留对方在乎的抓手：${audience.cares.join("、")}。`);
  }

  if (brief.contactWhy) {
    lines.push(brief.contactWhy);
  } else if (scene && scene.density < 0.45) {
    lines.push(
      `这个场合信息要少。联系方式只留 ${brief.contacts.map((c) => c.label).join("、") || "最容易加的一条"}，背面用一句定位，不放履历。`,
    );
  } else if (purpose?.id === "negotiate") {
    lines.push("谈判场合避免亲昵。邮件优先于微信，语气对等，不写口号。");
  }

  return lines.slice(0, 3);
}

function warnings(ctx, brief) {
  const { stage, purpose, profile } = ctx;
  const w = [];
  if (stage?.stealth && brief.contacts.some((c) => c.key === "email")) {
    w.push("请确认这是私人邮箱。在职看机会时，印工作邮箱等于把动向交给现东家。");
  }
  if (stage?.stealth && ctx.companyMode === "hide" && profile.company?.trim()) {
    w.push("现公司已从卡面拿掉，口头介绍时也建议先用职能，不要主动报工牌。");
  }
  if (purpose?.id === "job" && profile.pitch?.includes("求职")) {
    w.push("定位里不要写「求职」。对方看到的应是一个值得被邀请的人，不是一张请愿。");
  }
  if (!profile.name?.trim()) {
    w.push("还没有名字。策略可以先看，打印前至少补上姓名和一条联系方式。");
  }
  return w;
}

export function completeness(state) {
  const keys = ["scene", "purpose", "audience", "stage"];
  const filled = keys.filter((k) => state[k]).length;
  const named = Boolean(state.profile?.name?.trim());
  const contact = ["wechat", "phone", "email"].some((k) => state.profile?.[k]?.trim());
  return { questions: filled, questionsTotal: 4, named, contact, readyToPrint: named && contact && filled === 4 };
}

/** 设计稿的上下文：解析后的四维 + 资料 + 组织策略 + 兜底立场。两个来源共用。 */
export function briefContext(state) {
  const custom = state.custom || {};
  const scene = resolve(SCENES, state.scene, custom.scene);
  const purpose = resolve(PURPOSES, state.purpose, custom.purpose);
  const audience = resolve(AUDIENCES, state.audience, custom.audience);
  const stage = resolve(STAGES, state.stage, custom.stage);
  const profile = state.profile || {};
  return {
    profile,
    scene,
    purpose,
    audience,
    stage,
    companyMode: companyPolicy(stage, purpose, audience),
    stanceFallback: pickStance(audience, scene, purpose, stage),
  };
}

export function compose(state) {
  const ctx = briefContext(state);
  const brief = state.brief
    ? sanitizeBrief(state.brief, ctx, state.brief.id || "llm")
    : draftBrief(ctx);

  const stanceId = state.stanceOverride || brief.stance;
  const stance = STANCES[stanceId] || STANCES.credible;
  const pitch = state.edits?.pitch?.trim() || brief.back.pitch;

  // 背面内容模式：工作室手动切换 > 设计稿决定。英文版没有英文名就回落相遇故事。
  const backModeReq = state.edits?.backMode || brief.backMode;
  const backMode = backModeReq === "en" && ctx.profile.nameEn?.trim() ? "en" : "pitch";
  const backEn = {
    ...brief.backEn,
    name: brief.backEn?.name || ctx.profile.nameEn?.trim() || "",
    cta: brief.backEn?.cta || (backMode === "en" ? "Keep in touch" : ""),
  };

  const identity = {
    ...ctx,
    brief,
    stanceId,
    stance,
    contacts: brief.contacts,
    pitch,
    derivedPitch: brief.back.pitch,
    cta: brief.back.cta,
    showPortrait: showPhoto({ scene: ctx.scene, stance: stanceId, hasPortrait: Boolean(ctx.profile.portrait) }),
    back: { kicker: brief.back.kicker, pitch, cta: brief.back.cta },
    backMode,
    backEn,
    rationale: rationale(ctx, brief, stanceId),
    warnings: warnings(ctx, brief),
    completeness: completeness(state),
  };
  identity.design = designCard(identity, state);
  return identity;
}
