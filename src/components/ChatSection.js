import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, KeyboardAvoidingView, Platform, Image, Alert, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Clipboard from 'expo-clipboard';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent
} from 'expo-speech-recognition';
import { useAppContext } from '../context/AppContext';
import { chatStream } from '../services/apiService';
import { API_URL, SILENCE_THRESHOLD, SHORT_SILENCE_TIMEOUT, LONG_SILENCE_TIMEOUT } from '../constants/Config';
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
    isFeatureAvailable,
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

  const chatListRef = useRef();
  const abortControllerRef = useRef(null);
  const soundRef = useRef(null);
  const soundQueueRef = useRef([]);
  const isPlayingQueueRef = useRef(false);
  const silenceTimerRef = useRef(null);
  const longSilenceTimerRef = useRef(null);
  const stopRecordingRef = useRef(null);

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

  // Audio Cleanup
  useEffect(() => {
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

  // --- SCROLL STABILIZATION ENGINE ---
  useEffect(() => {
    if (activeTab === 'chat' && chatListRef.current) {
      const isFirst = isInitialLoad.current;
      
      // 1. Immediate Snap (Zero Delay)
      chatListRef.current.scrollToEnd({ animated: false });

      // 2. Settlement Scroll (Delayed to handle layout)
      const timer = setTimeout(() => {
        chatListRef.current.scrollToEnd({ animated: !isFirst });
        if (isFirst) isInitialLoad.current = false;
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [messages.length, streamingContent, activeTab]);

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
          { text: "View Plans", onPress: () => useAppContext().setActiveTab('subscription') }
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
    if (isTyping) return;
    const activeAttachment = (overrideAttachment && overrideAttachment.uri) ? overrideAttachment : attachment;

    // Check if we have local transcript AND no text input
    const finalInput = isFromVoice ? localTranscript : input;
    if (!finalInput.trim() && !activeAttachment) return;

    // Visual placeholder for voice
    const displayInput = isFromVoice ? finalInput : (input || (activeAttachment?.type?.startsWith('audio') ? "🎤 Processing..." : "User attached a file."));
    const userMsg = { id: Date.now().toString(), role: 'user', content: displayInput, attachment: activeAttachment };

    setMessages(prev => [...prev, userMsg]);

    setInput('');
    setLocalTranscript('');
    setAttachment(null);
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
    formData.append('persona', persona);
    formData.append('history', JSON.stringify(messages.slice(-20)));

    const activeKey = 
      provider === 'groq' ? groqKey : 
      (provider === 'gemini' ? geminiKey : 
      ((provider === 'openrouter' || provider === 'or_free' || provider === 'deepseek' || provider === 'qwen' || provider === 'gpt4o_mini') ? openrouterKey : openaiKey));
    if (activeKey) formData.append('api_key', activeKey.trim());

    if (isVoiceMode) {
      formData.append('synthesize_voice', 'True');
      formData.append('voice_model', selectedVoice);
    }

    if (activeAttachment && !isFromVoice) {
      formData.append('file', { uri: activeAttachment.uri, name: activeAttachment.name, type: activeAttachment.type });
    }

    const currentToken = session?.access_token;
    if (!currentToken) {
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
        if (!finalText.trim()) return;

        setMessages(prev => {
          const aiMsg = { id: (Date.now() + 1).toString(), role: 'assistant', content: finalText };
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
        Alert.alert("Error", err);
      },
      currentToken
    );

    // Store reference to abort later if needed
    abortControllerRef.current = { abort: () => xhr.abort() };
  };

  const renderChatItem = ({ item }) => (
    <TouchableOpacity
      activeOpacity={0.9}
      onLongPress={async () => {
        await Clipboard.setStringAsync(item.content);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        Alert.alert("Copied", "Message saved to clipboard.");
      }}
      style={item.role === 'user' ? styles.userBubble : styles.aiBubble}
    >
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
      <LatencyHeatmap data={item.latencyData} />
    </TouchableOpacity>
  );

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      style={styles.chatArea}
    >
      <View style={styles.providerBar}>
        <View style={{ flexDirection: 'row', gap: 6, flex: 1 }}>
          {['gemini', 'openrouter', 'gpt4o_mini', 'or_free'].map((p) => (
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
                {p === 'openrouter' ? 'Claude' : (p === 'or_free' ? 'OR FREE' : (p === 'gpt4o_mini' ? '4o MINI' : p.toUpperCase()))}
              </Text>
            </TouchableOpacity>
          ))}
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
        data={streamingContent.trim() ? [...messages, { id: 'stream', role: 'assistant', content: streamingContent }] : messages}
        keyExtractor={item => item.id}
        renderItem={renderChatItem}
        contentContainerStyle={{ padding: 16, flexGrow: 1 }}
        removeClippedSubviews={Platform.OS === 'android'}
        initialNumToRender={15}
        maxToRenderPerBatch={10}
        windowSize={5}
        maintainVisibleContentPosition={{
          minIndexForVisible: 0,
        }}
        onContentSizeChange={() => {
          if (activeTab === 'chat') {
            chatListRef.current?.scrollToEnd({ animated: false });
          }
        }}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.primary}
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
            placeholder={attachment ? "Describe this file..." : "Message..."}
            value={input}
            onChangeText={setInput}
            multiline
            autoCorrect={true}
            spellCheck={true}
            autoCapitalize="sentences"
          />
          <TouchableOpacity
            onPress={() => recording ? stopRecording() : (input.trim() || attachment ? sendMessage() : startRecording())}
            style={styles.sendPill}
          >
            <Ionicons name={recording ? "stop" : (input.trim() || attachment ? "arrow-up" : "mic-outline")} size={20} color="white" />
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
};

export default ChatSection;
