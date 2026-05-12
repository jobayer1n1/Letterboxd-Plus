const express = require("express");
const router = express.Router();
const streamController = require("../controllers/streamController");
const subtitleController = require("../controllers/subtitleController");

// Stream & Cache Routes
router.post("/load", streamController.loadStream);
router.get("/stream/:tmdbId.m3u8", streamController.serveM3u8);
router.get("/key/:tmdbId/:keyId", streamController.serveKey);
router.get("/seg/:tmdbId/:id.ts", streamController.serveSegment);
router.get("/progress/:tmdbId", streamController.getProgress);
router.get("/watch-progress/:tmdbId", streamController.getWatchProgress);
router.put("/watch-progress/:tmdbId", streamController.putWatchProgress);
router.delete("/watch-progress/:tmdbId", streamController.deleteWatchProgress);
router.get("/resume/:tmdbId", streamController.getWatchProgress);
router.put("/resume/:tmdbId", streamController.putWatchProgress);
router.delete("/resume/:tmdbId", streamController.deleteWatchProgress);
router.get("/status", streamController.getStatus);
router.get("/cache", streamController.getCacheList);
router.get("/cache/size", streamController.getCacheSize);
router.delete("/cache/:tmdbId", streamController.deleteCache);
router.delete("/cache", streamController.clearAllCache);

// Subtitle Routes
router.post("/subtitle", subtitleController.cacheSubtitle);
router.get("/subtitle/:tmdbId", subtitleController.listSubtitles);
router.get("/sub/:tmdbId/:filename", subtitleController.serveSubtitle);
router.post("/subtitle/provider/opensubtitles/key", subtitleController.setOpenSubtitlesApiKey);
router.get("/subtitle/provider/opensubtitles/key", subtitleController.getOpenSubtitlesApiKeyStatus);
router.get("/subtitle/search/:tmdbId", subtitleController.searchOpenSubtitles);
router.post("/subtitle/opensubtitles/fetch", subtitleController.fetchOpenSubtitlesCandidate);

module.exports = router;
