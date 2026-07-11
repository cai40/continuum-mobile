import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import { throwIfPhotoCleanupCancelled } from './photoCleanupCancel';

const SCREENSHOT_NAME_RE = /screenshot|screen.?shot|screencapture|simulator|capture|screenrecording/i;
const CODING_NAME_RE = /vscode|xcode|android.?studio|terminal|ide|code|debug|console|stack\s*trace/i;
const RECEIPT_NAME_RE = /\b(receipt|receipts|invoice|invoices|e-?receipt|order\s*confirm|purchase|transaction|payment|paid|refund|reimburs|expense|parking\s*(?:ticket|pass|receipt)|ticket|barcode|tax|w-?2|1099|statement|billing|checkout|venmo|paypal|zelle|cash\s*app|apple\s*pay|google\s*pay|square|toast|pos)\b/i;
const MONITOR_RATIOS = [16 / 9, 16 / 10, 4 / 3, 3 / 2, 19.5 / 9, 20 / 9, 21 / 9];

const VISION_BATCH_SIZE = 6;
const VISION_CANDIDATE_CAP = 48;
const TEXTURE_CANDIDATE_RATIO = 0.25;

function isMonitorAspectRatio(width, height) {
  if (!width || !height) return false;
  const ratio = Math.max(width, height) / Math.min(width, height);
  return MONITOR_RATIOS.some((r) => Math.abs(ratio - r) < 0.08);
}

function isScreenshotFilename(filename = '') {
  return SCREENSHOT_NAME_RE.test(filename);
}

export function isCodingScreenshot(asset) {
  const name = String(asset.filename || '');
  const lower = name.toLowerCase();
  const png = lower.endsWith('.png');
  const monitorRatio = isMonitorAspectRatio(asset.width, asset.height);

  if (CODING_NAME_RE.test(name)) return true;
  if (isScreenshotFilename(name) && monitorRatio) return true;
  if (isScreenshotFilename(name) && png) return true;
  if (monitorRatio && png && /img_|screen|snap/i.test(name)) return true;

  return false;
}

/** Receipt / invoice / payment photos — never pick as favorites. */
export function isReceiptPhoto(asset) {
  const name = String(asset.filename || '');
  const lower = name.toLowerCase();
  if (RECEIPT_NAME_RE.test(name)) return true;

  // Document-style screenshot: tall narrow capture, not a full camera photo.
  if (isScreenshotFilename(name)) {
    const w = asset.width || 0;
    const h = asset.height || 0;
    if (w > 0 && h > 0) {
      const ratio = Math.max(w, h) / Math.min(w, h);
      if (ratio >= 2.2 && ratio <= 4.5 && Math.min(w, h) < 1400) {
        return true;
      }
    }
    if (/scan|document|doc_|camscanner|genius\s*scan|adobe\s*scan|microsoft\s*lens/i.test(lower)) {
      return true;
    }
  }

  return false;
}

/** Fast metadata score — resolution, non-screenshot, recency. */
export function scorePhotoQuick(asset) {
  if (isReceiptPhoto(asset)) return 0;
  const pixels = (asset.width || 0) * (asset.height || 0);
  const resolution = pixels > 0 ? Math.log10(pixels) / 7 : 0;
  const notScreenshot = isCodingScreenshot(asset) || isScreenshotFilename(asset.filename) ? 0 : 0.25;
  const landscapeBonus = asset.width > asset.height ? 0.05 : 0;
  const recency = asset.creationTime
    ? Math.min(0.1, (Date.now() - asset.creationTime) / (1000 * 60 * 60 * 24 * 365 * -10) + 0.1)
    : 0;

  return resolution * 0.55 + notScreenshot + landscapeBonus + recency;
}

function byteVariance(base64) {
  const sample = base64.slice(Math.min(512, base64.length * 0.1), Math.min(base64.length, 4096));
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < sample.length; i++) {
    const v = sample.charCodeAt(i);
    sum += v;
    sumSq += v * v;
  }
  if (!sample.length) return 0;
  const mean = sum / sample.length;
  return Math.max(0, sumSq / sample.length - mean * mean);
}

/** On-device texture / complexity proxy from a tiny JPEG thumbnail. */
export async function scorePhotoTexture(uri) {
  try {
    const manipulated = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 64, height: 64 } }],
      { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
    );
    const base64 = await FileSystem.readAsStringAsync(manipulated.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const variance = byteVariance(base64);
    return Math.min(1, variance / 1800);
  } catch {
    return 0;
  }
}

async function assetToVisionBase64(uri) {
  const manipulated = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 384, height: 384 } }],
    { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG },
  );
  return FileSystem.readAsStringAsync(manipulated.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
}

function parseVisionScores(text, expected) {
  try {
    const match = String(text).match(/\[[\s\S]*?\]/);
    if (match) {
      const arr = JSON.parse(match[0]);
      if (Array.isArray(arr) && arr.length === expected) {
        return arr.map((n) => Math.max(0, Math.min(10, Number(n) || 0)) / 10);
      }
    }
  } catch {
    // fall through
  }
  const nums = String(text).match(/\d+(?:\.\d+)?/g);
  if (nums?.length >= expected) {
    return nums.slice(0, expected).map((n) => Math.max(0, Math.min(10, Number(n))) / 10);
  }
  return null;
}

async function scoreBatchWithGemini(images, apiKey) {
  const parts = [
    {
      text: `Rate each photo's aesthetic appeal from 0-10 (composition, lighting, subject, not blurry). `
        + `Return ONLY a JSON array of ${images.length} numbers in the same order as the images.`,
    },
    ...images.map((img) => ({
      inline_data: { mime_type: 'image/jpeg', data: img.base64 },
    })),
  ];

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 256 },
    }),
  });

  if (!res.ok) throw new Error(`Gemini vision failed (${res.status})`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
  const scores = parseVisionScores(text, images.length);
  if (!scores) throw new Error('Gemini vision returned unparseable scores');
  return scores;
}

async function scoreBatchWithOpenAI(images, apiKey) {
  const content = [
    {
      type: 'text',
      text: `Rate each attached photo's aesthetic appeal from 0-10. Return ONLY a JSON array of ${images.length} numbers in order.`,
    },
    ...images.map((img) => ({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${img.base64}`, detail: 'low' },
    })),
  ];

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      max_tokens: 256,
      messages: [{ role: 'user', content }],
    }),
  });

  if (!res.ok) throw new Error(`OpenAI vision failed (${res.status})`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || '';
  const scores = parseVisionScores(text, images.length);
  if (!scores) throw new Error('OpenAI vision returned unparseable scores');
  return scores;
}

export async function loadVisionApiCredentials() {
  try {
    const [[, gemini], [, openai]] = await AsyncStorage.multiGet(['@gemini_key', '@openai_key']);
    if (gemini?.trim()) return { provider: 'gemini', apiKey: gemini.trim() };
    if (openai?.trim()) return { provider: 'openai', apiKey: openai.trim() };
  } catch {
    // ignore
  }
  return null;
}

/**
 * Score photos for favorites: quick metadata pass, texture analysis on top candidates,
 * optional Gemini/OpenAI vision when an API key is configured in Setup.
 *
 * @returns {Promise<Map<string, number>>} asset id → score 0–1
 */
export async function scorePhotosForFavorites(assets, { onProgress, visionCredentials } = {}) {
  const scores = new Map();
  if (!assets.length) return scores;

  const quick = assets.map((asset) => ({ asset, quick: scorePhotoQuick(asset) }));
  quick.sort((a, b) => b.quick - a.quick);

  for (const row of quick) {
    scores.set(row.asset.id, row.quick * 0.45);
  }

  const textureCount = Math.min(
    assets.length,
    Math.max(8, Math.ceil(assets.length * TEXTURE_CANDIDATE_RATIO)),
  );
  const textureCandidates = quick.slice(0, textureCount);

  for (let i = 0; i < textureCandidates.length; i++) {
    throwIfPhotoCleanupCancelled();
    const { asset } = textureCandidates[i];
    const texture = await scorePhotoTexture(asset.uri);
    const blended = scores.get(asset.id) + texture * 0.35;
    scores.set(asset.id, blended);
    onProgress?.(i + 1, textureCandidates.length, 'texture');
  }

  const creds = visionCredentials !== undefined ? visionCredentials : await loadVisionApiCredentials();
  if (!creds?.apiKey) {
    onProgress?.(assets.length, assets.length, 'done');
    return scores;
  }

  const visionCount = Math.min(VISION_CANDIDATE_CAP, Math.max(6, Math.ceil(assets.length * 0.15)));
  const visionCandidates = quick.slice(0, visionCount);
  let visionDone = 0;

  for (let i = 0; i < visionCandidates.length; i += VISION_BATCH_SIZE) {
    throwIfPhotoCleanupCancelled();
    const batchAssets = visionCandidates.slice(i, i + VISION_BATCH_SIZE);
    try {
      const images = await Promise.all(
        batchAssets.map(async (row) => ({
          id: row.asset.id,
          base64: await assetToVisionBase64(row.asset.uri),
        })),
      );
      const batchScores = creds.provider === 'openai'
        ? await scoreBatchWithOpenAI(images, creds.apiKey)
        : await scoreBatchWithGemini(images, creds.apiKey);

      batchAssets.forEach((row, idx) => {
        const prior = scores.get(row.asset.id) || 0;
        scores.set(row.asset.id, prior + batchScores[idx] * 0.35);
      });
    } catch {
      // Vision is optional — keep heuristic scores if API fails.
    }
    visionDone += batchAssets.length;
    onProgress?.(visionDone, visionCandidates.length, 'vision');
  }

  onProgress?.(assets.length, assets.length, 'done');
  return scores;
}
