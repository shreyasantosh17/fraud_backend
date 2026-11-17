
const axios = require("axios");

const ML_API_URL =
  process.env.ML_API_URL || "http://127.0.0.1:8000";

const mlClient = axios.create({
  baseURL: ML_API_URL,
  timeout: 15000,
  headers: {
    "Content-Type": "application/json",
  },
});

exports.predictFraud = async (transactionId, features) => {
  if (!transactionId || !features || typeof features !== "object") {
    throw new Error("Transaction ID and features are required.");
  }

  try {
    const response = await mlClient.post("/predict", {
      transaction_id: transactionId,
      features,
    });

    return response.data;
  } catch (error) {
    console.error(
      "ML API error:",
      error.response?.data || error.message
    );

    throw new Error(
      error.response?.data?.detail ||
      "Unable to get fraud prediction from ML service."
    );
  }
};
