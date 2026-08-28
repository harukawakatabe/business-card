/* 同步 js/theme.js 的 THEME_KEY。必须在 CSS 之前跑，避免先闪默认再切主题。 */
(function () {
  var t = "cedar";
  try {
    if (localStorage.getItem("identity.theme.v1") === "paper") t = "paper";
  } catch (e) {}
  document.documentElement.setAttribute("data-theme", t);
})();
