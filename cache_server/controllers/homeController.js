const fs = require("fs-extra");
const path = require("path");
const { PORT, BASE_DIR } = require("../config");
const { progressPath, metaPath } = require("../utils/paths");
const { getLocalIp } = require("../utils/network");

async function getFolderSize(directory) {
  let size = 0;
  if (!(await fs.pathExists(directory))) return 0;
  const files = await fs.readdir(directory);
  for (const file of files) {
    const filePath = path.join(directory, file);
    const stat = await fs.stat(filePath);
    size += stat.isDirectory() ? await getFolderSize(filePath) : stat.size;
  }
  return size;
}

function formatSize(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
  return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

async function serveIndex(req, res) {
  try {
    const folders = await fs.readdir(BASE_DIR);
    const list = [];
    const localIp = getLocalIp();
    const baseUrl = `http://${localIp}:${PORT}`;

    for (const folder of folders) {
      const folderPath = path.join(BASE_DIR, folder);
      const stat = await fs.stat(folderPath);
      if (!stat.isDirectory()) continue;

      let title = "Unknown Movie";
      const mPath = metaPath(folder);
      if (await fs.pathExists(mPath)) {
        try { title = (await fs.readJson(mPath)).title || "Unknown Movie"; } catch (e) {}
      }

      let percent = 0;
      const progPath = progressPath(folder);
      if (await fs.pathExists(progPath)) {
        try { percent = (await fs.readJson(progPath)).percent || 0; } catch (e) {}
      }

      const byteSize = await getFolderSize(folderPath);
      list.push({
        tmdbId: folder,
        title,
        percent,
        sizeFormatted: formatSize(byteSize),
        url: `${baseUrl}/stream/${folder}.m3u8`
      });
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cache Server Dashboard</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg: #0f172a;
            --card-bg: #1e293b;
            --accent: #38bdf8;
            --accent2: #818cf8;
            --danger: #f87171;
            --text: #f8fafc;
            --text-muted: #94a3b8;
            --border: rgba(255,255,255,0.07);
        }
        * { box-sizing: border-box; }
        body {
            font-family: 'Outfit', sans-serif;
            background: var(--bg);
            color: var(--text);
            margin: 0;
            padding: 40px 20px;
            display: flex;
            flex-direction: column;
            align-items: center;
            min-height: 100vh;
        }
        .container { max-width: 960px; width: 100%; }

        h1 {
            font-size: 2.2rem;
            font-weight: 600;
            text-align: center;
            margin-bottom: 8px;
            background: linear-gradient(to right, #38bdf8, #818cf8);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .subtitle {
            text-align: center;
            color: var(--text-muted);
            font-size: 0.9rem;
            margin-bottom: 32px;
        }

        /* Search */
        .search-wrap {
            margin-bottom: 28px;
            position: relative;
        }
        .search-wrap svg {
            position: absolute;
            left: 16px;
            top: 50%;
            transform: translateY(-50%);
            color: var(--text-muted);
            pointer-events: none;
        }
        #search {
            width: 100%;
            padding: 12px 16px 12px 46px;
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: 12px;
            color: var(--text);
            font-family: 'Outfit', sans-serif;
            font-size: 1rem;
            outline: none;
            transition: border-color 0.2s;
        }
        #search::placeholder { color: var(--text-muted); }
        #search:focus { border-color: var(--accent); }

        /* Grid */
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
            gap: 20px;
        }
        .card {
            background: var(--card-bg);
            border-radius: 16px;
            padding: 20px;
            border: 1px solid var(--border);
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            transition: transform 0.2s, box-shadow 0.2s, opacity 0.3s;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .card:hover {
            transform: translateY(-4px);
            box-shadow: 0 8px 30px rgba(56,189,248,0.15);
        }
        .card.removing {
            opacity: 0;
            transform: scale(0.95);
        }

        .card-top {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 8px;
        }
        .title {
            font-size: 1rem;
            font-weight: 600;
            color: var(--text);
            line-height: 1.3;
            flex: 1;
        }
        .badge {
            font-size: 0.72rem;
            font-weight: 500;
            background: rgba(56,189,248,0.12);
            color: var(--accent);
            border: 1px solid rgba(56,189,248,0.25);
            border-radius: 6px;
            padding: 2px 8px;
            white-space: nowrap;
        }

        .meta {
            display: flex;
            justify-content: space-between;
            font-size: 0.8rem;
            color: var(--text-muted);
        }

        /* Progress */
        .progress-track {
            height: 6px;
            background: rgba(255,255,255,0.08);
            border-radius: 4px;
            overflow: hidden;
        }
        .progress-fill {
            height: 100%;
            background: linear-gradient(to right, var(--accent), var(--accent2));
            border-radius: 4px;
            transition: width 0.5s ease;
        }

        /* Actions */
        .actions {
            display: flex;
            gap: 8px;
            margin-top: 4px;
        }
        .btn {
            flex: 1;
            padding: 9px 12px;
            border-radius: 10px;
            border: none;
            font-family: 'Outfit', sans-serif;
            font-size: 0.85rem;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
        }
        .btn-copy {
            background: rgba(56,189,248,0.12);
            color: var(--accent);
            border: 1px solid rgba(56,189,248,0.25);
        }
        .btn-copy:hover {
            background: rgba(56,189,248,0.22);
            border-color: var(--accent);
        }
        .btn-copy.copied {
            background: rgba(52,211,153,0.15);
            color: #34d399;
            border-color: rgba(52,211,153,0.3);
        }
        .btn-delete {
            background: rgba(248,113,113,0.1);
            color: var(--danger);
            border: 1px solid rgba(248,113,113,0.2);
            flex: 0 0 auto;
            padding: 9px 14px;
        }
        .btn-delete:hover {
            background: rgba(248,113,113,0.2);
            border-color: var(--danger);
        }

        /* Toast */
        #toast {
            position: fixed;
            bottom: 32px;
            left: 50%;
            transform: translateX(-50%) translateY(20px);
            background: #1e293b;
            border: 1px solid rgba(52,211,153,0.4);
            color: #34d399;
            padding: 10px 22px;
            border-radius: 10px;
            font-size: 0.9rem;
            font-weight: 500;
            opacity: 0;
            transition: opacity 0.25s, transform 0.25s;
            pointer-events: none;
            z-index: 999;
            box-shadow: 0 4px 20px rgba(0,0,0,0.4);
        }
        #toast.show {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
        }

        /* Empty */
        .empty {
            text-align: center;
            padding: 60px 20px;
            color: var(--text-muted);
            font-size: 1rem;
        }
        .no-results { display: none; }
        .no-results.visible { display: block; }
    </style>
</head>
<body>
<div class="container">
    <h1>🚀 Cache Server</h1>
    <p class="subtitle">${list.length} movie${list.length !== 1 ? 's' : ''} cached &nbsp;·&nbsp; ${getLocalIp()}:${PORT}</p>

    ${list.length > 0 ? `
    <div class="search-wrap">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input id="search" type="text" placeholder="Search movies..." autocomplete="off">
    </div>

    <div class="grid" id="grid">
        ${list.map(item => `
        <div class="card" data-title="${item.title.toLowerCase()}" data-id="${item.tmdbId}">
            <div class="card-top">
                <div class="title">🎬 ${item.title}</div>
                <div class="badge">${item.sizeFormatted}</div>
            </div>
            <div class="meta">
                <span>TMDB: ${item.tmdbId}</span>
                <span>${item.percent}% cached</span>
            </div>
            <div class="progress-track">
                <div class="progress-fill" style="width:${item.percent}%"></div>
            </div>
            <div class="actions">
                <button class="btn btn-copy" onclick="copyLink(this, '${item.url}')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    Copy Link
                </button>
                <button class="btn btn-delete" onclick="deleteMovie(this, '${item.tmdbId}', '${item.title.replace(/'/g, "\\'")}')" title="Delete cache">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                </button>
            </div>
        </div>
        `).join('')}
    </div>
    <div class="empty no-results" id="no-results">No movies match your search.</div>
    ` : '<div class="empty">No movies cached yet.</div>'}
</div>

<div id="toast">✓ Copied!</div>

<script>
    // Search
    const searchInput = document.getElementById('search');
    const noResults = document.getElementById('no-results');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            const q = searchInput.value.trim().toLowerCase();
            const cards = document.querySelectorAll('.card');
            let visible = 0;
            cards.forEach(card => {
                const match = !q || card.dataset.title.includes(q);
                card.style.display = match ? '' : 'none';
                if (match) visible++;
            });
            noResults.classList.toggle('visible', visible === 0 && q.length > 0);
        });
    }

    // Copy Link — use execCommand (reliable on HTTP, no HTTPS needed)
    let toastTimer;
    function copyLink(btn, url) {
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);

        if (ok) {
            btn.classList.add('copied');
            btn.innerHTML = \`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 12 4 10"/></svg> Copied!\`;
            showToast('✓ Stream link copied!');
            setTimeout(() => {
                btn.classList.remove('copied');
                btn.innerHTML = \`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy Link\`;
            }, 2500);
        } else {
            showToast('❌ Copy failed — copy manually');
        }
    }

    function showToast(msg) {
        const toast = document.getElementById('toast');
        toast.textContent = msg;
        toast.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
    }

    // Delete
    function deleteMovie(btn, tmdbId, title) {
        if (!confirm('Delete cached data for "' + title + '"?')) return;
        fetch('/cache/' + tmdbId, { method: 'DELETE' })
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    const card = btn.closest('.card');
                    card.classList.add('removing');
                    setTimeout(() => {
                        card.remove();
                        const remaining = document.querySelectorAll('.card').length;
                        if (remaining === 0) {
                            document.getElementById('grid').innerHTML = '';
                            document.querySelector('.search-wrap').style.display = 'none';
                        }
                        showToast('🗑 Cache deleted');
                    }, 300);
                } else {
                    alert('Delete failed: ' + (data.error || 'Unknown error'));
                }
            })
            .catch(() => alert('Delete request failed.'));
    }
</script>
</body>
</html>`;

    res.send(html);
  } catch (err) {
    res.status(500).send("Dashboard Error: " + err.message);
  }
}

module.exports = { serveIndex };
