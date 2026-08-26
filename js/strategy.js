import {
  AUDIENCES,
  PURPOSES,
  SCENES,
  STAGES,
  STANCES,
} from "./data.js";

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

function contactPlan({ scene, purpose, stage, audience, profile }) {
  const has = (k) => Boolean(profile?.[k]?.trim());
  const ordered = [];
  const stealth = Boolean(stage?.stealth);

  const push = (key, label) => {
    if (has(key)) ordered.push({ key, label, value: profile[key].trim() });
  };

  if (purpose?.id === "negotiate" || audience?.id === "institution") {
    push("email", "邮箱");
    push("phone", "电话");
    if (scene?.id !== "visit") push("wechat", "微信");
  } else if (scene?.id === "banquet" || scene?.id === "salon") {
    push("wechat", "微信");
    push("phone", "电话");
  } else if (scene?.id === "interview" || purpose?.id === "job") {
    if (!stealth) push("email", "邮箱");
    push("phone", "电话");
    push("wechat", "微信");
  } else if (purpose?.id === "fundraise") {
    push("email", "邮箱");
    push("website", "站点");
    push("wechat", "微信");
  } else {
    push("wechat", "微信");
    if (!stealth) push("email", "邮箱");
    push("phone", "电话");
    push("website", "站点");
  }

  const seen = new Set(ordered.map((x) => x.key));
  for (const [key, label] of [
    ["wechat", "微信"],
    ["phone", "电话"],
    ["email", "邮箱"],
    ["website", "站点"],
  ]) {
    if (stealth && (key === "email" || key === "website")) continue;
    if (!seen.has(key)) push(key, label);
  }

  const cap = scene && scene.density < 0.45 ? 2 : scene && scene.density > 0.65 ? 4 : 3;
  return ordered.slice(0, cap);
}

function deriveHeadline({ profile, purpose, audience, stage, companyMode }) {
  const title = profile.title?.trim() || "";
  const company = profile.company?.trim() || "";
  const city = profile.city?.trim() || "";

  if (stage?.id === "founder" && company) {
    return title ? `${title} · ${company}` : `创始人 · ${company}`;
  }
  if (stage?.id === "independent") {
    if (title) return title;
    if (purpose?.id === "job") return "独立专业人士";
    return "独立顾问";
  }
  if (companyMode === "hide") {
    if (title) return title;
    if (purpose?.id === "job") return "正在寻找下一份职责";
    return city ? `${city} · 专业人士` : "专业人士";
  }
  if (companyMode === "past" && company) {
    return title ? `${title}｜曾任 ${company}` : `曾任 ${company}`;
  }
  if (purpose?.id === "job" && audience?.id === "recruiter" && title) {
    return company && companyMode === "show" ? `${title}  ·  ${company}` : title;
  }
  if (title && company && companyMode === "show") return `${title}  ·  ${company}`;
  if (title) return title;
  if (company && companyMode === "show") return company;
  return "";
}

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

function derivePitch({ profile, purpose, audience, scene, stage }) {
  if (profile.pitch?.trim()) return profile.pitch.trim();
  const key = `${purpose?.id || ""}|${audience?.id || ""}`;
  if (PITCH[key]) return PITCH[key];
  if (stage?.id === "stealth") return "专业的人，用私人方式被找到。";
  if (scene?.id === "banquet") return "先记住这个名字。";
  if (purpose?.id === "job") return "为下一段职责而来。";
  if (purpose?.id === "deal") return "把合作推进到下一步。";
  if (purpose?.id === "network") return "留一个以后用得上的联系。";
  return "把这次相遇，收成一个可以继续的理由。";
}

function publicCta({ purpose, scene, stage, contacts }) {
  if (stage?.stealth) return "用微信联系（私人）";
  if (purpose?.id === "job") return contacts.some((c) => c.key === "email")
    ? "欢迎来信 / 微信"
    : "欢迎微信沟通";
  if (purpose?.id === "fundraise") return "欢迎进一步交流";
  if (purpose?.id === "negotiate") return "请通过邮件联系";
  if (scene?.id === "banquet" || scene?.id === "salon") return "微信";
  return contacts[0] ? `请通过${contacts[0].label}联系` : "保持联系";
}

function showPhoto({ scene, stance, hasPortrait }) {
  if (!hasPortrait) return false;
  if (scene?.id === "visit" || scene?.id === "interview") return false;
  if (stance === "authority" || stance === "quiet" || stance === "credible") return false;
  return stance === "creative";
}

function hierarchy({ profile, headline, pitch, contacts, companyMode, showPortrait }) {
  const items = [];
  if (profile.name?.trim()) items.push({ slot: "name", label: "姓名", value: profile.name.trim() });
  else items.push({ slot: "name", label: "姓名", value: "你的名字", placeholder: true });

  if (profile.nameEn?.trim()) {
    items.push({ slot: "nameEn", label: "英文名", value: profile.nameEn.trim() });
  }
  if (headline) items.push({ slot: "headline", label: "对外身份", value: headline });
  if (pitch) items.push({ slot: "pitch", label: "一句定位", value: pitch });
  if (companyMode === "show" && profile.company?.trim() && !headline.includes(profile.company.trim())) {
    items.push({ slot: "company", label: "组织", value: profile.company.trim() });
  }
  if (profile.city?.trim() && (companyMode === "hide" || !profile.company?.trim())) {
    items.push({ slot: "city", label: "城市", value: profile.city.trim() });
  }
  for (const c of contacts) items.push({ slot: c.key, label: c.label, value: c.value });
  if (showPortrait) items.push({ slot: "portrait", label: "肖像", value: "上卡" });
  return items;
}

function rationale({ audience, scene, purpose, stage, stance, companyMode, contacts }) {
  const lines = [];
  const stanceObj = STANCES[stance];

  if (audience && scene && purpose) {
    lines.push(
      `面对「${audience.label}」，在「${scene.label}」里要的是「${purpose.label}」。立场取「${stanceObj.label}」：${stanceObj.blurb}`,
    );
  } else {
    lines.push("四个问题答得越完整，形象会从「通用商务」收成一次具体相遇的设计。");
  }

  if (stage?.stealth) {
    lines.push("你在职且不想暴露动向：现公司不印，工作邮箱不用，名片看起来像独立专业人士。");
  } else if (companyMode === "hide") {
    lines.push("这一段不宜把组织写死在卡上。让头衔或一句定位承担身份，组织留给口头。");
  } else if (companyMode === "past") {
    lines.push("求职已公开：过往组织可以「曾任」出现，但不要印成你还在替他们说话。");
  } else if (companyMode === "show" && stage?.id === "founder") {
    lines.push("创始人的脸就是公司的脸。名字与组织同框，别把卡做成个人作品集封面。");
  } else if (audience && scene) {
    lines.push(
      `${scene.label}的阅读时间很短。卡上只留对方在乎的抓手：${audience.cares.join("、")}。`,
    );
  }

  if (scene && scene.density < 0.45) {
    lines.push(
      `这个场合信息要少。联系方式只留 ${contacts.map((c) => c.label).join("、") || "最容易加的一条"}，背面用一句定位，不放履历。`,
    );
  } else if (purpose?.id === "negotiate") {
    lines.push("谈判场合避免亲昵。邮件优先于微信，语气对等，不写口号。");
  } else if (contacts.length) {
    lines.push(`对外主联系取「${contacts[0].label}」，因为这是对方事后最可能用的通道。`);
  }

  return lines.slice(0, 3);
}

function warnings({ stage, purpose, profile, companyMode, contacts }) {
  const w = [];
  if (stage?.stealth && contacts?.some((c) => c.key === "email")) {
    w.push("请确认这是私人邮箱。在职看机会时，印工作邮箱等于把动向交给现东家。");
  }
  if (stage?.stealth && companyMode === "hide" && profile.company?.trim()) {
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

function backLines({ pitch, audience, purpose, cta }) {
  const kicker =
    purpose?.id === "job"
      ? "关于下一步"
      : purpose?.id === "fundraise"
        ? "关于这个局"
        : purpose?.id === "negotiate"
          ? "关于这次谈"
          : audience?.id === "peer"
            ? "同路"
            : "相见";
  return { kicker, pitch, cta };
}

export function completeness(state) {
  const keys = ["audience", "scene", "purpose", "stage"];
  const filled = keys.filter((k) => state[k]).length;
  const named = Boolean(state.profile?.name?.trim());
  const contact = ["wechat", "phone", "email"].some((k) => state.profile?.[k]?.trim());
  return { questions: filled, questionsTotal: 4, named, contact, readyToPrint: named && contact && filled === 4 };
}

export function compose(state) {
  const custom = state.custom || {};
  const audience = resolve(AUDIENCES, state.audience, custom.audience);
  const scene = resolve(SCENES, state.scene, custom.scene);
  const purpose = resolve(PURPOSES, state.purpose, custom.purpose);
  const stage = resolve(STAGES, state.stage, custom.stage);
  const profile = state.profile || {};

  const stanceId = state.stanceOverride || pickStance(audience, scene, purpose, stage);
  const stance = STANCES[stanceId] || STANCES.credible;
  const companyMode = companyPolicy(stage, purpose, audience);
  const contacts = contactPlan({ scene, purpose, stage, audience, profile });

  const derivedHeadline = deriveHeadline({ profile, purpose, audience, stage, companyMode });
  const derivedPitch = derivePitch({ profile, purpose, audience, scene, stage });
  const headline = state.edits?.headline?.trim() || derivedHeadline;
  const pitch = state.edits?.pitch?.trim() || derivedPitch;
  const photo = showPhoto({
    scene,
    stance: stanceId,
    hasPortrait: Boolean(profile.portrait),
  });
  const cta = publicCta({ purpose, scene, stage, contacts });
  const items = hierarchy({
    profile,
    headline,
    pitch,
    contacts,
    companyMode,
    showPortrait: photo,
  });

  return {
    audience,
    scene,
    purpose,
    stage,
    stanceId,
    stance,
    companyMode,
    contacts,
    headline,
    derivedHeadline,
    pitch,
    derivedPitch,
    showPortrait: photo,
    cta,
    items,
    rationale: rationale({
      audience,
      scene,
      purpose,
      stage,
      stance: stanceId,
      companyMode,
      contacts,
    }),
    warnings: warnings({ stage, purpose, profile, companyMode, contacts }),
    back: backLines({ pitch, audience, purpose, cta }),
    completeness: completeness(state),
  };
}
