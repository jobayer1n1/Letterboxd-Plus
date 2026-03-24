// Use native fetch if available, otherwise fall back to node-fetch
const fetch = global.fetch || (() => {
  try {
    return require("node-fetch");
  } catch (e) {
    console.error("Failed to load node-fetch. Please ensure it is installed or use Node 18+.");
    return null;
  }
})();

module.exports = fetch;
