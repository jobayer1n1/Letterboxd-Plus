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
router.get("/status", streamController.getStatus);
router.get("/cache", streamController.getCacheList);
router.get("/cache/size", streamController.getCacheSize);
router.delete("/cache/:tmdbId", streamController.deleteCache);
router.delete("/cache", streamController.clearAllCache);

// Subtitle Routes
router.post("/subtitle", subtitleController.cacheSubtitle);
router.get("/subtitle/:tmdbId", subtitleController.listSubtitles);
router.get("/sub/:tmdbId/:filename", subtitleController.serveSubtitle);

module.exports = router;
