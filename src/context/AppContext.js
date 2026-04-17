import React, { createContext, useState, useContext, useEffect, useRef } from 'react';
import { Platform, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { supabase } from '../services/supabase';
import { fetchBrainAnalytics as apiFetchAnalytics } from '../services/apiService';

const AppContext = createContext();

export const AppProvider = ({ children }) => {
  const [activeTab, setActiveTab] = useState('chat'); 
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [serverStatus, setServerStatus] = useState('checking'); // 'healthy', 'degraded', 'offline'
  const [provider, setProvider] = useState('gemini');
  const [groqKey, setGroqKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [openrouterKey, setOpenrouterKey] = useState('');
  const [selectedVoice, setSelectedVoice] = useState('en-US-AvaNeural');
  const [persona, setPersona] = useState('You are a helpful, thorough AI assistant. Provide detailed explanations, comprehensive answers, and step-by-step guidance. Be polite and formal.');
  
  const [messages, setMessages] = useState([]);
  const [memories, setMemories] = useState([]);
  const [pinnedMemories, setPinnedMemories] = useState([]);
  const [brainStats, setBrainStats] = useState({
    semantic_total: 0,
    type_breakdown: {},
    total_kb: 0,
    pinned_total: 0,
    knowledge_chunks: 0,
    utilization_pct: 0
  });
  
  const [cloudWakingUp, setCloudWakingUp] = useState(false);
  const [backendStatus, setBackendStatus] = useState({ task: "Idle", progress: 100 });
  
  const isHistoryLoaded = useRef(false);

  // Persistence: Auth Handshake
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session) fetchAnalytics();
    });

    // Production Health Monitoring: Phase 3
    const checkPulse = async () => {
      if (!session?.access_token) return; // Silent skip if unauthenticated
      try {
        const res = await fetch(`${API_URL}/health`);
        if (res.ok) setServerStatus('healthy');
        else if (res.status === 503) setServerStatus('degraded');
        else setServerStatus('offline');
      } catch (e) {
        setServerStatus('offline');
      }
    };

    checkPulse();
    const pulseInterval = setInterval(checkPulse, 60000); // Pulse check every 60s

    return () => {
      subscription.unsubscribe();
      clearInterval(pulseInterval);
    };
  }, []);

  // Persistence: Load Vault
  useEffect(() => {
    const loadVault = async () => {
      try {
        const keys = await AsyncStorage.multiGet([
          '@groq_key', '@gemini_key', '@openai_key', '@openrouter_key', 
          '@provider', '@selected_voice', '@chat_history', '@persona'
        ]);
        
        keys.forEach(([key, value]) => {
          if (!value) return;
          if (key === '@groq_key') setGroqKey(value);
          if (key === '@gemini_key') setGeminiKey(value);
          if (key === '@openai_key') setOpenaiKey(value);
          if (key === '@openrouter_key') setOpenrouterKey(value);
          if (key === '@provider') setProvider(value);
          if (key === '@selected_voice') setSelectedVoice(value);
          if (key === '@persona') setPersona(value);
          if (key === '@chat_history') {
            const parsed = JSON.parse(value);
            setMessages(parsed.filter(m => m.content !== "🎙 Voice Transmission"));
          }
        });
        isHistoryLoaded.current = true;
      } catch (e) {
        console.warn("Vault load error:", e);
      }
    };
    loadVault();
    fetchAnalytics();
  }, []);

  // Persistence: Auto-Save History
  useEffect(() => {
    if (isHistoryLoaded.current) {
      const hardwareLimit = 2000;
      const optimizedHistory = messages.length > hardwareLimit ? messages.slice(-hardwareLimit) : messages;
      AsyncStorage.setItem('@chat_history', JSON.stringify(optimizedHistory)).catch(e => console.error(e));
    }
  }, [messages]);

  const saveKeys = async () => {
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const keyData = [
        ['@groq_key', groqKey.trim()],
        ['@gemini_key', geminiKey.trim()],
        ['@openai_key', openaiKey.trim()],
        ['@openrouter_key', openrouterKey.trim()],
        ['@selected_voice', selectedVoice],
        ['@provider', provider],
        ['@persona', persona]
      ];
      await AsyncStorage.multiSet(keyData);
      Alert.alert("🔒 Vault Locked", "Credentials and preferences synchronized.");
    } catch (e) {
      Alert.alert("Error", "Could not lock the vault.");
    }
  };

  const fetchAnalytics = async () => {
    if (!session?.access_token) return; // Silent skip if unauthenticated
    try {
      const data = await apiFetchAnalytics(setCloudWakingUp, session?.access_token);
      if (data) setBrainStats(data);
    } catch (err) {}
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setMessages([]);
    setMemories([]);
    setPinnedMemories([]);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const clearLocalHistory = async () => {
    try {
      setMessages([]);
      await AsyncStorage.removeItem('@chat_history');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      console.error("Clear local history failed:", e);
    }
  };

  const deleteAccount = async (wipeMemories = false) => {
    try {
      // 1. Backend Wipe
      await pulseFetch(`${API_URL}/account/delete`, {
        method: 'POST',
        body: JSON.stringify({ wipe_memories: wipeMemories })
      }, 2, null, session?.access_token);
      
      // 2. Local Cleanup
      await logout();
    } catch (e) {
      Alert.alert("Deletion Error", "Could not complete account deletion. Please try again.");
    }
  };

  return (
    <AppContext.Provider value={{
      user, session,
      activeTab, setActiveTab,
      provider, setProvider,
      groqKey, setGroqKey,
      geminiKey, setGeminiKey,
      openaiKey, setOpenaiKey,
      openrouterKey, setOpenrouterKey,
      selectedVoice, setSelectedVoice,
      persona, setPersona,
      messages, setMessages,
      memories, setMemories,
      pinnedMemories, setPinnedMemories,
      brainStats, setBrainStats,
      cloudWakingUp, setCloudWakingUp,
      backendStatus, setBackendStatus,
      saveKeys,
      fetchAnalytics,
      logout,
      clearLocalHistory,
      deleteAccount
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => useContext(AppContext);
