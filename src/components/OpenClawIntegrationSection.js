import React, { useMemo, useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  Share,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { useAppContext } from "../context/AppContext";
import { API_URL, SUPABASE_URL, SUPABASE_ANON_KEY } from "../constants/Config";
import { styles, theme } from "../styles/theme";

const DEFAULT_VPS_IP = "135.181.155.197";

function generateSecret() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 24; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
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
  ];

  return {
    vpsIp,
    commands: lines,
    commandBlock: lines.join("\n"),
  };
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
    saveOpenClawSettings,
  } = useAppContext();

  const [copied, setCopied] = useState(false);
  const [localSecret, setLocalSecret] = useState("");

  useEffect(() => {
    if (!openclawBridgeSecret && !localSecret) {
      setLocalSecret(generateSecret());
    }
  }, [openclawBridgeSecret, localSecret]);

  const refreshToken = session?.refresh_token || "";
  const bridgeSecret = openclawBridgeSecret || localSecret;

  const setupBundle = useMemo(
    () =>
      buildOpenClawVpsCommands({
        vpsIp: openclawVpsIp || DEFAULT_VPS_IP,
        bridgeSecret,
        refreshToken,
        geminiKey,
        provider,
      }),
    [openclawVpsIp, bridgeSecret, refreshToken, geminiKey, provider],
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
    if (!openclawBridgeSecret) {
      setOpenclawBridgeSecret(bridgeSecret);
    }
    await saveOpenClawSettings();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert("Saved", "OpenClaw gateway settings stored on this device.");
  };

  const handleCopyCommands = async () => {
    if (!ensureReady()) return;
    if (!openclawBridgeSecret) {
      setOpenclawBridgeSecret(bridgeSecret);
      await saveOpenClawSettings();
    }
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
        Connect your Hetzner VPS to Continuum memory. OpenClaw handles email/SMS channels;
        Continuum stays your brain (L1–L5).
      </Text>

      <Text style={styles.categoryTitle}>VPS ADDRESS</Text>
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
          value={openclawBridgeSecret || bridgeSecret}
          onChangeText={setOpenclawBridgeSecret}
          placeholder="Auto-generated"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

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
        After setup on VPS, run: openclaw chat{"\n"}
        Ask: "Use continuum-brain to answer using my memory."{"\n\n"}
        Docs: docs/OPENCLAW_INTEGRATION.md
      </Text>
    </ScrollView>
  );
};

export default OpenClawIntegrationSection;
