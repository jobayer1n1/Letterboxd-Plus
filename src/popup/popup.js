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
const refreshServersBtn = document.getElementById("refreshServersBtn");
const defaultsFeedbackEl = document.getElementById("defaultsFeedback");
const manualUrl = "https://github.com/jobayer1n1/Letterboxd-Plus/blob/main/add_server.md";
const cacheServerUrl = "http://localhost:6769/status";
const embedServersJsonRawUrl =
  "https://raw.githubusercontent.com/jobayer1n1/Letterboxd-Plus/main/embed_servers.json";
const embedServersJsonBlobUrl =
  "https://github.com/jobayer1n1/Letterboxd-Plus/blob/main/embed_servers.json?raw=1";
const releaseApiUrl = "https://api.github.com/repos/jobayer1n1/Letterboxd-Plus/releases/latest";
const STORAGE_ENABLED_KEY = "scriptsEnabled";
const STORAGE_SERVERS_KEY = "serverTemplates";

const manifestVersion = chrome.runtime.getManifest().version;
appVersionEl.textContent = `v${manifestVersion}`;
let latestReleasePageUrl = "";

let canSaveServer = false;
let lastCheckedServerTemplate = "";
let lastCheckedServerName = "";

function setSaveServerEnabled(enabled) {
  canSaveServer = Boolean(enabled);
  saveServerBtn.disabled = !canSaveServer;
}

function resetServerCheckState() {
  lastCheckedServerTemplate = "";
  lastCheckedServerName = "";
  setSaveServerEnabled(false);
}

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

function setDefaultsFeedback(message, type = "default") {
  const text = String(message || "").trim();
  defaultsFeedbackEl.textContent = text;
  defaultsFeedbackEl.classList.toggle("shown", Boolean(text));
  defaultsFeedbackEl.classList.remove("success", "error");
  if (type === "success" || type === "error") {
    defaultsFeedbackEl.classList.add(type);
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

function sanitizeServers(value) {
  const sanitized = [];
  const byTemplate = new Set();

  (Array.isArray(value) ? value : []).forEach((server) => {
    if (!server || !server.name || !server.template) return;
    const name = String(server.name).trim();
    const template = String(server.template).trim();
    if (!name || !template) return;

    const normalized = normalizeTemplate(template);
    if (!normalized || byTemplate.has(normalized)) return;

    sanitized.push({
      name,
      template,
      isDefault: Boolean(server.isDefault)
    });
    byTemplate.add(normalized);
  });

  return sanitized;
}

function parseJsonLenient(text) {
  const cleaned = String(text || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/,\s*([}\]])/g, "$1");

  return JSON.parse(cleaned);
}

function storageGet(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (result) => resolve(result));
  });
}

function storageSet(value) {
  return new Promise((resolve) => {
    chrome.storage.local.set(value, () => resolve());
  });
}

function loadServers(callback) {
  chrome.storage.local.get([STORAGE_SERVERS_KEY], (result) => {
    callback(sanitizeServers(result[STORAGE_SERVERS_KEY]));
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

async function fetchDefaultServers() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const candidates = [embedServersJsonRawUrl, embedServersJsonBlobUrl];
    let lastError = null;
    let payloadText = null;

    for (const url of candidates) {
      try {
        const response = await fetch(url, {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
          headers: { Accept: "application/json" }
        });

        if (!response.ok) {
          lastError = new Error(`HTTP ${response.status}`);
          continue;
        }

        payloadText = await response.text();
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (!payloadText) {
      throw lastError || new Error("Fetch failed");
    }

    const trimmed = payloadText.trim();
    if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) {
      throw new Error("Response was not JSON");
    }

    const payload = parseJsonLenient(payloadText);
    const list = Array.isArray(payload) ? payload : [];
    const defaults = [];

    list.forEach((server) => {
      if (!server || !server.name || !server.template) return;
      const name = String(server.name).trim();
      const template = String(server.template).trim();
      const validationError = validateInputs(name, template);
      if (validationError) return;
      defaults.push({ name, template, isDefault: true });
    });

    return sanitizeServers(defaults).map((server) => ({ ...server, isDefault: true }));
  } catch (error) {
    console.error("Letterboxd+: fetchDefaultServers failed", error);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeServerName(name) {
  return String(name || "").trim().toLowerCase();
}

function serversMatch(a, b) {
  return (
    normalizeTemplate(a.template) === normalizeTemplate(b.template) &&
    normalizeServerName(a.name) === normalizeServerName(b.name)
  );
}

function diffDefaults(storedDefaults, fetchedDefaults) {
  const retrievedList = [...fetchedDefaults];
  const storedList = [...storedDefaults];
  const defaultsToAdd = [];

  let i = 0;
  while (i < retrievedList.length) {
    const retrieved = retrievedList[i];
    const storedIndex = storedList.findIndex((stored) => serversMatch(stored, retrieved));
    if (storedIndex >= 0) {
      storedList.splice(storedIndex, 1);
      retrievedList.splice(i, 1);
      defaultsToAdd.push(retrieved);
      continue;
    }
    i += 1;
  }

  return {
    upToDate: storedList.length === 0 && retrievedList.length === 0,
    defaultsToAdd,
    remainingRetrieved: retrievedList
  };
}

async function ensureServersInitialized() {
  const result = await storageGet([STORAGE_SERVERS_KEY]);
  const existing = sanitizeServers(result[STORAGE_SERVERS_KEY]);
  if (existing.length > 0) return existing;

  setDefaultsFeedback("Setting default servers...");
  try {
    const fetchedDefaults = await fetchDefaultServers();
    if (!fetchedDefaults.length) {
      throw new Error("No defaults fetched");
    }

    await storageSet({ [STORAGE_SERVERS_KEY]: fetchedDefaults });
    setDefaultsFeedback("Successfully set.", "success");
    return fetchedDefaults;
  } catch (error) {
    const msg =
      error && error.message ? `Something went wrong. (${error.message})` : "Something went wrong.";
    setDefaultsFeedback(msg, "error");
    return [];
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

  const normalizedTemplate = normalizeTemplate(template);
  const normalizedChecked = normalizeTemplate(lastCheckedServerTemplate);
  if (
    !canSaveServer ||
    !lastCheckedServerTemplate ||
    normalizedTemplate !== normalizedChecked ||
    name !== lastCheckedServerName
  ) {
    setFeedback("Check connection successfully before saving.", "error");
    setSaveServerEnabled(false);
    return;
  }

  loadServers((servers) => {
    if (!servers.length) {
      ensureServersInitialized().then((seeded) => {
        if (!seeded.length) {
          setFeedback("Something went wrong.", "error");
          return;
        }

        const existing = seeded.find(
          (server) => normalizeTemplate(server.template) === normalizedTemplate
        );

        if (existing) {
          setFeedback(`Already exists ${existing.name}`, "error");
          return;
        }

        const updated = [...seeded, { name, template, isDefault: false }];
        chrome.storage.local.set({ [STORAGE_SERVERS_KEY]: updated }, () => {
          renderServerList(updated);
          setFeedback("Server saved successfully.", "success");
          serverNameEl.value = "";
          serverLinkEl.value = "";
          resetServerCheckState();
          sendMessageToActiveTab({ type: "LETTERBOXD_PLUS_SERVERS_UPDATED" });
        });
      });
      return;
    }

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
      resetServerCheckState();
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
  resetServerCheckState();
});

checkConnectionBtn.addEventListener("click", async () => {
  const name = serverNameEl.value.trim();
  const template = serverLinkEl.value.trim();
  setSaveServerEnabled(false);
  checkConnectionBtn.disabled = true;
  try {
    const ok = await checkConnection(name, template);
    if (ok) {
      lastCheckedServerTemplate = template;
      lastCheckedServerName = name;
      setSaveServerEnabled(true);
    } else {
      resetServerCheckState();
    }
  } finally {
    checkConnectionBtn.disabled = false;
  }
});

saveServerBtn.addEventListener("click", saveServer);

serverNameEl.addEventListener("input", () => {
  resetServerCheckState();
});

serverLinkEl.addEventListener("input", () => {
  resetServerCheckState();
});

serverListEl.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (!target.classList.contains("server-delete")) return;

  const template = target.dataset.template;
  if (!template) return;

  loadServers((servers) => {
    if (!servers.length) return;
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

(async () => {
  const servers = await ensureServersInitialized();
  renderServerList(servers);
})();

manualBtn.addEventListener("click", () => {
  chrome.tabs.create({
    url: manualUrl,
  });
});

refreshServersBtn.addEventListener("click", async () => {
  refreshServersBtn.disabled = true;
  resetServerCheckState();
  setDefaultsFeedback("Refreshing servers...");

  try {
    const fetchedDefaults = await fetchDefaultServers();
    if (!fetchedDefaults.length) {
      setDefaultsFeedback("Something went wrong. (No valid servers found)", "error");
      return;
    }

    const result = await storageGet([STORAGE_SERVERS_KEY]);
    const existing = sanitizeServers(result[STORAGE_SERVERS_KEY]);
    const storedDefaults = existing.filter((server) => server.isDefault);
    const customServers = existing.filter((server) => !server.isDefault);

    const { upToDate, defaultsToAdd, remainingRetrieved } = diffDefaults(
      storedDefaults,
      fetchedDefaults
    );

    if (upToDate) {
      setDefaultsFeedback("Up to date.", "success");
      return;
    }

    const newDefaults = sanitizeServers([...defaultsToAdd, ...remainingRetrieved]).map(
      (server) => ({ ...server, isDefault: true })
    );
    const nextServers = sanitizeServers([...newDefaults, ...customServers]).map((server) => ({
      ...server,
      isDefault: Boolean(server.isDefault)
    }));

    await storageSet({ [STORAGE_SERVERS_KEY]: nextServers });
    renderServerList(nextServers);
    setDefaultsFeedback("Successfully set.", "success");
    sendMessageToActiveTab({ type: "LETTERBOXD_PLUS_SERVERS_UPDATED" });
  } catch (error) {
    const msg = error && error.message ? `Something went wrong. (${error.message})` : "Something went wrong.";
    setDefaultsFeedback(msg, "error");
  } finally {
    refreshServersBtn.disabled = false;
  }
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
