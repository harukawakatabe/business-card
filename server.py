#!/usr/bin/env python3
"""零依赖本地服务：静态文件 + /api/design 大模型代理。

代理只做一件事——把浏览器发来的 Messages 请求补上 model 和 API key 再转给上游，
让密钥留在这台机器的 .env 里，不进浏览器、不进仓库。生图 API 仍留给下一阶段。

上游可以是任何说 Anthropic Messages 协议的服务（官方、Kimi、MiMo、DeepSeek…），
按 .env 里的顺序依次尝试，前一家失败就换下一家。协议不同的服务不在此列。
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

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


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        print(f"[identity] {self.address_string()} {fmt % args}")

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    # ---------- 工具 ----------

    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def is_local(self) -> bool:
        host = self.client_address[0]
        return host in ("127.0.0.1", "::1", "localhost")

    # ---------- 路由 ----------

    def do_POST(self) -> None:  # noqa: N802
        if self.path.rstrip("/") != "/api/design":
            self.send_json(404, {"error": "没有这个接口"})
            return
        if not self.is_local():
            self.send_json(403, {"error": "代理只服务本机请求"})
            return

        chain = provider_chain()
        if not chain:
            self.send_json(501, {"error": ENV_HINT})
            return

        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY:
            self.send_json(400, {"error": "请求体为空或过大"})
            return

        try:
            payload = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self.send_json(400, {"error": "请求体不是合法 JSON"})
            return
        if not isinstance(payload, dict):
            self.send_json(400, {"error": "请求体必须是 JSON 对象"})
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
    if chain:
        print("设计师上游  " + " → ".join(f"{p['name']}/{p['model']}" for p in chain), flush=True)
    else:
        print("设计师上游  未配置（设计稿走规则草稿，视觉走内置预设）", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
