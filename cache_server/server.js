const express = require("express");
const fs = require("fs-extra");
const path = require("path");
const os = require("os");
const { Parser } = require("m3u8-parser");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");

// Use native fetch if available, otherwise fall back to node-fetch
const fetch = global.fetch || (() => {
  try {
    return require("node-fetch");
  } catch (e) {
    console.error("Failed to load node-fetch. Please ensure it is installed or use Node 18+.");
    return null;
  }
})();

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

const PORT = 6769;

const DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept": "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Origin": "https://vidfast.pro",
  "Referer": "https://vidfast.pro/"
};

// Base cache dir
const BASE_DIR = path.join(os.tmpdir(), "letterboxd-plus");
fs.ensureDirSync(BASE_DIR);

// In-memory state
const activeStreams = {}; // tmdbId -> state

// ----------- UTIL -----------

function getVideoDir(tmdbId) {
  return path.join(BASE_DIR, tmdbId, "stream");
}

function getSubtitleDir(tmdbId) {
  return path.join(BASE_DIR, tmdbId, "subtitles");
}

function metaPath(tmdbId) {
  return path.join(getVideoDir(tmdbId), "meta.json");
}

function progressPath(tmdbId) {
  return path.join(getVideoDir(tmdbId), "progress.json");
}

// ----------- LOAD STREAM -----------

app.post("/load", async (req, res) => {
  let { tmdbId, m3u8Url, m3u8, subtitle_link } = req.body;
  let headers = { ...DEFAULT_HEADERS, ...(req.body.headers || {}) };

  if (!tmdbId || (!m3u8Url && !m3u8)) {
    return res.status(400).json({ error: "Missing tmdbId or stream source" });
  }

  // 1. Handle Subtitle First (Priority)
  console.log(`[${tmdbId}] Processing Subtitles First...`);
  if (subtitle_link) {
    try {
        const subDir = getSubtitleDir(tmdbId);
        await fs.ensureDir(subDir);
        const url = new URL(subtitle_link);
        const fileName = path.basename(url.pathname) || "subtitle.vtt";
        const filePath = path.join(subDir, fileName);

        if (!(await fs.pathExists(filePath))) {
            console.log(`[${tmdbId}] Downloading priority subtitle: ${subtitle_link}`);
            const resp = await fetch(subtitle_link, { headers });
            if (resp.ok) {
                const buffer = Buffer.from(await resp.arrayBuffer());
                await fs.writeFile(filePath, buffer);
            }
        }
    } catch(e) {
        console.error(`[${tmdbId}] Priority subtitle failure:`, e.message);
    }
  }

  // Auto-derive Referer if not specifically provided
  if (!req.body.headers || !req.body.headers.Referer) {
    try {
        if (m3u8Url) {
            const urlObj = new URL(m3u8Url);
            if (!m3u8Url.includes('10018.workers.dev')) {
                headers.Referer = urlObj.origin + "/";
                headers.Origin = urlObj.origin;
            }
        }
    } catch(e) {}
  }

  const dir = getVideoDir(tmdbId);
  await fs.ensureDir(dir);

  let meta;
  if (activeStreams[tmdbId]) {
    meta = activeStreams[tmdbId].meta;
    activeStreams[tmdbId].headers = headers;
  } else if (await fs.pathExists(metaPath(tmdbId))) {
    meta = await fs.readJson(metaPath(tmdbId));
    // Re-verify segments on disk
    for (let seg of meta.segments) {
      const filePath = path.join(dir, seg.file);
      seg.downloaded = await fs.pathExists(filePath);
    }
    
    // Migration: If legacy meta lacks duration, force re-fetch
    if (meta && meta.segments.length > 0 && typeof meta.segments[0].duration === 'undefined') {
        console.log(`[${tmdbId}] Legacy meta detected (no durations). Forcing re-parse...`);
        meta = null;
    }
  }

  if (!meta) {
    console.log(`Starting fresh cache for ${tmdbId}`);
    
    if (m3u8Url && !m3u8) {
      try {
        const resp = await fetch(m3u8Url, { headers });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        m3u8 = await resp.text();
      } catch (e) {
        return res.status(500).json({ error: "Failed to fetch m3u8: " + e.message });
      }
    }

    if (m3u8 && m3u8.includes("#EXT-X-STREAM-INF")) {
      console.log("Master playlist detected, picking best variant...");
      const parser = new Parser();
      parser.push(m3u8);
      parser.end();

      const variants = parser.manifest.playlists;
      if (variants && variants.length > 0) {
        variants.sort((a, b) => (b.attributes.BANDWIDTH || 0) - (a.attributes.BANDWIDTH || 0));
        const bestVariant = variants[0];
        let variantUrl = bestVariant.uri;
        if (!variantUrl.startsWith("http") && m3u8Url) {
            variantUrl = new URL(variantUrl, m3u8Url).href;
        }
        
        console.log(`Picking variant: ${variantUrl}`);
        m3u8Url = variantUrl;
        try {
          const vResp = await fetch(variantUrl, { headers });
          if (!vResp.ok) throw new Error(`HTTP ${vResp.status}`);
          m3u8 = await vResp.text();
        } catch(e) {
          return res.status(500).json({ error: "Failed to fetch variant: " + e.message });
        }
      }
    }

    if (!m3u8) return res.status(400).json({ error: "No m3u8 content" });

    const baseUrl = m3u8Url ? (m3u8Url.match(/(https?:\/\/.*\/)/)?.[1] || "") : "";

    // Extract Keys
    const keys = [];
    const keyRegex = /#EXT-X-KEY:METHOD=([^,]+),URI="([^"]+)"/g;
    let keyMatch;
    while ((keyMatch = keyRegex.exec(m3u8)) !== null) {
      let keyUri = keyMatch[2];
      if (!keyUri.startsWith("http") && m3u8Url) {
          keyUri = new URL(keyUri, m3u8Url).href;
      }
      keys.push({ method: keyMatch[1], uri: keyUri });
    }

    const parser = new Parser();
    parser.push(m3u8);
    parser.end();

    meta = {
      segments: parser.manifest.segments.map((seg, i) => {
        try {
          return {
            url: new URL(seg.uri, m3u8Url).href,
            file: `${i}.ts`,
            duration: seg.duration || 10, // Store actual duration
            downloaded: false
          };
        } catch (e) {
          return {
            url: seg.uri,
            file: `${i}.ts`,
            duration: seg.duration || 10,
            downloaded: false
          };
        }
      }),
      totalSegments: parser.manifest.segments.length,
      keys: keys.length > 0 ? keys : null
    };
    
    console.log(`[${tmdbId}] Manifest parsed. First 3 segments:`);
    meta.segments.slice(0, 3).forEach(s => console.log(`  - ${s.url}`));

    await fs.writeJson(metaPath(tmdbId), meta);
  }


  activeStreams[tmdbId] = {
    meta,
    headers,
    totalDownloaded: 0,
    downloading: false,
    speed: 0,
    lastBytes: 0,
    startTime: Date.now()
  };

  startBackgroundDownload(tmdbId);

  res.json({
    message: "Caching started",
    streamUrl: `http://localhost:${PORT}/stream/${tmdbId}.m3u8`
  });
});

// ----------- SERVE M3U8 -----------

app.get("/stream/:tmdbId.m3u8", async (req, res) => {
  const { tmdbId } = req.params;
  const state = activeStreams[tmdbId];

  if (!state) return res.status(404).send("Not loaded");

  const targetDuration = Math.ceil(state.meta.segments.reduce((max, s) => Math.max(max, s.duration), 0)) || 10;
  let m3u8 = `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:${targetDuration}\n#EXT-X-MEDIA-SEQUENCE:0\n`;

  // Proxy Keys
  if (state.meta.keys) {
    state.meta.keys.forEach((key, i) => {
      m3u8 += `#EXT-X-KEY:METHOD=${key.method},URI="http://localhost:${PORT}/key/${tmdbId}/${i}"\n`;
    });
  }

  state.meta.segments.forEach((seg, i) => {
    m3u8 += `#EXTINF:${seg.duration.toFixed(3)},\nhttp://localhost:${PORT}/seg/${tmdbId}/${seg.file}\n`;
  });

  m3u8 += "#EXT-X-ENDLIST";

  res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
  res.send(m3u8);
});

// ----------- SERVE KEY -----------

app.get("/key/:tmdbId/:keyId", async (req, res) => {
  const { tmdbId, keyId } = req.params;
  const state = activeStreams[tmdbId];

  if (!state || !state.meta.keys || !state.meta.keys[keyId]) {
    return res.status(404).send("Key not found");
  }

  try {
    const keyUrl = state.meta.keys[keyId].uri;
    const resp = await fetch(keyUrl, { headers: state.headers });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    
    const buffer = Buffer.from(await resp.arrayBuffer());
    res.setHeader("Content-Type", "application/octet-stream");
    res.send(buffer);
  } catch (e) {
    res.status(500).send(e.message);
  }
});

// ----------- SERVE SEGMENT -----------

app.get("/seg/:tmdbId/:id.ts", async (req, res) => {
  const { tmdbId, id } = req.params;
  const state = activeStreams[tmdbId];

  if (!state) return res.status(404).send("No stream");

  const seg = state.meta.segments[id];
  const filePath = path.join(getVideoDir(tmdbId), seg.file);

  res.setHeader("Content-Type", "video/mp2t"); // Force correct MIME type

  // If cached
  if (await fs.pathExists(filePath)) {
    return fs.createReadStream(filePath).pipe(res);
  }

  // Seek Priority: Jump background worker to this section
  state.backgroundIndex = parseInt(id);

  // Fetch and stream + save
  try {
    const response = await fetch(seg.url, { headers: state.headers });
    if (!response.ok) {
        return res.status(response.status).send(`Segment fetch failed: ${response.status}`);
    }

    const nodeStream = response.body.on ? response.body : Readable.fromWeb(response.body);
    const fileStream = fs.createWriteStream(filePath);
    
    nodeStream.on("data", (chunk) => {
        state.totalDownloaded += chunk.length;
    });

    // Pipe to both disk and client
    nodeStream.pipe(fileStream);
    nodeStream.pipe(res);

    await new Promise((resolve, reject) => {
        fileStream.on('finish', resolve);
        nodeStream.on('error', reject);
        fileStream.on('error', reject);
    });

    seg.downloaded = true;
    await fs.writeJson(metaPath(tmdbId), state.meta);
    updateProgress(tmdbId);
  } catch(e) {
    console.error(`[${tmdbId}] Segment pipe error for ${id}:`, e.message);
    if (!res.headersSent) res.status(500).send(e.message);
  }
});

// ----------- BACKGROUND DOWNLOAD -----------

async function startBackgroundDownload(tmdbId) {
  const state = activeStreams[tmdbId];
  if (state.downloading) return;

  state.downloading = true;
  if (state.backgroundIndex === undefined) state.backgroundIndex = 0;

  const MAX_PARALLEL = 3;

  async function worker() {
    while (true) {
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
        await downloadSegment(tmdbId, found);
      } catch (e) {
        console.error(`[${tmdbId}] Background worker error for segment ${found}:`, e.message);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  // Start workers and wait for all to complete
  await Promise.all(Array(MAX_PARALLEL).fill(0).map(() => worker()));
  state.downloading = false;
}

async function downloadSegment(tmdbId, id) {
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
      console.error(`[${tmdbId}] Background attempt ${attempt} failed for segment ${id}:`, e.message);
      if (attempt === MAX_RETRIES) throw e;
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
}

// ----------- PROGRESS -----------

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

// Speed calculation loop
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

app.get("/progress/:tmdbId", async (req, res) => {
  const file = progressPath(req.params.tmdbId);

  if (!(await fs.pathExists(file))) {
    return res.json({ percent: 0 });
  }

  res.json(await fs.readJson(file));
});

// ----------- SUBTITLES -----------

app.post("/subtitle", async (req, res) => {
  const { tmdbId, subtitle_link } = req.body;
  if (!tmdbId || !subtitle_link) return res.status(400).send("Missing data");

  const subDir = getSubtitleDir(tmdbId);
  await fs.ensureDir(subDir);

  try {
    const url = new URL(subtitle_link);
    const fileName = path.basename(url.pathname) || "manual.srt";
    const filePath = path.join(subDir, fileName);

    if (await fs.pathExists(filePath)) {
      return res.json({ message: "Already cached", path: filePath });
    }

    const resp = await fetch(subtitle_link, { headers: DEFAULT_HEADERS });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    
    const buffer = Buffer.from(await resp.arrayBuffer());
    await fs.writeFile(filePath, buffer);
    
    res.json({ message: "Subtitle cached", path: filePath });
  } catch (e) {
    console.error("Subtitle cache error:", e.message);
    res.status(500).send(e.message);
  }
});

app.get("/subtitle/:tmdbId", async (req, res) => {
  const { tmdbId } = req.params;
  const subDir = getSubtitleDir(tmdbId);

  if (!(await fs.pathExists(subDir))) {
    return res.json([]);
  }

  const files = await fs.readdir(subDir);
  const subtitles = files.map(file => ({
    label: file,
    url: `http://localhost:${PORT}/sub/${tmdbId}/${file}`
  }));

  res.json(subtitles);
});

app.get("/sub/:tmdbId/:filename", async (req, res) => {
  const { tmdbId, filename } = req.params;
  const filePath = path.join(getSubtitleDir(tmdbId), filename);

  if (!(await fs.pathExists(filePath))) {
    return res.status(404).send("Subtitle not found");
  }

  try {
    let content = await fs.readFile(filePath, "utf8");
    
    // Basic SRT to VTT conversion if needed
    if (!content.trim().startsWith("WEBVTT")) {
        // Fix timestamps (00:00:01,500 -> 00:00:01.500)
        content = content.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
        content = "WEBVTT\n\n" + content;
    }

    res.setHeader("Content-Type", "text/vtt; charset=utf-8");
    res.send(content);
  } catch (e) {
    res.status(500).send(e.message);
  }
});

// ----------- START -----------

app.listen(PORT, () => {
  console.log("Cache server running on http://localhost:" + PORT);
});