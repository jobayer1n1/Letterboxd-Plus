const fs = require("fs-extra");
const activeStreams = require("../state");
const { progressPath } = require("../utils/paths");

async function updateProgress(tmdbId) {
  const state = activeStreams[tmdbId];
  if (!state) return;

  const downloadedCount = state.meta.segments.filter(s => s.downloaded).length;
  const total = state.meta.totalSegments;

  const progress = {
    percent: ((downloadedCount / total) * 100).toFixed(2),
    downloaded: downloadedCount,
    total,
    speed: state.speed.toFixed(2) + " KB/s"
  };

  await fs.writeJson(progressPath(tmdbId), progress);
}

function startSpeedCalculationLoop() {
  setInterval(() => {
    for (let tmdbId in activeStreams) {
      const state = activeStreams[tmdbId];
      if (state.downloading || state.totalDownloaded > state.lastBytes) {
        const delta = state.totalDownloaded - state.lastBytes;
        state.speed = delta / 1024; // KB/s
        state.lastBytes = state.totalDownloaded;
        updateProgress(tmdbId);
      } else {
        state.speed = 0;
      }
    }
  }, 1000);
}

module.exports = {
  updateProgress,
  startSpeedCalculationLoop
};
