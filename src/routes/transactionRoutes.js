
const express = require("express");
const router = express.Router();

const {
  getTransactions,
  getTransactionById,
} = require("../controllers/transactionController");

const {
  authenticate,
} = require("../middleware/authMiddleware");

// All transaction routes require login
router.use(authenticate);

router.get("/", getTransactions);
router.get("/:id", getTransactionById);

module.exports = router;
