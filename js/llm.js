/**
 * 大模型客户端：两段链路。
 *
 *   第一段 requestBrief()  场合 × 目的 × 人群 × 阶段 + 个人资历 → 一份名片设计稿（brief）
 *   第二段 requestStyles() 拿着这份设计稿 → 三份视觉规格（spec，前端直接渲染成 CSS）
 *
 * 两段都走 server.py 的 /api/design 代理，API key 不进浏览器。
 * 两段的产物都要过各自的清洗器（sanitizeBrief / sanitizeSpec）才允许进渲染路径。
 * 视觉还要过印制规则（printIssues）：叠字、裁字、超出版心的方案丢掉，整组重出。
 */

import { availableContacts, sanitizeBrief } from "./brief.js";
import { sanitizeSpec } from "./style-spec.js";
import { designCard, printIssues } from "./design.js";
import { CONTACT_LABELS, PALETTE_FAMILIES, STANCES } from "./data.js";

const COLOR = { type: "string", description: "六位十六进制颜色，如 #1b2428" };
const REF = {
  type: "string",
  description: "颜色引用：fg / muted / accent / bg / bg2 之一，或直接给六位 hex",
};

/* ==================== 第一段：设计稿 ==================== */

const BRIEF_SCHEMA = {
  type: "object",
  required: ["read", "stance", "stanceWhy", "masthead", "under", "contacts", "back", "omitted", "offstage", "tone"],
  properties: {
    read: {
      type: "string",
      description: "你对这次相遇的判断，一句中文，不超过 30 字。写分寸，不写形容词堆砌。",
    },
    stance: {
      type: "string",
      enum: Object.keys(STANCES),
      description: "形象立场：authority=权威 credible=专业可信 ambitious=锐意进取 warm=亲和开放 quiet=低调实力 creative=创意个性",
    },
    stanceWhy: { type: "string", description: "为什么是这个立场，一句中文，不超过 30 字" },
    masthead: {
      type: "string",
      description: "上排小字：组织名或城市，留空就给空字符串。组织被要求不上卡时绝不能写组织。",
    },
    mastheadWhy: { type: "string", description: "上排这样处理的理由，一句短话" },
    showNameEn: {
      type: "boolean",
      description: "英文名是否排在中文名下方。国内场合往往是多余的一行；设为 false 时请在 omitted 里说明。",
    },
    under: {
      type: "array",
      maxItems: 3,
      description: "姓名下的标签，0-3 条。可以改写用户给的头衔措辞，让它对得上这次的对象，但不许编造职级或业绩。",
      items: {
        type: "object",
        required: ["label"],
        properties: {
          label: { type: "string", description: "上卡的字，中文，不超过 14 字" },
          why: { type: "string", description: "为什么留这一条" },
        },
      },
    },
    contacts: {
      type: "array",
      maxItems: 4,
      description: "底栏联系方式，按对方事后最可能使用的顺序排。只能从「可用联系方式」里挑 key，不能编造号码。",
      items: {
        type: "object",
        required: ["key"],
        properties: {
          key: { type: "string", enum: ["wechat", "phone", "email", "website"] },
          why: { type: "string" },
        },
      },
    },
    contactWhy: { type: "string", description: "联系方式为什么这样排、这样取舍，一句中文" },
    back: {
      type: "object",
      required: ["kicker", "pitch", "cta"],
      properties: {
        kicker: { type: "string", description: "背面小标，中文 2-4 字" },
        pitch: { type: "string", description: "背面一句定位，中文不超过 20 字。是对外的自我定位，不是请愿，不许出现「求职」这类词" },
        cta: { type: "string", description: "背面行动号召，中文不超过 10 字" },
      },
    },
    backMode: {
      type: "string",
      enum: ["pitch", "en"],
      description:
        "背面内容：pitch=相遇故事（默认）；en=英文版背面，与中文正面构成中英对照。只有这次相遇明显涉外（国际场合、外籍对象、海外合作）且用户填了英文名时才选 en；选了就必须给全 backEn 字段",
    },
    backEn: {
      type: "object",
      description: "backMode 为 en 时必填：英文背面文案。英文要自然，不写中式英语",
      properties: {
        title: { type: "string", description: "英文头衔，从用户头衔自然翻译，不升级职级，如 Business Director" },
        kicker: { type: "string", description: "背面小标，英文 1-2 词，如 CONTACT" },
        cta: { type: "string", description: "英文行动号召，不超过 6 词，如 WeChat me anytime" },
      },
    },
    backTags: {
      type: "array",
      maxItems: 3,
      description: "背面的履历/能力标签，0-3 条短词。正面放不下但值得留证据的东西放这里。",
      items: { type: "string" },
    },
    omitted: {
      type: "array",
      maxItems: 6,
      description: "你决定不上卡的东西，以及为什么。这是设计稿最值钱的部分——用户要看见你替他拿掉了什么。",
      items: {
        type: "object",
        required: ["label", "reason"],
        properties: {
          label: { type: "string", description: "被拿掉的内容，如「现公司」「城市」「某个标签」" },
          reason: { type: "string", description: "拿掉的理由，一句短话" },
        },
      },
    },
    offstage: {
      type: "array",
      maxItems: 4,
      description: "私下策略：不印在卡上、但递卡时该怎么说、怎么留余地。每条一句中文。",
      items: { type: "string" },
    },
    tone: {
      type: "string",
      description:
        "给下一位视觉设计师的气质要求，一句中文不超过 40 字：这张卡该有的分量、密度、克制程度。不要给色号、不要点名色相——配色由视觉那一段自己决定。",
    },
  },
};

const BRIEF_TOOL = {
  name: "write_brief",
  description: "提交这次相遇的名片设计稿",
  input_schema: BRIEF_SCHEMA,
};

const BRIEF_SYSTEM = `你是一位替高管和创业者设计「对外身份」的商业顾问，兼名片的文案总监。你的判断力体现在取舍：一张 90×54mm 的卡，能留下的字极少，你要决定哪几个字值得留。

你现在做的是设计稿（brief）——决定什么字上卡、放在哪一区、为什么，以及不上卡的东西为什么不上。视觉（配色、字体、纸面）不由你决定，下一位设计师会按你的气质要求去做。

铁律：
1. 卡面是身份，不是请愿。任何情况下不许出现「求职」「找工作」「寻求机会」这类句子；求职的人在卡上应该是一个值得被邀请的专业人士。
2. 联系方式只能从给定的「可用联系方式」里挑 key。不许编造号码、邮箱、微信号，也不许挑用户没填的字段。
3. 组织的处理服从给定的组织策略。要求不上卡时，上排、姓名下、背面都不许出现现在的公司名。
4. 姓名下最多三条，底栏最多四条，且场合越嘈杂、阅读时间越短，就要更少。宁可留白。
5. 年龄、从业年限、行业只用来判断分寸（该端重还是该轻、该老派还是该锐），绝不上卡。
6. 用户填的头衔可以改写措辞，让它对得上这次的对象，但不许升级职级、不许编造业绩数字。
7. omitted 必须诚实：你拿掉的每一样都要给出理由，用户会读这一段来决定信不信你。
8. 设计稿不决定配色。tone 只谈分量、密度、克制程度，不许写色号，也不许点名色相（墨绿、金色、朱红…）。配色是下一位设计师的事。
9. 背面默认写相遇故事（backMode=pitch）。只有当这场相遇明显涉外——国际会议、外籍对象、海外合作——且用户填了英文名时，才把 backMode 设为 en，并给全套英文字段（title 从用户头衔自然翻译，不升职级）；英文要像母语者写的名片，同样不许出现求职类措辞。拿不准就留在 pitch。

先判断这次相遇的分寸，再决定纸面留哪几个字。不要解释，直接调用工具提交。`;

function profileLines(profile) {
  const has = (v) => Boolean(v && String(v).trim());
  const lines = [];
  const push = (label, value) => {
    if (has(value)) lines.push(`- ${label}：${String(value).trim()}`);
  };
  push("姓名", profile.name);
  push("英文名", profile.nameEn);
  push("现头衔", profile.title);
  push("现组织", profile.company);
  push("行业 / 职业", profile.trade);
  push("年龄", profile.age);
  push("从业年限", profile.years ? `${String(profile.years).trim()} 年` : "");
  push("城市", profile.city);
  push("能力标签", profile.tags);
  push("用户自己写的一句定位", profile.pitch);
  if (!lines.length) lines.push("- （资料还没填，按一位普通商务人士处理，姓名先留占位）");
  return lines;
}

function briefMessage(ctx) {
  const { profile, scene, purpose, audience, stage, companyMode, stanceFallback } = ctx;
  const available = availableContacts(profile);
  const lines = [
    "【这次相遇】",
    `- 场合：${scene?.label || "未指定"}${scene ? `（正式度 ${scene.formality}，信息密度 ${scene.density}，${scene.hint}）` : ""}`,
    `- 目的 / 用途：${purpose?.label || "未指定"}${purpose ? `（${purpose.hint}）` : ""}`,
    `- 目标人群：${audience?.label || "未指定"}${audience?.cares ? `（在乎：${audience.cares.join("、")}）` : ""}`,
    `- 我现在的阶段：${stage?.label || "未指定"}${stage ? `（${stage.hint}）` : ""}`,
    "",
    "【我是谁】",
    ...profileLines(profile),
    "",
    "【硬约束】",
    `- 组织策略：${
      { show: "组织可以上卡", hide: "组织绝不上卡", past: "组织只能以「曾任」形式出现在背面", optional: "组织可上可不上，你决定" }[
        companyMode
      ]
    }`,
    `- 可用联系方式（只能从这些 key 里挑）：${
      available.length ? available.map((c) => `${c.key}（${c.label}：${c.value}）`).join("；") : "用户一条都没填，contacts 给空数组"
    }`,
    `- 规则引擎的兜底立场是「${STANCES[stanceFallback].label}」，你可以不同意，但要在 stanceWhy 里说清为什么。`,
  ];
  if (stage?.stealth) {
    lines.push("- 我在职且不想暴露动向：卡上不能有任何现东家的痕迹，工作邮箱慎用，气质要克制。");
  }
  if (profile.portrait) {
    lines.push("- 我上传了头像，正面右上可能会压一张小尺寸肖像。");
  }
  lines.push("", "请给出这一份设计稿。");
  return lines.join("\n");
}

/* ==================== 第二段：按设计稿做视觉 ==================== */

const SPEC_SCHEMA = {
  type: "object",
  required: ["name", "layoutName", "rationale", "paper", "palette", "surface", "frame", "type", "decor", "copy"],
  properties: {
    name: { type: "string", description: "风格名，中文 3-6 字，像设计公司给方案取的代号" },
    layoutName: { type: "string", description: "构图名，中文 3-6 字，说明骨架而不是情绪" },
    rationale: { type: "string", description: "一句中文：这个视觉为什么对得上设计稿的气质要求。不超过 40 字" },
    paper: { type: "string", description: "纸张与印刷工艺，中文一句，供生图提示词使用" },
    promptNote: {
      type: "string",
      description:
        "给生图模型的一句艺术指导（中文，不超过 40 字）：这张卡的光感、质感、拍摄或印刷的感觉。不要重复色号和字号，那些前端会自动附上。",
    },
    palette: {
      type: "object",
      required: ["bg", "fg", "muted", "accent", "bgMode"],
      properties: {
        bg: COLOR,
        bg2: { ...COLOR, description: "渐变第二色，bgMode 为 flat 时可省略" },
        bgMode: { type: "string", enum: ["flat", "linear", "radial"] },
        bgAngle: { type: "number", description: "线性渐变角度 0-360" },
        fg: { ...COLOR, description: "主文字色，必须与 bg 有强对比" },
        muted: { ...COLOR, description: "次级文字色" },
        accent: { ...COLOR, description: "强调色，只用一个" },
      },
    },
    surface: {
      type: "object",
      properties: {
        grain: { type: "number", description: "纸纹强度 0-0.55" },
        vignette: { type: "number", description: "暗角 0-0.4，浅色纸一般为 0" },
        radius: { type: "number", description: "圆角 0-3（cqw），正式场合用 0" },
        monogram: { type: "number", description: "背景姓氏水印透明度 0-0.14，0 为不用" },
      },
    },
    frame: {
      type: "object",
      required: ["align", "anchor", "pad"],
      properties: {
        align: { type: "string", enum: ["left", "center", "right"] },
        anchor: { type: "string", enum: ["top", "center", "bottom"], description: "主体在版面的纵向位置" },
        pad: {
          type: "object",
          required: ["t", "r", "b", "l"],
          properties: {
            t: { type: "number", description: "上留白 4-18（%）" },
            r: { type: "number", description: "右留白 4-40（%）" },
            b: { type: "number", description: "下留白 4-18（%）" },
            l: { type: "number", description: "左留白 4-40（%）" },
          },
        },
      },
    },
    type: {
      type: "object",
      required: ["nameFamily", "nameSize", "nameTrack", "nameWeight", "roleSize", "contactSize"],
      properties: {
        nameFamily: { type: "string", enum: ["display", "serif", "sans", "mono"] },
        nameSize: { type: "number", description: "姓名字号 4.6-12.5（cqw）" },
        nameTrack: { type: "number", description: "姓名字距。中文衬线/海报体不要超过 0.18，过大会缺笔、上下被裁" },
        nameWeight: { type: "number", enum: [200, 300, 400, 500, 600, 700] },
        nameVertical: { type: "boolean", description: "姓名是否沿侧边竖排。为 true 时应在同侧放一条宽色块 edge" },
        nameSide: { type: "string", enum: ["left", "right"] },
        nameColor: { ...REF, description: "竖排压在色块上时要给一个能在色块上看清的颜色" },
        mastheadSize: { type: "number", description: "上排小字 2.2-3.8（cqw）。90mm 卡上低于 2.2 会看不清，不要再小" },
        mastheadTrack: { type: "number", description: "上排字距。中文组织名不要超过 0.22" },
        mastheadColor: REF,
        upperMasthead: { type: "boolean", description: "上排是否转大写。中文组织名建议 false" },
        roleSize: { type: "number", description: "姓名下标签 2.3-4.2（cqw）。中文标签默认 2.8 左右" },
        roleTrack: { type: "number", description: "标签字距。中文不要超过 0.12，过大会像漏字" },
        roleColor: REF,
        contactSize: { type: "number", description: "底栏联系 2.2-3.6（cqw）。电话邮箱默认 2.6 左右，不要做成微缩字" },
        contactAlign: { type: "string", enum: ["left", "center", "right"] },
        ornament: { type: "boolean", description: "姓名下是否加一个菱形分隔饰件，请柬感专用" },
      },
    },
    decor: {
      type: "array",
      maxItems: 4,
      description: "纸面装饰层，0-4 层。层数少而准比堆满好。",
      items: {
        type: "object",
        required: ["kind"],
        properties: {
          kind: {
            type: "string",
            enum: ["edge", "wedge", "grid", "stripes", "frame", "corners", "rule", "seal"],
            description:
              "edge=某一侧的色条/色块/色晕；wedge=斜切色楔；grid=细网格；stripes=斜线纹；frame=内凹版框；corners=对角角标；rule=一段细线；seal=角上印记",
          },
          side: { type: "string", enum: ["left", "right", "top", "bottom"] },
          size: { type: "number", description: "edge 宽/高占比 0.8-42（%）；wedge 8-40；seal 4-20" },
          fade: { type: "boolean", description: "edge 专用：做成透明到实色的色晕" },
          gradient: { type: "boolean", description: "edge 专用：色条内部走明暗渐变，像烫印" },
          skew: { type: "number", description: "wedge 斜度 0-90" },
          cell: { type: "number", description: "grid 网格间距 3-25（%）" },
          angle: { type: "number", description: "stripes 角度 0-180" },
          gap: { type: "number", description: "stripes 间距 1.2-12（%）" },
          inset: { type: "number", description: "frame / corners 内缩 1.5-12（%）" },
          width: { type: "number", description: "线宽 0.12-1.2（cqw）" },
          length: { type: "number", description: "rule 长度 8-100（%）" },
          offset: { type: "number", description: "rule 距边 0-40（%）" },
          corner: { type: "string", enum: ["tl", "tr", "bl", "br"] },
          shape: { type: "string", enum: ["circle", "square", "diamond"] },
          filled: { type: "boolean" },
          color: REF,
          opacity: { type: "number", description: "0.04-1" },
        },
      },
    },
    copy: {
      type: "object",
      required: ["maxUnder", "maxContacts", "contactStyle"],
      properties: {
        maxUnder: { type: "number", description: "姓名下最多几条标签 1-3。装不下就少放，不要为了塞字抬高上限" },
        maxContacts: { type: "number", description: "底栏最多几条联系 1-4。一行排不下就少放或改 stack，不许靠省略号截断" },
        contactStyle: { type: "string", enum: ["bare", "row", "stack"], description: "bare=裸排；row=上方加一条分隔线；stack=竖着堆。stack 条数必须按 90×54 的高度来，装不下就少放或改 bare/row，不许叠到姓名上" },
      },
    },
    qr: {
      type: "object",
      description:
        "二维码位：把用户的微信二维码织进这套构图。有码和无码应当是两套不同的排布，不是同一张卡贴一个码。用户没传图时留位也不会印出来，属于零成本预留。",
      properties: {
        show: { type: "boolean", description: "这套构图是否织入二维码位" },
        face: { type: "string", enum: ["front", "back"], description: "码放哪一面。正面只许左下/右下（上角有上排和肖像）；放上方就放背面" },
        corner: { type: "string", enum: ["tl", "tr", "bl", "br"], description: "四角之一，随构图骨架选，不要千篇一律右下" },
        size: { type: "number", description: "二维码边长 13-26（cqw）。低于 13 印出来扫不动" },
        mount: { type: "string", enum: ["bare", "quiet", "framed"], description: "装裱：bare=裸贴；quiet=同底色浅装裱；framed=细线框。深底设计用 bare 或 framed" },
      },
    },
  },
};

const STYLE_TOOL = {
  name: "propose_styles",
  description: "提交三个视觉规格方案",
  input_schema: {
    type: "object",
    required: ["styles"],
    properties: {
      styles: { type: "array", minItems: 3, maxItems: 3, items: SPEC_SCHEMA },
    },
  },
};

const STYLE_SYSTEM = `你是一位为高管和创业者做「对外身份」的平面设计师，专攻商务名片。你懂纸、懂印刷、懂中文排版，也懂商业分寸。

上一位顾问已经交给你一份设计稿：什么字上卡、放哪一区、气质要什么，都定了。你不改文案，只做视觉。

你的输出是结构化设计规格，前端会按规格用 CSS 渲染出真实的 90×54mm 名片，所以规格必须是能落到纸上的决定，不是情绪形容词。

铁律：
1. 一次给三个方案，三者必须明显不同——不同的色相家族、不同的明暗关系、不同的构图骨架、不同的装饰手法。不要出三个只改了深浅的同一张绿卡或同一张黑卡。
2. 三个方案都必须让设计稿的字完整出现在 90×54mm 上：装得下就排，装不下就少放（maxUnder / maxContacts 按这套构图能印的条数来），溢出的前端会记进「不上卡」。名片上不许出现省略号、不许把电话邮箱截成 138 0...。
3. 主文字与底色必须拉开对比。底 / 底2 / 主文字 / 次文字 / 强调 这五个槽都可以用不同色相；装饰层还可以另给 hex，不必收成「三色印刷」。一张卡不必须是单色。
4. 工作室界面是雪松绿，那是网页皮肤，与名片无关。不要把三张卡都做成墨绿、冷绿白或树皮棕。
5. 中文姓名不要转大写；中文组织名把 upperMasthead 设为 false。
6. 装饰层宁少勿多。留白本身就是最贵的设计。
7. 若 nameVertical 为 true，必须在同一侧放一条宽度 22-34 的 edge 色块，并给 nameColor 一个能压在色块上看清的颜色。
8. 场合越嘈杂、阅读时间越短，字号越大、条目越少。上排 / 姓名下 / 底栏不要低于约 2.4cqw——90×54mm 上更小的字印出来等于没有。
9. 色相按这次相遇自己选。模板有墨金、骨白青、夜橙、陶土、雪墨、亚麻紫、朱砂、海纹、松墨、青瓷、黛蓝、玫瑰木、石墨、琥珀、象牙酒红、玄银、青砖、麦秆，也可以自创，只要印得出、看得清。工作室网页的雪松绿与名片无关。
10. 中文不要拉大字距、不要压行高。宋体和海报体出格会缺笔，看起来像错字；姓名下标签尤其如此。字距宁紧勿松，行高必须让横笔和宝盖完整露出来。
11. 90×54mm 上上排、姓名、头衔、底栏必须各在各的区，不许重叠、不许裁掉笔画、不许用省略号截断。竖排底栏尤其容易把头衔和电话叠在一起——宁可少放一条或改成一行，也不要交一份印不全的稿。前端会按纸面检查，过不了会整组重出。
12. 用户上传了微信二维码图时，把码位织进这套构图：face（正面只许左下/右下，背面四角皆可）、corner、size 13-26、mount（bare=裸贴，quiet=同底色浅装裱，framed=细线框）。有码和无码必须是两套不同的排布——让底栏或上排给码让位，位置跟着这套构图的骨架走，禁止每张都千篇一律贴右下。

先读懂设计稿的气质要求，再决定纸面。不要解释，直接调用工具提交。`;

function paletteCatalog() {
  return PALETTE_FAMILIES.map(
    (f) => `- ${f.label}（${f.id}）：${f.blurb}　样例 ${f.swatches.join(" / ")}`,
  ).join("\n");
}

function styleMessage(brief, ctx, paletteHint) {
  const { scene, purpose, audience, stage, profile } = ctx;
  const name = profile.name?.trim();
  const hints = Array.isArray(paletteHint)
    ? paletteHint.map((id) => PALETTE_FAMILIES.find((f) => f.id === id)).filter(Boolean)
    : paletteHint
      ? [PALETTE_FAMILIES.find((f) => f.id === paletteHint)].filter(Boolean)
      : [];
  const lines = [
    "【设计稿】",
    `- 这次相遇：${brief.read || "（未写）"}`,
    `- 形象立场：${STANCES[brief.stance].label} —— ${brief.stanceWhy || STANCES[brief.stance].blurb}`,
    `- 气质要求（分量与密度，不是配色）：${brief.tone || "（未写，按立场自行判断）"}`,
    "",
    "【必须排上纸面的文字】",
    `- 上排：${brief.masthead || "（留空）"}`,
    `- 姓名：${name || "（尚未填写，按两到三个汉字预留）"}${brief.showNameEn && profile.nameEn?.trim() ? ` / ${profile.nameEn.trim()}` : ""}`,
    `- 姓名下（${brief.under.length} 条）：${brief.under.map((u) => u.label).join(" · ") || "（留空）"}`,
    `- 底栏（${brief.contacts.length} 条）：${brief.contacts.map((c) => `${CONTACT_LABELS[c.key]} ${c.value}`).join("  ·  ") || "（留空）"}`,
    `- 背面：${brief.back.kicker}｜${brief.back.pitch}｜${brief.back.cta}${
      brief.backTags.length ? `｜标签 ${brief.backTags.map((b) => b.label).join(" · ")}` : ""
    }`,
    "",
    "【色系】",
    "工作室网页是雪松绿，名片不受此限。下面是完整色系库，不是封闭名单。",
    paletteCatalog(),
  ];
  if (hints.length === 1) {
    const picked = hints[0];
    lines.push(
      `用户指定了色系「${picked.label}」：三版都落在这个色相里，靠构图和明度分家，不要飘到别的色相。样例 ${picked.swatches.join(" / ")}。`,
    );
  } else if (hints.length >= 2) {
    lines.push("这一次从色系库里抽了三套。三个方案必须分别落在这三套里：方案一用第一套，方案二用第二套，方案三用第三套。不要换成库外的色，也不要三张走同一套。");
    hints.forEach((f, i) => {
      lines.push(`${i + 1}. ${f.label}（${f.id}）：${f.blurb}　样例 ${f.swatches.join(" / ")}`);
    });
  } else {
    lines.push("用户没有指定色系：三个方案必须走三个不同的色相家族，禁止三张都是绿、都是黑、或只改明度。");
  }
  lines.push(
    "",
    "【场合参数】",
    `- 场合：${scene?.label || "未指定"}${scene ? `（正式度 ${scene.formality}，信息密度 ${scene.density}）` : ""}`,
    `- 目的：${purpose?.label || "未指定"}　对象：${audience?.label || "未指定"}`,
  );
  if (stage?.stealth) lines.push("- 此人在职且不想暴露动向：不要张扬的大色块，气质克制。");
  if (profile.portrait) lines.push("- 正面右上会压一张小尺寸肖像，右侧要留出空间。");
  if (profile.qrImage) lines.push("- 我上传了微信二维码图：把码位织进这套构图（qr 的 face/corner/size/mount 由你定），正面只许左下右下，背面四角皆可。");
  lines.push("", "请给出三个视觉方案。");
  return lines.join("\n");
}

/* ==================== 共用请求层 ==================== */

async function callDesigner({ system, tool, message, maxTokens }) {
  const res = await fetch("/api/design", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system,
      max_tokens: maxTokens,
      temperature: 1,
      tools: [tool],
      tool_choice: { type: "tool", name: tool.name },
      messages: [{ role: "user", content: message }],
    }),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload.error || payload?.error?.message || `设计服务返回 ${res.status}`);
  }
  const block = (payload.content || []).find((b) => b.type === "tool_use");
  if (!block?.input) {
    if (payload.stop_reason === "max_tokens") {
      throw new Error("模型把输出额度用完了还没交稿（多半是在长篇思考）。重试一次，或在 .env 里换一家上游。");
    }
    throw new Error("模型没有按规格返回，再试一次。");
  }
  return block.input;
}

/** 第一段：写设计稿。 */
export async function requestBrief(ctx) {
  const input = await callDesigner({
    system: BRIEF_SYSTEM,
    tool: BRIEF_TOOL,
    message: briefMessage(ctx),
    maxTokens: 2048,
  });
  return sanitizeBrief(input, ctx, `brief-${Date.now()}`);
}

const STYLE_ATTEMPTS = 3;

/** 第二段：按设计稿出三版视觉。paletteHint 可以是一个色系 id、一组 id，或空。过不了印制规则的方案丢掉，整组再要。 */
export async function requestStyles(brief, ctx, paletteHint = "") {
  const accepted = [];
  let extra = "";
  let lastIssue = "";
  for (let attempt = 0; attempt < STYLE_ATTEMPTS && accepted.length < 3; attempt++) {
    const input = await callDesigner({
      system: STYLE_SYSTEM,
      tool: STYLE_TOOL,
      message: styleMessage(brief, ctx, paletteHint) + extra,
      maxTokens: 8192,
    });
    const styles = input.styles;
    if (!Array.isArray(styles) || !styles.length) {
      throw new Error("模型没有按规格返回方案，再试一次。");
    }
    for (const raw of styles) {
      if (accepted.length >= 3) break;
      const spec = sanitizeSpec(raw, `llm-${Date.now()}-${accepted.length}`);
      const design = designCard({ brief, scene: ctx.scene }, { profile: ctx.profile || {}, edits: {} }, spec);
      const issues = printIssues(design, ctx.profile || {});
      if (issues.length) {
        lastIssue = issues[0];
        continue;
      }
      accepted.push(spec);
    }
    if (accepted.length < 3) {
      extra = `\n\n上一轮有方案印不到 90×54mm 上（${lastIssue || "叠字、裁字或超出版心"}）。请换构图或少放底栏，不要再交同样的骨架。`;
    }
  }
  if (accepted.length < 3) {
    throw new Error("三版视觉印不到 90×54mm 上，请再试一次。");
  }
  return accepted.slice(0, 3);
}
