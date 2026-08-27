/**
 * 交付：正面/背面 PNG、双面 PDF（都是 90×54mm @ 300dpi）和 vCard（.vcf 通讯录）。
 *
 * 画面不引入库：把已经排好的卡（cqw 已算成 px）把计算样式内联进副本，
 * 再经 SVG foreignObject 画到 canvas。::before / ::after 不会跟着走，
 * 饰件小损失换零依赖。PDF 把两面 JPEG 嵌进两页，页面尺寸锁死名片规格。
 */

const MM_W = 90;
const MM_H = 54;
const DPI = 300;
export const PNG_W = Math.round((MM_W / 25.4) * DPI);
export const PNG_H = Math.round((MM_H / 25.4) * DPI);
export const PDF_PT_W = (MM_W / 25.4) * 72;
export const PDF_PT_H = (MM_H / 25.4) * 72;

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
    img.onerror = () => reject(new Error("无法把画面画进文件"));
    img.src = url;
  });
}

async function frameToCanvas(el) {
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
  return canvas;
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    const fail = type.includes("jpeg") ? "JPEG 编码失败" : "PNG 编码失败";
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(fail))), type, quality);
  });
}

/**
 * @param el 已经按 PNG_W × PNG_H 排好的 .card-frame
 */
export async function frameToPngBlob(el) {
  return canvasToBlob(await frameToCanvas(el), "image/png");
}

export async function frameToJpegBytes(el) {
  const blob = await canvasToBlob(await frameToCanvas(el), "image/jpeg", 0.92);
  return new Uint8Array(await blob.arrayBuffer());
}

/** 把卡按印刷尺寸挂到屏外画板，再交给 PNG / JPEG 编码器。 */
export async function withExportFrame(innerHtml, fn) {
  const stage = document.getElementById("export-stage");
  if (!stage) throw new Error("没有导出画板");
  stage.innerHTML = `<div class="card-frame">${innerHtml}</div>`;
  const frame = stage.querySelector(".card-frame");
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return fn(frame);
}

function concatBytes(parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/**
 * 两页 PDF，每页 90×54mm，各嵌一张 JPEG。不引入库。
 * @param pages {{ jpeg: Uint8Array, width: number, height: number }[]}
 */
export function pdfFromJpegs(pages) {
  if (!pages.length) throw new Error("PDF 没有页面");
  const enc = new TextEncoder();
  const chunks = [];
  let pos = 0;
  const offsets = [0];
  const push = (part) => {
    const b = typeof part === "string" ? enc.encode(part) : part;
    chunks.push(b);
    pos += b.length;
  };
  const begin = (id) => {
    offsets[id] = pos;
    push(`${id} 0 obj\n`);
  };
  const end = () => push("endobj\n");

  const n = pages.length;
  const pageIds = pages.map((_, i) => 3 + i);
  const imageIds = pages.map((_, i) => 3 + n + i);
  const contentIds = pages.map((_, i) => 3 + 2 * n + i);
  const w = PDF_PT_W.toFixed(4);
  const h = PDF_PT_H.toFixed(4);

  push("%PDF-1.4\n%\x80\x80\x80\x80\n");
  begin(1);
  push("<< /Type /Catalog /Pages 2 0 R >>\n");
  end();
  begin(2);
  push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${n} >>\n`);
  end();

  pages.forEach((page, i) => {
    begin(pageIds[i]);
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im${i} ${imageIds[i]} 0 R >> >> /Contents ${contentIds[i]} 0 R >>\n`,
    );
    end();
  });

  pages.forEach((page, i) => {
    const jpeg = page.jpeg;
    begin(imageIds[i]);
    push(
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
    );
    push(jpeg);
    push("\nendstream\n");
    end();
  });

  pages.forEach((_, i) => {
    const body = `q\n${w} 0 0 ${h} 0 0 cm\n/Im${i} Do\nQ\n`;
    begin(contentIds[i]);
    push(`<< /Length ${enc.encode(body).length} >>\nstream\n${body}endstream\n`);
    end();
  });

  const xrefPos = pos;
  push(`xref\n0 ${offsets.length}\n`);
  push("0000000000 65535 f \n");
  for (let i = 1; i < offsets.length; i++) {
    push(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  }
  push(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);
  return new Blob([concatBytes(chunks)], { type: "application/pdf" });
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
