
const pool = require("../config/db");

function percentageChange(current, previous) {
  if (previous === 0) {
    return current === 0 ? 0 : 100;
  }

  return Number(
    (((current - previous) / previous) * 100).toFixed(2)
  );
}

exports.getStats = async (req, res) => {
  try {
    const range = Number(req.query.range || 30);

    if (![7, 30, 90].includes(range)) {
      return res.status(400).json({
        success: false,
        message: "Range must be 7, 30 or 90 days.",
      });
    }

    // Latest prediction for each transaction
    const cte = `
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
          t.transaction_timestamp,
          p.probability,
          p.risk,
          p.decision
        FROM transactions t
        LEFT JOIN latest_predictions p
          ON p.transaction_id = t.id
      )
    `;

    // Current period and previous period statistics
    const statsQuery = `
      ${cte}
      SELECT
        COUNT(*) FILTER (
          WHERE transaction_timestamp >= NOW() - ($1 * INTERVAL '1 day')
        )::int AS current_total,

        COUNT(*) FILTER (
          WHERE transaction_timestamp >= NOW() - ($1 * INTERVAL '1 day')
          AND decision = 'Block'
        )::int AS current_flagged,

        COALESCE(SUM(amount) FILTER (
          WHERE transaction_timestamp >= NOW() - ($1 * INTERVAL '1 day')
          AND decision = 'Block'
        ), 0) AS current_held,

        COUNT(*) FILTER (
          WHERE transaction_timestamp >= NOW() - ($1 * INTERVAL '2 days')
          AND transaction_timestamp < NOW() - ($1 * INTERVAL '1 day')
        )::int AS previous_total,

        COUNT(*) FILTER (
          WHERE transaction_timestamp >= NOW() - ($1 * INTERVAL '2 days')
          AND transaction_timestamp < NOW() - ($1 * INTERVAL '1 day')
          AND decision = 'Block'
        )::int AS previous_flagged,

        COALESCE(SUM(amount) FILTER (
          WHERE transaction_timestamp >= NOW() - ($1 * INTERVAL '2 days')
          AND transaction_timestamp < NOW() - ($1 * INTERVAL '1 day')
          AND decision = 'Block'
        ), 0) AS previous_held

      FROM enriched
      WHERE transaction_timestamp >= NOW() - ($1 * 2 * INTERVAL '1 day')
    `;

    // Risk distribution
    const riskQuery = `
      ${cte},
      risk_names AS (
        SELECT unnest(ARRAY['Low', 'Medium', 'High']) AS name
      )
      SELECT
        r.name,
        COUNT(e.id)::int AS value
      FROM risk_names r
      LEFT JOIN enriched e
        ON e.risk = r.name
        AND e.transaction_timestamp >= NOW() - ($1 * INTERVAL '1 day')
      GROUP BY r.name
      ORDER BY
        CASE r.name
          WHEN 'Low' THEN 1
          WHEN 'Medium' THEN 2
          WHEN 'High' THEN 3
        END
    `;

    // Daily transaction trend
    const trendQuery = `
      ${cte},
      days AS (
        SELECT generate_series(
          CURRENT_DATE - ($1 - 1),
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

    const [statsResult, riskResult, trendResult] =
      await Promise.all([
        pool.query(statsQuery, [range]),
        pool.query(riskQuery, [range]),
        pool.query(trendQuery, [range]),
      ]);

    const row = statsResult.rows[0];

    const currentTotal = row.current_total;
    const currentFlagged = row.current_flagged;
    const previousTotal = row.previous_total;
    const previousFlagged = row.previous_flagged;

    const currentRate = currentTotal
      ? Number(((currentFlagged / currentTotal) * 100).toFixed(2))
      : 0;

    const previousRate = previousTotal
      ? Number(((previousFlagged / previousTotal) * 100).toFixed(2))
      : 0;

    res.status(200).json({
      total_transactions: currentTotal,
      fraud_detected: currentFlagged,
      fraud_rate: currentRate,
      amount_held: Number(row.current_held),

      deltas: {
        total: percentageChange(currentTotal, previousTotal),
        flagged: percentageChange(currentFlagged, previousFlagged),
        rate: Number((currentRate - previousRate).toFixed(2)),
        held: percentageChange(
          Number(row.current_held),
          Number(row.previous_held)
        ),
      },

      risk_distribution: riskResult.rows,
      trend: trendResult.rows,
    });
  } catch (error) {
    console.error("Dashboard stats error:", error.message);

    res.status(500).json({
      success: false,
      message: "Unable to fetch dashboard statistics.",
    });
  }
};
