(function () {
  if (window.__enhancedCaiXinLoaded) {
    return;
  }
  window.__enhancedCaiXinLoaded = true;

  const annotationState = {
    article: null,
    annotations: [],
    locatedIds: new Set(),
    highlightNames: new Set(),
    toolbar: null
  };

  const favoriteState = {
    folders: [],
    articleFavorite: null,
    favorites: [],
    selectedListFolderId: ""
  };

  function sendMessage(message) {
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

  function setStatus(text, tone = "muted") {
    const element = document.querySelector("[data-ecx-status]");
    if (!element) {
      return;
    }
    element.textContent = text;
    element.dataset.tone = tone;
  }

  async function saveArticle() {
    setStatus("正在保存当前文章...", "muted");
    try {
      const result = await window.EnhancedCaiXinSaveArticle.saveCurrentArticle();
      setStatus(result?.message || "文章已提交保存接口。", "success");
    } catch (error) {
      setStatus(error.message || String(error), "error");
    }
  }

  function currentArticle() {
    if (!annotationState.article) {
      annotationState.article = window.EnhancedCaiXinArticleExtractor.extractCurrentArticle();
    }
    return annotationState.article;
  }

  function articleContainer() {
    return window.EnhancedCaiXinArticleExtractor.findArticleContainer();
  }

  function normalizeText(value) {
    return window.EnhancedCaiXinArticleExtractor.normalizeText(value);
  }

  function isIgnoredTextNode(node) {
    const parent = node.parentElement;
    return !parent || Boolean(parent.closest("#ecx-control-panel, #ecx-chat-sidebar, .ecx-selection-toolbar, script, style"));
  }

  function buildTextIndex(container) {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return isIgnoredTextNode(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    const chars = [];
    const positions = [];
    let pendingSpace = false;
    let node = walker.nextNode();

    while (node) {
      const text = node.nodeValue || "";
      for (let offset = 0; offset < text.length; offset += 1) {
        const char = text[offset];
        if (/\s/.test(char) || char === "\u00a0") {
          pendingSpace = chars.length > 0;
          continue;
        }
        if (pendingSpace) {
          chars.push(" ");
          positions.push({ node, offset });
          pendingSpace = false;
        }
        chars.push(char);
        positions.push({ node, offset });
      }
      node = walker.nextNode();
    }

    while (chars.length > 0 && chars[chars.length - 1] === " ") {
      chars.pop();
      positions.pop();
    }

    return {
      text: chars.join(""),
      positions
    };
  }

  function offsetToPoint(index, offset) {
    if (offset <= 0) {
      const first = index.positions[0];
      return first ? { node: first.node, offset: first.offset } : null;
    }
    const previous = index.positions[offset - 1];
    return previous ? { node: previous.node, offset: previous.offset + 1 } : null;
  }

  function rangeFromTextIndex(index, startOffset, endOffset) {
    if (startOffset < 0 || endOffset > index.positions.length || endOffset <= startOffset) {
      return null;
    }
    const start = offsetToPoint(index, startOffset);
    const end = offsetToPoint(index, endOffset);
    if (!start || !end) {
      return null;
    }
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return { range, text: index.text.slice(startOffset, endOffset), index };
  }

  function selectionOffsets(container, range) {
    const before = document.createRange();
    before.selectNodeContents(container);
    before.setEnd(range.startContainer, range.startOffset);
    const startOffset = normalizeText(before.toString()).length;
    const selectedText = normalizeText(range.toString());
    return {
      startOffset,
      endOffset: startOffset + selectedText.length,
      selectedText
    };
  }

  function findFallbackOffsets(annotation, index) {
    const selected = normalizeText(annotation.selected_text);
    const prefix = normalizeText(annotation.prefix_text || "");
    const suffix = normalizeText(annotation.suffix_text || "");
    if (!selected) {
      return null;
    }

    const combined = `${prefix}${selected}${suffix}`;
    if (prefix || suffix) {
      const combinedIndex = index.text.indexOf(combined);
      if (combinedIndex >= 0) {
        return {
          start: combinedIndex + prefix.length,
          end: combinedIndex + prefix.length + selected.length
        };
      }
    }

    const selectedIndex = index.text.indexOf(selected);
    if (selectedIndex >= 0) {
      return { start: selectedIndex, end: selectedIndex + selected.length };
    }
    return null;
  }

  function wrapRange(range, annotation) {
    const mark = document.createElement("mark");
    mark.className = "ecx-annotation-mark";
    mark.dataset.ecxAnnotationId = String(annotation.id);
    mark.dataset.ecxAnnotationType = annotation.type;
    mark.title = annotation.note_text || "财新高亮";
    mark.appendChild(range.extractContents());
    range.insertNode(mark);
  }

  function supportsCustomHighlights() {
    return typeof Highlight !== "undefined" && Boolean(window.CSS?.highlights);
  }

  function annotationHighlightName(annotation) {
    return `ecx-annotation-${String(annotation.id).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  }

  function escapeCSSIdentifier(value) {
    if (window.CSS?.escape) {
      return window.CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function annotationHighlightStyleElement() {
    let style = document.querySelector("style[data-ecx-annotation-highlights]");
    if (!style) {
      style = document.createElement("style");
      style.dataset.ecxAnnotationHighlights = "true";
      document.head.appendChild(style);
    }
    return style;
  }

  function setRenderedAnnotationHighlight(annotation, range, styleRules) {
    const name = annotationHighlightName(annotation);
    const highlight = new Highlight(range);
    highlight.priority = annotation.type === "note" ? 2 : 1;
    window.CSS.highlights.set(name, highlight);
    annotationState.highlightNames.add(name);

    const selectorName = escapeCSSIdentifier(name);
    if (annotation.type === "note") {
      styleRules.push(`::highlight(${selectorName}) { background-color: rgba(255, 224, 138, 0.72); text-decoration: underline; text-decoration-color: #d97706; text-decoration-thickness: 2px; }`);
    } else {
      styleRules.push(`::highlight(${selectorName}) { background-color: rgba(255, 243, 163, 0.72); }`);
    }
  }

  function clearRenderedAnnotations() {
    if (supportsCustomHighlights()) {
      annotationState.highlightNames.forEach((name) => window.CSS.highlights.delete(name));
      annotationState.highlightNames = new Set();
    }
    const style = document.querySelector("style[data-ecx-annotation-highlights]");
    if (style) {
      style.textContent = "";
    }
    document.querySelectorAll("mark.ecx-annotation-mark[data-ecx-annotation-id]").forEach((mark) => {
      const parent = mark.parentNode;
      while (mark.firstChild) {
        parent.insertBefore(mark.firstChild, mark);
      }
      parent.removeChild(mark);
      parent.normalize();
    });
    annotationState.locatedIds = new Set();
  }

  function renderAnnotations() {
    const container = articleContainer();
    clearRenderedAnnotations();
    if (!container) {
      renderAnnotationList("未能识别正文，无法渲染高亮。");
      return;
    }

    const customHighlights = supportsCustomHighlights();
    const styleRules = [];
    const annotations = [...annotationState.annotations].sort((a, b) => b.start_offset - a.start_offset);
    const index = customHighlights ? buildTextIndex(container) : null;
    for (const annotation of annotations) {
      let currentIndex = index || buildTextIndex(container);
      let located = rangeFromTextIndex(currentIndex, annotation.start_offset, annotation.end_offset);
      const expected = normalizeText(annotation.selected_text);
      if (!located || normalizeText(located.text) !== expected) {
        const fallback = findFallbackOffsets(annotation, currentIndex);
        located = fallback ? rangeFromTextIndex(currentIndex, fallback.start, fallback.end) : null;
      }
      if (!located) {
        continue;
      }
      if (customHighlights) {
        setRenderedAnnotationHighlight(annotation, located.range, styleRules);
      } else {
        wrapRange(located.range, annotation);
      }
      annotationState.locatedIds.add(Number(annotation.id));
    }
    if (customHighlights) {
      annotationHighlightStyleElement().textContent = styleRules.join("\n");
    }
    renderAnnotationList();
  }

  function renderAnnotationList(message = "") {
    const list = document.querySelector("[data-ecx-annotation-list]");
    if (!list) {
      return;
    }
    if (message) {
      list.innerHTML = `<div class="ecx-annotation-empty">${message}</div>`;
      return;
    }
    if (annotationState.annotations.length === 0) {
      list.innerHTML = '<div class="ecx-annotation-empty">暂无笔记或高亮。</div>';
      return;
    }
    list.innerHTML = annotationState.annotations.map((annotation) => {
      const located = annotationState.locatedIds.has(Number(annotation.id));
      const note = annotation.note_text ? `<div class="ecx-annotation-note">${escapeHTML(annotation.note_text)}</div>` : "";
      const missing = located ? "" : '<div class="ecx-annotation-missing">未能定位到页面文本</div>';
      return `
        <article class="ecx-annotation-item" data-ecx-annotation-item="${annotation.id}">
          <div class="ecx-annotation-meta">${annotation.type === "note" ? "笔记" : "高亮"}</div>
          <div class="ecx-annotation-quote">${escapeHTML(annotation.selected_text)}</div>
          ${note}
          ${missing}
          <button type="button" data-ecx-delete-annotation="${annotation.id}">删除</button>
        </article>
      `;
    }).join("");
  }

  function escapeHTML(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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

  function selectedFavoriteFolderIds(panel) {
    return Array.from(panel.querySelectorAll("[data-ecx-favorite-folder]:checked"))
      .map((input) => Number(input.value))
      .filter((id) => Number.isFinite(id) && id > 0);
  }

  function favoriteFolderNames(folders) {
    return (folders || []).map((folder) => folder.name).filter(Boolean).join("、");
  }

  function updateFavoriteButton(panel) {
    const button = panel.querySelector("[data-ecx-toggle-favorites]");
    if (!button) {
      return;
    }
    const favorited = Boolean(favoriteState.articleFavorite?.favorited);
    const names = favoriteFolderNames(favoriteState.articleFavorite?.folders);
    button.textContent = favorited ? "已收藏" : "收藏";
    button.title = favorited && names ? `已收藏到：${names}` : "";
  }

  function renderFavoriteFolderOptions(panel) {
    const list = panel.querySelector("[data-ecx-favorite-folder-list]");
    if (!list) {
      return;
    }
    if (favoriteState.folders.length === 0) {
      list.innerHTML = '<div class="ecx-favorite-empty">暂无收藏夹。</div>';
      return;
    }

    const selected = new Set((favoriteState.articleFavorite?.folders || []).map((folder) => Number(folder.id)));
    list.innerHTML = favoriteState.folders.map((folder) => `
      <label class="ecx-favorite-folder-option">
        <input type="checkbox" data-ecx-favorite-folder value="${folder.id}" ${selected.has(Number(folder.id)) ? "checked" : ""}>
        <span>${escapeHTML(folder.name)}</span>
      </label>
    `).join("");
  }

  function renderFavoriteFilter(panel) {
    const select = panel.querySelector("[data-ecx-favorite-list-folder]");
    if (!select) {
      return;
    }
    const currentValue = favoriteState.selectedListFolderId;
    select.innerHTML = [
      '<option value="">全部收藏夹</option>',
      ...favoriteState.folders.map((folder) => `<option value="${folder.id}">${escapeHTML(folder.name)}</option>`)
    ].join("");
    select.value = currentValue;
  }

  function renderFavoriteList(panel, message = "") {
    const list = panel.querySelector("[data-ecx-favorite-list]");
    if (!list) {
      return;
    }
    if (message) {
      list.innerHTML = `<div class="ecx-favorite-empty">${escapeHTML(message)}</div>`;
      return;
    }
    if (favoriteState.favorites.length === 0) {
      list.innerHTML = '<div class="ecx-favorite-empty">暂无收藏文章。</div>';
      return;
    }

    list.innerHTML = favoriteState.favorites.map((favorite) => {
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

  async function loadFavoriteFolders(panel) {
    const response = await sendMessage({ type: "LIST_FAVORITE_FOLDERS" });
    favoriteState.folders = response.folders || [];
    renderFavoriteFolderOptions(panel);
    renderFavoriteFilter(panel);
  }

  async function loadArticleFavorite(panel, showStatus = false) {
    const article = currentArticle();
    if (!article.caixin_id) {
      return;
    }
    if (showStatus) {
      setStatus("正在加载收藏状态...", "muted");
    }
    try {
      const response = await sendMessage({
        type: "GET_ARTICLE_FAVORITE",
        caixinID: article.caixin_id
      });
      favoriteState.articleFavorite = response.favorite || { favorited: false, folders: [] };
      renderFavoriteFolderOptions(panel);
      updateFavoriteButton(panel);
      if (showStatus) {
        setStatus(favoriteState.articleFavorite.favorited ? "文章已收藏。" : "当前文章未收藏。", "success");
      }
    } catch (error) {
      favoriteState.articleFavorite = { favorited: false, folders: [] };
      updateFavoriteButton(panel);
      if (showStatus) {
        setStatus(error.message || String(error), "error");
      }
    }
  }

  async function saveFavoriteSelection(panel) {
    const article = currentArticle();
    setStatus("正在保存文章并更新收藏...", "muted");
    await window.EnhancedCaiXinSaveArticle.saveCurrentArticle();
    const response = await sendMessage({
      type: "SAVE_ARTICLE_FAVORITE",
      caixinID: article.caixin_id,
      folderIDs: selectedFavoriteFolderIds(panel)
    });
    favoriteState.articleFavorite = response.favorite || { favorited: false, folders: [] };
    renderFavoriteFolderOptions(panel);
    updateFavoriteButton(panel);
    await loadFavoriteList(panel);
    setStatus("收藏已更新。", "success");
  }

  async function deleteArticleFavorite(panel) {
    const article = currentArticle();
    setStatus("正在删除文章...", "muted");
    await sendMessage({
      type: "DELETE_ARTICLE_FAVORITE",
      caixinID: article.caixin_id
    });
    favoriteState.articleFavorite = { favorited: false, folders: [] };
    renderFavoriteFolderOptions(panel);
    updateFavoriteButton(panel);
    await loadFavoriteList(panel);
    setStatus("文章已从数据库删除。", "success");
  }

  async function createFavoriteFolder(panel) {
    const input = panel.querySelector("[data-ecx-new-favorite-folder]");
    const name = input.value.trim();
    if (!name) {
      setStatus("请输入收藏夹名称。", "error");
      return;
    }
    setStatus("正在创建收藏夹...", "muted");
    const response = await sendMessage({
      type: "CREATE_FAVORITE_FOLDER",
      name
    });
    input.value = "";
    favoriteState.folders.push(response.folder);
    renderFavoriteFolderOptions(panel);
    renderFavoriteFilter(panel);
    const checkbox = panel.querySelector(`[data-ecx-favorite-folder][value="${response.folder.id}"]`);
    if (checkbox) {
      checkbox.checked = true;
    }
    setStatus("收藏夹已创建。", "success");
  }

  async function loadFavoriteList(panel) {
    renderFavoriteList(panel, "正在加载收藏列表...");
    const folderID = Number(favoriteState.selectedListFolderId || 0);
    try {
      const response = await sendMessage({
        type: "LIST_FAVORITES",
        options: {
          folderID,
          limit: 50,
          offset: 0
        }
      });
      favoriteState.favorites = response.favorites || [];
      renderFavoriteList(panel);
    } catch (error) {
      renderFavoriteList(panel, error.message || String(error));
    }
  }

  async function loadFavoritesPanel(panel, showStatus = false) {
    if (showStatus) {
      setStatus("正在加载收藏信息...", "muted");
    }
    try {
      await loadFavoriteFolders(panel);
      await loadArticleFavorite(panel, false);
      await loadFavoriteList(panel);
      if (showStatus) {
        setStatus("收藏信息已加载。", "success");
      }
    } catch (error) {
      renderFavoriteList(panel, error.message || String(error));
      if (showStatus) {
        setStatus(error.message || String(error), "error");
      }
    }
  }

  async function loadAnnotations(showStatus = false) {
    const article = currentArticle();
    if (!article.caixin_id) {
      renderAnnotationList("未能识别文章 ID。");
      return;
    }
    if (showStatus) {
      setStatus("正在加载笔记与高亮...", "muted");
    }
    try {
      const response = await sendMessage({
        type: "LIST_ANNOTATIONS",
        caixinID: article.caixin_id
      });
      annotationState.annotations = response.annotations || [];
      renderAnnotations();
      if (showStatus) {
        setStatus("笔记与高亮已加载。", "success");
      }
    } catch (error) {
      renderAnnotationList(error.message || String(error));
      if (showStatus) {
        setStatus(error.message || String(error), "error");
      }
    }
  }

  function annotationPayloadFromSelection(noteText = "") {
    const container = articleContainer();
    const selection = window.getSelection();
    if (!container || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
      throw new Error("请先在文章正文中选择一段文本。");
    }
    const range = selection.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) {
      throw new Error("只能在文章正文中创建高亮或笔记。");
    }

    const offsets = selectionOffsets(container, range);
    if (!offsets.selectedText) {
      throw new Error("选中文本为空。");
    }

    const index = buildTextIndex(container);
    return {
      type: noteText ? "note" : "highlight",
      selected_text: offsets.selectedText,
      note_text: noteText || null,
      color: "yellow",
      start_offset: offsets.startOffset,
      end_offset: offsets.endOffset,
      prefix_text: index.text.slice(Math.max(0, offsets.startOffset - 80), offsets.startOffset),
      suffix_text: index.text.slice(offsets.endOffset, offsets.endOffset + 80)
    };
  }

  async function createAnnotationFromSelection(noteText = "") {
    const article = currentArticle();
    const payload = annotationPayloadFromSelection(noteText);
    setStatus("正在保存文章并创建笔记/高亮...", "muted");
    await window.EnhancedCaiXinSaveArticle.saveCurrentArticle();
    const response = await sendMessage({
      type: "CREATE_ANNOTATION",
      caixinID: article.caixin_id,
      annotation: payload
    });
    annotationState.annotations.push(response.annotation);
    annotationState.annotations.sort((a, b) => a.start_offset - b.start_offset || a.id - b.id);
    window.getSelection()?.removeAllRanges();
    hideSelectionToolbar();
    renderAnnotations();
    setStatus(payload.type === "note" ? "笔记已创建。" : "高亮已创建。", "success");
  }

  async function deleteAnnotation(id) {
    setStatus("正在删除笔记/高亮...", "muted");
    await sendMessage({
      type: "DELETE_ANNOTATION",
      id
    });
    annotationState.annotations = annotationState.annotations.filter((annotation) => String(annotation.id) !== String(id));
    renderAnnotations();
    setStatus("笔记/高亮已删除。", "success");
  }

  function ensureSelectionToolbar() {
    if (annotationState.toolbar) {
      return annotationState.toolbar;
    }
    const toolbar = document.createElement("div");
    toolbar.className = "ecx-selection-toolbar";
    toolbar.hidden = true;
    toolbar.innerHTML = `
      <button type="button" data-ecx-create-highlight>高亮</button>
      <button type="button" data-ecx-create-note>添加笔记</button>
    `;
    document.documentElement.appendChild(toolbar);
    toolbar.querySelector("[data-ecx-create-highlight]").addEventListener("click", () => {
      createAnnotationFromSelection().catch((error) => setStatus(error.message || String(error), "error"));
    });
    toolbar.querySelector("[data-ecx-create-note]").addEventListener("click", () => {
      const noteText = prompt("请输入笔记内容：", "");
      if (noteText === null) {
        return;
      }
      createAnnotationFromSelection(noteText.trim()).catch((error) => setStatus(error.message || String(error), "error"));
    });
    annotationState.toolbar = toolbar;
    return toolbar;
  }

  function hideSelectionToolbar() {
    if (annotationState.toolbar) {
      annotationState.toolbar.hidden = true;
    }
  }

  function updateSelectionToolbar() {
    const selection = window.getSelection();
    const container = articleContainer();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !container) {
      hideSelectionToolbar();
      return;
    }
    const range = selection.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer) || normalizeText(range.toString()).length === 0) {
      hideSelectionToolbar();
      return;
    }
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) {
      hideSelectionToolbar();
      return;
    }
    const toolbar = ensureSelectionToolbar();
    toolbar.hidden = false;
    const left = clamp(rect.left + rect.width / 2 - toolbar.offsetWidth / 2, 8, window.innerWidth - toolbar.offsetWidth - 8);
    const top = clamp(rect.top - toolbar.offsetHeight - 8, 8, window.innerHeight - toolbar.offsetHeight - 8);
    toolbar.style.left = `${left}px`;
    toolbar.style.top = `${top}px`;
  }

  function bindAnnotationSelection() {
    document.addEventListener("selectionchange", () => {
      window.setTimeout(updateSelectionToolbar, 0);
    });
    document.addEventListener("mousedown", (event) => {
      if (!event.target.closest(".ecx-selection-toolbar")) {
        hideSelectionToolbar();
      }
    });
  }

  async function loadSettings(form) {
    const settings = await sendMessage({ type: "GET_SETTINGS" });
    form.articleSaveEndpoint.value = settings.articleSaveEndpoint || "";
    form.chatApiEndpoint.value = settings.chatApiEndpoint || "";
    form.chatApiKey.value = settings.chatApiKey || "";
    form.chatModel.value = settings.chatModel || "";
    form.chatTemperature.value = settings.chatTemperature ?? "";
  }

  function formatJson(value) {
    return JSON.stringify(value, null, 2);
  }

  function getSettingsForm(panel) {
    return panel.querySelector("[data-ecx-settings-form]");
  }

  async function saveSettingsFromForm(form, hideAfterSave) {
    await sendMessage({
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
    if (hideAfterSave) {
      form.closest("[data-ecx-settings]").hidden = true;
    }
  }

  async function saveSettings(event) {
    event.preventDefault();
    await saveSettingsFromForm(event.currentTarget, true);
  }

  async function buildSaveDebugRequest(panel) {
    const form = getSettingsForm(panel);
    const output = panel.querySelector("[data-ecx-save-debug-response]");
    output.textContent = "正在生成保存文章请求...";
    await saveSettingsFromForm(form, false);

    try {
      const article = window.EnhancedCaiXinArticleExtractor.extractCurrentArticle();
      const request = await sendMessage({
        type: "BUILD_SAVE_ARTICLE_REQUEST",
        article
      });
      panel.querySelector("[data-ecx-save-debug-request]").value = formatJson(request);
      output.textContent = "保存文章请求已生成，可修改 endpoint、headers 或 body 后发送。";
    } catch (error) {
      output.textContent = error.message || String(error);
    }
  }

  async function sendSaveDebugRequest(panel) {
    const output = panel.querySelector("[data-ecx-save-debug-response]");
    output.textContent = "正在发送保存文章调试请求...";

    try {
      const requestText = panel.querySelector("[data-ecx-save-debug-request]").value.trim();
      const request = requestText ? JSON.parse(requestText) : {};
      const response = await sendMessage({
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

  async function buildDebugRequest(panel) {
    const form = getSettingsForm(panel);
    const output = panel.querySelector("[data-ecx-debug-response]");
    output.textContent = "正在生成请求...";
    await saveSettingsFromForm(form, false);

    try {
      const article = window.EnhancedCaiXinArticleExtractor.extractCurrentArticle();
      const question = panel.querySelector("[data-ecx-debug-question]").value.trim()
        || "请用三句话概括这篇文章。";
      const request = await sendMessage({
        type: "BUILD_CHAT_REQUEST",
        article,
        messages: [{ role: "user", content: question }]
      });
      panel.querySelector("[data-ecx-debug-config]").textContent = [
        `Base URL: ${request.endpoint}`,
        `Model: ${request.body?.model || ""}`,
        `API Key: ${request.headers?.Authorization ? "已配置" : "未配置"}`
      ].join("\n");
      panel.querySelector("[data-ecx-debug-body]").value = formatJson(request.body);
      output.textContent = "请求体已生成，可直接修改请求体后发送。";
    } catch (error) {
      output.textContent = error.message || String(error);
    }
  }

  async function sendDebugRequest(panel) {
    const output = panel.querySelector("[data-ecx-debug-response]");
    output.textContent = "正在发送调试请求...";

    try {
      const bodyText = panel.querySelector("[data-ecx-debug-body]").value.trim();
      const body = bodyText ? JSON.parse(bodyText) : {};
      const response = await sendMessage({
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

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  async function applySavedPanelPosition(panel) {
    const settings = await sendMessage({ type: "GET_SETTINGS" });
    if (Number.isFinite(settings.panelLeft) && Number.isFinite(settings.panelTop)) {
      panel.style.left = `${clamp(settings.panelLeft, 8, window.innerWidth - 80)}px`;
      panel.style.top = `${clamp(settings.panelTop, 8, window.innerHeight - 48)}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    }
  }

  function makePanelDraggable(panel) {
    const handle = panel.querySelector("[data-ecx-drag-handle]");
    let dragState = null;

    handle.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) {
        return;
      }

      const rect = panel.getBoundingClientRect();
      dragState = {
        pointerId: event.pointerId,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top
      };
      panel.classList.add("ecx-panel-dragging");
      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.top}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      handle.setPointerCapture(event.pointerId);
      event.preventDefault();
    });

    handle.addEventListener("pointermove", (event) => {
      if (!dragState || event.pointerId !== dragState.pointerId) {
        return;
      }

      const maxLeft = Math.max(8, window.innerWidth - panel.offsetWidth - 8);
      const maxTop = Math.max(8, window.innerHeight - panel.offsetHeight - 8);
      const left = clamp(event.clientX - dragState.offsetX, 8, maxLeft);
      const top = clamp(event.clientY - dragState.offsetY, 8, maxTop);
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
    });

    async function stopDragging(event) {
      if (!dragState || event.pointerId !== dragState.pointerId) {
        return;
      }

      const rect = panel.getBoundingClientRect();
      dragState = null;
      panel.classList.remove("ecx-panel-dragging");
      await sendMessage({
        type: "SAVE_SETTINGS",
        settings: {
          panelLeft: Math.round(rect.left),
          panelTop: Math.round(rect.top)
        }
      });
    }

    handle.addEventListener("pointerup", stopDragging);
    handle.addEventListener("pointercancel", stopDragging);
  }

  function createControlPanel() {
    const panel = document.createElement("section");
    panel.id = "ecx-control-panel";
    panel.innerHTML = `
      <div class="ecx-panel-header" data-ecx-drag-handle title="拖动移动面板">
        <div>
          <div class="ecx-panel-title">Enhanced CaiXin</div>
          <div class="ecx-panel-subtitle">文章保存与上下文对话，可拖动</div>
        </div>
        <button class="ecx-icon-button" type="button" data-ecx-collapse aria-label="收起">−</button>
      </div>
      <div class="ecx-panel-body">
        <button class="ecx-primary-button" type="button" data-ecx-save>保存当前文章到 MySQL</button>
        <button class="ecx-secondary-button" type="button" data-ecx-toggle-favorites>收藏</button>
        <button class="ecx-secondary-button" type="button" data-ecx-chat>打开文章对话侧边栏</button>
        <button class="ecx-secondary-button" type="button" data-ecx-toggle-annotations>笔记/高亮</button>
        <button class="ecx-link-button" type="button" data-ecx-toggle-settings>接口设置</button>
        <div class="ecx-status" data-ecx-status data-tone="muted">等待操作。</div>
        <div class="ecx-favorites-panel" data-ecx-favorites hidden>
          <div class="ecx-favorites-header">
            <div class="ecx-favorites-title">当前文章收藏夹</div>
            <button type="button" data-ecx-refresh-favorites>刷新</button>
          </div>
          <div class="ecx-favorite-folder-list" data-ecx-favorite-folder-list>
            <div class="ecx-favorite-empty">正在加载...</div>
          </div>
          <div class="ecx-favorite-actions">
            <button type="button" data-ecx-save-favorite>保存收藏</button>
            <button type="button" data-ecx-delete-favorite>删除文章</button>
          </div>
          <div class="ecx-favorite-create">
            <input type="text" data-ecx-new-favorite-folder placeholder="新收藏夹名称">
            <button type="button" data-ecx-create-favorite-folder>新建</button>
          </div>
          <div class="ecx-favorites-header">
            <div class="ecx-favorites-title">收藏列表</div>
            <select data-ecx-favorite-list-folder aria-label="收藏夹筛选">
              <option value="">全部收藏夹</option>
            </select>
          </div>
          <div class="ecx-favorite-list" data-ecx-favorite-list>
            <div class="ecx-favorite-empty">正在加载...</div>
          </div>
        </div>
        <div class="ecx-annotations-panel" data-ecx-annotations hidden>
          <div class="ecx-annotations-header">
            <div class="ecx-annotations-title">笔记与高亮</div>
            <button type="button" data-ecx-refresh-annotations>刷新</button>
          </div>
          <div class="ecx-annotation-list" data-ecx-annotation-list>
            <div class="ecx-annotation-empty">正在加载...</div>
          </div>
        </div>
        <div class="ecx-settings" data-ecx-settings hidden>
          <form data-ecx-settings-form>
            <label>
              <span>文章保存接口</span>
              <input name="articleSaveEndpoint" type="url" placeholder="http://127.0.0.1:1234/api/articles">
            </label>
            <label>
              <span>大模型 API 地址</span>
              <input name="chatApiEndpoint" type="url" placeholder="https://api.example.com/v1/chat/completions">
            </label>
            <label>
              <span>API Key</span>
              <input name="chatApiKey" type="password" placeholder="可选">
            </label>
            <div class="ecx-settings-row">
              <label>
                <span>模型</span>
                <input name="chatModel" type="text" placeholder="gpt-4o-mini">
              </label>
              <label>
                <span>温度</span>
                <input name="chatTemperature" type="number" min="0" max="2" step="0.1">
              </label>
            </div>
            <button type="submit">保存设置</button>
          </form>
          <div class="ecx-debugger">
            <div class="ecx-debugger-title">文章保存接口调试</div>
            <label>
              <span>完整请求，可编辑 JSON</span>
              <textarea data-ecx-save-debug-request rows="12" spellcheck="false"></textarea>
            </label>
            <div class="ecx-debugger-actions">
              <button type="button" data-ecx-build-save-debug-request>生成保存请求</button>
              <button type="button" data-ecx-send-save-debug-request>发送保存请求</button>
            </div>
            <label>
              <span>保存接口响应</span>
              <pre data-ecx-save-debug-response>尚未发送保存文章调试请求。</pre>
            </label>
          </div>
          <div class="ecx-debugger">
            <div class="ecx-debugger-title">大模型接口调试</div>
            <label>
              <span>测试问题</span>
              <input data-ecx-debug-question type="text" value="请用三句话概括这篇文章。">
            </label>
            <pre class="ecx-debug-config" data-ecx-debug-config>使用上方已保存的大模型 API 地址、API Key、模型和温度。</pre>
            <label>
              <span>请求 Body，可编辑 JSON</span>
              <textarea data-ecx-debug-body rows="10" spellcheck="false"></textarea>
            </label>
            <div class="ecx-debugger-actions">
              <button type="button" data-ecx-build-debug-request>生成请求体</button>
              <button type="button" data-ecx-send-debug-request>发送调试请求</button>
            </div>
            <label>
              <span>返回结果</span>
              <pre data-ecx-debug-response>尚未发送调试请求。</pre>
            </label>
          </div>
        </div>
      </div>
    `;

    document.documentElement.appendChild(panel);
    makePanelDraggable(panel);
    applySavedPanelPosition(panel).catch(() => {});
    panel.querySelector("[data-ecx-save]").addEventListener("click", saveArticle);
    panel.querySelector("[data-ecx-toggle-favorites]").addEventListener("click", async () => {
      const favorites = panel.querySelector("[data-ecx-favorites]");
      favorites.hidden = !favorites.hidden;
      if (!favorites.hidden) {
        await loadFavoritesPanel(panel, true);
      }
    });
    panel.querySelector("[data-ecx-refresh-favorites]").addEventListener("click", () => {
      loadFavoritesPanel(panel, true);
    });
    panel.querySelector("[data-ecx-save-favorite]").addEventListener("click", () => {
      saveFavoriteSelection(panel).catch((error) => setStatus(error.message || String(error), "error"));
    });
    panel.querySelector("[data-ecx-delete-favorite]").addEventListener("click", () => {
      deleteArticleFavorite(panel).catch((error) => setStatus(error.message || String(error), "error"));
    });
    panel.querySelector("[data-ecx-create-favorite-folder]").addEventListener("click", () => {
      createFavoriteFolder(panel).catch((error) => setStatus(error.message || String(error), "error"));
    });
    panel.querySelector("[data-ecx-new-favorite-folder]").addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        createFavoriteFolder(panel).catch((error) => setStatus(error.message || String(error), "error"));
      }
    });
    panel.querySelector("[data-ecx-favorite-list-folder]").addEventListener("change", (event) => {
      favoriteState.selectedListFolderId = event.currentTarget.value;
      loadFavoriteList(panel);
    });
    panel.querySelector("[data-ecx-chat]").addEventListener("click", () => {
      window.EnhancedCaiXinChatSidebar.open();
    });
    panel.querySelector("[data-ecx-toggle-annotations]").addEventListener("click", async () => {
      const annotations = panel.querySelector("[data-ecx-annotations]");
      annotations.hidden = !annotations.hidden;
      if (!annotations.hidden) {
        await loadAnnotations(true);
      }
    });
    panel.querySelector("[data-ecx-refresh-annotations]").addEventListener("click", () => {
      loadAnnotations(true);
    });
    panel.querySelector("[data-ecx-annotation-list]").addEventListener("click", (event) => {
      const button = event.target.closest("[data-ecx-delete-annotation]");
      if (!button) {
        return;
      }
      deleteAnnotation(button.dataset.ecxDeleteAnnotation).catch((error) => {
        setStatus(error.message || String(error), "error");
      });
    });
    panel.querySelector("[data-ecx-collapse]").addEventListener("click", () => {
      panel.classList.toggle("ecx-panel-collapsed");
    });
    panel.querySelector("[data-ecx-toggle-settings]").addEventListener("click", async () => {
      const settings = panel.querySelector("[data-ecx-settings]");
      settings.hidden = !settings.hidden;
      if (!settings.hidden) {
        await loadSettings(panel.querySelector("[data-ecx-settings-form]"));
      }
    });
    panel.querySelector("[data-ecx-settings-form]").addEventListener("submit", saveSettings);
    panel.querySelector("[data-ecx-build-save-debug-request]").addEventListener("click", () => {
      buildSaveDebugRequest(panel);
    });
    panel.querySelector("[data-ecx-send-save-debug-request]").addEventListener("click", () => {
      sendSaveDebugRequest(panel);
    });
    panel.querySelector("[data-ecx-build-debug-request]").addEventListener("click", () => {
      buildDebugRequest(panel);
    });
    panel.querySelector("[data-ecx-send-debug-request]").addEventListener("click", () => {
      sendDebugRequest(panel);
    });
  }

  createControlPanel();
  bindAnnotationSelection();
  loadAnnotations(false);
  loadFavoriteFolders(document.querySelector("#ecx-control-panel")).then(() => {
    return loadArticleFavorite(document.querySelector("#ecx-control-panel"), false);
  }).catch(() => {});
})();
