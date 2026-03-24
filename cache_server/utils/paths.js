const path = require("path");
const { BASE_DIR } = require("../config");

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

module.exports = {
  getVideoDir,
  getSubtitleDir,
  metaPath,
  progressPath
};
