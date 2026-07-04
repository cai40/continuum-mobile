import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  Share,
  Switch,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { useAppContext } from "../context/AppContext";
import { testOpenClawBridge } from "../services/apiService";
import {
  API_URL,
  DEFAULT_OPENCLAW_BRIDGE_SECRET,
  OPENCLAW_BRIDGE_PORT,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
} from "../constants/Config";
import { styles, theme } from "../styles/theme";

const DEFAULT_VPS_IP = "135.181.155.197";

function resolveBridgeSecret(storedSecret) {
  const trimmed = storedSecret?.trim();
  return trimmed || DEFAULT_OPENCLAW_BRIDGE_SECRET;
}

export function buildOpenClawVpsCommands({
  vpsIp,
  bridgeSecret,
  refreshToken,
  geminiKey,
  provider,
}) {
  const lines = [
    "export PATH=\"/usr/local/bin:/usr/bin:$PATH\"",
    "mkdir -p -m 700 ~/.config/continuum-openclaw",
    `echo 'CONTINUUM_API_URL=${API_URL}' > ~/.config/continuum-openclaw/.env`,
    `echo 'SUPABASE_URL=${SUPABASE_URL}' >> ~/.config/continuum-openclaw/.env`,
    `echo 'SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}' >> ~/.config/continuum-openclaw/.env`,
    `echo 'CONTINUUM_PROVIDER=${provider || "gemini"}' >> ~/.config/continuum-openclaw/.env`,
    `echo 'CONTINUUM_REFRESH_TOKEN=${refreshToken}' >> ~/.config/continuum-openclaw/.env`,
    `echo 'GEMINI_API_KEY=${geminiKey}' >> ~/.config/continuum-openclaw/.env`,
    `echo 'BRIDGE_SECRET=${bridgeSecret}' >> ~/.config/continuum-openclaw/.env`,
    "chmod 600 ~/.config/continuum-openclaw/.env",
    "mkdir -p ~/.openclaw/workspace/skills",
    "git clone https://github.com/cai40/continuum-mobile.git /tmp/continuum-mobile 2>/dev/null || true",
    "cp -r /tmp/continuum-mobile/skills/continuum-brain ~/.openclaw/workspace/skills/ 2>/dev/null || cp -r ~/continuum-mobile/skills/continuum-brain ~/.openclaw/workspace/skills/",
    "cd ~/.openclaw/workspace/skills/continuum-brain",
    "node scripts/ask.js --json \"Reply with exactly: Continuum bridge OK\"",
    "openclaw gateway restart",
    "cd /tmp/continuum-mobile && git pull",
    "bash integrations/continuum-bridge/setup-bridge-service.sh",
  ];

  return {
    vpsIp,
    commands: lines,
    commandBlock: lines.join("\n"),
  };
}

function bridgeTestErrorHint(message) {
  const msg = message || "";
  if (/network request failed|failed to fetch|could not connect|timed out/i.test(msg)) {
    return (
      "The VPS bridge is running, but your iPhone could not reach it over HTTP.\n\n" +
      "1. Clear Bridge Secret, type: openclaw2026, tap Save\n" +
      "2. Install the latest iOS build from TestFlight/App Store (OTA alone cannot allow HTTP to your VPS)\n" +
      "3. Or verify on VPS: curl http://127.0.0.1:8787/health"
    );
  }
  return msg;
}

const OpenClawIntegrationSection = ({ onBack }) => {
  const {
    session,
    provider,
    geminiKey,
    openclawVpsIp,
    setOpenclawVpsIp,
    openclawBridgeSecret,
    setOpenclawBridgeSecret,
    openclawChatEnabled,
    setOpenclawChatEnabled,
    saveOpenClawSettings,
  } = useAppContext();

  const [copied, setCopied] = useState(false);
  const [testing, setTesting] = useState(false);

  const refreshToken = session?.refresh_token || "";
  const effectiveSecret = resolveBridgeSecret(openclawBridgeSecret);

  const setupBundle = useMemo(
    () =>
      buildOpenClawVpsCommands({
        vpsIp: openclawVpsIp || DEFAULT_VPS_IP,
        bridgeSecret: effectiveSecret,
        refreshToken,
        geminiKey,
        provider,
      }),
    [openclawVpsIp, effectiveSecret, refreshToken, geminiKey, provider],
  );

  const ensureReady = () => {
    if (!session?.refresh_token) {
      Alert.alert("Not signed in", "Log into Continuum first.");
      return false;
    }
    if (!geminiKey?.trim()) {
      Alert.alert(
        "Gemini key required",
        "Add your Gemini API key under Settings → Intelligence & API Keys first.",
      );
      return false;
    }
    return true;
  };

  const handleSave = async () => {
    await saveOpenClawSettings();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert("Saved", "OpenClaw gateway settings stored on this device.");
  };

  const handleTestBridge = async () => {
    const ip = openclawVpsIp?.trim() || DEFAULT_VPS_IP;
    const secret = effectiveSecret;
    setTesting(true);
    try {
      const url = `http://${ip}:${OPENCLAW_BRIDGE_PORT}`;
      const health = await testOpenClawBridge(url, secret);
      Alert.alert("Bridge OK", `Connected to ${health.service || "continuum-bridge"} on ${ip}`);
    } catch (e) {
      Alert.alert("Bridge unreachable", bridgeTestErrorHint(e.message || String(e)));
    } finally {
      setTesting(false);
    }
  };

  const handleToggleChat = async (value) => {
    setOpenclawChatEnabled(value);
    await AsyncStorage.multiSet([
      ["@openclaw_chat_enabled", value ? "true" : "false"],
      ["@openclaw_vps_ip", (openclawVpsIp || DEFAULT_VPS_IP).trim()],
      ["@openclaw_bridge_secret", openclawBridgeSecret.trim()],
    ]);
  };

  const handleCopyCommands = async () => {
    if (!ensureReady()) return;
    await saveOpenClawSettings();
    await Clipboard.setStringAsync(setupBundle.commandBlock);
    setCopied(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert(
      "Copied",
      "Paste into your iPhone SSH app one command at a time. Do not paste the whole block as one line.",
    );
  };

  const handleShare = async () => {
    if (!ensureReady()) return;
    await Share.share({
      message: setupBundle.commandBlock,
      title: "OpenClaw VPS setup",
    });
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
          OpenClaw Gateway
        </Text>
      </View>

      <Text style={{ fontSize: 13, color: theme.colors.gray, lineHeight: 20, marginBottom: 20 }}>
        Use Continuum app as your chat UI. When enabled, messages route through your
        OpenClaw VPS (Continuum memory + Yahoo email). No SSH needed.
      </Text>

      <View style={[styles.groupedCard, { padding: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={{ fontSize: 15, fontWeight: "700", color: theme.colors.black }}>
            Route chat through OpenClaw
          </Text>
          <Text style={{ fontSize: 12, color: theme.colors.gray, marginTop: 4 }}>
            Chat tab uses VPS bridge instead of Render only
          </Text>
        </View>
        <Switch
          value={openclawChatEnabled}
          onValueChange={handleToggleChat}
        />
      </View>

      <Text style={[styles.categoryTitle, { marginTop: 24 }]}>VPS ADDRESS</Text>
      <View style={styles.groupedCard}>
        <TextInput
          style={[styles.keyInput, { borderWidth: 0 }]}
          value={openclawVpsIp}
          onChangeText={setOpenclawVpsIp}
          placeholder={DEFAULT_VPS_IP}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <Text style={[styles.categoryTitle, { marginTop: 24 }]}>BRIDGE SECRET</Text>
      <View style={styles.groupedCard}>
        <TextInput
          style={[styles.keyInput, { borderWidth: 0 }]}
          value={openclawBridgeSecret}
          onChangeText={setOpenclawBridgeSecret}
          placeholder={DEFAULT_OPENCLAW_BRIDGE_SECRET}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
      </View>
      <Text style={{ fontSize: 11, color: theme.colors.gray, marginTop: 8, lineHeight: 16 }}>
        Clear the field and type {DEFAULT_OPENCLAW_BRIDGE_SECRET} if unsure. Leave blank to use that default.
      </Text>

      <View style={[styles.groupedCard, { marginTop: 24, padding: 16 }]}>
        <Text style={{ fontSize: 12, fontWeight: "700", color: theme.colors.black, marginBottom: 8 }}>
          Status checklist
        </Text>
        <Text style={{ fontSize: 12, color: session ? theme.colors.success : theme.colors.danger }}>
          {session ? "✓" : "✗"} Continuum signed in
        </Text>
        <Text style={{ fontSize: 12, color: geminiKey ? theme.colors.success : theme.colors.danger, marginTop: 4 }}>
          {geminiKey ? "✓" : "✗"} Gemini API key saved
        </Text>
        <Text style={{ fontSize: 12, color: theme.colors.gray, marginTop: 4 }}>
          VPS IP: {openclawVpsIp || DEFAULT_VPS_IP}
        </Text>
        <Text style={{ fontSize: 12, color: theme.colors.gray, marginTop: 4 }}>
          Bridge secret: {effectiveSecret}
        </Text>
      </View>

      <TouchableOpacity
        onPress={handleCopyCommands}
        style={{
          backgroundColor: theme.colors.primary,
          paddingVertical: 16,
          borderRadius: 16,
          marginTop: 24,
          alignItems: "center",
        }}
      >
        <Text style={{ color: "white", fontWeight: "800", fontSize: 15 }}>
          {copied ? "COMMANDS COPIED — PASTE ON VPS" : "COPY VPS SETUP COMMANDS"}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={handleTestBridge}
        disabled={testing}
        style={{
          backgroundColor: theme.colors.light,
          paddingVertical: 14,
          borderRadius: 16,
          marginTop: 12,
          alignItems: "center",
          opacity: testing ? 0.6 : 1,
        }}
      >
        <Text style={{ color: theme.colors.primary, fontWeight: "700", fontSize: 14 }}>
          {testing ? "Testing bridge..." : "Test bridge connection"}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={handleShare}
        style={{
          backgroundColor: theme.colors.light,
          paddingVertical: 14,
          borderRadius: 16,
          marginTop: 12,
          alignItems: "center",
        }}
      >
        <Text style={{ color: theme.colors.primary, fontWeight: "700", fontSize: 14 }}>
          Share commands
        </Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={handleSave} style={{ marginTop: 16, alignItems: "center" }}>
        <Text style={{ color: theme.colors.gray, fontSize: 13, fontWeight: "600" }}>
          Save settings on this device
        </Text>
      </TouchableOpacity>

      <Text style={{ fontSize: 11, color: theme.colors.gray, marginTop: 28, lineHeight: 18 }}>
        1. Copy VPS setup commands and run on server{"\n"}
        2. Run: bash integrations/continuum-bridge/setup-bridge-service.sh{"\n"}
        3. Enable "Route chat through OpenClaw" above{"\n"}
        4. Chat normally — ask about email: "check my Yahoo inbox"
      </Text>
    </ScrollView>
  );
};

export default OpenClawIntegrationSection;
