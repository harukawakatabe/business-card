# 商业身份

本地网页工具：把一张名片当成**一次相遇的身份设计**，而不是填空生成的联系卡片。

你先说清四件事——在什么场合、这张卡用来做什么、递给什么人、你现在处于哪一段——再可选地放下个人资历。工具据此写出一份名片设计稿，再按这份稿子做出视觉。

两个页面，互不覆盖：

- **首页（产品版）** http://127.0.0.1:8765/ — 一份人物料、多场相遇；答完四问一键生成，下载 PNG / PDF / vCard。挂到个人域名时，根路径就是这一页。
- **工作室** http://127.0.0.1:8765/studio.html — 逐步问询、手改文案、立场和色系、导出、打印、生图提示词

名片本身是前端代码渲染的真实版面，不是图片：配色、字体、字距、留白、纸面装饰全部由一份**设计规格**驱动，所以样式可以被大模型现场设计，而不是从固定模板里挑。

## 运行

需要 Python 3（只用标准库）。

```bash
python3 server.py
# 浏览器打开 http://127.0.0.1:8765
```

端口可用环境变量改：`PORT=8766 python3 server.py`。草稿存在浏览器 `localStorage`，不上传任何服务器。

### 让大模型写设计稿并做视觉（可选）

不配 key 也能用：设计稿走规则草稿，视觉走内置的六套预设。要开大模型：

```bash
cp .env.example .env   # 填一家上游的 BASE_URL / API_KEY / MODEL，然后重启 server.py
```

代理只认 Anthropic Messages 协议（Kimi / MiMo / DeepSeek / 官方都可以）。`DESIGN_PROVIDER` 和 `DESIGN_FALLBACK` 决定试的顺序。key 只由 `server.py` 读取，浏览器拿不到；`.env` 已在 `.gitignore` 里。前端请求走本机 `/api/design` 代理，只接受来自本机的调用。

配好后先点「让顾问写设计稿」，再点「出三版视觉」。第二步可以挑一个色系模板（墨金、夜橙、朱砂…），不选则三版必须换色相——工作室网页的雪松绿只是界面皮肤，不锁名片。点任意一版采纳；卡面、设计说明和两份生图提示词会同步换掉。

## 部署成线上服务（可选）

直跑适合本机用；要长期对外，配 systemd 常驻 + nginx 反代上 HTTPS。

`/etc/systemd/system/business-card.service`：

```ini
[Unit]
Description=business-card
After=network.target

[Service]
WorkingDirectory=/path/to/business-card
ExecStart=/usr/bin/python3 server.py
User=www-data
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now business-card   # 开机自启 + 立即启动
```

日常：`sudo systemctl restart business-card` 重启（改完 `server.py` 必须重启，Python 不热加载），`journalctl -u business-card -f` 看日志。

监听地址用环境变量传（如 `Environment=HOST=0.0.0.0` 写进单元文件的 `[Service]`）。注意 `HOST` 写在 `.env` 里**不生效**——它在 `.env` 加载之前就被读了。更推荐的做法是不把 8765 暴露到公网，而是挂反代（顺带拿到 HTTPS）：

nginx 站点（如 `/etc/nginx/sites-enabled/your.domain.conf`）：

```nginx
server {
    server_name your.domain;
    client_max_body_size 20m;      # 档案里带二维码 PNG data URL，默认 1m 可能不够
    location / {
        proxy_pass http://127.0.0.1:8765;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;   # 设计接口要等大模型，默认 60s 会中途掐断
    }
    listen 80;
}
```

```bash
sudo certbot --nginx -d your.domain   # 签 Let's Encrypt 证书 + 自动加 443 和 HTTP 跳转
```

挂了反代后在 `.env` 里设 `TRUST_PROXY=1`：注册限流改按 `X-Forwarded-For` 里的真实访客 IP 算——不然所有请求的来源都是 127.0.0.1，全站共享一个限流额度。只在有反代时开：直连时这个头谁都能伪造。

## 有什么

- 问询式选择：场合、用途、人群、阶段（均可「其他」自填）
- 个人资料与文件全部可空：表单 + 头像 + 附件（附件只记文件名，不解析 PDF）。年龄 / 从业年限 / 行业不上卡，只判断分寸
- 两段链路：设计稿（什么字上卡、为什么）→ 视觉规格（怎么印）
- 样式引擎：设计规格 → CSS 变量 + 装饰层，规格可来自内置预设或大模型
- 90×54mm 双面预览；首页和工作室都能下 PNG / 双面 PDF / vCard，工作室另可打印、复制生图提示词
- 中文、英文生图提示词，跟着当前设计稿和规格走，可复制（工作室）

## 开发

改动 `js/brief.js` 或 `js/style-spec.js` 后跑一遍契约守卫：

```bash
node check-spec.mjs
```

它会拿畸形、越界、恶意的模型输出去打清洗器，断言设计稿不编造联系方式、不写请愿句，视觉规格始终可印制。

## 不是什么

不是 AI 自动画图，不是多人账号系统，也不是把「求职中」印到给别人的卡上。卡是对外身份；策略说明只给你自己看。
