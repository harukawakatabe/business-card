/**
 * 名片渲染层：设计稿 → HTML。
 *
 * 这里不读 state、不碰 DOM 事件，只把 designCard() 的产物和 spec 变成标记，
 * 所以工作室预览、打印版和候选缩略图能共用同一条渲染路径。
 */

import { decorHtml, specToVars } from "./style-spec.js";

export function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function cardMarkup(strategy, profile, face, design = strategy.design) {
  const spec = design.spec;
  const t = spec.type;
  const name = profile.name?.trim() || "你的名字";
  const muted = !profile.name?.trim();
  const photo =
    face === "front" && strategy.showPortrait && profile.portrait
      ? `<img class="portrait" alt="" src="${profile.portrait}" />`
      : "";
  // 二维码位只在用户真贴了图时渲染；没图时留位零成本，纸面不出现空框。
  const qrOn = face === "front" && spec.qr?.show && Boolean(profile.qrImage);
  const qr = qrOn ? `<img class="card-qr" alt="" src="${profile.qrImage}" />` : "";
  const top = design.top.map((x) => escapeHtml(x.label)).join("  ");
  const under = design.under.map((x) => escapeHtml(x.label)).join("  ·  ");
  const contacts = design.contacts.map((c) => `<span>${escapeHtml(c.value)}</span>`).join("");
  const backTags = design.backTags.map((x) => escapeHtml(x.label)).join("  ·  ");
  const ornament = t.ornament ? `<div class="ornament"></div>` : "";

  const flip = face === "back";
  const open = `<article class="card${flip ? " is-back" : ""}" data-contact="${
    spec.copy.contactStyle
  }" data-qr="${qrOn ? spec.qr.corner : ""}" style="${specToVars(spec, flip)}">
    <div class="card-surface" aria-hidden="true">${decorHtml(spec, escapeHtml(design.monogram), flip)}</div>`;

  if (face === "back") {
    return `${open}
      <div class="card-face">
        <div class="z-top"><span class="back-kicker">${escapeHtml(strategy.back.kicker)}</span></div>
        <div class="z-hero">
          ${ornament}
          <div class="back-pitch">${escapeHtml(strategy.back.pitch)}</div>
          ${backTags ? `<div class="back-tags">${backTags}</div>` : ""}
        </div>
        <div class="z-bottom"><span class="back-cta">${escapeHtml(strategy.cta)}</span></div>
      </div>
    </article>`;
  }

  const nameEl = t.nameVertical
    ? `<div class="card-name is-vertical" data-side="${t.nameSide}"${
        muted ? ' style="opacity:.4"' : ""
      }>${escapeHtml(name)}</div>`
    : `<div class="card-name"${muted ? ' style="opacity:.4"' : ""}>${escapeHtml(name)}</div>`;

  return `${open}
    ${photo}
    ${qr}
    <div class="card-face">
      ${t.nameVertical ? nameEl : ""}
      <div class="z-top">${top ? `<span class="masthead">${top}</span>` : "<span></span>"}</div>
      <div class="z-hero">
        ${t.nameVertical ? "" : nameEl}
        ${
          design.showNameEn && !t.nameVertical
            ? `<div class="card-en">${escapeHtml(profile.nameEn.trim())}</div>`
            : ""
        }
        ${ornament}
        ${under ? `<div class="tag-row">${under}</div>` : ""}
      </div>
      <div class="z-bottom">${contacts}</div>
    </div>
  </article>`;
}

export function cardPair(strategy, profile) {
  return `<div class="card-block">
      <div class="card-label">正面 · 90 × 54 mm</div>
      <div class="card-frame">${cardMarkup(strategy, profile, "front")}</div>
    </div>
    <div class="card-block">
      <div class="card-label">背面</div>
      <div class="card-frame">${cardMarkup(strategy, profile, "back")}</div>
    </div>`;
}
