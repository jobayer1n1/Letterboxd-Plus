const fs = require("fs-extra");
const path = require("path");
const { Readable } = require("stream");
const activeStreams = require("../state");
const { getVideoDir, metaPath } = require("../utils/paths");
const { updateProgress } = require("./progress");
const fetch = require("../utils/fetcher");

const c = {
  reset:   "\x1b[0m",
  bright:  "\x1b[1m",
  dim:     "\x1b[2m",
  red:     "\x1b[31m",
  green:   "\x1b[32m",
  yellow:  "\x1b[33m",
  blue:    "\x1b[34m",
  magenta: "\x1b[35m",
  cyan:    "\x1b[36m",
  white:   "\x1b[37m",
};



async function startBackgroundDownload(tmdbId) {
  // Gracefully halt all other downloads BEFORE starting this one
  for (const id in activeStreams) {
    if (id !== tmdbId && activeStreams[id].downloading) {
      const haltedTitle = activeStreams[id].meta?.title;
      const haltedLabel = haltedTitle && haltedTitle !== "Unknown Movie" ? haltedTitle : `TMDB ${id}`;
      console.log(`${c.yellow}[SYS]${c.reset}  Pausing ${c.dim}${haltedLabel}${c.reset} — prioritizing ${c.bright}TMDB ${tmdbId}${c.reset}`);
      activeStreams[id].downloading = false;
    }
  }

  const state = activeStreams[tmdbId];
  if (state.downloading) return;

  const movieLabel = state.meta?.title && state.meta.title !== "Unknown Movie"
    ? state.meta.title
    : `TMDB ${tmdbId}`;

  console.log(`${c.cyan}[SYS]${c.reset}  Start background workers — ${c.bright}${movieLabel}${c.reset} ${c.dim}(3 parallel)${c.reset}`);
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
        console.error(`${c.magenta}[ERROR]${c.reset} ${c.dim}TMDB ${tmdbId}${c.reset} — worker error for seg ${found}: ${e.message}`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  await Promise.all(Array(MAX_PARALLEL).fill(0).map(() => worker()));

  // ── Integrity verification pass ─────────────────────────────────────
  // After all workers finish, physically verify every segment exists on
  // disk. Re-download any that are missing (can happen due to race
  // conditions between background caching and concurrent playback).
  if (state.downloading) {
    const dir = getVideoDir(tmdbId);
    let missing = 0;

    for (let i = 0; i < state.meta.segments.length; i++) {
      const seg = state.meta.segments[i];
      const exists = await fs.pathExists(path.join(dir, seg.file));
      if (!exists) {
        seg.downloaded = false;
        missing++;
      }
    }

    if (missing > 0) {
      console.log(`${c.yellow}[SYS]${c.reset}  Integrity check — ${c.bright}${missing} segment(s)${c.reset} missing on disk. Re-downloading...`);
      // Reset index so workers scan from the start
      state.backgroundIndex = 0;
      await Promise.all(Array(MAX_PARALLEL).fill(0).map(() => worker()));
    }
  }
  // ────────────────────────────────────────────────────────────────────

  if (state.downloading) {
    console.log(`${c.green}[SYS]${c.reset}  ✔  Cache complete — ${c.bright}${movieLabel}${c.reset}`);
    state.downloading = false;
    updateProgress(tmdbId);
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

      // Verify file was actually written and has minimum size
      const stat = await fs.stat(filePath);
      if (stat.size < 100) {
        throw new Error(`Segment too small (${stat.size} bytes) — likely incomplete`);
      }

      seg.downloaded = true;
      await fs.writeJson(metaPath(tmdbId), state.meta);
      updateProgress(tmdbId);
      return;
    } catch (e) {
      console.error(`${c.magenta}[ERROR]${c.reset} ${c.dim}TMDB ${tmdbId}${c.reset} — attempt ${attempt} failed for seg ${id}: ${e.message}`);
      if (attempt === MAX_RETRIES) throw e;
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
}

module.exports = {
  startBackgroundDownload
};
