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
 * LAYER 5 INGESTION:
 * Uploads a document (PDF/Text) to be vectorized into the cloud knowledge base.
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
