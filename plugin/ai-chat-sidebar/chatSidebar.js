(function () {
  const state = {
    isOpen: false,
    messages: []
  };

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response?.ok) {
          reject(new Error(response?.error || "聊天请求失败"));
          return;
        }
        resolve(response.payload);
      });
    });
  }

  function ensureSidebar() {
    let sidebar = document.getElementById("ecx-chat-sidebar");
    if (sidebar) {
      return sidebar;
    }

    sidebar = document.createElement("aside");
    sidebar.id = "ecx-chat-sidebar";
    sidebar.innerHTML = `
      <div class="ecx-chat-header">
        <div>
          <div class="ecx-chat-title">文章对话</div>
          <div class="ecx-chat-subtitle">使用当前财新文章作为上下文</div>
        </div>
        <button class="ecx-icon-button" type="button" data-ecx-close-chat aria-label="关闭">×</button>
      </div>
      <div class="ecx-chat-messages" data-ecx-chat-messages></div>
      <form class="ecx-chat-form" data-ecx-chat-form>
        <textarea data-ecx-chat-input rows="3" placeholder="围绕当前文章提问"></textarea>
        <button type="submit">发送</button>
      </form>
    `;

    document.documentElement.appendChild(sidebar);
    sidebar.querySelector("[data-ecx-close-chat]").addEventListener("click", close);
    sidebar.querySelector("[data-ecx-chat-form]").addEventListener("submit", submitQuestion);
    sidebar.querySelector("[data-ecx-chat-input]").addEventListener("keydown", submitChatOnEnter);
    renderMessages();
    return sidebar;
  }

  function renderMessages() {
    const sidebar = ensureSidebar();
    const container = sidebar.querySelector("[data-ecx-chat-messages]");
    if (!state.messages.length) {
      container.innerHTML = `
        <div class="ecx-chat-empty">
          侧边栏会把当前文章标题、正文、作者和发布时间一起发给模型。请先在设置里填写 OpenAI-compatible API 地址和模型。
        </div>
      `;
      return;
    }

    container.innerHTML = "";
    for (const message of state.messages) {
      const bubble = document.createElement("div");
      bubble.className = `ecx-chat-bubble ecx-chat-bubble-${message.role}`;
      bubble.textContent = message.content;
      container.appendChild(bubble);
    }
    container.scrollTop = container.scrollHeight;
  }

  async function submitQuestion(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.querySelector("[data-ecx-chat-input]");
    const content = input.value.trim();
    if (!content) {
      return;
    }

    input.value = "";
    state.messages.push({ role: "user", content });
    state.messages.push({ role: "assistant", content: "正在生成回答..." });
    renderMessages();

    try {
      const article = window.EnhancedCaiXinArticleExtractor.extractCurrentArticle();
      const chatMessages = state.messages
        .filter((message) => message.content !== "正在生成回答...")
        .map((message) => ({ role: message.role, content: message.content }));
      const result = await sendMessage({
        type: "CHAT_WITH_ARTICLE",
        messages: chatMessages,
        article
      });
      state.messages[state.messages.length - 1] = {
        role: "assistant",
        content: result.content
      };
    } catch (error) {
      state.messages[state.messages.length - 1] = {
        role: "assistant",
        content: error.message || String(error)
      };
    }
    renderMessages();
  }

  function submitChatOnEnter(event) {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }
    event.preventDefault();
    const form = event.currentTarget.closest("form");
    if (form?.requestSubmit) {
      form.requestSubmit();
      return;
    }
    form?.querySelector('button[type="submit"]')?.click();
  }

  function open() {
    state.isOpen = true;
    ensureSidebar().classList.add("ecx-chat-sidebar-open");
    document.documentElement.classList.add("ecx-chat-open");
  }

  function close() {
    state.isOpen = false;
    ensureSidebar().classList.remove("ecx-chat-sidebar-open");
    document.documentElement.classList.remove("ecx-chat-open");
  }

  function toggle() {
    if (state.isOpen) {
      close();
    } else {
      open();
    }
  }

  window.EnhancedCaiXinChatSidebar = {
    open,
    close,
    toggle
  };
})();
