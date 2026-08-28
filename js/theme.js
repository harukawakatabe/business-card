/**
 * 界面主题：只换网页皮肤，不锁名片。
 * 默认雪松林（cedar），纸墨（paper）是另一套；存在 identity.theme.v1，两页共用。
 */

export const THEME_KEY = "identity.theme.v1";
export const DEFAULT_THEME = "cedar";
export const THEMES = [
  { id: "cedar", label: "雪松林" },
  { id: "paper", label: "纸墨" },
];

export function normalizeTheme(id) {
  return id === "paper" ? "paper" : "cedar";
}

export function currentTheme() {
  return normalizeTheme(document.documentElement.getAttribute("data-theme"));
}

export function setTheme(id) {
  const theme = normalizeTheme(id);
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* 无痕模式 */
  }
  syncThemeSwitcher();
}

export function syncThemeSwitcher(root = document) {
  const cur = currentTheme();
  for (const btn of root.querySelectorAll("[data-theme-set]")) {
    const on = btn.dataset.themeSet === cur;
    btn.classList.toggle("is-on", on);
    btn.setAttribute("aria-checked", on ? "true" : "false");
  }
}

export function bindThemeSwitcher(root = document) {
  const box = root.querySelector(".theme-switch");
  if (!box || box.dataset.ready) return;
  box.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-theme-set]");
    if (!btn) return;
    setTheme(btn.dataset.themeSet);
  });
  box.dataset.ready = "1";
  syncThemeSwitcher(root);
}
