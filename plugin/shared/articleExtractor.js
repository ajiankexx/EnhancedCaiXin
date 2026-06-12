(function () {
  const ARTICLE_SELECTORS = [
    "#Main_Content_Val",
    ".article-content",
    ".articleContent",
    ".content",
    ".text",
    "article"
  ];

  const TITLE_SELECTORS = [
    "h1",
    ".article-title",
    ".title h1",
    ".title",
    "meta[property='og:title']"
  ];

  const AUTHOR_SELECTORS = [
    ".author",
    ".source",
    ".article-author",
    "[class*='author']"
  ];

  const CATEGORY_SELECTORS = [
    ".crumb",
    ".breadcrumb",
    ".nav",
    "[class*='channel']"
  ];

  function normalizeText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function isAiSummaryNotice(text) {
    const normalized = normalizeText(text);
    return normalized.includes("本文由第三方AI基于财新文章")
      && normalized.includes("提炼总结而成")
      && normalized.includes("可能与原文真实意图存在偏差")
      && normalized.includes("不代表财新观点和立场")
      && normalized.includes("推荐点击链接阅读原文细致比对和校验");
  }

  function dropLeadingAiSummaryNotice(paragraphs) {
    if (paragraphs.length === 0 || !isAiSummaryNotice(paragraphs[0])) {
      return paragraphs;
    }
    return paragraphs.slice(1);
  }

  function dropLeadingAiSummaryNoticeFromText(text) {
    const normalized = normalizeText(text);
    if (!isAiSummaryNotice(normalized)) {
      return normalized;
    }
    const paragraphs = normalized.split(/\n{2,}/).filter(Boolean);
    const filteredParagraphs = dropLeadingAiSummaryNotice(paragraphs);
    if (filteredParagraphs.length > 0) {
      return filteredParagraphs.join("\n\n");
    }

    const noticeEnd = normalized.indexOf("推荐点击链接阅读原文细致比对和校验");
    if (noticeEnd < 0) {
      return normalized;
    }
    return normalizeText(normalized.slice(noticeEnd + "推荐点击链接阅读原文细致比对和校验".length));
  }

  function textFromSelector(selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (!element) {
        continue;
      }
      const value = element.tagName === "META"
        ? element.getAttribute("content")
        : element.textContent;
      const text = normalizeText(value);
      if (text) {
        return text;
      }
    }
    return "";
  }

  function metaContent(...names) {
    for (const name of names) {
      const selector = `meta[name='${name}'], meta[property='${name}']`;
      const value = document.querySelector(selector)?.getAttribute("content");
      if (normalizeText(value)) {
        return normalizeText(value);
      }
    }
    return "";
  }

  function extractArticleBody() {
    const element = findArticleContainer();
    if (element) {
      const paragraphs = Array.from(element.querySelectorAll("p"))
        .map((node) => normalizeText(node.textContent))
        .filter(Boolean);
      const filteredParagraphs = dropLeadingAiSummaryNotice(paragraphs);
      const text = paragraphs.length > 0
        ? filteredParagraphs.join("\n\n")
        : dropLeadingAiSummaryNoticeFromText(element.textContent);
      if (text.length > 80) {
        return text;
      }
    }

    const fallbackParagraphs = Array.from(document.querySelectorAll("p"))
      .map((node) => normalizeText(node.textContent))
      .filter((text) => text.length > 20);
    return dropLeadingAiSummaryNotice(fallbackParagraphs).join("\n\n");
  }

  function findArticleContainer() {
    for (const selector of ARTICLE_SELECTORS) {
      const element = document.querySelector(selector);
      if (!element) {
        continue;
      }
      if (normalizeText(element.textContent).length > 80) {
        return element;
      }
    }
    return null;
  }

  function extractPublishTime() {
    const candidates = [
      metaContent("article:published_time", "pubdate", "publishdate", "publish_time"),
      document.querySelector("time")?.getAttribute("datetime"),
      document.querySelector("time")?.textContent,
      document.body?.textContent?.match(/\d{4}[-/年]\d{1,2}[-/月]\d{1,2}[日\s]+(?:\d{1,2}:\d{1,2}(?::\d{1,2})?)?/)?.[0]
    ];

    for (const candidate of candidates) {
      const text = normalizeText(candidate);
      if (!text) {
        continue;
      }
      const normalized = text
        .replace(/[年月]/g, "-")
        .replace("日", "")
        .replace(/\//g, "-");
      const date = new Date(normalized);
      if (!Number.isNaN(date.getTime())) {
        return date.toISOString();
      }
      return text;
    }
    return null;
  }

  function extractCaixinId(url) {
    const match = url.match(/(?:\/|_)(\d{6,})(?:\.html|\/)?(?:[?#].*)?$/);
    if (match) {
      return match[1];
    }
    return String(url).replace(/^https?:\/\//, "").replace(/[?#].*$/, "").slice(0, 128);
  }

  function extractCurrentArticle() {
    const url = location.href;
    const title = textFromSelector(TITLE_SELECTORS)
      || metaContent("og:title", "twitter:title")
      || document.title.replace(/_财新网.*$/, "").trim();
    const body = extractArticleBody();
    const description = metaContent("description", "og:description");

    return {
      caixin_id: extractCaixinId(url),
      url,
      title,
      author: metaContent("author") || textFromSelector(AUTHOR_SELECTORS) || null,
      catagory: metaContent("article:section") || textFromSelector(CATEGORY_SELECTORS) || null,
      publish_time: extractPublishTime(),
      content: body,
      summary: description
    };
  }

  window.EnhancedCaiXinArticleExtractor = {
    extractCurrentArticle,
    findArticleContainer,
    normalizeText
  };
})();
