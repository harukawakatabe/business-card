/**
 * 产品版：一份人物料，多场相遇；答完四问一键出设计稿 + 三版视觉，导出 PNG / vCard。
 * 工作室 index.html 不动。
 */

import {
  AUDIENCES,
  DEMO,
  EMPTY_PROFILE,
  PURPOSES,
  SCENES,
  STAGES,
} from "./data.js";
import { briefContext, compose } from "./strategy.js";
import { designCard } from "./design.js";
import { briefRows } from "./brief.js";
import { PRESETS, sanitizeSpec } from "./style-spec.js";
import { cardMarkup, cardPair, escapeHtml } from "./render-card.js";
import { requestBrief, requestStyles } from "./llm.js";
import { loadArchive, newScheme, questionsFilled, saveArchive, schemeTitle, toComposeState } from "./archive.js";
import { buildVCard, downloadBlob, downloadText, fileStem, frameToPngBlob } from "./export.js";

const FIELDS = [
  ["scene", SCENES],
  ["purpose", PURPOSES],
  ["audience", AUDIENCES],
  ["stage", STAGES],
];

let archive = loadArchive();
let busy = false;
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
  return ["authority", "credible", "creative"].map((id) => sanitizeSpec(PRESETS[id], `preset-${id}`));
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
    ? `<b>${escapeHtml(name)}</b>${escapeHtml(archive.profile.title || archive.profile.company || "人物料各场合共用")}`
    : `<b>还没写名字</b>先填右边第五步，各场合共用`;

  document.getElementById("rail-list").innerHTML = archive.schemes
    .map((s) => {
      const n = questionsFilled(s);
      const when = new Date(s.updatedAt || s.createdAt).toLocaleDateString("zh-CN", {
        month: "numeric",
        day: "numeric",
      });
      return `<button class="rail-item${s.id === scheme.id ? " is-on" : ""}" type="button" data-scheme="${s.id}">
          ${escapeHtml(schemeTitle(s))}
          <small>${n}/4 问 · ${when}${s.styleSpec ? " · 已出视觉" : ""}</small>
        </button>`;
    })
    .join("");
}

function renderPick(strategy) {
  const scheme = ensureActive();
  const goNote = document.getElementById("go-note");
  if (note.text) {
    goNote.textContent = note.text;
  } else if (scheme.candidates.length) {
    goNote.textContent = scheme.styleSpec
      ? `当前用「${scheme.styleSpec.name}」。文案由这场相遇的设计稿决定。`
      : "点一版采纳。";
  } else {
    goNote.textContent = "答完上面四问，点右上角「生成这份身份」。没有 key 也会出规则草稿和三套内置视觉。";
  }
  goNote.classList.toggle("is-error", note.error);

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
  document.getElementById("brief-sheet").innerHTML = scheme.brief
    ? `<div class="sheet-read">${escapeHtml(brief.read)}<span>立场 ${escapeHtml(strategy.stance.label)}</span></div>${rows}`
    : "";

  document.getElementById("cards").innerHTML = cardPair(strategy, archive.profile);

  const c = strategy.completeness;
  const pngOk = Boolean(scheme.styleSpec) && c.named;
  const vcfOk = c.named && c.contact;
  document.getElementById("btn-png-front").disabled = !pngOk;
  document.getElementById("btn-png-back").disabled = !pngOk;
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
  note = { text: "顾问在读这场相遇和你的资历…", error: false };
  render({ skipInputs: true });

  const composeState = toComposeState(archive, scheme);
  const ctx = briefContext(composeState);
  try {
    scheme.brief = await requestBrief(ctx);
    note = { text: "设计稿已出，接着出三版视觉…", error: false };
    persist();
    render({ skipInputs: true });
  } catch (err) {
    scheme.brief = null;
    note = { text: `${err.message || "设计稿写不出来"}，先用规则草稿继续视觉。`, error: true };
  }

  const identity = compose(toComposeState(archive, scheme));
  try {
    const specs = await requestStyles(identity.brief, briefContext(toComposeState(archive, scheme)), "");
    scheme.candidates = specs;
    scheme.styleSpec = specs[0] || null;
    note = {
      text: note.error ? `${note.text} 视觉已出，点一版采纳。` : "三版已出，点一版采纳。也可以直接下载当前这版。",
      error: note.error,
    };
  } catch (err) {
    scheme.candidates = fallbackTrio();
    scheme.styleSpec = scheme.candidates[0];
    note = {
      text: `${err.message || "视觉出不来"}，改用三套内置预设。点一版即可导出。`,
      error: true,
    };
  }

  scheme.updatedAt = Date.now();
  persist();
  busy = false;
  render({ skipInputs: true });
  document.getElementById("pick").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function exportPng(face) {
  const scheme = ensureActive();
  if (!scheme.styleSpec) return;
  const strategy = composeNow();
  const stage = document.getElementById("export-stage");
  stage.innerHTML = `<div class="card-frame">${cardMarkup(strategy, archive.profile, face)}</div>`;
  const frame = stage.querySelector(".card-frame");
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  try {
    const blob = await frameToPngBlob(frame);
    downloadBlob(blob, `${fileStem(archive.profile)}-${face === "front" ? "front" : "back"}.png`);
  } catch (err) {
    note = { text: err.message || "PNG 导出失败", error: true };
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
  document.getElementById("rail-list").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-scheme]");
    if (!btn) return;
    archive.activeId = btn.dataset.scheme;
    persist();
    note = { text: "", error: false };
    render();
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
  document.getElementById("btn-vcf").addEventListener("click", exportVcf);
}

bind();
render();
