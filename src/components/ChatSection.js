import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, KeyboardAvoidingView, Platform, Image, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Clipboard from 'expo-clipboard';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { useAppContext } from '../context/AppContext';
import { chatStream } from '../services/apiService';
import { API_URL, SILENCE_THRESHOLD, SHORT_SILENCE_TIMEOUT, LONG_SILENCE_TIMEOUT } from '../constants/Config';
import { styles, theme } from '../styles/theme';
import LatencyHeatmap from './shared/LatencyHeatmap';

const ChatSection = () => {
  const {
    messages, setMessages,
    provider, groqKey, geminiKey, openaiKey, openrouterKey,
    selectedVoice, persona,
    activeTab,
    session
  } = useAppContext();

  const [input, setInput] = useState('');
  const [attachment, setAttachment] = useState(null);
  const [isTyping, setIsTyping] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [recording, setRecording] = useState(null);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const chatListRef = useRef();
  const abortControllerRef = useRef(null);
  const soundRef = useRef(null);
  const soundQueueRef = useRef([]);
  const isPlayingQueueRef = useRef(false);
  const silenceTimerRef = useRef(null);
  const longSilenceTimerRef = useRef(null);
  const stopRecordingRef = useRef(null);

  // Audio Cleanup
  useEffect(() => {
    return () => {
      if (soundRef.current) soundRef.current.unloadAsync();
      if (recording) recording.stopAndUnloadAsync();
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
    try {
      await Audio.requestPermissionsAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
        (status) => {
            if (status.isRecording && status.metering !== undefined) {
               if (status.metering < SILENCE_THRESHOLD) {
                  if (!silenceTimerRef.current) {
                      silenceTimerRef.current = setTimeout(() => stopRecordingRef.current?.(), SHORT_SILENCE_TIMEOUT);
                  }
                  if (isVoiceMode && !longSilenceTimerRef.current) {
                      longSilenceTimerRef.current = setTimeout(() => {
                          setIsVoiceMode(false);
                          stopRecordingRef.current?.();
                      }, LONG_SILENCE_TIMEOUT);
                  }
               } else {
                  if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
                  if (longSilenceTimerRef.current) { clearTimeout(longSilenceTimerRef.current); longSilenceTimerRef.current = null; }
               }
            }
        },
        200
      );
      setRecording(recording);
    } catch (err) { console.error(err); }
  };

  const stopRecording = async () => {
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    if (longSilenceTimerRef.current) { clearTimeout(longSilenceTimerRef.current); longSilenceTimerRef.current = null; }
    if (!recording) return;
    setRecording(null);
    await recording.stopAndUnloadAsync();
    const uri = recording.getURI();
    sendMessage({ uri, name: 'voice_memo.m4a', type: 'audio/m4a' });
  };
  stopRecordingRef.current = stopRecording;

  const sendMessage = async (overrideAttachment = null) => {
    if (isTyping) return;
    const activeAttachment = (overrideAttachment && overrideAttachment.uri) ? overrideAttachment : attachment;
    if (!input.trim() && !activeAttachment) return; 

    const currentInput = input || (activeAttachment?.type?.startsWith('audio') ? "🎤 Transcribing..." : "User attached a file.");
    const userMsg = { id: Date.now().toString(), role: 'user', content: currentInput, attachment: activeAttachment };
    const isVoiceTurn = activeAttachment?.type?.startsWith('audio');

    setMessages(prev => [...prev, userMsg]);
    
    setInput('');
    setAttachment(null);
    setIsTyping(true);

    // Ensure audio mode is set for playback (especially if we didn't just record)
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
    formData.append('message', currentInput);
    formData.append('provider', provider);
    formData.append('persona', persona);
    formData.append('history', JSON.stringify(messages.slice(-20)));
    
    const activeKey = provider === 'groq' ? groqKey : (provider === 'gemini' ? geminiKey : (provider === 'openrouter' ? openrouterKey : openaiKey));
    if (activeKey) formData.append('api_key', activeKey.trim());
    if (isVoiceMode) {
      formData.append('synthesize_voice', 'True');
      formData.append('voice_model', selectedVoice);
    }

    if (activeAttachment) {
      if (isVoiceTurn) {
        const base64Audio = await FileSystem.readAsStringAsync(activeAttachment.uri, { encoding: 'base64' });
        formData.append('file_b64', base64Audio);
      } else {
        formData.append('file', { uri: activeAttachment.uri, name: activeAttachment.name, type: activeAttachment.type });
      }
    }

    let isHandled = false;
    chatStream(formData, 
      (event, json) => {
        if (event === 'text' && json.token) {
          setStreamingContent(prev => prev + json.token);
        } else if (event === 'audio' && json.audio) {
          soundQueueRef.current.push(json.audio);
          if (!isPlayingQueueRef.current) playNextStreamChunk();
        } else if (event === 'transcript' && json.text) {
          setMessages(prev => prev.map(m => 
            m.id === userMsg.id ? { ...m, content: json.text } : m
          ));
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
          // If it was a voice turn, we rely on the 'transcript' event to have updated the user bubble,
          // but we do a final safety check here.
          if (isVoiceTurn) {
            return prev.map(m => m.id === userMsg.id ? { ...m, content: voiceTranscript || m.content } : m).concat(aiMsg);
          }
          return [...prev, aiMsg];
        });
      },
      (err) => {
        setIsTyping(false);
        Alert.alert("Error", err);
      },
      session?.access_token
    );
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
      {item.attachment?.type.startsWith('image/') && (
          <Image source={{uri: item.attachment.uri}} style={{width: 240, height: 240, borderRadius: 16, marginBottom: 10}} />
      )}
      <Text style={item.role === 'user' ? styles.userChatText : styles.chatText}>{item.content}</Text>
      <LatencyHeatmap data={item.latencyData} />
    </TouchableOpacity>
  );

  return (
    <View style={styles.chatArea}>
      <View style={styles.providerBar}>
          <TouchableOpacity 
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setIsVoiceMode(!isVoiceMode); }} 
            style={{
              backgroundColor: isVoiceMode ? theme.colors.success : theme.colors.light, 
              flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20
            }}
          >
            <Ionicons name={isVoiceMode ? "mic" : "mic-off"} size={16} color={isVoiceMode ? "white" : theme.colors.gray} style={{marginRight: 6}} />
            <Text style={{color: isVoiceMode ? "white" : theme.colors.gray, fontWeight: '800', fontSize: 11}}>
              HANDS-FREE: {isVoiceMode ? 'ON' : 'OFF'}
            </Text>
          </TouchableOpacity>
      </View>

      <FlatList
        ref={chatListRef}
        data={streamingContent.trim() ? [...messages, { id: 'stream', role: 'assistant', content: streamingContent }] : messages}
        keyExtractor={item => item.id}
        renderItem={renderChatItem}
        contentContainerStyle={{ padding: 16 }}
        onContentSizeChange={() => chatListRef.current?.scrollToEnd({ animated: false })}
      />
      
      {(recording || isTyping || isSpeaking) && (
          <View style={{flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 8}}>
              <Text style={[styles.typingIndicator, {flex: 1}]}>
                {recording ? "Listening..." : (isSpeaking ? "Speaking..." : "Analyzing...")}
              </Text>
              {(isTyping || isSpeaking) && (
                <TouchableOpacity style={[styles.stopButton, {backgroundColor: theme.colors.danger}]} onPress={handleStop}>
                    <Text style={{color: 'white', fontWeight: 'bold'}}>Stop</Text>
                </TouchableOpacity>
              )}
          </View>
      )}

      <View style={styles.inputWrapper}>
        <View style={styles.capsuleInput}>
          <TextInput 
            style={styles.textInput}
            placeholder="Message..."
            value={input}
            onChangeText={setInput}
            multiline
          />
          <TouchableOpacity 
            onPress={() => recording ? stopRecording() : (input.trim() ? sendMessage() : startRecording())} 
            style={styles.sendPill}
          >
            <Ionicons name={recording ? "stop" : (input.trim() ? "arrow-up" : "mic-outline")} size={20} color="white" />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

export default ChatSection;
