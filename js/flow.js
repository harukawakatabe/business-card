/**
 * 产品版首页：一份人物料，多场相遇；答完四问一键出设计稿 + 三版视觉，导出 PNG / PDF / vCard。
 * 工作室在 studio.html。
 */

import {
  AUDIENCES,
  DEMO,
  EMPTY_PROFILE,
  PURPOSES,
  SCENES,
  STAGES,
  pickPaletteFamilies,
} from "./data.js";
import { briefContext, compose } from "./strategy.js";
import { designCard } from "./design.js";
import { briefRows } from "./brief.js";
import { PRESETS, sanitizeSpec } from "./style-spec.js";
import { cardMarkup, cardPair, escapeHtml } from "./render-card.js";
import { requestBrief, requestStyles } from "./llm.js";
import { loadArchive, newScheme, questionsFilled, saveArchive, schemeTitle, toComposeState } from "./archive.js";
import { buildVCard, downloadBlob, downloadText, fileStem, frameToJpegBytes, frameToPngBlob, pdfFromJpegs, PNG_H, PNG_W, withExportFrame } from "./export.js";

const FIELDS = [
  ["scene", SCENES],
  ["purpose", PURPOSES],
  ["audience", AUDIENCES],
  ["stage", STAGES],
];

const FOLIO = [
  { id: "read", title: "顾问阅读资料", leaf: "其一", jump: "" },
  { id: "brief", title: "设计稿", leaf: "其二", jump: "brief-sheet" },
  { id: "styles", title: "三版视觉", leaf: "其三", jump: "candidates" },
];

let archive = loadArchive();
let busy = false;
let phase = "idle";
let note = { text: "", error: false };

function ensureActive() {
  if (!archive.schemes.length) {
    const s = newScheme();
    archive.schemes.push(s);
    archive.activeId = s.id;
  } else if (!archive.schemes.some((s) => s.id === archive.activeId)) {
    archive.activeId = archive.schemes[0].id;
  }
  return archive.schemes.find((s) => s.id === archive.activeId);
}

function persist() {
  saveArchive(archive);
}

function fallbackTrio() {
  const ids = Object.keys(PRESETS);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, 3).map((id) => sanitizeSpec(PRESETS[id], `preset-${id}-${Date.now()}`));
}

function composeNow() {
  const scheme = ensureActive();
  return compose(toComposeState(archive, scheme));
}

function renderChipGroup(field, items) {
  const scheme = ensureActive();
  const root = document.querySelector(`.chips[data-field="${field}"]`);
  const otherBox = document.querySelector(`[data-other="${field}"]`);
  if (!root.dataset.ready) {
    root.innerHTML =
      items
        .map(
          (item) =>
            `<button class="chip" type="button" data-id="${item.id}"><strong>${escapeHtml(
              item.label,
            )}</strong><span>${escapeHtml(item.hint)}</span></button>`,
        )
        .join("") +
      `<button class="chip" type="button" data-id="other"><strong>其他</strong><span>用自己的话</span></button>`;
    root.addEventListener("click", (event) => {
      const btn = event.target.closest(".chip");
      if (!btn) return;
      const s = ensureActive();
      s[field] = btn.dataset.id;
      s.updatedAt = Date.now();
      persist();
      render();
    });
    otherBox.querySelector("input").addEventListener("input", (event) => {
      const s = ensureActive();
      s.custom[field] = event.target.value;
      s.updatedAt = Date.now();
      persist();
      render({ skipInputs: true });
    });
    root.dataset.ready = "1";
  }
  for (const btn of root.querySelectorAll(".chip")) {
    btn.classList.toggle("is-on", btn.dataset.id === scheme[field]);
  }
  otherBox.classList.toggle("is-open", scheme[field] === "other");
  const otherInput = otherBox.querySelector("input");
  if (document.activeElement !== otherInput) otherInput.value = scheme.custom[field] || "";
}

function renderRail() {
  const scheme = ensureActive();
  const name = archive.profile.name?.trim();
  document.getElementById("rail-person").innerHTML = name
    ? `<b>${escapeHtml(name)}</b>${escapeHtml(archive.profile.title || archive.profile.company || "点这里改人物料")}`
    : `<b>还没写名字</b>点这里去第五步改档案`;

  document.getElementById("rail-list").innerHTML = archive.schemes
    .map((s) => {
      const n = questionsFilled(s);
      const when = new Date(s.updatedAt || s.createdAt).toLocaleDateString("zh-CN", {
        month: "numeric",
        day: "numeric",
      });
      return `<div class="rail-item${s.id === scheme.id ? " is-on" : ""}">
          <button type="button" data-scheme="${s.id}">
            ${escapeHtml(schemeTitle(s))}
            <small>${n}/4 问 · ${when}${s.styleSpec ? " · 已出视觉" : ""}</small>
          </button>
          <button class="rail-del" type="button" data-del="${s.id}" aria-label="删掉这场相遇">×</button>
        </div>`;
    })
    .join("");
}

function craftState(stepId, scheme) {
  const order = FOLIO.map((s) => s.id);
  const idx = order.indexOf(stepId);
  const now = order.indexOf(phase);
  if (phase !== "idle") {
    if (now === idx) return "now";
    if (now > idx) return "done";
    return "wait";
  }
  const hasBrief = Boolean(scheme.brief) || Boolean(scheme.candidates.length);
  const hasStyles = Boolean(scheme.candidates.length);
  if (stepId === "read") return hasBrief || hasStyles ? "done" : "wait";
  if (stepId === "brief") return hasBrief ? "done" : "wait";
  return hasStyles ? "done" : "wait";
}

function folioPage(scheme) {
  if (phase === "read") return FOLIO[0];
  if (phase === "brief") return FOLIO[1];
  if (phase === "styles") return FOLIO[2];
  if (scheme.candidates.length) return FOLIO[2];
  if (scheme.brief) return FOLIO[1];
  return FOLIO[0];
}

function renderCraft(scheme) {
  const page = folioPage(scheme);
  const marks = FOLIO.map((step) => {
    const state = craftState(step.id, scheme);
    const on = page.id === step.id ? " is-on" : "";
    const jump = (state === "done" || state === "now") && step.jump;
    return `<li>
        <button class="${on.trim()}${jump ? " is-jump" : ""}" type="button" data-craft="${step.id}" ${
          jump ? "" : "disabled"
        }>${escapeHtml(step.leaf)}</button>
      </li>`;
  }).join("");
  document.getElementById("craft").innerHTML =
    `<div class="folio-leaf"><p class="folio-title" data-leaf="${page.id}">${escapeHtml(page.title)}</p></div>` +
    `<ol class="folio-marks">${marks}</ol>`;
}

function renderPick(strategy) {
  const scheme = ensureActive();
  const goNote = document.getElementById("go-note");
  if (note.error && note.text) {
    goNote.textContent = note.text;
  } else if (!busy && scheme.candidates.length && !scheme.styleSpec) {
    goNote.textContent = "点一版采纳。";
  } else {
    goNote.textContent = "";
  }
  goNote.classList.toggle("is-error", note.error);

  renderCraft(scheme);

  document.getElementById("candidates").innerHTML = scheme.candidates
    .map((spec, i) => {
      const design = designCard(strategy, toComposeState(archive, scheme), spec);
      const on = scheme.styleSpec?.id === spec.id ? " is-on" : "";
      const swatch = [spec.palette.bg, spec.palette.accent, spec.palette.fg]
        .map((c) => `<i style="background:${c}"></i>`)
        .join("");
      return `<button class="cand${on}" type="button" data-cand="${i}">
          <div class="card-frame">${cardMarkup(strategy, archive.profile, "front", design)}</div>
          <div class="cand-name"><span>${escapeHtml(spec.name)}</span><span class="cand-swatch">${swatch}</span></div>
          <div class="cand-why">${escapeHtml(spec.rationale || spec.layoutName)}</div>
        </button>`;
    })
    .join("");

  const brief = strategy.brief;
  const rows = briefRows(brief)
    .map(
      ([k, v, why]) =>
        `<div class="sheet-row"><b>${k}</b><span>${escapeHtml(v)}${why ? `<em>${escapeHtml(why)}</em>` : ""}</span></div>`,
    )
    .join("");
  document.getElementById("brief-sheet").innerHTML = scheme.brief || scheme.candidates.length
    ? `<div class="sheet-read">${escapeHtml(brief.read)}<span>立场 ${escapeHtml(strategy.stance.label)}</span></div>${rows}`
    : "";

  document.getElementById("cards").innerHTML = cardPair(strategy, archive.profile);

  const c = strategy.completeness;
  const pngOk = Boolean(scheme.styleSpec) && c.named;
  const vcfOk = c.named && c.contact;
  document.getElementById("btn-png-front").disabled = !pngOk;
  document.getElementById("btn-png-back").disabled = !pngOk;
  document.getElementById("btn-pdf").disabled = !pngOk;
  document.getElementById("btn-vcf").disabled = !vcfOk;
}

function render(opts = {}) {
  const scheme = ensureActive();
  const strategy = composeNow();

  for (const [field, items] of FIELDS) renderChipGroup(field, items);

  if (!opts.skipInputs) {
    for (const el of document.querySelectorAll("[data-profile]")) {
      if (document.activeElement === el) continue;
      el.value = archive.profile[el.dataset.profile] || "";
    }
  }

  const bits = [`问询 ${strategy.completeness.questions}/4`];
  if (!strategy.completeness.named) bits.push("未写姓名");
  if (!strategy.completeness.contact) bits.push("未留联系方式");
  if (strategy.completeness.readyToPrint) bits.push("可以导出");
  document.getElementById("status").textContent = bits.join(" · ");

  document.getElementById("btn-go").disabled = busy || questionsFilled(scheme) < 4;
  document.getElementById("btn-go").textContent = busy ? "在做这份身份…" : "生成这份身份";

  renderRail();
  renderPick(strategy);
}

async function generate() {
  if (busy) return;
  const scheme = ensureActive();
  if (questionsFilled(scheme) < 4) {
    note = { text: "先把场合、用途、人群、阶段四个问题答完。", error: true };
    render({ skipInputs: true });
    return;
  }
  busy = true;
  phase = "read";
  note = { text: "", error: false };
  render({ skipInputs: true });

  const composeState = toComposeState(archive, scheme);
  const ctx = briefContext(composeState);
  try {
    scheme.brief = await requestBrief(ctx);
    phase = "brief";
    note = { text: "", error: false };
    persist();
    render({ skipInputs: true });
  } catch (err) {
    scheme.brief = null;
    phase = "brief";
    note = { text: `${err.message || "设计稿写不出来"}，先用规则草稿继续视觉。`, error: true };
    render({ skipInputs: true });
  }

  const identity = compose(toComposeState(archive, scheme));
  phase = "styles";
  persist();
  render({ skipInputs: true });
  try {
    const drawn = pickPaletteFamilies(3);
    scheme.paletteDraw = drawn.map((f) => f.id);
    const specs = await requestStyles(
      identity.brief,
      briefContext(toComposeState(archive, scheme)),
      scheme.paletteDraw,
    );
    scheme.candidates = specs;
    scheme.styleSpec = specs[0] || null;
    note = { text: "", error: note.error };
  } catch (err) {
    scheme.candidates = fallbackTrio();
    scheme.styleSpec = scheme.candidates[0];
    scheme.paletteDraw = [];
    note = {
      text: `${err.message || "视觉出不来"}，改用三套内置预设。点一版即可导出。`,
      error: true,
    };
  }

  scheme.updatedAt = Date.now();
  persist();
  busy = false;
  phase = "idle";
  render({ skipInputs: true });
  document.getElementById("pick").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function exportPng(face) {
  const scheme = ensureActive();
  if (!scheme.styleSpec) return;
  try {
    const blob = await withExportFrame(cardMarkup(composeNow(), archive.profile, face), frameToPngBlob);
    downloadBlob(blob, `${fileStem(archive.profile)}-${face === "front" ? "front" : "back"}.png`);
  } catch (err) {
    note = { text: err.message || "PNG 导出失败", error: true };
    render({ skipInputs: true });
  }
}

async function exportPdf() {
  const scheme = ensureActive();
  if (!scheme.styleSpec) return;
  try {
    const strategy = composeNow();
    const front = await withExportFrame(cardMarkup(strategy, archive.profile, "front"), frameToJpegBytes);
    const back = await withExportFrame(cardMarkup(strategy, archive.profile, "back"), frameToJpegBytes);
    const blob = pdfFromJpegs([
      { jpeg: front, width: PNG_W, height: PNG_H },
      { jpeg: back, width: PNG_W, height: PNG_H },
    ]);
    downloadBlob(blob, `${fileStem(archive.profile)}.pdf`);
  } catch (err) {
    note = { text: err.message || "PDF 导出失败", error: true };
    render({ skipInputs: true });
  }
}

function exportVcf() {
  const strategy = composeNow();
  const text = buildVCard(archive.profile, {
    showOrg: strategy.companyMode === "show",
    pitch: strategy.brief.back.pitch,
  });
  downloadText(text, `${fileStem(archive.profile)}.vcf`, "text/vcard;charset=utf-8");
}

function bind() {
  document.getElementById("btn-go").addEventListener("click", generate);
  document.getElementById("btn-demo").addEventListener("click", () => {
    const scheme = ensureActive();
    archive.profile = { ...EMPTY_PROFILE, ...DEMO.profile };
    Object.assign(scheme, {
      scene: DEMO.scene,
      purpose: DEMO.purpose,
      audience: DEMO.audience,
      stage: DEMO.stage,
      updatedAt: Date.now(),
    });
    persist();
    render();
  });
  document.getElementById("btn-new").addEventListener("click", () => {
    const s = newScheme();
    archive.schemes.push(s);
    archive.activeId = s.id;
    persist();
    note = { text: "", error: false };
    render();
    document.getElementById("q-scene").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  document.getElementById("rail-person").addEventListener("click", () => {
    document.getElementById("q-profile").scrollIntoView({ behavior: "smooth", block: "start" });
    document.getElementById("f-name").focus();
  });
  document.getElementById("rail-list").addEventListener("click", (event) => {
    const del = event.target.closest("[data-del]");
    if (del) {
      event.stopPropagation();
      const id = del.dataset.del;
      archive.schemes = archive.schemes.filter((s) => s.id !== id);
      if (!archive.schemes.length) {
        const s = newScheme();
        archive.schemes.push(s);
        archive.activeId = s.id;
      } else if (archive.activeId === id) {
        archive.activeId = archive.schemes[0].id;
      }
      persist();
      note = { text: "", error: false };
      render();
      return;
    }
    const btn = event.target.closest("[data-scheme]");
    if (!btn) return;
    archive.activeId = btn.dataset.scheme;
    persist();
    note = { text: "", error: false };
    render();
  });
  document.getElementById("craft").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-craft]");
    if (!btn || btn.disabled) return;
    const step = FOLIO.find((s) => s.id === btn.dataset.craft);
    const target = step?.jump && document.getElementById(step.jump);
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  document.getElementById("candidates").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-cand]");
    if (!btn) return;
    const scheme = ensureActive();
    scheme.styleSpec = scheme.candidates[Number(btn.dataset.cand)] || null;
    scheme.updatedAt = Date.now();
    persist();
    render({ skipInputs: true });
  });
  for (const el of document.querySelectorAll("[data-profile]")) {
    el.addEventListener("input", () => {
      archive.profile[el.dataset.profile] = el.value;
      persist();
      render({ skipInputs: true });
    });
  }
  document.getElementById("btn-png-front").addEventListener("click", () => exportPng("front"));
  document.getElementById("btn-png-back").addEventListener("click", () => exportPng("back"));
  document.getElementById("btn-pdf").addEventListener("click", exportPdf);
  document.getElementById("btn-vcf").addEventListener("click", exportVcf);
}

bind();
render();
