ALTER TABLE articles
  ADD FULLTEXT KEY idx_articles_fulltext_search (title, author, catagory, content) WITH PARSER ngram;
