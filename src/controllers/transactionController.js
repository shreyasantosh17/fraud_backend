
const pool = require("../config/db");

// Allowed sorting fields
const SORT_FIELDS = {
  timestamp: "t.transaction_timestamp",
  amount: "t.amount",
  probability: "latest.probability",
  id: "t.id",
};

// GET /transactions
exports.getTransactions = async (req, res) => {
  try {
    const {
      search = "",
      risk = "all",
      sort = "timestamp",
      page = "1",
      pageSize = "10",
    } = req.query;

    const currentPage = Math.max(1, parseInt(page, 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(pageSize, 10) || 10)
    );
    const offset = (currentPage - 1) * limit;

    const sortColumn = SORT_FIELDS[sort] || SORT_FIELDS.timestamp;

    const conditions = [];
    const values = [];

    if (search.trim()) {
      values.push(`%${search.trim()}%`);
      const index = values.length;

      conditions.push(`
        (
          t.id ILIKE $${index}
          OR t.product ILIKE $${index}
          OR t.network ILIKE $${index}
          OR t.email_domain ILIKE $${index}
        )
      `);
    }

    if (["Low", "Medium", "High"].includes(risk)) {
      values.push(risk);
      conditions.push(`latest.risk = $${values.length}`);
    }

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM transactions t
      LEFT JOIN LATERAL (
        SELECT p.risk
        FROM predictions p
        WHERE p.transaction_id = t.id
        ORDER BY p.created_at DESC
        LIMIT 1
      ) latest ON TRUE
      ${whereClause}
    `;

    const countResult = await pool.query(countQuery, values);

    const dataQuery = `
      SELECT
        t.id,
        t.transaction_timestamp AS timestamp,
        t.amount,
        t.product,
        t.network,
        t.card_type AS "cardType",
        t.email_domain AS email,
        t.device,
        t.distance_km AS "distanceKm",
        t.txns_24h AS "txns24h",
        t.hours_since_last AS "hoursSinceLast",
        latest.probability,
        latest.risk,
        latest.decision,
        latest.threshold,
        latest.base_value AS "base_value",
        COALESCE(latest.shap, '[]'::json) AS shap
      FROM transactions t
      LEFT JOIN LATERAL (
        SELECT
          p.probability,
          p.risk,
          p.decision,
          p.threshold,
          p.base_value,
          (
            SELECT json_agg(
              json_build_object(
                'key', s.feature_key,
                'feature', s.feature_name,
                'display', s.feature_display,
                'impact', s.impact
              )
              ORDER BY ABS(s.impact) DESC
            )
            FROM shap_explanations s
            WHERE s.prediction_id = p.id
          ) AS shap
        FROM predictions p
        WHERE p.transaction_id = t.id
        ORDER BY p.created_at DESC
        LIMIT 1
      ) latest ON TRUE
      ${whereClause}
      ORDER BY ${sortColumn} DESC NULLS LAST
      LIMIT $${values.length + 1}
      OFFSET $${values.length + 2}
    `;

    const dataResult = await pool.query(dataQuery, [
      ...values,
      limit,
      offset,
    ]);

    res.status(200).json({
      items: dataResult.rows,
      total: countResult.rows[0].total,
      page: currentPage,
      pageSize: limit,
    });
  } catch (error) {
    console.error("Get transactions error:", error.message);

    res.status(500).json({
      success: false,
      message: "Unable to fetch transactions.",
    });
  }
};

// GET /transactions/:id
exports.getTransactionById = async (req, res) => {
  try {
    const { id } = req.params;

    const query = `
      SELECT
        t.id,
        t.transaction_timestamp AS timestamp,
        t.amount,
        t.product,
        t.network,
        t.card_type AS "cardType",
        t.email_domain AS email,
        t.device,
        t.distance_km AS "distanceKm",
        t.txns_24h AS "txns24h",
        t.hours_since_last AS "hoursSinceLast",
        latest.probability,
        latest.risk,
        latest.decision,
        latest.threshold,
        latest.base_value AS "base_value",
        COALESCE(latest.shap, '[]'::json) AS shap
      FROM transactions t
      LEFT JOIN LATERAL (
        SELECT
          p.probability,
          p.risk,
          p.decision,
          p.threshold,
          p.base_value,
          (
            SELECT json_agg(
              json_build_object(
                'key', s.feature_key,
                'feature', s.feature_name,
                'display', s.feature_display,
                'impact', s.impact
              )
              ORDER BY ABS(s.impact) DESC
            )
            FROM shap_explanations s
            WHERE s.prediction_id = p.id
          ) AS shap
        FROM predictions p
        WHERE p.transaction_id = t.id
        ORDER BY p.created_at DESC
        LIMIT 1
      ) latest ON TRUE
      WHERE t.id = $1
    `;

    const result = await pool.query(query, [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found.",
      });
    }

    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error("Get transaction error:", error.message);

    res.status(500).json({
      success: false,
      message: "Unable to fetch transaction.",
    });
  }
};
