# Analytics Engine Metrics

LobsterBazaar writes privacy-first usage metrics to the shared Workers Analytics Engine dataset `lobsterbazaar_metrics`.

The dataset is shared across verticals. Sampling is keyed by `vertical_id` when available, otherwise `deploy_id`.

## Schema

### Blobs

- `blob1`: `event_name`
- `blob2`: `deploy_id`
- `blob3`: `vertical_id`
- `blob4`: `route_id`
- `blob5`: `http_method`
- `blob6`: `outcome`
- `blob7`: `status_class`
- `blob8`: `actor_role`
- `blob9`: `merchant_slug`
- `blob10`: `country_code`

### Doubles

- `double1`: `count`
- `double2`: `duration_ms`
- `double3`: `http_status`
- `double4`: `merchant_count_snapshot`
- `double5`: `active_offer_count_snapshot`
- `double6`: `claimed_merchant_count_snapshot`
- `double7`: `country_count_snapshot`

## Event names

- `landing_view`
- `skill_view`
- `countries_index_view`
- `country_view`
- `offers_view`
- `merchant_connect_view`
- `claw_register_success`
- `claw_register_failure`
- `materialize_success`
- `materialize_failure`

## Example queries

### Skill views by day and vertical

```sql
SELECT
  DATE_TRUNC('day', timestamp) AS day,
  blob3 AS vertical_id,
  SUM(double1) AS skill_views
FROM lobsterbazaar_metrics
WHERE blob1 = 'skill_view'
GROUP BY day, vertical_id
ORDER BY day DESC, vertical_id ASC
```

### Registration funnel by vertical

```sql
SELECT
  blob3 AS vertical_id,
  SUM(CASE WHEN blob1 = 'skill_view' THEN double1 ELSE 0 END) AS skill_views,
  SUM(CASE WHEN blob1 = 'claw_register_success' THEN double1 ELSE 0 END) AS successful_registrations
FROM lobsterbazaar_metrics
WHERE blob1 IN ('skill_view', 'claw_register_success')
GROUP BY vertical_id
ORDER BY successful_registrations DESC
```

### Merchant connect requests

```sql
SELECT
  blob3 AS vertical_id,
  blob9 AS merchant_slug,
  SUM(double1) AS connect_requests
FROM lobsterbazaar_metrics
WHERE blob1 = 'merchant_connect_view'
GROUP BY vertical_id, merchant_slug
ORDER BY connect_requests DESC
LIMIT 50
```

### Country demand

```sql
SELECT
  blob3 AS vertical_id,
  blob10 AS country_code,
  SUM(double1) AS requests
FROM lobsterbazaar_metrics
WHERE blob1 IN ('country_view', 'offers_view')
GROUP BY vertical_id, country_code
ORDER BY requests DESC
```

### Materialize health and inventory snapshots

```sql
SELECT
  timestamp,
  blob2 AS deploy_id,
  blob3 AS vertical_id,
  blob6 AS outcome,
  double2 AS duration_ms,
  double4 AS merchant_count,
  double5 AS active_offer_count,
  double6 AS claimed_merchant_count,
  double7 AS country_count
FROM lobsterbazaar_metrics
WHERE blob1 IN ('materialize_success', 'materialize_failure')
ORDER BY timestamp DESC
LIMIT 200
```

## Privacy

The dataset intentionally excludes:

- client IPs
- user agents
- raw URLs and query strings
- request bodies
- display names
- API keys
- merchant store URLs
