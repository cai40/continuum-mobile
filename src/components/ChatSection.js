import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, KeyboardAvoidingView, Platform, Image, Alert, RefreshControl, Keyboard, AppState } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { File, Paths } from 'expo-file-system';
import * as Clipboard from 'expo-clipboard';
import { Audio } from 'expo-av';
import * as Speech from 'expo-speech';
import * as Location from 'expo-location';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent
} from 'expo-speech-recognition';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAppContext } from '../context/AppContext';
import { chatStream, renderEmailChatStream, fetchDailyCleanupLatest, fetchMemories, pinCoreMemory, deepseekChatStream, fetchBridgeExcerpt, fetchChatHistory } from '../services/apiService';
import { API_URL, SILENCE_THRESHOLD, SHORT_SILENCE_TIMEOUT, LONG_SILENCE_TIMEOUT } from '../constants/Config';
import { resolveRenderEmailBridgeSecret, findPriorEmailUserMessage, buildEmailConfirmPayloadMessage } from '../utils/emailBridge';
import { resolveEmailFetchPayload } from '../utils/emailOptions';
import {
  DOCUMENT_MIME_TYPES,
  MAX_DOCUMENT_ATTACHMENTS,
  documentIconName,
  normalizePickedAsset,
} from '../utils/documentTypes';
import { appendGroundingPersona, DOCUMENT_ATTACHMENT_APPEND, WEB_SEARCH_APPEND, VOICE_MODE_APPEND } from '../utils/groundingPrompt';
import { stripMarkdownForSpeech } from '../utils/stripMarkdownForSpeech';
import AssistantMarkdown from './shared/AssistantMarkdown';
import GoogleDrivePickerModal from './GoogleDrivePickerModal';
import { isGoogleDriveConnected } from '../services/googleDriveAuth';
import { wantsWebSearch, fetchWebSearchContext, fetchLocalWeather, buildSearchQueries, searchWeb, formatSearchResults, isNoInternetClaim, lookUpErrorOnline, isProfileFollowUp, getCachedProfileContext, setBridgeExcerptFetcher } from '../utils/webSearch';
import { diagnoseChatError, rawErrorMessage } from '../utils/chatErrorDiagnosis';
import { buildMessageWithAttachments } from '../utils/documentTextExtract';
import {
  normalizeProviderId,
  providerDisplayLabel,
  deepseekPlatformModel,
  isDeepseekProvider,
  isOpenRouterKey,
  DEEPSEEK_PROVIDERS,
} from '../utils/providers';
import {
  friendlyChatError,
  attachmentSizeLimitBytes,
  formatAttachmentBytes,
  sanitizeUserVisibleContent,
  trimChatHistoryForUpload,
  trimChatHistoryForEmailRecall,
  sanitizeRecallHistory,
  safeJsonStringify,
} from '../utils/helpers';
import {
  shouldRunEmailInBackground,
  submitBackgroundEmailJob,
  pollEmailJobUntilDone,
  savePendingEmailJob,
  loadPendingEmailJob,
  loadPendingEmailJobMeta,
  peekEmailJobStatus,
  clearPendingEmailJob,
  clearEmailJobStopped,
  stopActiveEmailJob,
  cancelBackgroundEmailJob,
  isStopEmailJobMessage,
  wasEmailJobStopped,
  appendJobProgress,
  buildEmailJobPayload,
  isNetworkFailure,
  isEmailJobCancellationError,
} from '../utils/emailBackgroundJobs';
import { isComposeEmailRequest } from '../utils/emailComposeIntent';
import { wantsSlackRead, wantsSlackPost, extractSlackChannel, extractSlackPostText, resolveSlackChannel } from '../utils/slackIntent';
import { slackListChannels, slackReadMessages, slackPostMessage, slackIngestChannel } from '../services/apiService';
import { shouldSkipEmailFetchForFollowUp, isEmailAnalysisFollowUp, needsTargetedRecallEvidenceFetch, buildTargetedRecallFetchMessage, resolveRecallMonthRange, isExplicitFullEmailFetch, needsFullMinFolderRefetch } from '../utils/emailFollowUpIntent';
import { wantsContinuumMemoryRecall, buildMemoryRecallContext } from '../utils/memoryRecallContext';
import { extractEmailEvidenceForPin, attachPinOfferToMessages, shouldOfferEmailEvidencePin } from '../utils/memoryDisplay';
import { wantsPhotoCleanup, wantsPhotoCleanupStatus, runPhotoCleanupFromChat, findPriorPhotoUserMessage } from '../utils/photoCleanupChat';
import { requestPhotoCleanupCancel, isPhotoCleanupCancelledError, clearPhotoCleanupCancel } from '../utils/photoCleanupCancel';
import { isGenericCleanupConfirm, resolveConfirmCleanupKind } from '../utils/cleanupConfirmIntent';
import { wantsDraftOutput, DRAFT_OUTPUT_APPEND, buildDraftAssistantMessages } from '../utils/draftOutput';
import { styles, theme } from '../styles/theme';
import LatencyHeatmap from './shared/LatencyHeatmap';

const EMAIL_FOLLOW_UP_APPEND = [
  'EMAIL FOLLOW-UP: Answer ONLY from the prior persona/email analysis already in chat history above.',
  'Cite UID and Date for every quote. Do not invent dialogue not already in the thread.',
  'Do NOT claim you fetched mail, got zero emails, or hit OOM/heap errors — no IMAP fetch runs on follow-ups.',
  'Do NOT deny cross-session memory when a [CONTINUUM MEMORY] block is injected in this turn.',
  'If the persona analysis is missing from history, say so explicitly and ask whether to re-scan the folder.',
  'Do not re-fetch Yahoo mail unless the user explicitly asks to read/fetch emails again.',
].join(' ');

const EMAIL_RECALL_EVIDENCE_APPEND = [
  'EVIDENCE RECALL FETCH: A small IMAP fetch for the requested month only — NOT a full persona rescan.',
  'List every fetched email with UID and Date. Cite boundary-related previews verbatim.',
  'Combine with the prior persona analysis in chat history; do not claim zero emails if any appear below.',
].join(' ');

const RECALL_TURN_APPEND = [
  'RECALL TURN: Answer from [CONTINUUM MEMORY], chat history persona text, or live Min and Kids folder inbox below.',
  'Do NOT write meta-commentary about missing blocks or list what you need from the user.',
  'Never cite JavaScript heap OOM or zero-email fetch from prior turns — those are superseded.',
  'If live inbox data appears below, cite UID and Date from it. If memory has L1 evidence, cite that.',
  'Never say you are awaiting fetch completion or that email content will arrive later — reply now from available evidence.',
].join(' ');

const MEMORY_RECALL_APPEND = [
  'CONTINUUM MEMORY: L1–L5 fragments were retrieved from the backend vault and injected below.',
  'Use them for cross-session recall. Do NOT deny persistent memory or claim OOM/failed fetches unless shown in this turn.',
  'If fragments lack UID+Date for emails, say so and cite what is present — do not invent.',
  'Do NOT say email content is not present yet or that you await a fetch — use memory now and note missing UID+Date gaps.',
].join(' ');

const FULL_FOLDER_PERSONA_APPEND = [
  'FULL FOLDER SCAN: The live Min and Kids folder inbox block below is the authoritative corpus for this turn.',
  'Ignore stale [CONTINUUM MEMORY] fragments that describe only a small April 2026 batch (e.g. 18 emails).',
  'Quote the MAILBOX SCAN Date filter / Matched / Emails loaded lines verbatim — expect 2022 through today and hundreds of emails.',
  'Build SENDER PERSONA and ATTITUDE TIMELINE from the full fetched span, not from memory alone.',
].join(' ');

// Auto language detection for voice input. OS recognizers are locale-bound: iOS
// returns nothing (or garbled text) when the spoken language differs from the
// selected locale, so we resolve a sensible STT locale and let the backend
// re-transcribe the recorded audio when the on-device attempt comes up empty.
const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;
const AUTO_LANGS = ['en-US', 'zh-CN', 'es-ES'];
const STT_CAPTURE_FILE = 'stt_capture.wav';

// Returns a locale when the text is clearly CJK-dominant, else '' (leave to default).
const detectLangFromText = (text) => {
  const t = String(text || '');
  const cjk = (t.match(CJK_RE) || []).length;
  const latin = (t.match(/[A-Za-z]/g) || []).length;
  return cjk >= 2 && cjk >= latin ? 'zh-CN' : '';
};
const hasLatin = (text) => /[A-Za-z]/.test(String(text || ''));

// Register the server-side excerpt fetcher so profile lookups run on the
// Render bridge (LinkedIn's ~800KB pages OOM the phone if fetched on-device).
setBridgeExcerptFetcher((bridgeSecret, url) => fetchBridgeExcerpt(bridgeSecret, url));

const ChatSection = () => {
  const {
    messages, setMessages,
    provider, groqKey, geminiKey, openaiKey, openrouterKey, deepseekKey,
    autoModelRouting,
    setActiveResolvedProvider,
    braveSearchKey,
    slackToken,
    persona,
    sttLang,
    activeTab,
    user,
    session,
    syncRemoteHistory,
    isSyncingHistory,
    isFeatureAvailable,
    renderEmailBridgeSecret,
    emailLimit,
    emailRecent,
    emailDeleteEnabled,
    emailAutoTrashJunk,
    renderEmailEnabled,
    dailyMessageCount,
    incrementDailyCount,
    getTierLimits,
    subscriptionTier,
    setActiveTab,
    pendingChatMessage,
    setPendingChatMessage,
    markServerHealthy,
    onRefreshMemories,
  } = useAppContext();

  const [input, setInput] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [isTyping, setIsTyping] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [recording, setRecording] = useState(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [localTranscript, setLocalTranscript] = useState('');
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [location, setLocation] = useState(null);
  const [drivePickerVisible, setDrivePickerVisible] = useState(false);

  const chatListRef = useRef();
  const inputRef = useRef(null);
  const abortControllerRef = useRef(null);
  const backgroundJobRef = useRef(null);
  const emailJobGenerationRef = useRef(0);
  const soundRef = useRef(null);
  const soundQueueRef = useRef([]);
  const isPlayingQueueRef = useRef(false);
  const silenceTimerRef = useRef(null);
  const longSilenceTimerRef = useRef(null);
  const stopRecordingRef = useRef(null);
  const startRecordingRef = useRef(null);
  // Voice capture bookkeeping for the server-side STT fallback. The recognizer's
  // locale is fixed, so the recorded WAV is uploaded and re-transcribed (with
  // language auto-detection) whenever the on-device transcript is unusable.
  const lastSttLangRef = useRef('');
  const transcriptRef = useRef('');
  const audioUriRef = useRef(null);
  const voiceAudioEndRef = useRef(false);
  const voiceFinalizedRef = useRef(false);
  const voiceEndTimerRef = useRef(null);
  const sendMessageRef = useRef(null);
  const speakAssistantReplyRef = useRef(null);

  // iOS suspends the app as soon as the user switches away, which kills the streaming
  // request. The server finishes the turn regardless (see /chat/stream in the backend),
  // so these track what we showed optimistically for the turn in flight, letting the
  // foreground reconcile swap it for the transcript that was actually stored rather
  // than leaving a bubble the server never had.
  const streamTurnRef = useRef(null);
  const reconcileInFlightRef = useRef(false);
  const reconcileRef = useRef(null);
  const messagesRef = useRef(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Called when the app returns to the foreground. Deliberately conservative: it only
  // rewrites the UI once the server actually holds a reply, so a socket that survived a
  // brief switch (turn still streaming) is left to the live stream callbacks.
  const reconcileInterruptedTurn = useCallback(async () => {
    const turn = streamTurnRef.current;
    if (!turn || reconcileInFlightRef.current) return;
    const token = session?.access_token?.trim();
    if (!token) return;
    reconcileInFlightRef.current = true;
    try {
      const history = await fetchChatHistory(null, token);
      if (!Array.isArray(history) || history.length === 0) return;
      // Match on ids, never timestamps: the device clock and the server clock are not
      // the same clock, and a skew would silently select the wrong window.
      const known = new Set(messagesRef.current.map((m) => m.id));
      const add = history.filter((m) => !known.has(m.id) && !turn.ids.has(m.id));
      if (!add.some((m) => m.role && m.role !== 'user')) return;

      setMessages((prev) => {
        const kept = prev.filter((m) => !turn.ids.has(m.id));
        const have = new Set(kept.map((m) => m.id));
        const fresh = add.filter((m) => !have.has(m.id));
        return fresh.length ? [...kept, ...fresh] : kept;
      });
      // Take ownership of the turn before touching the socket, so the callbacks that may
      // still arrive from a socket that survived the switch are ignored rather than
      // appending a second copy of the reply.
      turn.reconciled = true;
      setIsTyping(false);
      setStreamingContent('');
      abortControllerRef.current?.abort?.();
      streamTurnRef.current = null;
    } catch {
      // Leave the optimistic view alone; the live stream may still be running.
    } finally {
      reconcileInFlightRef.current = false;
    }
  }, [session?.access_token, setMessages]);

  useEffect(() => { reconcileRef.current = reconcileInterruptedTurn; }, [reconcileInterruptedTurn]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') reconcileRef.current?.();
    });
    return () => subscription.remove();
  }, []);

  const dismissKeyboard = useCallback(() => {
    inputRef.current?.blur();
    Keyboard.dismiss();
  }, []);

  const handlePinEmailEvidence = useCallback(async (pinBody) => {
    const activeToken = session?.access_token?.trim();
    if (!pinBody?.trim() || !activeToken) return;
    try {
      await pinCoreMemory(pinBody, activeToken, 'Min email evidence', user?.id);
      try {
        await onRefreshMemories?.(activeToken);
      } catch {
        // local pin saved even if cloud refresh fails
      }
      Alert.alert(
        'Pinned to L1',
        'Saved on this device. Setup search and recall will use it.',
      );
    } catch (e) {
      Alert.alert('Pin failed', e?.message || 'Could not save to Core Memory.');
    }
  }, [session?.access_token, user?.id, onRefreshMemories]);

  useEffect(() => {
    if (activeTab !== 'chat') {
      dismissKeyboard();
    }
  }, [activeTab, dismissKeyboard]);

  useEffect(() => {
    if (activeTab !== 'chat' || !renderEmailEnabled) return undefined;
    const secret = resolveRenderEmailBridgeSecret(renderEmailBridgeSecret);
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchDailyCleanupLatest(secret);
        const run = data?.last_run;
        if (!run?.ran_at || cancelled) return;
        const seen = await AsyncStorage.getItem('@daily_cleanup_last_seen');
        if (seen === run.ran_at) return;
        await AsyncStorage.setItem('@daily_cleanup_last_seen', run.ran_at);
        const moved = run.moved_to_trash ?? 0;
        const scanned = run.fetched ?? 0;
        Alert.alert(
          'Daily email cleanup',
          moved > 0
            ? `Moved ${moved} newsletter/promo email(s) to Trash (${scanned} scanned, ${run.lookback || '24h'}).`
            : `Scanned ${scanned} email(s); nothing to trash in the last ${run.lookback || '24h'}.`,
        );
      } catch {
        // bridge may be offline or old version
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab, renderEmailEnabled, renderEmailBridgeSecret]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    await syncRemoteHistory();
    setIsRefreshing(false);
  };

  // --- NEURAL TRANSCRIPTION LISTENERS ---
  useSpeechRecognitionEvent('start', () => {
    setRecording(true);
    setLocalTranscript('');
    transcriptRef.current = '';
    audioUriRef.current = null;
    voiceAudioEndRef.current = false;
    voiceFinalizedRef.current = false;
    if (voiceEndTimerRef.current) { clearTimeout(voiceEndTimerRef.current); voiceEndTimerRef.current = null; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  });

  useSpeechRecognitionEvent('languagedetection', (event) => {
    // Android-only: the OS reports the spoken language — reuse it on the next start.
    if (event?.detectedLanguage) lastSttLangRef.current = event.detectedLanguage;
  });

  useSpeechRecognitionEvent('audiostart', (event) => {
    // Present only when recording was persisted; used for server-side transcription.
    if (event?.uri) audioUriRef.current = event.uri;
  });

  useSpeechRecognitionEvent('audioend', (event) => {
    // The recorder flushes the file only at 'audioend'. Reading before this yields a
    // partially-written WAV (observed as ~4KB silent uploads), so finalize here.
    if (event?.uri) audioUriRef.current = event.uri;
    voiceAudioEndRef.current = true;
    finishVoice();
  });

  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results[0]?.transcript || '';
    transcriptRef.current = transcript;
    setLocalTranscript(transcript);
    // Auto mode: learn the spoken language from the transcript script so the next
    // utterance starts in the right locale (helps iOS, which emits no detection event).
    if (sttLang === 'auto' && transcript) {
      const zh = detectLangFromText(transcript);
      if (zh) lastSttLangRef.current = zh;
      else if (hasLatin(transcript)) lastSttLangRef.current = 'en-US';
    }
  });

  useSpeechRecognitionEvent('error', (error) => {
    console.warn("Speech Error:", error);
    setRecording(false);
    // Silent fail or alert based on severity
  });

  useSpeechRecognitionEvent('end', () => {
    setRecording(false);
    if (voiceAudioEndRef.current) {
      finishVoice();
    } else {
      // 'audioend' hasn't fired yet — give the recorder a moment to flush the file,
      // then send anyway (covers turns/platforms that never emit 'audioend').
      voiceEndTimerRef.current = setTimeout(finishVoice, 700);
    }
  });

  // Finalize the utterance exactly once, after the recorded audio has been flushed.
  // Always prefers server transcription: the on-device recognizer is single-locale, so
  // iOS returns nothing (or garbled text) when the spoken language differs from the
  // setting. Falls back to the on-device transcript only if no audio was captured.
  const finishVoice = () => {
    if (voiceFinalizedRef.current) return;
    voiceFinalizedRef.current = true;
    if (voiceEndTimerRef.current) { clearTimeout(voiceEndTimerRef.current); voiceEndTimerRef.current = null; }
    const said = (transcriptRef.current || '').trim();
    let uri = audioUriRef.current;
    audioUriRef.current = null;
    if (!uri) {
      try {
        const f = new File(Paths.cache, STT_CAPTURE_FILE);
        if (f.exists) uri = f.uri;
      } catch (e) { /* best effort */ }
    }
    if (uri) {
      handleVoiceFinished(said, uri);
    } else if (said) {
      handleVoiceFinished(said);
    } else {
      console.log('STT: no audio captured and empty on-device transcript.');
    }
  };

  const handleVoiceFinished = (voiceText = '', voiceUri = null) => {
    // Send the on-device transcript, or the recorded audio for server-side STT.
    sendMessage(null, true, voiceText || null, voiceUri);
  };

  // Read the recorded WAV only once it looks finalized (valid RIFF/WAVE header and a
  // non-trivial size). The recorder writes audio incrementally and back-patches the
  // header on flush, so reading too early yields a truncated/silent clip that makes the
  // transcriber hallucinate. Retries briefly, then falls back to a raw read.
  const readFinalizedVoice = async (uri) => {
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        const f = new File(uri);
        if (f.exists && f.size > 64) {
          const b = await f.bytes();
          if (
            b.length > 44 &&
            b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // "RIFF"
            b[8] === 0x57 && b[9] === 0x41 && b[10] === 0x56 && b[11] === 0x45    // "WAVE"
          ) {
            return await f.base64();
          }
        }
      } catch (e) { /* retry */ }
      await new Promise((r) => setTimeout(r, 200));
    }
    try { return await new File(uri).base64(); } catch (e) { return null; }
  };

  // Audio & Location Setup
  useEffect(() => {
    (async () => {
      try {
        let { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          let loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          setLocation(loc);
        }
      } catch (e) { console.warn("Location Setup Error:", e); }
    })();

    return () => {
      if (soundRef.current) soundRef.current.unloadAsync();
      // Ensure STT is stopped on unmount
      if (stopRecordingRef.current) stopRecordingRef.current();
    };
  }, []);

  // Measure a native View (not KeyboardAvoidingView — that class ref has no
  // measureInWindow and throws right after Face ID unlock mounts chat).
  const kavMeasureRef = useRef(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [kavOffset, setKavOffset] = useState(Platform.OS === 'ios' ? 90 : 0);
  const kavOffsetRef = useRef(kavOffset);

  const measureKavOffset = useCallback(() => {
    if (Platform.OS !== 'ios') return;
    const node = kavMeasureRef.current;
    if (!node || typeof node.measureInWindow !== 'function') return;
    try {
      node.measureInWindow((_x, y) => {
        if (Number.isFinite(y) && y > 0 && Math.abs(y - kavOffsetRef.current) > 1) {
          kavOffsetRef.current = y;
          setKavOffset(y);
        }
      });
    } catch (e) {
      console.warn('KAV measure failed:', e?.message);
    }
  }, []);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) => {
      setKeyboardHeight(e.endCoordinates?.height || 0);
      measureKavOffset();
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [measureKavOffset]);

  useEffect(() => {
    if (Platform.OS !== 'ios') return undefined;
    const t = setTimeout(measureKavOffset, 300);
    return () => clearTimeout(t);
  }, [measureKavOffset]);

  const handleStop = async () => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    if (backgroundJobRef.current?.cancel) backgroundJobRef.current.cancel();
    backgroundJobRef.current = null;
    requestPhotoCleanupCancel();
    if (renderEmailEnabled) {
      const secret = resolveRenderEmailBridgeSecret(renderEmailBridgeSecret);
      const token = session?.access_token?.trim();
      if (secret && token) {
        try {
          await stopActiveEmailJob(secret, token);
        } catch {
          await clearPendingEmailJob();
        }
      } else {
        await clearPendingEmailJob();
      }
    }
    setIsTyping(false);
    setStreamingContent('');
    try { Speech.stop(); } catch (_) { /* ignore */ }
    if (soundRef.current) {
      soundRef.current.stopAsync();
      soundRef.current.unloadAsync();
    }
    soundQueueRef.current = [];
    isPlayingQueueRef.current = false;
    setIsSpeaking(false);
  };

  const speakAssistantReply = useCallback((rawText) => {
    const spoken = stripMarkdownForSpeech(rawText);
    if (!spoken) {
      if (isVoiceMode && activeTab === 'chat') {
        setTimeout(() => startRecordingRef.current?.(), 500);
      }
      return;
    }
    try { Speech.stop(); } catch (_) { /* ignore */ }
    // Drop any queued server audio so markdown markers are never spoken.
    soundQueueRef.current = [];
    isPlayingQueueRef.current = false;
    if (soundRef.current) {
      try {
        soundRef.current.stopAsync();
        soundRef.current.unloadAsync();
      } catch (_) { /* ignore */ }
      soundRef.current = null;
    }
    setIsSpeaking(true);
    // In Auto mode there is no fixed locale, so speak the reply in the language its own
    // script is written in (a Chinese reply must not be read by an English voice).
    const ttsLang = (sttLang && sttLang !== 'auto')
      ? sttLang
      : (detectLangFromText(spoken) || lastSttLangRef.current || 'en-US');
    Speech.speak(spoken, {
      language: ttsLang,
      rate: 0.96,
      onDone: () => {
        setIsSpeaking(false);
        if (isVoiceMode && activeTab === 'chat') {
          setTimeout(() => startRecordingRef.current?.(), 400);
        }
      },
      onStopped: () => setIsSpeaking(false),
      onError: () => {
        setIsSpeaking(false);
        if (isVoiceMode && activeTab === 'chat') {
          setTimeout(() => startRecordingRef.current?.(), 400);
        }
      },
    });
  }, [activeTab, isVoiceMode, sttLang]);
  speakAssistantReplyRef.current = speakAssistantReply;

  const resumePendingEmailJob = useCallback(async () => {
    if (!renderEmailEnabled || isTyping || backgroundJobRef.current) return;
    if (await wasEmailJobStopped()) {
      await clearPendingEmailJob();
      return;
    }
    const pendingId = await loadPendingEmailJob();
    if (!pendingId) return;
    const secret = resolveRenderEmailBridgeSecret(renderEmailBridgeSecret);
    const token = session?.access_token?.trim();
    // The backend proxy supplies the bridge secret; only the user bearer is needed.
    if (!token) return;

    const meta = await loadPendingEmailJobMeta();
    const existing = await peekEmailJobStatus(secret, pendingId, token);
    if (!existing) {
      await clearPendingEmailJob();
      return;
    }
    if (existing.status === 'completed' && existing.result) {
      await clearPendingEmailJob();
      setMessages((prev) => [
        ...prev,
        { id: Date.now().toString(), role: 'assistant', content: existing.result },
      ]);
      return;
    }
    if (existing.status === 'failed' || existing.status === 'cancelled') {
      await clearPendingEmailJob();
      return;
    }

    setIsTyping(true);
    setStreamingContent('Resuming cloud email job…');
    const poller = pollEmailJobUntilDone({
      bridgeSecret: secret,
      jobId: pendingId,
      authToken: token,
      jobMeta: meta,
      onProgress: (detail) => appendJobProgress(setStreamingContent, detail),
    });
    backgroundJobRef.current = poller;
    try {
      const result = await poller.promise;
      setMessages((prev) => [
        ...prev,
        { id: Date.now().toString(), role: 'assistant', content: result },
      ]);
    } catch (e) {
      if (isEmailJobCancellationError(e) || e?.code === 'EMAIL_JOB_NOT_FOUND') {
        // User stopped or server lost the job — stay quiet.
      } else {
        const msg = friendlyChatError(e.message || String(e));
        setMessages((prev) => [
          ...prev,
          { id: Date.now().toString(), role: 'assistant', content: msg },
        ]);
      }
    } finally {
      backgroundJobRef.current = null;
      setIsTyping(false);
      setStreamingContent('');
    }
  }, [renderEmailEnabled, isTyping, renderEmailBridgeSecret, session?.access_token, setMessages]);

  useEffect(() => {
    if (activeTab === 'chat' && renderEmailEnabled) {
      resumePendingEmailJob();
    }
  }, [activeTab, renderEmailEnabled, resumePendingEmailJob]);

  const isInitialLoad = useRef(true);

  // --- SCROLL STABILIZATION ENGINE (REDUNDANT IN INVERTED MODE, BUT KEPT FOR STREAMING) ---
  useEffect(() => {
    if (activeTab === 'chat' && chatListRef.current && streamingContent.trim()) {
      // In inverted mode, we scroll to the START (which is the bottom)
      chatListRef.current.scrollToOffset({ offset: 0, animated: true });
    }
  }, [streamingContent, activeTab]);

  // --- MULTIMODAL PICKERS ---
  const pickImage = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      allowsMultipleSelection: true,
      selectionLimit: MAX_DOCUMENT_ATTACHMENTS,
      quality: 0.8,
    });

    if (!result.canceled) {
      const assets = (result.assets || []).slice(0, MAX_DOCUMENT_ATTACHMENTS);
      if ((result.assets || []).length > MAX_DOCUMENT_ATTACHMENTS) {
        Alert.alert('File limit', `Only the first ${MAX_DOCUMENT_ATTACHMENTS} images were added.`);
      }
      addAttachments(assets.map((asset, idx) => ({
        uri: asset.uri,
        name: asset.fileName || `image_${idx + 1}.jpg`,
        type: asset.mimeType || 'image/jpeg',
      })));
    }
  };

  const pickDocument = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [...DOCUMENT_MIME_TYPES, 'image/*'],
        copyToCacheDirectory: true,
        multiple: true,
      });

      if (!result.canceled) {
        const assets = (result.assets || []).slice(0, MAX_DOCUMENT_ATTACHMENTS);
        if (result.assets?.length > MAX_DOCUMENT_ATTACHMENTS) {
          Alert.alert('File limit', `Only the first ${MAX_DOCUMENT_ATTACHMENTS} files were added.`);
        }
        addAttachments(assets.map(normalizePickedAsset));
      }
    } catch (err) {
      console.warn("Document Picker Error:", err);
    }
  };

  const addAttachments = (newFiles) => {
    if (!newFiles?.length) return;
    setAttachments((prev) => {
      const merged = [...prev];
      for (const file of newFiles) {
        if (merged.length >= MAX_DOCUMENT_ATTACHMENTS) break;
        if (!merged.some((f) => f.uri === file.uri && f.name === file.name)) {
          merged.push(file);
        }
      }
      return merged;
    });
  };

  const removeAttachment = (index) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const validateAttachmentSizes = async (files) => {
    for (const file of files) {
      if (!file?.uri) continue;
      const info = await FileSystem.getInfoAsync(file.uri);
      const limit = attachmentSizeLimitBytes(file);
      if (info.exists && info.size > limit) {
        throw new Error(
          `"${file.name || 'Attachment'}" is ${formatAttachmentBytes(info.size)}. Maximum upload size is ${formatAttachmentBytes(limit)} per ${String(file.type || '').startsWith('image/') ? 'image' : 'file'}.`,
        );
      }
    }
  };

  const playNextStreamChunk = async () => {
    if (soundQueueRef.current.length === 0) {
      isPlayingQueueRef.current = false;
      setIsSpeaking(false);
      // Continuous: restart mic if in voice mode
      if (isVoiceMode && activeTab === 'chat') {
        setTimeout(() => startRecording(), 500);
      }
      return;
    }

    isPlayingQueueRef.current = true;
    setIsSpeaking(true);
    const nextB64 = soundQueueRef.current.shift();

    try {
      const { sound } = await Audio.Sound.createAsync(
        { uri: `data:audio/mpeg;base64,${nextB64}` },
        { shouldPlay: true }
      );
      soundRef.current = sound;
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.didJustFinish) {
          sound.unloadAsync();
          playNextStreamChunk();
        }
      });
    } catch (e) {
      playNextStreamChunk();
    }
  };

  const startRecording = async () => {
    if (!isFeatureAvailable('pro')) {
      Alert.alert(
        "Pro Feature", 
        "Hands-free voice mode is reserved for Pro and Elite members. Start your 30-day free trial now!",
        [
          { text: "Later", style: "cancel" },
          { text: "View Plans", onPress: () => setActiveTab('subscription') }
        ]
      );
      return;
    }
    
    try {
      const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!result.granted) {
        Alert.alert("Permission Denied", "Continuum needs microphone and speech recognition access.");
        return;
      }

      // Reset the recorded-audio URI for this user-initiated recording, and delete any
      // previous capture so a failed recording can't upload stale audio.
      audioUriRef.current = null;
      try {
        const prev = new File(Paths.cache, STT_CAPTURE_FILE);
        if (prev.exists) prev.delete();
      } catch (e) { /* best effort */ }

      // Resolve the recognition locale. In Auto mode prefer the language we last
      // observed; otherwise infer it from the current conversation, else English.
      const resolveBaseLang = () => {
        if (lastSttLangRef.current) return lastSttLangRef.current;
        const last = messages[messages.length - 1];
        return detectLangFromText(last?.content) || 'en-US';
      };
      const baseLang = (sttLang && sttLang !== 'auto') ? sttLang : resolveBaseLang();
      const startOptions = { lang: baseLang, interimResults: true };
      if (Platform.OS === 'android') {
        // Always allow the Android recognizer to auto-detect/switch language, even
        // when the user picked a specific language (e.g. "en") — so switching to
        // Chinese mid-utterance still works.
        startOptions.androidIntentOptions = {
          EXTRA_ENABLE_LANGUAGE_DETECTION: true,
          EXTRA_ENABLE_LANGUAGE_SWITCH: 'balanced',
          EXTRA_LANGUAGE_SWITCH_ALLOWED_LANGUAGES: AUTO_LANGS,
          EXTRA_LANGUAGE_DETECTION_ALLOWED_LANGUAGES: AUTO_LANGS,
        };
      }
      // Persist the raw audio so a failed on-device attempt can be re-transcribed
      // server-side (Whisper/Gemini auto-detect the spoken language).
      startOptions.recordingOptions = {
        persist: true,
        outputDirectory: Paths.cache.uri,
        outputFileName: STT_CAPTURE_FILE,
      };

      // Safe Start: Prevent engine-level crashes on unsupported locales
      try {
        await ExpoSpeechRecognitionModule.start(startOptions);
      } catch (innerErr) {
        console.warn("Engine Locale Error:", innerErr);
        // Fallback: plain start in the resolved locale (drop extra options).
        await ExpoSpeechRecognitionModule.start({ lang: baseLang, interimResults: true });
      }
    } catch (err) {
      console.error("STT Critical Failure:", err);
      Alert.alert("Voice Error", "The speech engine could not start. Please check your system settings.");
    }
  };
  startRecordingRef.current = startRecording;

  const stopRecording = async () => {
    try {
      await ExpoSpeechRecognitionModule.stop();
    } catch (e) {
      console.warn("STT Stop Error:", e);
    }
  };
  stopRecordingRef.current = stopRecording;

  const sendMessage = async (overrideAttachment = null, isFromVoice = false, overrideText = null, voiceUri = null) => {
    try {
      if (isTyping) {
        await handleStop();
      }

      const { daily } = getTierLimits();

      if (dailyMessageCount >= daily) {
        Alert.alert(
          "Daily Limit Reached",
          `You have used your ${daily} daily conversations for the ${subscriptionTier.toUpperCase()} tier. Upgrade for higher limits!`,
          [
            { text: "View Plans", onPress: () => setActiveTab('subscription') },
            { text: "Later", style: "cancel" }
          ]
        );
        return;
      }

      const activeAttachments = (overrideAttachment && overrideAttachment.uri)
        ? [overrideAttachment]
        : attachments;
      const finalInput = (overrideText ?? (isFromVoice ? localTranscript : input)).trim();
      // A voice turn can legitimately carry no on-device text (the recognizer is
      // single-locale), so the recorded audio alone is enough to send.
      if (!finalInput && !voiceUri && activeAttachments.length === 0) return;

      if (renderEmailEnabled && isStopEmailJobMessage(finalInput)) {
        const secret = resolveRenderEmailBridgeSecret(renderEmailBridgeSecret);
        const token = session?.access_token?.trim();
        if (backgroundJobRef.current?.cancel) backgroundJobRef.current.cancel();
        backgroundJobRef.current = null;
        if (secret && token) {
          await stopActiveEmailJob(secret, token);
        } else {
          await clearPendingEmailJob();
        }
        setInput('');
        setLocalTranscript('');
        setIsTyping(false);
        setStreamingContent('');
        setMessages((prev) => [
          ...prev,
          { id: Date.now().toString(), role: 'user', content: finalInput.trim() },
          { id: (Date.now() + 1).toString(), role: 'assistant', content: 'Cloud email cleanup stopped.' },
        ]);
        return;
      }

      // ── Slack agent intents ─────────────────────────────────────────────
      const slackSecret = resolveRenderEmailBridgeSecret(renderEmailBridgeSecret);
      const wantsSlack = slackSecret && (slackToken || '').trim() && (wantsSlackRead(finalInput) || wantsSlackPost(finalInput));
      if (wantsSlack) {
        const token = (slackToken || '').trim();
        setInput('');
        setLocalTranscript('');
        setMessages((prev) => [...prev, { id: Date.now().toString(), role: 'user', content: finalInput.trim() }]);
        setIsTyping(true);
        setStreamingContent(wantsSlackPost(finalInput) ? 'Posting to Slack…' : 'Reading Slack…');
        try {
          if (wantsSlackPost(finalInput)) {
            const channel = extractSlackChannel(finalInput) || null;
            const postText = extractSlackPostText(finalInput);
            if (!postText) {
              throw new Error('What should I post? Tell me the message and a channel, e.g. "post standup notes to #general".');
            }
            if (!channel) {
              throw new Error('Which channel? Use #channel-name in your message, e.g. "post hello to #general".');
            }
            const posted = await slackPostMessage(slackSecret, token, channel, postText);
            setMessages((prev) => [
              ...prev,
              { id: (Date.now() + 1).toString(), role: 'assistant', content: `Posted to #${channel}.` },
            ]);
          } else {
            const channels = await slackListChannels(slackSecret, token);
            const channel = resolveSlackChannel(finalInput, channels);
            if (!channel) {
              if (!channels.length) throw new Error('No Slack channels found — add the bot to your workspace first.');
              const names = channels.slice(0, 10).map((c) => `#${c.name}`).join(', ');
              setMessages((prev) => [
                ...prev,
                { id: (Date.now() + 1).toString(), role: 'assistant', content: `Which Slack channel should I read? ${names}. Say e.g. "read #general".` },
              ]);
            } else {
              const messages = await slackReadMessages(slackSecret, token, channel, 25);
              if (!messages.length) {
                setMessages((prev) => [
                  ...prev,
                  { id: (Date.now() + 1).toString(), role: 'assistant', content: `No recent messages in #${channel}.` },
                ]);
              } else {
                const lines = messages.slice(0, 15).map((m) => `**${m.user}** (${m.ts_iso ? new Date(m.ts_iso).toLocaleString() : ''}): ${m.text}`);
                setMessages((prev) => [
                  ...prev,
                  { id: (Date.now() + 1).toString(), role: 'assistant', content: `Recent messages in #${channel}:\n\n${lines.join('\n')}` },
                ]);
                try {
                  await slackIngestChannel(slackSecret, token, channel, 25);
                } catch {
                  // ingestion is best-effort
                }
              }
            }
          }
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch (err) {
          setMessages((prev) => [
            ...prev,
            { id: (Date.now() + 1).toString(), role: 'assistant', content: `Slack error: ${err?.message || String(err)}` },
          ]);
        } finally {
          setIsTyping(false);
          setStreamingContent('');
        }
        return;
      }

      const confirmCleanupKind = isGenericCleanupConfirm(finalInput)
        ? resolveConfirmCleanupKind(messages, finalInput)
        : null;
      const isPhotoConfirm = confirmCleanupKind === 'photo';
      const isPhotoCleanupQuery = (wantsPhotoCleanup(finalInput) || wantsPhotoCleanupStatus(finalInput) || isPhotoConfirm)
        && !activeAttachments.length;

      const wantsCopyDraft = wantsDraftOutput(finalInput);

      const isEmailConfirm = renderEmailEnabled && (
        confirmCleanupKind === 'email'
        || (isGenericCleanupConfirm(finalInput) && confirmCleanupKind !== 'photo')
      );

      const isRecallEvidenceFetch = needsTargetedRecallEvidenceFetch(finalInput, messages.slice(0, -1));
      let isFullFolderFetch = isExplicitFullEmailFetch(finalInput);
      let isEmailFollowUpOnly = !isFullFolderFetch && shouldSkipEmailFetchForFollowUp(finalInput, messages.slice(0, -1));
      let isEmailRecallQuestion = !isFullFolderFetch && isEmailAnalysisFollowUp(finalInput) && !isRecallEvidenceFetch;

      const activeToken = session?.access_token?.trim();
      if (!activeToken) {
        Alert.alert("Security Error", "Session expired. Please log in again.");
        return;
      }

      let memoryRecallContext = '';
      const shouldPrefetchMemory = (
        wantsContinuumMemoryRecall(finalInput)
        || isRecallEvidenceFetch
        || isEmailRecallQuestion
        || isEmailAnalysisFollowUp(finalInput)
        || isFullFolderFetch
      ) && !activeAttachments.length;
      if (shouldPrefetchMemory) {
        setStreamingContent('Searching Continuum memory…');
        try {
          const { layeredData, pinData } = await fetchMemories(null, activeToken, user?.id);
          memoryRecallContext = buildMemoryRecallContext({
            episodicSegments: layeredData?.episodicSegments,
            semanticProfile: layeredData?.semanticProfile,
            temporalEvents: layeredData?.temporalEvents,
            knowledgeBase: layeredData?.knowledgeBase,
            pinnedMemories: pinData,
          }, finalInput, 28000, { fullFolderFetch: isFullFolderFetch });
          if (needsFullMinFolderRefetch(finalInput, memoryRecallContext)) {
            isFullFolderFetch = true;
            isEmailFollowUpOnly = false;
            isEmailRecallQuestion = false;
          }
        } catch (e) {
          console.warn('[memoryRecall]', e?.message || e);
        }
      }

      const isEmailQuery = !isPhotoCleanupQuery && !isComposeEmailRequest(finalInput) && (
        isEmailFollowUpOnly
        || /\b(emails?|inbox|yahoo|mail|unread|smtp|imap|junk|spam|trash|skip|fetch|batch|page)\b/i.test(finalInput)
        || /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s+(?:back\s+to|to|through|until|-)\s+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/i.test(finalInput)
        || /\b(delete|remove|trash|move)\b.*\b(emails?|mail|inbox|message|junk|spam)\b/i.test(finalInput)
        || /\bemails?\s+\d{1,4}\s*[-–]\s*\d{1,4}\b/i.test(finalInput)
        || /\b(clean\s*up|cleanup|cleaning\s+up|clean)\b.*\b(emails?|inbox|mail|yahoo)\b/i.test(finalInput)
        || /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(?:\d{4}\s+)?emails?\b/i.test(finalInput)
        || isEmailConfirm
      );

      let isEmailBridgeQuery = (isEmailQuery && !isEmailFollowUpOnly && !isEmailRecallQuestion) || isRecallEvidenceFetch || isFullFolderFetch;

      const deepseekProviders = DEEPSEEK_PROVIDERS;
      const openrouterProviders = [
        'openrouter', 'or_free', 'qwen', 'gpt4o_mini', 'kimi_k2.6', 'minimax',
      ];
      // Automatic model routing: images / multimodal input → Gemini;
      // pure text → DeepSeek V4 Flash. Only active when "Auto Mode" is on in
      // Setup → Intelligence & API Keys; otherwise the selected provider wins.
      const autoModeOn = autoModelRouting;
      const hasImageAttachments = activeAttachments.some((f) => f.type?.startsWith('image/'));
      const selectedProvider = normalizeProviderId(provider);
      const geminiPlatformKey = (geminiKey || '').trim();
      const deepseekPlatformKey = (deepseekKey || '').trim();
      const hasValidDeepseekKey = !!deepseekPlatformKey && !isOpenRouterKey(deepseekPlatformKey);
      let resolvedProvider;
      if (autoModeOn && hasImageAttachments && geminiPlatformKey) {
        resolvedProvider = 'gemini';
      } else if (autoModeOn && !isEmailBridgeQuery && !hasImageAttachments && hasValidDeepseekKey) {
        resolvedProvider = 'deepseek_v4_flash';
      } else {
        resolvedProvider = selectedProvider;
      }
      const useDirectDeepseek =
        isDeepseekProvider(resolvedProvider)
        && hasValidDeepseekKey;
      // Let the header badge show the model that will actually answer.
      setActiveResolvedProvider(resolvedProvider);
      const activeKey =
        resolvedProvider === 'groq' ? groqKey :
        (resolvedProvider === 'gemini' ? geminiKey :
        (deepseekProviders.includes(resolvedProvider)
          ? (deepseekPlatformKey || openrouterKey)
          : (openrouterProviders.includes(resolvedProvider) ? openrouterKey : openaiKey)));

      if (resolvedProvider === 'gemini' && !activeKey?.trim()) {
        Alert.alert("Gemini key required", "Add your Gemini API key under Setup → Intelligence & API Keys.");
        return;
      }
      if (deepseekProviders.includes(resolvedProvider) && !deepseekPlatformKey) {
        Alert.alert(
          "DeepSeek key required",
          "Add your DeepSeek platform API key (from platform.deepseek.com) under Setup → Intelligence & API Keys → DeepSeek. Continuum calls api.deepseek.com directly — not OpenRouter.",
        );
        return;
      }
      if (deepseekProviders.includes(resolvedProvider) && isOpenRouterKey(deepseekPlatformKey)) {
        Alert.alert(
          "Use DeepSeek platform key",
          "The DeepSeek box has an OpenRouter key (sk-or-…). For direct DeepSeek API, paste a key from https://platform.deepseek.com instead.",
        );
        return;
      }

      const renderEmailSecret = resolveRenderEmailBridgeSecret(renderEmailBridgeSecret);
      const useRenderEmail = renderEmailEnabled && isEmailBridgeQuery;

      if (isEmailBridgeQuery && !renderEmailEnabled) {
        Alert.alert(
          "Yahoo email needs the mail bridge",
          "Setup → Email & Bridge: turn ON Render cloud email.",
        );
        return;
      }

      // The bridge secret is injected server-side by the backend proxy, so it is no
      // longer required on the device (see RENDER_EMAIL_BRIDGE_URL in constants/Config).

      // Prefer direct DeepSeek for text chat. Image uploads and recorded voice need
      // Continuum multipart (the latter so the backend can transcribe the audio).
      const preferDirectDeepseek = useDirectDeepseek && !isEmailBridgeQuery && !hasImageAttachments && !voiceUri;
      const isModelIdentityQuestion = /\b(what|which)\b[\s\S]{0,40}\b(model|llm|ai|version)\b/i.test(finalInput)
        || /\b(are you|you are|you're)\b[\s\S]{0,20}\b(deepseek|gpt|gemini|claude|v3|v4)\b/i.test(finalInput)
        || /\bmodel\s+(are you|is this|do you use|am i talking)\b/i.test(finalInput);

      const isWebSearchQuery =
        wantsWebSearch(finalInput) && !isEmailQuery && !activeAttachments.length;

      const displayInput = overrideText
        ? overrideText
        : isFromVoice
          ? (finalInput || (voiceUri ? "🎤 Transcribing..." : ""))
          : sanitizeUserVisibleContent(
            input || (activeAttachments.some((f) => f.type?.startsWith('audio'))
              ? "🎤 Processing..."
              : (activeAttachments.length ? `📎 ${activeAttachments.length} file(s) attached` : "")),
          );
      const userMsg = { id: Date.now().toString(), role: 'user', content: displayInput, attachments: activeAttachments };

      setMessages(prev => [...prev, userMsg]);
      incrementDailyCount();
      setInput('');
      setLocalTranscript('');
      setAttachments([]);
      dismissKeyboard();
      setIsTyping(true);

      if (isPhotoCleanupQuery) {
        setStreamingContent('Starting photo cleanup…');
        try {
          const priorPhotoMessage = isPhotoConfirm ? findPriorPhotoUserMessage(messages) : null;
          const result = await runPhotoCleanupFromChat(finalInput, (detail) => {
            setStreamingContent(detail);
          }, { priorMessage: priorPhotoMessage });
          setMessages((prev) => [
            ...prev,
            { id: (Date.now() + 1).toString(), role: 'assistant', content: result.content },
          ]);
          if (isVoiceMode) speakAssistantReplyRef.current?.(result.content);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch (e) {
          if (isPhotoCleanupCancelledError(e)) {
            setMessages((prev) => [
              ...prev,
              { id: (Date.now() + 1).toString(), role: 'assistant', content: 'Photo cleanup stopped.' },
            ]);
            if (isVoiceMode) speakAssistantReplyRef.current?.('Photo cleanup stopped.');
          } else {
            Alert.alert('Photo cleanup failed', friendlyChatError(e.message || String(e)));
          }
        } finally {
          setIsTyping(false);
          setStreamingContent('');
        }
        return;
      }

      if (!isPhotoCleanupQuery) {
        clearPhotoCleanupCancel();
      }

      // Past this point this is a real streamed chat turn (photo cleanup returned above),
      // and it can outlive the app staying in the foreground. `reconciled` lets the
      // foreground reconcile take ownership of the turn, so a socket that survived the
      // switch cannot have its late callbacks append the same reply a second time.
      const activeTurn = { ids: new Set([userMsg.id]), reconciled: false };
      streamTurnRef.current = activeTurn;

      if (isVoiceMode) {
        try {
          await Audio.setAudioModeAsync({
            allowsRecordingIOS: true,
            playsInSilentModeIOS: true,
            staysActiveInBackground: true,
            shouldRouteThroughEarpieceIOS: false,
          });
        } catch (e) { console.log("Audio Mode Setup Error:", e); }
      }

      let webSearchContext = '';
      // "can you see my profile" after an earlier lookup: reuse the profile we
      // already fetched (search gate doesn't fire for follow-ups).
      if (!isWebSearchQuery && isProfileFollowUp(finalInput)) {
        const cached = getCachedProfileContext();
        if (cached) webSearchContext = cached;
      }
      if (isWebSearchQuery) {
        setStreamingContent('Searching the web…');
        try {
          const isWeatherQ = /\b(weather|forecast|temperature|raining|snow|sunny|cloudy|hot|cold|humidity|wind)\b/i.test(finalInput)
            || /(天气|气温|会不会下雨|会不会下雪|下雨|下雪|降雨|降雪|温度)/.test(finalInput);
          if (isWeatherQ && location?.coords) {
            webSearchContext = (await fetchLocalWeather(location.coords.latitude, location.coords.longitude)) || '';
          }
          if (!webSearchContext) {
            webSearchContext = (await fetchWebSearchContext(finalInput, (braveSearchKey || '').trim() || null, renderEmailSecret || null)) || '';
          }
          // Cap the injected context so a huge scrape can't bloat the prompt.
          if (webSearchContext && webSearchContext.length > 12000) {
            webSearchContext = webSearchContext.slice(0, 12000);
          }
        } catch (e) {
          console.warn('[webSearch]', e?.message || e);
        }
        if (!webSearchContext) {
          setStreamingContent('');
        }
      }

      const priorMessages = messages.slice(0, -1);
      const isAnyRecallTurn = !isFullFolderFetch
        && (isEmailRecallQuestion || isRecallEvidenceFetch || isEmailAnalysisFollowUp(finalInput));
      const liveEmailFetchScheduled = isEmailBridgeQuery && !isEmailFollowUpOnly;

      let formData = new FormData();
      let chatMessage = isRecallEvidenceFetch
        ? buildTargetedRecallFetchMessage(finalInput, resolveRecallMonthRange(finalInput, priorMessages))
        : finalInput;
      let documentTextInjected = false;

      if (activeAttachments.length && !isFromVoice) {
        await validateAttachmentSizes(activeAttachments);
      }

      // `messages` (closure) does not include the current question yet — it is
      // added to state via setMessages below. So the full array is already the
      // prior conversation and must be sent in full; slicing off the last item
      // would drop the previous assistant reply, making the model re-answer the
      // prior question alongside the current one.
      const recallHistoryBase = sanitizeRecallHistory(messages);
      const historyForUpload = (isEmailFollowUpOnly || isEmailRecallQuestion || isRecallEvidenceFetch)
        ? trimChatHistoryForEmailRecall(recallHistoryBase, 8, 380 * 1024, finalInput)
        : trimChatHistoryForUpload(recallHistoryBase);

      if (activeAttachments.length && !isFromVoice) {
        try {
          const built = await buildMessageWithAttachments(finalInput, activeAttachments);
          chatMessage = built.message;
          documentTextInjected = built.documentTextInjected;
          if (documentTextInjected && built.extractedFileCount) {
            const confirmedContent = `${displayInput}\n✓ Extracted text from ${built.extractedFileCount} file(s)`;
            setMessages((prev) => prev.map((m) => (
              m.id === userMsg.id ? { ...m, content: confirmedContent } : m
            )));
          }
          const hasDocAttachments = activeAttachments.some((f) => !f.type?.startsWith('image/'));
          if (hasDocAttachments && !documentTextInjected) {
            setIsTyping(false);
            Alert.alert(
              'Could not read file',
              'Text could not be extracted. For PDF, ensure the file is not password-protected or scanned-only. For Word files, ensure they are saved from Word (not RTF renamed to .doc). For Excel use .xlsx, or export to CSV and attach again.',
            );
            return;
          }
        } catch (err) {
          setIsTyping(false);
          Alert.alert(
            'Could not read file',
            err.message || 'Failed to extract text from the attachment. For Excel, use .xlsx or export to CSV.',
          );
          return;
        }
      }

      if (webSearchContext) {
        chatMessage = `${webSearchContext}\n\n${chatMessage}`;
      }

      if (memoryRecallContext) {
        chatMessage = `${memoryRecallContext}\n\n${chatMessage}`;
      }

      if (isAnyRecallTurn) {
        const recallStatus = [
          '[RECALL TURN STATUS]',
          memoryRecallContext
            ? 'Continuum memory: injected above.'
            : 'Continuum memory: no UID+Date evidence in L1–L5 (question logs excluded).',
          liveEmailFetchScheduled
            ? 'Min and Kids folder IMAP: fetched synchronously via email bridge this turn (inbox block appears below if successful).'
            : 'Min and Kids folder IMAP: not scheduled (use prior persona text or memory only).',
          'Do not claim OOM or zero fetch unless shown in live inbox data this turn.',
          'Do NOT say you are awaiting fetch completion — answer now from memory and/or live inbox below.',
          '',
        ].join('\n');
        chatMessage = `${recallStatus}${chatMessage}`;
      }

      const personaExtras = [
        ...(isAnyRecallTurn ? [RECALL_TURN_APPEND] : []),
        ...(memoryRecallContext ? [MEMORY_RECALL_APPEND] : []),
        ...(isRecallEvidenceFetch ? [EMAIL_RECALL_EVIDENCE_APPEND] : []),
        ...(isFullFolderFetch ? [FULL_FOLDER_PERSONA_APPEND] : []),
        ...(isEmailFollowUpOnly || isEmailRecallQuestion ? [EMAIL_FOLLOW_UP_APPEND] : []),
        ...(documentTextInjected ? [DOCUMENT_ATTACHMENT_APPEND] : []),
        ...(webSearchContext ? [WEB_SEARCH_APPEND] : []),
        ...(wantsCopyDraft ? [DRAFT_OUTPUT_APPEND] : []),
        ...(isVoiceMode ? [VOICE_MODE_APPEND] : []),
        ...(preferDirectDeepseek ? [
          `MODEL IDENTITY: You are running as DeepSeek API model "${deepseekPlatformModel(resolvedProvider)}" via api.deepseek.com.`,
          'If asked which model/LLM/version you are, answer with that exact model id. Do not say DeepSeek V3 or V3.2.',
        ].join(' ') : []),
      ];

      let historyForDeepseek = (
        documentTextInjected || webSearchContext || isModelIdentityQuestion
      ) ? [] : historyForUpload;

      formData.append('message', chatMessage);
      formData.append('provider', resolvedProvider);
      if (useDirectDeepseek) {
        formData.append('model', deepseekPlatformModel(resolvedProvider));
      }
      formData.append('persona', appendGroundingPersona(persona, personaExtras));
      // Fresh file analysis or web search: drop chat history so prior replies
      // cannot override injected attachment text or live search results.
      formData.append('history', safeJsonStringify(documentTextInjected || webSearchContext ? [] : historyForUpload));
      if (activeKey) formData.append('api_key', activeKey.trim());
      if (resolvedProvider === 'gemini' && geminiPlatformKey) formData.append('gemini_key', geminiPlatformKey);
      // Hands-free speech uses on-device TTS with markdown stripped so "*" is never spoken.
      // (Server Azure synthesis reads raw markdown markers aloud.)
      if (activeAttachments.length && !isFromVoice) {
        for (const file of activeAttachments) {
          formData.append('file', { uri: file.uri, name: file.name, type: file.type });
        }
      }
      // Server-side STT fallback: upload the recorded audio so the backend transcribes
      // it with auto language detection (works regardless of the on-device locale).
      if (voiceUri) {
        const audioB64 = await readFinalizedVoice(voiceUri);
        if (audioB64) formData.append('file_b64', audioB64);
        else console.warn('Voice audio not ready/valid; skipping upload for', voiceUri);
      }
      if (location) {
        formData.append('lat', location.coords.latitude.toString());
        formData.append('lon', location.coords.longitude.toString());
      }
      formData.append('client_time', new Date().toLocaleString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }));

      const clientTime = new Date().toLocaleString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });

      let isHandled = false;
      let bridgeAttempted = useRenderEmail && !preferDirectDeepseek;
      let renderFallbackUsed = false;
      let webSearchRetried = false;
      let errorRetryCount = 0;
      let lastServedModel = preferDirectDeepseek ? deepseekPlatformModel(resolvedProvider) : null;

      const typingSafetyTimer = setTimeout(() => {
        setIsTyping(false);
        setStreamingContent('');
      }, isEmailBridgeQuery ? 600000 : (isWebSearchQuery ? 180000 : 130000));

      const clearTypingSafety = () => clearTimeout(typingSafetyTimer);

      // Rebuild the render-stream payload with a fresh web context (used when
      // the model claims it has no internet and we auto-search + retry once).
      const rebuildFormData = (messageText) => {
        const fd = new FormData();
        fd.append('message', messageText);
        fd.append('provider', resolvedProvider);
        if (useDirectDeepseek) fd.append('model', deepseekPlatformModel(resolvedProvider));
        fd.append('persona', appendGroundingPersona(persona, [...personaExtras, WEB_SEARCH_APPEND]));
        fd.append('history', safeJsonStringify([]));
        if (activeKey) fd.append('api_key', activeKey.trim());
        if (resolvedProvider === 'gemini' && geminiPlatformKey) fd.append('gemini_key', geminiPlatformKey);
        if (activeAttachments.length && !isFromVoice) {
          for (const file of activeAttachments) {
            fd.append('file', { uri: file.uri, name: file.name, type: file.type });
          }
        }
        if (location) {
          fd.append('lat', location.coords.latitude.toString());
          fd.append('lon', location.coords.longitude.toString());
        }
        fd.append('client_time', clientTime);
        return fd;
      };

      const finishSuccess = (finalText, voiceTranscript, meta = null) => {
        // The foreground reconcile already rendered this turn from the server's copy;
        // accepting a late callback from the old socket would duplicate the reply.
        if (activeTurn.reconciled) return;
        if (meta?.servedModel) lastServedModel = meta.servedModel;
        if (!finalText.trim() && bridgeAttempted && !renderFallbackUsed) {
          const hint = useRenderEmail
            ? (isEmailRecallQuestion
              ? "Could not answer from chat history. Force-quit and reopen Continuum, then retry in the same thread. If the persona analysis is far above in chat, scroll up and confirm it is still there."
              : "Email bridge returned no reply. Check your Gemini / 4o MINI API key and Render email secret. For persona scans, try: “Read every email from Min in Min and Kids folder — build persona, cite UID and Date.”")
            : "Bridge returned an empty reply. Check the email bridge secret and your model API key.";
          finishError(hint);
          return;
        }

        // Auto web search fallback: if the model answered "no internet" for a
        // plain-text question and we haven't searched this turn, search once
        // and re-ask with live results injected. Nothing is shown to the user
        // until this resolves.
        if (!webSearchContext && !webSearchRetried && isNoInternetClaim(finalText)
          && !isEmailBridgeQuery && !activeAttachments.length && !isAnyRecallTurn && !isWebSearchQuery) {
          webSearchRetried = true;
          setStreamingContent('Checking the web for that…');
          const isWeatherQ = /\b(weather|forecast|temperature|raining|snow|sunny|cloudy|hot|cold|humidity|wind)\b/i.test(finalInput)
            || /(天气|气温|会不会下雨|会不会下雪|下雨|下雪|降雨|降雪|温度)/.test(finalInput);
          (async () => {
            let ctx = null;
            if (isWeatherQ && location?.coords) {
              ctx = await fetchLocalWeather(location.coords.latitude, location.coords.longitude);
            }
            if (!ctx) {
              const qs = buildSearchQueries(finalInput);
              const data = await searchWeb(qs[0] || finalInput, (braveSearchKey || '').trim() || null, qs.slice(1));
              if (data?.results?.length) ctx = formatSearchResults(data);
            }
            if (!ctx) {
              setIsTyping(false);
              setStreamingContent('');
              finishSuccess(finalText, voiceTranscript, meta);
              return;
            }
            webSearchContext = ctx;
            const newMsg = `${ctx}\n\n${chatMessage}`;
            chatMessage = newMsg;
            formData = rebuildFormData(newMsg);
            historyForDeepseek = [];
            isHandled = false;
            setStreamingContent('');
            if (preferDirectDeepseek) startDirectDeepseekStream();
            else startRenderStream();
          })().catch(() => {
            setIsTyping(false);
            setStreamingContent('');
            finishSuccess(finalText, voiceTranscript, meta);
          });
          return;
        }

        if (isHandled) {
          clearTypingSafety();
          setIsTyping(false);
          setStreamingContent('');
          return;
        }
        isHandled = true;
        clearTypingSafety();
        setIsTyping(false);
        setStreamingContent('');
        if (finalText.trim()) markServerHealthy();
        if (!finalText.trim()) return;

        setMessages(prev => {
          let aiMsgs = buildDraftAssistantMessages(finalText, {
            requestedDraft: wantsCopyDraft,
            baseId: Date.now(),
          });          aiMsgs = aiMsgs.map((m) => ({
            ...m,
            continuumProvider: resolvedProvider,
            continuumProviderLabel: providerDisplayLabel(resolvedProvider),
            continuumOpenRouterModel: preferDirectDeepseek
              ? `api.deepseek.com/${lastServedModel || deepseekPlatformModel(resolvedProvider)}`
              : null,
          }));
          const combinedText = aiMsgs.map((m) => m.content).join('\n\n');
          // Record these ids as part of this turn's optimistic view, so a later
          // foreground reconcile removes them in favour of the stored rows. Adding to a
          // Set is idempotent, which matters if React invokes this updater twice.
          aiMsgs.forEach((m) => activeTurn.ids.add(m.id));
          const pinBody = extractEmailEvidenceForPin(finalText) || extractEmailEvidenceForPin(combinedText);
          const offerPin = pinBody
            && activeToken
            && shouldOfferEmailEvidencePin(finalInput, { isEmailBridgeQuery, isRecallEvidenceFetch });
          if (offerPin) {
            aiMsgs = attachPinOfferToMessages(aiMsgs, pinBody);
          }
          if (isFromVoice) {
            return prev.map(m => {
              if (m.id === userMsg.id && m.content.includes("Transcribing...")) {
                return { ...m, content: voiceTranscript || "[Voice Message]" };
              }
              return m;
            }).concat(aiMsgs);
          }
          return [...prev, ...aiMsgs];
        });

        // The turn resolved in this session, so there is nothing left to reconcile.
        activeTurn.reconciled = true;
        streamTurnRef.current = null;

        if (isVoiceMode) {
          speakAssistantReplyRef.current?.(finalText);
        }

        const pinBodyForAlert = extractEmailEvidenceForPin(finalText)
          || extractEmailEvidenceForPin(finalText.replace(/\*\*/g, ''));
        const offerPinAlert = pinBodyForAlert
          && activeToken
          && shouldOfferEmailEvidencePin(finalInput, { isEmailBridgeQuery, isRecallEvidenceFetch });
        if (offerPinAlert) {
          setTimeout(() => {
            Alert.alert(
              'Pin email evidence to L1?',
              'L2 memory only saves your questions — not UID+Date lines. Pin this summary so Setup search and recall find it.',
              [
                { text: 'Not now', style: 'cancel' },
                { text: 'Pin to L1', onPress: () => handlePinEmailEvidence(pinBodyForAlert) },
              ],
            );
          }, 500);
        }
      };

      const startDirectDeepseekStream = () => {
        const dsModel = deepseekPlatformModel(resolvedProvider);
        lastServedModel = dsModel;
        const xhr = deepseekChatStream(
          {
            apiKey: deepseekPlatformKey,
            model: dsModel,
            system: appendGroundingPersona(persona, webSearchContext ? [...personaExtras, WEB_SEARCH_APPEND] : personaExtras),
            history: historyForDeepseek,
            message: chatMessage,
          },
          onStreamUpdate,
          finishSuccess,
          finishError,
        );
        abortControllerRef.current = { abort: () => xhr.abort() };
        return xhr;
      };

      const startRenderStream = () => {
        const xhrDirect = chatStream(
          formData,
          onStreamUpdate,
          finishSuccess,
          finishError,
          activeToken,
        );
        abortControllerRef.current = { abort: () => xhrDirect.abort() };
        return xhrDirect;
      };

      const finishError = (err) => {
        // Ignore a late failure for a turn the reconcile already recovered: the reply
        // exists server-side, so alarming the user about it would be wrong.
        if (activeTurn.reconciled) return;
        if (isEmailJobCancellationError(err)) {
          clearTypingSafety();
          setIsTyping(false);
          setStreamingContent('');
          return;
        }
        if (bridgeAttempted && !renderFallbackUsed && !isEmailBridgeQuery) {
          renderFallbackUsed = true;
          bridgeAttempted = false;
          isHandled = false;
          if (preferDirectDeepseek) startDirectDeepseekStream();
          else startRenderStream();
          return;
        }
        if (isHandled) {
          clearTypingSafety();
          setIsTyping(false);
          setStreamingContent('');
          return;
        }
        isHandled = true;
        clearTypingSafety();
        setIsTyping(false);
        setStreamingContent('');

        // ── Agent self-diagnosis ─────────────────────────────────────────
        // Classify the failure. Transient errors (network/quota/bridge)
        // auto-retry once with the selected stream. Everything else gets a
        // plain-language explanation + concrete fix. Unknown errors are
        // looked up online and the findings are posted back into chat.
        const diag = diagnoseChatError(err, {
          provider: resolvedProvider,
          emailQuery: isEmailBridgeQuery,
        });

        if (diag.retryable && errorRetryCount < 1 && !isEmailBridgeQuery) {
          errorRetryCount += 1;
          setStreamingContent(`${diag.title} — retrying…`);
          setTimeout(() => {
            setStreamingContent('');
            if (preferDirectDeepseek) startDirectDeepseekStream();
            else startRenderStream();
          }, diag.retryDelayMs || 2500);
          return;
        }

        Alert.alert(diag.title, `${diag.message}\n\n${diag.tip || ''}`);

        if (diag.kind === 'unknown') {
          setStreamingContent('Looking this error up online…');
          Promise.race([
            lookUpErrorOnline(rawErrorMessage(err), (braveSearchKey || '').trim() || null),
            new Promise((resolve) => setTimeout(() => resolve(null), 12000)),
          ]).then((ctx) => {
            setStreamingContent('');
            if (ctx && ctx.includes('results')) {
              setMessages((prev) => [
                ...prev,
                {
                  id: (Date.now() + 1).toString(),
                  role: 'assistant',
                  content: `I couldn't resolve that from the error alone, so I searched the web for it. Here's what I found:\n\n${ctx}`,
                },
              ]);
            }
          }).catch(() => setStreamingContent(''));
        }
      };

      const onStreamUpdate = (event, json) => {
        if (event === 'text' && json.token) {
          setStreamingContent(prev => prev + json.token);
        } else if (event === 'status' && json.detail) {
          setStreamingContent(String(json.detail));
        } else if (event === 'audio' && json.audio) {
          // Hands-free uses on-device TTS (markdown-stripped). Ignore server audio.
          if (isVoiceMode) return;
          soundQueueRef.current.push(json.audio);
          if (!isPlayingQueueRef.current) playNextStreamChunk();
        } else if (event === 'transcript') {
          if (!isFromVoice) return;
          const transcript = json.text || (typeof json === 'string' ? json : null);
          if (transcript) {
            setMessages(prev => prev.map(m =>
              m.id === userMsg.id ? { ...m, content: sanitizeUserVisibleContent(transcript) } : m
            ));
          }
        } else if (event === 'nospeech') {
          // Server-side STT heard no speech: drop the placeholder and resume listening
          // rather than leaving a bubble the user never said.
          if (!isFromVoice) return;
          setMessages(prev => prev.filter(m => m.id !== userMsg.id));
          setIsTyping(false);
          setStreamingContent('');
          if (isVoiceMode && activeTab === 'chat') {
            setTimeout(() => startRecordingRef.current?.(), 500);
          }
        } else if (event === 'error') {
          finishError(json.detail || "An unexpected error occurred.");
        }
      };

      if (preferDirectDeepseek) {
        startDirectDeepseekStream();
      } else if (useRenderEmail) {
        const useEnrichedBridgeMessage = !isEmailConfirm
          && (memoryRecallContext || isRecallEvidenceFetch || isAnyRecallTurn);
        const emailSourceMessage = isEmailConfirm
          ? (findPriorEmailUserMessage(messages) || finalInput)
          : useEnrichedBridgeMessage
            ? chatMessage
            : finalInput;
        const bridgeMessage = isEmailConfirm && emailSourceMessage !== finalInput
          ? buildEmailConfirmPayloadMessage(emailSourceMessage, finalInput)
          : (webSearchContext ? `${webSearchContext}\n\n${emailSourceMessage}` : emailSourceMessage);
        const emailFetchIntentMessage = finalInput;
        const emailFetch = isEmailBridgeQuery
          ? resolveEmailFetchPayload({
              limit: isRecallEvidenceFetch ? 200 : emailLimit,
              recent: emailRecent,
              message: emailFetchIntentMessage,
            })
          : {};
        const payload = {
          message: bridgeMessage,
          provider: resolvedProvider,
          persona: appendGroundingPersona(persona, [
            ...(isAnyRecallTurn ? [RECALL_TURN_APPEND] : []),
            ...(memoryRecallContext ? [MEMORY_RECALL_APPEND] : []),
            ...(isRecallEvidenceFetch ? [EMAIL_RECALL_EVIDENCE_APPEND] : []),
            ...(isFullFolderFetch ? [FULL_FOLDER_PERSONA_APPEND] : []),
        ...(isEmailFollowUpOnly || isEmailRecallQuestion ? [EMAIL_FOLLOW_UP_APPEND] : []),
            ...(webSearchContext ? [WEB_SEARCH_APPEND] : []),
          ]),
          history: webSearchContext ? [] : historyForUpload,
          gemini_key: resolvedProvider === 'gemini' ? (geminiKey || '').trim() : '',
          groq_key: resolvedProvider === 'groq' ? (groqKey || '').trim() : '',
          api_key: (activeKey || '').trim(),
          lat: location?.coords?.latitude?.toString(),
          lon: location?.coords?.longitude?.toString(),
          client_time: clientTime,
          ...emailFetch,
          email_delete_enabled: emailDeleteEnabled,
          email_auto_trash_junk: emailAutoTrashJunk && emailDeleteEnabled,
        };

        const useBackgroundEmailJob =
          useRenderEmail
          && shouldRunEmailInBackground(emailFetchIntentMessage)
          && !isEmailConfirm
          && !isEmailFollowUpOnly
          && !isRecallEvidenceFetch;

        if (useBackgroundEmailJob) {
          const jobSecret = renderEmailSecret;
          const jobPayload = buildEmailJobPayload({
            message: emailFetchIntentMessage,
            provider: resolvedProvider,
            persona: payload.persona,
            emailFetch,
            emailDeleteEnabled,
            emailAutoTrashJunk: emailAutoTrashJunk && emailDeleteEnabled,
            keys: { geminiKey, groqKey, apiKey: activeKey },
            location,
            clientTime,
          });

          const startEmailStream = () => {
            setStreamingContent('Connecting to email bridge…');
            const xhr = renderEmailChatStream(
              renderEmailSecret,
              payload,
              onStreamUpdate,
              finishSuccess,
              finishError,
              activeToken,
            );
            abortControllerRef.current = { abort: () => xhr.abort() };
          };

          let usingStreamFallback = false;
          emailJobGenerationRef.current += 1;
          const jobGeneration = emailJobGenerationRef.current;
          setStreamingContent('Starting cloud email job…');
          await clearEmailJobStopped();
          if (backgroundJobRef.current?.cancel) backgroundJobRef.current.cancel();
          backgroundJobRef.current = null;
          try {
            await stopActiveEmailJob(jobSecret, activeToken);
          } catch {
            await clearPendingEmailJob();
          }
          submitBackgroundEmailJob(jobSecret, jobPayload, activeToken)
            .then(async (created) => {
              if (jobGeneration !== emailJobGenerationRef.current) return;
              const jobMeta = {
                message: emailSourceMessage,
                payload: jobPayload,
                restartCount: 0,
                checkpoint: null,
              };
              await savePendingEmailJob(created.job_id, jobMeta);
              setStreamingContent('Running in cloud — safe to switch apps…');
              const poller = pollEmailJobUntilDone({
                bridgeSecret: jobSecret,
                jobId: created.job_id,
                authToken: activeToken,
                jobMeta,
                onProgress: (detail) => appendJobProgress(setStreamingContent, detail),
              });
              backgroundJobRef.current = poller;
              abortControllerRef.current = { abort: () => poller.cancel() };
              try {
                const result = await poller.promise;
                if (jobGeneration !== emailJobGenerationRef.current) return;
                finishSuccess(result);
              } catch (err) {
                if (jobGeneration !== emailJobGenerationRef.current || isEmailJobCancellationError(err)) {
                  return;
                }
                if (isNetworkFailure(err)) {
                  usingStreamFallback = true;
                  poller.cancel();
                  backgroundJobRef.current = null;
                  try {
                    await cancelBackgroundEmailJob(jobSecret, created.job_id, activeToken);
                  } catch {
                    // job may already be gone
                  }
                  await clearPendingEmailJob();
                  startEmailStream();
                  return;
                }
                finishError(err);
              } finally {
                if (!usingStreamFallback) {
                  backgroundJobRef.current = null;
                  setIsTyping(false);
                  setStreamingContent('');
                }
              }
            })
            .catch((err) => {
              if (jobGeneration !== emailJobGenerationRef.current || isEmailJobCancellationError(err)) {
                return;
              }
              if (isNetworkFailure(err)) {
                usingStreamFallback = true;
                backgroundJobRef.current = null;
                startEmailStream();
                return;
              }
              finishError(err);
            });
          return;
        }

        const xhr = renderEmailChatStream(
          renderEmailSecret,
          payload,
          onStreamUpdate,
          finishSuccess,
          finishError,
          activeToken,
        );
        abortControllerRef.current = { abort: () => xhr.abort() };
      } else {
        startRenderStream();
      }
    } catch (e) {
      setIsTyping(false);
      setStreamingContent('');
      Alert.alert("Send failed", e.message || String(e));
    }
  };
  sendMessageRef.current = sendMessage;

  useEffect(() => {
    if (activeTab !== 'chat' || !pendingChatMessage) return undefined;
    const msg = pendingChatMessage;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      setPendingChatMessage(null);
      sendMessageRef.current?.(null, false, msg);
    }, 100);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeTab, pendingChatMessage, setPendingChatMessage]);

  const onPressSend = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (recording) {
      stopRecording();
      return;
    }
    if (input.trim() || attachments.length) {
      sendMessage();
    } else {
      startRecording();
    }
  };

  const deleteSelectedMessages = async () => {
    if (selectedIds.size === 0) return;
    
    Alert.alert(
      "Confirm Deletion",
      `Are you sure you want to delete ${selectedIds.size} messages? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Delete", 
          style: "destructive", 
          onPress: async () => {
            try {
              // ENSURE IDs ARE INTEGERS (Matching database.py schema)
              const idsArray = Array.from(selectedIds).map(id => parseInt(id, 10)).filter(id => !isNaN(id));
              
              if (idsArray.length === 0) {
                 Alert.alert("Error", "Valid message IDs were not found.");
                 return;
              }

              const response = await fetch(`${API_URL}/chat/delete`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${session?.access_token}`
                },
                body: JSON.stringify({ message_ids: idsArray })
              });

              if (response.ok) {
                setMessages(prev => prev.filter(m => !selectedIds.has(m.id)));
                setIsSelectionMode(false);
                setSelectedIds(new Set());
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              } else {
                const errorData = await response.json().catch(() => ({ detail: "Unknown Server Error" }));
                Alert.alert("Cloud Error", `Status ${response.status}: ${errorData.detail || "Server rejected deletion."}`);
              }
            } catch (err) {
              console.error("Delete failed:", err);
              Alert.alert("Network Error", "The Cloud is unreachable. Check your connection.");
            }
          }
        }
      ]
    );
  };

  const toggleSelection = (id) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const renderChatItem = ({ item }) => {
    if (!item || !item.content) return null;
    const isSelected = selectedIds.has(item.id);
    const isCopyDraft = Boolean(item.copyDraft);

    const copyDraftToClipboard = async () => {
      await Clipboard.setStringAsync(item.content);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    };

    return (
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => {
          if (isSelectionMode) {
            toggleSelection(item.id);
          } else if (isCopyDraft) {
            copyDraftToClipboard();
          }
        }}
        onLongPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          if (isCopyDraft) {
            copyDraftToClipboard();
            return;
          }
          Alert.alert(
            "Message Options",
            null,
            [
              { 
                text: "Copy Text", 
                onPress: copyDraftToClipboard,
              },
              { 
                text: "Select Messages", 
                onPress: () => {
                  setIsSelectionMode(true);
                  toggleSelection(item.id);
                }
              },
              { text: "Cancel", style: "cancel" }
            ]
          );
        }}
        style={[
          item.role === 'user' ? styles.userBubble : styles.aiBubble,
          isCopyDraft && {
            borderWidth: 1,
            borderColor: theme.colors.primary + '55',
            backgroundColor: theme.colors.white,
          },
          isSelected && { borderLeftWidth: 4, borderLeftColor: theme.colors.primary, backgroundColor: theme.colors.light }
        ]}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flexShrink: 1 }}>
            {isCopyDraft ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                <Ionicons name="copy-outline" size={12} color={theme.colors.primary} />
                <Text style={{ marginLeft: 4, fontSize: 9, fontWeight: '800', color: theme.colors.primary, letterSpacing: 0.5 }}>
                  TAP TO COPY DRAFT
                </Text>
              </View>
            ) : null}
            {(item.attachments?.length ? item.attachments : (item.attachment ? [item.attachment] : [])).map((file, fileIdx) => (
              <View key={`${item.id}-file-${fileIdx}`} style={{ marginBottom: 8 }}>
                {file.type?.startsWith('image/') ? (
                  <Image 
                    source={{ uri: file.uri }} 
                    style={{ width: 220, height: 220, borderRadius: 12, backgroundColor: theme.colors.light }} 
                    resizeMode="cover"
                  />
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.light, padding: 10, borderRadius: 10, borderLeftWidth: 3, borderLeftColor: theme.colors.primary }}>
                    <Ionicons name={documentIconName(file.type, file.name)} size={20} color={theme.colors.primary} />
                    <Text style={{ marginLeft: 8, fontSize: 13, color: theme.colors.black, fontWeight: '600' }} numberOfLines={1}>
                      {file.name}
                    </Text>
                  </View>
                )}
              </View>
            ))}
            {item.role === 'user' || isCopyDraft ? (
              <Text style={[
                item.role === 'user' ? styles.userChatText : styles.chatText,
                isCopyDraft && { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 13, lineHeight: 19 },
              ]}>
                {item.role === 'user' ? sanitizeUserVisibleContent(item.content) : item.content}
              </Text>
            ) : (
              <AssistantMarkdown>{item.content}</AssistantMarkdown>
            )}
            {item.pinOffer ? (
              <TouchableOpacity
                onPress={() => handlePinEmailEvidence(item.pinOffer)}
                style={{
                  marginTop: 10,
                  alignSelf: 'flex-start',
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: theme.colors.primary + '18',
                  paddingHorizontal: 10,
                  paddingVertical: 7,
                  borderRadius: 8,
                }}
              >
                <Ionicons name="bookmark-outline" size={14} color={theme.colors.primary} />
                <Text style={{ marginLeft: 6, fontSize: 12, fontWeight: '700', color: theme.colors.primary }}>
                  Pin to L1
                </Text>
              </TouchableOpacity>
            ) : null}
            {item.role === 'assistant' && item.continuumProviderLabel ? (
              <Text style={{ marginTop: 8, fontSize: 9, fontWeight: '700', color: theme.colors.gray }}>
                Via: {item.continuumProviderLabel}
                {item.continuumOpenRouterModel ? ` · ${item.continuumOpenRouterModel}` : ''}
              </Text>
            ) : null}
          </View>
          
          {isSelectionMode && (
            <Ionicons 
              name={isSelected ? "checkbox" : "square-outline"} 
              size={20} 
              color={theme.colors.primary} 
              style={{ marginLeft: 10 }}
            />
          )}
        </View>
        
        {/* TIME STAMP */}
        <Text style={{ 
          fontSize: 8, 
          color: item.role === 'user' ? 'rgba(255,255,255,0.6)' : theme.colors.gray, 
          marginTop: 4, 
          alignSelf: 'flex-end',
          fontWeight: '600'
        }}>
          {item.timestamp ? new Date(item.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </Text>

        <LatencyHeatmap data={item.latencyData} />
      </TouchableOpacity>
    );
  };

  return (
    <>
    <View
      ref={kavMeasureRef}
      style={styles.chatArea}
      onLayout={() => {
        if (Platform.OS === 'ios') measureKavOffset();
      }}
    >
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={kavOffset}
      style={{ flex: 1 }}
    >
      {isSelectionMode && (
      <View style={styles.providerBar}>
        <View style={{ flexDirection: 'row', gap: 6, flex: 1, alignItems: 'center' }}>
          <TouchableOpacity
            onPress={() => { setIsSelectionMode(false); setSelectedIds(new Set()); }}
            style={{ padding: 8, backgroundColor: theme.colors.light, borderRadius: 8 }}
          >
            <Text style={{ fontSize: 10, fontWeight: '700', color: theme.colors.gray }}>CANCEL</Text>
          </TouchableOpacity>
          <Text style={{ fontSize: 11, fontWeight: '700', color: theme.colors.primary, marginLeft: 10 }}>
            {selectedIds.size} SELECTED
          </Text>
          <TouchableOpacity
            onPress={deleteSelectedMessages}
            disabled={selectedIds.size === 0}
            style={{ marginLeft: 'auto', padding: 8, backgroundColor: theme.colors.danger + '15', borderRadius: 8, flexDirection: 'row', alignItems: 'center' }}
          >
            <Ionicons name="trash-outline" size={14} color={theme.colors.danger} />
            <Text style={{ fontSize: 10, fontWeight: '800', color: theme.colors.danger, marginLeft: 5 }}>DELETE</Text>
          </TouchableOpacity>
        </View>
      </View>
      )}

      <FlatList
        ref={chatListRef}
        inverted={true}
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="never"
        keyboardDismissMode="on-drag"
        onScrollBeginDrag={dismissKeyboard}
        data={
          streamingContent.trim() 
            ? [{ id: 'stream', role: 'assistant', content: streamingContent }, ...[...messages].reverse()] 
            : [...messages].reverse()
        }
        keyExtractor={item => item?.id || Math.random().toString()}
        renderItem={renderChatItem}
        contentContainerStyle={{ padding: 16, paddingBottom: 16 + (Platform.OS === 'android' ? keyboardHeight : 0), flexGrow: 1 }}
        removeClippedSubviews={Platform.OS === 'android'}
        initialNumToRender={12}
        maxToRenderPerBatch={8}
        windowSize={5}
        ListEmptyComponent={
          !isSyncingHistory && (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', marginTop: 100, opacity: 0.5, transform: [{ scaleY: -1 }] }}>
              <Ionicons name="chatbubbles-outline" size={48} color={theme.colors.gray} />
              <Text style={{ color: theme.colors.gray, marginTop: 16, fontWeight: '600' }}>No messages yet. Start the conversation!</Text>
            </View>
          )
        }
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.primary}
            progressViewOffset={50} // Adjust for inverted list
          />
        }
      />

      {(recording || isTyping || isSpeaking) && (
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 8 }}>
          <Text style={[styles.typingIndicator, { flex: 1 }]}>
            {recording
              ? "Listening..."
              : isSpeaking
                ? "Speaking..."
                : (() => {
                    const lastLine = streamingContent.trim().split('\n').filter(Boolean).pop() || '';
                    if (lastLine === 'Done') return 'Finishing…';
                    return lastLine || 'Analyzing...';
                  })()}
          </Text>
          {(isTyping || isSpeaking) && (
            <TouchableOpacity style={[styles.stopButton, { backgroundColor: theme.colors.danger }]} onPress={handleStop}>
              <Text style={{ color: 'white', fontWeight: 'bold' }}>Stop</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {attachments.length > 0 && (
        <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
          {attachments.map((file, index) => (
            <View key={`${file.uri}-${index}`} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6, backgroundColor: theme.colors.light, padding: 8, borderRadius: 12 }}>
              <Ionicons name={documentIconName(file.type, file.name)} size={20} color={theme.colors.primary} />
              <Text style={{ flex: 1, marginLeft: 8, fontSize: 12, color: theme.colors.black }} numberOfLines={1}>
                {file.name}
              </Text>
              <TouchableOpacity onPress={() => removeAttachment(index)}>
                <Ionicons name="close-circle" size={20} color={theme.colors.danger} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      <View style={[styles.inputWrapper, { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 10, paddingBottom: 10, flexShrink: 0 }]}>
        <TouchableOpacity
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setIsVoiceMode(!isVoiceMode); }}
          style={{
            marginRight: 8,
            marginBottom: 4,
            padding: 10,
            backgroundColor: isVoiceMode ? '#6C5CE720' : theme.colors.light,
            borderRadius: 25,
            borderWidth: 1,
            borderColor: isVoiceMode ? '#6C5CE7' : 'transparent',
            flexDirection: 'row',
            alignItems: 'center'
          }}
        >
          <Ionicons name="pulse" size={20} color={isVoiceMode ? '#6C5CE7' : theme.colors.gray} />
          {isVoiceMode && (
            <Text style={{ color: '#6C5CE7', fontSize: 9, fontWeight: '900', marginLeft: 6 }}>
              HANDS-FREE
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity 
          onPress={async () => {
            let driveConnected = false;
            try {
              driveConnected = await isGoogleDriveConnected();
            } catch {
              driveConnected = false;
            }
            const buttons = [
              { text: "Cancel", style: "cancel" },
              { text: "Photo Library", onPress: pickImage },
              { text: "Browse Documents", onPress: pickDocument },
            ];
            if (driveConnected) {
              buttons.push({
                text: "Google Drive",
                onPress: () => setDrivePickerVisible(true),
              });
            } else {
              buttons.push({
                text: "Google Drive (connect in Setup)",
                onPress: () => Alert.alert(
                  "Google Drive",
                  "Open Setup → Google Drive, add your Google OAuth Client ID, then Connect. After that you can attach Drive files here.",
                ),
              });
            }
            Alert.alert(
              "Attach Context",
              "Add photos, documents, or Google Drive files. You can select multiple files.",
              buttons,
            );
          }}
          style={{ marginRight: 8, marginBottom: 4, padding: 10, backgroundColor: theme.colors.light, borderRadius: 25 }}
        >
          <Ionicons name="attach" size={22} color={theme.colors.primary} />
        </TouchableOpacity>

        <View style={[styles.capsuleInput, { flex: 1 }]}>
          <TextInput
            ref={inputRef}
            style={styles.textInput}
            placeholder={attachments.length ? `Describe ${attachments.length} file(s)...` : "Message..."}
            value={input}
            onChangeText={setInput}
            multiline
            autoCorrect={true}
            spellCheck={true}
            autoCapitalize="sentences"
            returnKeyType="send"
            blurOnSubmit={true}
            onSubmitEditing={() => {
              if (input.trim() || attachments.length) onPressSend();
            }}
          />
          <TouchableOpacity
            onPress={onPressSend}
            style={styles.sendPill}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            activeOpacity={0.7}
          >
            <Ionicons name={recording ? "stop" : (input.trim() || attachments.length ? "arrow-up" : "mic-outline")} size={20} color="white" />
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
    </View>
    <GoogleDrivePickerModal
      visible={drivePickerVisible}
      onClose={() => setDrivePickerVisible(false)}
      onPicked={(file) => addAttachments([file])}
    />
    </>
  );
};

export default ChatSection;
