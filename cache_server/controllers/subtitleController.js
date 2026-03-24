const fs = require("fs-extra");
const path = require("path");
const fetch = require("../utils/fetcher");
const { getSubtitleDir } = require("../utils/paths");
const { DEFAULT_HEADERS, PORT } = require("../config");

async function cacheSubtitle(req, res) {
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
}

async function listSubtitles(req, res) {
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
}

async function serveSubtitle(req, res) {
  const { tmdbId, filename } = req.params;
  const filePath = path.join(getSubtitleDir(tmdbId), filename);

  if (!(await fs.pathExists(filePath))) {
    return res.status(404).send("Subtitle not found");
  }

  try {
    let content = await fs.readFile(filePath, "utf8");
    
    // Basic SRT to VTT conversion if needed
    if (!content.trim().startsWith("WEBVTT")) {
        content = content.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
        content = "WEBVTT\n\n" + content;
    }

    res.setHeader("Content-Type", "text/vtt; charset=utf-8");
    res.send(content);
  } catch (e) {
    res.status(500).send(e.message);
  }
}

module.exports = {
  cacheSubtitle,
  listSubtitles,
  serveSubtitle
};
