
const express = require("express");
const router = express.Router();

const { createPrediction } = require(
  "../controllers/predictionController"
);

const { authenticate } = require(
  "../middleware/authMiddleware"
);

router.post("/", authenticate, createPrediction);

module.exports = router;
