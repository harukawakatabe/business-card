import { STANCES } from "./data.js";

function colorFor(stanceId) {
  switch (stanceId) {
    case "authority":
      return { bg: "near-black (#161412)", ink: "warm ivory (#f3ead8)", accent: "oxidized gold (#c4a574)" };
    case "ambitious":
      return { bg: "ink navy (#0e1116)", ink: "paper white (#f7f7f5)", accent: "hard orange (#e85d04)" };
    case "warm":
      return { bg: "warm beige (#f7efe4)", ink: "walnut (#3d2b1f)", accent: "terracotta (#a65d3f)" };
    case "quiet":
      return { bg: "pure white", ink: "black (#111)", accent: "none, hairline rules only" };
    case "creative":
      return { bg: "raw linen (#ece7dc)", ink: "black", accent: "one inked plum block (#5b2d8e)" };
    default:
      return { bg: "uncoated ivory (#f4f1ea)", ink: "slate (#1c2428)", accent: "muted teal bar (#2f5d62)" };
  }
}

function layoutNote(strategy) {
  const density = strategy.scene?.density ?? 0.55;
  const align = strategy.stanceId === "warm" ? "centered, invitation-like" : "left aligned, editorial";
  const photo = strategy.showPortrait
    ? "small portrait, top-right, never larger than the name"
    : "no portrait, Chinese business-card convention";
  if (density < 0.45) {
    return `${align}. Sparse: name, one identity line, one contact. Generous margins. ${photo}.`;
  }
  if (density > 0.65) {
    return `${align}. Conference-readable: large name, high-contrast identity line, up to four contacts in a quiet column. ${photo}.`;
  }
  return `${align}. Classic 90×54mm: name, identity, one-line positioning on the back. ${photo}.`;
}

function textBlock(strategy, profile) {
  const name = profile.name?.trim() || "[Name]";
  const nameEn = profile.nameEn?.trim();
  const lines = [
    `Front name: ${name}${nameEn ? ` / ${nameEn}` : ""}`,
    `Front identity line: ${strategy.headline || "[role]"}`,
    `Back kicker: ${strategy.back.kicker}`,
    `Back positioning: ${strategy.pitch}`,
    `Back CTA: ${strategy.cta}`,
  ];
  for (const c of strategy.contacts) lines.push(`Contact ${c.label}: ${c.value}`);
  if (strategy.companyMode === "hide") {
    lines.push("Do NOT print current employer or work email.");
  }
  return lines.join("\n");
}

export function buildPrompts(state, strategy) {
  const stance = strategy.stance || STANCES.credible;
  const colors = colorFor(strategy.stanceId);
  const profile = state.profile || {};
  const texts = textBlock(strategy, profile);
  const paper = stance.paper;
  const type = stance.type;
  const layout = layoutNote(strategy);
  const scene = strategy.scene?.label || "商务场合";
  const audience = strategy.audience?.label || "商务对象";
  const purpose = strategy.purpose?.label || "建立联系";

  const zh = [
    `设计一张真实可印制的中国商务名片，成品尺寸 90×54mm，双面。`,
    `这不是海报，不是APP界面，不是插画角色卡。它是要递到「${audience}」手里、用在「${scene}」、服务于「${purpose}」的身份物件。`,
    `形象立场：${stance.label}。${stance.blurb}`,
    `纸面与工艺：${paper}。印刷干净，可想象成实拍静物：名片平放在桌面上，或微微抬起看到纸边厚度。`,
    `字体气质：${type}。中文为主，英文名为辅。禁止艺术字、霓虹、赛博朋克、水印、乱码。`,
    `色彩：底 ${colors.bg}，字 ${colors.ink}，强调色 ${colors.accent}。最多三种颜色。`,
    `排版：${layout}`,
    `必须清晰可读地排上这些文字（不要改写、不要翻译成英文为主）：`,
    texts,
    `背面有一句定位和行动号召，不要放二维码占满、不要放图标矩阵、不要放照片拼贴。`,
    `镜头：微距产品摄影，柔和自然光，浅景深可选，焦点在名片上。4k, 纸纹可见。`,
    `不要：人物全身、风景、卡通、发光特效、透视夸张到看不清字、把名片做成卡片游戏。`,
  ].join("\n");

  const en = [
    `Design a real, printable Chinese business card, finished size 90×54mm, double-sided.`,
    `This is a physical identity object, not a poster, UI mock, or character card. It will be handed to "${audience}" at "${scene}", in service of "${purpose}".`,
    `Stance: ${stance.label} — ${stance.blurb}`,
    `Paper & finish: ${paper}. Look like a product photo of a printed card; show paper thickness and fiber.`,
    `Typography: ${type}. Chinese primary, English name secondary if present. No display gimmicks, neon, cyberpunk, watermarks.`,
    `Palette: background ${colors.bg}; ink ${colors.ink}; accent ${colors.accent}. Three colors maximum.`,
    `Layout: ${layout}`,
    `Set this copy exactly (do not rewrite; keep Chinese as given):`,
    texts,
    `Back: one positioning sentence and a quiet CTA. No giant QR, no icon grid, no collage.`,
    `Camera: macro product photography, soft daylight, optional shallow depth of field, 4K, visible paper grain.`,
    `Avoid: full-body people, landscapes, cartoons, glow effects, extreme perspective that kills legibility, trading-card game looks.`,
  ].join("\n");

  return { zh, en };
}
