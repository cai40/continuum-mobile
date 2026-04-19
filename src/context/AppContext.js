import React, {
  createContext,
  useState,
  useContext,
  useEffect,
  useRef,
} from "react";
import { Platform, Alert } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { supabase } from "../services/supabase";
import { 
  fetchBrainAnalytics as apiFetchAnalytics,
  fetchChatHistory as apiFetchHistory,
  fetchMemories,
  pulseFetch
} from "../services/apiService";
import { API_URL } from "../constants/Config";

const AppContext = createContext();

export const AppProvider = ({ children }) => {
  const [activeTab, setActiveTab] = useState("chat");
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [serverStatus, setServerStatus] = useState("checking"); // 'healthy', 'degraded', 'offline'
  const [provider, setProvider] = useState("gemini");
  const [groqKey, setGroqKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [openrouterKey, setOpenrouterKey] = useState("");
  const [selectedVoice, setSelectedVoice] = useState("en-US-AvaNeural");
  const [persona, setPersona] = useState(
    "You are a helpful, thorough AI assistant. Provide detailed explanations, comprehensive answers, and step-by-step guidance. Be polite and formal.",
  );
  const [sttLang, setSttLang] = useState("en-US");

  const [messages, setMessages] = useState([]);
  const [semanticProfile, setSemanticProfile] = useState([]);
  const [temporalEvents, setTemporalEvents] = useState([]);
  const [episodicSegments, setEpisodicSegments] = useState([]);
  const [pinnedMemories, setPinnedMemories] = useState([]);
  const [knowledgeBase, setKnowledgeBase] = useState([]);
  const [trueCounts, setTrueCounts] = useState({ l1: 0, l2: 0, l3: 0, l4: 0, l5: 0 });
  const [brainStats, setBrainStats] = useState({
    semantic_total: 0,
    type_breakdown: {},
    total_kb: 0,
    pinned_total: 0,
    knowledge_chunks: 0,
    utilization_pct: 0,
  });

  const [cloudWakingUp, setCloudWakingUp] = useState(false);
  const [backendStatus, setBackendStatus] = useState({
    task: "Idle",
    progress: 100,
  });

  // 3-TIER SUBSCRIPTION ENGINE
  const [subscriptionTier, setSubscriptionTier] = useState("free"); // 'free', 'pro', 'elite'
  const [trialStart, setTrialStart] = useState(null);
  const [isSuperUser, setIsSuperUser] = useState(false);

  const isHistoryLoaded = useRef(false);

  // Persistence: Auth Handshake
  useEffect(() => {
    // Persistence: Auth Handshake (Hardened for OTA Reloads)
    const initializeAuth = async () => {
      try {
        // Give Supabase a 500ms grace period to hydrate from storage
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          setSession(session);
          setUser(session.user);
          fetchAnalytics();
        }
      } catch (e) {
        console.warn("Auth Handshake failed:", e);
      } finally {
        setIsInitializing(false);
      }
    };

    initializeAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const currentUser = session?.user ?? null;
      setSession(session);
      setUser(currentUser);
      
      // CHECK SUPER USER STATUS
      if (currentUser?.email === 'cai40@yahoo.com') {
        setIsSuperUser(true);
        setSubscriptionTier('elite');
      } else {
        setIsSuperUser(false);
        fetchSubscriptionData(currentUser);
      }
      
      if (session) fetchAnalytics();
    });

    // Production Health Monitoring: Phase 3
    const checkPulse = async () => {
      try {
        const res = await fetch(`${API_URL}/health`);
        if (res.ok) setServerStatus("healthy");
        else if (res.status === 503) setServerStatus("degraded");
        else setServerStatus("offline");
      } catch (e) {
        setServerStatus("offline");
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
          "@groq_key",
          "@gemini_key",
          "@openai_key",
          "@openrouter_key",
          "@provider",
          "@selected_voice",
          "@chat_history",
          "@persona",
          "@stt_lang",
        ]);

        keys.forEach(([key, value]) => {
          if (!value) return;
          if (key === "@groq_key") setGroqKey(value);
          if (key === "@gemini_key") setGeminiKey(value);
          if (key === "@openai_key") setOpenaiKey(value);
          if (key === "@openrouter_key") setOpenrouterKey(value);
          if (key === "@provider") setProvider(value);
          if (key === "@selected_voice") setSelectedVoice(value);
          if (key === "@persona") setPersona(value);
          if (key === "@stt_lang") setSttLang(value);
          if (key === "@chat_history") {
            const parsed = JSON.parse(value);
            setMessages(
              parsed.filter((m) => m.content !== "🎙 Voice Transmission"),
            );
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
      const optimizedHistory =
        messages.length > hardwareLimit
          ? messages.slice(-hardwareLimit)
          : messages;
      AsyncStorage.setItem(
        "@chat_history",
        JSON.stringify(optimizedHistory),
      ).catch((e) => console.error(e));
    }
  }, [messages]);

  const syncRemoteHistory = async () => {
    // We allow sync even if session is pending, as the backend is in Mock Mode for 2.0
    try {
      const history = await apiFetchHistory(setCloudWakingUp, session?.access_token);
      if (history && history.length > 0) {
        setMessages(prev => {
          // Merge strategy: Unique by ID, prioritized by remote
          const localIds = new Set(prev.map(m => m.id));
          const newMessages = history.filter(m => !localIds.has(m.id));
          return [...prev, ...newMessages].sort((a, b) => 
            new Date(a.timestamp) - new Date(b.timestamp)
          );
        });
      }
    } catch (err) {
      console.warn("Remote history sync failed:", err);
    }
  };

  useEffect(() => {
    if (session) {
      syncRemoteHistory();
      onRefreshMemories(); // Auto-load memory tab data on login/startup
    } else {
      // Clear all state on logout
      setMessages([]);
      setSemanticProfile([]);
      setTemporalEvents([]);
      setEpisodicSegments([]);
      setPinnedMemories([]);
      setKnowledgeBase([]);
      setTrueCounts({ l1: 0, l2: 0, l3: 0, l4: 0, l5: 0 });
    }
  }, [session]);

  // Intelligence Sync: Map brainStats to trueCounts for UI (Corrected for Layer Order)
  useEffect(() => {
    setTrueCounts({
      l1: brainStats.pinned_total || 0,
      l2: brainStats.episodic_total || 0,
      l3: brainStats.semantic_total || 0,
      l4: brainStats.temporal_total || 0,
      l5: brainStats.knowledge_chunks || 0,
    });
  }, [brainStats]);

  const saveKeys = async () => {
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const keyData = [
        ["@groq_key", groqKey.trim()],
        ["@gemini_key", geminiKey.trim()],
        ["@openai_key", openaiKey.trim()],
        ["@openrouter_key", openrouterKey.trim()],
        ["@selected_voice", selectedVoice],
        ["@provider", provider],
        ["@persona", persona],
        ["@stt_lang", sttLang],
      ];
      await AsyncStorage.multiSet(keyData);
      Alert.alert(
        "🔒 Vault Locked",
        "Credentials and preferences synchronized.",
      );
    } catch (e) {
      Alert.alert("Error", "Could not lock the vault.");
    }
  };

  const fetchAnalytics = async () => {
    if (!session?.access_token) return; // Silent skip if unauthenticated
    try {
      const data = await apiFetchAnalytics(
        setCloudWakingUp,
        session?.access_token,
      );
      if (data) setBrainStats(data);
    } catch (err) {
      console.warn("Analytics fetch failed:", err);
    }
  };

  const onRefreshMemories = async () => {
    if (!session?.access_token) return;
    try {
      const { layeredData, pinData, analytics } = await fetchMemories(
        setCloudWakingUp,
        session?.access_token,
      );
      if (layeredData) {
        setSemanticProfile(layeredData.semanticProfile || []);
        setTemporalEvents(layeredData.temporalEvents || []);
        setEpisodicSegments(layeredData.episodicSegments || []);
        setKnowledgeBase(layeredData.knowledgeBase || []);
        setTrueCounts(layeredData.trueCounts || { l1: 0, l2: 0, l3: 0, l4: 0, l5: 0 });
      }
      if (pinData) setPinnedMemories(pinData);
      if (analytics) setBrainStats(analytics);
    } catch (e) {
      console.error("Memory refresh failed:", e);
    }
  };

  const fetchSubscriptionData = async (currentUser) => {
    if (!currentUser) return;
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('subscription_tier, trial_start_date')
        .eq('id', currentUser.id)
        .single();
        
      if (data) {
        setSubscriptionTier(data.subscription_tier || 'free');
        setTrialStart(data.trial_start_date);
      }
    } catch (err) {
      console.warn("Failed to fetch subscription status:", err);
    }
  };

  const isFeatureAvailable = (tierRequired) => {
    if (isSuperUser) return true;
    
    const tiers = ['free', 'pro', 'elite'];
    const currentIdx = tiers.indexOf(subscriptionTier);
    const requiredIdx = tiers.indexOf(tierRequired);
    
    // Check trial status (30 days)
    if (trialStart && currentIdx < requiredIdx) {
      const start = new Date(trialStart);
      const now = new Date();
      const diffDays = Math.ceil((now - start) / (1000 * 60 * 60 * 24));
      if (diffDays <= 30) return true; // Trial active for all tiers
    }
    
    return currentIdx >= requiredIdx;
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setMessages([]);
    setSemanticProfile([]);
    setTemporalEvents([]);
    setEpisodicSegments([]);
    setPinnedMemories([]);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const clearLocalHistory = async () => {
    try {
      setMessages([]);
      await AsyncStorage.removeItem("@chat_history");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      console.error("Clear local history failed:", e);
    }
  };

  const deleteAccount = async (wipeMemories = false) => {
    try {
      // 1. Backend Wipe
      await pulseFetch(
        `${API_URL}/account/delete`,
        {
          method: "POST",
          body: JSON.stringify({ wipe_memories: wipeMemories }),
        },
        2,
        null,
        session?.access_token,
      );

      // 2. Local Cleanup
      await logout();
    } catch (e) {
      Alert.alert(
        "Deletion Error",
        "Could not complete account deletion. Please try again.",
      );
    }
  };

  return (
    <AppContext.Provider
      value={{
        user,
        session,
        activeTab,
        setActiveTab,
        provider,
        setProvider,
        groqKey,
        setGroqKey,
        geminiKey,
        setGeminiKey,
        openaiKey,
        setOpenaiKey,
        openrouterKey,
        setOpenrouterKey,
        selectedVoice,
        setSelectedVoice,
        persona,
        setPersona,
        sttLang,
        setSttLang,
        messages,
        setMessages,
        semanticProfile,
        setSemanticProfile,
        temporalEvents,
        setTemporalEvents,
        episodicSegments,
        setEpisodicSegments,
        pinnedMemories,
        setPinnedMemories,
        knowledgeBase,
        setKnowledgeBase,
        trueCounts,
        setTrueCounts,
        brainStats,
        setBrainStats,
        cloudWakingUp,
        setCloudWakingUp,
        serverStatus,
        setServerStatus,
        backendStatus,
        setBackendStatus,
        saveKeys,
        fetchAnalytics,
        syncRemoteHistory,
        onRefreshMemories,
        logout,
        clearLocalHistory,
        deleteAccount,
        isInitializing,
        subscriptionTier,
        setSubscriptionTier,
        isSuperUser,
        isFeatureAvailable,
        trialStart,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => useContext(AppContext);
