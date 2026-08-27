/**
 * 交付：正面/背面 PNG（90×54mm @ 300dpi）和 vCard（.vcf 通讯录）。
 *
 * PNG 不引入库：把已经排好的卡（cqw 已算成 px）把计算样式内联进副本，
 * 再经 SVG foreignObject 画到 canvas。::before / ::after 不会跟着走，
 * 饰件小损失换零依赖。
 */

const MM_W = 90;
const MM_H = 54;
const DPI = 300;
export const PNG_W = Math.round((MM_W / 25.4) * DPI);
export const PNG_H = Math.round((MM_H / 25.4) * DPI);

function inlineComputed(src, dst) {
  const cs = getComputedStyle(src);
  const parts = [];
  for (let i = 0; i < cs.length; i++) {
    const prop = cs.item(i);
    if (prop.startsWith("-") && !prop.startsWith("-webkit-")) continue;
    parts.push(`${prop}:${cs.getPropertyValue(prop)}`);
  }
  dst.setAttribute("style", parts.join(";"));
  const a = src.children;
  const b = dst.children;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) inlineComputed(a[i], b[i]);
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("无法把画面画进 PNG"));
    img.src = url;
  });
}

/**
 * @param el 已经按 PNG_W × PNG_H 排好的 .card-frame
 */
export async function frameToPngBlob(el) {
  const w = el.offsetWidth || PNG_W;
  const h = el.offsetHeight || PNG_H;
  const clone = el.cloneNode(true);
  inlineComputed(el, clone);
  clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  clone.style.width = `${w}px`;
  clone.style.height = `${h}px`;
  clone.style.margin = "0";
  clone.style.position = "static";
  clone.style.filter = "none";

  const xhtml = new XMLSerializer().serializeToString(clone);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    `<foreignObject width="100%" height="100%">${xhtml}</foreignObject></svg>`;
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const img = await loadImage(url);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG 编码失败"))), "image/png");
  });
}

export function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function vescape(s) {
  return String(s || "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function splitCnName(name) {
  const s = String(name || "").trim();
  if (!s) return { family: "", given: "" };
  if (/^[A-Za-z]/.test(s)) {
    const parts = s.split(/\s+/);
    return { family: parts.slice(-1)[0], given: parts.slice(0, -1).join(" ") };
  }
  return { family: s.slice(0, 1), given: s.slice(1) };
}

/** 电子名片 .vcf，手机可直接导入通讯录。微信没有标准字段，写进 NOTE。 */
export function buildVCard(profile, extras = {}) {
  const name = profile.name?.trim() || "";
  const { family, given } = splitCnName(name);
  const lines = ["BEGIN:VCARD", "VERSION:3.0"];
  if (name) {
    lines.push(`FN:${vescape(name)}`);
    lines.push(`N:${vescape(family)};${vescape(given)};;;`);
  }
  if (profile.nameEn?.trim()) lines.push(`NICKNAME:${vescape(profile.nameEn.trim())}`);
  if (profile.company?.trim() && extras.showOrg !== false) lines.push(`ORG:${vescape(profile.company.trim())}`);
  if (profile.title?.trim()) lines.push(`TITLE:${vescape(profile.title.trim())}`);
  if (profile.city?.trim()) lines.push(`ADR;TYPE=WORK:;;;${vescape(profile.city.trim())};;;`);
  if (profile.phone?.trim()) lines.push(`TEL;TYPE=CELL:${vescape(profile.phone.trim())}`);
  if (profile.email?.trim()) lines.push(`EMAIL;TYPE=INTERNET:${vescape(profile.email.trim())}`);
  if (profile.website?.trim()) {
    const url = profile.website.trim().includes("://") ? profile.website.trim() : `https://${profile.website.trim()}`;
    lines.push(`URL:${vescape(url)}`);
  }
  const notes = [];
  if (profile.wechat?.trim()) notes.push(`微信 ${profile.wechat.trim()}`);
  if (extras.pitch) notes.push(extras.pitch);
  if (notes.length) lines.push(`NOTE:${vescape(notes.join(" · "))}`);
  lines.push("END:VCARD");
  return lines.join("\r\n");
}

export function downloadText(text, filename, mime) {
  downloadBlob(new Blob([text], { type: mime || "text/plain;charset=utf-8" }), filename);
}

export function fileStem(profile) {
  return (profile.name || "card").trim().replace(/\s+/g, "-").slice(0, 20) || "card";
}
