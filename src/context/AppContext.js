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
  pulseFetch,
  fetchSystemVersion
} from "../services/apiService";
import { API_URL } from "../constants/Config";

const AppContext = createContext();

export const AppProvider = ({ children }) => {
  const [activeTab, setActiveTab] = useState("chat");
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isBiometricAuthenticated, setIsBiometricAuthenticated] = useState(false);
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
  const [openclawVpsIp, setOpenclawVpsIp] = useState("135.181.155.197");
  const [openclawBridgeSecret, setOpenclawBridgeSecret] = useState("");

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
    progress: 100,
  });
  const [serverVersion, setServerVersion] = useState("Loading...");
  const [isSyncingHistory, setIsSyncingHistory] = useState(false);

  // 3-TIER SUBSCRIPTION ENGINE (v3.4.50 Refined)
  const [subscriptionTier, setSubscriptionTier] = useState("free"); // 'free', 'pro', 'elite'
  const [dailyMessageCount, setDailyMessageCount] = useState(0);
  const [isSuperUser, setIsSuperUser] = useState(false);
  const [hasAcceptedLegal, setHasAcceptedLegal] = useState(true); // Default to true during check

  const recordLegalAcceptance = async () => {
    try {
      const email = user?.email || "anonymous";
      const formData = new FormData();
      formData.append('email', email);
      formData.append('version', '1.0.0');

      await fetch(`${API_URL}/legal/accept`, {
        method: 'POST',
        body: formData,
      });

      await AsyncStorage.setItem(`legal_accepted_${email}`, 'true');
      setHasAcceptedLegal(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      console.warn("Legal recording failed:", e);
      // Still set local so they aren't blocked if offline, 
      // but the backend record is the primary audit.
      setHasAcceptedLegal(true);
    }
  };

  const getTierLimits = () => {
    if (isSuperUser || subscriptionTier === 'elite') return { daily: 9999, capacity: 50000 };
    if (subscriptionTier === 'pro') return { daily: 100, capacity: 5000 };
    return { daily: 10, capacity: 500 }; // Free
  };

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
          // Biometric is required for hydrated sessions on cold start
          setIsBiometricAuthenticated(false);
          
          // LEGAL STATUS CHECK (v3.4.55)
          const accepted = await AsyncStorage.getItem(`legal_accepted_${session.user.email}`);
          setHasAcceptedLegal(accepted === 'true');
          
          fetchAnalytics();
        } else {
          setHasAcceptedLegal(true); // Don't show modal on login screen
        }
        // Always try to fetch version even if no session
        const ver = await fetchSystemVersion();
        if (ver) setServerVersion(ver);
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

  // PERSISTENCE: DAILY QUOTA TRACKING
  useEffect(() => {
    const checkDailyReset = async () => {
      const lastDate = await AsyncStorage.getItem("@last_active_date");
      const today = new Date().toDateString();
      
      if (lastDate !== today) {
        setDailyMessageCount(0);
        await AsyncStorage.setItem("@last_active_date", today);
        await AsyncStorage.setItem("@daily_count", "0");
      } else {
        const savedCount = await AsyncStorage.getItem("@daily_count");
        if (savedCount) setDailyMessageCount(parseInt(savedCount));
      }
    };
    if (user) checkDailyReset();
  }, [user]);

  const incrementDailyCount = async () => {
    const newCount = dailyMessageCount + 1;
    setDailyMessageCount(newCount);
    await AsyncStorage.setItem("@daily_count", newCount.toString());
  };

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
          "@openclaw_vps_ip",
          "@openclaw_bridge_secret",
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
          if (key === "@openclaw_vps_ip") setOpenclawVpsIp(value);
          if (key === "@openclaw_bridge_secret") setOpenclawBridgeSecret(value);
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
      const hardwareLimit = 500; // Stricter memory cap for mobile stability
      const optimizedHistory =
        messages.length > hardwareLimit
          ? messages.slice(-hardwareLimit)
          : messages;
      
      // Filter out any potential non-serializable or null entries
      const safeHistory = optimizedHistory.filter(m => m && m.content && m.role);

      AsyncStorage.setItem(
        "@chat_history",
        JSON.stringify(safeHistory),
      ).catch((e) => console.error("Auto-save failed:", e));
    }
  }, [messages]);

  const syncRemoteHistory = async (explicitToken, retryCount = 0) => {
    const token = explicitToken || session?.access_token;
    if (!token) return;

    try {
      setIsSyncingHistory(true);
      console.log(`[Hydration] Syncing history (Attempt ${retryCount + 1})...`);
      const history = await apiFetchHistory(setCloudWakingUp, token);
      
      if (history && Array.isArray(history)) {
        if (history.length === 0 && retryCount < 2) {
           console.log("[Hydration] Empty history received, retrying in 2s...");
           setTimeout(() => syncRemoteHistory(token, retryCount + 1), 2000);
           return;
        }

        setMessages(prev => {
          const existingIds = new Set(prev.map(m => m.id));
          // Strict filtering to prevent crashes from malformed remote data
          const incoming = history.filter(m => m && m.id && m.content && !existingIds.has(m.id));
          
          if (incoming.length === 0) return prev;
          
          const combined = [...prev, ...incoming].sort((a, b) => {
            const dateA = a.timestamp ? new Date(a.timestamp) : new Date(0);
            const dateB = b.timestamp ? new Date(b.timestamp) : new Date(0);
            return dateA - dateB;
          });

          // Final Memory Safety Cap
          return combined.slice(-500);
        });
        console.log(`[Hydration] Success: Hydrated ${history.length} messages.`);
      }
    } catch (err) {
      console.warn("Remote history sync failed:", err);
      if (retryCount < 2) {
        setTimeout(() => syncRemoteHistory(token, retryCount + 1), 3000);
      }
    } finally {
      // Small buffer to allow the UI to settle before clearing sync flag
      setTimeout(() => setIsSyncingHistory(false), 800);
    }
  };

  useEffect(() => {
    if (session) {
      const token = session.access_token;
      syncRemoteHistory(token);
      onRefreshMemories(token); 
    } else {
      // Clear secondary states but keep messages for persistence
      setSemanticProfile([]);
      setTemporalEvents([]);
      setEpisodicSegments([]);
      setPinnedMemories([]);
      setKnowledgeBase([]);
      setTrueCounts({ l1: 0, l2: 0, l3: 0, l4: 0, l5: 0 });
    }
  }, [session]);

  // Intelligence Sync: Map brainStats to trueCounts for UI (Corrected for v3.4.15+ format)
  useEffect(() => {
    if (!brainStats) return;
    
    // If backend sends the new trueCounts object, use it directly
    if (brainStats.trueCounts) {
      setTrueCounts(brainStats.trueCounts);
    } else {
      // Fallback for older format if necessary
      setTrueCounts({
        l1: brainStats.pinned_total || 0,
        l2: brainStats.episodic_total || 0,
        l3: brainStats.semantic_total || 0,
        l4: brainStats.temporal_total || 0,
        l5: brainStats.knowledge_chunks || 0,
      });
    }
  }, [brainStats]);

  const saveOpenClawSettings = async () => {
    try {
      await AsyncStorage.multiSet([
        ["@openclaw_vps_ip", openclawVpsIp.trim()],
        ["@openclaw_bridge_secret", openclawBridgeSecret.trim()],
      ]);
    } catch (e) {
      console.warn("OpenClaw settings save failed:", e);
    }
  };

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
      if (data) {
        setBrainStats(data);
        if (data.version) setServerVersion(data.version);
      }
    } catch (err) {
      console.warn("Analytics fetch failed:", err);
    }
  };

  const onRefreshMemories = async (explicitToken) => {
    const token = explicitToken || session?.access_token;
    if (!token) return;
    try {
      const { layeredData, pinData, analytics } = await fetchMemories(
        setCloudWakingUp,
        token,
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
    setIsBiometricAuthenticated(false);
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
        openclawVpsIp,
        setOpenclawVpsIp,
        openclawBridgeSecret,
        setOpenclawBridgeSecret,
        saveOpenClawSettings,
        messages,
        setMessages,
        dailyMessageCount,
        incrementDailyCount,
        getTierLimits,
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
        serverVersion,
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
        isSyncingHistory,
        hasAcceptedLegal,
        recordLegalAcceptance,
        subscriptionTier,
        setSubscriptionTier,
        isSuperUser,
        isFeatureAvailable,
        trialStart,
        isBiometricAuthenticated,
        setIsBiometricAuthenticated,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => useContext(AppContext);
