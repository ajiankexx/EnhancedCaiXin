const DEFAULTS = {
  articleSaveEndpoint: "http://127.0.0.1:8080/api/articles",
  chatApiEndpoint: "",
  chatApiKey: "",
  chatModel: "gpt-4o-mini",
  chatTemperature: 0.3,
  panelLeft: null,
  panelTop: null
};

async function getSettings() {
  return chrome.storage.sync.get(DEFAULTS);
}

async function saveArticle(article) {
  const settings = await getSettings();
  const response = await fetch(settings.articleSaveEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(article)
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
