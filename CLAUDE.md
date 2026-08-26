# 商业身份（business-card）

本地 Web 工具：用高维商业思维设计「对外递出的身份」。名片是产物，形象策略是核心。

## 运行

```bash
python3 server.py
# http://127.0.0.1:8765
```

零依赖。`server.py` 只提供静态文件；逻辑全在浏览器里（`js/`）。

## 结构

```
index.html          问询 + 工作室预览
css/styles.css
js/data.js          对象 / 场合 / 目的 / 阶段 / 立场 词表
js/strategy.js      四维组合 → 对外文案、信息层级、私下策略
js/prompts.js       中英生图提示词
js/app.js           交互、localStorage、打印
server.py           本地静态服务
```

## 设计约束

- 对外文案 ≠ 私下策略。卡上不写「求职中」之类的请愿句。
- `stage=stealth`（在职悄悄看机会）默认隐藏现公司、避免工作邮箱。
- 个人资料与上传全部可空；没有名字时仍出策略，打印前提醒补姓名和联系方式。
- 生图 API 不进 MVP。提示词按立场、纸面、排版和必须上卡的文字拼出来。

## 约定

目录/文件名英文 kebab-case，界面与说明用中文。密钥不进仓库（本项目 MVP 无密钥）。
