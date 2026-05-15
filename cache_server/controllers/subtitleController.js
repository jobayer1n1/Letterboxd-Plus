const fs = require("fs-extra");
const path = require("path");
const fetch = require("../utils/fetcher");
const { getSubtitleDir } = require("../utils/paths");
const { DEFAULT_HEADERS, BASE_DIR } = require("../config");
const { getBaseUrl } = require("../utils/url");

const OPEN_SUB_SETTINGS_PATH = path.join(BASE_DIR, "_subtitle-provider-settings.json");

async function readProviderSettings() {
  try {
    if (!(await fs.pathExists(OPEN_SUB_SETTINGS_PATH))) return {};
    const payload = await fs.readJson(OPEN_SUB_SETTINGS_PATH);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
    return payload;
  } catch (_) {
    return {};
  }
}

async function writeProviderSettings(settings) {
  await fs.writeJson(OPEN_SUB_SETTINGS_PATH, settings, { spaces: 2 });
}

function normalizeLang(lang) {
  const value = String(lang || "en").trim().toLowerCase();
  return value || "en";
}

function scoreCandidate(item, preferredLang) {
  const attrs = item?.attributes || {};
  const lang = String(attrs?.language || "").toLowerCase();
  const ratings = Number(attrs?.ratings || 0);
  const downloads = Number(attrs?.download_count || 0);
  const fromTrusted = attrs?.from_trusted === true ? 1 : 0;
  const isPreferredLang = lang === preferredLang ? 1 : 0;
  return (isPreferredLang * 1000000) + (fromTrusted * 100000) + (ratings * 1000) + downloads;
}

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
  const baseUrl = getBaseUrl(req);
  const subDir = getSubtitleDir(tmdbId);

  if (!(await fs.pathExists(subDir))) {
    return res.json([]);
  }

  const files = await fs.readdir(subDir);
  const subtitles = files.map(file => ({
    label: file,
    url: `${baseUrl}/sub/${tmdbId}/${file}`
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

async function setOpenSubtitlesApiKey(req, res) {
  const rawKey = req.body?.apiKey;
  const apiKey = String(rawKey || "").trim();
  if (!apiKey) {
    return res.status(400).json({ error: "Missing apiKey" });
  }

  const current = await readProviderSettings();
  current.openSubtitlesApiKey = apiKey;
  await writeProviderSettings(current);
  return res.json({ success: true });
}

async function getOpenSubtitlesApiKeyStatus(req, res) {
  const current = await readProviderSettings();
  const key = String(current.openSubtitlesApiKey || "");
  res.json({
    hasKey: Boolean(key),
    maskedKey: key ? `${key.slice(0, 4)}...${key.slice(-4)}` : ""
  });
}

async function searchOpenSubtitles(req, res) {
  const { tmdbId } = req.params;
  const lang = normalizeLang(req.query?.lang);
  const settings = await readProviderSettings();
  const apiKey = String(settings.openSubtitlesApiKey || "").trim();

  if (!apiKey) {
    return res.status(400).json({ error: "OpenSubtitles API key not set." });
  }

  if (!tmdbId) {
    return res.status(400).json({ error: "Missing tmdbId" });
  }

  const query = new URLSearchParams({
    tmdb_id: String(tmdbId),
    languages: lang,
    type: "movie",
    order_by: "download_count",
    order_direction: "desc"
  });

  const endpoint = `https://api.opensubtitles.com/api/v1/subtitles?${query.toString()}`;

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        "Api-Key": apiKey,
        "Content-Type": "application/json",
        "User-Agent": "LetterboxdPlus v1"
      }
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return res.status(response.status).json({
        error: `OpenSubtitles search failed (${response.status})`,
        details: body.slice(0, 400)
      });
    }

    const payload = await response.json();
    const list = Array.isArray(payload?.data) ? payload.data : [];

    const candidates = list
      .map((item) => {
        const attrs = item?.attributes || {};
        const files = Array.isArray(attrs.files) ? attrs.files : [];
        const firstFile = files[0] || {};
        let fileName = firstFile?.file_name || attrs?.release || "";
        // Decode URL-encoded filename
        try {
          fileName = decodeURIComponent(fileName);
        } catch (_) {}
        return {
          id: item?.id || null,
          fileId: firstFile?.file_id || null,
          fileName,
          language: attrs?.language || "",
          release: attrs?.release || "",
          hearingImpaired: Boolean(attrs?.hearing_impaired),
          fps: attrs?.fps || null,
          downloads: Number(attrs?.download_count || 0),
          ratings: Number(attrs?.ratings || 0),
          trusted: Boolean(attrs?.from_trusted),
          uploader: attrs?.uploader?.name || "",
          score: scoreCandidate(item, lang)
        };
      })
      .filter((x) => x.fileId)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    res.json({
      tmdbId: String(tmdbId),
      lang,
      count: candidates.length,
      candidates
    });
  } catch (error) {
    res.status(500).json({ error: error?.message || "Subtitle search failed" });
  }
}

async function fetchOpenSubtitlesCandidate(req, res) {
  const { tmdbId, fileId, fileName } = req.body || {};
  if (!tmdbId || !fileId) {
    return res.status(400).json({ error: "Missing tmdbId or fileId" });
  }

  const settings = await readProviderSettings();
  const apiKey = String(settings.openSubtitlesApiKey || "").trim();
  if (!apiKey) {
    return res.status(400).json({ error: "OpenSubtitles API key not set." });
  }

  try {
    const dlResp = await fetch("https://api.opensubtitles.com/api/v1/download", {
      method: "POST",
      headers: {
        "Api-Key": apiKey,
        "Content-Type": "application/json",
        "User-Agent": "LetterboxdPlus v1"
      },
      body: JSON.stringify({ file_id: Number(fileId) || fileId })
    });

    if (!dlResp.ok) {
      const body = await dlResp.text().catch(() => "");
      return res.status(dlResp.status).json({
        error: `OpenSubtitles download-link failed (${dlResp.status})`,
        details: body.slice(0, 400)
      });
    }

    const dlData = await dlResp.json();
    const link = String(dlData?.link || "").trim();
    if (!link) {
      return res.status(500).json({ error: "OpenSubtitles did not return a file link." });
    }

    const subDir = getSubtitleDir(tmdbId);
    await fs.ensureDir(subDir);

    const remote = await fetch(link, { headers: DEFAULT_HEADERS });
    if (!remote.ok) throw new Error(`Subtitle file HTTP ${remote.status}`);
    const buffer = Buffer.from(await remote.arrayBuffer());

    let resolvedName = String(fileName || dlData?.file_name || `opensub_${fileId}.srt`).trim();
    if (!resolvedName) resolvedName = `opensub_${fileId}.srt`;
    
    // Decode URL-encoded characters (e.g., %20 → space)
    try {
      resolvedName = decodeURIComponent(resolvedName);
    } catch (_) {
      // If decoding fails, keep the original
    }
    
    resolvedName = resolvedName.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
    const filePath = path.join(subDir, resolvedName);
    await fs.writeFile(filePath, buffer);

    return res.json({ success: true, tmdbId: String(tmdbId), fileName: resolvedName });
  } catch (error) {
    return res.status(500).json({ error: error?.message || "Failed to fetch OpenSubtitles file" });
  }
}

module.exports = {
  cacheSubtitle,
  listSubtitles,
  serveSubtitle,
  setOpenSubtitlesApiKey,
  getOpenSubtitlesApiKeyStatus,
  searchOpenSubtitles,
  fetchOpenSubtitlesCandidate
};
