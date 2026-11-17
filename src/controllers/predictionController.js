
const pool = require("../config/db");
const { predictFraud } = require("../services/mlService");

exports.createPrediction = async (req, res) => {
  try {
    const { transaction_id, features } = req.body;

    // Validate request
    if (
      !transaction_id ||
      !features ||
      typeof features !== "object" ||
      Array.isArray(features)
    ) {
      return res.status(400).json({
        success: false,
        message: "transaction_id and features are required.",
      });
    }

    // Check transaction exists in Supabase
    const transaction = await pool.query(
      "SELECT id FROM transactions WHERE id = $1",
      [transaction_id]
    );

    if (transaction.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found in database.",
      });
    }

    // Call Python ML API
    const prediction = await predictFraud(
      transaction_id,
      features
    );

    const probability = Number(prediction.risk_score);
    const threshold = Number(prediction.threshold_used);

    if (
      !Number.isFinite(probability) ||
      !Number.isFinite(threshold) ||
      probability < 0 ||
      probability > 1
    ) {
      throw new Error("Invalid prediction returned by ML API.");
    }

    // Initial risk and decision mapping
    const risk = prediction.is_fraud ? "High" : "Low";
    const decision = prediction.is_fraud ? "Block" : "Allow";

    // Save prediction in Supabase
    const result = await pool.query(
      `INSERT INTO predictions
        (transaction_id, probability, risk, decision,
         threshold, model_version)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        transaction_id,
        probability,
        risk,
        decision,
        threshold,
        process.env.ML_MODEL_VERSION || "xgboost-v1",
      ]
    );

    return res.status(201).json({
      success: true,
      message: "Fraud prediction completed and saved.",
      prediction: result.rows[0],
    });

  } catch (error) {
    console.error("Prediction controller error:", error.message);

    return res.status(500).json({
      success: false,
      message: error.message || "Prediction failed.",
    });
  }
};
