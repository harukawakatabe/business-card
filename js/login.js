/**
 * 登录页：登录 / 注册同一个表单，成功即进产品。
 */
const form = document.getElementById("login-form");
const userInput = document.getElementById("f-user");
const passInput = document.getElementById("f-pass");
const note = document.getElementById("login-note");
const btnLogin = document.getElementById("btn-login");
const btnReg = document.getElementById("btn-reg");

// 只认自家两页，别的 next 一律回首页，不当跳板
const NEXT = new Set(["index.html", "studio.html"]);
const nextTarget = () => {
  const n = new URLSearchParams(location.search).get("next");
  return NEXT.has(n) ? n : "index.html";
};

// 已经登录着的，直接进
fetch("/api/auth")
  .then((r) => r.json())
  .then((d) => {
    if (d.user) location.replace(nextTarget());
  })
  .catch(() => {});

let busy = false;
async function submit(action) {
  if (busy) return;
  busy = true;
  btnLogin.disabled = true;
  btnReg.disabled = true;
  note.textContent = action === "register" ? "在建账号…" : "在核对…";
  try {
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, username: userInput.value.trim(), password: passInput.value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "没成功，再试一次。");
    location.replace(nextTarget());
  } catch (err) {
    note.textContent = err.message;
    busy = false;
    btnLogin.disabled = false;
    btnReg.disabled = false;
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  submit("login");
});
btnReg.addEventListener("click", () => submit("register"));
