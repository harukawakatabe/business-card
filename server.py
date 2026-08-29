#!/usr/bin/env python3
"""零依赖服务：静态文件 + /api/design 大模型代理 + 账号与档案。

代理只做一件事——把浏览器发来的 Messages 请求补上 model 和 API key 再转给上游，
让密钥留在这台机器的 .env 里，不进浏览器、不进仓库。生图 API 仍留给下一阶段。

上游可以是任何说 Anthropic Messages 协议的服务（官方、Kimi、MiMo、DeepSeek…），
按 .env 里的顺序依次尝试，前一家失败就换下一家。协议不同的服务不在此列。

对外服务（HOST=0.0.0.0 挂到域名上）：访客在 login.html 注册 / 登录，一人一份
档案存在 data/store/ 下自己的文件里；设计代理对登录用户开放，本机请求依旧直通。
data/ 和 .env 永远不会被当静态文件发出去。
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import time
import urllib.error
import urllib.request
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parent
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8765"))

MAX_BODY = 256 * 1024
DEFAULT_MODEL = "claude-sonnet-4-5-20250929"
DEFAULT_VERSION = "2023-06-01"
ENV_HINT = (
    "还没配可用的大模型。复制 .env.example 为 .env，按里面的说明填一家的 BASE_URL / API_KEY / MODEL "
    "后重启 server.py。在这之前设计稿走规则草稿、视觉走内置的六套预设，工具照样能用。"
)

# ---------- 账号与档案（对外服务） ----------

DATA_DIR = ROOT / "data"
AUTH_FILE = DATA_DIR / "auth.json"
STORE_DIR = DATA_DIR / "store"
AUTH_LOCK = threading.Lock()
STORE_LOCK = threading.Lock()
SESSION_COOKIE = "bc_session"
SESSION_SECONDS = 30 * 24 * 3600
PBKDF2_ROUNDS = 120_000
# 用户名会变成文件名、也会直接进 DOM，只放中英文、数字和 _ - . ·
USERNAME_RE = re.compile(r"[\w.\-·一-龥]{1,20}", re.ASCII)
STORE_KEYS = ("flow", "atelier")
MAX_STORE_BODY = 3 * 1024 * 1024


def load_env(path: Path) -> None:
    """把 .env 读进 os.environ，已存在的真实环境变量优先。"""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.split("#", 1)[0].strip().strip("'\"")
        if key and key not in os.environ:
            os.environ[key] = value


def env(*names: str) -> str:
    for n in names:
        v = os.environ.get(n, "").strip()
        if v:
            return v
    return ""


def provider(name: str) -> dict | None:
    """按 .env 的命名约定解析一家上游：LLM_<名>_BASE_URL / _API_KEY / _MODEL。

    `anthropic` 是特例，用官方那套 ANTHROPIC_* 变量。只认 Anthropic Messages 协议，
    显式声明了别的 protocol 的直接跳过——翻译协议不是这个代理的事。
    """
    key_prefix = name.upper()
    if name == "anthropic":
        base = env("ANTHROPIC_BASE_URL") or "https://api.anthropic.com"
        api_key = env("ANTHROPIC_API_KEY")
        model = env("ANTHROPIC_MODEL") or DEFAULT_MODEL
        auth = "x-api-key"
    else:
        base = env(f"LLM_{key_prefix}_BASE_URL")
        api_key = env(f"LLM_{key_prefix}_API_KEY")
        model = env(f"LLM_{key_prefix}_MODEL")
        auth = env(f"LLM_{key_prefix}_AUTH_MODE") or "x-api-key"
        protocol = env(f"LLM_{key_prefix}_PROTOCOL") or "anthropic"
        if protocol != "anthropic":
            return None
    if not (base and api_key and model):
        return None
    return {
        "name": name,
        "url": f"{base.rstrip('/')}/v1/messages",
        "key": api_key,
        "model": model,
        "auth": auth,
        # 思考默认关：这套流程全靠指定工具调用，而多家上游一开思考就要么拒绝
        # tool_choice、要么把额度全花在思考上，轮不到工具。
        "thinking": (env(f"LLM_{key_prefix}_THINKING") or "disabled").lower(),
    }


def provider_chain() -> list[dict]:
    """首选 + 回落链。默认沿用 .env 里 FIX_PROVIDER / FIX_FALLBACK 的顺序。"""
    first = env("DESIGN_PROVIDER", "FIX_PROVIDER") or "anthropic"
    rest = env("DESIGN_FALLBACK", "FIX_FALLBACK")
    names: list[str] = []
    for raw in [first, *rest.split(","), "anthropic"]:
        n = raw.strip().lower()
        if n and n not in names:
            names.append(n)
    return [p for p in (provider(n) for n in names) if p]


def auth_headers(p: dict) -> dict:
    if p["auth"].lower() in ("bearer", "authorization"):
        return {"Authorization": f"Bearer {p['key']}"}
    return {"x-api-key": p["key"]}


def load_auth() -> dict:
    """读 data/auth.json；坏了就当空库重新开始，顺手清掉过期会话。"""
    try:
        data = json.loads(AUTH_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        data = {}
    users = data.get("users") if isinstance(data, dict) else None
    raw = data.get("sessions") if isinstance(data, dict) else None
    now = time.time()
    sessions = {}
    if isinstance(raw, dict):
        for token, v in raw.items():
            if isinstance(v, dict) and now - v.get("at", 0) < SESSION_SECONDS:
                sessions[token] = v
    return {"users": users if isinstance(users, dict) else {}, "sessions": sessions}


def save_auth(data: dict) -> None:
    DATA_DIR.mkdir(exist_ok=True)
    tmp = AUTH_FILE.with_name("auth.json.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    tmp.replace(AUTH_FILE)


def hash_password(password: str, salt: str = "") -> tuple[str, str]:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt), PBKDF2_ROUNDS
    ).hex()
    return salt, digest


def read_store(username: str) -> dict:
    try:
        data = json.loads((STORE_DIR / f"{username}.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def write_store(username: str, key: str, value: dict) -> None:
    """一人一个文件，两个档案（flow / atelier）合在里头，读改写整体走锁。"""
    STORE_DIR.mkdir(parents=True, exist_ok=True)
    data = read_store(username)
    data[key] = value
    path = STORE_DIR / f"{username}.json"
    tmp = STORE_DIR / f"{username}.json.tmp"
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        print(f"[identity] {self.address_string()} {fmt % args}")

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    # ---------- 工具 ----------

    def send_json(self, status: int, payload: dict, headers: tuple[tuple[str, str], ...] = ()) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        for k, v in headers:
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self, cap: int = MAX_BODY) -> dict | None:
        """读一个 JSON 对象请求体；不合格时已经回错并返回 None。"""
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > cap:
            self.send_json(400, {"error": "请求体为空或过大"})
            return None
        try:
            payload = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self.send_json(400, {"error": "请求体不是合法 JSON"})
            return None
        if not isinstance(payload, dict):
            self.send_json(400, {"error": "请求体必须是 JSON 对象"})
            return None
        return payload

    def is_local(self) -> bool:
        host = self.client_address[0]
        return host in ("127.0.0.1", "::1", "localhost")

    def translate_path(self, path):
        # 账号库和密钥永远不该被当静态文件发出去
        clean = urlsplit(path).path
        if clean == "/.env" or clean.rstrip("/") == "/data" or clean.startswith("/data/"):
            return str(ROOT / "__blocked__")
        return super().translate_path(path)

    # ---------- 会话 ----------

    def session_token(self) -> str:
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie") or "")
        except Exception:  # Cookie 头怎么坏都不至于拦请求
            return ""
        morsel = cookie.get(SESSION_COOKIE)
        return morsel.value if morsel else ""

    def session_user(self) -> str | None:
        token = self.session_token()
        if not token:
            return None
        with AUTH_LOCK:
            return load_auth()["sessions"].get(token, {}).get("user")

    def session_cookie(self, token: str, clear: bool = False) -> str:
        parts = [f"{SESSION_COOKIE}={token}", "Path=/", "HttpOnly", "SameSite=Lax"]
        parts.append("Max-Age=0" if clear else f"Max-Age={SESSION_SECONDS}")
        # 反向代理把 TLS 终止在外面时，补上 Secure
        if self.headers.get("X-Forwarded-Proto", "").lower() == "https":
            parts.append("Secure")
        return "; ".join(parts)

    # ---------- 路由 ----------

    def do_GET(self) -> None:  # noqa: N802
        parts = urlsplit(self.path)
        route = parts.path.rstrip("/")
        if route == "/api/auth":
            self.send_json(200, {"user": self.session_user()})
            return
        if route == "/api/store":
            user = self.session_user()
            if not user:
                self.send_json(401, {"error": "先登录"})
                return
            key = (parse_qs(parts.query).get("key") or [""])[0]
            if key not in STORE_KEYS:
                self.send_json(400, {"error": "没有这个档案"})
                return
            data = read_store(user).get(key)
            self.send_json(200, {"data": data if isinstance(data, dict) else None})
            return
        super().do_GET()

    def do_PUT(self) -> None:  # noqa: N802
        if urlsplit(self.path).path.rstrip("/") == "/api/store":
            self.handle_store()
            return
        self.send_json(404, {"error": "没有这个接口"})

    def handle_auth(self) -> None:
        payload = self.read_json()
        if payload is None:
            return
        action = payload.get("action")

        if action == "logout":
            token = self.session_token()
            if token:
                with AUTH_LOCK:
                    data = load_auth()
                    data["sessions"].pop(token, None)
                    save_auth(data)
            self.send_json(200, {"user": None}, [("Set-Cookie", self.session_cookie("", clear=True))])
            return

        username = str(payload.get("username") or "").strip()
        password = str(payload.get("password") or "")
        if not USERNAME_RE.fullmatch(username):
            self.send_json(400, {"error": "用户名 1–20 位，只能用中英文、数字和 _ - . ·"})
            return
        if not 6 <= len(password) <= 128:
            self.send_json(400, {"error": "密码要 6–128 位"})
            return

        with AUTH_LOCK:
            data = load_auth()
            user = data["users"].get(username)
            if action == "register":
                if user:
                    self.send_json(409, {"error": "这个名字已经有人用了"})
                    return
                salt, digest = hash_password(password)
                data["users"][username] = {"salt": salt, "hash": digest, "created": int(time.time())}
            elif action == "login":
                if not user or not hmac.compare_digest(
                    hash_password(password, user["salt"])[1], user["hash"]
                ):
                    self.send_json(401, {"error": "用户名或密码不对"})
                    return
            else:
                self.send_json(400, {"error": "不认识的 action"})
                return
            token = secrets.token_urlsafe(32)
            data["sessions"][token] = {"user": username, "at": int(time.time())}
            save_auth(data)
        self.send_json(200, {"user": username}, [("Set-Cookie", self.session_cookie(token))])

    def handle_store(self) -> None:
        user = self.session_user()
        if not user:
            self.send_json(401, {"error": "先登录"})
            return
        payload = self.read_json(cap=MAX_STORE_BODY)
        if payload is None:
            return
        key = payload.get("key")
        data = payload.get("data")
        if key not in STORE_KEYS or not isinstance(data, dict):
            self.send_json(400, {"error": "档案格式不对"})
            return
        with STORE_LOCK:
            write_store(user, key, data)
        self.send_json(200, {"ok": True})

    def do_POST(self) -> None:  # noqa: N802
        route = urlsplit(self.path).path.rstrip("/")
        if route == "/api/auth":
            self.handle_auth()
            return
        if route == "/api/store":
            self.handle_store()
            return
        if route != "/api/design":
            self.send_json(404, {"error": "没有这个接口"})
            return
        # 对外服务：登录用户也放行设计代理，额度由 .env 那家上游承担
        if not (self.is_local() or self.session_user()):
            self.send_json(403, {"error": "代理只服务登录用户"})
            return

        chain = provider_chain()
        if not chain:
            self.send_json(501, {"error": ENV_HINT})
            return

        payload = self.read_json()
        if payload is None:
            return

        payload.setdefault("max_tokens", 4096)

        raw = None
        used = None
        failures: list[str] = []
        for p in chain:
            body = dict(payload)
            body["model"] = p["model"]
            if p["thinking"] != "enabled":
                body["thinking"] = {"type": "disabled"}

            # 少数上游不认 thinking 这个字段，被它一句话废掉一家不值得，去掉再试一次。
            for attempt in ("with-thinking-field", "without"):
                if attempt == "without":
                    body.pop("thinking", None)
                req = urllib.request.Request(
                    p["url"],
                    data=json.dumps(body).encode("utf-8"),
                    headers={
                        "Content-Type": "application/json",
                        "anthropic-version": os.environ.get("ANTHROPIC_VERSION", DEFAULT_VERSION),
                        **auth_headers(p),
                    },
                    method="POST",
                )
                try:
                    with urllib.request.urlopen(req, timeout=180) as upstream:
                        raw = upstream.read()
                    used = p
                    break
                except urllib.error.HTTPError as exc:
                    detail = exc.read().decode("utf-8", "replace")
                    try:
                        message = json.loads(detail).get("error", {}).get("message", detail)
                    except (json.JSONDecodeError, AttributeError):
                        message = detail
                    failures.append(f"{p['name']}（{exc.code}）：{message[:200]}")
                    if attempt == "with-thinking-field" and "thinking" in message.lower():
                        continue
                except (urllib.error.URLError, TimeoutError) as exc:
                    failures.append(f"{p['name']}：连不上（{exc})")
                break

            if raw is not None:
                break
            print(f"[identity] {failures[-1]}　→ 换下一家", flush=True)

        if raw is None:
            self.send_json(502, {"error": "所有上游都没成：" + "；".join(failures)})
            return

        print(f"[identity] 设计师由 {used['name']} / {used['model']} 作答", flush=True)
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("X-Design-Provider", f"{used['name']}/{used['model']}")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


def main() -> None:
    load_env(ROOT / ".env")
    os.chdir(ROOT)
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    chain = provider_chain()
    print(f"商业身份  http://{HOST}:{PORT}", flush=True)
    print("账号档案  data/（登录用户一人一份，gitignored）", flush=True)
    if chain:
        print("设计师上游  " + " → ".join(f"{p['name']}/{p['model']}" for p in chain), flush=True)
    else:
        print("设计师上游  未配置（设计稿走规则草稿，视觉走内置预设）", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
