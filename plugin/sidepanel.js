(function () {
  const state = {
    activeTabId: null,
    article: null,
    folders: [],
    articleFavorite: null,
    favorites: [],
    searchResults: [],
    annotations: [],
    selectedListFolderId: "",
    messages: []
  };

  const $ = (selector) => document.querySelector(selector);

  function sendRuntime(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response?.ok) {
          reject(new Error(response?.error || "插件请求失败"));
          return;
        }
        resolve(response.payload);
      });
    });
  }

  function sendTab(message) {
    return new Promise((resolve, reject) => {
      if (!state.activeTabId) {
        reject(new Error("请先切换到财新文章页。"));
        return;
      }
      chrome.tabs.sendMessage(state.activeTabId, message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error("当前标签页无法读取文章，请切换到财新文章页后刷新侧栏。"));
          return;
        }
        if (!response?.ok) {
          reject(new Error(response?.error || "页面请求失败"));
          return;
        }
        resolve(response.payload);
      });
    });
  }

  function setStatus(text, tone = "muted") {
    const element = $("[data-ecx-status]");
    element.textContent = text;
    element.dataset.tone = tone;
  }

  function escapeHTML(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatJson(value) {
    return JSON.stringify(value, null, 2);
  }

  function formatDate(value) {
    if (!value) {
      return "";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }
    return date.toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function requireArticle() {
    if (!state.article?.caixin_id) {
      throw new Error("请先切换到财新文章页并刷新侧栏。");
    }
    return state.article;
  }

  function favoriteFolderNames(folders) {
    return (folders || []).map((folder) => folder.name).filter(Boolean).join("、");
  }

  function selectedFavoriteFolderIds() {
    return Array.from(document.querySelectorAll("[data-ecx-favorite-folder]:checked"))
      .map((input) => Number(input.value))
      .filter((id) => Number.isFinite(id) && id > 0);
  }

  async function activeTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
  }

  async function loadCurrentArticle() {
    const tab = await activeTab();
    state.activeTabId = tab?.id || null;
    state.article = null;

    try {
      state.article = await sendTab({ type: "GET_CURRENT_ARTICLE" });
      renderArticle();
      setStatus("已读取当前文章。", "success");
      await Promise.allSettled([
        loadArticleFavorite(false),
        loadAnnotations(false)
      ]);
      return state.article;
    } catch (error) {
      renderArticle(error.message || String(error));
      setStatus(error.message || String(error), "error");
      return null;
    }
  }

  function renderArticle(message = "") {
    const article = state.article || {};
    $("[data-ecx-article-title]").textContent = message || article.title || "请切换到财新文章页后刷新侧栏。";
    $("[data-ecx-current-title]").textContent = article.title || "-";
    $("[data-ecx-current-author]").textContent = article.author || "-";
    $("[data-ecx-current-time]").textContent = formatDate(article.publish_time) || "-";
    $("[data-ecx-current-id]").textContent = article.caixin_id || "-";
  }

  async function saveArticle() {
    const article = requireArticle();
    if (!article.title || !article.content) {
      throw new Error("未能识别当前页面的文章标题或正文。");
    }
    setStatus("正在保存当前文章...", "muted");
    const response = await sendRuntime({ type: "SAVE_ARTICLE", article });
    setStatus(response?.message || "文章已提交保存接口。", "success");
    return response;
  }

  function renderFavoriteFolderOptions() {
    const list = $("[data-ecx-favorite-folder-list]");
    if (state.folders.length === 0) {
      list.innerHTML = '<div class="ecx-empty">暂无收藏夹。</div>';
      return;
    }
    const selected = new Set((state.articleFavorite?.folders || []).map((folder) => Number(folder.id)));
    list.innerHTML = state.folders.map((folder) => `
      <label class="ecx-favorite-folder-option">
        <input type="checkbox" data-ecx-favorite-folder value="${folder.id}" ${selected.has(Number(folder.id)) ? "checked" : ""}>
        <span>${escapeHTML(folder.name)}</span>
      </label>
    `).join("");
  }

  function renderFavoriteFilter() {
    const select = $("[data-ecx-favorite-list-folder]");
    select.innerHTML = [
      '<option value="">全部收藏夹</option>',
      ...state.folders.map((folder) => `<option value="${folder.id}">${escapeHTML(folder.name)}</option>`)
    ].join("");
    select.value = state.selectedListFolderId;
  }

  function renderFavoriteList(message = "") {
    const list = $("[data-ecx-favorite-list]");
    if (message) {
      list.innerHTML = `<div class="ecx-empty">${escapeHTML(message)}</div>`;
      return;
    }
    if (state.favorites.length === 0) {
      list.innerHTML = '<div class="ecx-empty">暂无收藏文章。</div>';
      return;
    }
    list.innerHTML = state.favorites.map((favorite) => {
      const article = favorite.article || {};
      const folderNames = favoriteFolderNames(favorite.folders);
      const meta = [
        article.catagory,
        formatDate(article.publish_time),
        folderNames ? `收藏夹：${folderNames}` : ""
      ].filter(Boolean).map(escapeHTML).join(" · ");
      return `
        <article class="ecx-favorite-item">
          <a class="ecx-favorite-title" href="${escapeHTML(article.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(article.title || article.url || "未命名文章")}</a>
          ${meta ? `<div class="ecx-favorite-meta">${meta}</div>` : ""}
        </article>
      `;
    }).join("");
  }

  function renderSearchResults(message = "") {
    const list = $("[data-ecx-search-list]");
    if (message) {
      list.innerHTML = `<div class="ecx-empty">${escapeHTML(message)}</div>`;
      return;
    }
    if (state.searchResults.length === 0) {
      list.innerHTML = '<div class="ecx-empty">暂无搜索结果。</div>';
      return;
    }
    list.innerHTML = state.searchResults.map((result) => {
      const article = result.article || {};
      const meta = [
        article.catagory,
        article.author,
        formatDate(article.publish_time)
      ].filter(Boolean).map(escapeHTML).join(" · ");
      return `
        <article class="ecx-search-item">
          <a class="ecx-search-title" href="${escapeHTML(article.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(article.title || article.url || "未命名文章")}</a>
          ${meta ? `<div class="ecx-search-meta">${meta}</div>` : ""}
          ${result.snippet ? `<div class="ecx-search-snippet">${escapeHTML(result.snippet)}</div>` : ""}
        </article>
      `;
    }).join("");
  }

  async function searchArticles() {
    const input = $("[data-ecx-search-input]");
    const query = input.value.trim();
    if (!query) {
      throw new Error("请输入搜索关键词。");
    }
    renderSearchResults("正在搜索文章...");
    setStatus("正在搜索文章...", "muted");
    try {
      const response = await sendRuntime({
        type: "SEARCH_ARTICLES",
        options: { query, limit: 50, offset: 0 }
      });
      state.searchResults = response.results || [];
      renderSearchResults();
      setStatus(`找到 ${state.searchResults.length} 篇相关文章。`, "success");
    } catch (error) {
      state.searchResults = [];
      renderSearchResults(error.message || String(error));
      setStatus(error.message || String(error), "error");
    }
  }

  async function loadFavoriteFolders() {
    const response = await sendRuntime({ type: "LIST_FAVORITE_FOLDERS" });
    state.folders = response.folders || [];
    renderFavoriteFolderOptions();
    renderFavoriteFilter();
  }

  async function loadArticleFavorite(showStatus = true) {
    const article = requireArticle();
    if (showStatus) {
      setStatus("正在加载收藏状态...", "muted");
    }
    try {
      const response = await sendRuntime({
        type: "GET_ARTICLE_FAVORITE",
        caixinID: article.caixin_id
      });
      state.articleFavorite = response.favorite || { favorited: false, folders: [] };
      renderFavoriteFolderOptions();
      if (showStatus) {
        setStatus(state.articleFavorite.favorited ? "文章已收藏。" : "当前文章未收藏。", "success");
      }
    } catch (error) {
      state.articleFavorite = { favorited: false, folders: [] };
      renderFavoriteFolderOptions();
      if (showStatus) {
        setStatus(error.message || String(error), "error");
      }
    }
  }

  async function loadFavoriteList() {
    renderFavoriteList("正在加载收藏列表...");
    const folderID = Number(state.selectedListFolderId || 0);
    try {
      const response = await sendRuntime({
        type: "LIST_FAVORITES",
        options: { folderID, limit: 50, offset: 0 }
      });
      state.favorites = response.favorites || [];
      renderFavoriteList();
    } catch (error) {
      renderFavoriteList(error.message || String(error));
    }
  }

  async function loadFavoritesPanel() {
    setStatus("正在加载收藏信息...", "muted");
    await loadFavoriteFolders();
    if (state.article?.caixin_id) {
      await loadArticleFavorite(false);
    }
    await loadFavoriteList();
    setStatus("收藏信息已加载。", "success");
  }

  async function saveFavoriteSelection() {
    const article = requireArticle();
    setStatus("正在保存文章并更新收藏...", "muted");
    await saveArticle();
    const response = await sendRuntime({
      type: "SAVE_ARTICLE_FAVORITE",
      caixinID: article.caixin_id,
      folderIDs: selectedFavoriteFolderIds()
    });
    state.articleFavorite = response.favorite || { favorited: false, folders: [] };
    renderFavoriteFolderOptions();
    await loadFavoriteList();
    setStatus("收藏已更新。", "success");
  }

  async function deleteArticleFavorite() {
    const article = requireArticle();
    setStatus("正在删除文章...", "muted");
    await sendRuntime({
      type: "DELETE_ARTICLE_FAVORITE",
      caixinID: article.caixin_id
    });
    state.articleFavorite = { favorited: false, folders: [] };
    renderFavoriteFolderOptions();
    await loadFavoriteList();
    setStatus("文章已从数据库删除。", "success");
  }

  async function createFavoriteFolder() {
    const input = $("[data-ecx-new-favorite-folder]");
    const name = input.value.trim();
    if (!name) {
      throw new Error("请输入收藏夹名称。");
    }
    setStatus("正在创建收藏夹...", "muted");
    const response = await sendRuntime({ type: "CREATE_FAVORITE_FOLDER", name });
    input.value = "";
    state.folders.push(response.folder);
    renderFavoriteFolderOptions();
    renderFavoriteFilter();
    const checkbox = document.querySelector(`[data-ecx-favorite-folder][value="${response.folder.id}"]`);
    if (checkbox) {
      checkbox.checked = true;
    }
    setStatus("收藏夹已创建。", "success");
  }

  function renderAnnotations(message = "") {
    const list = $("[data-ecx-annotation-list]");
    if (message) {
      list.innerHTML = `<div class="ecx-empty">${escapeHTML(message)}</div>`;
      return;
    }
    if (state.annotations.length === 0) {
      list.innerHTML = '<div class="ecx-empty">暂无笔记或高亮。选中文章正文可在页面内创建。</div>';
      return;
    }
    list.innerHTML = state.annotations.map((annotation) => {
      const note = annotation.note_text ? `<div class="ecx-annotation-note">${escapeHTML(annotation.note_text)}</div>` : "";
      return `
        <article class="ecx-annotation-item" data-ecx-annotation-item="${annotation.id}">
          <div class="ecx-annotation-meta">${annotation.type === "note" ? "笔记" : "高亮"}</div>
          <div class="ecx-annotation-quote">${escapeHTML(annotation.selected_text)}</div>
          ${note}
          <div class="ecx-annotation-actions">
            <button type="button" data-ecx-scroll-annotation="${annotation.id}">定位</button>
            <button type="button" data-ecx-delete-annotation="${annotation.id}">删除</button>
          </div>
        </article>
      `;
    }).join("");
  }

  async function loadAnnotations(showStatus = true) {
    const article = requireArticle();
    if (showStatus) {
      setStatus("正在加载笔记与高亮...", "muted");
    }
    try {
      const response = await sendRuntime({
        type: "LIST_ANNOTATIONS",
        caixinID: article.caixin_id
      });
      state.annotations = response.annotations || [];
      renderAnnotations();
      if (showStatus) {
        setStatus("笔记与高亮已加载。", "success");
      }
    } catch (error) {
      renderAnnotations(error.message || String(error));
      if (showStatus) {
        setStatus(error.message || String(error), "error");
      }
    }
  }

  async function deleteAnnotation(id) {
    setStatus("正在删除笔记/高亮...", "muted");
    await sendRuntime({ type: "DELETE_ANNOTATION", id });
    state.annotations = state.annotations.filter((annotation) => String(annotation.id) !== String(id));
    renderAnnotations();
    await sendTab({ type: "REFRESH_ANNOTATIONS" }).catch(() => {});
    setStatus("笔记/高亮已删除。", "success");
  }

  async function scrollToAnnotation(id) {
    await sendTab({ type: "SCROLL_TO_ANNOTATION", id });
    setStatus("已定位到页面中的笔记/高亮。", "success");
  }

  function renderMessages() {
    const container = $("[data-ecx-chat-messages]");
    if (state.messages.length === 0) {
      container.innerHTML = '<div class="ecx-empty">使用当前文章作为上下文。请先在设置里填写 OpenAI-compatible API 地址和模型。</div>';
      return;
    }
    container.innerHTML = state.messages.map((message) => `
      <div class="ecx-chat-bubble ecx-chat-bubble-${message.role}">${escapeHTML(message.content)}</div>
    `).join("");
    container.scrollTop = container.scrollHeight;
  }

  async function submitQuestion(event) {
    event.preventDefault();
    const input = $("[data-ecx-chat-input]");
    const content = input.value.trim();
    if (!content) {
      return;
    }
    const article = requireArticle();
    input.value = "";
    state.messages.push({ role: "user", content });
    state.messages.push({ role: "assistant", content: "正在生成回答..." });
    renderMessages();
    try {
      const chatMessages = state.messages
        .filter((message) => message.content !== "正在生成回答...")
        .map((message) => ({ role: message.role, content: message.content }));
      const result = await sendRuntime({
        type: "CHAT_WITH_ARTICLE",
        messages: chatMessages,
        article
      });
      state.messages[state.messages.length - 1] = {
        role: "assistant",
        content: result.content
      };
      setStatus("回答已生成。", "success");
    } catch (error) {
      state.messages[state.messages.length - 1] = {
        role: "assistant",
        content: error.message || String(error)
      };
      setStatus(error.message || String(error), "error");
    }
    renderMessages();
  }

  async function loadSettings() {
    const settings = await sendRuntime({ type: "GET_SETTINGS" });
    const form = $("[data-ecx-settings-form]");
    form.articleSaveEndpoint.value = settings.articleSaveEndpoint || "";
    form.chatApiEndpoint.value = settings.chatApiEndpoint || "";
    form.chatApiKey.value = settings.chatApiKey || "";
    form.chatModel.value = settings.chatModel || "";
    form.chatTemperature.value = settings.chatTemperature ?? "";
  }

  async function saveSettingsFromForm() {
    const form = $("[data-ecx-settings-form]");
    await sendRuntime({
      type: "SAVE_SETTINGS",
      settings: {
        articleSaveEndpoint: form.articleSaveEndpoint.value.trim(),
        chatApiEndpoint: form.chatApiEndpoint.value.trim(),
        chatApiKey: form.chatApiKey.value.trim(),
        chatModel: form.chatModel.value.trim(),
        chatTemperature: Number(form.chatTemperature.value) || 0.3
      }
    });
    setStatus("设置已保存。", "success");
  }

  async function buildSaveDebugRequest() {
    const output = $("[data-ecx-save-debug-response]");
    output.textContent = "正在生成保存文章请求...";
    await saveSettingsFromForm();
    try {
      const article = requireArticle();
      const request = await sendRuntime({
        type: "BUILD_SAVE_ARTICLE_REQUEST",
        article
      });
      $("[data-ecx-save-debug-request]").value = formatJson(request);
      output.textContent = "保存文章请求已生成，可修改 endpoint、headers 或 body 后发送。";
    } catch (error) {
      output.textContent = error.message || String(error);
    }
  }

  async function sendSaveDebugRequest() {
    const output = $("[data-ecx-save-debug-response]");
    output.textContent = "正在发送保存文章调试请求...";
    try {
      const requestText = $("[data-ecx-save-debug-request]").value.trim();
      const request = requestText ? JSON.parse(requestText) : {};
      const response = await sendRuntime({
        type: "DEBUG_SAVE_ARTICLE_REQUEST",
        request
      });
      output.textContent = formatJson(response);
      setStatus(response.ok ? "保存文章接口调试请求成功。" : `保存文章接口返回 HTTP ${response.status}。`, response.ok ? "success" : "error");
    } catch (error) {
      output.textContent = error.message || String(error);
      setStatus(error.message || String(error), "error");
    }
  }

  async function buildDebugRequest() {
    const output = $("[data-ecx-debug-response]");
    output.textContent = "正在生成请求...";
    await saveSettingsFromForm();
    try {
      const article = requireArticle();
      const question = $("[data-ecx-debug-question]").value.trim() || "请用三句话概括这篇文章。";
      const request = await sendRuntime({
        type: "BUILD_CHAT_REQUEST",
        article,
        messages: [{ role: "user", content: question }]
      });
      $("[data-ecx-debug-config]").textContent = [
        `Base URL: ${request.endpoint}`,
        `Model: ${request.body?.model || ""}`,
        `API Key: ${request.headers?.Authorization ? "已配置" : "未配置"}`
      ].join("\n");
      $("[data-ecx-debug-body]").value = formatJson(request.body);
      output.textContent = "请求体已生成，可直接修改请求体后发送。";
    } catch (error) {
      output.textContent = error.message || String(error);
    }
  }

  async function sendDebugRequest() {
    const output = $("[data-ecx-debug-response]");
    output.textContent = "正在发送调试请求...";
    try {
      const bodyText = $("[data-ecx-debug-body]").value.trim();
      const body = bodyText ? JSON.parse(bodyText) : {};
      const response = await sendRuntime({
        type: "DEBUG_CHAT_REQUEST",
        body
      });
      output.textContent = formatJson(response);
      setStatus(response.ok ? "大模型接口调试请求成功。" : `大模型接口返回 HTTP ${response.status}。`, response.ok ? "success" : "error");
    } catch (error) {
      output.textContent = error.message || String(error);
      setStatus(error.message || String(error), "error");
    }
  }

  function selectTab(name) {
    document.querySelectorAll("[data-ecx-tab]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.ecxTab === name));
    });
    document.querySelectorAll("[data-ecx-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.ecxPanel !== name;
    });

    if (name === "favorites") {
      loadFavoritesPanel().catch((error) => setStatus(error.message || String(error), "error"));
    }
    if (name === "annotations") {
      loadAnnotations(true).catch((error) => setStatus(error.message || String(error), "error"));
    }
    if (name === "settings") {
      loadSettings().catch((error) => setStatus(error.message || String(error), "error"));
    }
  }

  function bindEvents() {
    document.querySelectorAll("[data-ecx-tab]").forEach((button) => {
      button.addEventListener("click", () => selectTab(button.dataset.ecxTab));
    });
    $("[data-ecx-refresh]").addEventListener("click", () => loadCurrentArticle());
    $("[data-ecx-save]").addEventListener("click", () => saveArticle().catch((error) => setStatus(error.message || String(error), "error")));
    $("[data-ecx-search-form]").addEventListener("submit", (event) => {
      event.preventDefault();
      searchArticles().catch((error) => setStatus(error.message || String(error), "error"));
    });
    $("[data-ecx-refresh-favorites]").addEventListener("click", () => loadFavoritesPanel().catch((error) => setStatus(error.message || String(error), "error")));
    $("[data-ecx-save-favorite]").addEventListener("click", () => saveFavoriteSelection().catch((error) => setStatus(error.message || String(error), "error")));
    $("[data-ecx-delete-favorite]").addEventListener("click", () => deleteArticleFavorite().catch((error) => setStatus(error.message || String(error), "error")));
    $("[data-ecx-create-favorite-folder]").addEventListener("click", () => createFavoriteFolder().catch((error) => setStatus(error.message || String(error), "error")));
    $("[data-ecx-new-favorite-folder]").addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        createFavoriteFolder().catch((error) => setStatus(error.message || String(error), "error"));
      }
    });
    $("[data-ecx-favorite-list-folder]").addEventListener("change", (event) => {
      state.selectedListFolderId = event.currentTarget.value;
      loadFavoriteList();
    });
    $("[data-ecx-refresh-annotations]").addEventListener("click", () => loadAnnotations(true).catch((error) => setStatus(error.message || String(error), "error")));
    $("[data-ecx-annotation-list]").addEventListener("click", (event) => {
      const deleteButton = event.target.closest("[data-ecx-delete-annotation]");
      const scrollButton = event.target.closest("[data-ecx-scroll-annotation]");
      if (deleteButton) {
        deleteAnnotation(deleteButton.dataset.ecxDeleteAnnotation).catch((error) => setStatus(error.message || String(error), "error"));
      }
      if (scrollButton) {
        scrollToAnnotation(scrollButton.dataset.ecxScrollAnnotation).catch((error) => setStatus(error.message || String(error), "error"));
      }
    });
    $("[data-ecx-chat-form]").addEventListener("submit", (event) => {
      submitQuestion(event).catch((error) => setStatus(error.message || String(error), "error"));
    });
    $("[data-ecx-settings-form]").addEventListener("submit", (event) => {
      event.preventDefault();
      saveSettingsFromForm().catch((error) => setStatus(error.message || String(error), "error"));
    });
    $("[data-ecx-build-save-debug-request]").addEventListener("click", () => buildSaveDebugRequest());
    $("[data-ecx-send-save-debug-request]").addEventListener("click", () => sendSaveDebugRequest());
    $("[data-ecx-build-debug-request]").addEventListener("click", () => buildDebugRequest());
    $("[data-ecx-send-debug-request]").addEventListener("click", () => sendDebugRequest());
  }

  bindEvents();
  renderMessages();
  renderSearchResults("输入关键词搜索已保存的文章。");
  renderFavoriteList("尚未加载收藏列表。");
  renderAnnotations("尚未加载笔记与高亮。");
  loadCurrentArticle();
})();
