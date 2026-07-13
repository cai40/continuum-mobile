import { Platform } from "react-native";
import { API_URL, RENDER_EMAIL_BRIDGE_URL } from "../constants/Config";
import {
  loadLocalPinnedMemories,
  saveLocalPinnedMemory,
  mergePinnedMemories,
  removeLocalPinnedMemory,
  removeLocalPinnedByContent,
  dedupeLocalPinnedMemories,
} from "../utils/localPinnedMemory";
import { loadHiddenMemories, hideMemoryItem, filterHiddenMemoryList } from "../utils/hiddenMemories";
import { memoryItemText } from "../utils/memoryDisplay";
import {
  findDuplicateGroups,
  memoryContentFingerprint,
  pickDuplicateRemovals,
} from "../utils/memoryDedup";

/**
 * GLOBAL PULSE ENGINE:
 * A resilient fetch wrapper that handles Render cold-starts, timeouts,
 * and safe JSON parsing across the entire app.
 */
export const pulseFetch = async (
  url,
  options = {},
  maxRetries = 3,
  onStatusUpdate = null,
  authToken = null,
) => {
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": "Continuum-Mobile/1.0",
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...options.headers,
  };

  let attempt = 0;
  const execute = async () => {
    attempt++;
    try {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("PULSE_TIMEOUT")), 60000),
      );

      const fetchPromise = (async () => {
        const res = await fetch(url, { ...options, headers });
        if (!res.ok) throw new Error("UPSTREAM_WAKING");

        const contentType = res.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          return await res.json();
        }
        return { status: "success_no_content" };
      })();

      return await Promise.race([fetchPromise, timeoutPromise]);
    } catch (err) {
      if (
        attempt <= maxRetries &&
        (err.message === "PULSE_TIMEOUT" || err.message === "UPSTREAM_WAKING")
      ) {
        if (onStatusUpdate) onStatusUpdate(true);
        console.log(
          `[Pulse] Bridge busy (Attempt ${attempt}). The Cloud is likely thinking or warming up...`,
        );
        await new Promise((r) => setTimeout(r, 6000));
        return execute();
      }
      throw err;
    }
  };

  try {
    const data = await execute();
    if (onStatusUpdate) onStatusUpdate(false);
    return data;
  } catch (e) {
    if (onStatusUpdate) onStatusUpdate(false);
    throw e;
  }
};

export const fetchBrainAnalytics = async (
  onStatusUpdate = null,
  authToken = null,
) => {
  try {
    const data = await pulseFetch(
      `${API_URL}/brain/analytics`,
      {},
      3,
      onStatusUpdate,
      authToken,
    );
    if (data && !data.error) return data;
  } catch (err) {
    console.log("Analytics Fetch Error:", err);
    throw err;
  }
};

export const fetchChatHistory = async (
  onStatusUpdate = null,
  authToken = null,
) => {
  try {
    const data = await pulseFetch(
      `${API_URL}/chat/history`,
      {},
      3,
      onStatusUpdate,
      authToken,
    );
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.warn("History Fetch Failed:", err);
    return [];
  }
};

export const fetchMemories = async (
  onStatusUpdate = null,
  authToken = null,
  userId = null,
) => {
  try {
    const [rawLayerData, pinData, analytics, localPins, hiddenMemories] = await Promise.all([
      pulseFetch(`${API_URL}/memories`, {}, 3, onStatusUpdate, authToken).catch(() => null),
      pulseFetch(
        `${API_URL}/memories/pinned`,
        {},
        3,
        onStatusUpdate,
        authToken,
      ).catch(() => []),
      fetchBrainAnalytics(onStatusUpdate, authToken).catch(() => ({})),
      loadLocalPinnedMemories(userId),
      loadHiddenMemories(userId),
    ]);
    const mergedPins = mergePinnedMemories(pinData, localPins);
    const filterHidden = (items, layer) =>
      filterHiddenMemoryList(items, layer, hiddenMemories, memoryItemText);
    const visiblePins = filterHidden(mergedPins, 'l1');

    // SMART MAPPING: Handle 2.0 Structured Maps OR 1.0 Flat Arrays
    let processedLayeredData = {
      semanticProfile: [],
      temporalEvents: [],
      episodicSegments: [],
      knowledgeBase: [],
      trueCounts: { l1: 0, l2: 0, l3: 0, l4: 0, l5: 0 }
    };

    if (rawLayerData && !Array.isArray(rawLayerData)) {
      // 2.0 Match
      processedLayeredData = {
        semanticProfile: filterHidden(rawLayerData.semanticProfile || [], 'l3'),
        temporalEvents: filterHidden(rawLayerData.temporalEvents || [], 'l4'),
        episodicSegments: filterHidden(rawLayerData.episodicSegments || [], 'l2'),
        knowledgeBase: filterHidden(rawLayerData.knowledgeBase || [], 'l5'),
        trueCounts: rawLayerData.trueCounts || { l1: 0, l2: 0, l3: 0, l4: 0, l5: 0 }
      };
    } else if (Array.isArray(rawLayerData)) {
      // 1.0 Rollback/Transition safety
      processedLayeredData.episodicSegments = filterHidden(rawLayerData, 'l2');
    }

    // HYBRID SYNC: Inject local L1 counts into the global metrics
    if (processedLayeredData.trueCounts) {
       processedLayeredData.trueCounts.l1 = Array.isArray(visiblePins) ? visiblePins.length : 0;
       processedLayeredData.trueCounts.l2 = processedLayeredData.episodicSegments?.length ?? processedLayeredData.trueCounts.l2;
       processedLayeredData.trueCounts.l3 = processedLayeredData.semanticProfile?.length ?? processedLayeredData.trueCounts.l3;
       processedLayeredData.trueCounts.l4 = processedLayeredData.temporalEvents?.length ?? processedLayeredData.trueCounts.l4;
       processedLayeredData.trueCounts.l5 = processedLayeredData.knowledgeBase?.length ?? processedLayeredData.trueCounts.l5;
    }

    return {
      layeredData: processedLayeredData,
      pinData: Array.isArray(visiblePins) ? visiblePins : [],
      analytics: analytics || {},
    };
  } catch (e) {
    console.warn("Memory Fetch Failed:", e);
    const localPins = await loadLocalPinnedMemories(userId);
    if (localPins.length) {
      return {
        layeredData: {
          semanticProfile: [],
          temporalEvents: [],
          episodicSegments: [],
          knowledgeBase: [],
          trueCounts: { l1: localPins.length, l2: 0, l3: 0, l4: 0, l5: 0 },
        },
        pinData: localPins,
        analytics: {},
      };
    }
    throw e;
  }
};

export async function pinCoreMemory(content, authToken, label = 'Email evidence', userId = null) {
  const trimmed = String(content || '').trim();
  if (!trimmed) throw new Error('Empty pin content');
  if (!authToken) throw new Error('Not signed in');

  let pin;
  try {
    pin = await saveLocalPinnedMemory(userId, trimmed, label);
  } catch (e) {
    throw new Error(e?.message || 'Could not save pin on this device.');
  }

  // Best-effort cloud sync (POST /memories/pin is not on Render today — do not block UI).
  fetch(`${API_URL}/memories/pin`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
      'User-Agent': 'Continuum-Mobile/1.0',
    },
    body: JSON.stringify({ content: trimmed, label }),
  }).catch(() => {});

  return { status: 'success', pin, source: 'local' };
}

const LAYER_TABLE = {
  l1: 'pinned_memories',
  l2: 'episodic_segments',
  l3: 'semantic_memories',
  l4: 'temporal_events',
  l5: 'document_chunks',
};

async function tryCloudDeleteMemory(layer, id, authToken) {
  if (!authToken || id == null || String(id).trim() === '') return false;
  const sid = String(id);
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${authToken}`,
    'User-Agent': 'Continuum-Mobile/1.0',
  };
  const attempts = [
    {
      url: `${API_URL}/memories/delete`,
      options: {
        method: 'POST',
        headers,
        body: JSON.stringify({ layer, id: sid, table: LAYER_TABLE[layer] }),
      },
    },
    {
      url: `${API_URL}/memories/${layer}/${encodeURIComponent(sid)}`,
      options: { method: 'DELETE', headers },
    },
    ...(layer === 'l1'
      ? [{
          url: `${API_URL}/memories/pinned/${encodeURIComponent(sid)}`,
          options: { method: 'DELETE', headers },
        }]
      : []),
  ];
  for (const { url, options } of attempts) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return true;
    } catch {
      // try next endpoint shape
    }
  }
  return false;
}

/**
 * Remove one memory item. L1 local pins delete from AsyncStorage; cloud rows
 * call backend when available, otherwise hide on this device.
 */
export async function deleteMemoryItem(layer, item, authToken, userId = null) {
  const layerKey = String(layer || '').toLowerCase();
  if (!['l1', 'l2', 'l3', 'l4', 'l5'].includes(layerKey)) {
    throw new Error('Invalid memory layer');
  }
  const content = memoryItemText(item, layerKey);
  const fingerprint = memoryContentFingerprint(content);
  const id = item?.id;

  if (layerKey === 'l1') {
    if (item?.local && id) {
      await removeLocalPinnedMemory(userId, id);
    }
    if (content) {
      await removeLocalPinnedByContent(userId, content);
    }
  }

  const cloudDeleted = await tryCloudDeleteMemory(layerKey, id, authToken);
  if (!cloudDeleted) {
    await hideMemoryItem(userId, layerKey, { id, contentFingerprint: fingerprint });
  }

  return { cloudDeleted, hidden: !cloudDeleted };
}

/** Remove duplicate items in one layer (keeps newest per normalized content). */
export async function dedupeMemoryLayer(layer, items, authToken, userId = null) {
  const layerKey = String(layer || '').toLowerCase();
  const groups = findDuplicateGroups(items, layerKey, memoryItemText);
  let removed = 0;

  if (layerKey === 'l1') {
    const { removed: localRemoved } = await dedupeLocalPinnedMemories(userId);
    removed += localRemoved;
  }

  for (const group of groups) {
    const victims = pickDuplicateRemovals(group, layerKey, memoryItemText);
    for (const item of victims) {
      await deleteMemoryItem(layerKey, item, authToken, userId);
      removed += 1;
    }
  }
  return removed;
}

/** Dedupe all visible layers; returns counts per layer. */
export async function dedupeAllMemoryLayers(layers, authToken, userId = null) {
  const specs = [
    ['l1', layers.pinnedMemories],
    ['l2', layers.episodicSegments],
    ['l3', layers.semanticProfile],
    ['l4', layers.temporalEvents],
    ['l5', layers.knowledgeBase],
  ];
  const counts = {};
  for (const [layer, items] of specs) {
    counts[layer] = await dedupeMemoryLayer(layer, items || [], authToken, userId);
  }
  return counts;
}

export const chatStream = (
  formData,
  onUpdate,
  onDone,
  onError,
  authToken = null,
) => {
  const xhr = new XMLHttpRequest();
  let lastProcessedIndex = 0;
  let doneCalled = false;
  let fullText = "";
  let userTranscript = "";
  let currentEvent = "";

  const finish = (errorMsg) => {
    if (doneCalled) return;
    doneCalled = true;
    if (errorMsg) onError(errorMsg);
    else onDone(fullText, userTranscript);
  };

  const handleHttpError = () => {
    const responseText = xhr.responseText || "";
    let msg = `Chat error (${xhr.status})`;
    if (responseText.trim()) {
      try {
        const parsed = JSON.parse(responseText);
        msg = parsed.detail || parsed.error || parsed.message || responseText;
      } catch {
        msg = responseText;
      }
    }
    finish(msg);
  };

  xhr.open("POST", `${API_URL}/chat/stream`);
  
  // Resiliency: Set a long timeout for streaming (60s) to prevent permanent hangs
  xhr.timeout = 60000; 
  
  if (authToken) {
    xhr.setRequestHeader("Authorization", `Bearer ${authToken}`);
  } else {
    console.warn("API_SERVICE: chatStream called WITHOUT authToken!");
  }

  xhr.onreadystatechange = () => {
    if (xhr.readyState === 3 || xhr.readyState === 4) {
      if (xhr.readyState === 4 && xhr.status >= 400) {
        handleHttpError();
        return;
      }

      const responseText = xhr.responseText;
      if (!responseText) {
        if (xhr.readyState === 4) finish(null);
        return;
      }

      let lastNewLineIndex = responseText.lastIndexOf("\n");
      if (xhr.readyState === 4) lastNewLineIndex = responseText.length;

      if (lastNewLineIndex <= lastProcessedIndex) {
        if (xhr.readyState === 4) finish(null);
        return;
      }

      const completeData = responseText.substring(
        lastProcessedIndex,
        lastNewLineIndex,
      );
      lastProcessedIndex = lastNewLineIndex;
      const lines = completeData.split("\n");

      lines.forEach((rawLine) => {
        const line = rawLine.trim();
        if (!line) return;

        if (line.startsWith("event: ")) {
          currentEvent = line.replace("event: ", "").trim();
        } else if (line.startsWith("data: ")) {
          const rawData = line.replace("data: ", "").trim();

          if (rawData === "[DONE]") {
            finish(null);
            return;
          }

          try {
            const json = JSON.parse(rawData);
            onUpdate(currentEvent, json);
            if (currentEvent === "text" && json.token) {
              fullText += json.token;
            } else if (currentEvent === "transcript" && json.text) {
              userTranscript = json.text;
            }
          } catch (e) {}
        }
      });

      if (xhr.readyState === 4) finish(null);
    }
  };

  xhr.onerror = () => finish("Network error or server unreachable.");

  xhr.send(formData);

  return xhr; // Return for cancellation (abort)
};

/**
 * Chat via OpenClaw VPS bridge: Continuum memory + Yahoo email skills.
 */
function sanitizeBridgeErrorMessage(raw, status) {
  const text = String(raw || "").trim();
  if (!text) return `Bridge error (${status || "unknown"})`;
  if (/^\s*</.test(text) || /<!DOCTYPE/i.test(text) || /<html/i.test(text)) {
    if (/cloudflare/i.test(text)) {
      return "Cloudflare timed out the bridge connection. Email fetch can take 1–2 minutes — retry with a smaller range, or wait and try again.";
    }
    if (status === 502 || status === 503 || status === 504) {
      return `Bridge or backend unavailable (${status}). Try again shortly.`;
    }
    return "Server returned an HTML error page instead of a chat reply. Check HTTPS bridge URL in Setup and retry.";
  }
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

function friendlyBridgeError(raw, status) {
  const text = String(raw || '').trim();
  if (/not\s*found/i.test(text) && (status === 404 || /"detail"\s*:\s*"Not Found"/i.test(text))) {
    return 'Continuum backend returned Not Found (404). On Render, set CONTINUUM_API_URL to https://continuum-backend-0q9j.onrender.com only — not /integrations/email. Then redeploy continuum-email-bridge.';
  }
  return sanitizeBridgeErrorMessage(text, status);
}

/** Avoid Maximum call stack size exceeded when history contains circular refs. */
function safeJsonStringify(value) {
  const seen = new WeakSet();
  return JSON.stringify(value, (_key, val) => {
    if (typeof val === 'object' && val !== null) {
      if (seen.has(val)) return undefined;
      seen.add(val);
    }
    if (typeof val === 'string' && val.length > 600_000) {
      return `${val.slice(0, 600_000)}… [truncated]`;
    }
    return val;
  });
}

function parseBridgeHttpError(responseText, status) {
  let msg = `Bridge error (${status})`;
  if (!responseText?.trim()) return msg;
  try {
    const outer = JSON.parse(responseText);
    let detail = outer.error || outer.detail || outer.message;
    if (typeof detail === "string" && detail.trim().startsWith("{")) {
      try {
        const inner = JSON.parse(detail);
        detail = inner.detail || inner.error || detail;
      } catch (e) {}
    }
    if (detail) msg = friendlyBridgeError(String(detail), status);
    else if (status === 404) msg = friendlyBridgeError(responseText, status);
  } catch (e) {
    msg = friendlyBridgeError(responseText, status);
  }
  return msg;
}

export const openClawChatStream = (
  bridgeBaseUrl,
  bridgeSecret,
  payload,
  onUpdate,
  onDone,
  onError,
  authToken = null,
  timeoutMs = 180000,
) => {
  const xhr = new XMLHttpRequest();
  let lastProcessedIndex = 0;
  let doneCalled = false;
  let fullText = "";
  let userTranscript = "";
  let currentEvent = "";
  let lastStreamError = "";

  const pullToken = (json) => json.token ?? json.content ?? json.text ?? json.delta ?? "";

  const finish = (errorMsg) => {
    if (doneCalled) return;
    doneCalled = true;
    if (errorMsg) onError(errorMsg);
    else onDone(fullText, userTranscript);
  };

  const handleComplete = () => {
    if (xhr.status >= 400) {
      finish(parseBridgeHttpError(xhr.responseText, xhr.status));
      return;
    }

    const responseText = xhr.responseText || "";
    const trimmed = responseText.trim();
    if (!trimmed) {
      finish(fullText ? null : (lastStreamError || "Empty response from OpenClaw bridge."));
      return;
    }
    if (trimmed.startsWith("{") && !trimmed.includes("event:")) {
      finish(parseBridgeHttpError(responseText, xhr.status || 500));
      return;
    }
    if (!doneCalled) finish(null);
  };

  xhr.open("POST", `${bridgeBaseUrl.replace(/\/$/, "")}/chat/stream`);
  xhr.timeout = timeoutMs;

  xhr.setRequestHeader("Content-Type", "application/json");
  if (authToken) {
    xhr.setRequestHeader("Authorization", `Bearer ${authToken}`);
  }
  if (bridgeSecret) {
    xhr.setRequestHeader("X-Bridge-Secret", bridgeSecret);
  }

  xhr.onreadystatechange = () => {
    if (xhr.readyState === 3 || xhr.readyState === 4) {
      const responseText = xhr.responseText;

      if (xhr.readyState === 4 && xhr.status >= 400) {
        handleComplete();
        return;
      }

      if (!responseText) {
        if (xhr.readyState === 4) handleComplete();
        return;
      }

      let lastNewLineIndex = responseText.lastIndexOf("\n");
      if (xhr.readyState === 4) lastNewLineIndex = responseText.length;

      if (lastNewLineIndex <= lastProcessedIndex) {
        if (xhr.readyState === 4) handleComplete();
        return;
      }

      const completeData = responseText.substring(
        lastProcessedIndex,
        lastNewLineIndex,
      );
      lastProcessedIndex = lastNewLineIndex;
      const lines = completeData.split("\n");

      lines.forEach((rawLine) => {
        const line = rawLine.trim();
        if (!line) return;

        if (line.startsWith("event: ")) {
          currentEvent = line.replace("event: ", "").trim();
        } else if (line.startsWith("data: ")) {
          const rawData = line.replace("data: ", "").trim();

          if (rawData === "[DONE]") {
            finish(null);
            return;
          }

          try {
            const json = JSON.parse(rawData);
            onUpdate(currentEvent, json);
            const token = pullToken(json);
            if (currentEvent === "text" && token) {
              fullText += token;
            } else if (!currentEvent && token) {
              onUpdate("text", { token });
              fullText += token;
            } else if (currentEvent === "transcript" && json.text) {
              userTranscript = json.text;
            } else if (currentEvent === "error") {
              lastStreamError = friendlyBridgeError(
                json.detail || json.message || "OpenClaw bridge error",
                xhr.status,
              );
              finish(lastStreamError);
            }
          } catch (e) {}
        }
      });

      if (xhr.readyState === 4) handleComplete();
    }
  };

  xhr.onerror = () => finish(timeoutMs >= 600000
    ? "Email bridge timed out after 10 minutes. Try a smaller batch (limit 500) or summary-only fetch."
    : "Cannot reach OpenClaw bridge.");
  xhr.ontimeout = () => finish(timeoutMs >= 600000
    ? "Email fetch timed out (10 min). Large inbox scans take time — retry with limit 50000 or wait and try again."
    : "OpenClaw bridge timed out.");

  xhr.send(safeJsonStringify(payload));

  return xhr;
};

export const renderEmailChatStream = (
  bridgeSecret,
  payload,
  onUpdate,
  onDone,
  onError,
  authToken = null,
) =>
  openClawChatStream(
    RENDER_EMAIL_BRIDGE_URL,
    bridgeSecret,
    payload,
    onUpdate,
    onDone,
    onError,
    authToken,
    600000,
  );

export const testRenderEmailHealth = async (bridgeSecret) =>
  testOpenClawBridge(RENDER_EMAIL_BRIDGE_URL, bridgeSecret);

export const fetchDailyCleanupLatest = async (bridgeSecret) => {
  const res = await fetch(`${RENDER_EMAIL_BRIDGE_URL.replace(/\/$/, "")}/daily-cleanup/latest`, {
    headers: bridgeSecret ? { "X-Bridge-Secret": bridgeSecret } : {},
  });
  if (!res.ok) throw new Error(`Daily cleanup status failed (${res.status})`);
  return res.json();
};

export const runDailyCleanupNow = async (bridgeSecret) => {
  const res = await fetch(`${RENDER_EMAIL_BRIDGE_URL.replace(/\/$/, "")}/daily-cleanup/run`, {
    method: "POST",
    headers: bridgeSecret ? { "X-Bridge-Secret": bridgeSecret } : {},
  });
  if (!res.ok) throw new Error(`Daily cleanup run failed (${res.status})`);
  return res.json();
};

export const testOpenClawBridge = async (bridgeBaseUrl, bridgeSecret) => {
  const res = await fetch(`${bridgeBaseUrl.replace(/\/$/, "")}/health`, {
    headers: bridgeSecret ? { "X-Bridge-Secret": bridgeSecret } : {},
  });
  if (!res.ok) throw new Error(`Bridge health check failed (${res.status})`);
  return res.json();
};

/**
 * LAYER 5 INGESTION:
 * Uploads document(s) (PDF, Word, PowerPoint, Excel, text) to be vectorized into the cloud knowledge base.
 */
export const ingestDocument = async (
  fileUri,
  fileName,
  mimeType,
  onStatusUpdate = null,
  authToken = null,
) => {
  const formData = new FormData();
  formData.append("file", {
    uri: fileUri,
    name: fileName,
    type: mimeType,
  });

  try {
    const data = await pulseFetch(
      `${API_URL}/memories/ingest`,
      {
        method: "POST",
        body: formData,
        headers: {
          "Content-Type": "multipart/form-data",
        },
      },
      3,
      onStatusUpdate,
      authToken,
    );
    return data;
  } catch (err) {
    console.error("Ingestion Service Error:", err);
    throw err;
  }
};

/**
 * Upload multiple documents sequentially to Layer 5.
 * Returns { succeeded: [{name, result}], failed: [{name, error}] }
 */
export const ingestDocuments = async (
  files,
  { onStatusUpdate = null, authToken = null, onFileStart = null } = {},
) => {
  const succeeded = [];
  const failed = [];
  const list = Array.isArray(files) ? files : [];

  for (let i = 0; i < list.length; i += 1) {
    const file = list[i];
    if (onFileStart) onFileStart(i + 1, list.length, file.name);
    try {
      const result = await ingestDocument(
        file.uri,
        file.name,
        file.type,
        onStatusUpdate,
        authToken,
      );
      succeeded.push({ name: file.name, result });
    } catch (err) {
      failed.push({ name: file.name, error: err.message || String(err) });
    }
  }

  return { succeeded, failed, total: list.length };
};
export const fetchSystemVersion = async () => {
  try {
    const data = await pulseFetch(`${API_URL}/system/version`, { method: "GET" });
    return data?.version || "Unknown";
  } catch (err) {
    console.warn("Failed to fetch system version:", err);
    return "Offline";
  }
};
