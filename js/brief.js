/**
 * 名片设计稿（brief）——「什么字上卡、为什么」的唯一契约。
 *
 * 和视觉规格 spec 一样是双来源单契约：
 *   - draftBrief()  规则草稿，没有 API key 也能出，同时充当大模型的兜底与对照。
 *   - 大模型        llm.js#requestBrief 按同一份 schema 吐一份，经 sanitizeBrief() 清洗后等价可用。
 *
 * 下游（design.js / render-card.js / prompts.js / 视觉那一段的 LLM）只认这份契约，
 * 不关心它是规则算出来的还是模型写的。
 *
 * sanitizeBrief() 是防线：文字限长、联系方式必须是用户真填过的字段（模型不许编号码）、
 * 组织在该藏的时候藏住、卡面不许出现请愿句。
 */

import { CONTACT_KEYS, CONTACT_LABELS, STANCES } from "./data.js";

const STANCE_IDS = Object.keys(STANCES);

/** 名片是被递出去的身份，不是请愿书。这些词出现在卡面文案里一律剔除。 */
const PLEA = /求职|找工作|找下家|求贤|待业|失业|寻求机会|谋职|求推荐|求内推|招聘我/;

function text(v, max, dflt = "") {
  if (typeof v !== "string") return dflt;
  const s = v.replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : dflt;
}

/** 卡面文案专用：请愿句一律不印，退回默认值（没有默认值就留白）。 */
function cardText(v, max, dflt = "") {
  const s = text(v, max, "");
  if (s && !PLEA.test(s)) return s;
  return PLEA.test(dflt) ? "" : dflt;
}

function list(v) {
  return Array.isArray(v) ? v : [];
}

export function splitTags(raw) {
  return String(raw || "")
    .split(/[,，、;；|/／]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 用户真填过的联系方式，按固定顺序。模型只能从这里挑 key。 */
export function availableContacts(profile) {
  return CONTACT_KEYS.filter((k) => profile?.[k]?.trim()).map((k) => ({
    key: k,
    label: CONTACT_LABELS[k],
    value: profile[k].trim(),
  }));
}

function stripOrg(role, org) {
  if (!role || !org || !role.includes(org)) return role;
  return role
    .replace(org, "")
    .replace(/[·•｜|／/\-—]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function leaksResume(s, ctx) {
  const age = String(ctx.profile?.age || "").trim();
  const years = String(ctx.profile?.years || "").trim();
  if (age && (s.includes(`${age}岁`) || s.includes(`年龄${age}`))) return true;
  if (years && (s.includes(`${years}年`) || s.includes(`从业${years}`))) return true;
  return false;
}

/* ---------- 清洗 ---------- */

export function sanitizeBrief(raw, ctx, fallbackId = "llm") {
  const src = raw && typeof raw === "object" ? raw : {};
  const available = availableContacts(ctx.profile);
  const byKey = new Map(available.map((c) => [c.key, c]));
  const company = ctx.profile?.company?.trim() || "";

  let masthead = cardText(src.masthead, 24);
  // 组织该藏的时候藏住：这一条比模型的判断优先。
  if (masthead && company && ctx.companyMode !== "show" && masthead.includes(company)) masthead = "";

  const under = [];
  for (const item of list(src.under)) {
    const label = cardText(item?.label ?? item, 20);
    if (!label || under.some((u) => u.label === label)) continue;
    under.push({ label: stripOrg(label, masthead) || label, why: text(item?.why, 40) });
    if (under.length >= 3) break;
  }

  const contacts = [];
  for (const item of list(src.contacts)) {
    const key = typeof item === "string" ? item : item?.key;
    const found = byKey.get(key);
    if (!found || contacts.some((c) => c.key === key)) continue;
    contacts.push({ ...found, why: text(item?.why, 40) });
    if (contacts.length >= 4) break;
  }

  const hasNameEn = Boolean(ctx.profile?.nameEn?.trim());
  const back = src.back && typeof src.back === "object" ? src.back : {};
  const backTags = [];
  for (const item of list(src.backTags)) {
    const label = cardText(item?.label ?? item, 20);
    if (label && !backTags.some((b) => b.label === label)) backTags.push({ label });
    if (backTags.length >= 3) break;
  }
  const omitted = list(src.omitted)
    .map((o) => ({ label: text(o?.label, 20), reason: text(o?.reason, 44) }))
    .filter((o) => o.label && o.reason)
    .slice(0, 6);

  const omitEn = omitted.some((o) => /英文名|english/i.test(o.label));
  const askedEn = typeof src.showNameEn === "boolean" ? src.showNameEn : !omitEn;

  return {
    id: text(src.id, 24, fallbackId),
    source: "llm",
    read: text(src.read, 70),
    stance: STANCE_IDS.includes(src.stance) ? src.stance : ctx.stanceFallback,
    stanceWhy: text(src.stanceWhy, 60),
    masthead,
    mastheadWhy: text(src.mastheadWhy, 40),
    // 没填英文名时无论模型说什么都是 false。omitted 写了英文名，也按不上卡处理。
    showNameEn: hasNameEn && askedEn && !omitEn,
    under: under.filter((u) => !leaksResume(u.label, ctx)),
    contacts,
    contactWhy: text(src.contactWhy, 50),
    back: {
      kicker: text(back.kicker, 8, "相见"),
      pitch: cardText(back.pitch, 40, "把这次相遇，收成一个可以继续的理由。"),
      cta: text(back.cta, 20, contacts[0] ? `请通过${contacts[0].label}联系` : "保持联系"),
    },
    backTags: backTags.filter((b) => !leaksResume(b.label, ctx)),
    omitted,
    offstage: list(src.offstage)
      .map((s) => text(s, 70))
      .filter(Boolean)
      .slice(0, 4),
    tone: text(src.tone, 90),
  };
}

/* ---------- 规则草稿：没有 key 时的设计稿，也是模型的对照组 ---------- */

const PITCH = {
  "job|recruiter": "把复杂问题收成一条可执行的路径。",
  "job|client": "用交付能力证明下一段合作值得开始。",
  "deal|client": "让下一次见面发生在这张卡被翻出来的时候。",
  "deal|partner": "把互补说清楚，把下一步留在桌上。",
  "partner|partner": "我带来一块拼图，也在找另一块。",
  "fundraise|investor": "一个还在往前走的局，欢迎你进来看。",
  "network|peer": "同路人，留一个以后能叫上的名字。",
  "network|client": "先成为你记得住的人，再谈事。",
  "negotiate|client": "对等、清楚、可继续谈。",
  "negotiate|institution": "身份对口，联系可存档。",
  "authority|peer": "以后提到这件事，会想起这个名字。",
  "authority|media": "一个可以被准确引用的身份。",
  "deal|vendor": "决策人在此，边界也在此。",
};

function draftPitch(ctx) {
  const { profile, purpose, audience, scene, stage } = ctx;
  if (profile.pitch?.trim()) return profile.pitch.trim();
  const keyed = PITCH[`${purpose?.id || ""}|${audience?.id || ""}`];
  if (keyed) return keyed;
  if (stage?.id === "stealth") return "专业的人，用私人方式被找到。";
  if (scene?.id === "banquet") return "先记住这个名字。";
  if (purpose?.id === "deal") return "把合作推进到下一步。";
  if (purpose?.id === "network") return "留一个以后用得上的联系。";
  return "把这次相遇，收成一个可以继续的理由。";
}

function draftRole(ctx) {
  const { profile, purpose, stage, companyMode } = ctx;
  const title = profile.title?.trim() || "";
  if (title) return title;
  if (stage?.id === "independent") return purpose?.id === "job" ? "独立专业人士" : "独立顾问";
  if (stage?.id === "founder") return "创始人";
  if (companyMode === "hide") return profile.city?.trim() ? `${profile.city.trim()} · 专业人士` : "专业人士";
  return "";
}

/** 联系方式的排序就是策略：对方事后最可能用哪条通道，那条就排第一。 */
function draftContacts(ctx) {
  const { scene, purpose, audience, stage, profile } = ctx;
  const stealth = Boolean(stage?.stealth);
  const available = availableContacts(profile);
  const byKey = new Map(available.map((c) => [c.key, c]));
  const ordered = [];
  const push = (key) => {
    const found = byKey.get(key);
    if (found && !ordered.some((c) => c.key === key)) ordered.push(found);
  };

  if (purpose?.id === "negotiate" || audience?.id === "institution") {
    push("email");
    push("phone");
    if (scene?.id !== "visit") push("wechat");
  } else if (scene?.id === "banquet" || scene?.id === "salon") {
    push("wechat");
    push("phone");
  } else if (scene?.id === "interview" || purpose?.id === "job") {
    if (!stealth) push("email");
    push("phone");
    push("wechat");
  } else if (purpose?.id === "fundraise") {
    push("email");
    push("website");
    push("wechat");
  } else {
    push("wechat");
    if (!stealth) push("email");
    push("phone");
    push("website");
  }
  for (const c of available) {
    if (stealth && (c.key === "email" || c.key === "website")) continue;
    push(c.key);
  }

  const cap = scene && scene.density < 0.45 ? 2 : scene && scene.density > 0.65 ? 4 : 3;
  return ordered.slice(0, cap);
}

function draftCta(ctx, contacts) {
  const { purpose, scene, stage } = ctx;
  if (stage?.stealth) return "用微信联系（私人）";
  if (purpose?.id === "job") return contacts.some((c) => c.key === "email") ? "欢迎来信 / 微信" : "欢迎微信沟通";
  if (purpose?.id === "fundraise") return "欢迎进一步交流";
  if (purpose?.id === "negotiate") return "请通过邮件联系";
  if (scene?.id === "banquet" || scene?.id === "salon") return "微信";
  return contacts[0] ? `请通过${contacts[0].label}联系` : "保持联系";
}

function draftKicker(ctx) {
  const { purpose, audience } = ctx;
  if (purpose?.id === "job") return "关于下一步";
  if (purpose?.id === "fundraise") return "关于这个局";
  if (purpose?.id === "negotiate") return "关于这次谈";
  return audience?.id === "peer" ? "同路" : "相见";
}

function draftTone(ctx) {
  const { scene, purpose, stage } = ctx;
  const bits = [STANCES[ctx.stanceFallback]?.blurb].filter(Boolean);
  if (scene && scene.density < 0.45) bits.push("字要大、条目要少，暗光下也能认");
  if (scene && scene.formality > 0.8) bits.push("端正，不要俏皮");
  if (purpose?.id === "negotiate") bits.push("对等克制，不做亲昵感");
  if (stage?.stealth) bits.push("像独立专业人士的卡，不张扬");
  return bits.join("；");
}

export function draftBrief(ctx) {
  const { profile, audience, scene, purpose, stage, companyMode, stanceFallback } = ctx;
  const company = profile.company?.trim() || "";
  const city = profile.city?.trim() || "";
  const tags = splitTags(profile.tags);

  let masthead = companyMode === "show" && company ? company : "";
  let mastheadWhy = masthead ? "组织可以上卡，让身份先被归位" : "组织不上卡，身份靠职能承担";
  // 上排空着又有城市时，城市是最不冒犯的替代锚点。
  if (!masthead && city && (scene?.id === "conference" || companyMode === "hide")) {
    masthead = city;
    mastheadWhy = "组织不上卡，上排用城市定位";
  }

  const under = [];
  const role = stripOrg(draftRole(ctx), masthead);
  if (role) under.push({ label: role, why: "对外身份靠职能承担" });
  for (const t of tags.slice(0, 1)) under.push({ label: t, why: "一条能被追问的能力标签" });

  const contacts = draftContacts(ctx);
  const printedKeys = new Set(contacts.map((c) => c.key));

  const backTags = [];
  if (companyMode === "past" && company) backTags.push({ label: `曾任 ${company}` });
  for (const t of tags.slice(1, 3)) backTags.push({ label: t });

  const omitted = [];
  const showNameEn = Boolean(profile.nameEn?.trim()) && !(scene && scene.density < 0.45);
  if (!showNameEn && profile.nameEn?.trim()) omitted.push({ label: "英文名", reason: "这个场合英文名是多余的一行" });
  if (companyMode === "hide" && company) omitted.push({ label: company, reason: "这一段不宜把组织写死在卡上" });
  if (companyMode === "past" && company) omitted.push({ label: company, reason: "只以「曾任」出现在背面" });
  if (city && masthead && masthead !== city) omitted.push({ label: city, reason: "上排只留组织，城市留给口头" });
  for (const t of tags.slice(3)) omitted.push({ label: t, reason: "标签过多会把名片做成简历" });
  for (const c of availableContacts(profile)) {
    if (printedKeys.has(c.key)) continue;
    omitted.push({
      label: c.label,
      reason:
        scene?.id === "banquet" || scene?.id === "salon"
          ? "这个场合只留最容易加的一条"
          : stage?.stealth && (c.key === "email" || c.key === "website")
            ? "在职看机会，避免工作通道"
            : "超出版面，主通道优先",
    });
  }

  const offstage = [];
  if (stage?.stealth) offstage.push("口头介绍先用职能，不主动报现东家。");
  if (purpose?.id === "job") offstage.push("履历放在后续邮件里，卡上只留一个值得被邀请的身份。");
  if (purpose?.id === "negotiate") offstage.push("邮件优先，留痕；微信留到关系确立之后。");
  if (companyMode === "past" && company) offstage.push("「曾任」只在被问起时展开，别主动解释离职。");
  if (!offstage.length && audience) offstage.push(`对方在乎${audience.cares.join("、")}，把这三点留在口头而不是卡上。`);

  return {
    id: "draft",
    source: "draft",
    read:
      audience && scene && purpose
        ? `面对${audience.label}，在${scene.label}里要的是${purpose.label}。`
        : "四个问题答得越完整，设计稿会越像一次具体相遇。",
    stance: stanceFallback,
    stanceWhy: STANCES[stanceFallback]?.blurb || "",
    masthead,
    mastheadWhy,
    showNameEn,
    under,
    contacts: contacts.map((c) => ({ ...c, why: "" })),
    contactWhy: contacts[0] ? `主通道取${contacts[0].label}，这是对方事后最可能用的` : "",
    back: { kicker: draftKicker(ctx), pitch: draftPitch(ctx), cta: draftCta(ctx, contacts) },
    backTags,
    omitted: omitted.slice(0, 6),
    offstage: offstage.slice(0, 4),
    tone: draftTone(ctx),
  };
}

/* ---------- 给界面和提示词用的人话 ---------- */

export function briefRows(brief) {
  return [
    ["上排", brief.masthead || "留白", brief.mastheadWhy],
    ["姓名", brief.showNameEn ? "中文 + 英文名" : "只排中文名", ""],
    ["姓名下", brief.under.map((u) => u.label).join(" · ") || "留白", brief.under.map((u) => u.why).filter(Boolean).join("；")],
    ["底栏", brief.contacts.map((c) => c.value).join("  ·  ") || "无联系", brief.contactWhy],
    [
      "背面",
      [brief.back.kicker, brief.back.pitch, brief.backTags.map((b) => b.label).join(" · "), brief.back.cta]
        .filter(Boolean)
        .join("｜"),
      "",
    ],
    ["不上卡", brief.omitted.map((o) => `${o.label}（${o.reason}）`).join("；") || "无", ""],
  ];
}

/** 设计稿拆成可逐项打勾的节点（核对清单）。 */
export function briefNodes(brief, stanceLabel) {
  const ids = ["masthead", "name", "under", "contacts", "back", "omitted"];
  const nodes = briefRows(brief).map(([title, value, why], i) => ({
    id: ids[i],
    title,
    value,
    why: why || "",
  }));
  nodes.push({
    id: "stance",
    title: "立场",
    value: stanceLabel || "",
    why: brief.stanceWhy || "",
  });
  if (brief.offstage?.length) {
    nodes.push({
      id: "offstage",
      title: "私下",
      value: brief.offstage.join(" "),
      why: "不上卡，只给你自己看",
    });
  }
  return nodes;
}
