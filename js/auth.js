/**
 * 登录态客户端：会话由 server.py 的 HttpOnly cookie 管，
 * 这里只提供「我是谁」、未登录挡门、页头用户条。用户名进 DOM 前不转义——
 * 服务端只放行中英文、数字和 _ - . ·，构造不出标签。
 */

let current = null;

export function currentUser() {
  return current;
}

/** localStorage 键按用户分流：同一台机器上两个人的缓存互不串。 */
export function userKey(base) {
  return current ? `${base}:${current}` : base;
}

/** 未登录就把页面送去登录页，登录了记下当前用户并返回。 */
export async function requireUser() {
  try {
    const res = await fetch("/api/auth");
    const data = await res.json();
    if (data.user) {
      current = data.user;
      return current;
    }
  } catch {
    /* 服务器没应声，也先去登录页 */
  }
  const page = location.pathname.split("/").pop() || "index.html";
  location.replace(`login.html?next=${encodeURIComponent(page)}`);
  return null;
}

/** 往两页页头挂「用户名 · 积分 · 退出」。 */
export function mountUserChip() {
  const chip = document.getElementById("user-chip");
  if (!chip || !current) return;
  document.getElementById("user-name").textContent = current;
  chip.hidden = false;
  document.getElementById("btn-logout").addEventListener("click", async () => {
    try {
      await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "logout" }),
      });
    } catch {
      /* 登出失败也照样回登录页 */
    }
    location.replace("login.html");
  });
  refreshUserChip();
}

/** 拉一次余额刷新页头。管理员也是普通账号，一样显示余额。 */
export async function refreshUserChip() {
  if (!current || typeof document === "undefined") return;
  const el = document.getElementById("user-credit");
  if (!el) return;
  try {
    const res = await fetch("/api/auth");
    const data = await res.json();
    el.textContent =
      data.user === current && data.credits != null ? `积分 ${data.credits}` : "";
  } catch {
    /* 刷新失败就保持原样 */
  }
}
