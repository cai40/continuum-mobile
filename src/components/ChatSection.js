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
import { resolveBridgeBaseUrl, resolveBridgeSecret, resolveRenderEmailBridgeSecret, isHttpsBridgeUrl, findPriorEmailUserMessage, isEmailConfirmMessage } from '../utils/openclawBridge';
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
} from '../utils/helpers';
import {
  shouldRunEmailInBackground,
  submitBackgroundEmailJob,
  pollEmailJobUntilDone,
  savePendingEmailJob,
  loadPendingEmailJob,
  buildEmailJobPayload,
  isNetworkFailure,
} from '../utils/emailBackgroundJobs';
import { wantsPhotoCleanup, wantsPhotoCleanupStatus, runPhotoCleanupFromChat } from '../utils/photoCleanupChat';
import { styles, theme } from '../styles/theme';
import LatencyHeatmap from './shared/LatencyHeatmap';

const ChatSection = () => {
  const {
    messages, setMessages,
    provider, setProvider, groqKey, geminiKey, openaiKey, openrouterKey,
    selectedVoice, persona,
    sttLang, setSttLang,
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
  const soundRef = useRef(null);
  const soundQueueRef = useRef([]);
  const isPlayingQueueRef = useRef(false);
  const silenceTimerRef = useRef(null);
  const longSilenceTimerRef = useRef(null);
  const stopRecordingRef = useRef(null);

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

  const handleStop = () => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    if (backgroundJobRef.current?.cancel) backgroundJobRef.current.cancel();
    backgroundJobRef.current = null;
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
    const pendingId = await loadPendingEmailJob();
    if (!pendingId) return;
    const secret = resolveRenderEmailBridgeSecret(renderEmailBridgeSecret);
    const token = session?.access_token?.trim();
    if (!secret || !token) return;

    setIsTyping(true);
    setStreamingContent('Resuming cloud email job…');
    const poller = pollEmailJobUntilDone({
      bridgeSecret: secret,
      jobId: pendingId,
      authToken: token,
      onProgress: (detail) => setStreamingContent(detail),
    });
    backgroundJobRef.current = poller;
    try {
      const result = await poller.promise;
      setMessages((prev) => [
        ...prev,
        { id: Date.now().toString(), role: 'assistant', content: result },
      ]);
    } catch (e) {
      const msg = friendlyChatError(e.message || String(e));
      setMessages((prev) => [
        ...prev,
        { id: Date.now().toString(), role: 'assistant', content: msg },
      ]);
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

  const sendMessage = async (overrideAttachment = null, isFromVoice = false) => {
    try {
      if (isTyping) {
        handleStop();
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
      const finalInput = isFromVoice ? localTranscript : input;
      if (!finalInput.trim() && activeAttachments.length === 0) return;

      const isPhotoCleanupQuery = (wantsPhotoCleanup(finalInput) || wantsPhotoCleanupStatus(finalInput))
        && !activeAttachments.length;

      const isEmailConfirm = renderEmailEnabled && isEmailConfirmMessage(finalInput);
      const isEmailQuery = !isPhotoCleanupQuery && (
        /\b(emails?|inbox|yahoo|mail|unread|smtp|imap|junk|spam|trash|skip|fetch|batch|page)\b/i.test(finalInput)
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

      const bridgeSecret = resolveBridgeSecret(openclawBridgeSecret);
      const renderEmailSecret = resolveRenderEmailBridgeSecret(renderEmailBridgeSecret);
      const bridgeUrl = resolveBridgeBaseUrl({
        httpsUrl: openclawBridgeHttpsUrl,
        vpsIp: openclawVpsIp,
        defaultVpsIp: "135.181.155.197",
      });
      const useRenderEmail = renderEmailEnabled && isEmailQuery;
      const useVpsBridge =
        !useRenderEmail &&
        openclawChatEnabled &&
        bridgeUrl &&
        isHttpsBridgeUrl(bridgeUrl) &&
        !activeAttachments.length &&
        !isVoiceMode;

      if (isEmailQuery && !renderEmailEnabled && !useVpsBridge) {
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

      const displayInput = isFromVoice
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
          const result = await runPhotoCleanupFromChat(finalInput, (detail) => {
            setStreamingContent(detail);
          });
          setMessages((prev) => [
            ...prev,
            { id: (Date.now() + 1).toString(), role: 'assistant', content: result.content },
          ]);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch (e) {
          Alert.alert('Photo cleanup failed', friendlyChatError(e.message || String(e)));
        } finally {
          setIsTyping(false);
          setStreamingContent('');
        }
        return;
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

      const historyForUpload = trimChatHistoryForUpload(messages.slice(0, -1));

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
        ...(documentTextInjected ? [DOCUMENT_ATTACHMENT_APPEND] : []),
        ...(webSearchContext ? [WEB_SEARCH_APPEND] : []),
      ];

      formData.append('message', chatMessage);
      formData.append('provider', provider);
      formData.append('persona', appendGroundingPersona(persona, personaExtras));
      // Fresh file analysis or web search: drop chat history so prior replies
      // cannot override injected attachment text or live search results.
      formData.append('history', JSON.stringify(documentTextInjected || webSearchContext ? [] : historyForUpload));
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
      }, isEmailQuery ? 600000 : (isWebSearchQuery ? 180000 : 130000));

      const clearTypingSafety = () => clearTimeout(typingSafetyTimer);

      const finishSuccess = (finalText, voiceTranscript) => {
        if (!finalText.trim() && bridgeAttempted && !renderFallbackUsed) {
          const hint = useRenderEmail
            ? "Email bridge returned no reply. Check Render email secret, your API key for the selected model (Gemini / 4o MINI), and turn ON Allow email delete for cleanup. Large fetches can take 1–2 minutes — retry with “Fetch and clean Apr 2026 emails limit 50”."
            : "Bridge returned empty reply. Check VPS bridge secret, HTTPS URL, and API key for your selected model.";
          finishError(hint);
          return;
        }
        if (isHandled) return;
        isHandled = true;
        clearTypingSafety();
        setIsTyping(false);
        setStreamingContent('');
        if (!finalText.trim()) return;

        setMessages(prev => {
          const aiMsg = { id: (Date.now() + 1).toString(), role: 'assistant', content: finalText };
          if (isFromVoice) {
            return prev.map(m => {
              if (m.id === userMsg.id && m.content.includes("Transcribing...")) {
                return { ...m, content: voiceTranscript || "[Voice Message]" };
              }
              return m;
            }).concat(aiMsg);
          }
          return [...prev, aiMsg];
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
        if (bridgeAttempted && !renderFallbackUsed && !isEmailQuery) {
          renderFallbackUsed = true;
          bridgeAttempted = false;
          isHandled = false;
          startRenderStream();
          return;
        }
        if (isHandled) return;
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
        const emailFetch = isEmailQuery
          ? resolveEmailFetchPayload({
              limit: openclawEmailLimit,
              recent: openclawEmailRecent,
              message: emailSourceMessage,
            })
          : {};
        const payload = {
          message: webSearchContext ? `${webSearchContext}\n\n${finalInput}` : finalInput,
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
          && !isEmailConfirm;

        if (useBackgroundEmailJob) {
          const jobBaseUrl = useRenderEmail
            ? undefined
            : bridgeUrl.replace(/\/$/, '');
          const jobSecret = useRenderEmail ? renderEmailSecret : bridgeSecret;
          const jobPayload = buildEmailJobPayload({
            message: payload.message,
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
          setStreamingContent('Starting cloud email job…');
          submitBackgroundEmailJob(jobSecret, jobPayload, activeToken, jobBaseUrl)
            .then(async (created) => {
              await savePendingEmailJob(created.job_id);
              setStreamingContent('Running in cloud — safe to switch apps…');
              const poller = pollEmailJobUntilDone({
                bridgeSecret: jobSecret,
                jobId: created.job_id,
                authToken: activeToken,
                baseUrl: jobBaseUrl,
                onProgress: (detail) => setStreamingContent(detail),
              });
              backgroundJobRef.current = poller;
              abortControllerRef.current = { abort: () => poller.cancel() };
              const result = await poller.promise;
              finishSuccess(result);
            })
            .catch((err) => {
              if (isNetworkFailure(err)) {
                usingStreamFallback = true;
                backgroundJobRef.current = null;
                startEmailStream();
                return;
              }
              finishError(err);
            })
            .finally(() => {
              if (!usingStreamFallback) backgroundJobRef.current = null;
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

    return (
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => isSelectionMode ? toggleSelection(item.id) : null}
        onLongPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          Alert.alert(
            "Message Options",
            null,
            [
              { 
                text: "Copy Text", 
                onPress: async () => {
                  await Clipboard.setStringAsync(item.content);
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                }
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
          isSelected && { borderLeftWidth: 4, borderLeftColor: theme.colors.primary, backgroundColor: theme.colors.light }
        ]}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flexShrink: 1 }}>
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
            <Text style={item.role === 'user' ? styles.userChatText : styles.chatText}>
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
      <View style={styles.providerBar}>
        <View style={{ flexDirection: 'row', gap: 6, flex: 1, alignItems: 'center' }}>
          {isSelectionMode ? (
            <>
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
            </>
          ) : (
            ['gemini', 'openrouter', 'gpt4o_mini'].map((p) => (
              <TouchableOpacity
                key={p}
                onPress={() => {
                  setProvider(p);
                }}
                style={{
                  paddingHorizontal: 8,
                  paddingVertical: 5,
                  borderRadius: 12,
                  backgroundColor: provider === p ? theme.colors.primary : theme.colors.white,
                  borderWidth: 1,
                  borderColor: provider === p ? theme.colors.primary : theme.colors.border
                }}
              >
                <Text style={{ 
                  fontSize: 8, 
                  fontWeight: '800', 
                  color: provider === p ? 'white' : theme.colors.gray 
                }}>
                  {p === 'openrouter' ? 'Claude' : (p === 'gpt4o_mini' ? '4o MINI' : p.toUpperCase())}
                </Text>
              </TouchableOpacity>
            ))
          )}
        </View>

        {/* CYCLING LANGUAGE TOGGLE */}
        <View style={{ marginLeft: 8 }}>
          <TouchableOpacity
            onPress={() => {
              try {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                const cycle = ['en-US', 'zh-CN', 'es-ES'];
                const currentIndex = cycle.indexOf(sttLang);
                const nextIndex = (currentIndex + 1) % cycle.length;
                setSttLang(cycle[nextIndex]);
              } catch (e) {}
            }}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 5,
              borderRadius: 10,
              backgroundColor: theme.colors.secondary,
              borderWidth: 1,
              borderColor: theme.colors.secondary,
              alignItems: 'center',
              minWidth: 45
            }}
          >
            <Text style={{ 
              fontSize: 9, 
              fontWeight: '900', 
              color: 'white' 
            }}>
              {sttLang ? sttLang.split('-')[0].toUpperCase() : 'EN'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

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
            {recording ? "Listening..." : (isSpeaking ? "Speaking..." : "Analyzing...")}
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
