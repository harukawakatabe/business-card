import { AUDIENCES, DEMO, EMPTY_PROFILE, PALETTE_FAMILIES, PURPOSES, SCENES, STAGES, STANCES } from "./data.js";
import { briefContext, compose } from "./strategy.js";
import { designCard } from "./design.js";
import { briefRows } from "./brief.js";
import { buildPrompts } from "./prompts.js";
import { sanitizeSpec } from "./style-spec.js";
import { cardMarkup, cardPair, escapeHtml } from "./render-card.js";
import { requestBrief, requestStyles } from "./llm.js";
import { buildVCard, downloadBlob, downloadText, fileStem, frameToJpegBytes, frameToPngBlob, pdfFromJpegs, PNG_H, PNG_W, withExportFrame } from "./export.js";
import { imageFromClipboard, ingestImage } from "./image-in.js";
import { loadStore, saveStore } from "./store.js";

const KEY = "identity.atelier.v1";
const FIELDS = [
  ["scene", SCENES],
  ["purpose", PURPOSES],
  ["audience", AUDIENCES],
  ["stage", STAGES],
];

function blank() {
  return {
    scene: "",
    purpose: "",
    audience: "",
    stage: "",
    stanceOverride: "",
    custom: { audience: "", scene: "", purpose: "", stage: "" },
    edits: { masthead: "", role: "", pitch: "", backMode: "" },
    profile: { ...EMPTY_PROFILE },
    brief: null,
    styleSpec: null,
    candidates: [],
    paletteHint: "",
    qrOverride: "",
  };
}

async function load() {
  try {
    const parsed = await loadStore(KEY);
    if (!parsed) return blank();
    return {
      ...blank(),
      ...parsed,
      custom: { ...blank().custom, ...(parsed.custom || {}) },
      edits: {
        masthead: parsed.edits?.masthead || "",
        role: parsed.edits?.role || parsed.edits?.headline || "",
        pitch: parsed.edits?.pitch || "",
        backMode: ["pitch", "en"].includes(parsed.edits?.backMode) ? parsed.edits.backMode : "",
      },
      profile: { ...EMPTY_PROFILE, ...(parsed.profile || {}) },
      // 设计稿存的是模型原文，每次 compose 时重新清洗——清洗规则改了立刻生效。
      brief: parsed.brief && typeof parsed.brief === "object" ? parsed.brief : null,
      styleSpec: parsed.styleSpec ? sanitizeSpec(parsed.styleSpec, parsed.styleSpec.id) : null,
      candidates: Array.isArray(parsed.candidates)
        ? parsed.candidates.map((s, i) => sanitizeSpec(s, s?.id || `saved-${i}`))
        : [],
      paletteHint: PALETTE_FAMILIES.some((f) => f.id === parsed.paletteHint) ? parsed.paletteHint : "",
      qrOverride: ["on", "off"].includes(parsed.qrOverride) ? parsed.qrOverride : "",
    };
  } catch {
    return blank();
  }
}

let state = await load();
let derived = { masthead: "", role: "", pitch: "" };
let designing = false;
let designNote = { text: "", error: false };
let briefing = false;
let briefNote = { text: "", error: false };

function persist() {
  saveStore(KEY, state);
}

function readPortrait(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 480;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.86));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("无法读取图片"));
    };
    img.src = url;
  });
}

function renderQr() {
  const slot = document.getElementById("qr-slot");
  if (!slot) return;
  slot.innerHTML = state.profile.qrImage
    ? `<img alt="" src="${state.profile.qrImage}" />`
    : "<span>贴二维码图</span>";
  document.getElementById("btn-qr-clear").hidden = !state.profile.qrImage;
}

async function acceptQrImage(file) {
  try {
    state.profile.qrImage = await ingestImage(file);
  } catch {
    alert("二维码图读不出来，换一张白底原图试试。");
    return;
  }
  persist();
  render({ skipInputs: true });
}

function renderChipGroup(field, items) {
  const root = document.querySelector(`.chips[data-field="${field}"]`);
  const otherBox = document.querySelector(`[data-other="${field}"]`);
  if (!root.dataset.ready) {
    const chips = items
      .map(
        (item) =>
          `<button class="chip" type="button" data-id="${item.id}"><strong>${escapeHtml(
            item.label,
          )}</strong><span>${escapeHtml(item.hint)}</span></button>`,
      )
      .join("");
    root.innerHTML =
      chips +
      `<button class="chip" type="button" data-id="other"><strong>其他</strong><span>用自己的话</span></button>`;
    root.addEventListener("click", (event) => {
      const btn = event.target.closest(".chip");
      if (!btn) return;
      state[field] = btn.dataset.id;
      persist();
      render();
    });
    otherBox.querySelector("input").addEventListener("input", (event) => {
      state.custom[field] = event.target.value;
      persist();
      render({ skipInputs: true });
    });
    root.dataset.ready = "1";
  }
  for (const btn of root.querySelectorAll(".chip")) {
    btn.classList.toggle("is-on", btn.dataset.id === state[field]);
  }
  otherBox.classList.toggle("is-open", state[field] === "other");
  const otherInput = otherBox.querySelector("input");
  if (document.activeElement !== otherInput) otherInput.value = state.custom[field] || "";
}

function renderBrief(strategy) {
  const brief = strategy.brief;
  const fromLlm = brief.source === "llm";
  const btn = document.getElementById("btn-brief");
  const reset = document.getElementById("btn-brief-reset");
  const note = document.getElementById("brief-note");
  const sheet = document.getElementById("brief-sheet");

  btn.disabled = briefing;
  btn.textContent = briefing ? "顾问在写…" : fromLlm ? "重写设计稿" : "让顾问写设计稿";
  reset.hidden = !fromLlm;

  if (briefNote.text) {
    note.textContent = briefNote.text;
  } else if (fromLlm) {
    note.textContent = "这份设计稿由大模型写。改了上面的问询或资料后它不会自动更新，重写一份即可。";
  } else {
    note.textContent =
      "当前是规则草稿：按场合 × 用途 × 人群 × 阶段直接推出来的，没有 API key 也能用。点右边让大模型按你的资历重写一份。";
  }
  note.classList.toggle("is-error", briefNote.error);

  const rows = briefRows(brief)
    .map(
      ([k, v, why]) =>
        `<div class="sheet-row"><b>${k}</b><span>${escapeHtml(v)}${why ? `<em>${escapeHtml(why)}</em>` : ""}</span></div>`,
    )
    .join("");
  const tone = brief.tone
    ? `<div class="sheet-row"><b>气质</b><span>${escapeHtml(brief.tone)}<em>交给第二步的视觉设计师</em></span></div>`
    : "";
  const offstage = brief.offstage.length
    ? `<div class="sheet-row"><b>私下</b><span>${brief.offstage.map((s) => escapeHtml(s)).join("<br />")}</span></div>`
    : "";
  sheet.innerHTML =
    `<div class="sheet-read">${escapeHtml(brief.read)}<span>立场 ${escapeHtml(strategy.stance.label)}${
      brief.stanceWhy ? ` · ${escapeHtml(brief.stanceWhy)}` : ""
    }</span></div>` +
    rows +
    tone +
    offstage;
}

function renderDesigner(strategy) {
  const btn = document.getElementById("btn-design");
  const reset = document.getElementById("btn-design-reset");
  const note = document.getElementById("design-note");
  const root = document.getElementById("candidates");
  const adopted = state.styleSpec;

  btn.disabled = designing;
  btn.textContent = designing ? "设计师在想…" : state.candidates.length ? "再出三版" : "出三版视觉";
  reset.hidden = !adopted;

  if (designNote.text) {
    note.textContent = designNote.text;
  } else if (adopted) {
    note.textContent = `当前用设计师方案「${adopted.name}」。文案仍然由设计稿决定，这一版只管视觉。`;
  } else {
    note.textContent = `当前用内置预设「${strategy.design.spec.name}」，跟着立场走。点右边让大模型读上面那份设计稿出三版视觉；色系可选，不选则三版必须换色相。`;
  }
  note.classList.toggle("is-error", designNote.error);

  renderPalettes();

  root.innerHTML = state.candidates
    .map((spec, i) => {
      const design = designCard(strategy, state, spec);
      const on = adopted?.id === spec.id ? " is-on" : "";
      const swatch = [spec.palette.bg, spec.palette.accent, spec.palette.fg]
        .map((c) => `<i style="background:${c}"></i>`)
        .join("");
      return `<button class="cand${on}" type="button" data-cand="${i}">
          <div class="card-frame">${cardMarkup(strategy, state.profile, "front", design)}</div>
          <div class="cand-name"><span>${escapeHtml(spec.name)}</span><span class="cand-swatch">${swatch}</span></div>
          <div class="cand-why">${escapeHtml(spec.rationale || spec.layoutName)}</div>
        </button>`;
    })
    .join("");
}

function renderPalettes() {
  const root = document.getElementById("palettes");
  if (!root.dataset.ready) {
    const chip = (id, label, swatches) => {
      const dots = (swatches || []).map((c) => `<i style="background:${c}"></i>`).join("");
      return `<button class="palette" type="button" data-palette="${id}"><span class="palette-swatch">${dots}</span>${escapeHtml(
        label,
      )}</button>`;
    };
    root.innerHTML =
      chip("", "不限色系", []) + PALETTE_FAMILIES.map((f) => chip(f.id, f.label, f.swatches)).join("");
    root.addEventListener("click", (event) => {
      const btn = event.target.closest(".palette");
      if (!btn) return;
      state.paletteHint = btn.dataset.palette || "";
      persist();
      render({ skipInputs: true });
    });
    root.dataset.ready = "1";
  }
  for (const btn of root.querySelectorAll(".palette")) {
    btn.classList.toggle("is-on", (btn.dataset.palette || "") === (state.paletteHint || ""));
  }
}

function render(opts = {}) {
  const strategy = compose(state);
  const design = strategy.design;
  derived = {
    masthead: design.top.find((t) => t.kind === "org")?.label || design.top[0]?.label || "",
    role: design.under.find((t) => t.kind === "role")?.label || "",
    pitch: strategy.derivedPitch,
  };
  const prompts = buildPrompts(state, strategy);

  for (const [field, items] of FIELDS) renderChipGroup(field, items);

  if (!opts.skipInputs) {
    for (const el of document.querySelectorAll("[data-profile]")) {
      if (document.activeElement === el) continue;
      el.value = state.profile[el.dataset.profile] || "";
    }
    const masthead = document.getElementById("e-masthead");
    const role = document.getElementById("e-role");
    const pitch = document.getElementById("e-pitch");
    if (document.activeElement !== masthead) masthead.value = state.edits.masthead || derived.masthead;
    if (document.activeElement !== role) role.value = state.edits.role || derived.role;
    if (document.activeElement !== pitch) pitch.value = state.edits.pitch || strategy.derivedPitch;
  }

  for (const btn of document.querySelectorAll("#backmode-row [data-backmode]")) {
    btn.classList.toggle("is-on", (state.edits.backMode || "") === btn.dataset.backmode);
  }

  for (const btn of document.querySelectorAll("#qr-mode [data-qr-mode]")) {
    btn.classList.toggle("is-on", (state.qrOverride || "") === btn.dataset.qrMode);
  }

  const names = [
    strategy.scene?.label,
    strategy.purpose?.label,
    strategy.audience?.label,
    strategy.stage?.label,
  ].filter(Boolean);
  document.getElementById("formula").textContent = names.length
    ? `${names.join(" × ")}  →  ${strategy.stance.label}`
    : "场合 × 用途 × 人群 × 阶段  →  设计稿";

  const c = strategy.completeness;
  const bits = [`问询 ${c.questions}/${c.questionsTotal}`];
  if (!c.named) bits.push("未写姓名");
  if (!c.contact) bits.push("未留联系方式");
  if (c.readyToPrint) bits.push("可以打印");
  document.getElementById("status").textContent = bits.join(" · ");

  const stanceRoot = document.getElementById("stances");
  if (!stanceRoot.dataset.ready) {
    stanceRoot.innerHTML = `<button class="stance" type="button" data-stance="">按策略</button>${Object.values(
      STANCES,
    )
      .map(
        (s) =>
          `<button class="stance" type="button" data-stance="${s.id}">${s.label}</button>`,
      )
      .join("")}`;
    stanceRoot.addEventListener("click", (event) => {
      const btn = event.target.closest(".stance");
      if (!btn) return;
      state.stanceOverride = btn.dataset.stance;
      persist();
      render();
    });
    stanceRoot.dataset.ready = "1";
  }
  for (const btn of stanceRoot.querySelectorAll(".stance")) {
    const auto = !state.stanceOverride;
    btn.classList.toggle(
      "is-on",
      auto ? btn.dataset.stance === "" : btn.dataset.stance === state.stanceOverride,
    );
  }
  document.getElementById("stance-label").textContent = `立场：设计稿判为「${
    STANCES[strategy.brief.stance].label
  }」，这里可以覆盖（只换内置预设的视觉）`;

  renderBrief(strategy);
  renderDesigner(strategy);

  const brief = document.getElementById("brief");
  const warns = strategy.warnings.map((w) => `<p class="warn">${escapeHtml(w)}</p>`).join("");
  const d = design.described;
  const spec = `<div class="spec">
        <div class="spec-row"><b>来源</b><span>${escapeHtml(
          `设计稿 ${design.briefSource === "llm" ? "大模型" : "规则草稿"}　视觉 ${
            design.source === "llm" ? "大模型" : "内置预设"
          }`,
        )}</span></div>
        <div class="spec-row"><b>风格</b><span>${escapeHtml(design.spec.name)}</span></div>
        <div class="spec-row"><b>构图</b><span>${escapeHtml(d.layout)}</span></div>
        <div class="spec-row"><b>纸面</b><span>${escapeHtml(
          [d.paper, ...d.surface].filter(Boolean).join("；"),
        )}</span></div>
        <div class="spec-row"><b>色彩</b><span>${escapeHtml(d.palette)}</span></div>
        <div class="spec-row"><b>装饰</b><span>${escapeHtml(d.decor.join("；") || "无，靠留白")}</span></div>
        <div class="spec-row"><b>字体</b><span>${escapeHtml(d.type.join("；"))}</span></div>
        <div class="spec-row"><b>上排</b><span>${escapeHtml(design.top.map((t) => t.label).join("、") || "留白")}</span></div>
        <div class="spec-row"><b>姓名下</b><span>${escapeHtml(design.under.map((t) => t.label).join(" · ") || "留白")}</span></div>
        <div class="spec-row"><b>底栏</b><span>${escapeHtml(design.contacts.map((x) => x.value).join("  ·  ") || "无联系")}</span></div>
        <div class="spec-row"><b>不上卡</b><span>${escapeHtml(design.omitted.map((t) => `${t.label}：${t.reason}`).join("；") || "无")}</span></div>
      </div>`;
  const reasons = `<ul>${strategy.rationale.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>`;
  brief.innerHTML = `${warns}${spec}${reasons}`;

  document.getElementById("cards").innerHTML = cardPair(strategy, state.profile);
  document.getElementById("print-sheet").innerHTML =
    `<div class="card-frame">${cardMarkup(strategy, state.profile, "front")}</div>` +
    `<div class="card-frame">${cardMarkup(strategy, state.profile, "back")}</div>`;
  renderQr();
  document.getElementById("prompt-zh").textContent = prompts.zh;
  document.getElementById("prompt-en").textContent = prompts.en;

  const pngOk = Boolean(strategy.completeness.named);
  const vcfOk = Boolean(strategy.completeness.named && strategy.completeness.contact);
  document.getElementById("btn-png-front").disabled = !pngOk;
  document.getElementById("btn-png-back").disabled = !pngOk;
  document.getElementById("btn-pdf").disabled = !pngOk;
  document.getElementById("btn-vcf").disabled = !vcfOk;

  const hasPortrait = Boolean(state.profile.portrait);
  const hasFile = Boolean(state.profile.attachmentName);
  const pChip = document.getElementById("portrait-chip");
  const fChip = document.getElementById("file-chip");
  pChip.hidden = !hasPortrait;
  pChip.textContent = hasPortrait ? "头像已选" : "";
  fChip.hidden = !hasFile;
  fChip.textContent = hasFile ? state.profile.attachmentName : "";
  document.getElementById("btn-clear-files").hidden = !hasPortrait && !hasFile;
}

async function runBrief() {
  if (briefing) return;
  briefing = true;
  briefNote = { text: "顾问在读场合、用途、人群和你的资历…", error: false };
  render({ skipInputs: true });

  try {
    state.brief = await requestBrief(briefContext(state));
    briefNote = { text: "设计稿已出。往下走第二步，让视觉设计师按这份稿子出三版。", error: false };
    persist();
  } catch (err) {
    briefNote = { text: err.message || "设计稿写不出来，稍后再试。", error: true };
  } finally {
    briefing = false;
    render({ skipInputs: true });
  }
}

async function runDesigner() {
  if (designing) return;
  designing = true;
  designNote = { text: "设计师在读设计稿的气质要求…", error: false };
  render({ skipInputs: true });

  try {
    const specs = await requestStyles(compose(state).brief, briefContext(state), state.paletteHint);
    state.candidates = specs;
    state.styleSpec = specs[0];
    designNote = { text: "三版已出，点任意一版采纳；卡面、说明和生图提示词会跟着换。", error: false };
    persist();
  } catch (err) {
    designNote = { text: err.message || "生成失败，稍后再试。", error: true };
  } finally {
    designing = false;
    render({ skipInputs: true });
  }
}

async function exportPng(face) {
  if (!state.profile.name?.trim()) return;
  try {
    const blob = await withExportFrame(cardMarkup(compose(state), state.profile, face), frameToPngBlob);
    downloadBlob(blob, `${fileStem(state.profile)}-${face === "front" ? "front" : "back"}.png`);
  } catch (err) {
    designNote = { text: err.message || "PNG 导出失败", error: true };
    render({ skipInputs: true });
  }
}

async function exportPdf() {
  if (!state.profile.name?.trim()) return;
  try {
    const strategy = compose(state);
    const front = await withExportFrame(cardMarkup(strategy, state.profile, "front"), frameToJpegBytes);
    const back = await withExportFrame(cardMarkup(strategy, state.profile, "back"), frameToJpegBytes);
    downloadBlob(
      pdfFromJpegs([
        { jpeg: front, width: PNG_W, height: PNG_H },
        { jpeg: back, width: PNG_W, height: PNG_H },
      ]),
      `${fileStem(state.profile)}.pdf`,
    );
  } catch (err) {
    designNote = { text: err.message || "PDF 导出失败", error: true };
    render({ skipInputs: true });
  }
}

function exportVcf() {
  const strategy = compose(state);
  downloadText(
    buildVCard(state.profile, {
      showOrg: strategy.companyMode === "show",
      pitch: strategy.brief.back.pitch,
    }),
    `${fileStem(state.profile)}.vcf`,
    "text/vcard;charset=utf-8",
  );
}

function bind() {
  for (const el of document.querySelectorAll("[data-profile]")) {
    el.addEventListener("input", () => {
      state.profile[el.dataset.profile] = el.value;
      persist();
      render({ skipInputs: true });
    });
  }

  document.getElementById("e-masthead").addEventListener("input", (event) => {
    const value = event.target.value;
    state.edits.masthead = value === derived.masthead ? "" : value;
    persist();
    render({ skipInputs: true });
  });
  document.getElementById("e-role").addEventListener("input", (event) => {
    const value = event.target.value;
    state.edits.role = value === derived.role ? "" : value;
    persist();
    render({ skipInputs: true });
  });
  document.getElementById("e-pitch").addEventListener("input", (event) => {
    const value = event.target.value;
    state.edits.pitch = value === derived.pitch ? "" : value;
    persist();
    render({ skipInputs: true });
  });

  document.getElementById("backmode-row").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-backmode]");
    if (!btn) return;
    state.edits.backMode = btn.dataset.backmode;
    persist();
    render({ skipInputs: true });
  });

  document.getElementById("qr-mode").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-qr-mode]");
    if (!btn) return;
    state.qrOverride = btn.dataset.qrMode;
    persist();
    render({ skipInputs: true });
  });

  document.getElementById("btn-brief").addEventListener("click", runBrief);
  document.getElementById("btn-brief-reset").addEventListener("click", () => {
    state.brief = null;
    briefNote = { text: "", error: false };
    persist();
    render({ skipInputs: true });
  });

  document.getElementById("btn-design").addEventListener("click", runDesigner);
  document.getElementById("btn-design-reset").addEventListener("click", () => {
    state.styleSpec = null;
    designNote = { text: "", error: false };
    persist();
    render({ skipInputs: true });
  });
  document.getElementById("candidates").addEventListener("click", (event) => {
    const btn = event.target.closest(".cand");
    if (!btn) return;
    const spec = state.candidates[Number(btn.dataset.cand)];
    if (!spec) return;
    state.styleSpec = spec;
    designNote = { text: "", error: false };
    persist();
    render({ skipInputs: true });
  });

  document.getElementById("btn-portrait").addEventListener("click", () => {
    document.getElementById("in-portrait").click();
  });
  document.getElementById("btn-file").addEventListener("click", () => {
    document.getElementById("in-file").click();
  });
  document.getElementById("in-portrait").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      state.profile.portrait = await readPortrait(file);
      persist();
      render();
    } catch {
      alert("头像读不出来，换一张图试试。");
    }
  });
  document.getElementById("in-file").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.type.startsWith("image/") && !state.profile.portrait) {
      try {
        state.profile.portrait = await readPortrait(file);
      } catch {
        /* still keep as attachment */
      }
    }
    state.profile.attachmentName = file.name;
    persist();
    render();
  });
  document.getElementById("btn-clear-files").addEventListener("click", () => {
    state.profile.portrait = "";
    state.profile.attachmentName = "";
    persist();
    render();
  });

  document.getElementById("btn-qr").addEventListener("click", () => {
    document.getElementById("in-qr").click();
  });
  document.getElementById("in-qr").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) await acceptQrImage(file);
  });
  document.getElementById("qr-slot").addEventListener("paste", async (event) => {
    event.preventDefault();
    const file = imageFromClipboard(event.clipboardData);
    if (file) await acceptQrImage(file);
  });
  document.getElementById("btn-qr-clear").addEventListener("click", () => {
    state.profile.qrImage = "";
    persist();
    render({ skipInputs: true });
  });

  document.getElementById("btn-demo").addEventListener("click", () => {
    state = {
      ...blank(),
      audience: DEMO.audience,
      scene: DEMO.scene,
      purpose: DEMO.purpose,
      stage: DEMO.stage,
      profile: { ...EMPTY_PROFILE, ...DEMO.profile },
    };
    designNote = { text: "", error: false };
    persist();
    render();
  });
  document.getElementById("btn-reset").addEventListener("click", () => {
    if (!confirm("清空当前草稿？")) return;
    state = blank();
    designNote = { text: "", error: false };
    persist();
    render();
  });
  document.getElementById("btn-print").addEventListener("click", () => window.print());
  document.getElementById("btn-png-front").addEventListener("click", () => exportPng("front"));
  document.getElementById("btn-png-back").addEventListener("click", () => exportPng("back"));
  document.getElementById("btn-pdf").addEventListener("click", exportPdf);
  document.getElementById("btn-vcf").addEventListener("click", exportVcf);

  document.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.copy === "zh" ? "prompt-zh" : "prompt-en";
      const text = document.getElementById(id).textContent;
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = "已复制";
        setTimeout(() => {
          btn.textContent = btn.dataset.copy === "zh" ? "复制" : "Copy";
        }, 1200);
      } catch {
        alert("复制失败，请手动选中提示词。");
      }
    });
  });
}

bind();
{
  const params = new URLSearchParams(location.search);
  if (params.has("demo")) {
    state = {
      ...blank(),
      audience: DEMO.audience,
      scene: DEMO.scene,
      purpose: DEMO.purpose,
      stage: DEMO.stage,
      profile: { ...EMPTY_PROFILE, ...DEMO.profile },
    };
  }
  const stance = params.get("stance");
  if (stance) state.stanceOverride = stance;
  persist();
}
render();
