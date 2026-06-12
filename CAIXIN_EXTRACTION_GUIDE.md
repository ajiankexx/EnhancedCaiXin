# 财新网站信息提取说明

本文档说明如何在浏览器插件中从财新网站页面提取文章信息，并将提取结果交给后续保存或分析流程。当前实现参考了财新文章提取插件的基本思路：在财新文章页注入内容脚本，读取页面 DOM 和 meta 信息，整理成结构化文章对象。

## 适用范围

当前插件只会在以下页面注入脚本：

```text
https://*.caixin.com/*
```

注入配置位于 `plugin/manifest.json`。插件在 `document_idle` 阶段执行，此时页面主体内容通常已经加载完成，适合读取标题、正文、作者和发布时间等信息。

## 核心文件

- `plugin/shared/articleExtractor.js`：文章信息提取逻辑。
- `plugin/save-to-mysql/saveArticle.js`：调用提取器，并把结果发送给后台脚本。
- `plugin/background.js`：读取插件配置，把文章 JSON POST 到保存接口。
- `plugin/content.js`：在财新页面创建控制面板，提供“保存当前文章到 MySQL”按钮。

## 提取流程

1. 用户打开财新文章页面。
2. Chrome 根据 `manifest.json` 注入内容脚本。
3. `articleExtractor.js` 在页面中注册 `window.EnhancedCaiXinArticleExtractor`。
4. 用户点击“保存当前文章到 MySQL”。
5. `saveArticle.js` 调用 `extractCurrentArticle()` 获取当前文章数据。
6. `saveArticle.js` 通过 `chrome.runtime.sendMessage` 把文章对象发送给后台脚本。
7. `background.js` 将文章对象 POST 到 `articleSaveEndpoint`。

默认保存接口为：

```text
http://127.0.0.1:1234/api/articles
```

该地址可以在插件页面中的“接口设置”里修改。

## 提取字段

`extractCurrentArticle()` 返回的文章对象结构如下：

```json
{
  "caixin_id": "文章 ID 或 URL 派生值",
  "url": "当前页面 URL",
  "title": "文章标题",
  "author": "作者或来源",
  "catagory": "栏目或分类",
  "publish_time": "发布时间",
  "content": "正文内容",
  "summary": "摘要"
}
```

说明：

- `catagory` 是当前数据库迁移中的字段拼写，代码保持了这个命名。
- `content` 对应数据库中的文章正文字段；`add_time` 由后端在写入数据库时生成。
- `reserved_3` 到 `reserved_5` 保留为空，不再写入提取内容。
- `publish_time` 能被 `Date` 解析时会转换为 ISO 字符串，否则保留原始文本。

## 标题提取

标题按以下顺序尝试：

1. 页面中的 `h1`
2. `.article-title`
3. `.title h1`
4. `.title`
5. `meta[property='og:title']`
6. `meta[name='og:title']`、`meta[name='twitter:title']`
7. `document.title` 去掉 `_财新网` 后缀

只要某个选择器能取得非空文本，就使用该值。

## 正文提取

正文优先从文章主体容器中提取。当前候选选择器为：

```text
#Main_Content_Val
.article-content
.articleContent
.content
.text
article
```

提取策略：

1. 依次查找上述容器。
2. 如果容器内有 `p` 标签，则按段落提取文本，并用空行连接。
3. 如果没有段落，则读取整个容器的 `textContent`。
4. 只有正文长度超过 80 个字符时，才认为该容器有效。
5. 如果所有容器都无效，则回退到全页面 `p` 标签，保留长度超过 20 个字符的段落。
6. 如果正文第一段是财新 AI 总结声明，插件会在写入 `content` 前删除该声明段落。

这种策略能适配常见财新文章页，也能在页面结构变化时提供基础回退。

## 作者和来源提取

作者优先读取 meta：

```text
meta[name='author']
meta[property='author']
```

如果 meta 不存在，再尝试以下页面元素：

```text
.author
.source
.article-author
[class*='author']
```

如果仍然无法识别，字段值为 `null`。

## 分类提取

分类优先读取：

```text
meta[name='article:section']
meta[property='article:section']
```

如果 meta 不存在，再尝试：

```text
.crumb
.breadcrumb
.nav
[class*='channel']
```

分类区域在不同财新页面中可能差异较大，因此该字段允许为空。

## 发布时间提取

发布时间按以下顺序尝试：

1. meta 字段：`article:published_time`、`pubdate`、`publishdate`、`publish_time`
2. `time` 标签的 `datetime` 属性
3. `time` 标签文本
4. 页面正文中的日期正则匹配

支持的常见日期格式包括：

```text
2026-06-11 10:30
2026/06/11 10:30
2026年06月11日 10:30
```

提取器会把中文年月日和斜杠日期统一成短横线格式后尝试解析。

## 文章 ID 提取

`caixin_id` 从 URL 中提取。当前规则会匹配 URL 末尾或下划线后的 6 位以上数字，例如：

```text
https://www.caixin.com/2026-06-11/102000001.html
```

会提取为：

```text
102000001
```

如果 URL 中没有可识别的数字 ID，则使用去掉协议和查询参数后的 URL 前 128 个字符作为备用 ID。

## 文本清洗规则

所有主要字段都会经过 `normalizeText()` 清洗：

1. 把 `&nbsp;` 对应的 `\u00a0` 转为空格。
2. 合并连续空格和 tab。
3. 把三个及以上连续换行压缩成两个换行。
4. 去掉首尾空白。

正文段落之间保留空行，方便保存和后续大模型上下文使用。

## 保存接口要求

后台脚本会将文章对象作为 JSON 请求体发送到保存接口：

```http
POST /api/articles
Content-Type: application/json
```

接口应至少支持以下字段：

```text
caixin_id
url
title
author
catagory
publish_time
content
summary
```

当前 MySQL 表结构由 `sql/migrations/*.sql` 逐步迁移维护。其中 `caixin_id` 和 `url` 都有唯一索引，保存接口需要处理重复保存的情况，例如更新已有记录或返回明确错误。

## 调试方法

在财新文章页面打开浏览器 DevTools Console，可以直接执行：

```javascript
window.EnhancedCaiXinArticleExtractor.extractCurrentArticle()
```

如果返回对象中 `title` 或 `content` 为空，通常需要检查：

- 当前页面是否匹配 `https://*.caixin.com/*`。
- 文章正文是否由异步请求加载，脚本执行时内容是否已经出现。
- 财新页面 DOM 结构是否变化，现有选择器是否失效。
- 页面是否为列表页、专题页、音视频页，而不是普通文章页。

## 维护建议

- 财新页面结构变化时，优先补充 `ARTICLE_SELECTORS`、`TITLE_SELECTORS` 等选择器列表。
- 新增选择器时，把更精确的选择器放在前面，通用选择器放在后面。
- 不建议直接依赖页面中固定位置的子节点，例如 `div:nth-child(3)`，这类规则容易因页面改版失效。
- 如果后续要支持更多页面类型，可以先判断页面类型，再为不同类型维护独立提取策略。
- 保存字段变更时，需要同步更新提取器、后端接口、数据库迁移和 README。
