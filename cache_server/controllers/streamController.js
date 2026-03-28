const fs = require("fs-extra");
const path = require("path");
const { Parser } = require("m3u8-parser");
const { Readable } = require("stream");
const { PORT, DEFAULT_HEADERS, BASE_DIR } = require("../config");
const { getSubtitleDir, getVideoDir, metaPath, progressPath } = require("../utils/paths");
const activeStreams = require("../state");
const fetch = require("../utils/fetcher");
const { startBackgroundDownload } = require("../services/downloader");
const { updateProgress } = require("../services/progress");
const { getBaseUrl } = require("../utils/url");


async function loadStream(req, res) {
  let { tmdbId, m3u8Url, m3u8, subtitle_link } = req.body;
  let headers = { ...DEFAULT_HEADERS, ...(req.body.headers || {}) };
  const baseUrl = getBaseUrl(req);

  if (!tmdbId || (!m3u8Url && !m3u8)) {
    return res.status(400).json({ error: "Missing tmdbId or stream source" });
  }

  // 1. Handle Subtitle First
  console.log(`[INFO] [${tmdbId}] Processing Subtitles...`);
  if (subtitle_link) {
    try {
        const subDir = getSubtitleDir(tmdbId);
        await fs.ensureDir(subDir);
        const url = new URL(subtitle_link);
        const fileName = path.basename(url.pathname) || "subtitle.vtt";
        const filePath = path.join(subDir, fileName);

        if (!(await fs.pathExists(filePath))) {
            console.log(`[INFO] [${tmdbId}] Downloading priority subtitle: ${subtitle_link}`);
            const resp = await fetch(subtitle_link, { headers });
            if (resp.ok) {
                const buffer = Buffer.from(await resp.arrayBuffer());
                await fs.writeFile(filePath, buffer);
            }
        }
    } catch(e) {
        console.error(`[ERROR] [${tmdbId}] Priority subtitle failure:`, e.message);
    }
  }

  // Auto-derive Referer
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
    
    // Migration check
    if (meta && meta.segments.length > 0 && typeof meta.segments[0].duration === 'undefined') {
        console.log(`[INFO] [${tmdbId}] Legacy meta detected. Forcing re-parse...`);
        meta = null;
    }
  }

  if (!meta) {
    console.log(`[INFO] [${tmdbId}] Starting fresh cache`);
    
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
      console.log(`[INFO] [${tmdbId}] Master playlist detected, picking best variant...`);
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
        
        console.log(`[INFO] [${tmdbId}] Picking variant: ${variantUrl}`);
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
            duration: seg.duration || 10,
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
    
    console.log(`[INFO] [${tmdbId}] Manifest parsed. Total segments: ${meta.totalSegments}`);

    await fs.writeJson(metaPath(tmdbId), meta);
  }


  activeStreams[tmdbId] = {
    meta,
    headers,
    totalDownloaded: 0,
    downloading: false,
    speed: 0,
    lastBytes: 0,
    startTime: Date.now(),
  };

  startBackgroundDownload(tmdbId);

  res.json({
    message: "Caching started",
    streamUrl: `${baseUrl}/stream/${tmdbId}.m3u8`
  });
}

async function serveM3u8(req, res) {
  const { tmdbId } = req.params;
  const state = activeStreams[tmdbId];
  const baseUrl = getBaseUrl(req);


  if (!state) return res.status(404).send("Not loaded");

  const targetDuration = Math.ceil(state.meta.segments.reduce((max, s) => Math.max(max, s.duration), 0)) || 10;
  let m3u8 = `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:${targetDuration}\n#EXT-X-MEDIA-SEQUENCE:0\n`;

  if (state.meta.keys) {
    state.meta.keys.forEach((key, i) => {
      m3u8 += `#EXT-X-KEY:METHOD=${key.method},URI="${baseUrl}/key/${tmdbId}/${i}"\n`;
    });
  }

  state.meta.segments.forEach((seg, i) => {
    m3u8 += `#EXTINF:${seg.duration.toFixed(3)},\n${baseUrl}/seg/${tmdbId}/${seg.file}\n`;
  });

  m3u8 += "#EXT-X-ENDLIST";

  res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
  res.send(m3u8);
}

async function serveKey(req, res) {
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
}

async function serveSegment(req, res) {
  const { tmdbId, id } = req.params;
  const state = activeStreams[tmdbId];

  if (!state) return res.status(404).send("No stream");

  const seg = state.meta.segments[id];
  const filePath = path.join(getVideoDir(tmdbId), seg.file);

  res.setHeader("Content-Type", "video/mp2t");

  if (await fs.pathExists(filePath)) {
    return fs.createReadStream(filePath).pipe(res);
  }

  // Seek Priority
  state.backgroundIndex = parseInt(id);

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
    console.error(`[ERROR] [${tmdbId}] Segment pipe error for ${id}:`, e.message);
    if (!res.headersSent) res.status(500).send(e.message);
  }
}

async function getProgress(req, res) {
  const file = progressPath(req.params.tmdbId);

  if (!(await fs.pathExists(file))) {
    return res.json({ percent: 0 });
  }

  try {
    res.json(await fs.readJson(file));
  } catch (err) {
    res.json({ percent: 0 });
  }
}

async function getStatus(req, res) {
  res.json({ safeword: 6769 });
}

async function getCacheList(req, res) {
  try {
    const folders = await fs.readdir(BASE_DIR);
    const list = [];
    
    async function getFolderSize(directory) {
         let size = 0;
         if (!(await fs.pathExists(directory))) return 0;
         const files = await fs.readdir(directory);
         for (const file of files) {
             const filePath = path.join(directory, file);
             const stat = await fs.stat(filePath);
             if (stat.isDirectory()) {
                 size += await getFolderSize(filePath);
             } else {
                 size += stat.size;
             }
         }
         return size;
    }

    for (const folder of folders) {
      const folderPath = path.join(BASE_DIR, folder);
      const stat = await fs.stat(folderPath);
      if (stat.isDirectory()) {
         const progPath = progressPath(folder);
         let percent = 0;
         if (await fs.pathExists(progPath)) {
            try {
              const p = await fs.readJson(progPath);
              percent = p.percent || 0;
            } catch(e) {}
         }
         const byteSize = await getFolderSize(folderPath);
         let sizeFormatted = "";
         if (byteSize >= 1024 * 1024 * 1024) {
             sizeFormatted = (byteSize / (1024 * 1024 * 1024)).toFixed(2) + " GB";
         } else {
             sizeFormatted = (byteSize / (1024 * 1024)).toFixed(2) + " MB";
         }

         list.push({ tmdbId: folder, percent, sizeFormatted });
      }
    }
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function deleteCache(req, res) {
  const { tmdbId } = req.params;
  try {
    const folderPath = path.join(BASE_DIR, tmdbId);
    await fs.remove(folderPath);
    if (activeStreams[tmdbId]) {
      delete activeStreams[tmdbId];
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function clearAllCache(req, res) {
  try {
    await fs.emptyDir(BASE_DIR);
    Object.keys(activeStreams).forEach(k => delete activeStreams[k]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getCacheSize(req, res) {
  try {
     let totalSize = 0;
     async function calculateSize(directory) {
         if (!(await fs.pathExists(directory))) return;
         const files = await fs.readdir(directory);
         for (const file of files) {
             const filePath = path.join(directory, file);
             const stat = await fs.stat(filePath);
             if (stat.isDirectory()) {
                 await calculateSize(filePath);
             } else {
                 totalSize += stat.size;
             }
         }
     }
     await calculateSize(BASE_DIR);
     let formatted = "";
     if (totalSize >= 1024 * 1024 * 1024) {
         formatted = (totalSize / (1024 * 1024 * 1024)).toFixed(2) + " GB";
     } else {
         formatted = (totalSize / (1024 * 1024)).toFixed(2) + " MB";
     }
     res.json({ bytes: totalSize, formatted });
  } catch (err) {
     res.status(500).json({ error: err.message });
  }
}

module.exports = {
  loadStream,
  serveM3u8,
  serveKey,
  serveSegment,
  getProgress,
  getStatus,
  getCacheList,
  deleteCache,
  clearAllCache,
  getCacheSize
};
