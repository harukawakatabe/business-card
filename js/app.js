import { AUDIENCES, DEMO, EMPTY_PROFILE, PURPOSES, SCENES, STAGES, STANCES } from "./data.js";
import { compose } from "./strategy.js";
import { buildPrompts } from "./prompts.js";

const KEY = "identity.atelier.v1";
const FIELDS = [
  ["audience", AUDIENCES],
  ["scene", SCENES],
  ["purpose", PURPOSES],
  ["stage", STAGES],
];

function blank() {
  return {
    audience: "",
    scene: "",
    purpose: "",
    stage: "",
    stanceOverride: "",
    custom: { audience: "", scene: "", purpose: "", stage: "" },
    edits: { headline: "", pitch: "" },
    profile: { ...EMPTY_PROFILE },
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return blank();
    const parsed = JSON.parse(raw);
    return {
      ...blank(),
      ...parsed,
      custom: { ...blank().custom, ...(parsed.custom || {}) },
      edits: { ...blank().edits, ...(parsed.edits || {}) },
      profile: { ...EMPTY_PROFILE, ...(parsed.profile || {}) },
    };
  } catch {
    return blank();
  }
}

let state = load();
let derived = { headline: "", pitch: "" };

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    try {
      const slim = { ...state, profile: { ...state.profile, portrait: "" } };
      localStorage.setItem(KEY, JSON.stringify(slim));
    } catch {
      /* quota */
    }
  }
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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

function cardMarkup(strategy, profile, face) {
  const align = strategy.stanceId === "warm" ? "center" : "left";
  const size = ["authority", "ambitious", "creative"].includes(strategy.stanceId)
    ? "large"
    : "medium";
  const name = profile.name?.trim() || "你的名字";
  const muted = !profile.name?.trim();
  const photo =
    face === "front" && strategy.showPortrait && profile.portrait
      ? `<img class="portrait" alt="" src="${profile.portrait}" />`
      : "";

  if (face === "back") {
    return `<article class="card" data-stance="${strategy.stanceId}" data-align="${align}">
      <div class="card-inner">
        <div>
          <div class="back-kicker">${escapeHtml(strategy.back.kicker)}</div>
          <div class="rule"></div>
          <div class="back-pitch">${escapeHtml(strategy.back.pitch)}</div>
        </div>
        <div class="back-cta">${escapeHtml(strategy.back.cta)}</div>
      </div>
    </article>`;
  }

  const contacts = strategy.contacts
    .map(
      (c) =>
        `<span><em>${escapeHtml(c.label)}</em>${escapeHtml(c.value)}</span>`,
    )
    .join("");

  return `<article class="card" data-stance="${strategy.stanceId}" data-align="${align}" data-size="${size}">
    <div class="card-inner">
      ${photo}
      <div>
        <div class="card-name" style="${muted ? "opacity:.45" : ""}">${escapeHtml(name)}</div>
        ${
          profile.nameEn?.trim()
            ? `<div class="card-en">${escapeHtml(profile.nameEn.trim())}</div>`
            : ""
        }
        <div class="rule"></div>
        <div class="card-head">${escapeHtml(strategy.headline || "对外身份将写在这里")}</div>
      </div>
      <div class="card-contacts">${contacts}</div>
    </div>
  </article>`;
}

function pair(strategy, profile) {
  return `<div>
      <div class="card-label">正面 · 90 × 54 mm</div>
      <div class="card-wrap"><div class="card-scale">${cardMarkup(strategy, profile, "front")}</div></div>
    </div>
    <div>
      <div class="card-label">背面</div>
      <div class="card-wrap"><div class="card-scale">${cardMarkup(strategy, profile, "back")}</div></div>
    </div>`;
}

function render(opts = {}) {
  const strategy = compose(state);
  derived = { headline: strategy.derivedHeadline, pitch: strategy.derivedPitch };
  const prompts = buildPrompts(state, strategy);

  for (const [field, items] of FIELDS) renderChipGroup(field, items);

  if (!opts.skipInputs) {
    for (const el of document.querySelectorAll("[data-profile]")) {
      if (document.activeElement === el) continue;
      el.value = state.profile[el.dataset.profile] || "";
    }
    const headline = document.getElementById("e-headline");
    const pitch = document.getElementById("e-pitch");
    if (document.activeElement !== headline) {
      headline.value = state.edits.headline || strategy.derivedHeadline;
    }
    if (document.activeElement !== pitch) {
      pitch.value = state.edits.pitch || strategy.derivedPitch;
    }
  }

  const names = [
    strategy.audience?.label,
    strategy.scene?.label,
    strategy.purpose?.label,
    strategy.stage?.label,
  ].filter(Boolean);
  document.getElementById("formula").textContent = names.length
    ? `${names.join(" × ")}  →  ${strategy.stance.label}`
    : "场景 × 阶段 × 目的 × 对象  →  形象立场";

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

  const brief = document.getElementById("brief");
  const warns = strategy.warnings
    .map((w) => `<p class="warn">${escapeHtml(w)}</p>`)
    .join("");
  const reasons = `<ul>${strategy.rationale.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>`;
  brief.innerHTML = `${warns}${reasons}<p class="hint">${escapeHtml(strategy.stance.blurb)} 纸面：${escapeHtml(
    strategy.stance.paper,
  )}。</p>`;

  document.getElementById("cards").innerHTML = pair(strategy, state.profile);
  document.getElementById("print-sheet").innerHTML =
    cardMarkup(strategy, state.profile, "front") + cardMarkup(strategy, state.profile, "back");
  document.getElementById("prompt-zh").textContent = prompts.zh;
  document.getElementById("prompt-en").textContent = prompts.en;

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

function bind() {
  for (const el of document.querySelectorAll("[data-profile]")) {
    el.addEventListener("input", () => {
      state.profile[el.dataset.profile] = el.value;
      persist();
      render({ skipInputs: true });
    });
  }

  document.getElementById("e-headline").addEventListener("input", (event) => {
    const value = event.target.value;
    state.edits.headline = value === derived.headline ? "" : value;
    persist();
    render({ skipInputs: true });
  });
  document.getElementById("e-pitch").addEventListener("input", (event) => {
    const value = event.target.value;
    state.edits.pitch = value === derived.pitch ? "" : value;
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

  document.getElementById("btn-demo").addEventListener("click", () => {
    state = {
      ...blank(),
      audience: DEMO.audience,
      scene: DEMO.scene,
      purpose: DEMO.purpose,
      stage: DEMO.stage,
      profile: { ...EMPTY_PROFILE, ...DEMO.profile },
    };
    persist();
    render();
  });
  document.getElementById("btn-reset").addEventListener("click", () => {
    if (!confirm("清空当前草稿？")) return;
    state = blank();
    persist();
    render();
  });
  document.getElementById("btn-print").addEventListener("click", () => window.print());

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
if (new URLSearchParams(location.search).has("demo")) {
  state = {
    ...blank(),
    audience: DEMO.audience,
    scene: DEMO.scene,
    purpose: DEMO.purpose,
    stage: DEMO.stage,
    profile: { ...EMPTY_PROFILE, ...DEMO.profile },
  };
  persist();
}
render();
