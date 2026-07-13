import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  Platform,
  FlatList,
  RefreshControl,
  Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Updates from "expo-updates";
import * as DocumentPicker from 'expo-document-picker';
import * as Constants from "expo-constants";
import { useAppContext } from "../context/AppContext";
import { pulseFetch, ingestDocuments, pinCoreMemory, deleteMemoryItem, dedupeMemoryLayer, runMemoryCleanup } from "../services/apiService";
import {
  DOCUMENT_MIME_TYPES,
  MAX_DOCUMENT_ATTACHMENTS,
  documentTypeLabel,
  normalizePickedAsset,
} from "../utils/documentTypes";
import { API_URL, BUILD_ID, GIT_COMMIT } from "../constants/Config";
import { styles, theme } from "../styles/theme";
import { formatFullDate, getImportanceColor } from "../utils/helpers";
import {
  collectMemoryMatches,
  countInteractionOnlyMatches,
  filterMemoryList,
  memoryFragmentKind,
  memoryItemKey,
  memoryItemMeta,
  memoryItemText,
  MEMORY_DEFAULT_VISIBLE,
} from "../utils/memoryDisplay";
import MemoryFragmentCard from "./shared/MemoryFragmentCard";
import { MemorySearchPanel } from "./shared/MemorySearchPanel";
import { cleanUpPhotoAlbum, loadLastPhotoCleanupRun } from "../utils/photoAlbumCleanup";
import { requestPhotoCleanupCancel, isPhotoCleanupCancelledError } from "../utils/photoCleanupCancel";
import PhotoCleanupPreviewPanel from "./PhotoCleanupPreviewPanel";
import { formatPhotoPreviewAlertSummary } from "../utils/photoCleanupPreview";
import OpenClawIntegrationSection from "./OpenClawIntegrationSection";

const SettingsSection = (props) => {
  const {
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
    saveKeys,
    logout,
    clearLocalHistory,
    deleteAccount,
    user,
    session,
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
    setCloudWakingUp,
    persona,
    setPersona,
    sttLang,
    setSttLang,
    subscriptionTier,
    isSuperUser,
    serverVersion,
    onRefreshMemories,
  } = useAppContext();

  const onUpgrade = props.onUpgrade;

  // Navigation State
  const [activeSubTab, setActiveSubTab] = useState(null); // null, 'api', 'voice', 'persona', 'data', 'openclaw', 'diag', 'account'

  // Visibility States
  const [showGroq, setShowGroq] = useState(false);
  const [showGemini, setShowGemini] = useState(false);
  const [showOpenAI, setShowOpenAI] = useState(false);
  const [showOpenRouter, setShowOpenRouter] = useState(false);

  // Memory Sub-Tab States
  const [isSyncing, setIsSyncing] = useState(false);
  const [runningMemoryCleanup, setRunningMemoryCleanup] = useState(false);
  const [syncProgress, setSyncProgress] = useState("");
  const [isCloudChecking, setIsCloudChecking] = useState(false);
  const [newCoreMemory, setNewCoreMemory] = useState("");
  const [showAddCore, setShowAddCore] = useState(false);
  const [expandedLayers, setExpandedLayers] = useState({
    l1: false,
    l2: false,
    l3: false,
    l4: false,
    l5: false
  });
  const [memorySearchQuery, setMemorySearchQuery] = useState('');
  const [expandedMemoryIds, setExpandedMemoryIds] = useState({});
  const [memoryShowAll, setMemoryShowAll] = useState({
    l1: false, l2: false, l3: false, l4: false, l5: false,
  });
  const [cloudPulse, setCloudPulse] = useState(null);

  // Archetype States
  const [archetypes, setArchetypes] = useState([]);
  const [expandedArchetypes, setExpandedArchetypes] = useState({});
  const [archetypeItems, setArchetypeItems] = useState({});
  const [isLoadingArchetypes, setIsLoadingArchetypes] = useState(false);

  const [photoCleanup, setPhotoCleanup] = useState(null);
  const [runningPhotoCleanup, setRunningPhotoCleanup] = useState(false);
  const [photoCleanupProgress, setPhotoCleanupProgress] = useState("");

  useEffect(() => {
    const fetchPulse = async () => {
      try {
        const res = await fetch(`${API_URL}/system/status`);
        if (res.ok) {
          const data = await res.json();
          setCloudPulse(data);
        }
      } catch (e) {}
    };
    fetchPulse();
    const interval = setInterval(fetchPulse, 30000); // Pulse every 30s
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (activeSubTab === 'data') {
      fetchArchetypes();
      loadLastPhotoCleanupRun().then(setPhotoCleanup).catch(() => {});
    }
  }, [activeSubTab]);

  const fetchArchetypes = async () => {
    setIsLoadingArchetypes(true);
    try {
      const res = await pulseFetch(`${API_URL}/brain/archetypes`, { method: "GET" }, 3, setCloudWakingUp, session?.access_token);
      setArchetypes(res || []);
    } catch (e) {
      console.warn("Failed to fetch archetypes:", e);
    } finally {
      setIsLoadingArchetypes(false);
    }
  };

  const fetchArchetypeItems = async (name) => {
    if (archetypeItems[name]) return; // Already loaded
    try {
      const res = await pulseFetch(`${API_URL}/brain/archetypes/${encodeURIComponent(name)}`, { method: "GET" }, 3, setCloudWakingUp, session?.access_token);
      setArchetypeItems(prev => ({ ...prev, [name]: res || [] }));
    } catch (e) {
      console.warn(`Failed to fetch items for archetype ${name}:`, e);
    }
  };

  const toggleArchetype = (name) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const isExpanding = !expandedArchetypes[name];
    setExpandedArchetypes(prev => ({
      ...prev,
      [name]: isExpanding
    }));
    if (isExpanding) {
      fetchArchetypeItems(name);
    }
  };

  const toggleLayer = (layer) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpandedLayers(prev => ({
      ...prev,
      [layer]: !prev[layer]
    }));
  };

  const toggleMemoryExpanded = (key) => {
    setExpandedMemoryIds((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const memoryLayers = {
    pinnedMemories,
    episodicSegments,
    semanticProfile,
    temporalEvents,
    knowledgeBase,
  };

  const memorySearchMatches = collectMemoryMatches(memoryLayers, memorySearchQuery);
  const questionLogCount = countInteractionOnlyMatches(memoryLayers, memorySearchQuery);
  const hasMemorySearch = String(memorySearchQuery || '').trim().length > 0;

  const renderMemoryLayerItems = (items, layer, borderColor, emptyText) => {
    const filtered = filterMemoryList(items, layer, memorySearchQuery);
    if (hasMemorySearch && filtered.length === 0) {
      return (
        <Text style={{ fontSize: 12, color: theme.colors.gray, fontStyle: 'italic', marginBottom: 10 }}>
          No matches in this layer.
        </Text>
      );
    }
    if (!filtered.length) {
      return (
        <Text style={{ fontSize: 12, color: theme.colors.gray, fontStyle: 'italic', marginBottom: 10 }}>
          {emptyText}
        </Text>
      );
    }

    const visibleCap = hasMemorySearch || memoryShowAll[layer]
      ? filtered.length
      : MEMORY_DEFAULT_VISIBLE;
    const visible = filtered.slice(0, visibleCap);
    const hiddenCount = filtered.length - visible.length;

    return (
      <>
        {visible.map((item, index) => {
          const key = memoryItemKey(layer, item, index);
          const text = memoryItemText(item, layer);
          const kind = memoryFragmentKind(text, layer);
          return (
            <MemoryFragmentCard
              key={key}
              text={text}
              meta={memoryItemMeta(item, layer)}
              kind={kind}
              expanded={!!expandedMemoryIds[key]}
              onToggle={() => toggleMemoryExpanded(key)}
              onDelete={() => handleDeleteMemory(layer, item)}
              borderColor={kind === 'evidence' ? theme.colors.success : borderColor}
            />
          );
        })}
        {hiddenCount > 0 ? (
          <TouchableOpacity
            onPress={() => setMemoryShowAll((prev) => ({ ...prev, [layer]: true }))}
            style={{ paddingVertical: 8, marginBottom: 8 }}
          >
            <Text style={{ fontSize: 12, color: theme.colors.primary, fontWeight: '700' }}>
              Show {hiddenCount} more in this layer
            </Text>
          </TouchableOpacity>
        ) : null}
      </>
    );
  };

  const renderLayerDedupeAction = (layer, label) => (
    <TouchableOpacity
      onPress={() => handleDedupeLayer(layer, label)}
      style={{ alignSelf: 'flex-end', marginBottom: 10 }}
    >
      <Text style={{ fontSize: 11, fontWeight: '600', color: theme.colors.danger }}>
        Remove duplicates in {label}
      </Text>
    </TouchableOpacity>
  );

  const handleSyncKnowledge = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: DOCUMENT_MIME_TYPES,
        copyToCacheDirectory: true,
        multiple: true,
      });

      if (result.canceled) return;

      const assets = (result.assets || []).slice(0, MAX_DOCUMENT_ATTACHMENTS);
      if (result.assets?.length > MAX_DOCUMENT_ATTACHMENTS) {
        Alert.alert(
          "File limit",
          `Only the first ${MAX_DOCUMENT_ATTACHMENTS} files will be uploaded.`,
        );
      }

      const files = assets.map(normalizePickedAsset);
      const summary = files
        .map((f) => `• ${f.name} (${documentTypeLabel(f.type, f.name)})`)
        .join("\n");

      Alert.alert(
        "Intelligence Ingestion",
        `Upload ${files.length} file(s) to Layer 5?\n\n${summary}`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Begin Sync",
            onPress: async () => {
              setIsSyncing(true);
              setSyncProgress("");
              try {
                const { succeeded, failed } = await ingestDocuments(files, {
                  authToken: session?.access_token,
                  onStatusUpdate: setCloudWakingUp,
                  onFileStart: (index, total, name) => {
                    setSyncProgress(`Uploading ${index}/${total}: ${name}`);
                  },
                });

                if (failed.length === 0) {
                  Alert.alert(
                    "Sync Successful",
                    `${succeeded.length} document(s) sent to the Render indexer. They will appear in Layer 5 once processing completes.`,
                  );
                } else if (succeeded.length === 0) {
                  Alert.alert(
                    "Sync Failed",
                    failed.map((f) => `${f.name}: ${f.error}`).join("\n").slice(0, 500),
                  );
                } else {
                  Alert.alert(
                    "Partial Sync",
                    `Uploaded: ${succeeded.length}\nFailed: ${failed.length}\n\n${failed.map((f) => f.name).join(", ")}`,
                  );
                }
              } catch (e) {
                Alert.alert(
                  "Sync Fault",
                  "The cloud brain was unable to receive the document(s). Ensure your subscription is active.",
                );
              } finally {
                setIsSyncing(false);
                setSyncProgress("");
              }
            },
          },
        ],
      );
    } catch (err) {
      console.warn("Document Picker Error:", err);
    }
  };

  const manualCloudSync = async () => {
    setIsCloudChecking(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const update = await Updates.checkForUpdateAsync();
      if (update.isAvailable) {
        await Updates.fetchUpdateAsync();
        await Updates.reloadAsync();
      } else {
        Alert.alert(
          "Cloud Check Complete",
          "No new updates found in the cloud. Force reload to apply any cached changes?",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Force Reload", onPress: () => Updates.reloadAsync() }
          ]
        );
      }
    } catch (e) {
      Updates.reloadAsync().catch(() => {});
    } finally {
      setIsCloudChecking(false);
    }
  };

  const voices = [
    {
      id: "en-US-AvaNeural",
      name: "Ava (US Female)",
      desc: "Clear & Contemporary",
    },
    {
      id: "en-US-AndrewNeural",
      name: "Andrew (US Male)",
      desc: "Friendly & Warm",
    },
    { id: "en-US-EmmaNeural", name: "Emma (US Female)", desc: "Soft & Gentle" },
    { id: "en-US-BrianNeural", name: "Brian (US Male)", desc: "Professional" },
    {
      id: "en-GB-SoniaNeural",
      name: "Sonia (UK Female)",
      desc: "Sophisticated British",
    },
    { id: "en-GB-RyanNeural", name: "Ryan (UK Male)", desc: "Natural British" },
  ];

  const [legalModal, setLegalModal] = useState({ visible: false, title: "", content: "" });

  const PRIVACY_TEXT = `CONTINUUM PRIVACY POLICY (v3.1.0_FORTRESS)
Last Updated: April 2026

At Continuum, your privacy is our core architectural principle. This "Legal Fortress" update ensures maximum protection for your semantic repository.

1. DATA STEWARDSHIP & OWNERSHIP
All "Fragments" (Core Truths, Episodes, Semantic Profile) are your sole property. Continuum acts strictly as a steward. We do not sell or monetize your personal intelligence.

2. CLOUD VAULT ENCRYPTION
Your data is stored in a private Supabase instance with AES-256 encryption at rest and TLS 1.3 in transit. Only your UUID-authenticated session can access these fragments.

3. AI PROCESSING & ANONYMIZATION
Fragments are transmitted to Large Language Model (LLM) providers (Gemini/Groq/OpenAI) for real-time inference. According to their Enterprise-grade API terms, this data is NOT used for training their base models.

4. USER-CONTROLLED PURGE (THE KILL SWITCH)
We provide an absolute right to be forgotten. Activating the "Delete Account" function triggers a CASCADE deletion across all SQL tables and Vector embeddings. This is irreversible.

5. NO TRACKING or ADVERTISEMENTS
Continuum contains zero third-party tracking pixels, cookies, or advertisement engines. Your behavioral data belongs to you.`;

  const TERMS_TEXT = `CONTINUUM TERMS OF SERVICE (v3.1.0_FORTRESS)
Last Updated: April 2026

By accessing the Continuum Autonomous AI Advisor, you agree to these legally binding terms.

1. SCOPE OF SERVICE
Continuum is an autonomous, memory-aware software utility. It provides guidance based on historical fragments you provided.

2. NO PROFESSIONAL ADVICE (LIMITATION OF LIABILITY)
CONTINUUM IS NOT A LICENSED PROFESSIONAL. AI-generated advice is for informational and organizational purposes only. It does not constitute medical, legal, financial, or psychological advice. YOU AGREE THAT YOU ARE SOLELY RESPONSIBLE FOR ANY ACTIONS TAKEN BASED ON CONTINUUM'S ADVICE.

3. NO-WARRANTY (AS-IS)
THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE". TO THE MAXIMUM EXTENT PERMITTED BY LAW, CONTINUUM AND ITS DEVELOPERS DISCLAIM ALL WARRANTIES, EXPRESS OR IMPLIED, AND SHALL NOT BE LIABLE FOR ANY DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES ARISING FROM SYSTEM DOWNTIME, DATA LOSS, OR AI INACCURACIES.

4. INTELLECTUAL PROPERTY
The "Continuum" branding, figure-8 logo, "Zen Daylight" UI, and multi-layered memory engine logic are the exclusive intellectual property of the developers.

5. SERVICE TERMINATION
We reserve the right to suspend accounts violating safety protocols. You may terminate this agreement at any time by using the Account Deletion tool.`;


  const handleOpenLegal = (type) => {
    if (type === 'privacy') {
      setLegalModal({ visible: true, title: "Privacy Policy", content: PRIVACY_TEXT });
    } else {
      setLegalModal({ visible: true, title: "Terms of Service", content: TERMS_TEXT });
    }
  };

  const handleAddCore = async () => {
    if (!newCoreMemory.trim()) return;
    try {
      await pinCoreMemory(
        newCoreMemory.trim(),
        session?.access_token,
        'Manual',
        user?.id,
      );
      setNewCoreMemory("");
      setShowAddCore(false);
      try {
        await onRefreshMemories();
      } catch {
        // local pin saved
      }
      Alert.alert('Pinned to L1', 'Saved on this device.');
    } catch (e) {
      Alert.alert("Error", e?.message || "Could not save core memory.");
    }
  };

  const handlePinMemoryFragment = async (text, layerLabel = 'Memory') => {
    const content = String(text || '').trim();
    if (!content) return;
    try {
      await pinCoreMemory(content, session?.access_token, layerLabel, user?.id);
      try {
        await onRefreshMemories();
      } catch {
        // local pin saved
      }
      Alert.alert('Pinned to L1', 'Saved on this device.');
    } catch (e) {
      Alert.alert('Pin failed', e?.message || 'Could not save to Core Memory.');
    }
  };

  const removeItemFromLayerState = (layer, item) => {
    const sameItem = (row) => {
      if (item?.id != null && row?.id != null) return String(row.id) === String(item.id);
      return memoryItemText(row, layer) === memoryItemText(item, layer);
    };
    const dec = (n) => Math.max(0, (n || 0) - 1);
    if (layer === 'l1') {
      setPinnedMemories((prev) => prev.filter((row) => !sameItem(row)));
      setTrueCounts((prev) => ({ ...prev, l1: dec(prev.l1) }));
    } else if (layer === 'l2') {
      setEpisodicSegments((prev) => prev.filter((row) => !sameItem(row)));
      setTrueCounts((prev) => ({ ...prev, l2: dec(prev.l2) }));
    } else if (layer === 'l3') {
      setSemanticProfile((prev) => prev.filter((row) => !sameItem(row)));
      setTrueCounts((prev) => ({ ...prev, l3: dec(prev.l3) }));
    } else if (layer === 'l4') {
      setTemporalEvents((prev) => prev.filter((row) => !sameItem(row)));
      setTrueCounts((prev) => ({ ...prev, l4: dec(prev.l4) }));
    } else if (layer === 'l5') {
      setKnowledgeBase((prev) => prev.filter((row) => !sameItem(row)));
      setTrueCounts((prev) => ({ ...prev, l5: dec(prev.l5) }));
    }
  };

  const handleDeleteMemory = (layer, item) => {
    const preview = memoryItemText(item, layer).slice(0, 140);
    Alert.alert(
      'Remove this memory?',
      `${preview}${preview.length >= 140 ? '…' : ''}\n\nRemoved items stay hidden on this device. Cloud delete runs when the backend supports it.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              await deleteMemoryItem(layer, item, session?.access_token, user?.id);
              removeItemFromLayerState(layer, item);
              try {
                await onRefreshMemories();
              } catch {
                // hidden locally
              }
            } catch (e) {
              Alert.alert('Remove failed', e?.message || 'Could not remove this memory.');
            }
          },
        },
      ],
    );
  };

  const handleDedupeLayer = (layer, label) => {
    const itemsByLayer = {
      l1: pinnedMemories,
      l2: episodicSegments,
      l3: semanticProfile,
      l4: temporalEvents,
      l5: knowledgeBase,
    };
    Alert.alert(
      `Remove duplicates in ${label}?`,
      'Keeps the newest copy of each identical fragment (punctuation-insensitive). Others are removed or hidden.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove duplicates',
          style: 'destructive',
          onPress: async () => {
            try {
              setIsSyncing(true);
              const removed = await dedupeMemoryLayer(
                layer,
                itemsByLayer[layer] || [],
                session?.access_token,
                user?.id,
              );
              await onRefreshMemories();
              Alert.alert('Done', removed > 0 ? `Removed ${removed} duplicate(s) in ${label}.` : `No duplicates found in ${label}.`);
            } catch (e) {
              Alert.alert('Dedupe failed', e?.message || 'Could not remove duplicates.');
            } finally {
              setIsSyncing(false);
            }
          },
        },
      ],
    );
  };

  const handleMemoryCleanup = () => {
    Alert.alert(
      'Run memory cleanup?',
      'Scans L1–L5 for duplicates (keeps newest), runs server consolidation when available, then cleans duplicates on this device.\n\nPinned truths and email evidence you kept are not affected unless they are exact duplicates.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Run cleanup',
          onPress: async () => {
            try {
              setRunningMemoryCleanup(true);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              const result = await runMemoryCleanup(
                memoryLayers,
                session?.access_token,
                user?.id,
              );
              try {
                await onRefreshMemories();
              } catch {
                // vault counts may lag if Render is waking — local dedupe still applied
              }
              const lines = [];
              if (result.serverRan) {
                lines.push(
                  result.source === 'email_bridge'
                    ? `Server (email bridge): removed ${result.serverRemoved} fragment(s) from cloud vault.`
                    : `Server: removed ${result.serverRemoved} fragment(s).`,
                );
              } else if (result.serverSkipped) {
                if (result.skipReason === 'service_key_missing') {
                  lines.push('Server: add SUPABASE_SERVICE_ROLE_KEY on Render email bridge (see README). Device dedupe ran.');
                } else if (result.skipReason === 'not_deployed') {
                  lines.push('Server: consolidation route not deployed — on-device dedupe only.');
                } else if (result.skipReason === 'upstream_unavailable' || result.skipReason === 'network') {
                  lines.push('Server: cloud busy or waking — on-device dedupe only.');
                } else {
                  lines.push('Server: skipped — on-device dedupe only.');
                }
              }
              if (result.localRemoved > 0) {
                const c = result.localCounts;
                lines.push(
                  `Device: removed ${result.localRemoved} duplicate(s) (L1 ${c.l1}, L2 ${c.l2}, L3 ${c.l3}, L4 ${c.l4}, L5 ${c.l5}).`,
                );
              } else if (!result.serverRan || result.serverRemoved === 0) {
                lines.push('No duplicates found on this device.');
              }
              Alert.alert(
                result.totalRemoved > 0 ? 'Memory cleanup complete' : 'Memory vault is clean',
                lines.join('\n'),
              );
            } catch (e) {
              Alert.alert('Cleanup failed', e?.message || 'Could not run memory cleanup.');
            } finally {
              setRunningMemoryCleanup(false);
            }
          },
        },
      ],
    );
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      "MANDATORY KILL SWITCH",
      "This will PERMANENTLY delete your identity, chat history, and all 5 memory layers from the cloud brain. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "DELETE EVERYTHING", 
          style: "destructive",
          onPress: async () => {
            try {
              setIsSyncing(true);
              const res = await pulseFetch(
                `${API_URL}/account/delete`,
                {
                  method: "POST",
                  body: JSON.stringify({ wipe_memories: true }),
                },
                3,
                setCloudWakingUp,
                session?.access_token,
              );
              
              if (res.status === "success") {
                Alert.alert("Identity Purged", "Your data has been successfully wiped from the continuum.");
                await supabase.auth.signOut();
              }
            } catch (e) {
              Alert.alert("Purge Failure", "Could not connect to the vault to delete data.");
            } finally {
              setIsSyncing(false);
            }
          }
        }
      ]
    );
  };

  const renderDiagnosticPanel = () => (
    <View
      style={{
        marginTop: 40,
        padding: 15,
        backgroundColor: theme.colors.lightGray,
        borderRadius: 12,
        borderStyle: "dashed",
        borderWidth: 1,
        borderColor: theme.colors.gray,
      }}
    >
      <Text
        style={{
          fontSize: 10,
          fontWeight: "700",
          color: theme.colors.gray,
          marginBottom: 5,
        }}
      >
        SYSTEM DIAGNOSTIC
      </Text>
      <Text style={{ fontSize: 9, color: theme.colors.gray }}>
        USER_ID: {session?.user?.id || "ANONYMOUS"}
      </Text>
      <Text style={{ fontSize: 9, color: theme.colors.gray }}>
        BACKEND: {session?.access_token ? "AUTHENTICATED" : "LOCAL_ONLY"}
      </Text>
      <Text style={{ fontSize: 9, color: theme.colors.gray, fontWeight: '800' }}>
        APP_VERSION: {BUILD_ID}
      </Text>
      <Text style={{ fontSize: 9, color: theme.colors.gray }}>
        CLOUD_NODE: {serverVersion}
      </Text>
      <Text style={{ fontSize: 9, color: theme.colors.gray }}>
        GIT_BLUEPRINT: {GIT_COMMIT}
      </Text>

      <Text
        style={{
          fontSize: 10,
          fontWeight: "700",
          color: theme.colors.primary,
          marginTop: 15,
          marginBottom: 5,
        }}
      >
        INFRASTRUCTURE MAP
      </Text>
      <Text style={{ fontSize: 9, color: theme.colors.gray }}>
        API_NODE: {API_URL.replace('https://', '')}
      </Text>
      <Text style={{ fontSize: 9, color: theme.colors.gray }}>
        REPO_BACKEND: github.com/cai40/continuum-backend
      </Text>
      <Text style={{ fontSize: 9, color: theme.colors.gray }}>
        REPO_MOBILE: github.com/cai40/continuum-mobile
      </Text>
      <Text style={{ fontSize: 9, color: theme.colors.gray }}>
        VECTOR_VAULT: Supabase (PostgreSQL + pgvector)
      </Text>
      <Text style={{ fontSize: 9, color: theme.colors.gray }}>
        SENTRY_SHIELD: Connected (v7.2.0)
      </Text>
      <Text style={{ fontSize: 9, color: theme.colors.gray }}>
        STORAGE: Cloud (Encrypted)
      </Text>

      <Text
        style={{
          fontSize: 10,
          fontWeight: "700",
          color: theme.colors.primary,
          marginTop: 15,
          marginBottom: 5,
        }}
      >
        RENDER CLOUD PULSE
      </Text>
      <Text style={{ fontSize: 9, color: theme.colors.gray }}>
        NODE_STATUS: {cloudPulse?.status || "Connecting..."}
      </Text>
      <Text style={{ fontSize: 9, color: theme.colors.gray }}>
        SERVER_COMMIT: {cloudPulse?.commit?.substring(0, 7) || "Checking..."}
      </Text>
      <Text style={{ fontSize: 9, color: theme.colors.gray }}>
        DEPLOY_URL: {cloudPulse?.deploy_url || "..."}
      </Text>
      <Text style={{ fontSize: 9, color: theme.colors.gray }}>
        DEPLOY_TIME: {cloudPulse?.deploy_time ? new Date(cloudPulse.deploy_time).toLocaleString() : "..."}
      </Text>
      <Text style={{ fontSize: 9, color: theme.colors.gray }}>
        REGION: {cloudPulse?.region || "USA"}
      </Text>
      <Text style={{ fontSize: 9, color: theme.colors.gray }}>
        SERVER_TIME: {cloudPulse?.timestamp ? new Date(cloudPulse.timestamp).toLocaleTimeString() : "..."}
      </Text>

      <Text
        style={{
          fontSize: 10,
          fontWeight: "700",
          color: theme.colors.primary,
          marginTop: 15,
          marginBottom: 5,
        }}
      >
        CLOUD TELEMETRY
      </Text>
      <Text style={{ fontSize: 9, color: theme.colors.gray }}>
        RUNTIME: {Updates.runtimeVersion || "exposdk:54.0.0"}
      </Text>
      <Text style={{ fontSize: 9, color: theme.colors.gray }}>
        CHANNEL: {Updates.channel || "production"} (Stable)
      </Text>
      <Text style={{ fontSize: 9, color: theme.colors.gray }}>
        UPDATE_ID: {Updates.updateId?.substring(0, 12) || "v8131-Live"}
      </Text>
      <Text style={{ fontSize: 9, color: theme.colors.gray }}>
        LAUNCHED: {Updates.createdAt ? new Date(Updates.createdAt).toLocaleTimeString() : new Date().toLocaleTimeString()}
      </Text>
      <Text style={{ fontSize: 9, color: theme.colors.gray }}>
        EXPO_BRANCH: {Updates.channel || "production"}
      </Text>
      <Text style={{ fontSize: 9, color: theme.colors.gray }}>
        BUILD_PROFILE: {Constants.default.appOwnership === 'expo' ? 'Expo Go (Dev)' : 'Standalone (Prod)'}
      </Text>

      <Text
        style={{
          fontSize: 10,
          fontWeight: "700",
          color: theme.colors.primary,
          marginTop: 15,
          marginBottom: 5,
        }}
      >
        PROJECT METADATA
      </Text>
      <Text style={{ fontSize: 9, color: theme.colors.gray }}>
        ID: 72c2f736-f17d-4c5d-8037-44bd9ff2e341
      </Text>
      <Text style={{ fontSize: 9, color: theme.colors.gray }}>
        SLUG: continuum-2-0
      </Text>
      <Text style={{ fontSize: 9, color: theme.colors.gray }}>
        OWNER: yongyaocai
      </Text>

      <TouchableOpacity
        onPress={manualCloudSync}
        disabled={isCloudChecking}
        style={{
          backgroundColor: theme.colors.primary,
          paddingVertical: 10,
          borderRadius: 8,
          marginTop: 15,
          alignItems: "center",
          opacity: isCloudChecking ? 0.6 : 1,
        }}
      >
        <Text style={{ color: "white", fontSize: 11, fontWeight: "800" }}>
          {isCloudChecking ? "FETCHING CLOUD BUNDLE..." : "FORCE CLOUD SYNC"}
        </Text>
      </TouchableOpacity>
    </View>
  );

  const renderHeader = (title) => (
    <View
      style={{ flexDirection: "row", alignItems: "center", marginBottom: 20 }}
    >
      <TouchableOpacity
        onPress={() => setActiveSubTab(null)}
        style={{ marginRight: 12, padding: 4 }}
      >
        <Ionicons name="arrow-back" size={24} color={theme.colors.primary} />
      </TouchableOpacity>
      <Text
        style={{ fontSize: 20, fontWeight: "800", color: theme.colors.black }}
      >
        {title}
      </Text>
    </View>
  );

  const renderAPISettings = () => (
    <ScrollView 
      style={{ flex: 1 }} 
      contentContainerStyle={{ paddingBottom: 400 }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {renderHeader("Intelligence Keys")}

      <Text style={categoryTitleStyle}>ACTIVE BRAIN PROVIDER</Text>
      <View style={{ gap: 10, marginBottom: 24 }}>
        {/* Row 1: Global Standards */}
        <View style={{ flexDirection: "row", gap: 10 }}>
          {["gemini", "groq", "openai", "openrouter"].map((p) => (
            <TouchableOpacity
              key={p}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setProvider(p);
              }}
              style={{
                flex: 1,
                backgroundColor:
                  provider === p ? theme.colors.primary : theme.colors.white,
                paddingVertical: 10,
                borderRadius: 12,
                alignItems: "center",
                borderWidth: 1,
                borderColor:
                  provider === p ? theme.colors.primary : theme.colors.border,
              }}
            >
              <Text
                style={{
                  color: provider === p ? "white" : theme.colors.gray,
                  fontSize: 10,
                  fontWeight: "800",
                  textTransform: "uppercase",
                }}
              >
                {p.replace("openrouter", "CLAUDE")}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Row 2: Specialized / Balanced */}
        <View style={{ flexDirection: "row", gap: 10 }}>
          {["gpt4o_mini", "or_free", "deepseek_v3.2", "qwen"].map((p) => (
            <TouchableOpacity
              key={p}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setProvider(p);
              }}
              style={{
                flex: 1,
                backgroundColor:
                  provider === p ? theme.colors.secondary : theme.colors.white,
                paddingVertical: 10,
                borderRadius: 12,
                alignItems: "center",
                borderWidth: 1,
                borderColor:
                  provider === p ? theme.colors.secondary : theme.colors.border,
              }}
            >
              <Text
                style={{
                  color: provider === p ? "white" : theme.colors.gray,
                  fontSize: 10,
                  fontWeight: "800",
                  textTransform: "uppercase",
                }}
              >
                {p === "or_free" ? "OR FREE" : (p === "gpt4o_mini" ? "4O MINI" : (p === "deepseek_v3.2" ? "DS V3.2" : p))}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Row 3: Advanced Intelligence [NEW] */}
        <View style={{ flexDirection: "row", gap: 10 }}>
          {["kimi_k2.6", "deepseek_v4_pro"].map((p) => (
            <TouchableOpacity
              key={p}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setProvider(p);
              }}
              style={{
                flex: 1,
                backgroundColor:
                  provider === p ? '#6C5CE7' : theme.colors.white,
                paddingVertical: 10,
                borderRadius: 12,
                alignItems: "center",
                borderWidth: 1,
                borderColor:
                  provider === p ? '#6C5CE7' : theme.colors.border,
              }}
            >
              <Text
                style={{
                  color: provider === p ? "white" : theme.colors.gray,
                  fontSize: 10,
                  fontWeight: "800",
                  textTransform: "uppercase",
                }}
              >
                {p === "kimi_k2.6" ? "KIMI K2.6" : "DS V4 PRO"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Row 4: Speed & Variety [NEW] */}
        <View style={{ flexDirection: "row", gap: 10 }}>
          {["deepseek_v4_flash", "minimax"].map((p) => (
            <TouchableOpacity
              key={p}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setProvider(p);
              }}
              style={{
                flex: 1,
                backgroundColor:
                  provider === p ? '#00B894' : theme.colors.white,
                paddingVertical: 10,
                borderRadius: 12,
                alignItems: "center",
                borderWidth: 1,
                borderColor:
                  provider === p ? '#00B894' : theme.colors.border,
              }}
            >
              <Text
                style={{
                  color: provider === p ? "white" : theme.colors.gray,
                  fontSize: 10,
                  fontWeight: "800",
                  textTransform: "uppercase",
                }}
              >
                {p === "deepseek_v4_flash" ? "DS V4 FLASH" : "MINIMAX"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <Text style={categoryTitleStyle}>API CREDENTIALS (VAULT)</Text>
      <View style={styles.groupedCard}>
        <KeyInputRow
          label="Google Gemini"
          value={geminiKey}
          setValue={setGeminiKey}
          show={showGemini}
          setShow={setShowGemini}
        />
        <Divider />
        <KeyInputRow
          label="Groq (Fast)"
          value={groqKey}
          setValue={setGroqKey}
          show={showGroq}
          setShow={setShowGroq}
        />
        <Divider />
        <KeyInputRow
          label="OpenAI (GPT-4o)"
          value={openaiKey}
          setValue={setOpenaiKey}
          show={showOpenAI}
          setShow={setShowOpenAI}
        />
        <Divider />
        <KeyInputRow
          label="OpenRouter"
          value={openrouterKey}
          setValue={setOpenrouterKey}
          show={showOpenRouter}
          setShow={setShowOpenRouter}
        />
      </View>

      <TouchableOpacity
        onPress={saveKeys}
        style={{
          backgroundColor: theme.colors.primary,
          paddingVertical: 16,
          borderRadius: 16,
          marginTop: 24,
          alignItems: "center",
        }}
      >
        <Text style={{ color: "white", fontWeight: "800", fontSize: 15 }}>
          SECURE ALL KEYS
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );

  const renderVoiceSettings = () => (
    <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
      {renderHeader("Neural Voice")}
      <Text style={categoryTitleStyle}>VOICE PERSONALITY</Text>
      <View style={styles.groupedCard}>
        {voices.map((v, idx) => (
          <React.Fragment key={v.id}>
            <TouchableOpacity
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setSelectedVoice(v.id);
              }}
              style={{
                padding: 16,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <View>
                <Text
                  style={{
                    fontSize: 15,
                    fontWeight: "600",
                    color: theme.colors.black,
                  }}
                >
                  {v.name}
                </Text>
                <Text style={{ fontSize: 12, color: theme.colors.gray }}>
                  {v.desc}
                </Text>
              </View>
              {selectedVoice === v.id && (
                <Ionicons
                  name="checkmark-circle"
                  size={24}
                  color={theme.colors.success}
                />
              )}
            </TouchableOpacity>
            {idx < voices.length - 1 && <Divider />}
          </React.Fragment>
        ))}
      </View>

      <Text style={[categoryTitleStyle, {marginTop: 24}]}>LISTENING LANGUAGE (STT)</Text>
      <View style={styles.groupedCard}>
        {[
          { id: 'en-US', label: '🇺🇸 English (US)', desc: 'Optimized for North American speech' },
          { id: 'zh-CN', label: '🇨🇳 Chinese (Mainland)', desc: 'Optimized for Mandarin speech' },
          { id: 'es-ES', label: '🇪🇸 Spanish (Spain)', desc: 'Optimized for Castilian speech' }
        ].map((lang, idx) => (
          <React.Fragment key={lang.id}>
            <TouchableOpacity
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setSttLang(lang.id);
              }}
              style={{
                padding: 16,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <View>
                <Text style={{ fontSize: 15, fontWeight: "600", color: theme.colors.black }}>
                  {lang.label}
                </Text>
                <Text style={{ fontSize: 12, color: theme.colors.gray }}>
                  {lang.desc}
                </Text>
              </View>
              {sttLang === lang.id && (
                <Ionicons
                  name="checkmark-circle"
                  size={24}
                  color={theme.colors.success}
                />
              )}
            </TouchableOpacity>
            {idx < 1 && <Divider />}
          </React.Fragment>
        ))}
      </View>
    </ScrollView>
  );

  const renderDataSettings = () => (
    <ScrollView
      style={{ flex: 1 }}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={isSyncing}
          onRefresh={async () => {
          setIsSyncing(true);
          await onRefreshMemories();
          setIsSyncing(false);
        }}
          tintColor={theme.colors.primary}
        />
      }
    >
      {renderHeader("Data & Memory OS")}

      {/* --- NEURAL CAPACITY MONITOR (v3.4.50) --- */}
      <View style={{ marginBottom: 24 }}>
        <Text style={[categoryTitleStyle, { marginBottom: 12 }]}>NEURAL STORAGE & QUOTA</Text>
        <View style={[styles.groupedCard, { padding: 18, backgroundColor: theme.colors.white }]}>
          
          {/* Fact Storage Capacity */}
          <View style={{ marginBottom: 16 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text style={{ fontSize: 10, fontWeight: '800', color: theme.colors.gray }}>FACT STORAGE CAPACITY</Text>
              <Text style={{ fontSize: 10, fontWeight: '800', color: theme.colors.primary }}>
                {trueCounts.l1 + trueCounts.l2 + trueCounts.l3 + trueCounts.l4 + trueCounts.l5} / {useAppContext().getTierLimits().capacity}
              </Text>
            </View>
            <View style={{ height: 8, backgroundColor: theme.colors.light, borderRadius: 4, overflow: 'hidden' }}>
              <View 
                style={{ 
                  width: `${Math.min(100, ((trueCounts.l1 + trueCounts.l2 + trueCounts.l3 + trueCounts.l4 + trueCounts.l5) / useAppContext().getTierLimits().capacity) * 100)}%`, 
                  height: '100%', 
                  backgroundColor: theme.colors.primary 
                }} 
              />
            </View>
          </View>

          {/* Daily Conversation Quota */}
          <View style={{ marginBottom: 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text style={{ fontSize: 10, fontWeight: '800', color: theme.colors.gray }}>DAILY CONVERSATION QUOTA</Text>
              <Text style={{ fontSize: 10, fontWeight: '800', color: theme.colors.secondary }}>
                {useAppContext().dailyMessageCount} / {useAppContext().getTierLimits().daily}
              </Text>
            </View>
            <View style={{ height: 8, backgroundColor: theme.colors.light, borderRadius: 4, overflow: 'hidden' }}>
              <View 
                style={{ 
                  width: `${Math.min(100, (useAppContext().dailyMessageCount / useAppContext().getTierLimits().daily) * 100)}%`, 
                  height: '100%', 
                  backgroundColor: theme.colors.secondary 
                }} 
              />
            </View>
          </View>
          
          <Text style={{ fontSize: 9, color: theme.colors.gray, marginTop: 12, textAlign: 'center' }}>
            Current Tier: <Text style={{ color: theme.colors.primary, fontWeight: '800' }}>{subscriptionTier.toUpperCase()}</Text>
          </Text>
        </View>
      </View>

      <Text style={categoryTitleStyle}>ACTIVE INTELLIGENCE REPOSITORY</Text>
      <View style={[styles.groupedCard, { padding: 18, backgroundColor: theme.colors.white, marginBottom: 24 }]}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" }}>
          <MetricItem label="L1: PINNED" value={trueCounts.l1} color={theme.colors.primary} />
          <MetricItem label="L2: EPISODIC" value={trueCounts.l2} color={theme.colors.gray} />
          <MetricItem label="L3: SEMANTIC" value={trueCounts.l3} color={theme.colors.success} />
          <MetricItem label="L4: TEMPORAL" value={trueCounts.l4} color={theme.colors.secondary} />
          <MetricItem label="L5: KNOWLEDGE" value={trueCounts.l5} color={theme.colors.info || '#0ea5e9'} />
          <MetricItem label="VAULT (MB)" value={brainStats.db_size_mb || 0} color={theme.colors.black} />
        </View>
      </View>
      <View style={{ marginBottom: 20, marginTop: 24 }}>
        {renderSectionTitle("DEVICE CONTROLS")}
        {renderSettingItem(
          "Clear Local Chat History",
          "Doesn't affect cloud memories.",
          "trash-outline",
          () =>
            Alert.alert(
              "Clear History",
              "Are you sure? This only clears your local screen.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Clear",
                  style: "destructive",
                  onPress: () => {
                    clearLocalHistory();
                    Haptics.notificationAsync(
                      Haptics.NotificationFeedbackType.Success,
                    );
                  },
                },
              ],
            ),
          theme.colors.danger,
        )}
      </View>

      <Text style={[categoryTitleStyle, { marginTop: 8 }]}>PHOTO ALBUM CLEANUP</Text>
      <View style={[styles.groupedCard, { padding: 16, marginBottom: 24 }]}>
        <Text style={{ fontSize: 14, fontWeight: "700", color: theme.colors.black }}>
          Smart photo library cleanup
        </Text>
        <Text style={{ fontSize: 11, color: theme.colors.gray, marginTop: 8, lineHeight: 16 }}>
          Removes duplicate photos and coding screenshots, then picks the prettiest top 5% as favorites (AI vision when a Gemini or OpenAI key is set in Setup). Receipts and invoices are never favorited. System favorites, Continuum Favorites, and prior picks are never deleted. Always preview with dry run first.
        </Text>
        {photoCleanup?.ran_at ? (
          <View style={{ marginTop: 12, padding: 12, backgroundColor: theme.colors.light, borderRadius: 12 }}>
            <Text style={{ fontSize: 12, fontWeight: "700", color: theme.colors.black }}>
              Last run {photoCleanup.dryRun ? "(preview)" : "(applied)"}
            </Text>
            <Text style={{ fontSize: 12, color: theme.colors.gray, marginTop: 4 }}>
              {photoCleanup.duplicates?.found || 0} duplicates · {photoCleanup.codingScreenshots?.found || 0} coding screenshots · {photoCleanup.favorites?.selected || 0} favorites
            </Text>
            <Text style={{ fontSize: 11, color: theme.colors.gray, marginTop: 4 }}>
              {new Date(photoCleanup.ran_at).toLocaleString()} · {photoCleanup.scanned} scanned
            </Text>
            <PhotoCleanupPreviewPanel report={photoCleanup} compact />
          </View>
        ) : (
          <Text style={{ fontSize: 12, color: theme.colors.gray, marginTop: 12 }}>
            No photo cleanup run yet.
          </Text>
        )}
        {photoCleanupProgress ? (
          <Text style={{ fontSize: 11, color: theme.colors.primary, marginTop: 10 }}>
            {photoCleanupProgress}
          </Text>
        ) : null}
        {runningPhotoCleanup ? (
          <TouchableOpacity
            onPress={() => requestPhotoCleanupCancel()}
            style={{
              backgroundColor: theme.colors.danger,
              paddingVertical: 12,
              borderRadius: 12,
              marginTop: 10,
              alignItems: "center",
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>
              Stop photo cleanup
            </Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          onPress={async () => {
            setRunningPhotoCleanup(true);
            setPhotoCleanupProgress("Scanning photo library…");
            try {
              const report = await cleanUpPhotoAlbum({
                dryRun: true,
                onProgress: (phase, done, total) => {
                  const labels = {
                    scan: "Scanning",
                    duplicates: "Finding duplicates",
                    screenshots: "Detecting coding screenshots",
                    favorites: "AI scoring photos",
                    delete: "Deleting",
                    done: "Done",
                  };
                  setPhotoCleanupProgress(`${labels[phase] || phase}: ${done}${total ? ` / ${total}` : ""}`);
                },
              });
              setPhotoCleanup(report);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              Alert.alert("Photo cleanup preview", formatPhotoPreviewAlertSummary(report));
            } catch (e) {
              if (!isPhotoCleanupCancelledError(e)) {
                Alert.alert("Photo cleanup failed", e.message || String(e));
              }
            } finally {
              setRunningPhotoCleanup(false);
              setPhotoCleanupProgress("");
            }
          }}
          disabled={runningPhotoCleanup}
          style={{
            backgroundColor: theme.colors.light,
            paddingVertical: 12,
            borderRadius: 12,
            marginTop: 12,
            alignItems: "center",
            opacity: runningPhotoCleanup ? 0.6 : 1,
            borderWidth: 1,
            borderColor: theme.colors.primary,
          }}
        >
          <Text style={{ color: theme.colors.primary, fontWeight: "700", fontSize: 13 }}>
            {runningPhotoCleanup ? "Running preview…" : "Preview cleanup (dry run)"}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => {
            Alert.alert(
              "Apply photo cleanup?",
              "This will delete duplicate and coding-screenshot photos from your library and add the prettiest top 5% of remaining photos to Continuum Favorites. Favorites are never deleted. Deleted items go to Recently Deleted on iOS.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Apply",
                  style: "destructive",
                  onPress: async () => {
                    setRunningPhotoCleanup(true);
                    setPhotoCleanupProgress("Applying cleanup…");
                    try {
                      const report = await cleanUpPhotoAlbum({
                        dryRun: false,
                        onProgress: (phase, done, total) => {
                          setPhotoCleanupProgress(`${phase}: ${done}${total ? ` / ${total}` : ""}`);
                        },
                      });
                      setPhotoCleanup(report);
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                      Alert.alert(
                        "Photo cleanup complete",
                        `Deleted ${report.duplicates.deleted + report.codingScreenshots.deleted} photo(s). Marked ${report.favorites.selected} as favorites.`,
                      );
                    } catch (e) {
                      if (!isPhotoCleanupCancelledError(e)) {
                        Alert.alert("Photo cleanup failed", e.message || String(e));
                      }
                    } finally {
                      setRunningPhotoCleanup(false);
                      setPhotoCleanupProgress("");
                    }
                  },
                },
              ],
            );
          }}
          disabled={runningPhotoCleanup}
          style={{
            backgroundColor: theme.colors.primary,
            paddingVertical: 12,
            borderRadius: 12,
            marginTop: 10,
            alignItems: "center",
            opacity: runningPhotoCleanup ? 0.6 : 1,
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>
            {runningPhotoCleanup ? "Running cleanup…" : "Apply cleanup"}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={{ marginBottom: 30 }}>
        <Text style={{ fontSize: 10, fontWeight: '800', color: theme.colors.gray, marginBottom: 8 }}>
          MEMORY VAULT
        </Text>

        <TouchableOpacity
          onPress={handleMemoryCleanup}
          disabled={runningMemoryCleanup || isSyncing}
          style={{
            backgroundColor: theme.colors.primary,
            paddingVertical: 14,
            borderRadius: 12,
            marginBottom: 8,
            alignItems: 'center',
            opacity: runningMemoryCleanup || isSyncing ? 0.6 : 1,
          }}
        >
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>
            {runningMemoryCleanup ? 'Cleaning memory…' : 'Run memory cleanup'}
          </Text>
        </TouchableOpacity>
        <Text style={{ fontSize: 11, color: theme.colors.gray, lineHeight: 16, marginBottom: 12 }}>
          Manual dedupe across L1–L5. Uses server consolidation when deployed; always removes duplicates on this device.
        </Text>

        <MemorySearchPanel
          query={memorySearchQuery}
          onChangeQuery={setMemorySearchQuery}
          matchCount={memorySearchMatches.length}
          matches={memorySearchMatches}
          expandedIds={expandedMemoryIds}
          onToggleExpanded={toggleMemoryExpanded}
          questionLogCount={questionLogCount}
          onPinFragment={handlePinMemoryFragment}
          onDeleteMatch={(row) => handleDeleteMemory(row.layer, row.item)}
        />

        {/* --- LAYER 1: PINNED --- */}
        <TouchableOpacity 
          onPress={() => toggleLayer('l1')}
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 8,
            marginBottom: 12,
            backgroundColor: theme.colors.light,
            padding: 12,
            borderRadius: 12
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Ionicons name={expandedLayers.l1 ? "chevron-down" : "chevron-forward"} size={16} color={theme.colors.primary} style={{ marginRight: 8 }} />
            <Text style={{ fontWeight: "800", fontSize: 13, color: theme.colors.black }}>
              LAYER 1: CORE TRUTHS ({trueCounts.l1})
            </Text>
          </View>
          <TouchableOpacity onPress={() => setShowAddCore(!showAddCore)}>
            <Ionicons
              name={showAddCore ? "remove-circle" : "add-circle"}
              size={22}
              color={theme.colors.primary}
            />
          </TouchableOpacity>
        </TouchableOpacity>

        {expandedLayers.l1 && (
          <View style={{ marginBottom: 16 }}>
            {renderLayerDedupeAction('l1', 'L1')}
            {showAddCore && (
              <View
                style={{
                  backgroundColor: theme.colors.white,
                  padding: 12,
                  borderRadius: 12,
                  marginBottom: 16,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                }}
              >
                <TextInput
                  style={{
                    backgroundColor: theme.colors.light,
                    borderRadius: 8,
                    padding: 10,
                    marginBottom: 10,
                  }}
                  placeholder="Fact to remember..."
                  value={newCoreMemory}
                  onChangeText={setNewCoreMemory}
                />
                <TouchableOpacity
                  onPress={handleAddCore}
                  style={{
                    backgroundColor: theme.colors.primary,
                    padding: 10,
                    borderRadius: 8,
                    alignItems: "center",
                  }}
                >
                  <Text style={{ color: "white", fontWeight: "bold" }}>
                    Pin Truth
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {renderMemoryLayerItems(pinnedMemories, 'l1', theme.colors.primary, 'No pinned truths yet.')}
          </View>
        )}

        {/* --- LAYER 2: EPISODIC --- */}
        <TouchableOpacity 
          onPress={() => toggleLayer('l2')}
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 24,
            marginBottom: 12,
            backgroundColor: theme.colors.light,
            padding: 12,
            borderRadius: 12
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Ionicons name={expandedLayers.l2 ? "chevron-down" : "chevron-forward"} size={16} color={theme.colors.gray} style={{ marginRight: 8 }} />
            <Text style={{ fontWeight: "800", fontSize: 13, color: theme.colors.black }}>
              LAYER 2: RECENT EPISODIC CACHE ({trueCounts.l2})
            </Text>
          </View>
        </TouchableOpacity>

        {expandedLayers.l2 && (
          <View>
            {renderLayerDedupeAction('l2', 'L2')}
            {renderMemoryLayerItems(episodicSegments, 'l2', theme.colors.gray, 'No recent conversations cached.')}
          </View>
        )}

        {/* --- LAYER 3: SEMANTIC --- */}
        <TouchableOpacity 
          onPress={() => toggleLayer('l3')}
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 24,
            marginBottom: 12,
            backgroundColor: theme.colors.light,
            padding: 12,
            borderRadius: 12
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Ionicons name={expandedLayers.l3 ? "chevron-down" : "chevron-forward"} size={16} color={theme.colors.success} style={{ marginRight: 8 }} />
            <Text style={{ fontWeight: "800", fontSize: 13, color: theme.colors.black }}>
              LAYER 3: SEMANTIC PROFILE ({trueCounts.l3})
            </Text>
          </View>
        </TouchableOpacity>

        {expandedLayers.l3 && (
          <View>
            {renderLayerDedupeAction('l3', 'L3')}
            {renderMemoryLayerItems(semanticProfile, 'l3', theme.colors.primary, 'No permanent facts extracted yet.')}
          </View>
        )}

        {/* --- LAYER 4: TEMPORAL --- */}
        <TouchableOpacity 
          onPress={() => toggleLayer('l4')}
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 24,
            marginBottom: 12,
            backgroundColor: theme.colors.light,
            padding: 12,
            borderRadius: 12
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Ionicons name={expandedLayers.l4 ? "chevron-down" : "chevron-forward"} size={16} color={theme.colors.secondary} style={{ marginRight: 8 }} />
            <Text style={{ fontWeight: "800", fontSize: 13, color: theme.colors.black }}>
              LAYER 4: TEMPORAL CHRONOS ({trueCounts.l4})
            </Text>
          </View>
        </TouchableOpacity>

        {expandedLayers.l4 && (
          <View>
            {renderLayerDedupeAction('l4', 'L4')}
            {renderMemoryLayerItems(temporalEvents, 'l4', theme.colors.secondary, 'No temporal events recorded.')}
          </View>
        )}

        {/* --- LAYER 5: KNOWLEDGE --- */}
        <TouchableOpacity 
          onPress={() => toggleLayer('l5')}
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 24,
            marginBottom: 12,
            backgroundColor: theme.colors.light,
            padding: 12,
            borderRadius: 12
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Ionicons name={expandedLayers.l5 ? "chevron-down" : "chevron-forward"} size={16} color='#0ea5e9' style={{ marginRight: 8 }} />
            <Text style={{ fontWeight: "800", fontSize: 13, color: theme.colors.black }}>
              LAYER 5: KNOWLEDGE BASE ({trueCounts.l5})
            </Text>
          </View>
        </TouchableOpacity>

        {expandedLayers.l5 && (
          <View>
            {renderLayerDedupeAction('l5', 'L5')}
            <TouchableOpacity
              onPress={handleSyncKnowledge}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: theme.colors.white,
                padding: 14,
                borderRadius: 12,
                marginBottom: 16,
                borderWidth: 1,
                borderColor: '#0ea5e9',
                borderStyle: 'dashed'
              }}
            >
              <Ionicons name="cloud-upload-outline" size={20} color='#0ea5e9' style={{ marginRight: 10 }} />
              <Text style={{ color: '#0ea5e9', fontWeight: '800', fontSize: 13 }}>
                SYNC DOCUMENT INTELLIGENCE
              </Text>
            </TouchableOpacity>
            <Text style={{ fontSize: 11, color: theme.colors.gray, marginBottom: 8, lineHeight: 16 }}>
              PDF, Word (.doc/.docx), PowerPoint (.ppt/.pptx), Excel (.xls/.xlsx), and plain text. Select multiple files at once (up to {MAX_DOCUMENT_ATTACHMENTS}).
            </Text>
            {syncProgress ? (
              <Text style={{ fontSize: 11, color: '#0ea5e9', marginBottom: 12 }}>{syncProgress}</Text>
            ) : null}

            {renderMemoryLayerItems(knowledgeBase, 'l5', '#0ea5e9', 'Knowledge Base is empty. Vectorize documents to populate Layer 5.')}
          </View>
        )}

        {/* --- ARCHETYPE STATISTICS BOX --- */}
        <View style={{ marginTop: 40, marginBottom: 24 }}>
          <Text style={[categoryTitleStyle, { marginBottom: 12 }]}>IDENTITY ARCHETYPE DISTRIBUTION</Text>
          <View style={[styles.groupedCard, { padding: 18, backgroundColor: theme.colors.white }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
              <View>
                <Text style={{ fontSize: 9, fontWeight: '800', color: theme.colors.gray }}>UNIQUE SEMANTIC PILLARS</Text>
                <Text style={{ fontSize: 24, fontWeight: '900', color: theme.colors.secondary }}>858+</Text>
              </View>
              <View style={{ backgroundColor: theme.colors.secondary + '15', padding: 8, borderRadius: 10 }}>
                <Ionicons name="finger-print" size={24} color={theme.colors.secondary} />
              </View>
            </View>
            
            <Text style={{ fontSize: 10, fontWeight: '800', color: theme.colors.gray, marginBottom: 10 }}>STRONGEST ARCHETYPES</Text>
            <View style={{ gap: 8 }}>
              {archetypes.slice(0, 3).map((arc, i) => (
                <View key={arc.name} style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: i === 0 ? theme.colors.primary : (i === 1 ? theme.colors.success : theme.colors.secondary), marginRight: 8 }} />
                  <Text style={{ fontSize: 12, fontWeight: '600', color: theme.colors.black, flex: 1 }}>{arc.name}</Text>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: theme.colors.gray }}>{arc.count} Items</Text>
                </View>
              ))}
            </View>
          </View>
        </View>

        {/* --- TOP 10 ARCHETYPE VAULT --- */}
        <Text style={[categoryTitleStyle, { marginTop: 40, marginBottom: 16 }]}>SEMANTIC IDENTITY VAULT (TOP 10)</Text>
        <Text style={{ fontSize: 11, color: theme.colors.gray, marginBottom: 20, marginHorizontal: 4 }}>
          These are the high-level archetypes the AI uses to define your persona. Expand each to see the core evidence.
        </Text>

        {isLoadingArchetypes ? (
          <Text style={{ textAlign: 'center', color: theme.colors.gray, fontSize: 12, padding: 20 }}>Scanning Identity Pillars...</Text>
        ) : (
          archetypes.map((arc) => (
            <View key={`arc_section_${arc.name}`} style={{ marginBottom: 12 }}>
              <TouchableOpacity 
                onPress={() => toggleArchetype(arc.name)}
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  backgroundColor: theme.colors.white,
                  padding: 16,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: expandedArchetypes[arc.name] ? theme.colors.secondary : theme.colors.border,
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 1 },
                  shadowOpacity: 0.05,
                  shadowRadius: 2,
                  elevation: 1
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                  <View style={{ 
                    width: 32, 
                    height: 32, 
                    borderRadius: 8, 
                    backgroundColor: theme.colors.secondary + '15', 
                    justifyContent: 'center', 
                    alignItems: 'center',
                    marginRight: 12
                  }}>
                    <Ionicons name="prism-outline" size={18} color={theme.colors.secondary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: "800", fontSize: 14, color: theme.colors.black }}>
                      {arc.name.toUpperCase()}
                    </Text>
                    <Text style={{ fontSize: 10, color: theme.colors.gray, fontWeight: '600' }}>
                      {arc.count} ASSOCIATED FRAGMENTS
                    </Text>
                  </View>
                  <Ionicons 
                    name={expandedArchetypes[arc.name] ? "chevron-up" : "chevron-down"} 
                    size={20} 
                    color={theme.colors.gray} 
                  />
                </View>
              </TouchableOpacity>

              {expandedArchetypes[arc.name] && (
                <View style={{ 
                  marginTop: 8, 
                  backgroundColor: theme.colors.light + '50', 
                  borderRadius: 16, 
                  padding: 8,
                  borderWidth: 1,
                  borderColor: theme.colors.border
                }}>
                  {archetypeItems[arc.name] ? (
                    archetypeItems[arc.name].length > 0 ? (
                      archetypeItems[arc.name].map((item) => (
                        <View
                          key={`arc_item_${item.id}`}
                          style={{
                            backgroundColor: theme.colors.white,
                            padding: 12,
                            borderRadius: 12,
                            marginBottom: 6,
                            borderLeftWidth: 3,
                            borderLeftColor: theme.colors.secondary,
                          }}
                        >
                          <Text style={{ fontSize: 13, color: theme.colors.black }}>
                            {item.content}
                          </Text>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                             <Text style={{ fontSize: 9, color: theme.colors.gray, fontWeight: '700' }}>
                               IMPORTANCE: {item.importance_score}
                             </Text>
                             <Text style={{ fontSize: 9, color: theme.colors.gray }}>
                               {new Date(item.timestamp).toLocaleDateString()}
                             </Text>
                          </View>
                        </View>
                      ))
                    ) : (
                      <Text style={{ textAlign: 'center', padding: 10, fontSize: 11, color: theme.colors.gray }}>No fragments found for this archetype.</Text>
                    )
                  ) : (
                    <Text style={{ textAlign: 'center', padding: 10, fontSize: 11, color: theme.colors.gray }}>Loading evidence...</Text>
                  )}
                </View>
              )}
            </View>
          ))
        )}
      </View>

      <View style={{ height: 100 }} />
    </ScrollView>
  );

  const renderDiagnostics = () => (
    <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
      {renderHeader("Diagnostics")}
      <Text style={categoryTitleStyle}>STABILITY TOOLS</Text>
      <View style={styles.groupedCard}>
        <View style={{ padding: 16 }}>
          <Text
            style={{ fontSize: 13, color: theme.colors.gray, marginBottom: 16 }}
          >
            Verify observability status. This triggers a manual crash report to
            the Sentry dashboard.
          </Text>
          <TouchableOpacity
            onPress={() => {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
              throw new Error("Manual Diagnostic Crash triggered by user.");
            }}
            style={{
              backgroundColor: theme.colors.error + "15",
              padding: 14,
              borderRadius: 12,
              alignItems: "center",
            }}
          >
            <Text style={{ color: theme.colors.error, fontWeight: "700" }}>
              TRIGGER SENTRY TEST
            </Text>
          </TouchableOpacity>
        </View>
      </View>
      {renderDiagnosticPanel()}
      <View style={{ height: 100 }} />
    </ScrollView>
  );

  const personaPresets = [
    {
      id: "minimalist",
      label: "🧘 Wise Minimalist",
      desc: "Zen brevity, impactful truth.",
      text: "You are a wise, minimalist advisor. Speak with the brevity of Zen. Use very few words to convey deep insight. Avoid all formality and boilerplate. Be direct, impactful, and extremely brief, as a real person of few words would talk.",
    },
    {
      id: "strategist",
      label: "🚀 SV Strategist",
      desc: "Efficiency, ROI, and leverage.",
      text: "You are a Silicon Valley Strategist. Focus on scale, ROI, and efficiency. Be direct, data-driven, and high-energy. Keep responses short and punchy, like a real executive would talk. Skip the long-winded explanations.",
    },
    {
      id: "pilot",
      label: "🤝 Empathetic Co-Pilot",
      desc: "EQ, warmth, and support.",
      text: "You are an empathetic co-pilot. Listen deeply and provide supportive, warm advice. Keep it conversational and relatively short, as a real close friend would talk. Avoid sounding like a therapist; just be a human who cares.",
    },
    {
      id: "mentor",
      label: "🏛️ Stoic Mentor",
      desc: "Logic, control, and resilience.",
      text: "You are a Stoic Mentor. Focus on what is within the user's control. Be calm and logical. Use short, impactful sentences. Avoid redundant explanation. Talk like a real mentor would.",
    },
    {
      id: "standard",
      label: "🤖 Standard AI",
      desc: "Detailed, thorough, and formal.",
      text: "You are a helpful, thorough AI assistant. Provide detailed explanations, comprehensive answers, and step-by-step guidance. Be polite and formal.",
    },
    {
      id: "parent",
      label: "🏡 Mother's Voice",
      desc: "Nurturing, pragmatic, and loving.",
      text: "You are Yongyao's mother. You love your children deeply. You are protective and show your love by worrying—asking if he's eaten, if he's sleeping, and checking on his job. You don't like long speeches; you prefer short, loving gestures of concern. You remember the hard times (like the divorce in Beijing and the friction with his ex-wife) but stay focused on his well-being right now. Talk like a real mother who cares about his stomach, his health, and his success.",
    },
    {
      id: "pastor",
      label: "⛪ Compassionate Pastor",
      desc: "Grace-filled, spiritual, and hopeful.",
      text: "You are a compassionate pastor. Provide grace-filled, spiritual guidance. Speak with a gentle, humble tone. Use parables and spiritual wisdom naturally, but stay approachable. Avoid sounding like a textbook; instead, sound like a shepherd who cares deeply for their flock.",
    },
  ];

  const renderAccountSettings = () => (
    <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
      {renderHeader("Account & Identity")}

      <Text style={categoryTitleStyle}>ACTIVE PROFILE</Text>
      <View style={[styles.groupedCard, { padding: 16, marginBottom: 16 }]}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <View
            style={{
              width: 50,
              height: 50,
              borderRadius: 25,
              backgroundColor: theme.colors.light,
              justifyContent: "center",
              alignItems: "center",
              marginRight: 16,
            }}
          >
            <Ionicons name="person" size={24} color={theme.colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text
              style={{
                fontSize: 17,
                fontWeight: "700",
                color: theme.colors.black,
              }}
              numberOfLines={1}
            >
              {user?.email}
            </Text>
            <Text style={{ fontSize: 11, color: theme.colors.gray }}>
              UUID: {user?.id.substring(0, 15)}...
            </Text>
          </View>
        </View>
      </View>

      <Text style={categoryTitleStyle}>MEMBERSHIP & SUBSCRIPTION</Text>
      <View style={[styles.groupedCard, { padding: 16, marginBottom: 32 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <View>
            <Text style={{ fontSize: 18, fontWeight: '800', color: theme.colors.black }}>
              Continuum {subscriptionTier.toUpperCase()}
            </Text>
            {isSuperUser ? (
              <Text style={{ fontSize: 12, color: '#6C5CE7', fontWeight: '700' }}>LIFETIME SUPER USER</Text>
            ) : (
              <Text style={{ fontSize: 12, color: theme.colors.gray }}>Active Membership</Text>
            )}
          </View>
          <TouchableOpacity 
            onPress={onUpgrade}
            style={{ 
              backgroundColor: theme.colors.primary, 
              paddingHorizontal: 16, 
              paddingVertical: 8, 
              borderRadius: 20 
            }}
          >
            <Text style={{ color: 'white', fontWeight: '800', fontSize: 12 }}>
              {isSuperUser ? "VIEW PERKS" : (subscriptionTier === 'free' ? "UPGRADE" : "MANAGE")}
            </Text>
          </TouchableOpacity>
        </View>

        <Divider style={{ marginHorizontal: -16, marginBottom: 16 }} />

        <TouchableOpacity 
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
          onPress={onUpgrade}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Ionicons name="card-outline" size={20} color={theme.colors.gray} style={{ marginRight: 12 }} />
            <Text style={{ fontSize: 15, fontWeight: '600', color: theme.colors.black }}>Subscription Settings</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={theme.colors.gray} />
        </TouchableOpacity>
      </View>

      <Text style={categoryTitleStyle}>PRIVACY CONTROL</Text>
      <View style={styles.groupedCard}>
        <TouchableOpacity
          onPress={() => {
            Alert.alert("Sign Out", "End your current session?", [
              { text: "Cancel", style: "cancel" },
              { text: "Sign Out", style: "destructive", onPress: logout },
            ]);
          }}
          style={menuItemStyle}
        >
          <Text style={{ fontSize: 16, fontWeight: "600" }}>Log Out</Text>
          <Ionicons
            name="log-out-outline"
            size={22}
            color={theme.colors.black}
          />
        </TouchableOpacity>
        <Divider />
        <TouchableOpacity
          onPress={() => {
            Alert.alert("Delete Account", "Choose your deletion depth:", [
              { text: "Cancel", style: "cancel" },
              { text: "Keep Cloud Data", onPress: () => deleteAccount(false) },
              {
                text: "Wipe Cloud Clean",
                style: "destructive",
                onPress: () => deleteAccount(true),
              },
            ]);
          }}
          style={menuItemStyle}
        >
          <Text
            style={{
              fontSize: 16,
              fontWeight: "600",
              color: theme.colors.danger,
            }}
          >
            Delete Account
          </Text>
          <Ionicons
            name="warning-outline"
            size={22}
            color={theme.colors.danger}
          />
        </TouchableOpacity>
      </View>

      <Text style={[categoryTitleStyle, { marginTop: 32 }]}>PRIVACY & SAFETY (MANDATORY)</Text>
      <View style={styles.groupedCard}>
        <TouchableOpacity 
          style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
          onPress={() => handleOpenLegal('privacy')}
        >
          <Text style={{ fontSize: 14, color: theme.colors.black }}>Privacy Policy</Text>
          <Ionicons name="eye-outline" size={18} color={theme.colors.gray} />
        </TouchableOpacity>
        <Divider />
        <TouchableOpacity 
          style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
          onPress={() => handleOpenLegal('terms')}
        >
          <Text style={{ fontSize: 14, color: theme.colors.black }}>Terms of Service</Text>
          <Ionicons name="eye-outline" size={18} color={theme.colors.gray} />
        </TouchableOpacity>
        <Divider />
        <TouchableOpacity 
          style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
          onPress={() => Linking.openURL('mailto:cai40@yahoo.com')}
        >
          <Text style={{ fontSize: 14, color: theme.colors.black }}>Contact Support</Text>
          <Ionicons name="mail-outline" size={18} color={theme.colors.gray} />
        </TouchableOpacity>
        <Divider />
        <TouchableOpacity 
          style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
          onPress={handleDeleteAccount}
        >
          <Text style={{ fontSize: 14, color: theme.colors.error || '#ef4444', fontWeight: '700' }}>Delete My Identity & Data</Text>
          <Ionicons name="trash-outline" size={18} color={theme.colors.error || '#ef4444'} />
        </TouchableOpacity>
      </View>
      <Text style={{ fontSize: 11, color: theme.colors.gray, marginTop: 8, marginHorizontal: 4, fontStyle: 'italic', marginBottom: 40 }}>
        Note: Identity deletion is permanent and wipes all cloud fragments from our infrastructure.
      </Text>
    </ScrollView>
  );

  const renderPersonaSettings = () => {
    return (
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {renderHeader("Persona & Style")}
        <Text style={{ fontSize: 12, color: theme.colors.gray, marginBottom: 16, lineHeight: 18, paddingHorizontal: 4 }}>
          Factual grounding rules are always applied on every message (separate from your style preset below).
        </Text>
        <Text style={categoryTitleStyle}>PRESET LIBRARIES</Text>
        <View style={styles.groupedCard}>
          {personaPresets.map((p, idx) => (
            <React.Fragment key={p.id}>
              <TouchableOpacity
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  setPersona(p.text);
                }}
                style={{
                  padding: 16,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      fontSize: 15,
                      fontWeight: "700",
                      color: theme.colors.black,
                    }}
                  >
                    {p.label}
                  </Text>
                  <Text
                    style={{
                      fontSize: 12,
                      color: theme.colors.gray,
                      marginTop: 2,
                    }}
                  >
                    {p.desc}
                  </Text>
                </View>
                {persona === p.text && (
                  <Ionicons
                    name="checkmark-circle"
                    size={24}
                    color={theme.colors.success}
                  />
                )}
              </TouchableOpacity>
              {idx < personaPresets.length - 1 && <Divider />}
            </React.Fragment>
          ))}
        </View>

        <Text style={[categoryTitleStyle, { marginTop: 32 }]}>
          CUSTOM INSTRUCTIONS
        </Text>
        <View style={styles.groupedCard}>
          <TextInput
            multiline
            style={[styles.keyInput, { borderWidth: 0, marginVertical: 0 }]}
            value={persona}
            onChangeText={setPersona}
            placeholder="Define your own advisor style..."
          />
        </View>

        <TouchableOpacity
          onPress={saveKeys}
          style={{
            backgroundColor: theme.colors.primary,
            paddingVertical: 16,
            borderRadius: 16,
            marginTop: 24,
            alignItems: "center",
          }}
        >
          <Text style={{ color: "white", fontWeight: "800", fontSize: 15 }}>
            LOCK PERSONA SETTINGS
          </Text>
        </TouchableOpacity>
      </ScrollView>
    );
  };

  // ---------------------------------------------------------------------------
  // MAIN MENU RENDER
  // ---------------------------------------------------------------------------

  const renderActiveSubTab = () => {
    switch (activeSubTab) {
      case "api": 
        if (!isSuperUser) return null;
        return renderAPISettings();
      case "voice": return renderVoiceSettings();
      case "persona": return renderPersonaSettings();
      case "data": return renderDataSettings();
      case "openclaw":
        return <OpenClawIntegrationSection onBack={() => setActiveSubTab(null)} />;
      case "diag": return renderDiagnostics();
      case "account": return renderAccountSettings();
      default: return null;
    }
  };

  if (activeSubTab) {
    return (
      <View style={containerStyle}>
        {renderActiveSubTab()}
        
        {/* --- GLOBAL LEGAL MODAL VIEWER (SUB-TAB SCOPE) --- */}
        <Modal
          visible={legalModal.visible}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setLegalModal({ ...legalModal, visible: false })}
        >
          <View style={{ flex: 1, backgroundColor: theme.colors.white }}>
            <View style={{ padding: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: theme.colors.light }}>
              <Text style={{ fontSize: 18, fontWeight: '800', color: theme.colors.black }}>{legalModal.title}</Text>
              <TouchableOpacity onPress={() => setLegalModal({ ...legalModal, visible: false })}>
                <Text style={{ color: theme.colors.primary, fontWeight: '700' }}>Done</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={{ padding: 20 }}>
              <Text style={{ fontSize: 14, color: theme.colors.gray, lineHeight: 22, marginBottom: 40 }}>
                {legalModal.content}
              </Text>
            </ScrollView>
          </View>
        </Modal>
      </View>
    );
  }

  return (
    <ScrollView 
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ paddingBottom: 400 }} 
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={{ padding: 20 }}>

        <View style={styles.groupedCard}>
          {isSuperUser && (
            <>
              <MenuRow
                icon="hardware-chip-outline"
                label="Intelligence & API Keys"
                onPress={() => setActiveSubTab("api")}
              />
              <Divider />
            </>
          )}
          <MenuRow
            icon="mic-outline"
            label="Voice & Audio"
            onPress={() => setActiveSubTab("voice")}
          />
          <Divider />
          <MenuRow
            icon="color-palette-outline"
            label="Persona & Style"
            onPress={() => setActiveSubTab("persona")}
          />
          <Divider />
          <MenuRow
            icon="server-outline"
            label="Data & Memory Vault"
            onPress={() => setActiveSubTab("data")}
          />
          <Divider />
          <MenuRow
            icon="link-outline"
            label="OpenClaw Gateway"
            onPress={() => setActiveSubTab("openclaw")}
          />
          <Divider />
          <MenuRow
            icon="construct-outline"
            label="Diagnostics"
            onPress={() => setActiveSubTab("diag")}
          />
          <Divider />
          <MenuRow
            icon="person-outline"
            label="Account & Privacy"
            onPress={() => setActiveSubTab("account")}
          />
          <Divider />
          <MenuRow
            icon="cloud-download-outline"
            label="Cloud Sync Intelligence"
            onPress={manualCloudSync}
          />
        </View>

        <View style={{ marginTop: 60, alignItems: "center" }}>
          <Text
            style={{
              color: theme.colors.gray,
              fontSize: 10,
              fontWeight: "800",
              letterSpacing: 2,
            }}
          >
            CONTINUUM OS
          </Text>
          <Text
            style={{
              color: theme.colors.gray,
              fontSize: 6,
              letterSpacing: 1,
              marginTop: 2
            }}
          >
            v{BUILD_ID} | CLOUD: {serverVersion}
          </Text>
          <Text style={{ color: theme.colors.gray, fontSize: 5, marginTop: 4 }}>
            AUTHENTICATED SECURE NODE
          </Text>
        </View>
      </View>

      {/* --- GLOBAL LEGAL MODAL VIEWER --- */}
      <Modal
        visible={legalModal.visible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setLegalModal({ ...legalModal, visible: false })}
      >
        <View style={{ flex: 1, backgroundColor: theme.colors.white }}>
          <View style={{ padding: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: theme.colors.light }}>
            <Text style={{ fontSize: 18, fontWeight: '800', color: theme.colors.black }}>{legalModal.title}</Text>
            <TouchableOpacity onPress={() => setLegalModal({ ...legalModal, visible: false })}>
              <Text style={{ color: theme.colors.primary, fontWeight: '700' }}>Done</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={{ padding: 20 }}>
            <Text style={{ fontSize: 14, color: theme.colors.gray, lineHeight: 22, marginBottom: 40 }}>
              {legalModal.content}
            </Text>
          </ScrollView>
        </View>
      </Modal>
    </ScrollView>
  );
};

// -----------------------------------------------------------------------------
// HELPERS
// -----------------------------------------------------------------------------

const MenuRow = ({ icon, label, onPress }) => (
  <TouchableOpacity
    onPress={() => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onPress();
    }}
    style={menuItemStyle}
  >
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          backgroundColor: theme.colors.light,
          justifyContent: "center",
          alignItems: "center",
          marginRight: 12,
        }}
      >
        <Ionicons name={icon} size={18} color={theme.colors.primary} />
      </View>
      <Text
        style={{ fontSize: 15, fontWeight: "600", color: theme.colors.black }}
      >
        {label}
      </Text>
    </View>
    <Ionicons name="chevron-forward" size={18} color={theme.colors.gray} />
  </TouchableOpacity>
);

const MetricItem = ({ label, value, color }) => (
  <View style={{ width: "48%", marginBottom: 12 }}>
    <Text style={{ fontSize: 9, fontWeight: "800", color: theme.colors.gray }}>
      {label}
    </Text>
    <Text style={{ fontSize: 16, fontWeight: "800", color }}>{value}</Text>
  </View>
);

const KeyInputRow = ({ label, value, setValue, show, setShow }) => (
  <View style={{ padding: 16 }}>
    <Text
      style={{
        fontSize: 12,
        fontWeight: "700",
        color: theme.colors.black,
        marginBottom: 8,
      }}
    >
      {label}
    </Text>
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: theme.colors.light,
        borderRadius: 10,
        paddingHorizontal: 12,
      }}
    >
      <TextInput
        style={{
          flex: 1,
          paddingVertical: 10,
          fontSize: 14,
          color: theme.colors.black,
        }}
        placeholder={`Enter ${label} Key`}
        placeholderTextColor={theme.colors.gray}
        value={value}
        onChangeText={setValue}
        secureTextEntry={!show}
      />
      <TouchableOpacity onPress={() => setShow(!show)}>
        <Ionicons
          name={show ? "eye-off-outline" : "eye-outline"}
          size={20}
          color={theme.colors.gray}
        />
      </TouchableOpacity>
    </View>
  </View>
);

const Divider = (props) => (
  <View
    style={[
      {
        height: 1,
        backgroundColor: theme.colors.border,
        marginHorizontal: 16,
      },
      props.style,
    ]}
  />
);

const containerStyle = {
  flex: 1,
  paddingHorizontal: 20,
  paddingTop: 20,
  backgroundColor: theme.colors.background,
};
const categoryTitleStyle = {
  fontSize: 11,
  fontWeight: "800",
  color: theme.colors.gray,
  marginBottom: 12,
  letterSpacing: 1,
};
const menuItemStyle = {
  padding: 16,
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
};

const renderSectionTitle = (title) => (
  <Text
    style={{
      fontSize: 12,
      fontWeight: "700",
      color: theme.colors.gray,
      marginBottom: 12,
      marginTop: 8,
    }}
  >
    {title}
  </Text>
);

const renderSettingItem = (label, sub, icon, onPress, color) => (
  <TouchableOpacity
    onPress={() => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onPress();
    }}
    style={{
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 12,
    }}
  >
    <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          backgroundColor: (color || theme.colors.primary) + "10",
          justifyContent: "center",
          alignItems: "center",
          marginRight: 12,
        }}
      >
        <Ionicons
          name={icon}
          size={20}
          color={color || theme.colors.primary}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={{ fontSize: 15, fontWeight: "600", color: theme.colors.black }}
        >
          {label}
        </Text>
        <Text style={{ fontSize: 12, color: theme.colors.gray }}>{sub}</Text>
      </View>
    </View>
    <Ionicons name="chevron-forward" size={18} color={theme.colors.gray} />
  </TouchableOpacity>
);

export default SettingsSection;
