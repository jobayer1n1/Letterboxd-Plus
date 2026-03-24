const path = require("path");
const os = require("os");

const PORT = 6769;

const DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept": "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Origin": "https://vidfast.pro",
  "Referer": "https://vidfast.pro/"
};

const BASE_DIR = path.join(os.tmpdir(), "letterboxd-plus");

module.exports = {
  PORT,
  DEFAULT_HEADERS,
  BASE_DIR
};
