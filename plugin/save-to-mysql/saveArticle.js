(function () {
  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response?.ok) {
          reject(new Error(response?.error || "保存文章失败"));
          return;
        }
        resolve(response.payload);
      });
    });
  }

  async function saveCurrentArticle() {
    const article = window.EnhancedCaiXinArticleExtractor.extractCurrentArticle();
    if (!article.title || !article.content) {
      throw new Error("未能识别当前页面的文章标题或正文。");
    }
    return sendMessage({
      type: "SAVE_ARTICLE",
      article
    });
  }

  window.EnhancedCaiXinSaveArticle = {
    saveCurrentArticle
  };
})();
