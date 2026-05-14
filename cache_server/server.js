const os = require("os");
const express = require("express");
const fs = require("fs-extra");
const { PORT, BASE_DIR } = require("./config");
const routes = require("./routes");
const { startSpeedCalculationLoop } = require("./services/progress");

// Ensure base dir exists
fs.ensureDirSync(BASE_DIR);

const { getLocalIp } = require("./utils/network");
const LOCAL_IP = getLocalIp();

// ANSI Colors
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m"
};

const app = express();

// Basic CORS
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
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
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n${colors.cyan}${"=".repeat(50)}${colors.reset}`);
  console.log(`${colors.bright}${colors.green}🚀 Cache Server is running!${colors.reset}`);
  console.log(`${colors.yellow}🌐 URL:  ${colors.reset}http://${LOCAL_IP}:${PORT}`);
  console.log(`${colors.cyan}${"=".repeat(50)}${colors.reset}\n`);
});
