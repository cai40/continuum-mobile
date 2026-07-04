import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, KeyboardAvoidingView, Platform, Image, Alert, RefreshControl, Keyboard } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Clipboard from 'expo-clipboard';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import * as Location from 'expo-location';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent
} from 'expo-speech-recognition';
import { useAppContext } from '../context/AppContext';
import { chatStream, openClawChatStream } from '../services/apiService';
import { API_URL, SILENCE_THRESHOLD, SHORT_SILENCE_TIMEOUT, LONG_SILENCE_TIMEOUT } from '../constants/Config';
import { resolveBridgeBaseUrl, resolveBridgeSecret, isHttpsBridgeUrl } from '../utils/openclawBridge';
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
    dailyMessageCount,
    incrementDailyCount,
    getTierLimits,
    subscriptionTier,
    setActiveTab,
  } = useAppContext();

  const [input, setInput] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [attachment, setAttachment] = useState(null);
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
      allowsEditing: true,
      quality: 0.8,
    });

    if (!result.canceled) {
      const asset = result.assets[0];
      setAttachment({
        uri: asset.uri,
        name: asset.fileName || 'image.jpg',
        type: asset.mimeType || 'image/jpeg'
      });
    }
  };

  const pickDocument = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'],
        copyToCacheDirectory: true
      });

      if (!result.canceled) {
        const asset = result.assets[0];
        setAttachment({
          uri: asset.uri,
          name: asset.name,
          type: asset.mimeType || 'application/octet-stream'
        });
      }
    } catch (err) {
      console.warn("Document Picker Error:", err);
    }
  };

  const clearAttachment = () => {
    setAttachment(null);
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

      const activeAttachment = (overrideAttachment && overrideAttachment.uri) ? overrideAttachment : attachment;
      const finalInput = isFromVoice ? localTranscript : input;
      if (!finalInput.trim() && !activeAttachment) return;

      const isEmailQuery = /\b(email|inbox|yahoo|mail|unread|smtp|imap)\b/i.test(finalInput);

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
      const bridgeUrl = resolveBridgeBaseUrl({
        httpsUrl: openclawBridgeHttpsUrl,
        vpsIp: openclawVpsIp,
        defaultVpsIp: "135.181.155.197",
      });
      const useOpenClawBridge =
        openclawChatEnabled &&
        bridgeUrl &&
        isHttpsBridgeUrl(bridgeUrl) &&
        !activeAttachment &&
        !isVoiceMode;

      if (isEmailQuery && !useOpenClawBridge) {
        Alert.alert(
          "Yahoo email needs OpenClaw bridge",
          "Setup → OpenClaw Gateway:\n• Route chat through OpenClaw: ON\n• HTTPS Bridge URL: your trycloudflare.com URL\n• Save, then ask again.",
        );
        return;
      }

      const displayInput = isFromVoice ? finalInput : (input || (activeAttachment?.type?.startsWith('audio') ? "🎤 Processing..." : "User attached a file."));
      const userMsg = { id: Date.now().toString(), role: 'user', content: displayInput, attachment: activeAttachment };

      setMessages(prev => [...prev, userMsg]);
      incrementDailyCount();
      setInput('');
      setLocalTranscript('');
      setAttachment(null);
      dismissKeyboard();
      setIsTyping(true);

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
      formData.append('persona', persona);
      formData.append('history', JSON.stringify(messages.slice(-20)));
      if (activeKey) formData.append('api_key', activeKey.trim());
      if (isVoiceMode) {
        formData.append('synthesize_voice', 'True');
        formData.append('voice_model', selectedVoice);
      }
      if (activeAttachment && !isFromVoice) {
        formData.append('file', { uri: activeAttachment.uri, name: activeAttachment.name, type: activeAttachment.type });
      }
      if (location) {
        formData.append('lat', location.coords.latitude.toString());
        formData.append('lon', location.coords.longitude.toString());
      }
      formData.append('client_time', new Date().toLocaleString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }));

      const clientTime = new Date().toLocaleString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });

      let isHandled = false;
      let bridgeAttempted = useOpenClawBridge;
      let renderFallbackUsed = false;

      const typingSafetyTimer = setTimeout(() => {
        setIsTyping(false);
        setStreamingContent('');
      }, isEmailQuery ? 180000 : 130000);

      const clearTypingSafety = () => clearTimeout(typingSafetyTimer);

      const finishSuccess = (finalText, voiceTranscript) => {
        if (!finalText.trim() && bridgeAttempted && !renderFallbackUsed) {
          finishError("Bridge returned empty reply");
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
        Alert.alert("Chat Error", String(err || "Could not send message."));
      };

      const onStreamUpdate = (event, json) => {
        if (event === 'text' && json.token) {
          setStreamingContent(prev => prev + json.token);
        } else if (event === 'audio' && json.audio) {
          soundQueueRef.current.push(json.audio);
          if (!isPlayingQueueRef.current) playNextStreamChunk();
        } else if (event === 'transcript') {
          const transcript = json.text || (typeof json === 'string' ? json : null);
          if (transcript) {
            setMessages(prev => prev.map(m =>
              m.id === userMsg.id ? { ...m, content: transcript } : m
            ));
          }
        } else if (event === 'error') {
          finishError(json.detail || "An unexpected error occurred.");
        }
      };

      if (useOpenClawBridge) {
        const payload = {
          message: finalInput,
          provider,
          persona,
          history: messages.slice(-20),
          gemini_key: provider === 'gemini' ? (geminiKey || '').trim() : '',
          groq_key: provider === 'groq' ? (groqKey || '').trim() : '',
          api_key: (activeKey || '').trim(),
          lat: location?.coords?.latitude?.toString(),
          lon: location?.coords?.longitude?.toString(),
          client_time: clientTime,
        };
        const xhr = openClawChatStream(
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
    if (input.trim() || attachment) {
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
            {item.attachment && (
              <View style={{ marginBottom: 8 }}>
                {item.attachment.type.startsWith('image/') ? (
                  <Image 
                    source={{ uri: item.attachment.uri }} 
                    style={{ width: 220, height: 220, borderRadius: 12, backgroundColor: theme.colors.light }} 
                    resizeMode="cover"
                  />
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.light, padding: 10, borderRadius: 10, borderLeftWidth: 3, borderLeftColor: theme.colors.primary }}>
                    <Ionicons name="document-attach" size={20} color={theme.colors.primary} />
                    <Text style={{ marginLeft: 8, fontSize: 13, color: theme.colors.black, fontWeight: '600' }} numberOfLines={1}>
                      {item.attachment.name}
                    </Text>
                  </View>
                )}
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

      {attachment && (
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 8, backgroundColor: theme.colors.light, marginHorizontal: 16, padding: 8, borderRadius: 12 }}>
          <Ionicons name={attachment.type.startsWith('image/') ? "image" : "document-text"} size={20} color={theme.colors.primary} />
          <Text style={{ flex: 1, marginLeft: 8, fontSize: 12, color: theme.colors.black }} numberOfLines={1}>
            {attachment.name}
          </Text>
          <TouchableOpacity onPress={clearAttachment}>
            <Ionicons name="close-circle" size={20} color={theme.colors.danger} />
          </TouchableOpacity>
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
            ref={inputRef}
            style={styles.textInput}
            placeholder={attachment ? "Describe this file..." : "Message..."}
            value={input}
            onChangeText={setInput}
            multiline
            autoCorrect={true}
            spellCheck={true}
            autoCapitalize="sentences"
            returnKeyType="send"
            blurOnSubmit={true}
            onSubmitEditing={() => {
              if (input.trim() || attachment) onPressSend();
            }}
          />
          <TouchableOpacity
            onPress={onPressSend}
            style={styles.sendPill}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            activeOpacity={0.7}
          >
            <Ionicons name={recording ? "stop" : (input.trim() || attachment ? "arrow-up" : "mic-outline")} size={20} color="white" />
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
};

export default ChatSection;
