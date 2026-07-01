import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, KeyboardAvoidingView, Platform, Image, Alert, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Clipboard from 'expo-clipboard';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import * as Location from 'expo-location';
import JSZip from 'jszip';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent
} from 'expo-speech-recognition';
import { useAppContext } from '../context/AppContext';
import { chatStream } from '../services/apiService';
import { API_URL, SILENCE_THRESHOLD, SHORT_SILENCE_TIMEOUT, LONG_SILENCE_TIMEOUT } from '../constants/Config';
import { styles, theme } from '../styles/theme';
import { normalizeDocumentAsset } from '../utils/helpers';
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
  const abortControllerRef = useRef(null);
  const soundRef = useRef(null);
  const soundQueueRef = useRef([]);
  const isPlayingQueueRef = useRef(false);
  const silenceTimerRef = useRef(null);
  const longSilenceTimerRef = useRef(null);
  const stopRecordingRef = useRef(null);
  const MAX_INLINE_DOCUMENT_CHARS = 12000;
  const MAX_WEB_CONTEXT_CHARS = 12000;
  const MAX_ATTACHMENTS = 8;

  const getAttachmentExtension = (activeAttachment) => {
    const name = activeAttachment?.name || '';
    const cleanName = name.split('?')[0].split('#')[0];
    return cleanName.includes('.') ? cleanName.split('.').pop().toLowerCase() : '';
  };

  const isDocxAttachment = (activeAttachment) =>
    getAttachmentExtension(activeAttachment) === 'docx' ||
    activeAttachment?.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  const isLegacyWordAttachment = (activeAttachment) =>
    getAttachmentExtension(activeAttachment) === 'doc' ||
    activeAttachment?.type === 'application/msword';

  const isPdfAttachment = (activeAttachment) =>
    getAttachmentExtension(activeAttachment) === 'pdf' ||
    activeAttachment?.type === 'application/pdf';

  const isPlainTextAttachment = (activeAttachment) => {
    const extension = getAttachmentExtension(activeAttachment);
    return ['txt', 'md', 'markdown', 'csv', 'log'].includes(extension) ||
      activeAttachment?.type?.startsWith('text/');
  };

  const addAttachments = (newAttachments) => {
    const validAttachments = newAttachments.filter(item => item?.uri);
    if (validAttachments.length === 0) return;

    setAttachments(prev => {
      const next = [...prev, ...validAttachments].slice(0, MAX_ATTACHMENTS);
      if (prev.length + validAttachments.length > MAX_ATTACHMENTS) {
        Alert.alert("Attachment Limit", `You can attach up to ${MAX_ATTACHMENTS} files at one time.`);
      }
      return next;
    });
  };

  const ensurePdfJsRuntime = () => {
    if (!Promise.withResolvers) {
      Promise.withResolvers = () => {
        let resolve;
        let reject;
        const promise = new Promise((res, rej) => {
          resolve = res;
          reject = rej;
        });
        return { promise, resolve, reject };
      };
    }
  };

  const decodeXmlEntities = (value) =>
    value
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));

  const wordXmlToText = (xml) => decodeXmlEntities(
    xml
      .replace(/<w:tab[^>]*\/>/g, '\t')
      .replace(/<w:br[^>]*\/>/g, '\n')
      .replace(/<w:cr[^>]*\/>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<\/w:tr>/g, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');

  const truncateDocumentText = (text) => {
    if (!text || text.length <= MAX_INLINE_DOCUMENT_CHARS) return text;
    return `${text.substring(0, MAX_INLINE_DOCUMENT_CHARS)}\n\n[Document text truncated after ${MAX_INLINE_DOCUMENT_CHARS} characters.]`;
  };

  const HANDS_FREE_RESPONSE_RULES = [
    "Hands-free voice mode is active.",
    "Reply like a natural spoken conversation.",
    "Keep the answer very short: one or two brief sentences, under 35 words unless I explicitly ask for detail.",
    "Do not use Markdown, headings, bullets, numbered lists, tables, code blocks, emoji, or symbols such as #, *, _, `, [, ], or •.",
    "Use plain words that sound good when read aloud.",
    "If the question is broad, give the shortest useful answer and ask one simple follow-up question.",
  ].join(' ');

  const applyHandsFreeInstructions = (message) => [
    HANDS_FREE_RESPONSE_RULES,
    message,
  ].join('\n\n');

  const buildHandsFreePersona = (basePersona) => [
    basePersona,
    HANDS_FREE_RESPONSE_RULES,
  ].filter(Boolean).join('\n\n');

  const sanitizeHandsFreeText = (text = '') => text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^[\s>*-]*[-*•]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/[*_~#>\[\]{}|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const truncateWebContext = (text) => {
    if (!text || text.length <= MAX_WEB_CONTEXT_CHARS) return text;
    return `${text.substring(0, MAX_WEB_CONTEXT_CHARS)}\n\n[Web context truncated after ${MAX_WEB_CONTEXT_CHARS} characters.]`;
  };

  const stripHtmlToText = (html = '') => decodeXmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|section|article|li|h[1-6]|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const normalizeUrl = (value) => {
    const trimmed = (value || '').trim();
    if (!trimmed) return '';
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
  };

  const extractUrls = (value) => {
    const matches = (value || '').match(/https?:\/\/[^\s)]+/gi) || [];
    return [...new Set(matches.map(url => url.replace(/[.,;!?]+$/, '')))];
  };

  const decodeDuckDuckGoUrl = (href = '') => {
    const normalized = decodeXmlEntities(href);
    const match = normalized.match(/[?&]uddg=([^&]+)/);
    if (match) return decodeURIComponent(match[1]);
    if (normalized.startsWith('//')) return `https:${normalized}`;
    return normalized;
  };

  const fetchWithTimeout = async (url, options = {}, timeoutMs = 12000) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  };

  const readWebPage = async (rawUrl) => {
    const url = normalizeUrl(rawUrl);
    if (!url) return '';

    try {
      const readerUrl = /^http:\/\//i.test(url)
        ? `https://r.jina.ai/${url}`
        : `https://r.jina.ai/http://${url}`;
      const readerRes = await fetchWithTimeout(readerUrl, {
        headers: { Accept: 'text/plain' },
      }, 15000);
      const readerText = await readerRes.text();
      if (readerRes.ok && readerText.trim()) {
        return truncateWebContext(`URL: ${url}\n\n${readerText.trim()}`);
      }
    } catch (err) {
      console.warn("Reader fetch failed:", err);
    }

    try {
      const res = await fetchWithTimeout(url, {
        headers: { Accept: 'text/html,text/plain,application/xhtml+xml' },
      }, 12000);
      const text = await res.text();
      if (!res.ok || !text.trim()) return '';
      return truncateWebContext(`URL: ${url}\n\n${stripHtmlToText(text)}`);
    } catch (err) {
      console.warn("Direct web fetch failed:", err);
      return '';
    }
  };

  const shouldSearchWeb = (message = '') => {
    const normalized = message.toLowerCase();
    return /(\bweb\b|\binternet\b|\bonline\b|\bsearch\b|\bgoogle\b|\bbrowse\b|\blatest\b|\bcurrent\b|\bnews\b|联网|上网|网上|网络|搜索|搜一下|查一下|查找|最新|新闻)/i.test(normalized);
  };

  const searchWeb = async (query) => {
    const trimmed = (query || '').trim();
    if (!trimmed) return '';

    try {
      const searchUrl = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(trimmed)}`;
      const res = await fetchWithTimeout(searchUrl, {
        headers: { Accept: 'text/html' },
      }, 12000);
      const html = await res.text();
      if (!res.ok || !html.trim()) return '';

      const resultPattern = /<a rel="nofollow" href="([^"]+)"[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>[\s\S]*?<td class=['"]result-snippet['"]>([\s\S]*?)<\/td>/gi;
      const results = [];
      let match;

      while ((match = resultPattern.exec(html)) && results.length < 5) {
        results.push({
          title: stripHtmlToText(match[2]),
          url: decodeDuckDuckGoUrl(match[1]),
          snippet: stripHtmlToText(match[3]),
        });
      }

      if (results.length === 0) {
        return `Web search query: ${trimmed}\n\nNo readable search results were returned.`;
      }

      const pageReads = await Promise.all(
        results.slice(0, 3).map(async (result) => {
          const text = await readWebPage(result.url);
          return text ? text.substring(0, 3000) : '';
        })
      );

      const summary = results.map((result, index) => [
        `${index + 1}. ${result.title}`,
        result.url,
        result.snippet,
      ].filter(Boolean).join('\n')).join('\n\n');

      const pageContext = pageReads
        .filter(Boolean)
        .map((text, index) => `Top result page ${index + 1}:\n${text}`)
        .join('\n\n---\n\n');

      return truncateWebContext([
        `Web search query: ${trimmed}`,
        `Search results:\n${summary}`,
        pageContext ? `Fetched page context:\n${pageContext}` : '',
      ].filter(Boolean).join('\n\n'));
    } catch (err) {
      console.warn("Web search failed:", err);
      return '';
    }
  };

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
      allowsMultipleSelection: true,
      selectionLimit: MAX_ATTACHMENTS,
      allowsEditing: false,
      quality: 0.8,
    });

    if (!result.canceled) {
      const imageAttachments = result.assets.map((asset, index) => ({
        uri: asset.uri,
        name: asset.fileName || `image-${Date.now()}-${index + 1}.jpg`,
        type: asset.mimeType || 'image/jpeg'
      }));
      addAttachments(imageAttachments);
    }
  };

  const pickDocument = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'text/markdown', 'text/csv'],
        copyToCacheDirectory: true,
        multiple: true
      });

      if (!result.canceled) {
        const documentAttachments = result.assets.map(asset => normalizeDocumentAsset(asset));
        if (documentAttachments.some(item => isLegacyWordAttachment(item))) {
          Alert.alert(
            "Legacy Word Format",
            "Older .doc files may not be readable. If this upload fails, save the document as .docx or PDF and upload that version."
          );
        }
        addAttachments(documentAttachments);
      }
    } catch (err) {
      console.warn("Document Picker Error:", err);
    }
  };

  const removeAttachment = (indexToRemove) => {
    setAttachments(prev => prev.filter((_, index) => index !== indexToRemove));
  };

  const clearAttachments = () => {
    setAttachments([]);
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

  const readAttachmentAsBase64 = async (activeAttachment) => {
    if (!activeAttachment?.uri) return null;
    try {
      const file = new FileSystem.File(activeAttachment.uri);
      if (typeof file.base64 === 'function') {
        return await file.base64();
      }
    } catch (err) {
      console.warn("Attachment base64 read failed:", err);
    }
    return null;
  };

  const readAttachmentAsText = async (activeAttachment) => {
    if (!activeAttachment?.uri) return '';
    try {
      const file = new FileSystem.File(activeAttachment.uri);
      if (typeof file.text === 'function') {
        return truncateDocumentText(await file.text());
      }
    } catch (err) {
      console.warn("Attachment text read failed:", err);
    }
    return '';
  };

  const readAttachmentAsBytes = async (activeAttachment) => {
    if (!activeAttachment?.uri) return null;
    try {
      const file = new FileSystem.File(activeAttachment.uri);
      if (typeof file.bytes === 'function') {
        return await file.bytes();
      }
    } catch (err) {
      console.warn("Attachment byte read failed:", err);
    }
    return null;
  };

  const extractPdfText = async (activeAttachment) => {
    if (!isPdfAttachment(activeAttachment)) return '';

    try {
      ensurePdfJsRuntime();
      const pdfjsModule = await import('pdfjs-dist/legacy/build/pdf.js');
      const pdfjs = pdfjsModule.getDocument ? pdfjsModule : pdfjsModule.default;
      const bytes = await readAttachmentAsBytes(activeAttachment);
      if (!bytes || !pdfjs?.getDocument) return '';

      const loadingTask = pdfjs.getDocument({
        data: bytes,
        disableWorker: true,
        isEvalSupported: false,
        useWorkerFetch: false,
      });
      const pdf = await loadingTask.promise;
      const pages = [];

      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map(item => item?.str || '')
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();

        if (pageText) pages.push(`[Page ${pageNumber}]\n${pageText}`);

        if (pages.join('\n\n').length >= MAX_INLINE_DOCUMENT_CHARS) break;
      }

      if (typeof loadingTask.destroy === 'function') {
        loadingTask.destroy();
      }

      return truncateDocumentText(pages.join('\n\n'));
    } catch (err) {
      console.warn("PDF text extraction failed:", err);
      return '';
    }
  };

  const extractDocxTextFromBase64 = async (base64Content) => {
    if (!base64Content) return '';

    try {
      const zip = await JSZip.loadAsync(base64Content, { base64: true });
      const wordXmlFiles = Object.keys(zip.files)
        .filter(name => /^word\/(document|footnotes|endnotes|comments|header\d+|footer\d+)\.xml$/.test(name))
        .sort((a, b) => {
          if (a === 'word/document.xml') return -1;
          if (b === 'word/document.xml') return 1;
          return a.localeCompare(b);
        });

      const sections = [];
      for (const fileName of wordXmlFiles) {
        const xml = await zip.file(fileName)?.async('string');
        const text = xml ? wordXmlToText(xml) : '';
        if (text) sections.push(text);
      }

      return truncateDocumentText(sections.join('\n\n'));
    } catch (err) {
      console.warn("DOCX text extraction failed:", err);
      return '';
    }
  };

  const buildMessageForAttachments = (message, activeAttachments, extractedText = '') => {
    if (!activeAttachments || activeAttachments.length === 0) return message;

    const names = activeAttachments.map((item, index) => `${index + 1}. ${item.name}`).join('\n');
    const hasLegacyWord = activeAttachments.some(item => isLegacyWordAttachment(item));

    const instructions = [
      `Use the newly attached files as the primary sources for this request:\n${names}`,
      "Do not summarize or answer from previously uploaded documents unless I explicitly ask for them.",
    ];

    if (extractedText) {
      instructions.push(
        "The current document text extracted on-device is below:",
        extractedText,
      );
    } else if (hasLegacyWord) {
      instructions.push(
        "One or more files are legacy .doc Word files. If their contents are unavailable, say that those files must be saved as .docx or PDF instead of using older document memory.",
      );
    }

    instructions.push(message || "Please summarize this file.");
    return instructions.join("\n\n");
  };

  const buildMessageWithWebContext = (message, webContextText = '') => {
    if (!webContextText) return message;

    return [
      "Use the following live web context as a primary source for this request. Cite URLs when relevant and say if the web context is incomplete.",
      webContextText,
      message,
    ].join('\n\n');
  };

  const collectWebContextForMessage = async (message) => {
    if (!message?.trim()) return '';

    const sections = [];
    const urls = extractUrls(message).slice(0, 3);

    for (const url of urls) {
      const pageText = await readWebPage(url);
      if (pageText) sections.push(pageText);
    }

    if (urls.length === 0 && shouldSearchWeb(message)) {
      const searchText = await searchWeb(message);
      if (searchText) sections.push(searchText);
    }

    return truncateWebContext(sections.filter(Boolean).join('\n\n---\n\n'));
  };

  const extractAttachmentText = async (activeAttachment, attachmentB64) => {
    if (!activeAttachment) return '';

    if (attachmentB64 && isDocxAttachment(activeAttachment)) {
      return await extractDocxTextFromBase64(attachmentB64);
    }

    if (isPdfAttachment(activeAttachment)) {
      return await extractPdfText(activeAttachment);
    }

    if (isPlainTextAttachment(activeAttachment)) {
      return await readAttachmentAsText(activeAttachment);
    }

    return '';
  };

  const sendMessage = async (overrideAttachment = null, isFromVoice = false) => {
    if (isTyping) return;

    // QUOTA ENFORCEMENT (v3.4.50)
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

    const activeAttachments = Array.isArray(overrideAttachment)
      ? overrideAttachment.filter(item => item?.uri)
      : ((overrideAttachment && overrideAttachment.uri) ? [overrideAttachment] : attachments);
    const hasAttachments = activeAttachments.length > 0;
    // ... rest of the setup
    const rawInput = isFromVoice ? localTranscript : input;
    if (!rawInput.trim() && !hasAttachments) return;

    const attachmentPayloads = [];
    const extractedTextSections = [];

    if (!isFromVoice && hasAttachments) {
      for (const [index, currentAttachment] of activeAttachments.entries()) {
        const attachmentB64 = await readAttachmentAsBase64(currentAttachment);
        const extractedText = await extractAttachmentText(currentAttachment, attachmentB64);

        attachmentPayloads.push({
          ...currentAttachment,
          base64: attachmentB64,
          extractedText,
          index,
        });

        if (extractedText) {
          extractedTextSections.push(`File ${index + 1}: ${currentAttachment.name}\n${extractedText}`);
        }
      }
    }

    const extractedText = truncateDocumentText(extractedTextSections.join('\n\n---\n\n'));
    const attachmentInput = buildMessageForAttachments(rawInput.trim(), activeAttachments, extractedText);
    const liveWebContext = !isFromVoice
      ? await collectWebContextForMessage(rawInput)
      : '';
    const contextualInput = buildMessageWithWebContext(attachmentInput, liveWebContext);
    const finalInput = isVoiceMode
      ? applyHandsFreeInstructions(contextualInput)
      : contextualInput;
    const requestPersona = isVoiceMode
      ? buildHandsFreePersona(persona)
      : persona;

    // Visual placeholder for voice
    const displayInput = isFromVoice ? rawInput : (input || (hasAttachments ? `User attached ${activeAttachments.length} file${activeAttachments.length > 1 ? 's' : ''}.` : "User attached a file."));
    const userMsg = {
      id: Date.now().toString(),
      role: 'user',
      content: displayInput,
      attachment: activeAttachments[0] || null,
      attachments: activeAttachments,
    };

    setMessages(prev => [...prev, userMsg]);
    incrementDailyCount(); // TRACK USAGE

    setInput('');
    setLocalTranscript('');
    setAttachments([]);
    setIsTyping(true);

    // Audio Playback Setup
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

    const formData = new FormData();
    formData.append('message', finalInput);
    formData.append('provider', provider);
    formData.append('persona', requestPersona);
    formData.append('history', JSON.stringify(hasAttachments && !isFromVoice ? [] : messages.slice(-20)));

    const openrouterProviders = [
      'openrouter', 'or_free', 'deepseek', 'deepseek_v3.2', 'deepseek_v4_pro', 
      'deepseek_v4_flash', 'qwen', 'gpt4o_mini', 'kimi_k2.6', 'minimax'
    ];
    
    const activeKey = 
      provider === 'groq' ? groqKey : 
      (provider === 'gemini' ? geminiKey : 
      (openrouterProviders.includes(provider) ? openrouterKey : openaiKey));
    
    if (activeKey) formData.append('api_key', activeKey.trim());

    if (isVoiceMode) {
      formData.append('synthesize_voice', 'True');
      formData.append('voice_model', selectedVoice);
      formData.append('response_style', 'hands_free_short_plain');
      formData.append('tts_instructions', HANDS_FREE_RESPONSE_RULES);
    }

    if (hasAttachments && !isFromVoice) {
      formData.append('attachment_count', String(attachmentPayloads.length));
      formData.append('attachments_metadata', JSON.stringify(attachmentPayloads.map(item => ({
        name: item.name,
        type: item.type,
        index: item.index,
        has_extracted_text: Boolean(item.extractedText),
      }))));

      attachmentPayloads.forEach((currentAttachment, index) => {
        const filePayload = {
          uri: currentAttachment.uri,
          name: currentAttachment.name,
          type: currentAttachment.type,
        };

        if (index === 0) {
          formData.append('file', filePayload);
          formData.append('file_name', currentAttachment.name);
          formData.append('file_type', currentAttachment.type);
        }

        formData.append('files', filePayload);
        formData.append(`file_${index + 1}`, filePayload);

        if (currentAttachment.base64) {
          const fieldPrefix = currentAttachment.type?.startsWith('image/') ? 'image_b64' : 'file_b64';
          formData.append(index === 0 ? fieldPrefix : `${fieldPrefix}_${index + 1}`, currentAttachment.base64);
        }
      });

      if (extractedText) {
        formData.append('file_text', extractedText);
        formData.append('document_text', extractedText);
      }
    }

    if (location) {
      formData.append('lat', location.coords.latitude.toString());
      formData.append('lon', location.coords.longitude.toString());
    }

    formData.append('client_time', new Date().toLocaleString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }));

    const activeToken = session?.access_token?.trim();
    if (!activeToken) {
      Alert.alert("Security Error", "Session expired. Please log in again.");
      setIsTyping(false);
      return;
    }

    let isHandled = false;
    // Capture XHR for abort functionality
    const xhr = chatStream(formData,
      (event, json) => {
        if (event === 'text' && json.token) {
          setStreamingContent(prev => prev + json.token);
        } else if (event === 'audio' && json.audio) {
          soundQueueRef.current.push(json.audio);
          if (!isPlayingQueueRef.current) playNextStreamChunk();
        } else if (event === 'transcript') {
          // REPAIR: Relaxed validation to ensure placeholder replacement even if data is structured differently
          const transcript = json.text || (typeof json === 'string' ? json : null);
          if (transcript) {
            setMessages(prev => prev.map(m =>
              m.id === userMsg.id ? { ...m, content: transcript } : m
            ));
          }
        } else if (event === 'error') {
          Alert.alert("Continuum Fault", json.detail || "An unexpected error occurred.");
          setIsTyping(false);
        }
      },
      (finalText, voiceTranscript) => {
        if (isHandled) return;
        isHandled = true;
        setIsTyping(false);
        setStreamingContent('');
        const responseText = isVoiceMode ? sanitizeHandsFreeText(finalText) : finalText;
        if (!responseText.trim()) return;

        setMessages(prev => {
          const aiMsg = { id: (Date.now() + 1).toString(), role: 'assistant', content: responseText };
          // REPAIR: Absolute safeguard to ensure 'Transcribing...' is ALWAYS replaced by the time the AI finishes
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
      },
      (err) => {
        setIsTyping(false);
        setStreamingContent('');
        Alert.alert("Chat Error", err);
      },
      activeToken
    );

    // Store reference to abort later if needed
    abortControllerRef.current = { abort: () => xhr.abort() };
  };

  const handleSendPress = async () => {
    try {
      if (recording) {
        await stopRecording();
        return;
      }

      if (input.trim() || attachments.length > 0) {
        await sendMessage();
        return;
      }

      await startRecording();
    } catch (err) {
      console.warn("Send button error:", err);
      setIsTyping(false);
      Alert.alert("Send Error", "Continuum could not start this message. Please try again.");
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
    const itemAttachments = item.attachments || (item.attachment ? [item.attachment] : []);

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
            {itemAttachments.length > 0 && (
              <View style={{ marginBottom: 8, gap: 8 }}>
                {itemAttachments.map((attachedItem, index) => (
                  <View key={`${attachedItem.uri}_${index}`}>
                    {attachedItem.type?.startsWith('image/') ? (
                      <Image 
                        source={{ uri: attachedItem.uri }} 
                        style={{ width: 220, height: 220, borderRadius: 12, backgroundColor: theme.colors.light }} 
                        resizeMode="cover"
                      />
                    ) : (
                      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.light, padding: 10, borderRadius: 10, borderLeftWidth: 3, borderLeftColor: theme.colors.primary }}>
                        <Ionicons name="document-attach" size={20} color={theme.colors.primary} />
                        <Text style={{ marginLeft: 8, fontSize: 13, color: theme.colors.black, fontWeight: '600', flex: 1 }} numberOfLines={1}>
                          {attachedItem.name}
                        </Text>
                      </View>
                    )}
                  </View>
                ))}
              </View>
            )}
            <Text style={item.role === 'user' ? styles.userChatText : styles.chatText}>{item.content}</Text>
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
        <View style={{ marginHorizontal: 16, marginBottom: 8, gap: 6 }}>
          {attachments.map((currentAttachment, index) => (
            <View key={`${currentAttachment.uri}_${index}`} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.light, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12 }}>
              <Ionicons name={currentAttachment.type?.startsWith('image/') ? "image" : "document-text"} size={20} color={theme.colors.primary} />
              <Text style={{ flex: 1, marginLeft: 8, fontSize: 12, color: theme.colors.black }} numberOfLines={1}>
                {currentAttachment.name}
              </Text>
              <TouchableOpacity onPress={() => removeAttachment(index)}>
                <Ionicons name="close-circle" size={20} color={theme.colors.danger} />
              </TouchableOpacity>
            </View>
          ))}
          {attachments.length > 1 && (
            <TouchableOpacity onPress={clearAttachments} style={{ alignSelf: 'flex-end', paddingHorizontal: 8, paddingVertical: 4 }}>
              <Text style={{ color: theme.colors.danger, fontSize: 11, fontWeight: '700' }}>Clear all</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <View style={[styles.inputWrapper, { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 10, paddingBottom: 10 }]}>
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
              "How would you like to provide intelligence?",
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
            style={styles.textInput}
            placeholder={attachments.length > 0 ? "Describe these files..." : "Message..."}
            value={input}
            onChangeText={setInput}
            multiline
            autoCorrect={true}
            spellCheck={true}
            autoCapitalize="sentences"
          />
          <TouchableOpacity
            onPress={handleSendPress}
            style={styles.sendPill}
          >
            <Ionicons name={recording ? "stop" : (input.trim() || attachments.length > 0 ? "arrow-up" : "mic-outline")} size={20} color="white" />
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
};

export default ChatSection;
