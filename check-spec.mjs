/**
 * 两份契约的守卫：`node check-spec.mjs`
 *
 * 大模型会返回任意 JSON，清洗器是唯一防线。这里断言不管输入多离谱：
 *   - 设计稿（brief）不会编造联系方式、不会把该藏的组织露出来、不会在卡上写请愿句；
 *   - 视觉规格（spec）出来都是可印制的：对比度达标、装饰与正文不抢地方、数值不越界。
 * 改 brief.js / style-spec.js 之后跑一遍。
 */
import { PRESETS, sanitizeSpec, specToVars, decorHtml, describeSpec } from "./js/style-spec.js";
import { briefContext, compose } from "./js/strategy.js";
import { availableContacts, briefRows, draftBrief, sanitizeBrief } from "./js/brief.js";
import { designCard, fitPrintedContacts, faceWidthCqw, lineWidthCqw, printIssues, qrReserveCqw } from "./js/design.js";
import { buildPrompts } from "./js/prompts.js";
import { cardMarkup } from "./js/render-card.js";
import { DEMO, EMPTY_PROFILE, STANCES } from "./js/data.js";
import { readFileSync } from "node:fs";

let fail = 0;
const bad = (msg) => {
  console.error("FAIL", msg);
  fail++;
};

function toRgb(h) {
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
}
function lum(h) {
  const [r, g, b] = toRgb(h).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [la, lb] = [lum(a), lum(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function auditSpec(label, spec) {
  const vars = specToVars(spec);
  const decor = decorHtml(spec, "陈", false);
  const desc = describeSpec(spec);
  for (const [what, s] of [["vars", vars], ["decor", decor], ["desc", JSON.stringify(desc)]]) {
    if (/NaN|undefined|null|Infinity/.test(s)) bad(`${label} ${what} 含非法值: ${s.slice(0, 200)}`);
  }
  const c = contrast(spec.palette.fg, spec.palette.bg);
  if (c < 4.5) bad(`${label} 主文字对比度只有 ${c.toFixed(2)}`);
  if (contrast(spec.palette.muted, spec.palette.bg) < 2.5) {
    bad(`${label} 次级文字对比度不足 ${contrast(spec.palette.muted, spec.palette.bg).toFixed(2)}`);
  }
  // 竖排姓名必须有让出的正文留白
  if (spec.type.nameVertical) {
    const gutter = spec.type.nameSide === "left" ? spec.frame.pad.l : spec.frame.pad.r;
    if (gutter < 26) bad(`${label} 竖排姓名侧留白只有 ${gutter}%，会和色块重叠`);
  }
  // 楔形/宽色块不能被正文压上
  for (const d of spec.decor) {
    if (d.kind === "wedge") {
      const p = d.side === "right" ? spec.frame.pad.r : spec.frame.pad.l;
      if (p < d.size) bad(`${label} wedge ${d.size}% 但同侧留白只有 ${p}%`);
    }
  }
  const pad = spec.frame.pad;
  if (pad.l + pad.r > 78) bad(`${label} 左右留白合计 ${pad.l + pad.r}%，正文没地方了`);
  if (pad.t + pad.b > 40) bad(`${label} 上下留白合计 ${pad.t + pad.b}%`);
  if (spec.type.nameFamily !== "sans" && spec.type.nameTrack > 0.181) {
    bad(`${label} 衬线/海报体姓名字距 ${spec.type.nameTrack}，会缺笔`);
  }
  if (spec.type.roleTrack > 0.121) bad(`${label} 姓名下字距 ${spec.type.roleTrack}，中文会缺笔`);
  if ((spec.type.nameLeading || 0) < 1.28) bad(`${label} 姓名行高过紧，上下会被裁`);
}

function auditPrintFit(label, design, profile = {}) {
  for (const c of design.contacts) {
    if (/\.\.\.|…/.test(c.value)) bad(`${label} 底栏含省略号: ${c.value}`);
  }
  const { overflow } = fitPrintedContacts(design.contacts, design.spec);
  if (overflow.length) {
    bad(`${label} 已排底栏仍溢出: ${overflow.map((c) => c.value).join(" / ")}`);
  }
  for (const issue of printIssues(design, profile)) {
    bad(`${label} ${issue}`);
  }
}

const PLEA = /求职|找工作|找下家|求贤|待业|失业|寻求机会|谋职|求推荐|求内推|招聘我/;

/** 设计稿的铁律：不编联系方式、该藏的组织藏住、卡面不写请愿句、条目不超版。 */
function auditBrief(label, brief, ctx) {
  const json = JSON.stringify(brief);
  if (/NaN|undefined|\[object/.test(json)) bad(`${label} 设计稿含非法值: ${json.slice(0, 200)}`);
  if (!Object.keys(STANCES).includes(brief.stance)) bad(`${label} 立场不合法: ${brief.stance}`);

  const real = new Map(availableContacts(ctx.profile).map((c) => [c.key, c.value]));
  for (const c of brief.contacts) {
    if (!real.has(c.key)) bad(`${label} 底栏出现用户没填的通道: ${c.key}`);
    else if (c.value !== real.get(c.key)) bad(`${label} 底栏的值被改写: ${c.value}`);
  }
  if (new Set(brief.contacts.map((c) => c.key)).size !== brief.contacts.length) {
    bad(`${label} 底栏有重复通道`);
  }

  const company = ctx.profile.company?.trim();
  if (company && ctx.companyMode !== "show") {
    const onCard = [brief.masthead, ...brief.under.map((u) => u.label)].join(" ");
    if (onCard.includes(company)) bad(`${label} 组织策略为 ${ctx.companyMode} 却把「${company}」印在正面`);
  }

  for (const s of [brief.masthead, brief.back.pitch, ...brief.under.map((u) => u.label)]) {
    if (s && PLEA.test(s)) bad(`${label} 卡面出现请愿句: ${s}`);
  }

  if (brief.showNameEn && !ctx.profile.nameEn?.trim()) bad(`${label} 没填英文名却要排英文名`);
  if (brief.under.length > 3) bad(`${label} 姓名下 ${brief.under.length} 条，超过 3`);
  if (brief.contacts.length > 4) bad(`${label} 底栏 ${brief.contacts.length} 条，超过 4`);
  if (brief.backTags.length > 3) bad(`${label} 背面标签超过 3`);
  if (brief.omitted.length > 6) bad(`${label} 不上卡清单超过 6`);
  if (brief.offstage.length > 4) bad(`${label} 私下策略超过 4`);
  if (!brief.back.pitch) bad(`${label} 背面定位为空`);
}

// 1. 六套内置预设
for (const [id, spec] of Object.entries(PRESETS)) auditSpec(`preset:${id}`, spec);

// 2. 每个立场都能出完整策略 + 提示词
const base = {
  ...DEMO,
  stanceOverride: "",
  custom: {},
  edits: { masthead: "", role: "", pitch: "" },
  profile: { ...EMPTY_PROFILE, ...DEMO.profile },
  brief: null,
  styleSpec: null,
  candidates: [],
};
for (const stance of ["", ...Object.keys(PRESETS)]) {
  const state = { ...base, stanceOverride: stance };
  const strategy = compose(state);
  auditSpec(`compose:${stance || "auto"}`, strategy.design.spec);
  auditBrief(`compose:${stance || "auto"}`, strategy.brief, briefContext(state));
  auditPrintFit(`compose:${stance || "auto"}`, strategy.design, state.profile);
  const p = buildPrompts(state, strategy);
  for (const [k, v] of Object.entries(p)) {
    if (!v.length) bad(`compose:${stance} 提示词 ${k} 为空`);
    if (/NaN|undefined/.test(v)) bad(`compose:${stance} 提示词 ${k} 含非法值`);
  }
}

// 3. 空白状态（四问全空、资料全空）不能崩
{
  const empty = { audience: "", scene: "", purpose: "", stage: "", stanceOverride: "", custom: {}, edits: {}, profile: { ...EMPTY_PROFILE }, brief: null, styleSpec: null, candidates: [] };
  const s = compose(empty);
  auditSpec("empty", s.design.spec);
  auditBrief("empty", s.brief, briefContext(empty));
  buildPrompts(empty, s);
}

// 3b. 规则草稿：所有 场合 × 用途 × 阶段 组合都要出一份合法设计稿
{
  const { SCENES, PURPOSES, AUDIENCES, STAGES } = await import("./js/data.js");
  for (const scene of SCENES) {
    for (const purpose of PURPOSES) {
      for (const stage of STAGES) {
        const state = { ...base, scene: scene.id, purpose: purpose.id, stage: stage.id };
        const ctx = briefContext(state);
        auditBrief(`draft:${scene.id}/${purpose.id}/${stage.id}`, draftBrief(ctx), ctx);
      }
    }
  }
  for (const audience of AUDIENCES) {
    const state = { ...base, audience: audience.id, stage: "stealth" };
    const ctx = briefContext(state);
    auditBrief(`draft:stealth/${audience.id}`, draftBrief(ctx), ctx);
  }
}

// 3c. 恶意/畸形的设计稿：编造的联系方式、藏不住的组织、请愿句都要被拦下
{
  const ctx = briefContext({ ...base, stage: "stealth" });
  const briefGarbage = [
    null,
    {},
    "not an object",
    {
      stance: "godmode",
      masthead: `${DEMO.profile.company} 集团`,
      under: [{ label: "求职中，求内推" }, { label: "x".repeat(300) }, { label: "A" }, { label: "B" }, { label: "C" }],
      contacts: [
        { key: "fax" },
        { key: "phone", value: "13900000000" },
        { key: "phone" },
        { key: "email" },
        { key: "website" },
        { key: "wechat" },
      ],
      back: { kicker: "k".repeat(99), pitch: "我在找工作，求推荐", cta: "" },
      backTags: ["1", "2", "3", "4", "5"],
      omitted: Array.from({ length: 20 }, (_, i) => ({ label: `l${i}`, reason: `r${i}` })),
      offstage: Array.from({ length: 20 }, (_, i) => `line ${i}`),
      tone: "t".repeat(500),
    },
    { contacts: "nope", under: 42, back: "no", omitted: null, offstage: {} },
  ];
  for (const [i, g] of briefGarbage.entries()) {
    let brief;
    try {
      brief = sanitizeBrief(g, ctx, `bg${i}`);
    } catch (err) {
      bad(`briefGarbage[${i}] 抛异常: ${err.message}`);
      continue;
    }
    auditBrief(`briefGarbage[${i}]`, brief, ctx);
  }

  // 采纳畸形设计稿后，整条渲染链路仍然要活着
  const state = { ...base, stage: "stealth", brief: briefGarbage[3] };
  const s = compose(state);
  auditBrief("adopted-brief", s.brief, briefContext(state));
  auditSpec("adopted-brief", s.design.spec);
  const p = buildPrompts(state, s);
  if (/求职|找工作|求推荐/.test(p.zh)) bad("提示词里漏出了请愿句");
  if (p.zh.includes(DEMO.profile.company)) bad("stealth 下提示词漏出了现公司");
}

// 3d. 英文名写进 omitted 就必须不上卡；从业年限不许漏到背面标签
{
  const ctx = briefContext(base);
  const brief = sanitizeBrief(
    {
      showNameEn: true,
      omitted: [{ label: "英文名 Yuan Chen", reason: "国内客户用不上" }],
      backTags: ["组织诊断", "14年企业服务"],
      under: [{ label: "商务负责人" }],
      contacts: [{ key: "phone" }],
      back: { kicker: "相见", pitch: "把合作推进到下一步。", cta: "电话" },
    },
    ctx,
    "en-omit",
  );
  if (brief.showNameEn) bad("omitted 写了英文名，showNameEn 仍为 true");
  if (brief.backTags.some((b) => b.label.includes("14年"))) bad("从业年限漏到了背面标签");
  const state = { ...base, brief };
  const p = buildPrompts(state, compose(state));
  if (/主名[^：\n]*：陈予安 \/ Yuan Chen/.test(p.zh)) bad("正面主名仍排出了被拿掉的英文名");
}

// 4. 恶意/畸形的模型输出：不能抛异常，且必须被夹回可印区间
const garbage = [
  null,
  {},
  "not an object",
  { palette: { bg: "red", fg: "#fff" }, frame: { pad: { t: -900, r: 1e9, b: NaN, l: "x" } }, decor: "nope" },
  {
    name: "x".repeat(500),
    palette: { bg: "#000000", fg: "#010101", muted: "#000000", accent: "#000000", bgMode: "wat" },
    surface: { grain: 99, vignette: -5, radius: 1e6, monogram: 3 },
    frame: { align: "diagonal", anchor: "sideways", pad: { t: 0, r: 0, b: 0, l: 0 } },
    type: { nameFamily: "comic", nameSize: 400, nameTrack: -9, nameWeight: 999, nameVertical: true, nameSide: "left", roleSize: 0, contactSize: 1e5 },
    decor: [
      { kind: "edge", side: "left", size: 999, color: "chartreuse" },
      { kind: "wedge", side: "right", size: 999 },
      { kind: "nuke" },
      null,
      { kind: "grid", cell: -1, opacity: 50 },
      { kind: "seal", corner: "middle", size: 999 },
    ],
    copy: { maxUnder: 99, maxContacts: -3, contactStyle: "hologram" },
  },
];
for (const [i, g] of garbage.entries()) {
  let spec;
  try {
    spec = sanitizeSpec(g, `g${i}`);
  } catch (err) {
    bad(`garbage[${i}] 抛异常: ${err.message}`);
    continue;
  }
  auditSpec(`garbage[${i}]`, spec);
  if (spec.decor.length > 4) bad(`garbage[${i}] 装饰层没截断: ${spec.decor.length}`);
}

// 5. 采纳的模型规格能穿过 compose
{
  const spec = sanitizeSpec(garbage[4], "adopted");
  const state = { ...base, styleSpec: spec };
  const s = compose(state);
  if (s.design.source !== "llm") bad("采纳规格后 source 应为 llm");
  auditSpec("adopted", s.design.spec);
}

// 5b. 二维码位：清洗器夹区间；面别/角位/装裱随设计；贴了图才渲染；正面底栏必须让位
{
  const qrSpec = sanitizeSpec(
    { ...PRESETS.credible, qr: { show: true, corner: "middle", size: 999, mount: "gold" } },
    "qr",
  );
  if (qrSpec.qr.corner !== "br") bad("qr.corner 畸形值应回落 br");
  if (qrSpec.qr.size !== 26) bad(`qr.size 应夹到 26，实得 ${qrSpec.qr.size}`);
  if (qrSpec.qr.mount !== "bare") bad("qr.mount 畸形值应回落 bare");
  if (sanitizeSpec({ qr: { show: "yes" } }, "qr2").qr.show !== false) bad("qr.show 应清洗成布尔");
  if (sanitizeSpec({}, "qr3").qr.size !== 18) bad("qr.size 默认应为 18");

  const specFace = sanitizeSpec({ qr: { show: true, face: "side", corner: "tr" } }, "qrf");
  if (specFace.qr.face !== "front" || specFace.qr.corner !== "br") bad("正面只许左下/右下，畸形面别应回落 front/br");
  const specBack = sanitizeSpec({ qr: { show: true, face: "back", corner: "tr" } }, "qrb");
  if (specBack.qr.face !== "back" || specBack.qr.corner !== "tr") bad("背面应保留右上角位");

  const withQr = { ...base, profile: { ...base.profile, qrImage: "data:image/png;base64,x" } };
  const sQr = compose(withQr);
  const frontQr = cardMarkup(sQr, withQr.profile, "front");
  if (!frontQr.includes("card-qr") || !frontQr.includes('data-qr="br"')) bad("贴了二维码图，正面没渲染二维码位");
  if (!frontQr.includes('data-mount="quiet"')) bad("正面二维码装裱应来自规格");
  if (cardMarkup(sQr, withQr.profile, "back").includes("card-qr")) bad("码在正面时背面不该渲染");
  if (cardMarkup(sQr, base.profile, "front").includes("card-qr")) bad("没贴图不该渲染二维码");

  const specQr = sanitizeSpec(
    { ...PRESETS.credible, type: { ...PRESETS.credible.type, contactSize: 2.3 }, qr: { show: true, size: 26 } },
    "qrfit",
  );
  const brief3 = sanitizeBrief(
    { under: [{ label: "商务负责人" }], contacts: [{ key: "wechat" }, { key: "email" }, { key: "phone" }] },
    briefContext(base),
    "qr3c",
  );
  const stateB = { ...base, brief: brief3 };
  const dNo = designCard(compose(stateB), stateB, specQr);
  const dQr = designCard(compose(withQr), withQr, specQr);
  if (dNo.contacts.length < 3) bad(`对照组应排出 3 条联系，实得 ${dNo.contacts.length}`);
  if (dQr.contacts.length >= dNo.contacts.length) bad("贴二维码后底栏没有让位");
  const issues = printIssues(dQr, withQr.profile);
  if (issues.length) bad(`二维码让位后仍有印制问题: ${issues.join("；")}`);

  // 码在背面：背面渲染出码位，正面排版当它不存在
  if (qrReserveCqw({ ...PRESETS.credible, qr: { show: true, face: "back", size: 20 } }, { qrImage: "x" }) !== 0) {
    bad("码在背面时正面底栏不该占位");
  }
  const specBackFit = sanitizeSpec(
    { ...PRESETS.credible, type: { ...PRESETS.credible.type, contactSize: 2.3 }, qr: { show: true, face: "back", corner: "tr", size: 20 } },
    "qrback",
  );
  const dBack = designCard(compose(withQr), withQr, specBackFit);
  if (dBack.contacts.length !== dNo.contacts.length) bad("码在背面时正面底栏不应让位");
  const backHtml = cardMarkup(compose(withQr), withQr.profile, "back", dBack);
  if (!backHtml.includes("card-qr") || !backHtml.includes('data-corner="tr"')) bad("码在背面时背面没渲染出码位");
  if (cardMarkup(compose(withQr), withQr.profile, "front", dBack).includes("card-qr")) bad("码在背面时正面不该渲染");
}

// 5c. 中英双面：没英文名必须回落 pitch；英文请愿句要拦；渲染链路要出英文背面
{
  const ctx = briefContext(base);
  const briefEn = sanitizeBrief(
    {
      under: [{ label: "商务负责人" }],
      contacts: [{ key: "wechat" }, { key: "phone" }],
      backMode: "en",
      backEn: { title: "Business Director", kicker: "CONTACT", cta: "WeChat me anytime" },
      back: { kicker: "相见", pitch: "把合作推进到下一步。", cta: "请通过微信联系" },
    },
    ctx,
    "en-ok",
  );
  if (briefEn.backMode !== "en") bad("有英文名时 backMode=en 应保留");
  if (briefEn.backEn.title !== "Business Director") bad("backEn.title 清洗丢失");
  if (briefEn.backEn.cta !== "WeChat me anytime") bad("backEn.cta 清洗丢失");

  const noEn = sanitizeBrief(
    { backMode: "en", backEn: { title: "X" } },
    { ...ctx, profile: { ...ctx.profile, nameEn: "" } },
    "en-none",
  );
  if (noEn.backMode !== "pitch") bad("没英文名 backMode 必须回落 pitch");

  const pleaEn = sanitizeBrief(
    { backMode: "en", backEn: { cta: "I am seeking opportunities", title: "Open to work" } },
    ctx,
    "en-plea",
  );
  if (/seeking|open to work/i.test(`${pleaEn.backEn.cta} ${pleaEn.backEn.title}`)) bad("英文请愿句漏进卡面");

  const stateEn = { ...base, brief: briefEn, edits: { masthead: "", role: "", pitch: "", backMode: "en" } };
  const sEn = compose(stateEn);
  if (sEn.backMode !== "en") bad("edits.backMode=en 应生效");
  const backHtml = cardMarkup(sEn, stateEn.profile, "back");
  if (!backHtml.includes("Yuan Chen") || !backHtml.includes("Business Director") || !backHtml.includes("WeChat me anytime")) {
    bad("英文背面渲染缺字段");
  }
  if (!backHtml.includes("WeChat chenyuan_biz")) bad("英文背面联系方式缺英文标签");
  if (cardMarkup(sEn, stateEn.profile, "front").includes("Business Director")) bad("英文头衔漏到了正面");
  if (sEn.design.contactsEn.length > sEn.design.contacts.length) bad("英文背面底栏条数比正面还多");
  const issuesEn = printIssues(sEn.design, stateEn.profile);
  if (issuesEn.some((i) => i.includes("英文背面"))) bad(`英文背面底栏超宽: ${issuesEn.join("；")}`);

  const sDraft = compose(base);
  if (sDraft.backMode !== "pitch") bad("规则草稿默认应为 pitch");
  if (cardMarkup(sDraft, base.profile, "back").includes("Yuan Chen")) bad("pitch 模式背面不应出现英文版");
  if (!briefRows(briefEn).some(([k, v]) => k === "背面" && v.includes("英文版"))) bad("briefRows 未标注英文背面");
}

// 5d. 工作室拍板二维码位：on 强制印，off 强制不印，空则听规格的
{
  const img = { ...base.profile, qrImage: "data:image/png;base64,x" };
  const noQrSpec = sanitizeSpec({ ...PRESETS.credible, qr: { show: false, face: "front" } }, "noqr");
  const stateOn = { ...base, qrOverride: "on", profile: img, styleSpec: noQrSpec };
  if (!cardMarkup(compose(stateOn), img, "front").includes("card-qr")) bad("qrOverride=on 未强制印二维码");
  const stateOff = { ...base, qrOverride: "off", profile: img, styleSpec: PRESETS.credible };
  if (cardMarkup(compose(stateOff), img, "front").includes("card-qr")) bad("qrOverride=off 未拦下二维码");
  const stateAuto = { ...base, profile: img, styleSpec: PRESETS.credible };
  if (!cardMarkup(compose(stateAuto), img, "front").includes("card-qr")) bad("qrOverride 为空应跟随设计规格");
  if (compose(stateOn).design.spec.qr.show !== true) bad("拍板 on 后 spec.qr.show 应为 true");
  const offFit = printIssues(compose(stateOff).design, img);
  if (offFit.some((i) => i.includes("底栏"))) bad("拍板 off 后底栏不应残留二维码占宽问题");
}

// 6. 模型响应解析：Anthropic 的 tool_use 结构、缺字段、错误响应
{
  const { requestBrief, requestStyles } = await import("./js/llm.js");
  const ctx = briefContext(base);
  const strategy = compose(base);
  const stub = (status, payload) => {
    globalThis.fetch = async () => ({
      ok: status === 200,
      status,
      json: async () => payload,
    });
  };

  // 第一段：设计稿
  stub(200, {
    content: [
      { type: "text", text: "忽略这段" },
      {
        type: "tool_use",
        name: "write_brief",
        input: {
          read: "客户拜访，先归位再谈事。",
          stance: "credible",
          masthead: DEMO.profile.company,
          under: [{ label: "商务负责人", why: "职能先说清" }],
          contacts: [{ key: "phone" }, { key: "nope" }],
          back: { kicker: "相见", pitch: "把合作推进到下一步。", cta: "请通过电话联系" },
          tone: "克制、端正，留白多",
        },
      },
    ],
  });
  try {
    const brief = await requestBrief(ctx);
    auditBrief("llm-brief", brief, ctx);
    if (brief.source !== "llm") bad("大模型设计稿的 source 应为 llm");
    if (brief.contacts.length !== 1) bad(`伪造的 key 应被剔除，实际留下 ${brief.contacts.length} 条`);
  } catch (err) {
    bad(`解析合法设计稿失败: ${err.message}`);
  }

  // 第二段：视觉
  stub(200, {
    content: [
      { type: "text", text: "忽略这段" },
      { type: "tool_use", name: "propose_styles", input: { styles: [PRESETS.authority, PRESETS.credible, PRESETS.warm] } },
    ],
  });
  try {
    const specs = await requestStyles(strategy.brief, ctx);
    if (specs.length !== 3) bad(`应解析出 3 份规格，实际 ${specs.length}`);
    if (new Set(specs.map((s) => s.id)).size !== 3) bad("三份规格的 id 应互不相同");
    specs.forEach((s, i) => auditSpec(`parsed[${i}]`, s));
  } catch (err) {
    bad(`解析合法响应失败: ${err.message}`);
  }

  for (const [label, status, payload] of [
    ["没有 tool_use", 200, { content: [{ type: "text", text: "抱歉" }] }],
    ["styles 不是数组", 200, { content: [{ type: "tool_use", input: { styles: "nope" } }] }],
    ["上游报错", 501, { error: "还没配 API key" }],
  ]) {
    stub(status, payload);
    try {
      await requestStyles(strategy.brief, ctx);
      bad(`${label} 应该抛出可读错误，但通过了`);
    } catch (err) {
      if (!err.message || /undefined/.test(err.message)) bad(`${label} 的错误信息不可读: ${err.message}`);
    }
  }

  for (const [label, status, payload] of [
    ["设计稿没有 tool_use", 200, { content: [{ type: "text", text: "抱歉" }] }],
    ["设计稿上游报错", 501, { error: "还没配 API key" }],
  ]) {
    stub(status, payload);
    try {
      await requestBrief(ctx);
      bad(`${label} 应该抛出可读错误，但通过了`);
    } catch (err) {
      if (!err.message || /undefined/.test(err.message)) bad(`${label} 的错误信息不可读: ${err.message}`);
    }
  }
}

// 7. 产品版：档案标题、vCard、90×54mm @300dpi
{
  const { blankArchive, newScheme, questionsFilled, schemeTitle, toComposeState } = await import("./js/archive.js");
  const { buildVCard, PNG_W, PNG_H, PDF_PT_W, PDF_PT_H, pdfFromJpegs } = await import("./js/export.js");
  if (PNG_W !== 1063 || PNG_H !== 638) bad(`PNG 尺寸应为 1063×638，实际 ${PNG_W}×${PNG_H}`);
  if (Math.abs(PDF_PT_W - (90 / 25.4) * 72) > 0.01) bad(`PDF 页宽不是 90mm: ${PDF_PT_W}`);
  if (Math.abs(PDF_PT_H - (54 / 25.4) * 72) > 0.01) bad(`PDF 页高不是 54mm: ${PDF_PT_H}`);

  const empty = newScheme();
  if (questionsFilled(empty) !== 0) bad("空方案问询数应为 0");
  if (schemeTitle(empty) !== "未命名相遇") bad(`空方案标题: ${schemeTitle(empty)}`);

  const filled = newScheme({ scene: "visit", purpose: "deal", audience: "client", stage: "employed" });
  if (questionsFilled(filled) !== 4) bad("四问填完应为 4");
  if (!schemeTitle(filled).includes("拜访")) bad(`方案标题缺场合: ${schemeTitle(filled)}`);

  const archive = blankArchive();
  archive.profile = { ...EMPTY_PROFILE, ...DEMO.profile };
  archive.schemes = [filled];
  archive.activeId = filled.id;
  const st = toComposeState(archive);
  if (st.profile.name !== DEMO.profile.name) bad("档案人物料没进 compose 状态");
  if (st.scene !== "visit") bad("当前方案没进 compose 状态");

  const vcf = buildVCard(DEMO.profile, { showOrg: true, pitch: "把合作推进到下一步。" });
  if (!vcf.startsWith("BEGIN:VCARD")) bad("vCard 缺 BEGIN");
  if (!vcf.includes("FN:陈予安")) bad("vCard 缺姓名");
  if (!vcf.includes("N:陈;予安;;;")) bad(`vCard 姓名拆分不对: ${vcf}`);
  if (!vcf.includes("ORG:北境咨询")) bad("vCard 缺组织");
  if (!vcf.includes("微信 chenyuan_biz")) bad("vCard 微信应写进 NOTE");
  if (!vcf.includes("END:VCARD")) bad("vCard 缺 END");

  const hidden = buildVCard(DEMO.profile, { showOrg: false });
  if (hidden.includes("ORG:")) bad("藏组织时 vCard 仍有 ORG");

  const nasty = buildVCard({ ...EMPTY_PROFILE, name: "测;试", company: "A,B", wechat: "x\\y" }, { showOrg: true });
  if (nasty.includes("FN:测;试") && !nasty.includes("FN:测\\;试")) bad("vCard 分号未转义");
  if (!nasty.includes("FN:测\\;试")) bad("vCard 分号转义形式不对");

  const jpeg = Uint8Array.from(Buffer.from(
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFgABAQEAAAAAAAAAAAAAAAAAAAME/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAAPwCdA8f/2Q==",
    "base64",
  ));
  const pdf = Buffer.from(await pdfFromJpegs([
    { jpeg, width: 1, height: 1 },
    { jpeg, width: 1, height: 1 },
  ]).arrayBuffer()).toString("latin1");
  if (!pdf.startsWith("%PDF-1.4")) bad("PDF 缺文件头");
  if (!pdf.includes("/Count 2")) bad("PDF 应有两页");
  if (!pdf.includes(`/MediaBox [0 0 ${PDF_PT_W.toFixed(4)} ${PDF_PT_H.toFixed(4)}]`)) {
    bad("PDF 页面尺寸不是 90×54mm");
  }
  if (!pdf.includes("/Filter /DCTDecode")) bad("PDF 未嵌入 JPEG");
  if (!pdf.trimEnd().endsWith("%%EOF")) bad("PDF 缺文件尾");

  const { pickPaletteFamilies } = await import("./js/data.js");
  const drawn = pickPaletteFamilies(3);
  if (drawn.length !== 3) bad(`应抽出 3 套色系，实际 ${drawn.length}`);
  if (new Set(drawn.map((f) => f.id)).size !== 3) bad("抽出的三套色系应互不相同");
  if (pickPaletteFamilies(18).length !== 18) bad("抽满应覆盖全部 18 套");

  const cardCss = readFileSync(new URL("./css/styles.css", import.meta.url), "utf8");
  if (/text-overflow:\s*ellipsis/.test(cardCss)) bad("名片 CSS 不许用省略号截断文字");
  if (/line-height:\s*1\.12/.test(cardCss)) bad("姓名行高 1.12 会裁掉衬线体上下");
  if (!cardCss.includes("--paper: #f1f4f1")) bad("默认主题应保留雪松林纸色");

  const four = [
    { key: "phone", label: "电话", value: "138 0013 8000" },
    { key: "wechat", label: "微信", value: "chenyuan_biz" },
    { key: "email", label: "邮箱", value: "yuan.chen@example.com" },
    { key: "website", label: "站点", value: "bejing.example" },
  ];
  const squeezed = sanitizeSpec(
    { ...PRESETS.creative, copy: { maxUnder: 2, maxContacts: 4, contactStyle: "bare" } },
    "squeezed",
  );
  const fitted = fitPrintedContacts(four, squeezed);
  if (fitted.kept.length + fitted.overflow.length !== 4) bad("fitPrintedContacts 应保住全部条目");
  if (!fitted.overflow.length) bad("窄版面四条联系应溢出，不能靠省略号硬塞");
  const used =
    fitted.kept.reduce((sum, c) => sum + lineWidthCqw(c.value, squeezed.type.contactSize), 0) +
    Math.max(0, fitted.kept.length - 1) * 1.6;
  if (used - faceWidthCqw(squeezed) > 0.05) bad(`fit 后底栏仍超宽 ${used.toFixed(1)} / ${faceWidthCqw(squeezed).toFixed(1)}`);

  const identity = compose(base);
  const crowded = designCard(identity, { ...base, styleSpec: squeezed }, squeezed);
  if (crowded.contacts.length > fitted.kept.length + 1) {
    bad(`designCard 窄版面仍排了 ${crowded.contacts.length} 条联系`);
  }
  auditPrintFit("design:squeezed", crowded, base.profile);

  const stacked = sanitizeSpec(
    {
      ...PRESETS.authority,
      type: { ...PRESETS.authority.type, nameSize: 12, ornament: true },
      copy: { maxUnder: 2, maxContacts: 4, contactStyle: "stack" },
    },
    "stacked-tall",
  );
  const stackedDesign = designCard(identity, { ...base, styleSpec: stacked }, stacked);
  if (!printIssues(stackedDesign, base.profile).length) {
    bad("大姓名 + 竖排四条底栏应被印制规则拦住，不能直接拿给用户");
  }
}

console.log(fail ? `\n${fail} 处问题` : "\n全部通过");
process.exit(fail ? 1 : 0);
