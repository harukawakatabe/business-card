# 商业身份（business-card）

本地 Web 工具：用高维商业思维设计「对外递出的身份」。名片是产物，形象策略是核心。

## 运行

```bash
python3 server.py
# http://127.0.0.1:8765
```

零依赖（只用 Python 标准库）。`server.py` 提供静态文件，外加 `/api/design` 代理和账号 / 档案接口；其余逻辑全在浏览器里（`js/`）。

想让大模型写设计稿并出视觉：`cp .env.example .env` 按里面的说明填一家上游后重启。没配也能跑：设计稿走规则草稿，视觉走内置预设。

对外提供服务：`HOST=0.0.0.0 python3 server.py`。访客在 `login.html` 注册 / 登录（开放注册，用户名 + 密码，PBKDF2 存哈希），两页都要登录才进。账号、会话、按用户一人一份的档案（flow + atelier）、积分全在 `data/identity.db`（SQLite，标准库自带；旧的 JSON 数据首次启动自动并入）——`data/` 已 gitignore，也永远不被当静态文件发出去。设计代理对登录用户按积分计费：新账号送 `DESIGN_CREDITS`（默认 20）分，一段设计扣 1 分、上游失败返还、本机使用不限；每 IP 每小时限注册 5 个账号。挂在反向代理后面时 `.env` 设 `TRUST_PROXY=1` 才能拿到真实客户端 IP，否则「本机不限积分」会被全体访客冒用。

代理只认 Anthropic Messages 协议。`.env` 里 `DESIGN_PROVIDER` / `DESIGN_FALLBACK` 决定顺序（默认 kimi → mimo → deepseek），思考默认关。密钥只走 `.env`，由 `server.py` 读取，绝不进浏览器、不进仓库。

## 两页

- **首页（产品版）** `index.html`：傻瓜主路径，适合拿出去讲故事、挂到个人域名根路径。一份人物料 + 多场相遇；答完四问一键出设计稿和三版视觉，导出正面/背面 PNG、双面 PDF（90×54mm @300dpi）和 vCard。档案键 `identity.flow.v1`，按登录用户存服务器。
- **工作室** `studio.html`：实用向。两段手动走（设计稿 → 出三版视觉）、立场覆盖、色系模板、手改文案、导出、打印、生图提示词。草稿键 `identity.atelier.v1`，同样按登录用户存服务器。两页互链，互不覆盖。`flow.html` 会跳回首页。
- **登录** `login.html`：对外服务的门。注册 / 登录同一个表单，会话走 HttpOnly cookie；两页由 `boot.js` 挡门，未登录先来这儿。

## 工作流：两段链路

1. **问询** 场合 → 用途 → 人群 → 阶段，再填个人资历（年龄 / 从业年限 / 行业不上卡，只判断分寸）。
2. **第一段** 大模型写一份名片设计稿（brief）：什么字上卡、放哪一区、为什么、不上卡的东西为什么不上、给视觉的气质要求。没有 key 时用 `draftBrief()`。
3. **第二段** 大模型拿着这份设计稿出三份视觉规格（spec）。前端按 spec 注入 CSS 变量与装饰层，并拼出生图提示词。没有 key 时用立场对应的内置预设。

两段产物都过各自的清洗器才进渲染路径：`sanitizeBrief()` / `sanitizeSpec()`。改完跑 `node check-spec.mjs`。

## 结构

```
login.html          登录页：注册 / 登录同一个表单
index.html          首页 / 产品版：档案 + 一键生成 + PNG / PDF / vCard
studio.html         工作室：问询 + 预览 + 导出 + 打印 + 生图提示词
flow.html           跳转到首页（旧链接兼容）
css/styles.css      界面样式 + 完全变量驱动的名片渲染
css/flow.css        产品版布局（档案栏 + 主路径）
js/auth.js          登录态客户端：挡门、当前用户、页头用户条
js/boot.js          页面门卫：先登录、再动态拉起 flow / app
js/login.js         登录页交互
js/store.js         档案存取：服务器一人一份 + localStorage 缓存兜底
js/data.js          对象 / 场合 / 目的 / 阶段 / 立场 词表
js/brief.js         设计稿契约：清洗器、规则草稿、人话行、背面中英模式
js/strategy.js      四维解析 + 立场兜底 + 提醒；文案决策交给设计稿
js/style-spec.js    视觉规格契约：schema、清洗器（含二维码位）、六套内置预设、规格 → CSS 变量与装饰层
js/design.js        把设计稿放进规格的版面约束（条目上限、二维码占宽、被挤掉的记进不上卡）
js/render-card.js   设计稿 → 名片 HTML（预览、打印、候选缩略图共用）
js/llm.js           两段客户端：requestBrief → requestStyles
js/prompts.js       中英生图提示词（吃设计稿的必印文字 + 规格 + promptNote）
js/app.js           工作室交互、打印、导出
js/archive.js       产品版档案：一份人物料 + 多场相遇（存取走 store.js）
js/export.js        PNG / 双面 PDF（计算样式内联 → canvas）+ vCard
js/image-in.js      贴图进档案（二维码）：压 480px 存 PNG data URL
js/flow.js          产品版交互
server.py           静态服务 + /api/design 代理（多家上游回落、按积分计费）+ 账号 / 档案 / 积分（SQLite）
check-spec.mjs      两份契约守卫 + 档案 / vCard / PDF（node check-spec.mjs）
```

## 样式架构：一切都从设计规格来

名片的视觉**没有任何一处写死在 CSS 里**。`css/styles.css` 只有一套三分区骨架（上排 / 主体 / 底栏）和一堆 CSS 变量；配色、字体、字号、字距、留白、纸纹、装饰层全部由一份设计规格（spec）注入。

规格的两个来源共用同一份 schema、同一个清洗器、同一条渲染路径：

- **内置预设**——`style-spec.js` 里六个立场的规则实现，无 key 时的兜底。
- **大模型**——`llm.js#requestStyles` 用工具调用让模型按 schema 吐三份规格，用户点选采纳。

要加一种新的纸面手法，改 `sanitizeDecor()` 和对应的 `*Layer()` 函数，再把枚举同步进 `llm.js` 的 `SPEC_SCHEMA`；**不要**回去给某个风格写专属 CSS 类。

**色谱「雪松林」只锁 Web 界面**：`css/styles.css` 的 `:root`（纸白偏冷绿、强调墨绿）。名片不受此限——内置预设每套一个独立色相，大模型出三版时必须换色相；用户可在第二步挑一个色系模板收窄，不选则完全放开。不要把雪松绿写进设计稿的 `tone`，也不要写进视觉那一段的系统提示词当铁律。

`sanitizeSpec()` 是视觉防线，必须保证任意畸形输入都产出可印制的规格：数值夹回区间、颜色做对比度兜底、侧边装饰与正文的留白冲突靠缩装饰而不是缩正文（见 `fitSides()`）。

`sanitizeBrief()` 是文案防线：联系方式只能是用户真填过的字段、组织该藏的时候藏住、卡面不许出现请愿句（中英都防）、年龄/年限不许漏到卡上。omitted 写了英文名就把 `showNameEn` 关掉；`backMode=en` 没有英文名时回落相遇故事。二维码是构图的一部分：面别/角位/装裱全由规格定（正面只许左下右下，背面四角皆可），用户没贴图就不渲染。

## 设计约束

- 对外文案 ≠ 私下策略。卡上不写「求职中」之类的请愿句。
- `stage=stealth`（在职悄悄看机会）默认隐藏现公司、避免工作邮箱。
- 个人资料与上传全部可空；没有名字时仍出策略，打印前提醒补姓名和联系方式。
- 年龄、从业年限、行业只喂设计师判断分寸，绝不上卡。
- 立场按钮只覆盖内置预设的视觉；采纳了模型方案后，文案仍由设计稿决定。
- 生图 API 不进本阶段。提示词按当前规格的色值、字号、装饰和必须上卡的文字拼出来。
- 90×54mm 是铁律。任何新的规格字段都要能被夹进可印制区间。

## 约定

目录/文件名英文 kebab-case，界面与说明用中文。密钥只走 `.env`（已 gitignore），由 `server.py` 读取，绝不进浏览器、不进仓库。

<!-- BEGIN auto-commit-hook convention -->
## 提交规范（auto-commit-hook）

> 由 `auto-commit-hook` 注入；模板在 `~/shaw/agents/hooks/auto-commit-hook/rules/`，改这里不会同步回模板。

- **按批按主题主动提交**：完成一组有意义的修改（一个功能、一类修复、一次重构、一组文档更新）后，主动 commit——用 conventional 前缀（`feat:` / `fix:` / `chore:` / `refactor:` / `docs:` / `style:`）开头，简述本次改动主题；多个要点用「- 」列表补充「新增/修改/删除」了什么。无关改动拆成多个 commit；同一主题的关联改动不要人为拆散。
- **auto-commit hook 只是兜底**：Claude Code 的 `SessionEnd` hook 在**会话退出时**若工作区仍有未提交改动，会调用 `scripts/session-commit.sh` 用通用 `chore(auto)` 兜底提交一次、不 push——它是安全网而非常规提交手段，message 看不出主题，别依赖它。hook 首次加载或内容变化后需在客户端审查并信任。
- **改一批再结束任务，不要改一点停一点**：正因为平时不自动提交，零碎结束会让多个主题堆在一个未提交状态、最后只能被兜底成一个通用 commit——每完成一个主题就主动提交，保持历史清晰。
<!-- END auto-commit-hook convention -->
