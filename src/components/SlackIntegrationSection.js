import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Switch,
} from "react-native";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { useAppContext } from "../context/AppContext";
import {
  slackListChannels,
  slackReadMessages,
  slackPostMessage,
  slackIngestChannel,
} from "../services/apiService";
import { resolveRenderEmailBridgeSecret } from "../utils/emailBridge";
import { styles, theme } from "../styles/theme";

const SlackIntegrationSection = ({ onBack }) => {
  const {
    renderEmailBridgeSecret,
    slackToken,
    setSlackToken,
    slackWorkspace,
    setSlackWorkspace,
  } = useAppContext();

  const bridgeSecret = resolveRenderEmailBridgeSecret(renderEmailBridgeSecret);
  const [channels, setChannels] = useState([]);
  const [selectedChannel, setSelectedChannel] = useState(null);
  const [messages, setMessages] = useState([]);
  const [testing, setTesting] = useState(false);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [autoIngest, setAutoIngest] = useState(true);

  const persistToken = async (value) => {
    setSlackToken(value);
    await AsyncStorage.setItem("@slack_token", value.trim()).catch(() => {});
  };
  const persistWorkspace = async (value) => {
    setSlackWorkspace(value);
    await AsyncStorage.setItem("@slack_workspace", value.trim()).catch(() => {});
  };

  const tokenReady = () => {
    if (!bridgeSecret) {
      Alert.alert("Bridge not configured", "Set your Render email bridge secret in Setup → Email & Bridge first.");
      return false;
    }
    if (!slackToken?.trim()) {
      Alert.alert("Slack token required", "Paste your Slack Bot User OAuth Token (starts with xoxb-…).");
      return false;
    }
    return true;
  };

  const handleLoadChannels = useCallback(async () => {
    if (!tokenReady()) return;
    setLoadingChannels(true);
    try {
      const list = await slackListChannels(bridgeSecret, slackToken.trim());
      setChannels(list);
      if (!list.length) Alert.alert("No channels", "No public/private channels found. Make sure the bot is added to your workspace.");
    } catch (e) {
      Alert.alert("Slack error", e.message || String(e));
    } finally {
      setLoadingChannels(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridgeSecret, slackToken]);

  useEffect(() => {
    if (slackToken?.trim() && bridgeSecret) handleLoadChannels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelectChannel = async (ch) => {
    setSelectedChannel(ch);
    setMessages([]);
    if (!ch) return;
    setLoadingMessages(true);
    try {
      const list = await slackReadMessages(bridgeSecret, slackToken.trim(), ch.id, 30);
      setMessages(list);
      if (autoIngest) {
        setIngesting(true);
        try {
          const res = await slackIngestChannel(bridgeSecret, slackToken.trim(), ch.id, 30);
          setIngesting(false);
          if (res.ingested > 0) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            Alert.alert("Ingested to memory", `Loaded ${res.ingested} new message(s) from #${ch.name} into Continuum memory.`);
          }
        } catch (ingestErr) {
          setIngesting(false);
          console.warn('[slack] ingest failed:', ingestErr?.message);
        }
      }
    } catch (e) {
      Alert.alert("Slack error", e.message || String(e));
    } finally {
      setLoadingMessages(false);
    }
  };

  const handleIngestNow = async () => {
    if (!selectedChannel) {
      Alert.alert("Pick a channel", "Select a channel first.");
      return;
    }
    if (!tokenReady()) return;
    setIngesting(true);
    try {
      const res = await slackIngestChannel(bridgeSecret, slackToken.trim(), selectedChannel.id, 50);
      if (res.ingested > 0) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert("Ingested to memory", `Loaded ${res.ingested} new message(s) from #${selectedChannel.name} into Continuum memory.`);
      } else {
        Alert.alert("Nothing new", "All recent messages in this channel were already ingested.");
      }
    } catch (e) {
      Alert.alert("Ingest failed", e.message || String(e));
    } finally {
      setIngesting(false);
    }
  };

  const handlePostTest = async () => {
    if (!selectedChannel) {
      Alert.alert("Pick a channel", "Select a channel first.");
      return;
    }
    if (!tokenReady()) return;
    try {
      await slackPostMessage(bridgeSecret, slackToken.trim(), selectedChannel.id, "👋 Continuum agent connected — posting from the app.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Posted", `Sent a test message to #${selectedChannel.name}.`);
    } catch (e) {
      Alert.alert("Post failed", e.message || String(e));
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: 20, paddingBottom: 120 }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 20 }}>
        <TouchableOpacity onPress={onBack} style={{ marginRight: 12, padding: 4 }}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.primary} />
        </TouchableOpacity>
        <Text style={{ fontSize: 20, fontWeight: "800", color: theme.colors.black }}>
          Slack
        </Text>
      </View>

      <Text style={{ fontSize: 13, color: theme.colors.gray, lineHeight: 20, marginBottom: 16 }}>
        Connect your Slack workspace so Continuum can read channel messages into memory and post replies. Requires a Slack Bot token.
      </Text>

      <Text style={[styles.categoryTitle, { marginTop: 0 }]}>HOW TO GET THE TOKEN</Text>
      <View style={styles.groupedCard}>
        <Text style={{ fontSize: 12, color: theme.colors.gray, lineHeight: 19 }}>
          1. Open api.slack.com → Create New App → From scratch (pick your workspace){"\n"}
          2. OAuth & Permissions → add scopes: channels:read, channels:history, chat:write, users:read{"\n"}
          3. Install to Workspace → copy the Bot User OAuth Token (xoxb-…)
        </Text>
      </View>

      <Text style={[styles.categoryTitle, { marginTop: 16 }]}>WORKSPACE</Text>
      <View style={styles.groupedCard}>
        <TextInput
          style={[styles.keyInput, { borderWidth: 0 }]}
          value={slackWorkspace}
          onChangeText={persistWorkspace}
          placeholder="e.g. mycompany.slack.com (optional)"
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
      </View>

      <Text style={[styles.categoryTitle, { marginTop: 16 }]}>BOT TOKEN</Text>
      <View style={styles.groupedCard}>
        <TextInput
          style={[styles.keyInput, { borderWidth: 0 }]}
          value={slackToken}
          onChangeText={persistToken}
          placeholder="xoxb-…"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          clearButtonMode="while-editing"
        />
      </View>

      <TouchableOpacity
        onPress={handleLoadChannels}
        disabled={loadingChannels || !slackToken?.trim()}
        style={{
          backgroundColor: theme.colors.primary,
          paddingVertical: 14,
          borderRadius: 16,
          marginTop: 12,
          alignItems: "center",
          opacity: loadingChannels || !slackToken?.trim() ? 0.6 : 1,
        }}
      >
        <Text style={{ color: "white", fontWeight: "700", fontSize: 14 }}>
          {loadingChannels ? "Connecting…" : "Connect to Slack"}
        </Text>
      </TouchableOpacity>

      {channels.length > 0 && (
        <>
          <Text style={[styles.categoryTitle, { marginTop: 24 }]}>CHANNELS</Text>
          {channels.map((ch) => (
            <TouchableOpacity
              key={ch.id}
              onPress={() => handleSelectChannel(ch)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                padding: 14,
                backgroundColor: selectedChannel?.id === ch.id ? theme.colors.light : theme.colors.white,
                borderWidth: 1,
                borderColor: theme.colors.border,
                borderRadius: 12,
                marginBottom: 8,
              }}
            >
              <Ionicons name={ch.is_private ? "lock-closed" : "hash"} size={16} color={theme.colors.gray} style={{ marginRight: 8 }} />
              <Text style={{ flex: 1, fontWeight: "600", color: theme.colors.black }}>{ch.name}</Text>
              <Text style={{ color: theme.colors.gray, fontSize: 11 }}>{ch.num_members || ''}</Text>
            </TouchableOpacity>
          ))}

          {selectedChannel && (
            <View style={styles.groupedCard}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <Text style={{ fontSize: 13, fontWeight: "700", color: theme.colors.black }}>
                  #{selectedChannel.name}
                </Text>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <Text style={{ fontSize: 11, color: theme.colors.gray, marginRight: 8 }}>Auto-ingest</Text>
                  <Switch value={autoIngest} onValueChange={setAutoIngest} />
                </View>
              </View>

              {loadingMessages ? (
                <ActivityIndicator color={theme.colors.primary} style={{ paddingVertical: 12 }} />
              ) : (
                messages.slice(0, 10).map((m, i) => (
                  <View key={m.ts || i} style={{ marginBottom: 8 }}>
                    <Text style={{ fontSize: 11, color: theme.colors.gray }}>
                      {m.user} · {m.ts_iso ? new Date(m.ts_iso).toLocaleString() : ''}
                    </Text>
                    <Text style={{ fontSize: 13, color: theme.colors.black }}>{m.text}</Text>
                  </View>
                ))
              )}

              <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                <TouchableOpacity
                  onPress={handleIngestNow}
                  disabled={ingesting}
                  style={{ flex: 1, backgroundColor: theme.colors.primary, paddingVertical: 12, borderRadius: 12, alignItems: "center", opacity: ingesting ? 0.6 : 1 }}
                >
                  <Text style={{ color: "white", fontWeight: "700", fontSize: 13 }}>
                    {ingesting ? "Ingesting…" : "Load into memory"}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handlePostTest}
                  style={{ flex: 1, backgroundColor: theme.colors.light, paddingVertical: 12, borderRadius: 12, alignItems: "center" }}
                >
                  <Text style={{ color: theme.colors.primary, fontWeight: "700", fontSize: 13 }}>Post test</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </>
      )}

      <Text style={{ fontSize: 11, color: theme.colors.gray, marginTop: 24, lineHeight: 17 }}>
        Token is stored securely on this device (like your other API keys). Slack messages are only read when you select a channel or ask in chat.
      </Text>
    </ScrollView>
  );
};

export default SlackIntegrationSection;
