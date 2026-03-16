CREATE TABLE IF NOT EXISTS merchants (
  slug TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  store_url TEXT NOT NULL,
  store_domain TEXT,
  storefront_mcp_url TEXT,
  locations_summary TEXT,
  notes TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  claim_contact TEXT,
  claim_status TEXT NOT NULL DEFAULT 'unclaimed',
  vertical_metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS merchant_countries (
  merchant_slug TEXT NOT NULL,
  country_code TEXT NOT NULL,
  PRIMARY KEY (merchant_slug, country_code),
  FOREIGN KEY (merchant_slug) REFERENCES merchants(slug) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_merchant_countries_country_code
  ON merchant_countries (country_code, merchant_slug);

CREATE TABLE IF NOT EXISTS merchant_claims (
  claim_id TEXT PRIMARY KEY,
  merchant_slug TEXT NOT NULL,
  status TEXT NOT NULL,
  contact TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (merchant_slug) REFERENCES merchants(slug) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_merchant_claims_merchant_slug
  ON merchant_claims (merchant_slug);

CREATE TABLE IF NOT EXISTS claws (
  claw_id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  merchant_slug TEXT,
  api_key_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (merchant_slug) REFERENCES merchants(slug)
);

CREATE INDEX IF NOT EXISTS idx_claws_merchant_slug
  ON claws (merchant_slug);

CREATE TABLE IF NOT EXISTS offers (
  offer_id TEXT PRIMARY KEY,
  merchant_slug TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  active_from TEXT,
  valid_through TEXT NOT NULL,
  offer_type TEXT NOT NULL,
  terms_text TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  public_proof_url TEXT,
  offer_code TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  vertical_metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (merchant_slug) REFERENCES merchants(slug) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_offers_merchant_slug
  ON offers (merchant_slug);

CREATE INDEX IF NOT EXISTS idx_offers_status_valid_through
  ON offers (status, valid_through);

CREATE TABLE IF NOT EXISTS offer_countries (
  offer_id TEXT NOT NULL,
  country_code TEXT NOT NULL,
  PRIMARY KEY (offer_id, country_code),
  FOREIGN KEY (offer_id) REFERENCES offers(offer_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_offer_countries_country_code
  ON offer_countries (country_code, offer_id);
