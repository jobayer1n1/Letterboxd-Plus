const scriptToggleEl = document.getElementById("scriptToggle");
const toggleStateEl = document.getElementById("toggleState");
const appVersionEl = document.getElementById("appVersion");
const checkUpdateBtn = document.getElementById("checkUpdateBtn");
const updateResultEl = document.getElementById("updateResult");
const latestReleaseBtn = document.getElementById("latestReleaseBtn");
const serversToggleBtn = document.getElementById("serversToggleBtn");
const serversBodyEl = document.getElementById("serversBody");
const addServerBtn = document.getElementById("addServerBtn");
const addServerForm = document.getElementById("addServerForm");
const serverNameEl = document.getElementById("serverName");
const serverLinkEl = document.getElementById("serverLink");
const checkConnectionBtn = document.getElementById("checkConnectionBtn");
const saveServerBtn = document.getElementById("saveServerBtn");
const serverFeedbackEl = document.getElementById("serverFeedback");
const serverListEl = document.getElementById("serverList");
const manualBtn = document.getElementById("manualBtn");
const manualUrl = "https://github.com/jobayer1n1/Letterboxd-Plus/blob/main/src/add_server.md";
const cacheServerUrl = "http://localhost:6769/status";
const releaseApiUrl = "https://api.github.com/repos/jobayer1n1/Letterboxd-Plus/releases/latest";
const STORAGE_ENABLED_KEY = "scriptsEnabled";
const STORAGE_SERVERS_KEY = "serverTemplates";
const DEFAULT_SERVERS = Array.isArray(globalThis.LETTERBOXD_PLUS_DEFAULT_SERVERS)
  ? globalThis.LETTERBOXD_PLUS_DEFAULT_SERVERS
  : [];

const manifestVersion = chrome.runtime.getManifest().version;
appVersionEl.textContent = `v${manifestVersion}`;
let latestReleasePageUrl = "";

function normalizeVersion(value) {
  return String(value || "").trim().replace(/^v/i, "").split("-")[0];
}

function compareSemver(a, b) {
  const pa = normalizeVersion(a).split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = normalizeVersion(b).split(".").map((n) => Number.parseInt(n, 10) || 0);
  const maxLen = Math.max(pa.length, pb.length);

  for (let i = 0; i < maxLen; i += 1) {
    const av = pa[i] || 0;
    const bv = pb[i] || 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

function setUpdateResult(message, type = "default") {
  updateResultEl.textContent = message;
  updateResultEl.classList.remove("success", "warning", "error");
  if (type === "success" || type === "warning" || type === "error") {
    updateResultEl.classList.add(type);
  }
}

function normalizeTemplate(template) {
  return String(template || "").trim().toLowerCase();
}

function setFeedback(message, type = "default") {
  serverFeedbackEl.textContent = message;
  serverFeedbackEl.classList.remove("success", "error");
  if (type === "success" || type === "error") {
    serverFeedbackEl.classList.add(type);
  }
}

function renderToggleState(enabled) {
  toggleStateEl.textContent = enabled ? "ENABLED" : "DISABLED";
  toggleStateEl.classList.toggle("enabled", enabled);
}

function sendMessageToActiveTab(message) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs && tabs[0];
    if (!activeTab || typeof activeTab.id !== "number") return;

    const maybePromise = chrome.tabs.sendMessage(activeTab.id, message, () => {
      void chrome.runtime.lastError;
    });

    if (maybePromise && typeof maybePromise.catch === "function") {
      maybePromise.catch(() => {});
    }
  });
}

function renderServerList(servers) {
  serverListEl.textContent = "";

  servers.forEach((server) => {
    const item = document.createElement("div");
    item.className = `server-item ${server.isDefault ? "default" : "custom"}`;

    const row = document.createElement("div");
    row.className = "server-row";

    const left = document.createElement("div");

    const name = document.createElement("p");
    name.className = "server-name";
    name.textContent = server.name;

    const link = document.createElement("p");
    link.className = "server-link";
    link.textContent = server.template;

    left.appendChild(name);
    left.appendChild(link);
    row.appendChild(left);

    if (!server.isDefault) {
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "server-delete";
      deleteBtn.textContent = "Delete";
      deleteBtn.dataset.template = normalizeTemplate(server.template);
      row.appendChild(deleteBtn);
    }

    item.appendChild(row);
    serverListEl.appendChild(item);
  });
}

function mergeWithDefaults(existing) {
  const result = [];
  const byTemplate = new Set();

  const pushUnique = (server) => {
    const normalized = normalizeTemplate(server.template);
    if (!normalized || byTemplate.has(normalized)) return;
    result.push({
      name: String(server.name || "").trim(),
      template: String(server.template || "").trim(),
      isDefault: Boolean(server.isDefault)
    });
    byTemplate.add(normalized);
  };

  DEFAULT_SERVERS.forEach(pushUnique);
  (Array.isArray(existing) ? existing : []).forEach((server) => {
    pushUnique({
      name: server.name,
      template: server.template,
      isDefault: false
    });
  });
  return result;
}

function loadServers(callback) {
  chrome.storage.local.get({ [STORAGE_SERVERS_KEY]: DEFAULT_SERVERS }, (result) => {
    const merged = mergeWithDefaults(result[STORAGE_SERVERS_KEY]);
    chrome.storage.local.set({ [STORAGE_SERVERS_KEY]: merged }, () => {
      callback(merged);
    });
  });
}

function validateInputs(name, template) {
  if (!name) return "Name is mandatory.";
  if (!template) return "Link is mandatory.";
  if (!template.includes("{tmdbId}")) return "Link must include {tmdbId}.";
  if (!/^https:\/\//i.test(template)) return "Link must start with https://";

  try {
    const testUrl = new URL(template.replaceAll("{tmdbId}", "550"));
    if (!/^https?:$/.test(testUrl.protocol)) return "Only http/https links are allowed.";
  } catch (error) {
    return "Link format is invalid.";
  }

  return null;
}

async function checkConnection(name, template) {
  const validationError = validateInputs(name, template);
  if (validationError) {
    setFeedback(validationError, "error");
    return false;
  }

  setFeedback("Checking connection...");
  const url = template.replaceAll("{tmdbId}", "550");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, {
      method: "GET",
      mode: "no-cors",
      cache: "no-store",
      signal: controller.signal
    });

    clearTimeout(timer);
    if (response && (response.type === "opaque" || response.ok)) {
      setFeedback("Successfully connected.", "success");
      return true;
    }

    setFeedback("Can't establish the connection.", "error");
    return false;
  } catch (error) {
    clearTimeout(timer);
    setFeedback("Can't establish the connection.", "error");
    return false;
  }
}

function saveServer() {
  const name = serverNameEl.value.trim();
  const template = serverLinkEl.value.trim();
  const validationError = validateInputs(name, template);
  if (validationError) {
    setFeedback(validationError, "error");
    return;
  }

  loadServers((servers) => {
    const normalizedTemplate = normalizeTemplate(template);
    const existing = servers.find(
      (server) => normalizeTemplate(server.template) === normalizedTemplate
    );

    if (existing) {
      setFeedback(`Already exists ${existing.name}`, "error");
      return;
    }

    const updated = [...servers, { name, template, isDefault: false }];
    chrome.storage.local.set({ [STORAGE_SERVERS_KEY]: updated }, () => {
      renderServerList(updated);
      setFeedback("Server saved successfully.", "success");
      serverNameEl.value = "";
      serverLinkEl.value = "";
      sendMessageToActiveTab({ type: "LETTERBOXD_PLUS_SERVERS_UPDATED" });
    });
  });
}

chrome.storage.local.get({ [STORAGE_ENABLED_KEY]: true }, (result) => {
  const enabled = Boolean(result[STORAGE_ENABLED_KEY]);
  scriptToggleEl.checked = enabled;
  renderToggleState(enabled);
});

scriptToggleEl.addEventListener("change", () => {
  const enabled = scriptToggleEl.checked;
  chrome.storage.local.set({ [STORAGE_ENABLED_KEY]: enabled }, () => {
    renderToggleState(enabled);
    sendMessageToActiveTab({ type: "LETTERBOXD_PLUS_TOGGLE", enabled });
  });
});

serversToggleBtn.addEventListener("click", () => {
  const collapsed = serversBodyEl.classList.toggle("hidden");
  serversToggleBtn.setAttribute("aria-expanded", String(!collapsed));
});

addServerBtn.addEventListener("click", () => {
  if (serversBodyEl.classList.contains("hidden")) {
    serversBodyEl.classList.remove("hidden");
    serversToggleBtn.setAttribute("aria-expanded", "true");
  }
  addServerForm.classList.toggle("hidden");
  setFeedback("");
});

checkConnectionBtn.addEventListener("click", async () => {
  const name = serverNameEl.value.trim();
  const template = serverLinkEl.value.trim();
  await checkConnection(name, template);
});

saveServerBtn.addEventListener("click", saveServer);

serverListEl.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (!target.classList.contains("server-delete")) return;

  const template = target.dataset.template;
  if (!template) return;

  loadServers((servers) => {
    const updated = servers.filter((server) => {
      if (server.isDefault) return true;
      return normalizeTemplate(server.template) !== template;
    });

    chrome.storage.local.set({ [STORAGE_SERVERS_KEY]: updated }, () => {
      renderServerList(updated);
      setFeedback("Server deleted.", "success");
      sendMessageToActiveTab({ type: "LETTERBOXD_PLUS_SERVERS_UPDATED" });
    });
  });
});

loadServers((servers) => {
  renderServerList(servers);
});

manualBtn.addEventListener("click", () => {
  chrome.tabs.create({
    url: manualUrl,
  });
});

checkUpdateBtn.addEventListener("click", async () => {
  setUpdateResult("Checking...");
  checkUpdateBtn.disabled = true;
  latestReleaseBtn.classList.add("hidden");
  latestReleasePageUrl = "";

  try {
    const response = await fetch(releaseApiUrl, {
      headers: { Accept: "application/vnd.github+json" }
    });
    if (!response.ok) {
      throw new Error(`GitHub API ${response.status}`);
    }

    const latestRelease = await response.json();
    const latestTag = normalizeVersion(latestRelease.tag_name);
    const compareResult = compareSemver(manifestVersion, latestTag);

    if (compareResult >= 0) {
      setUpdateResult(`Up to date ${latestRelease.tag_name}`, "success");
    } else {
      setUpdateResult(`Update Available ${latestRelease.tag_name}`, "warning");
      latestReleasePageUrl = latestRelease.html_url || "https://github.com/jobayer1n1/Letterboxd-Plus/releases/latest";
      latestReleaseBtn.classList.remove("hidden");
    }
  } catch (error) {
    setUpdateResult("Update check failed", "error");
  } finally {
    checkUpdateBtn.disabled = false;
  }
});

latestReleaseBtn.addEventListener("click", () => {
  if (!latestReleasePageUrl) return;
  chrome.tabs.create({ url: latestReleasePageUrl });
});

// Cache Servers Logic
const cacheServersToggleBtn = document.getElementById("cacheServersToggleBtn");
const cacheServersBody = document.getElementById("cacheServersBody");
const addCacheServerBtn = document.getElementById("addCacheServerBtn");
const manualCacheBtn = document.getElementById("manualCacheBtn");
const addCacheServerForm = document.getElementById("addCacheServerForm");
const cacheServerLink = document.getElementById("cacheServerLink");
const checkCacheConnectionBtn = document.getElementById("checkCacheConnectionBtn");
const saveCacheServerBtn = document.getElementById("saveCacheServerBtn");
const cacheServerFeedback = document.getElementById("cacheServerFeedback");
const cacheServerList = document.getElementById("cacheServerList");

const cacheFoldersSection = document.getElementById("cacheFoldersSection");
const cacheFoldersList = document.getElementById("cacheFoldersList");
const clearAllCacheBtn = document.getElementById("clearAllCacheBtn");
const cacheFoldersToggleBtn = document.getElementById("cacheFoldersToggleBtn");
const cacheFoldersBody = document.getElementById("cacheFoldersBody");

const STORAGE_CACHE_SERVERS = "cacheServers";
const STORAGE_SELECTED_CACHE = "selectedCacheServer";
const defaultCacheServer = "http://localhost:6769";

function getCacheServers(cb) {
  chrome.storage.local.get({ [STORAGE_CACHE_SERVERS]: [defaultCacheServer], [STORAGE_SELECTED_CACHE]: defaultCacheServer }, (res) => {
    let servers = res[STORAGE_CACHE_SERVERS];
    if (!servers.includes(defaultCacheServer)) {
      servers.unshift(defaultCacheServer);
      chrome.storage.local.set({ [STORAGE_CACHE_SERVERS]: servers });
    }
    cb(servers, res[STORAGE_SELECTED_CACHE]);
  });
}

function normalizeUrl(url) {
  return url.trim().replace(/\/$/, "");
}

function setCacheFeedback(msg, ok, color) {
  cacheServerFeedback.textContent = msg;
  cacheServerFeedback.style.color = color || (ok ? "#66d08a" : "#ff7f7f");
}

async function renderCacheFolders(serverUrl) {
  try {
    const res = await fetch(`${serverUrl}/cache`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    cacheFoldersSection.classList.remove("hidden");
    cacheFoldersList.innerHTML = "";
    
    try {
       const sizeRes = await fetch(`${serverUrl}/cache/size`);
       if (sizeRes.ok) {
           const sizeData = await sizeRes.json();
           const sizeEl = document.getElementById("totalCacheSize");
           if (sizeEl) sizeEl.textContent = `${sizeData.formatted}`;
       }
    } catch (e) {
       const sizeEl = document.getElementById("totalCacheSize");
       if (sizeEl) sizeEl.textContent = "N/A";
    }

    if (data.length === 0) {
       cacheFoldersList.innerHTML = "<p style='color:#9eacbf;font-size:11px'>No caches found.</p>";
    }
    data.forEach(c => {
       const row = document.createElement("div");
       row.className = "server-item custom";
       row.style.marginBottom = "5px";
       row.innerHTML = `
         <div class="server-row" style="align-items:center;">
           <div style="flex:1;">
             <p class="server-name" style="margin:0;">TMDB: ${c.tmdbId}</p>
             <p class="server-link" style="margin:0; margin-top:3px;">${c.percent}% Cached (${c.sizeFormatted})</p>
           </div>
           <button class="server-delete delete-folder-btn" style="padding:4px 8px" data-tmdb="${c.tmdbId}">Delete</button>
         </div>
       `;
       row.querySelector('.delete-folder-btn').onclick = async () => {
          await fetch(`${serverUrl}/cache/${c.tmdbId}`, { method: 'DELETE' });
          renderCacheFolders(serverUrl);
       };
       cacheFoldersList.appendChild(row);
    });
  } catch(e) {
    cacheFoldersSection.classList.add("hidden");
  }
}

async function renderCacheServerList() {
  getCacheServers((servers, selected) => {
    chrome.storage.local.get({ cacheServerOnline: false }, (res) => {
      let isSelectedOnline = res.cacheServerOnline;
      cacheServerList.innerHTML = "";

    servers.forEach(srv => {
      const isDefault = srv === defaultCacheServer;
      const isSelected = srv === selected;
      const item = document.createElement("div");
      item.className = `server-item ${isSelected ? "default" : "custom"}`;
      
      let statusText = '';
      if (isSelected) {
          statusText = isSelectedOnline 
              ? '<p class="server-link" style="margin:0; margin-top:3px; color:#66d08a;">Active (Online)</p>'
              : '<p class="server-link" style="margin:0; margin-top:3px; color:#ff7f7f;">Active (Offline)</p>';
      }

      item.innerHTML = `
        <div class="server-row" style="align-items:center;">
          <div style="flex:1;">
            <p class="server-name" style="margin:0;">${srv}</p>
            ${statusText}
          </div>
        </div>
      `;
      
      const row = item.querySelector('.server-row');
      
      if (!isSelected) {
        const selBtn = document.createElement("button");
        selBtn.className = "btn secondary";
        selBtn.textContent = "Select";
        selBtn.onclick = async () => {
          selBtn.textContent = "Checking...";
          try {
            const controller = new AbortController();
            const t = setTimeout(()=>controller.abort(), 2000);
            const res = await fetch(`${srv}/status`, { signal: controller.signal });
            clearTimeout(t);
            const data = await res.json();
            if (data && data.safeword === 6769) {
               chrome.storage.local.set({ 
                 [STORAGE_SELECTED_CACHE]: srv,
                 cacheServerOnline: true
               }, () => {
                  chrome.runtime.sendMessage({ type: 'FORCE_HEALTH_CHECK' }).catch(()=>{});
                  renderCacheServerList();
                  renderCacheFolders(srv);
               });
            } else {
               alert("Server not online or invalid!");
               selBtn.textContent = "Select";
            }
          } catch(e) {
            alert("Server not online!");
            selBtn.textContent = "Select";
          }
        };
        row.appendChild(selBtn);
      }
      
      if (!isDefault && !isSelected) {
        const delBtn = document.createElement("button");
        delBtn.className = "server-delete";
        delBtn.textContent = "Delete";
        delBtn.style.marginLeft = "4px";
        delBtn.onclick = () => {
          const newList = servers.filter(s => s !== srv);
          let newSelected = selected === srv ? defaultCacheServer : selected;
          chrome.storage.local.set({ [STORAGE_CACHE_SERVERS]: newList, [STORAGE_SELECTED_CACHE]: newSelected }, () => {
             renderCacheServerList();
             if (selected === srv) renderCacheFolders(newSelected);
          });
        };
        row.appendChild(delBtn);
      }
      
      cacheServerList.appendChild(item);
    });
    
    // Manage cache folders section visibility dynamically
    if (!isSelectedOnline) {
       cacheFoldersSection.classList.add("hidden");
    } else {
       renderCacheFolders(selected);
    }
  });
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.cacheServerOnline || changes.selectedCacheServer)) {
    renderCacheServerList();
  }
});

checkCacheConnectionBtn.onclick = async () => {
  const url = normalizeUrl(cacheServerLink.value);
  if (!url.startsWith("http")) return setCacheFeedback("Invalid URL", false);
  setCacheFeedback("Checking...", true, "#9eabbc");
  try {
     const res = await fetch(`${url}/status`);
     const data = await res.json();
     if (data.safeword === 6769) {
        setCacheFeedback("Connected!", true);
        saveCacheServerBtn.disabled = false;
        saveCacheServerBtn.style.opacity = "1";
        saveCacheServerBtn.style.cursor = "pointer";
     } else {
        setCacheFeedback("Invalid cache server", false);
     }
  } catch(e) {
     setCacheFeedback("Cannot connect", false);
  }
};

saveCacheServerBtn.onclick = () => {
  const url = normalizeUrl(cacheServerLink.value);
  getCacheServers((servers) => {
     if (servers.includes(url)) return setCacheFeedback("Already added", false);
     servers.push(url);
     chrome.storage.local.set({ [STORAGE_CACHE_SERVERS]: servers }, () => {
       cacheServerLink.value = "";
       saveCacheServerBtn.disabled = true;
       saveCacheServerBtn.style.opacity = "0.5";
       saveCacheServerBtn.style.cursor = "not-allowed";
       setCacheFeedback("Added successfully", true);
       renderCacheServerList();
     });
  });
};

cacheServersToggleBtn.onclick = () => {
  const hidden = cacheServersBody.classList.toggle("hidden");
  cacheServersToggleBtn.setAttribute("aria-expanded", String(!hidden));
  if (!hidden) {
    getCacheServers((_, selected) => renderCacheFolders(selected));
  }
};

addCacheServerBtn.onclick = () => {
  addCacheServerForm.classList.toggle("hidden");
  cacheServerFeedback.textContent = "";
};

manualCacheBtn.onclick = () => chrome.tabs.create({url: manualUrl});

clearAllCacheBtn.onclick = async () => {
  getCacheServers(async (_, selected) => {
     if (confirm("Clear all cache folders?")) {
        await fetch(`${selected}/cache`, { method: 'DELETE' });
        renderCacheFolders(selected);
     }
  });
};

// --- NEW CACHE FOLDERS TOGGLE LOGIC ---
cacheFoldersToggleBtn.onclick = () => {
  const hidden = cacheFoldersBody.classList.toggle("hidden");
  cacheFoldersToggleBtn.setAttribute("aria-expanded", String(!hidden));
};
// --------------------------------------

renderCacheServerList();