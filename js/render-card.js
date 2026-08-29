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
  // 二维码位只在用户真贴了图时渲染；面别/角位/装裱都来自这套设计。
  const qrOn = spec.qr?.show && Boolean(profile.qrImage) && face === (spec.qr.face || "front");
  const qr = qrOn
    ? `<img class="card-qr" alt="" src="${profile.qrImage}" data-corner="${spec.qr.corner}" data-mount="${spec.qr.mount}" />`
    : "";
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
    if (strategy.backMode === "en" && strategy.backEn?.name) {
      const enContacts = design.contactsEn.length
        ? design.contactsEn.map((c) => `<span>${escapeHtml(c.value)}</span>`).join("")
        : design.contacts.map((c) => `<span>${escapeHtml(c.value)}</span>`).join("");
      return `${open}
      ${qr}
      <div class="card-face">
        <div class="z-top"><span class="back-kicker">${escapeHtml(strategy.backEn.kicker || "CONTACT")}</span></div>
        <div class="z-hero">
          ${ornament}
          <div class="card-name">${escapeHtml(strategy.backEn.name)}</div>
          ${strategy.backEn.title ? `<div class="tag-row">${escapeHtml(strategy.backEn.title)}</div>` : ""}
          ${strategy.backEn.cta ? `<div class="back-cta">${escapeHtml(strategy.backEn.cta)}</div>` : ""}
        </div>
        <div class="z-bottom">${enContacts}</div>
      </div>
    </article>`;
    }
    return `${open}
      ${qr}
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
