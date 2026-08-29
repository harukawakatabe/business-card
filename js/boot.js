/**
 * 页面门卫：先确认登录，再动态拉起页面逻辑（flow / app）。
 * 页面脚本从这一刻起才求值，auth / store 里的「当前用户」已就位。
 */
import { mountUserChip, requireUser } from "./auth.js";

const page = document.querySelector("script[data-page]")?.dataset.page || "";
if (!["flow", "app"].includes(page)) throw new Error(`boot: 未知页面 ${page}`);

const user = await requireUser();
if (user) {
  mountUserChip();
  await import(`./${page}.js`);
}
