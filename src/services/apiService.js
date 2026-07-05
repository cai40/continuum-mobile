import { Platform } from "react-native";
import { API_URL } from "../constants/Config";

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
) => {
  try {
    const [rawLayerData, pinData, analytics] = await Promise.all([
      pulseFetch(`${API_URL}/memories`, {}, 3, onStatusUpdate, authToken),
      pulseFetch(
        `${API_URL}/memories/pinned`,
        {},
        3,
        onStatusUpdate,
        authToken,
      ),
      fetchBrainAnalytics(onStatusUpdate, authToken),
    ]);

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
        semanticProfile: rawLayerData.semanticProfile || [],
        temporalEvents: rawLayerData.temporalEvents || [],
        episodicSegments: rawLayerData.episodicSegments || [],
        knowledgeBase: rawLayerData.knowledgeBase || [],
        trueCounts: rawLayerData.trueCounts || { l1: 0, l2: 0, l3: 0, l4: 0, l5: 0 }
      };
    } else if (Array.isArray(rawLayerData)) {
      // 1.0 Rollback/Transition safety
      processedLayeredData.episodicSegments = rawLayerData;
    }

    // HYBRID SYNC: Inject local L1 counts into the global metrics
    if (processedLayeredData.trueCounts) {
       processedLayeredData.trueCounts.l1 = Array.isArray(pinData) ? pinData.length : 0;
    }

    return {
      layeredData: processedLayeredData,
      pinData: Array.isArray(pinData) ? pinData : [],
      analytics: analytics || {},
    };
  } catch (e) {
    console.warn("Memory Fetch Failed:", e);
    throw e;
  }
};

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
      const responseText = xhr.responseText;
      if (!responseText) return;

      let lastNewLineIndex = responseText.lastIndexOf("\n");
      if (xhr.readyState === 4) lastNewLineIndex = responseText.length;

      if (lastNewLineIndex <= lastProcessedIndex) {
        if (xhr.readyState === 4 && !doneCalled) {
          doneCalled = true;
          onDone(fullText, userTranscript);
        }
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
            if (!doneCalled) {
              doneCalled = true;
              onDone(fullText, userTranscript);
            }
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

      if (xhr.readyState === 4 && !doneCalled) {
        doneCalled = true;
        onDone(fullText, userTranscript);
      }
    }
  };

  xhr.onerror = () => onError("Network error or server unreachable.");

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
    if (detail) msg = sanitizeBridgeErrorMessage(String(detail), status);
  } catch (e) {
    msg = sanitizeBridgeErrorMessage(responseText, status);
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

  const handleComplete = () => {
    if (xhr.status >= 400) {
      finish(parseBridgeHttpError(xhr.responseText, xhr.status));
      return;
    }

    const responseText = xhr.responseText || "";
    const trimmed = responseText.trim();
    if (!trimmed) {
      finish(fullText ? null : "Empty response from OpenClaw bridge.");
      return;
    }
    if (trimmed.startsWith("{") && !trimmed.includes("event:")) {
      finish(parseBridgeHttpError(responseText, xhr.status || 500));
      return;
    }
    if (!doneCalled) finish(null);
  };

  xhr.open("POST", `${bridgeBaseUrl.replace(/\/$/, "")}/chat/stream`);
  xhr.timeout = 180000;

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
            if (currentEvent === "text" && json.token) {
              fullText += json.token;
            } else if (currentEvent === "transcript" && json.text) {
              userTranscript = json.text;
            } else if (currentEvent === "error") {
              finish(sanitizeBridgeErrorMessage(json.detail || "OpenClaw bridge error", xhr.status));
            }
          } catch (e) {}
        }
      });

      if (xhr.readyState === 4) handleComplete();
    }
  };

  xhr.onerror = () => finish("Cannot reach OpenClaw bridge.");
  xhr.ontimeout = () => finish("OpenClaw bridge timed out.");

  xhr.send(JSON.stringify(payload));

  return xhr;
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
