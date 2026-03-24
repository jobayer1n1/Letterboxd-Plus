const fs = require("fs-extra");
const path = require("path");
const { Readable } = require("stream");
const activeStreams = require("../state");
const { getVideoDir, metaPath } = require("../utils/paths");
const { updateProgress } = require("./progress");
const fetch = require("../utils/fetcher");

async function startBackgroundDownload(tmdbId) {
  // Gracefully halt all other downloads BEFORE starting this one
  for (const id in activeStreams) {
    if (id !== tmdbId && activeStreams[id].downloading) {
      console.log(`[INFO] Halting background caching for TMDB ${id} to prioritize ${tmdbId}`);
      activeStreams[id].downloading = false;
    }
  }

  const state = activeStreams[tmdbId];
  if (state.downloading) return;

  console.log(`[INFO] Starting background workers for TMDB ${tmdbId}`);
  state.downloading = true;
  if (state.backgroundIndex === undefined) state.backgroundIndex = 0;

  const MAX_PARALLEL = 3;

  async function worker() {
    while (state.downloading) {
      let found = -1;
      const total = state.meta.totalSegments;
      
      for (let i = 0; i < total; i++) {
        const checkIdx = (state.backgroundIndex + i) % total;
        if (!state.meta.segments[checkIdx].downloaded) {
          found = checkIdx;
          state.backgroundIndex = (checkIdx + 1) % total;
          break;
        }
      }

      if (found === -1) break;

      try {
        await downloadSegmentWorker(tmdbId, found);
      } catch (e) {
        console.error(`[ERROR] [${tmdbId}] Worker error for segment ${found}:`, e.message);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  await Promise.all(Array(MAX_PARALLEL).fill(0).map(() => worker()));
  
  if (state.downloading) {
    console.log(`[SYS] Background caching completed for TMDB ${tmdbId}`);
    state.downloading = false;
  }
}

async function downloadSegmentWorker(tmdbId, id) {
  const state = activeStreams[tmdbId];
  const seg = state.meta.segments[id];
  const filePath = path.join(getVideoDir(tmdbId), seg.file);

  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (await fs.pathExists(filePath)) {
        seg.downloaded = true;
        return;
      }

      const res = await fetch(seg.url, { headers: state.headers });
      if (!res.ok) {
          const errBody = await res.text().catch(() => "N/A");
          throw new Error(`HTTP ${res.status}: ${errBody.slice(0, 100)}`);
      }

      const nodeStream = res.body.on ? res.body : Readable.fromWeb(res.body);
      const fileStream = fs.createWriteStream(filePath);

      nodeStream.on("data", (chunk) => {
          state.totalDownloaded += chunk.length;
      });

      nodeStream.pipe(fileStream);

      await new Promise((resolve, reject) => {
          fileStream.on('finish', resolve);
          nodeStream.on('error', reject);
          fileStream.on('error', reject);
      });

      seg.downloaded = true;
      await fs.writeJson(metaPath(tmdbId), state.meta);
      updateProgress(tmdbId);
      return;
    } catch (e) {
      console.error(`[ERROR] [${tmdbId}] Background attempt ${attempt} failed for segment ${id}:`, e.message);
      if (attempt === MAX_RETRIES) throw e;
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
}

module.exports = {
  startBackgroundDownload
};
