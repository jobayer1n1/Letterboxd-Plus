const fs = require("fs-extra");
const path = require("path");
const os = require("os");
const { PORT, BASE_DIR } = require("../config");
const { progressPath, metaPath } = require("../utils/paths");
const { getLocalIp } = require("../utils/network");



async function serveIndex(req, res) {
  try {
    const folders = await fs.readdir(BASE_DIR);
    const list = [];
    const localIp = getLocalIp();
    const port = PORT;
    const baseUrl = `http://${localIp}:${port}`;

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
        const mPath = metaPath(folder);
        let title = "Unknown Movie";
        if (await fs.pathExists(mPath)) {
          try {
            const m = await fs.readJson(mPath);
            title = m.title || "Unknown Movie";
          } catch (e) {}
        }

        const progPath = progressPath(folder);
        let percent = 0;
        if (await fs.pathExists(progPath)) {
          try {
            const p = await fs.readJson(progPath);
            percent = p.percent || 0;
          } catch (e) {}
        }
        const byteSize = await getFolderSize(folderPath);
        let sizeFormatted = "";
        if (byteSize >= 1024 * 1024 * 1024) {
          sizeFormatted = (byteSize / (1024 * 1024 * 1024)).toFixed(2) + " GB";
        } else {
          sizeFormatted = (byteSize / (1024 * 1024)).toFixed(2) + " MB";
        }

        list.push({ tmdbId: folder, title, percent, sizeFormatted, url: `${baseUrl}/stream/${folder}.m3u8` });
      }
    }

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cache Server Dashboard</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg: #0f172a;
            --card-bg: #1e293b;
            --accent: #38bdf8;
            --text: #f8fafc;
            --text-muted: #94a3b8;
        }
        body {
            font-family: 'Outfit', sans-serif;
            background-color: var(--bg);
            color: var(--text);
            margin: 0;
            padding: 40px 20px;
            display: flex;
            flex-direction: column;
            align-items: center;
        }
        .container {
            max-width: 900px;
            width: 100%;
        }
        h1 {
            font-size: 2.5rem;
            margin-bottom: 30px;
            text-align: center;
            background: linear-gradient(to right, #38bdf8, #818cf8);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            gap: 20px;
        }
        .card {
            background-color: var(--card-bg);
            border-radius: 16px;
            padding: 20px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            transition: transform 0.2s, box-shadow 0.2s;
            border: 1px solid rgba(255,255,255,0.05);
        }
        .card:hover {
            transform: translateY(-5px);
            box-shadow: 0 8px 30px rgba(56, 189, 248, 0.2);
        }
        .card-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
        }
        .tmdb-id {
            font-weight: 600;
            color: var(--accent);
            font-size: 1.1rem;
        }
        .size {
            font-size: 0.85rem;
            color: var(--text-muted);
        }
        .progress-container {
            height: 8px;
            background: rgba(255,255,255,0.1);
            border-radius: 4px;
            margin: 15px 0;
            overflow: hidden;
        }
        .progress-bar {
            height: 100%;
            background: var(--accent);
            transition: width 0.5s ease;
        }
        .link-container {
            margin-top: 15px;
            word-break: break-all;
        }
        .link-container a {
            color: var(--text);
            text-decoration: none;
            font-size: 0.85rem;
            background: rgba(56, 189, 248, 0.1);
            padding: 8px 12px;
            border-radius: 8px;
            display: block;
            border: 1px solid rgba(56, 189, 248, 0.2);
            transition: all 0.2s;
        }
        .link-container a:hover {
            background: rgba(56, 189, 248, 0.2);
            border-color: var(--accent);
        }
        .empty {
            text-align: center;
            padding: 40px;
            color: var(--text-muted);
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚀 Cache Server</h1>
        ${list.length === 0 ? '<div class="empty">No movies cached yet.</div>' : `
            <div class="grid">
                ${list.map(item => `
                    <div class="card">
                        <div class="card-header">
                            <div class="tmdb-id">🎬 ${item.title}</div>
                            <div class="size">${item.sizeFormatted}</div>
                        </div>
                        <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 8px;">TMDB: ${item.tmdbId}</div>
                        <div style="font-size: 0.9rem; color: var(--text-muted);">Cache Progress: ${item.percent}%</div>
                        <div class="progress-container">
                            <div class="progress-bar" style="width: ${item.percent}%"></div>
                        </div>
                        <div class="link-container">
                            <a href="${item.url}" target="_blank">🔗 Copy Stream Link</a>
                        </div>
                    </div>
                `).join('')}
            </div>
        `}
    </div>
</body>
</html>
    `;

    res.send(html);
  } catch (err) {
    res.status(500).send("Dashboard Error: " + err.message);
  }
}

module.exports = {
  serveIndex
};
