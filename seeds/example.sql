INSERT OR REPLACE INTO merchants
  (slug, display_name, store_url, store_domain, storefront_mcp_url, locations_summary, notes, tags_json, claim_contact, claim_status, vertical_metadata_json, created_at, updated_at)
VALUES
  (
    'sample-roaster',
    'Sample Roaster',
    'https://sample-roaster.com',
    'sample-roaster.myshopify.com',
    'https://sample-roaster.myshopify.com/api/mcp',
    '3 cafes',
    'Specialty merchant used for local development.',
    '["coffee","sample"]',
    'hello@sample-roaster.com',
    'claimed',
    '{"category":"roaster"}',
    '2026-03-15T00:00:00Z',
    '2026-03-15T00:00:00Z'
  ),
  (
    'plain-roaster',
    'Plain Roaster',
    'https://plain-roaster.com',
    NULL,
    NULL,
    NULL,
    'Second merchant used to verify offers-first ordering.',
    '["coffee"]',
    'hello@plain-roaster.com',
    'unclaimed',
    '{"category":"roaster"}',
    '2026-03-15T00:00:00Z',
    '2026-03-15T00:00:00Z'
  );

INSERT OR REPLACE INTO merchant_countries (merchant_slug, country_code)
VALUES
  ('sample-roaster', 'US'),
  ('sample-roaster', 'CA'),
  ('plain-roaster', 'US');

INSERT OR REPLACE INTO merchant_claims
  (claim_id, merchant_slug, status, contact, note, created_at, updated_at)
VALUES
  (
    'claim_sample',
    'sample-roaster',
    'claimed',
    'hello@sample-roaster.com',
    'Local development claim record.',
    '2026-03-15T00:00:00Z',
    '2026-03-15T00:00:00Z'
  );

INSERT OR REPLACE INTO offers
  (offer_id, merchant_slug, title, summary, active_from, valid_through, offer_type, terms_text, priority, public_proof_url, offer_code, status, vertical_metadata_json, created_at, updated_at)
VALUES
  (
    'offer_sample',
    'sample-roaster',
    '10% off first order',
    'First-time buyers get 10% off selected coffees.',
    '2026-03-01T00:00:00Z',
    '2026-04-15T23:59:59Z',
    'discount_code',
    'Valid for first order only.',
    100,
    NULL,
    'HELLOLOBSTER',
    'active',
    '{}',
    '2026-03-15T00:00:00Z',
    '2026-03-15T00:00:00Z'
  );

INSERT OR REPLACE INTO offer_countries (offer_id, country_code)
VALUES
  ('offer_sample', 'US'),
  ('offer_sample', 'CA');

