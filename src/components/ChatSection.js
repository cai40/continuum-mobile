import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, KeyboardAvoidingView, Platform, Image, Alert, RefreshControl, Keyboard } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Clipboard from 'expo-clipboard';
import { Audio } from 'expo-av';
import * as Location from 'expo-location';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent
} from 'expo-speech-recognition';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAppContext } from '../context/AppContext';
import { chatStream, openClawChatStream, renderEmailChatStream, fetchDailyCleanupLatest } from '../services/apiService';
import { API_URL, SILENCE_THRESHOLD, SHORT_SILENCE_TIMEOUT, LONG_SILENCE_TIMEOUT } from '../constants/Config';
import { resolveBridgeBaseUrl, resolveBridgeSecret, resolveRenderEmailBridgeSecret, isHttpsBridgeUrl, findPriorEmailUserMessage, buildEmailConfirmPayloadMessage } from '../utils/openclawBridge';
import { resolveEmailFetchPayload } from '../utils/openclawEmailOptions';
import {
  DOCUMENT_MIME_TYPES,
  MAX_DOCUMENT_ATTACHMENTS,
  documentIconName,
  normalizePickedAsset,
} from '../utils/documentTypes';
import { appendGroundingPersona, DOCUMENT_ATTACHMENT_APPEND, WEB_SEARCH_APPEND } from '../utils/groundingPrompt';
import { wantsWebSearch, fetchWebSearchContext } from '../utils/webSearch';
import { buildMessageWithAttachments } from '../utils/documentTextExtract';
import {
  friendlyChatError,
  MAX_ATTACHMENT_BYTES,
  sanitizeUserVisibleContent,
  trimChatHistoryForUpload,
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
import { shouldSkipEmailFetchForFollowUp } from '../utils/emailFollowUpIntent';
import { wantsPhotoCleanup, wantsPhotoCleanupStatus, runPhotoCleanupFromChat, findPriorPhotoUserMessage } from '../utils/photoCleanupChat';
import { requestPhotoCleanupCancel, isPhotoCleanupCancelledError, clearPhotoCleanupCancel } from '../utils/photoCleanupCancel';
import { isGenericCleanupConfirm, resolveConfirmCleanupKind } from '../utils/cleanupConfirmIntent';
import { wantsDraftOutput, DRAFT_OUTPUT_APPEND, buildDraftAssistantMessages } from '../utils/draftOutput';
import { styles, theme } from '../styles/theme';
import LatencyHeatmap from './shared/LatencyHeatmap';

const EMAIL_FOLLOW_UP_APPEND = [
  'EMAIL FOLLOW-UP: Answer from the prior email analysis in chat history above.',
  'Cite UID and Date for every quote. Do not invent dialogue not already in the thread.',
  'Do not re-fetch Yahoo mail unless the user explicitly asks to read/fetch emails again.',
].join(' ');

const ChatSection = () => {
  const {
    messages, setMessages,
    provider, groqKey, geminiKey, openaiKey, openrouterKey,
    selectedVoice, persona,
    sttLang,
    activeTab,
    session,
    syncRemoteHistory,
    isSyncingHistory,
    isFeatureAvailable,
    openclawChatEnabled,
    openclawVpsIp,
    openclawBridgeHttpsUrl,
    openclawBridgeSecret,
    renderEmailBridgeSecret,
    openclawEmailLimit,
    openclawEmailRecent,
    openclawEmailDeleteEnabled,
    openclawEmailAutoTrashJunk,
    renderEmailEnabled,
    dailyMessageCount,
    incrementDailyCount,
    getTierLimits,
    subscriptionTier,
    setActiveTab,
    pendingChatMessage,
    setPendingChatMessage,
    markServerHealthy,
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
  const sendMessageRef = useRef(null);

  const dismissKeyboard = useCallback(() => {
    inputRef.current?.blur();
    Keyboard.dismiss();
  }, []);

  useEffect(() => {
    if (activeTab !== 'chat') {
      dismissKeyboard();
    }
  }, [activeTab, dismissKeyboard]);

  useEffect(() => {
    if (activeTab !== 'chat' || !renderEmailEnabled) return undefined;
    const secret = resolveRenderEmailBridgeSecret(renderEmailBridgeSecret);
    if (!secret) return undefined;
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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  });

  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results[0]?.transcript || '';
    setLocalTranscript(transcript);
  });

  useSpeechRecognitionEvent('error', (error) => {
    console.warn("Speech Error:", error);
    setRecording(false);
    // Silent fail or alert based on severity
  });

  useSpeechRecognitionEvent('end', () => {
    setRecording(false);
    // If we have a transcript and were in voice mode, auto-send
    if (localTranscript.trim()) {
      handleVoiceFinished();
    }
  });

  const handleVoiceFinished = () => {
    // Trigger send with the local results
    sendMessage(null, true);
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
    if (soundRef.current) {
      soundRef.current.stopAsync();
      soundRef.current.unloadAsync();
    }
    soundQueueRef.current = [];
    isPlayingQueueRef.current = false;
    setIsSpeaking(false);
  };

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
    if (!secret || !token) return;

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
      allowsEditing: true,
      quality: 0.8,
    });

    if (!result.canceled) {
      const asset = result.assets[0];
      addAttachments([{
        uri: asset.uri,
        name: asset.fileName || 'image.jpg',
        type: asset.mimeType || 'image/jpeg',
      }]);
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
      if (info.exists && info.size > MAX_ATTACHMENT_BYTES) {
        throw new Error(
          `"${file.name || 'Attachment'}" is ${Math.round(info.size / 1024)}KB. Maximum upload size is 1024KB per file.`,
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

      // Safe Start: Prevent engine-level crashes on unsupported locales
      try {
        await ExpoSpeechRecognitionModule.start({
          lang: sttLang,
          interimResults: true,
        });
      } catch (innerErr) {
        console.warn("Engine Locale Error:", innerErr);
        // Fallback to English if the specific locale fails
        await ExpoSpeechRecognitionModule.start({
          lang: 'en-US',
          interimResults: true,
        });
      }
    } catch (err) {
      console.error("STT Critical Failure:", err);
      Alert.alert("Voice Error", "The speech engine could not start. Please check your system settings.");
    }
  };

  const stopRecording = async () => {
    try {
      await ExpoSpeechRecognitionModule.stop();
    } catch (e) {
      console.warn("STT Stop Error:", e);
    }
  };
  stopRecordingRef.current = stopRecording;

  const sendMessage = async (overrideAttachment = null, isFromVoice = false, overrideText = null) => {
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
      if (!finalInput && activeAttachments.length === 0) return;

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

      const confirmCleanupKind = isGenericCleanupConfirm(finalInput)
        ? resolveConfirmCleanupKind(messages, finalInput)
        : null;
      const isPhotoConfirm = confirmCleanupKind === 'photo';
      const isPhotoCleanupQuery = (wantsPhotoCleanup(finalInput) || wantsPhotoCleanupStatus(finalInput) || isPhotoConfirm)
        && !activeAttachments.length;

      const wantsCopyDraft = wantsDraftOutput(finalInput);

      const isEmailFollowUpOnly = shouldSkipEmailFetchForFollowUp(finalInput, messages.slice(0, -1));

      const isEmailConfirm = renderEmailEnabled && (
        confirmCleanupKind === 'email'
        || (isGenericCleanupConfirm(finalInput) && confirmCleanupKind !== 'photo')
      );
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

      const openrouterProviders = [
        'openrouter', 'or_free', 'deepseek', 'deepseek_v3.2', 'deepseek_v4_pro',
        'deepseek_v4_flash', 'qwen', 'gpt4o_mini', 'kimi_k2.6', 'minimax',
      ];
      const activeKey =
        provider === 'groq' ? groqKey :
        (provider === 'gemini' ? geminiKey :
        (openrouterProviders.includes(provider) ? openrouterKey : openaiKey));

      if (provider === 'gemini' && !activeKey?.trim()) {
        Alert.alert("Gemini key required", "Add your Gemini API key under Setup → Intelligence & API Keys.");
        return;
      }

      const activeToken = session?.access_token?.trim();
      if (!activeToken) {
        Alert.alert("Security Error", "Session expired. Please log in again.");
        return;
      }

      const isEmailBridgeQuery = isEmailQuery && !isEmailFollowUpOnly;

      const bridgeSecret = resolveBridgeSecret(openclawBridgeSecret);
      const renderEmailSecret = resolveRenderEmailBridgeSecret(renderEmailBridgeSecret);
      const bridgeUrl = resolveBridgeBaseUrl({
        httpsUrl: openclawBridgeHttpsUrl,
        vpsIp: openclawVpsIp,
        defaultVpsIp: "135.181.155.197",
      });
      const useRenderEmail = renderEmailEnabled && isEmailBridgeQuery;
      const useVpsBridge =
        !useRenderEmail &&
        openclawChatEnabled &&
        bridgeUrl &&
        isHttpsBridgeUrl(bridgeUrl) &&
        !activeAttachments.length &&
        !isVoiceMode;

      if (isEmailBridgeQuery && !renderEmailEnabled && !useVpsBridge) {
        Alert.alert(
          "Yahoo email needs a mail bridge",
          "Setup → OpenClaw Gateway:\n• Turn ON Render cloud email (no VPS), or\n• Turn ON Route chat through OpenClaw + HTTPS bridge URL.",
        );
        return;
      }

      if (useRenderEmail && !renderEmailSecret) {
        Alert.alert(
          "Render email secret required",
          "Setup → OpenClaw Gateway → Render email bridge secret.\nPaste BRIDGE_SECRET from your continuum-email-bridge service on Render.",
        );
        return;
      }

      const useOpenClawBridge = useVpsBridge;

      const isWebSearchQuery =
        wantsWebSearch(finalInput) && !isEmailQuery && !activeAttachments.length;

      const displayInput = overrideText
        ? overrideText
        : isFromVoice
          ? finalInput
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
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch (e) {
          if (isPhotoCleanupCancelledError(e)) {
            setMessages((prev) => [
              ...prev,
              { id: (Date.now() + 1).toString(), role: 'assistant', content: 'Photo cleanup stopped.' },
            ]);
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
      if (isWebSearchQuery) {
        setStreamingContent('Searching the web…');
        try {
          webSearchContext = (await fetchWebSearchContext(finalInput, null)) || '';
        } catch (e) {
          console.warn('[webSearch]', e?.message || e);
        }
      }

      const formData = new FormData();
      let chatMessage = finalInput;
      let documentTextInjected = false;

      if (activeAttachments.length && !isFromVoice) {
        await validateAttachmentSizes(activeAttachments);
      }

      const historyForUpload = isEmailFollowUpOnly
        ? trimChatHistoryForUpload(messages.slice(0, -1), 4, 220 * 1024)
        : trimChatHistoryForUpload(messages.slice(0, -1));

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
              'Text could not be extracted. For Excel use .xlsx, or export to CSV and attach again.',
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

      const personaExtras = [
        ...(isEmailFollowUpOnly ? [EMAIL_FOLLOW_UP_APPEND] : []),
        ...(documentTextInjected ? [DOCUMENT_ATTACHMENT_APPEND] : []),
        ...(webSearchContext ? [WEB_SEARCH_APPEND] : []),
        ...(wantsCopyDraft ? [DRAFT_OUTPUT_APPEND] : []),
      ];

      formData.append('message', chatMessage);
      formData.append('provider', provider);
      formData.append('persona', appendGroundingPersona(persona, personaExtras));
      // Fresh file analysis or web search: drop chat history so prior replies
      // cannot override injected attachment text or live search results.
      formData.append('history', safeJsonStringify(documentTextInjected || webSearchContext ? [] : historyForUpload));
      if (activeKey) formData.append('api_key', activeKey.trim());
      if (isVoiceMode) {
        formData.append('synthesize_voice', 'True');
        formData.append('voice_model', selectedVoice);
      }
      if (activeAttachments.length && !isFromVoice) {
        for (const file of activeAttachments) {
          formData.append('file', { uri: file.uri, name: file.name, type: file.type });
        }
      }
      if (location) {
        formData.append('lat', location.coords.latitude.toString());
        formData.append('lon', location.coords.longitude.toString());
      }
      formData.append('client_time', new Date().toLocaleString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }));

      const clientTime = new Date().toLocaleString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });

      let isHandled = false;
      let bridgeAttempted = useOpenClawBridge || useRenderEmail;
      let renderFallbackUsed = false;

      const typingSafetyTimer = setTimeout(() => {
        setIsTyping(false);
        setStreamingContent('');
      }, isEmailBridgeQuery ? 600000 : (isWebSearchQuery ? 180000 : 130000));

      const clearTypingSafety = () => clearTimeout(typingSafetyTimer);

      const finishSuccess = (finalText, voiceTranscript) => {
        if (!finalText.trim() && bridgeAttempted && !renderFallbackUsed) {
          const hint = useRenderEmail
            ? "Email bridge returned no reply. Large folder persona scans (e.g. Min folder) may take 1–2 minutes — they now run in the background when possible. Check your Gemini / 4o MINI API key and Render email secret. Retry: “Read every email from Min in Min folder — build persona, cite UID and Date.”"
            : "Bridge returned empty reply. Check VPS bridge secret, HTTPS URL, and API key for your selected model.";
          finishError(hint);
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
          const aiMsgs = buildDraftAssistantMessages(finalText, {
            requestedDraft: wantsCopyDraft,
            baseId: Date.now(),
          });
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
          startRenderStream();
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
        Alert.alert("Chat Error", friendlyChatError(err));
      };

      const onStreamUpdate = (event, json) => {
        if (event === 'text' && json.token) {
          setStreamingContent(prev => prev + json.token);
        } else if (event === 'status' && json.detail) {
          setStreamingContent(String(json.detail));
        } else if (event === 'audio' && json.audio) {
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
        } else if (event === 'error') {
          finishError(json.detail || "An unexpected error occurred.");
        }
      };

      if (useRenderEmail || useOpenClawBridge) {
        const emailSourceMessage = isEmailConfirm
          ? (findPriorEmailUserMessage(messages) || finalInput)
          : finalInput;
        const bridgeMessage = isEmailConfirm && emailSourceMessage !== finalInput
          ? buildEmailConfirmPayloadMessage(emailSourceMessage, finalInput)
          : (webSearchContext ? `${webSearchContext}\n\n${finalInput}` : finalInput);
        const emailFetch = isEmailBridgeQuery
          ? resolveEmailFetchPayload({
              limit: openclawEmailLimit,
              recent: openclawEmailRecent,
              message: emailSourceMessage,
            })
          : {};
        const payload = {
          message: bridgeMessage,
          provider,
          persona: appendGroundingPersona(persona, webSearchContext ? [WEB_SEARCH_APPEND] : []),
          history: webSearchContext ? [] : historyForUpload,
          gemini_key: provider === 'gemini' ? (geminiKey || '').trim() : '',
          groq_key: provider === 'groq' ? (groqKey || '').trim() : '',
          api_key: (activeKey || '').trim(),
          lat: location?.coords?.latitude?.toString(),
          lon: location?.coords?.longitude?.toString(),
          client_time: clientTime,
          ...emailFetch,
          email_delete_enabled: openclawEmailDeleteEnabled,
          email_auto_trash_junk: openclawEmailAutoTrashJunk && openclawEmailDeleteEnabled,
        };

        const useBackgroundEmailJob =
          (useRenderEmail || useOpenClawBridge)
          && shouldRunEmailInBackground(emailSourceMessage)
          && !isEmailConfirm
          && !isEmailFollowUpOnly;

        if (useBackgroundEmailJob) {
          const jobBaseUrl = useRenderEmail
            ? undefined
            : bridgeUrl.replace(/\/$/, '');
          const jobSecret = useRenderEmail ? renderEmailSecret : bridgeSecret;
          const jobPayload = buildEmailJobPayload({
            message: emailSourceMessage,
            provider,
            persona: payload.persona,
            emailFetch,
            emailDeleteEnabled: openclawEmailDeleteEnabled,
            emailAutoTrashJunk: openclawEmailAutoTrashJunk && openclawEmailDeleteEnabled,
            keys: { geminiKey, groqKey, apiKey: activeKey },
            location,
            clientTime,
          });

          const startEmailStream = () => {
            setStreamingContent('Connecting to email bridge…');
            const xhr = useRenderEmail
              ? renderEmailChatStream(
                  renderEmailSecret,
                  payload,
                  onStreamUpdate,
                  finishSuccess,
                  finishError,
                  activeToken,
                )
              : openClawChatStream(
                  bridgeUrl,
                  bridgeSecret,
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
            await stopActiveEmailJob(jobSecret, activeToken, jobBaseUrl);
          } catch {
            await clearPendingEmailJob();
          }
          submitBackgroundEmailJob(jobSecret, jobPayload, activeToken, jobBaseUrl)
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
                baseUrl: jobBaseUrl,
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
                    await cancelBackgroundEmailJob(jobSecret, created.job_id, activeToken, jobBaseUrl);
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

        const xhr = useRenderEmail
          ? renderEmailChatStream(
              renderEmailSecret,
              payload,
              onStreamUpdate,
              finishSuccess,
              finishError,
              activeToken,
            )
          : openClawChatStream(
              bridgeUrl,
              bridgeSecret,
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
            <Text style={[
              item.role === 'user' ? styles.userChatText : styles.chatText,
              isCopyDraft && { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 13, lineHeight: 19 },
            ]}>
              {item.role === 'user' ? sanitizeUserVisibleContent(item.content) : item.content}
            </Text>
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
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      style={styles.chatArea}
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
        contentContainerStyle={{ padding: 16, flexGrow: 1 }}
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
          onPress={() => {
            Alert.alert(
              "Attach Context",
              "Add photos or documents (PDF, Word, PowerPoint, Excel, text). You can select multiple files.",
              [
                { text: "Cancel", style: "cancel" },
                { text: "Photo Library", onPress: pickImage },
                { text: "Browse Documents", onPress: pickDocument },
              ]
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
  );
};

export default ChatSection;
