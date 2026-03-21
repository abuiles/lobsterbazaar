CREATE TABLE IF NOT EXISTS categories (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  summary TEXT NOT NULL,
  skill_buying_targets TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS merchant_categories (
  merchant_slug TEXT NOT NULL,
  category_slug TEXT NOT NULL,
  PRIMARY KEY (merchant_slug, category_slug),
  FOREIGN KEY (merchant_slug) REFERENCES merchants(slug) ON DELETE CASCADE,
  FOREIGN KEY (category_slug) REFERENCES categories(slug) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_merchant_categories_category_slug
  ON merchant_categories (category_slug, merchant_slug);
