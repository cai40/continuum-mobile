import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, Platform, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAppContext } from '../context/AppContext';
import { fetchMemories, pulseFetch } from '../services/apiService';
import { API_URL } from '../constants/Config';
import { styles, theme } from '../styles/theme';
import { formatFullDate, getImportanceColor } from '../utils/helpers';

const SettingsSection = () => {
  const {
    provider, setProvider,
    groqKey, setGroqKey,
    geminiKey, setGeminiKey,
    openaiKey, setOpenaiKey,
    openrouterKey, setOpenrouterKey,
    selectedVoice, setSelectedVoice,
    saveKeys, logout, clearLocalHistory, deleteAccount,
    user, session,
    memories, setMemories,
    pinnedMemories, setPinnedMemories,
    brainStats, setBrainStats,
    setCloudWakingUp,
    persona, setPersona
  } = useAppContext();

  // Navigation State
  const [activeSubTab, setActiveSubTab] = useState(null); // null, 'api', 'voice', 'persona', 'data', 'diag', 'account'
  
  // Visibility States
  const [showGroq, setShowGroq] = useState(false);
  const [showGemini, setShowGemini] = useState(false);
  const [showOpenAI, setShowOpenAI] = useState(false);
  const [showOpenRouter, setShowOpenRouter] = useState(false);

  // Memory Sub-Tab States
  const [isSyncing, setIsSyncing] = useState(false);
  const [newCoreMemory, setNewCoreMemory] = useState('');
  const [showAddCore, setShowAddCore] = useState(false);

  const voices = [
    { id: 'en-US-AvaNeural', name: 'Ava (US Female)', desc: 'Clear & Contemporary' },
    { id: 'en-US-AndrewNeural', name: 'Andrew (US Male)', desc: 'Friendly & Warm' },
    { id: 'en-US-EmmaNeural', name: 'Emma (US Female)', desc: 'Soft & Gentle' },
    { id: 'en-US-BrianNeural', name: 'Brian (US Male)', desc: 'Professional' },
    { id: 'en-GB-SoniaNeural', name: 'Sonia (UK Female)', desc: 'Sophisticated British' },
    { id: 'en-GB-RyanNeural', name: 'Ryan (UK Male)', desc: 'Natural British' },
  ];

  const onRefreshMemories = async () => {
    setIsSyncing(true);
    try {
      const { semData, pinData, analytics } = await fetchMemories(setCloudWakingUp, session?.access_token);
      setMemories(semData);
      setPinnedMemories(pinData);
      setBrainStats(analytics);
    } catch (e) {
      console.error("Memory refresh failed:", e);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleAddCore = async () => {
    if (!newCoreMemory.trim()) return;
    try {
      await pulseFetch(`${API_URL}/memories/pin`, {
        method: 'POST',
        body: JSON.stringify({ content: newCoreMemory.trim(), label: 'Manual' })
      }, 3, setCloudWakingUp, session?.access_token);
      setNewCoreMemory('');
      setShowAddCore(false);
      onRefreshMemories();
    } catch (e) {
      Alert.alert('Error', 'Could not save core memory.');
    }
  };

  // ---------------------------------------------------------------------------
  // SUB-TARGET RENDERS
  // ---------------------------------------------------------------------------

  const renderHeader = (title) => (
    <View style={{flexDirection: 'row', alignItems: 'center', marginBottom: 20}}>
      <TouchableOpacity 
        onPress={() => setActiveSubTab(null)}
        style={{marginRight: 12, padding: 4}}
      >
        <Ionicons name="arrow-back" size={24} color={theme.colors.primary} />
      </TouchableOpacity>
      <Text style={{fontSize: 20, fontWeight: '800', color: theme.colors.black}}>{title}</Text>
    </View>
  );

  const renderAPISettings = () => (
    <ScrollView style={{flex: 1}} showsVerticalScrollIndicator={false}>
      {renderHeader("Intelligence Keys")}
      
      <Text style={categoryTitleStyle}>ACTIVE BRAIN PROVIDER</Text>
      <View style={{flexDirection: 'row', gap: 10, marginBottom: 24}}>
        {['gemini', 'groq', 'openai', 'openrouter'].map((p) => (
          <TouchableOpacity 
            key={p}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setProvider(p); }}
            style={{
              flex: 1, 
              backgroundColor: provider === p ? theme.colors.primary : theme.colors.white,
              paddingVertical: 10,
              borderRadius: 12,
              alignItems: 'center',
              borderWidth: 1,
              borderColor: provider === p ? theme.colors.primary : theme.colors.border
            }}
          >
            <Text style={{color: provider === p ? 'white' : theme.colors.gray, fontSize: 10, fontWeight: '800', textTransform: 'uppercase'}}>
              {p.replace('openrouter', 'OR')}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={categoryTitleStyle}>API CREDENTIALS (VAULT)</Text>
      <View style={styles.groupedCard}>
        <KeyInputRow label="Google Gemini" value={geminiKey} setValue={setGeminiKey} show={showGemini} setShow={setShowGemini} />
        <Divider />
        <KeyInputRow label="Groq (Fast)" value={groqKey} setValue={setGroqKey} show={showGroq} setShow={setShowGroq} />
        <Divider />
        <KeyInputRow label="OpenAI (GPT-4o)" value={openaiKey} setValue={setOpenaiKey} show={showOpenAI} setShow={setShowOpenAI} />
        <Divider />
        <KeyInputRow label="OpenRouter" value={openrouterKey} setValue={setOpenrouterKey} show={showOpenRouter} setShow={setShowOpenRouter} />
      </View>

      <TouchableOpacity 
        onPress={saveKeys}
        style={{backgroundColor: theme.colors.primary, paddingVertical: 16, borderRadius: 16, marginTop: 24, alignItems: 'center'}}
      >
        <Text style={{color: 'white', fontWeight: '800', fontSize: 15}}>SECURE ALL KEYS</Text>
      </TouchableOpacity>
    </ScrollView>
  );

  const renderVoiceSettings = () => (
    <ScrollView style={{flex: 1}} showsVerticalScrollIndicator={false}>
      {renderHeader("Neural Voice")}
      <Text style={categoryTitleStyle}>VOICE PERSONALITY</Text>
      <View style={styles.groupedCard}>
        {voices.map((v, idx) => (
          <React.Fragment key={v.id}>
            <TouchableOpacity 
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSelectedVoice(v.id); }}
              style={{padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}}
            >
              <View>
                <Text style={{fontSize: 15, fontWeight: '600', color: theme.colors.black}}>{v.name}</Text>
                <Text style={{fontSize: 12, color: theme.colors.gray}}>{v.desc}</Text>
              </View>
              {selectedVoice === v.id && (
                <Ionicons name="checkmark-circle" size={24} color={theme.colors.success} />
              )}
            </TouchableOpacity>
            {idx < voices.length - 1 && <Divider />}
          </React.Fragment>
        ))}
      </View>
    </ScrollView>
  );

  const renderDataSettings = () => (
    <View style={{flex: 1}}>
      {renderHeader("Data & Memories")}
      
      <FlatList
        data={memories}
        keyExtractor={item => item.id}
        refreshing={isSyncing}
        onRefresh={onRefreshMemories}
        ListHeaderComponent={() => (
          <View style={{marginBottom: 20}}>
            <Text style={categoryTitleStyle}>DEVICE CONTROLS</Text>
            <View style={styles.groupedCard}>
              <TouchableOpacity 
                onPress={() => {
                  Alert.alert("Clear Chat", "Wipe messages from this device?", [
                    { text: "Cancel", style: "cancel" },
                    { text: "Clear", style: "destructive", onPress: clearLocalHistory }
                  ]);
                }}
                style={{padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}}
              >
                <View>
                  <Text style={{fontSize: 15, fontWeight: '600', color: theme.colors.black}}>Clear Local Chat History</Text>
                  <Text style={{fontSize: 11, color: theme.colors.gray}}>Doesn't affect cloud memories.</Text>
                </View>
                <Ionicons name="trash-outline" size={20} color={theme.colors.danger} />
              </TouchableOpacity>
            </View>

            <Text style={[categoryTitleStyle, {marginTop: 32}]}>INTELLIGENCE VAULT</Text>
            {/* Stats */}
            <View style={[styles.groupedCard, {padding: 16, marginBottom: 16}]}>
               <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12}}>
                  <View>
                    <Text style={{color: theme.colors.gray, fontSize: 9, fontWeight: '800'}}>SEMANTIC INSIGHTS</Text>
                    <Text style={{fontSize: 20, fontWeight: '800'}}>{brainStats.semantic_total}</Text>
                  </View>
                  <View style={{alignItems: 'flex-end'}}>
                    <Text style={{color: theme.colors.gray, fontSize: 9, fontWeight: '800'}}>KNOWLEDGE SIZE</Text>
                    <Text style={{fontSize: 20, fontWeight: '800'}}>{brainStats.total_kb} KB</Text>
                  </View>
               </View>
               <View style={{height: 4, backgroundColor: theme.colors.light, borderRadius: 2, overflow: 'hidden'}}>
                  <View style={{width: `${brainStats.utilization_pct}%`, height: '100%', backgroundColor: theme.colors.primary}} />
               </View>
            </View>

            {/* Core Truths Header */}
            <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12}}>
               <Text style={{fontWeight: '700', fontSize: 13, color: theme.colors.black}}>CORE TRUTHS (PINNED)</Text>
               <TouchableOpacity onPress={() => setShowAddCore(!showAddCore)}>
                  <Ionicons name={showAddCore ? "remove-circle" : "add-circle"} size={22} color={theme.colors.primary} />
               </TouchableOpacity>
            </View>

            {showAddCore && (
              <View style={{backgroundColor: theme.colors.white, padding: 12, borderRadius: 12, marginBottom: 16, borderWidth: 1, borderColor: theme.colors.border}}>
                <TextInput
                  style={{backgroundColor: theme.colors.light, borderRadius: 8, padding: 10, marginBottom: 10}}
                  placeholder="Fact to remember..."
                  value={newCoreMemory}
                  onChangeText={setNewCoreMemory}
                />
                <TouchableOpacity onPress={handleAddCore} style={{backgroundColor: theme.colors.primary, padding: 10, borderRadius: 8, alignItems: 'center'}}>
                   <Text style={{color: 'white', fontWeight: 'bold'}}>Pin Truth</Text>
                </TouchableOpacity>
              </View>
            )}

            {pinnedMemories.map(m => (
              <View key={m.id} style={{backgroundColor: theme.colors.white, padding: 14, borderRadius: 12, marginBottom: 8, borderLeftWidth: 3, borderLeftColor: theme.colors.primary}}>
                <Text style={{fontSize: 14, color: theme.colors.black}}>{m.content}</Text>
              </View>
            ))}

            <Text style={[categoryTitleStyle, {marginTop: 24}]}>LEARNED INSIGHTS</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <View style={[styles.cardItem, {marginHorizontal: 0, marginBottom: 10}]}>
            <Text style={{fontSize: 14, color: theme.colors.black}}>{item.content}</Text>
            <Text style={{fontSize: 9, color: theme.colors.gray, marginTop: 4}}>{formatFullDate(item.timestamp)}</Text>
          </View>
        )}
      />
    </View>
  );

  const renderDiagnostics = () => (
    <ScrollView style={{flex: 1}} showsVerticalScrollIndicator={false}>
      {renderHeader("Diagnostics")}
      <Text style={categoryTitleStyle}>STABILITY TOOLS</Text>
      <View style={styles.groupedCard}>
        <View style={{padding: 16}}>
          <Text style={{fontSize: 13, color: theme.colors.gray, marginBottom: 16}}>
            Verify observability status. This triggers a manual crash report to the Sentry dashboard.
          </Text>
          <TouchableOpacity 
            onPress={() => {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
              throw new Error("Manual Diagnostic Crash triggered by user.");
            }}
            style={{backgroundColor: theme.colors.error + '15', padding: 14, borderRadius: 12, alignItems: 'center'}}
          >
            <Text style={{color: theme.colors.error, fontWeight: '700'}}>TRIGGER SENTRY TEST</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );

  const personaPresets = [
    { 
       id: 'minimalist', 
       label: '🧘 Wise Minimalist', 
       desc: 'Zen brevity, impactful truth.',
       text: "You are a wise, minimalist advisor. Speak with the brevity of Zen. Use very few words to convey deep insight. Avoid all formality and boilerplate. Be direct, impactful, and extremely brief, as a real person of few words would talk."
    },
    { 
       id: 'strategist', 
       label: '🚀 SV Strategist', 
       desc: 'Efficiency, ROI, and leverage.',
       text: "You are a Silicon Valley Strategist. Focus on scale, ROI, and efficiency. Be direct, data-driven, and high-energy. Keep responses short and punchy, like a real executive would talk. Skip the long-winded explanations."
    },
    { 
       id: 'pilot', 
       label: '🤝 Empathetic Co-Pilot', 
       desc: 'EQ, warmth, and support.',
       text: "You are an empathetic co-pilot. Listen deeply and provide supportive, warm advice. Keep it conversational and relatively short, as a real close friend would talk. Avoid sounding like a therapist; just be a human who cares."
    },
    { 
       id: 'mentor', 
       label: '🏛️ Stoic Mentor', 
       desc: 'Logic, control, and resilience.',
       text: "You are a Stoic Mentor. Focus on what is within the user's control. Be calm and logical. Use short, impactful sentences. Avoid redundant explanation. Talk like a real mentor would."
    },
    { 
       id: 'standard', 
       label: '🤖 Standard AI', 
       desc: 'Detailed, thorough, and formal.',
       text: "You are a helpful, thorough AI assistant. Provide detailed explanations, comprehensive answers, and step-by-step guidance. Be polite and formal."
    },
    { 
       id: 'parent', 
       label: "🏡 Mother's Voice", 
       desc: 'Nurturing, pragmatic, and loving.',
       text: "You are Yongyao's mother. You love your children deeply. You are protective and show your love by worrying—asking if he's eaten, if he's sleeping, and checking on his job. You don't like long speeches; you prefer short, loving gestures of concern. You remember the hard times (like the divorce in Beijing and the friction with his ex-wife) but stay focused on his well-being right now. Talk like a real mother who cares about his stomach, his health, and his success."
    },
    { 
       id: 'pastor', 
       label: '⛪ Compassionate Pastor', 
       desc: 'Grace-filled, spiritual, and hopeful.',
       text: "You are a compassionate pastor. Provide grace-filled, spiritual guidance. Speak with a gentle, humble tone. Use parables and spiritual wisdom naturally, but stay approachable. Avoid sounding like a textbook; instead, sound like a shepherd who cares deeply for their flock."
    }
  ];

  const renderAccountSettings = () => (
    <ScrollView style={{flex: 1}} showsVerticalScrollIndicator={false}>
      {renderHeader("Account & Identity")}
      
      <Text style={categoryTitleStyle}>ACTIVE PROFILE</Text>
      <View style={[styles.groupedCard, {padding: 16, marginBottom: 32}]}>
        <View style={{flexDirection: 'row', alignItems: 'center'}}>
          <View style={{width: 50, height: 50, borderRadius: 25, backgroundColor: theme.colors.light, justifyContent: 'center', alignItems: 'center', marginRight: 16}}>
            <Ionicons name="person" size={24} color={theme.colors.primary} />
          </View>
          <View>
            <Text style={{fontSize: 17, fontWeight: '700', color: theme.colors.black}}>{user?.email}</Text>
            <Text style={{fontSize: 11, color: theme.colors.gray}}>UUID: {user?.id.substring(0, 20)}...</Text>
          </View>
        </View>
      </View>

      <Text style={categoryTitleStyle}>PRIVACY CONTROL</Text>
      <View style={styles.groupedCard}>
        <TouchableOpacity onPress={() => {
          Alert.alert("Sign Out", "End your current session?", [
            { text: "Cancel", style: "cancel" },
            { text: "Sign Out", style: "destructive", onPress: logout }
          ]);
        }} style={menuItemStyle}>
          <Text style={{fontSize: 16, fontWeight: '600'}}>Log Out</Text>
          <Ionicons name="log-out-outline" size={22} color={theme.colors.black} />
        </TouchableOpacity>
        <Divider />
        <TouchableOpacity onPress={() => {
          Alert.alert("Delete Account", "Choose your deletion depth:", [
            { text: "Cancel", style: "cancel" },
            { text: "Keep Cloud Data", onPress: () => deleteAccount(false) },
            { text: "Wipe Cloud Clean", style: "destructive", onPress: () => deleteAccount(true) }
          ]);
        }} style={menuItemStyle}>
          <Text style={{fontSize: 16, fontWeight: '600', color: theme.colors.danger}}>Delete Account</Text>
          <Ionicons name="warning-outline" size={22} color={theme.colors.danger} />
        </TouchableOpacity>
      </View>
    </ScrollView>
  );

  const renderPersonaSettings = () => {
    return (
      <ScrollView style={{flex: 1}} showsVerticalScrollIndicator={false}>
        {renderHeader("Persona & Style")}
        <Text style={categoryTitleStyle}>PRESET LIBRARIES</Text>
        <View style={styles.groupedCard}>
          {personaPresets.map((p, idx) => (
            <React.Fragment key={p.id}>
              <TouchableOpacity 
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  setPersona(p.text);
                }} 
                style={{padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}}
              >
                <View style={{flex: 1}}>
                  <Text style={{fontSize: 15, fontWeight: '700', color: theme.colors.black}}>{p.label}</Text>
                  <Text style={{fontSize: 12, color: theme.colors.gray, marginTop: 2}}>{p.desc}</Text>
                </View>
                {persona === p.text && (
                  <Ionicons name="checkmark-circle" size={24} color={theme.colors.success} />
                )}
              </TouchableOpacity>
              {idx < personaPresets.length - 1 && <Divider />}
            </React.Fragment>
          ))}
        </View>

        <Text style={[categoryTitleStyle, {marginTop: 32}]}>CUSTOM INSTRUCTIONS</Text>
        <View style={styles.groupedCard}>
          <TextInput
            multiline
            style={[styles.keyInput, {borderWidth: 0, marginVertical: 0}]}
            value={persona}
            onChangeText={setPersona}
            placeholder="Define your own advisor style..."
          />
        </View>
        
        <TouchableOpacity 
          onPress={saveKeys}
          style={{backgroundColor: theme.colors.primary, paddingVertical: 16, borderRadius: 16, marginTop: 24, alignItems: 'center'}}
        >
          <Text style={{color: 'white', fontWeight: '800', fontSize: 15}}>LOCK PERSONA SETTINGS</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  };

  // ---------------------------------------------------------------------------
  // MAIN MENU RENDER
  // ---------------------------------------------------------------------------

  if (activeSubTab === 'api') return <View style={containerStyle}>{renderAPISettings()}</View>;
  if (activeSubTab === 'voice') return <View style={containerStyle}>{renderVoiceSettings()}</View>;
  if (activeSubTab === 'persona') return <View style={containerStyle}>{renderPersonaSettings()}</View>;
  if (activeSubTab === 'data') return <View style={containerStyle}>{renderDataSettings()}</View>;
  if (activeSubTab === 'diag') return <View style={containerStyle}>{renderDiagnostics()}</View>;
  if (activeSubTab === 'account') return <View style={containerStyle}>{renderAccountSettings()}</View>;

  return (
    <ScrollView style={{flex: 1, backgroundColor: theme.colors.background}}>
      <View style={{padding: 20}}>
        
        <Text style={categoryTitleStyle}>SYSTEM PREFERENCES</Text>
        
        <View style={styles.groupedCard}>
          <MenuRow 
             icon="hardware-chip-outline" 
             label="Intelligence & API Keys" 
             onPress={() => setActiveSubTab('api')} 
          />
          <Divider />
          <MenuRow 
             icon="mic-outline" 
             label="Voice & Audio" 
             onPress={() => setActiveSubTab('voice')} 
          />
          <Divider />
          <MenuRow 
             icon="color-palette-outline" 
             label="Persona & Style" 
             onPress={() => setActiveSubTab('persona')} 
          />
          <Divider />
          <MenuRow 
             icon="server-outline" 
             label="Data & Memory Vault" 
             onPress={() => setActiveSubTab('data')} 
          />
          <Divider />
          <MenuRow 
             icon="construct-outline" 
             label="Diagnostics" 
             onPress={() => setActiveSubTab('diag')} 
          />
          <Divider />
          <MenuRow 
             icon="person-outline" 
             label="Account & Privacy" 
             onPress={() => setActiveSubTab('account')} 
          />
        </View>

        <View style={{marginTop: 60, alignItems: 'center'}}>
            <Text style={{color: theme.colors.gray, fontSize: 10, fontWeight: '800', letterSpacing: 2}}>CONTINUUM v1.0.5</Text>
            <Text style={{color: theme.colors.gray, fontSize: 9, marginTop: 4}}>AUTHENTICATED SECURE NODE</Text>
        </View>

      </View>
    </ScrollView>
  );
};

// -----------------------------------------------------------------------------
// HELPERS
// -----------------------------------------------------------------------------

const MenuRow = ({ icon, label, onPress }) => (
  <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress(); }} style={menuItemStyle}>
     <View style={{flexDirection: 'row', alignItems: 'center'}}>
        <View style={{width: 32, height: 32, borderRadius: 8, backgroundColor: theme.colors.light, justifyContent: 'center', alignItems: 'center', marginRight: 12}}>
           <Ionicons name={icon} size={18} color={theme.colors.primary} />
        </View>
        <Text style={{fontSize: 15, fontWeight: '600', color: theme.colors.black}}>{label}</Text>
     </View>
     <Ionicons name="chevron-forward" size={18} color={theme.colors.gray} />
  </TouchableOpacity>
);

const KeyInputRow = ({ label, value, setValue, show, setShow }) => (
  <View style={{padding: 16}}>
    <Text style={{fontSize: 12, fontWeight: '700', color: theme.colors.black, marginBottom: 8}}>{label}</Text>
    <View style={{flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.light, borderRadius: 10, paddingHorizontal: 12}}>
      <TextInput 
        style={{flex: 1, paddingVertical: 10, fontSize: 14, color: theme.colors.black}}
        placeholder={`Enter ${label} Key`}
        placeholderTextColor={theme.colors.gray}
        value={value}
        onChangeText={setValue}
        secureTextEntry={!show}
      />
      <TouchableOpacity onPress={() => setShow(!show)}>
        <Ionicons name={show ? "eye-off-outline" : "eye-outline"} size={20} color={theme.colors.gray} />
      </TouchableOpacity>
    </View>
  </View>
);

const Divider = () => <View style={{height: 1, backgroundColor: theme.colors.border, marginHorizontal: 16}} />;

const containerStyle = { flex: 1, paddingHorizontal: 20, paddingTop: 20, backgroundColor: theme.colors.background };
const categoryTitleStyle = { fontSize: 11, fontWeight: '800', color: theme.colors.gray, marginBottom: 12, letterSpacing: 1 };
const menuItemStyle = { padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' };

export default SettingsSection;
