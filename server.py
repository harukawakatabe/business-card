#!/usr/bin/env python3
"""零依赖服务：静态文件 + /api/design 大模型代理 + 账号与档案。

代理只做一件事——把浏览器发来的 Messages 请求补上 model 和 API key 再转给上游，
让密钥留在这台机器的 .env 里，不进浏览器、不进仓库。生图 API 仍留给下一阶段。

上游可以是任何说 Anthropic Messages 协议的服务（官方、Kimi、MiMo、DeepSeek…），
按 .env 里的顺序依次尝试，前一家失败就换下一家。协议不同的服务不在此列。

对外服务（HOST=0.0.0.0 挂到域名上）：访客在 login.html 注册 / 登录，账号、会话、
一人一份的档案和积分都记在 data/identity.db（SQLite，标准库自带，仍是零依赖）；
设计代理对登录用户开放、按积分计费（DESIGN_CREDITS / DESIGN_COST，.env 里配的
ADMIN_USER 不限）。挂在反向代理后面时设 TRUST_PROXY=1，才拿得到真实客户端 IP。
data/ 和 .env 永远不会被当静态文件发出去。
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
import urllib.error
import urllib.request
from contextlib import contextmanager
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

# ---------- 账号、档案与积分（对外服务，SQLite 单文件库） ----------

DATA_DIR = ROOT / "data"
DB = DATA_DIR / "identity.db"
SESSION_COOKIE = "bc_session"
SESSION_SECONDS = 30 * 24 * 3600
PBKDF2_ROUNDS = 120_000
# 用户名是数据库主键、也会直接进 DOM，只放中英文、数字和 _ - . ·
USERNAME_RE = re.compile(r"[\w.\-·一-龥]{1,20}", re.ASCII)
STORE_KEYS = ("flow", "atelier")
MAX_STORE_BODY = 3 * 1024 * 1024
# 开放注册没有邮箱验证，用每 IP 限注册顶住批量薅积分；内存计数，重启即清
REGISTER_LIMIT, REGISTER_WINDOW = 5, 3600
REGISTER_LOG: dict[str, list[float]] = {}

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  salt     TEXT NOT NULL,
  hash     TEXT NOT NULL,
  credits  INTEGER NOT NULL,
  created  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token    TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  at       INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS store (
  username TEXT NOT NULL,
  key      TEXT NOT NULL,
  data     TEXT NOT NULL,
  updated  INTEGER NOT NULL,
  PRIMARY KEY (username, key)
);
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
"""


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


def initial_credits() -> int:
    """新账号送多少积分。DESIGN_CREDITS 写在 .env 里，默认 500。"""
    try:
        return max(0, int(float(env("DESIGN_CREDITS") or 500)))
    except ValueError:
        return 500


def design_cost() -> float:
    """单段设计（写设计稿 / 出三版视觉）扣多少分。DESIGN_COST 写在 .env 里，默认 25；
    产品页一键生成走两段 = 50 分。"""
    try:
        return max(0.0, float(env("DESIGN_COST") or 25))
    except ValueError:
        return 25


def fmt_credits(n: float) -> str:
    """12.5 → "12.5"，25.0 → "25"。"""
    return f"{n:g}"


def is_admin(username: str) -> bool:
    name = env("ADMIN_USER")
    return bool(name) and username == name


def ensure_admin() -> None:
    """按 .env 建 / 对齐管理员账号：密码以 .env 为准，防止名字被别人抢注冒充。"""
    name = env("ADMIN_USER")
    password = env("ADMIN_PASSWORD")
    if not name or not password:
        return
    with db() as con:
        row = con.execute("SELECT salt, hash FROM users WHERE username = ?", (name,)).fetchone()
        if row and hmac.compare_digest(hash_password(password, row["salt"])[1], row["hash"]):
            return
        salt, digest = hash_password(password)
        con.execute(
            "INSERT INTO users (username, salt, hash, credits, created) VALUES (?,?,?,?,?) "
            "ON CONFLICT(username) DO UPDATE SET salt = excluded.salt, hash = excluded.hash",
            (name, salt, digest, initial_credits(), int(time.time())),
        )
    print(f"管理员  {name}（积分不限）", flush=True)


@contextmanager
def db():
    """一个请求一个连接、一个事务；并发交给 SQLite 自己排队。"""
    con = sqlite3.connect(DB, timeout=30)
    con.row_factory = sqlite3.Row
    try:
        with con:
            yield con
    finally:
        con.close()


def init_db() -> None:
    DATA_DIR.mkdir(exist_ok=True)
    fresh = not DB.exists()
    con = sqlite3.connect(DB)
    try:
        con.executescript(SCHEMA)
        con.execute("PRAGMA journal_mode=WAL")
        con.commit()
    finally:
        con.close()
    if fresh:
        migrate_json_db()
    print(f"账号档案  {DB}（SQLite，{'新建' if fresh else '沿用'}）", flush=True)


def migrate_json_db() -> None:
    """把上一版 JSON 存的账号 / 档案搬进库，搬完改名留档。只有库文件不存在时才会走到。"""
    legacy_auth = DATA_DIR / "auth.json"
    legacy_store = DATA_DIR / "store"
    if not legacy_auth.exists() and not legacy_store.is_dir():
        return
    moved = 0
    with db() as con:
        now = int(time.time())
        if legacy_auth.exists():
            try:
                data = json.loads(legacy_auth.read_text(encoding="utf-8"))
                for name, u in (data.get("users") or {}).items():
                    if not isinstance(u, dict):
                        continue
                    con.execute(
                        "INSERT OR IGNORE INTO users (username, salt, hash, credits, created) VALUES (?,?,?,?,?)",
                        (name, u.get("salt", ""), u.get("hash", ""), initial_credits(), u.get("created") or now),
                    )
                for token, s in (data.get("sessions") or {}).items():
                    if isinstance(s, dict):
                        con.execute(
                            "INSERT OR IGNORE INTO sessions (token, username, at) VALUES (?,?,?)",
                            (token, s.get("user", ""), s.get("at") or now),
                        )
            except (OSError, json.JSONDecodeError):
                pass
        if legacy_store.is_dir():
            for path in legacy_store.glob("*.json"):
                try:
                    data = json.loads(path.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    continue
                for key, value in data.items():
                    if key in STORE_KEYS and isinstance(value, dict):
                        con.execute(
                            "INSERT OR REPLACE INTO store (username, key, data, updated) VALUES (?,?,?,?)",
                            (path.stem, key, json.dumps(value, ensure_ascii=False), now),
                        )
                        moved += 1
    if legacy_auth.exists():
        legacy_auth.rename(legacy_auth.with_name(legacy_auth.name + ".imported"))
    if legacy_store.is_dir():
        legacy_store.rename(legacy_store.with_name(legacy_store.name + ".imported"))
    print(f"账号档案  旧 JSON 数据已并入（{moved} 份档案），原件改名 .imported 留档", flush=True)


def register_allowed(ip: str) -> bool:
    now = time.time()
    hits = [t for t in REGISTER_LOG.get(ip, []) if now - t < REGISTER_WINDOW]
    if len(hits) >= REGISTER_LIMIT:
        REGISTER_LOG[ip] = hits
        return False
    hits.append(now)
    REGISTER_LOG[ip] = hits
    return True


def topup_existing() -> None:
    """一次性把存量账号的积分补成当前初始值（只跑一次，meta 表记档）。

    不能做成每次启动都补——那等于谁花掉的积分一重启就回血。以后再调
    DESIGN_CREDITS 也不会自动跟涨，要补就在库里删掉 credits_topup 标记重启。
    """
    with db() as con:
        if con.execute("SELECT value FROM meta WHERE key = 'credits_topup'").fetchone():
            return
        con.execute("UPDATE users SET credits = ?", (initial_credits(),))
        con.execute("INSERT INTO meta (key, value) VALUES ('credits_topup', ?)", (str(int(time.time())),))


def hash_password(password: str, salt: str = "") -> tuple[str, str]:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt), PBKDF2_ROUNDS
    ).hex()
    return salt, digest


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

    def client_ip(self) -> str:
        # 挂在反向代理后面时，所有访客的来源都是 127.0.0.1；
        # 设了 TRUST_PROXY=1 才信 X-Forwarded-For，不然谁都能伪造这个头骗注册限流
        if env("TRUST_PROXY"):
            xff = self.headers.get("X-Forwarded-For", "")
            if xff:
                return xff.split(",")[0].strip()
        return self.client_address[0]

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
        with db() as con:
            row = con.execute(
                "SELECT username FROM sessions WHERE token = ? AND at > ?",
                (token, int(time.time()) - SESSION_SECONDS),
            ).fetchone()
            return row["username"] if row else None

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
            user = self.session_user()
            credits = None
            if user and not is_admin(user):
                with db() as con:
                    row = con.execute("SELECT credits FROM users WHERE username = ?", (user,)).fetchone()
                    credits = row["credits"] if row else None
            # credits 为 null：没登录，或是管理员（不限）
            self.send_json(200, {"user": user, "credits": credits})
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
            data = None
            with db() as con:
                row = con.execute(
                    "SELECT data FROM store WHERE username = ? AND key = ?", (user, key)
                ).fetchone()
            if row:
                try:
                    parsed = json.loads(row["data"])
                    data = parsed if isinstance(parsed, dict) else None
                except json.JSONDecodeError:
                    data = None
            self.send_json(200, {"data": data})
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
                with db() as con:
                    con.execute("DELETE FROM sessions WHERE token = ?", (token,))
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

        with db() as con:
            row = con.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
            if action == "register":
                if row:
                    self.send_json(409, {"error": "这个名字已经有人用了"})
                    return
                if not register_allowed(self.client_ip()):
                    self.send_json(429, {"error": "这个网络注册太频繁，一小时后再来。"})
                    return
                salt, digest = hash_password(password)
                try:
                    con.execute(
                        "INSERT INTO users (username, salt, hash, credits, created) VALUES (?,?,?,?,?)",
                        (username, salt, digest, initial_credits(), int(time.time())),
                    )
                except sqlite3.IntegrityError:
                    # 同名注册撞车，SQLite 串行写保住唯一性
                    self.send_json(409, {"error": "这个名字已经有人用了"})
                    return
            elif action == "login":
                if not row or not hmac.compare_digest(
                    hash_password(password, row["salt"])[1], row["hash"]
                ):
                    self.send_json(401, {"error": "用户名或密码不对"})
                    return
            else:
                self.send_json(400, {"error": "不认识的 action"})
                return
            token = secrets.token_urlsafe(32)
            con.execute(
                "INSERT INTO sessions (token, username, at) VALUES (?,?,?)",
                (token, username, int(time.time())),
            )
            con.execute("DELETE FROM sessions WHERE at < ?", (int(time.time()) - SESSION_SECONDS,))
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
        with db() as con:
            con.execute(
                "INSERT OR REPLACE INTO store (username, key, data, updated) VALUES (?,?,?,?)",
                (user, key, json.dumps(data, ensure_ascii=False), int(time.time())),
            )
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
        # 对外服务：登录用户按积分计费，管理员（.env 里配的 ADMIN_USER）不限
        user = self.session_user()
        if not user:
            self.send_json(403, {"error": "代理只服务登录用户"})
            return

        chain = provider_chain()
        if not chain:
            self.send_json(501, {"error": ENV_HINT})
            return

        payload = self.read_json()
        if payload is None:
            return

        # 先原子预扣（credits 够才扣得动，天然防并发透支），上游全军覆没再还回去
        charged = False
        cost = design_cost()
        if not is_admin(user):
            with db() as con:
                cur = con.execute(
                    "UPDATE users SET credits = credits - ? WHERE username = ? AND credits >= ?",
                    (cost, user, cost),
                )
                if cur.rowcount != 1:
                    self.send_json(
                        402,
                        {
                            "error": (
                                f"积分用完了：账号初始 {fmt_credits(initial_credits())} 分，"
                                f"「让顾问写设计稿」「出三版视觉」各扣 {fmt_credits(cost)} 分、"
                                f"一键生成一次共 {fmt_credits(cost * 2)} 分，上游失败自动返还。"
                                "需要更多请联系站长。"
                            )
                        },
                    )
                    return
            charged = True

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
            if charged:
                with db() as con:
                    con.execute("UPDATE users SET credits = credits + ? WHERE username = ?", (cost, user))
            self.send_json(
                502,
                {
                    "error": "所有上游都没成：" + "；".join(failures) + ("。这一单没扣积分。" if charged else "")
                },
            )
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
    init_db()
    topup_existing()
    ensure_admin()
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    chain = provider_chain()
    print(f"商业身份  http://{HOST}:{PORT}", flush=True)
    if chain:
        print("设计师上游  " + " → ".join(f"{p['name']}/{p['model']}" for p in chain), flush=True)
    else:
        print("设计师上游  未配置（设计稿走规则草稿，视觉走内置预设）", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
