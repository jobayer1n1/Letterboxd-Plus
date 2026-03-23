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
const cacheStatusEl = document.getElementById("cacheStatus");


const manualUrl = "https://github.com/jobayer1n1/Letterboxd-Plus/blob/main/src/add_server.md";
const cacheServerUrl = "http://localhost:6769/progress/ping";
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

function updateStatusUI(online) {
  if (online) {
    cacheStatusEl.classList.add("online");
    cacheStatusEl.title = "Cache Server: Online";
  } else {
    cacheStatusEl.classList.remove("online");
    cacheStatusEl.title = "Cache Server: Offline";
  }
}

chrome.storage.local.get({ cacheServerOnline: false }, (result) => {
  updateStatusUI(result.cacheServerOnline);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.cacheServerOnline) {
    updateStatusUI(changes.cacheServerOnline.newValue);
  }
});

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
