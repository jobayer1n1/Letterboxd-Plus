const express = require("express");
const fs = require("fs-extra");
const { PORT, BASE_DIR } = require("./config");
const routes = require("./routes");
const { startSpeedCalculationLoop } = require("./services/progress");

// Ensure base dir exists
fs.ensureDirSync(BASE_DIR);

const app = express();

// Basic CORS
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(express.json());

// Main Routes
app.use("/", routes);

// Start speed calculator loop
startSpeedCalculationLoop();

// Start server
app.listen(PORT, () => {
  console.log("Cache server running on http://localhost:" + PORT);
});