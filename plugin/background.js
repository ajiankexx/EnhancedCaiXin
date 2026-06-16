const DEFAULTS = {
  articleSaveEndpoint: "http://127.0.0.1:1234/api/articles",
  chatApiEndpoint: "",
  chatApiKey: "",
  chatModel: "gpt-4o-mini",
  chatTemperature: 0.3,
  panelLeft: null,
  panelTop: null
};

if (chrome.sidePanel?.setPanelBehavior) {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error(error));
}

async function getSettings() {
  return chrome.storage.sync.get(DEFAULTS);
}

async function saveArticle(article) {
  const settings = await getSettings();
  const request = buildSaveArticleRequest(settings, article);
  const response = await fetch(request.endpoint, {
    method: request.method,
    headers: request.headers,
    body: JSON.stringify(request.body)
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `保存失败：HTTP ${response.status}`);
  }

  try {
    return JSON.parse(text);
  } catch (_error) {
    return { ok: true, message: text || "保存成功" };
  }
}

function annotationEndpointBase(settings) {
  const endpoint = (settings.articleSaveEndpoint || DEFAULTS.articleSaveEndpoint || "").replace(/\/+$/, "");
  if (!endpoint) {
    throw new Error("请先在插件设置中填写文章保存接口。");
  }
  return endpoint.endsWith("/articles") ? endpoint.slice(0, -"/articles".length) : endpoint;
}

function apiEndpointBase(settings) {
  return annotationEndpointBase(settings);
}

async function listAnnotations(caixinID) {
  const settings = await getSettings();
  const endpoint = `${annotationEndpointBase(settings)}/articles/${encodeURIComponent(caixinID)}/annotations`;
  const response = await fetch(endpoint);
  const data = await parseJSONResponse(response);
  if (!response.ok) {
    throw new Error(data?.error || `加载笔记失败：HTTP ${response.status}`);
  }
  return data;
}

async function createAnnotation(caixinID, annotation) {
  const settings = await getSettings();
  const endpoint = `${annotationEndpointBase(settings)}/articles/${encodeURIComponent(caixinID)}/annotations`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(annotation || {})
  });
  const data = await parseJSONResponse(response);
  if (!response.ok) {
    throw new Error(data?.error || `创建笔记失败：HTTP ${response.status}`);
  }
  return data;
}

async function deleteAnnotation(id) {
  const settings = await getSettings();
  const endpoint = `${annotationEndpointBase(settings)}/annotations/${encodeURIComponent(id)}`;
  const response = await fetch(endpoint, { method: "DELETE" });
  const data = await parseJSONResponse(response);
  if (!response.ok) {
    throw new Error(data?.error || `删除笔记失败：HTTP ${response.status}`);
  }
  return data;
}

async function listFavoriteFolders() {
  const settings = await getSettings();
  const endpoint = `${apiEndpointBase(settings)}/favorite-folders`;
  const response = await fetch(endpoint);
  const data = await parseJSONResponse(response);
  if (!response.ok) {
    throw new Error(data?.error || `加载收藏夹失败：HTTP ${response.status}`);
  }
  return data;
}

async function createFavoriteFolder(name) {
  const settings = await getSettings();
  const endpoint = `${apiEndpointBase(settings)}/favorite-folders`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ name })
  });
  const data = await parseJSONResponse(response);
  if (!response.ok) {
    throw new Error(data?.error || `创建收藏夹失败：HTTP ${response.status}`);
  }
  return data;
}

async function getArticleFavorite(caixinID) {
  const settings = await getSettings();
  const endpoint = `${apiEndpointBase(settings)}/articles/${encodeURIComponent(caixinID)}/favorite`;
  const response = await fetch(endpoint);
  const data = await parseJSONResponse(response);
  if (!response.ok) {
    throw new Error(data?.error || `加载收藏状态失败：HTTP ${response.status}`);
  }
  return data;
}

async function saveArticleFavorite(caixinID, folderIDs) {
  const settings = await getSettings();
  const endpoint = `${apiEndpointBase(settings)}/articles/${encodeURIComponent(caixinID)}/favorite`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ folder_ids: folderIDs || [] })
  });
  const data = await parseJSONResponse(response);
  if (!response.ok) {
    throw new Error(data?.error || `保存收藏失败：HTTP ${response.status}`);
  }
  return data;
}

async function deleteArticleFavorite(caixinID) {
  const settings = await getSettings();
  const endpoint = `${apiEndpointBase(settings)}/articles/${encodeURIComponent(caixinID)}`;
  const response = await fetch(endpoint, { method: "DELETE" });
  const data = await parseJSONResponse(response);
  if (!response.ok) {
    throw new Error(data?.error || `删除文章失败：HTTP ${response.status}`);
  }
  return data;
}

async function listFavorites(options = {}) {
  const settings = await getSettings();
  const params = new URLSearchParams();
  if (options.folderID) {
    params.set("folder_id", String(options.folderID));
  }
  if (options.limit) {
    params.set("limit", String(options.limit));
  }
  if (options.offset) {
    params.set("offset", String(options.offset));
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const endpoint = `${apiEndpointBase(settings)}/favorites${suffix}`;
  const response = await fetch(endpoint);
  const data = await parseJSONResponse(response);
  if (!response.ok) {
    throw new Error(data?.error || `加载收藏列表失败：HTTP ${response.status}`);
  }
  return data;
}

async function searchArticles(options = {}) {
  const settings = await getSettings();
  const query = String(options.query || "").trim();
  if (!query) {
    throw new Error("请输入搜索关键词。");
  }

  const params = new URLSearchParams({ q: query });
  if (options.limit) {
    params.set("limit", String(options.limit));
  }
  if (options.offset) {
    params.set("offset", String(options.offset));
  }
  const endpoint = `${apiEndpointBase(settings)}/articles/search?${params.toString()}`;
  const response = await fetch(endpoint);
  const data = await parseJSONResponse(response);
  if (!response.ok) {
    throw new Error(data?.error || `搜索文章失败：HTTP ${response.status}`);
  }
  return data;
}

async function listWordNotes(options = {}) {
  const settings = await getSettings();
  const params = new URLSearchParams();
  const query = String(options.query || "").trim();
  if (query) {
    params.set("q", query);
  }
  if (options.limit) {
    params.set("limit", String(options.limit));
  }
  if (options.offset) {
    params.set("offset", String(options.offset));
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const endpoint = `${apiEndpointBase(settings)}/word-notes${suffix}`;
  const response = await fetch(endpoint);
  const data = await parseJSONResponse(response);
  if (!response.ok) {
    throw new Error(data?.error || `加载词语笔记失败：HTTP ${response.status}`);
  }
  return data;
}

async function saveWordNote(wordNote) {
  const settings = await getSettings();
  const endpoint = `${apiEndpointBase(settings)}/word-notes`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(wordNote || {})
  });
  const data = await parseJSONResponse(response);
  if (!response.ok) {
    throw new Error(data?.error || `保存词语笔记失败：HTTP ${response.status}`);
  }
  return data;
}

async function getWordNote(id) {
  const settings = await getSettings();
  const endpoint = `${apiEndpointBase(settings)}/word-notes/${encodeURIComponent(id)}`;
  const response = await fetch(endpoint);
  const data = await parseJSONResponse(response);
  if (!response.ok) {
    throw new Error(data?.error || `加载词语详情失败：HTTP ${response.status}`);
  }
  return data;
}

async function deleteWordNote(id) {
  const settings = await getSettings();
  const endpoint = `${apiEndpointBase(settings)}/word-notes/${encodeURIComponent(id)}`;
  const response = await fetch(endpoint, { method: "DELETE" });
  const data = await parseJSONResponse(response);
  if (!response.ok) {
    throw new Error(data?.error || `删除词语笔记失败：HTTP ${response.status}`);
  }
  return data;
}

async function saveArticleWordNote(caixinID, wordNote) {
  const settings = await getSettings();
  const endpoint = `${apiEndpointBase(settings)}/articles/${encodeURIComponent(caixinID)}/word-notes`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(wordNote || {})
  });
  const data = await parseJSONResponse(response);
  if (!response.ok) {
    throw new Error(data?.error || `保存词语来源失败：HTTP ${response.status}`);
  }
  return data;
}

async function listArticleWordNotes(caixinID) {
  const settings = await getSettings();
  const endpoint = `${apiEndpointBase(settings)}/articles/${encodeURIComponent(caixinID)}/word-notes`;
  const response = await fetch(endpoint);
  const data = await parseJSONResponse(response);
  if (!response.ok) {
    throw new Error(data?.error || `加载当前文章词语失败：HTTP ${response.status}`);
  }
  return data;
}

async function parseJSONResponse(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch (_error) {
    return { message: text };
  }
}

function buildSaveArticleRequest(settings, article) {
  if (!settings.articleSaveEndpoint) {
    throw new Error("请先在插件设置中填写文章保存接口。");
  }

  return {
    endpoint: settings.articleSaveEndpoint,
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: article || {}
  };
}

async function debugSaveArticleRequest(request) {
  const settings = await getSettings();
  const normalizedRequest = request && typeof request === "object"
    ? request
    : buildSaveArticleRequest(settings, {});
  const endpoint = normalizedRequest.endpoint || settings.articleSaveEndpoint;
  const method = normalizedRequest.method || "POST";
  const headers = normalizedRequest.headers && typeof normalizedRequest.headers === "object"
    ? normalizedRequest.headers
    : { "Content-Type": "application/json" };

  if (!endpoint) {
    throw new Error("请先在插件设置中填写文章保存接口。");
  }

  const startedAt = Date.now();
  const response = await fetch(endpoint, {
    method,
    headers,
    body: typeof normalizedRequest.body === "string"
      ? normalizedRequest.body
      : JSON.stringify(normalizedRequest.body || {})
  });
  const rawText = await response.text();
  let parsedBody = null;
  try {
    parsedBody = JSON.parse(rawText);
  } catch (_error) {
    parsedBody = rawText;
  }

  return {
    ok: response.ok,
    endpoint,
    method,
    status: response.status,
    statusText: response.statusText,
    elapsedMs: Date.now() - startedAt,
    headers: Object.fromEntries(response.headers.entries()),
    body: parsedBody,
    rawText
  };
}

function buildChatRequest(settings, messages, article) {
  if (!settings.chatApiEndpoint) {
    throw new Error("请先在插件设置中填写第三方大模型 API 地址。");
  }

  const systemPrompt = [
    "你是一个严谨的财新文章阅读助手。",
    "回答必须优先基于用户当前打开的文章上下文。",
    "如果文章中没有相关信息，请明确说明无法从当前文章判断。",
    "",
    `标题：${article.title || ""}`,
    `链接：${article.url || ""}`,
    `作者：${article.author || ""}`,
    `发布时间：${article.publish_time || ""}`,
    "",
    "文章正文：",
    String(article.content || "").slice(0, 24000)
  ].join("\n");

  return {
    endpoint: settings.chatApiEndpoint,
    headers: {
      "Content-Type": "application/json",
      ...(settings.chatApiKey ? { Authorization: `Bearer ${settings.chatApiKey}` } : {})
    },
    body: {
      model: settings.chatModel,
      temperature: Number(settings.chatTemperature) || 0.3,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages
      ]
    }
  };
}

async function sendChat(messages, article) {
  const settings = await getSettings();
  if (!settings.chatApiEndpoint) {
    throw new Error("请先在插件设置中填写第三方大模型 API 地址。");
  }

  const request = buildChatRequest(settings, messages, article);
  const response = await fetch(settings.chatApiEndpoint, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(request.body)
  });

  const rawText = await response.text();
  let data = null;
  try {
    data = JSON.parse(rawText);
  } catch (_error) {
    data = { message: rawText };
  }

  if (!response.ok) {
    const message = data?.error?.message || data?.error || data?.message || `聊天请求失败：HTTP ${response.status}`;
    throw new Error(message);
  }

  return {
    content: data?.choices?.[0]?.message?.content
      || data?.choices?.[0]?.text
      || data?.message
      || JSON.stringify(data)
  };
}

async function generateWordExplanation(wordName, article, context = {}) {
  const settings = await getSettings();
  if (!settings.chatApiEndpoint) {
    throw new Error("请先在插件设置中填写第三方大模型 API 地址。");
  }

  const selectedText = String(context.selectedText || wordName || "").trim();
  const prompt = [
    `请解释这个概念或词语：${wordName}`,
    "",
    "要求：",
    "1. 用中文回答，尽量结合当前财经新闻语境。",
    "2. 如果它是机构、政策、行业术语、金融概念或专有名词，请说明它在文中的含义。",
    "3. 不确定时明确说明不确定，不要编造。",
    "4. 控制在 120-240 字。",
    "",
    `选中文本：${selectedText}`,
    `前文：${String(context.prefixText || "").slice(-500)}`,
    `后文：${String(context.suffixText || "").slice(0, 500)}`
  ].join("\n");
  const request = buildChatRequest(settings, [{ role: "user", content: prompt }], article || {});
  const response = await fetch(settings.chatApiEndpoint, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(request.body)
  });
  const rawText = await response.text();
  let data = null;
  try {
    data = JSON.parse(rawText);
  } catch (_error) {
    data = { message: rawText };
  }
  if (!response.ok) {
    const message = data?.error?.message || data?.error || data?.message || `词语解释生成失败：HTTP ${response.status}`;
    throw new Error(message);
  }
  return {
    word_name: wordName,
    word_explanation: data?.choices?.[0]?.message?.content
      || data?.choices?.[0]?.text
      || data?.message
      || JSON.stringify(data)
  };
}

async function debugChatRequest(body) {
  const settings = await getSettings();
  if (!settings.chatApiEndpoint) {
    throw new Error("请先在插件设置中填写第三方大模型 API 地址。");
  }

  const headers = {
    "Content-Type": "application/json",
    ...(settings.chatApiKey ? { Authorization: `Bearer ${settings.chatApiKey}` } : {})
  };
  const startedAt = Date.now();
  const response = await fetch(settings.chatApiEndpoint, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
  const rawText = await response.text();
  let parsedBody = null;
  try {
    parsedBody = JSON.parse(rawText);
  } catch (_error) {
    parsedBody = rawText;
  }

  return {
    ok: response.ok,
    endpoint: settings.chatApiEndpoint,
    model: body?.model || settings.chatModel,
    status: response.status,
    statusText: response.statusText,
    elapsedMs: Date.now() - startedAt,
    headers: Object.fromEntries(response.headers.entries()),
    body: parsedBody,
    rawText
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message.type === "GET_SETTINGS") {
      return getSettings();
    }
    if (message.type === "SAVE_SETTINGS") {
      await chrome.storage.sync.set(message.settings || {});
      return getSettings();
    }
    if (message.type === "SAVE_ARTICLE") {
      return saveArticle(message.article);
    }
    if (message.type === "LIST_ANNOTATIONS") {
      return listAnnotations(message.caixinID);
    }
    if (message.type === "CREATE_ANNOTATION") {
      return createAnnotation(message.caixinID, message.annotation);
    }
    if (message.type === "DELETE_ANNOTATION") {
      return deleteAnnotation(message.id);
    }
    if (message.type === "LIST_FAVORITE_FOLDERS") {
      return listFavoriteFolders();
    }
    if (message.type === "CREATE_FAVORITE_FOLDER") {
      return createFavoriteFolder(message.name);
    }
    if (message.type === "GET_ARTICLE_FAVORITE") {
      return getArticleFavorite(message.caixinID);
    }
    if (message.type === "SAVE_ARTICLE_FAVORITE") {
      return saveArticleFavorite(message.caixinID, message.folderIDs);
    }
    if (message.type === "DELETE_ARTICLE_FAVORITE") {
      return deleteArticleFavorite(message.caixinID);
    }
    if (message.type === "LIST_FAVORITES") {
      return listFavorites(message.options || {});
    }
    if (message.type === "SEARCH_ARTICLES") {
      return searchArticles(message.options || {});
    }
    if (message.type === "LIST_WORD_NOTES") {
      return listWordNotes(message.options || {});
    }
    if (message.type === "SAVE_WORD_NOTE") {
      return saveWordNote(message.wordNote);
    }
    if (message.type === "GET_WORD_NOTE") {
      return getWordNote(message.id);
    }
    if (message.type === "DELETE_WORD_NOTE") {
      return deleteWordNote(message.id);
    }
    if (message.type === "SAVE_ARTICLE_WORD_NOTE") {
      return saveArticleWordNote(message.caixinID, message.wordNote);
    }
    if (message.type === "LIST_ARTICLE_WORD_NOTES") {
      return listArticleWordNotes(message.caixinID);
    }
    if (message.type === "GENERATE_WORD_EXPLANATION") {
      return generateWordExplanation(message.wordName, message.article || {}, message.context || {});
    }
    if (message.type === "BUILD_SAVE_ARTICLE_REQUEST") {
      const settings = await getSettings();
      return buildSaveArticleRequest(settings, message.article || {});
    }
    if (message.type === "DEBUG_SAVE_ARTICLE_REQUEST") {
      return debugSaveArticleRequest(message.request);
    }
    if (message.type === "CHAT_WITH_ARTICLE") {
      return sendChat(message.messages || [], message.article || {});
    }
    if (message.type === "BUILD_CHAT_REQUEST") {
      const settings = await getSettings();
      return buildChatRequest(settings, message.messages || [], message.article || {});
    }
    if (message.type === "DEBUG_CHAT_REQUEST") {
      return debugChatRequest(message.body);
    }
    throw new Error(`未知消息类型：${message.type}`);
  })()
    .then((payload) => sendResponse({ ok: true, payload }))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));

  return true;
});
