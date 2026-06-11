(function () {
  if (window.__enhancedCaiXinLoaded) {
    return;
  }
  window.__enhancedCaiXinLoaded = true;

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
        <button class="ecx-secondary-button" type="button" data-ecx-chat>打开文章对话侧边栏</button>
        <button class="ecx-link-button" type="button" data-ecx-toggle-settings>接口设置</button>
        <div class="ecx-status" data-ecx-status data-tone="muted">等待操作。</div>
        <div class="ecx-settings" data-ecx-settings hidden>
          <form data-ecx-settings-form>
            <label>
              <span>文章保存接口</span>
              <input name="articleSaveEndpoint" type="url" placeholder="http://127.0.0.1:8080/api/articles">
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
    panel.querySelector("[data-ecx-chat]").addEventListener("click", () => {
      window.EnhancedCaiXinChatSidebar.open();
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
    panel.querySelector("[data-ecx-build-debug-request]").addEventListener("click", () => {
      buildDebugRequest(panel);
    });
    panel.querySelector("[data-ecx-send-debug-request]").addEventListener("click", () => {
      sendDebugRequest(panel);
    });
  }

  createControlPanel();
})();
