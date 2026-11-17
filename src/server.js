
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
require("dotenv").config();

const pool = require("./config/db");
const authRoutes = require("./routes/authRoutes");

const app = express();
const transactionRoutes = require("./routes/transactionRoutes");
const statsRoutes = require("./routes/statsRoutes");
const analyticsRoutes = require("./routes/analyticsRoutes");
const predictionRoutes = require("./routes/predictionRoutes");

// Security middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "10kb" }));

// 1. Backend health check
app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Watermark Backend is running!",
  });
});

// 2. Supabase database health check
app.get("/health/db", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT NOW() AS database_time"
    );

    res.status(200).json({
      success: true,
      message: "Supabase database connected successfully!",
      databaseTime: result.rows[0].database_time,
    });
  } catch (error) {
    console.error("Database check failed:", error.message);

    res.status(500).json({
      success: false,
      message: "Database connection failed",
    });
  }
});

// 3. Authentication routes
app.use("/auth", authRoutes);
app.use("/transactions", transactionRoutes);
app.use("/stats", statsRoutes);
app.use("/analytics", analyticsRoutes);
app.use("/predictions", predictionRoutes);

// 4. Handle unknown routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "API route not found!",
  });
});

// 5. Start server
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log("----------------------------------");
  console.log(" WATERMARK BACKEND SERVER");
  console.log("----------------------------------");
  console.log(`Server running on port ${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
  console.log(`Database: http://localhost:${PORT}/health/db`);
  console.log("----------------------------------");
});
