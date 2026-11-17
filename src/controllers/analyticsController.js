
const pool = require("../config/db");


const baseCTE = `
  WITH latest_predictions AS (
    SELECT DISTINCT ON (transaction_id)
      transaction_id,
      probability,
      risk,
      decision
    FROM predictions
    ORDER BY transaction_id, created_at DESC
  ),
  enriched AS (
    SELECT
      t.id,
      t.amount,
      t.product,
      t.network,
      t.email_domain,
      t.device,
      t.transaction_timestamp,
      p.probability,
      p.risk,
      p.decision
    FROM transactions t
    LEFT JOIN latest_predictions p
      ON p.transaction_id = t.id
    WHERE t.transaction_timestamp >=
      NOW() - ($1::int * INTERVAL '1 day')
  )
`;


// GET /analytics?range=30
exports.getAnalytics = async (req, res) => {
  try {
    const range = Number.parseInt(req.query.range || "30", 10);

    if (![7, 30, 90].includes(range)) {
  return res.status(400).json({
    success: false,
    message: "Range must be 7, 30 or 90 days.",
  });
}

    // 1. Daily trend
    
const trendQuery = `
  ${baseCTE},
  days AS (
    SELECT generate_series(
      CURRENT_DATE - ($1::int - 1),
      CURRENT_DATE,
      INTERVAL '1 day'
    )::date AS day
  )
  SELECT
    TO_CHAR(d.day, 'Mon DD') AS label,
    COUNT(e.id)::int AS total,
    COUNT(e.id) FILTER (
      WHERE e.decision = 'Block'
    )::int AS flagged,
    CASE
      WHEN COUNT(e.id) = 0 THEN 0
      ELSE ROUND(
        COUNT(e.id) FILTER (
          WHERE e.decision = 'Block'
        ) * 100.0 / COUNT(e.id),
        2
      )
    END AS rate
  FROM days d
  LEFT JOIN enriched e
    ON e.transaction_timestamp >= d.day
    AND e.transaction_timestamp < d.day + INTERVAL '1 day'
  GROUP BY d.day
  ORDER BY d.day
`;


    // 2. Hourly activity
    const hourlyQuery = `
      ${baseCTE}
      SELECT
        LPAD(EXTRACT(HOUR FROM transaction_timestamp)::int::text, 2, '0')
          || ':00' AS label,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (
          WHERE decision = 'Block'
        )::int AS flagged
      FROM enriched
      GROUP BY EXTRACT(HOUR FROM transaction_timestamp)
      ORDER BY EXTRACT(HOUR FROM transaction_timestamp)
    `;

    // 3. Product analysis
    const productsQuery = `
      ${baseCTE}
      SELECT
        COALESCE(product, 'Unknown') AS name,
        COUNT(*)::int AS value,
        COUNT(*) FILTER (
          WHERE decision = 'Block'
        )::int AS flagged
      FROM enriched
      GROUP BY product
      ORDER BY value DESC
    `;

    // 4. Transaction amount bands
    

const amountBandsQuery = `
  ${baseCTE},
  categorized AS (
    SELECT
      CASE
        WHEN amount < 100 THEN 'Under 100'
        WHEN amount < 500 THEN '100-499'
        WHEN amount < 1000 THEN '500-999'
        WHEN amount < 5000 THEN '1000-4999'
        ELSE '5000+'
      END AS name,

      CASE
        WHEN amount < 100 THEN 1
        WHEN amount < 500 THEN 2
        WHEN amount < 1000 THEN 3
        WHEN amount < 5000 THEN 4
        ELSE 5
      END AS sort_order,

      decision
    FROM enriched
  )
  SELECT
    name,
    COUNT(*)::int AS value,
    COUNT(*) FILTER (
      WHERE decision = 'Block'
    )::int AS flagged
  FROM categorized
  GROUP BY name, sort_order
  ORDER BY sort_order
`;



    // 5. Email domain analysis
    const domainsQuery = `
      ${baseCTE}
      SELECT
        COALESCE(email_domain, 'Unknown') AS name,
        COUNT(*)::int AS value,
        COUNT(*) FILTER (
          WHERE decision = 'Block'
        )::int AS flagged
      FROM enriched
      GROUP BY email_domain
      ORDER BY value DESC
      LIMIT 10
    `;

    // 6. Device analysis
    const devicesQuery = `
      ${baseCTE}
      SELECT
        COALESCE(device, 'Unknown') AS name,
        COUNT(*)::int AS value,
        COUNT(*) FILTER (
          WHERE decision = 'Block'
        )::int AS flagged
      FROM enriched
      GROUP BY device
      ORDER BY value DESC
    `;

    const [
      trend,
      hourly,
      products,
      amountBands,
      domains,
      devices,
    ] = await Promise.all([
      pool.query(trendQuery, [range]),
      pool.query(hourlyQuery, [range]),
      pool.query(productsQuery, [range]),
      pool.query(amountBandsQuery, [range]),
      pool.query(domainsQuery, [range]),
      pool.query(devicesQuery, [range]),
    ]);

    return res.status(200).json({
      trend: trend.rows,
      hourly: hourly.rows,
      products: products.rows,
      amount_bands: amountBands.rows,
      domains: domains.rows,
      devices: devices.rows,
    });
  } catch (error) {
    console.error("Analytics error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to fetch analytics.",
    });
  }
};
