# Enhanced CaiXin Plugin

这是一个 Manifest V3 Chrome 扩展。加载到浏览器后，在 `https://*.caixin.com/*` 页面右下角注入集中控制面板。

控制面板标题栏可以拖动，位置会保存到 `chrome.storage.sync`，刷新页面后仍会使用上次位置。

## 功能目录

- `save-to-mysql/`: 负责提取当前财新文章并提交到文章保存接口。
- `ai-chat-sidebar/`: 负责打开文章上下文大模型对话侧边栏。
- `shared/`: 页面文章提取和默认配置。

## 保存文章到 MySQL

浏览器扩展不能安全地直接连接 MySQL，也不应该在前端保存数据库账号密码。因此保存按钮会把文章发送到本机 HTTP API，由后端写入 MySQL。

默认接口：

```text
POST http://127.0.0.1:1234/api/articles
Content-Type: application/json
```

请求体字段：

```json
{
  "caixin_id": "102300000",
  "url": "https://www.caixin.com/...",
  "title": "文章标题",
  "author": "作者",
  "catagory": "栏目",
  "publish_time": "2026-06-11T08:00:00.000Z",
  "content": "文章正文",
  "summary": "摘要"
}
```

后端会把 `content` 写入数据库的 `articles.content` 字段，并在保存时生成 `articles.add_time`。

### 保存接口调试

“接口设置”里包含“文章保存接口调试”区域：

1. 确认上方“文章保存接口”是当前后端地址，例如 `http://127.0.0.1:1234/api/articles`。
2. 点击“生成保存请求”，插件会提取当前文章并生成完整请求 JSON，包含 `endpoint`、`method`、`headers` 和 `body`。
3. 可以直接修改请求 JSON，例如临时调整路径、Header 或字段内容。
4. 点击“发送保存请求”，下方会显示 HTTP 状态、响应头、响应体和耗时，便于排查 `Operation without privileges` 这类后端返回。

## 大模型对话

侧边栏调用 OpenAI-compatible Chat Completions API。需要在控制面板的“接口设置”里填写：

- 大模型 API 地址，例如 `https://api.example.com/v1/chat/completions`
- API Key，可选
- 模型名
- 温度

插件会把当前文章标题、链接、作者、发布时间和正文作为 system prompt 上下文，与用户消息一起发送给第三方模型接口。

### 接口调试

“接口设置”里包含“大模型接口调试”区域：

1. 填写 API 地址、API Key、模型名和温度。
2. 在调试区只输入测试问题。
3. 点击“生成请求体”，插件会读取上方已有配置，基于当前文章生成可编辑请求 body。
4. 可以直接编辑 body JSON。
5. 点击“发送调试请求”，插件会自动使用已保存的 API 地址、API Key 和模型配置发送请求，下方显示 HTTP 状态、响应头、响应体和耗时。
