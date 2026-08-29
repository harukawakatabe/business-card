import { describeDecor } from "./style-spec.js";

const FAMILY_EN = {
  display: "high-contrast display serif (Didot-like)",
  serif: "Chinese serif (Songti)",
  sans: "geometric sans (Avenir / PingFang)",
  mono: "monospace",
};

const SIDE_EN = { left: "left", right: "right", top: "top", bottom: "bottom" };
const CORNER_EN = { tl: "top-left", tr: "top-right", bl: "bottom-left", br: "bottom-right" };

function decorEn(spec) {
  return spec.decor
    .map((d) => {
      if (d.kind === "edge") {
        return d.fade
          ? `${SIDE_EN[d.side]} ${d.size.toFixed(0)}% color wash fading out`
          : `${SIDE_EN[d.side]} ${d.size.toFixed(1)}% ${d.size > 12 ? "solid color block" : "printed spine"}`;
      }
      if (d.kind === "wedge") return `${SIDE_EN[d.side]} ${d.size.toFixed(0)}% angled color wedge`;
      if (d.kind === "grid") return `faint ${d.cell.toFixed(0)}% grid, opacity ${d.opacity.toFixed(2)}`;
      if (d.kind === "stripes") return `${d.angle.toFixed(0)}° hairline hatching, ${d.gap.toFixed(1)}% pitch`;
      if (d.kind === "frame") return `inset plate border, ${d.inset.toFixed(1)}% margin`;
      if (d.kind === "corners") return "diagonal corner brackets";
      if (d.kind === "rule") return `${SIDE_EN[d.side]} hairline rule, ${d.length.toFixed(0)}% long`;
      if (d.kind === "seal") return `${CORNER_EN[d.corner]} ${d.shape} seal mark`;
      return "";
    })
    .filter(Boolean);
}

export function buildPrompts(state, strategy) {
  const design = strategy.design;
  const spec = design?.spec;
  if (!spec) return { zh: "", en: "" };

  const t = spec.type;
  const p = spec.palette;
  const brief = strategy.brief;
  const profile = state.profile || {};
  const name = profile.name?.trim() || "[姓名]";
  const nameEn = design.showNameEn ? profile.nameEn.trim() : "";
  const top = design.top.map((x) => x.label).join("、") || "（上排留白）";
  const under = design.under.map((x) => x.label).join(" · ") || "（姓名下无标签）";
  const bottom = design.contacts.map((c) => c.value).join("  ·  ") || "（底栏无联系）";
  const backTags = design.backTags.map((x) => x.label).join(" · ");
  const omitted = design.omitted.map((x) => `${x.label}（${x.reason}）`).join("；");

  const decorZh = describeDecor(spec);
  const anchorZh = { top: "偏上", center: "居中", bottom: "压底" }[spec.frame.anchor];
  const alignZh = { left: "左对齐", center: "居中", right: "右对齐" }[spec.frame.align];

  const zh = [
    `设计一张真实可印制的中国商务名片，成品 90×54mm，双面，要有纸边厚度和纤维。这是身份物件，不是海报、不是 UI、不是游戏卡。`,
    `风格：${spec.name}（${spec.layoutName}）。${spec.rationale}`,
    brief?.tone ? `气质（设计稿的要求）：${brief.tone}` : "",
    spec.promptNote ? `画面感觉：${spec.promptNote}` : "",
    `纸面：${spec.paper}。`,
    `色彩（严格照用，最多三色）：底 ${p.bg}${p.bgMode !== "flat" ? `，向 ${p.bg2} 做${p.bgMode === "radial" ? "径向" : `${p.bgAngle.toFixed(0)}° 线性`}渐变` : "，平涂"}；主文字 ${p.fg}；次级文字 ${p.muted}；强调色 ${p.accent}。`,
    `纸面装饰${decorZh.length ? `：${decorZh.join("；")}` : "：仅纸纹，无额外装饰，靠留白撑住"}。`,
    `构图：正文${alignZh}，主体${anchorZh}；四边留白 上 ${spec.frame.pad.t.toFixed(0)}% / 右 ${spec.frame.pad.r.toFixed(0)}% / 下 ${spec.frame.pad.b.toFixed(0)}% / 左 ${spec.frame.pad.l.toFixed(0)}%。`,
    `正面分区（严格遵守，不要把所有信息堆在中间）：`,
    `- 上排（小字，字距 ${t.mastheadTrack.toFixed(2)}em）：${top}`,
    `- 主名（${
      { display: "高对比展示衬线（Didot 感）", serif: "宋体衬线", sans: "几何无衬线（苹方 / Avenir）", mono: "等宽" }[t.nameFamily]
    }，字号约版宽的 ${t.nameSize.toFixed(1)}%，字距 ${t.nameTrack.toFixed(2)}em，字重 ${t.nameWeight}${
      t.nameVertical ? `，沿${t.nameSide === "left" ? "左" : "右"}侧竖排压在色块上` : ""
    }）：${name}${nameEn ? ` / ${nameEn}` : ""}`,
    `- 姓名下标签（用间隔点，不要做成 APP 胶囊）：${under}`,
    `- 底栏联系（${{ bare: "裸排", row: "上方一条分隔线", stack: "竖向堆叠" }[spec.copy.contactStyle]}，${
      { left: "左对齐", center: "居中", right: "右对齐" }[t.contactAlign]
    }）：${bottom}`,
    t.ornament ? `- 姓名与标签之间加一个细菱形分隔饰件。` : "",
    spec.qr?.show
      ? `- ${spec.qr.face === "back" ? "背面" : "正面"}${spec.qr.corner === "tl" ? "左上" : spec.qr.corner === "tr" ? "右上" : spec.qr.corner === "bl" ? "左下" : "右下"}角预留约版宽 ${spec.qr.size.toFixed(0)}% 的${
          { quiet: "同底色浅装裱", framed: "细线框装裱" }[spec.qr.mount] || "无装裱"
        }二维码贴图区：只留干净的空位，不要生成任何伪二维码图案。`
      : "",
    strategy.backMode === "en"
      ? `背面为英文版，与中文正面构成中英对照：小标「${strategy.backEn.kicker}」、英文名「${strategy.backEn.name}」${strategy.backEn.title ? `、头衔「${strategy.backEn.title}」` : ""}${strategy.backEn.cta ? `、CTA「${strategy.backEn.cta}」` : ""}。英文排版与正面同一套骨架，联系方式以英文标签重排，装饰镜像。`
      : `背面：一句定位「${strategy.pitch}」${backTags ? `；技能/履历标签：${backTags}` : ""}。CTA：${strategy.cta}。背面沿用同一套色彩与纸面，侧边装饰镜像到另一侧。`,
    omitted ? `设计师决定不上卡：${omitted}` : "",
    `背景必须被设计，不要纯色平涂到底。文字必须可读，主文字与底色对比要足。`,
    `禁止：霓虹、赛博朋克、水印网站、二维码铺满、图标矩阵、人物全身、卡通。`,
  ]
    .filter(Boolean)
    .join("\n");

  const decorList = decorEn(spec);
  const en = [
    `Design a real printable Chinese business card, 90×54mm, double-sided, with paper thickness and fiber. An identity object, not a poster or UI.`,
    `Style: ${spec.name} (${spec.layoutName}).`,
    brief?.tone ? `Required feel (from the brief): ${brief.tone}` : "",
    spec.promptNote ? `Art direction: ${spec.promptNote}` : "",
    `Paper: ${spec.paper}.`,
    `Palette (use exactly, three inks max): background ${p.bg}${
      p.bgMode !== "flat" ? ` graded toward ${p.bg2} (${p.bgMode === "radial" ? "radial" : `${p.bgAngle.toFixed(0)}° linear`})` : " flat"
    }; primary type ${p.fg}; secondary ${p.muted}; accent ${p.accent}.`,
    `Surface decoration${decorList.length ? `: ${decorList.join("; ")}` : ": paper grain only, carried by white space"}.`,
    `Composition: copy ${spec.frame.align}-aligned, mass sitting ${spec.frame.anchor}; margins T ${spec.frame.pad.t.toFixed(
      0,
    )}% / R ${spec.frame.pad.r.toFixed(0)}% / B ${spec.frame.pad.b.toFixed(0)}% / L ${spec.frame.pad.l.toFixed(0)}%.`,
    `Front zones (do not dump all copy in the center):`,
    `- Top small line, tracking ${t.mastheadTrack.toFixed(2)}em: ${top}`,
    `- Name (${FAMILY_EN[t.nameFamily]}, ~${t.nameSize.toFixed(1)}% of card width, tracking ${t.nameTrack.toFixed(
      2,
    )}em, weight ${t.nameWeight}${t.nameVertical ? `, set vertically along the ${t.nameSide} color block` : ""}): ${name}${
      nameEn ? ` / ${nameEn}` : ""
    }`,
    `- Tags under name (middots, no app chips): ${under}`,
    `- Footer contacts (${spec.copy.contactStyle}, ${t.contactAlign}-aligned): ${bottom}`,
    t.ornament ? `- Thin diamond divider between name and tags.` : "",
    spec.qr?.show
      ? `- Reserve a clean square zone (~${spec.qr.size.toFixed(0)}% of card width) at the ${
          spec.qr.face === "back" ? "back" : "front"
        } ${spec.qr.corner === "tl" ? "top-left" : spec.qr.corner === "tr" ? "top-right" : spec.qr.corner === "bl" ? "bottom-left" : "bottom-right"} corner for a WeChat QR sticker${
          spec.qr.mount === "quiet" ? ", on a subtle same-tone plate" : spec.qr.mount === "framed" ? ", inside a hairline frame" : ""
        }: leave it blank, do NOT draw any fake QR pattern.`
      : "",
    strategy.backMode === "en"
      ? `Back is the English twin of the Chinese front: kicker “${strategy.backEn.kicker}”, English name “${strategy.backEn.name}”${strategy.backEn.title ? `, title “${strategy.backEn.title}”` : ""}${strategy.backEn.cta ? `, CTA “${strategy.backEn.cta}”` : ""}. Same layout skeleton, contacts re-set with English labels, mirrored decoration.`
      : `Back: positioning line “${strategy.pitch}”${backTags ? `; tags: ${backTags}` : ""}. CTA: ${strategy.cta}. Same palette and paper, side decoration mirrored.`,
    omitted ? `Designer omitted: ${omitted}` : "",
    `The background MUST be designed, not a flat fill. Type must stay legible against the ground.`,
    `Avoid neon, cyberpunk, site watermarks, giant QR, icon grids, full-body people, cartoons.`,
  ]
    .filter(Boolean)
    .join("\n");

  return { zh, en };
}
