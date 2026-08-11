import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  Switch,
} from "react-native";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { useAppContext } from "../context/AppContext";
import { testRenderEmailHealth, fetchDailyCleanupLatest, runDailyCleanupNow } from "../services/apiService";
import {
  RENDER_EMAIL_BRIDGE_URL,
  DEFAULT_EMAIL_LIMIT,
  DEFAULT_EMAIL_RECENT,
  MAX_EMAIL_LIMIT,
} from "../constants/Config";
import { resolveRenderEmailBridgeSecret } from "../utils/emailBridge";
import { clampEmailLimit, normalizeEmailRecent } from "../utils/emailOptions";
import { styles, theme } from "../styles/theme";

const EmailIntegrationSection = ({ onBack }) => {
  const {
    session,
    renderEmailBridgeSecret,
    setRenderEmailBridgeSecret,
    emailLimit,
    setEmailLimit,
    emailRecent,
    setEmailRecent,
    emailDeleteEnabled,
    setEmailDeleteEnabled,
    emailAutoTrashJunk,
    setEmailAutoTrashJunk,
    renderEmailEnabled,
    setRenderEmailEnabled,
    saveEmailSettings,
  } = useAppContext();

  const effectiveEmailLimit = clampEmailLimit(emailLimit);
  const effectiveEmailRecent = normalizeEmailRecent(emailRecent);

  const [testingRenderEmail, setTestingRenderEmail] = useState(false);
  const [dailyCleanup, setDailyCleanup] = useState(null);
  const [runningDailyCleanup, setRunningDailyCleanup] = useState(false);

  const effectiveRenderSecret = resolveRenderEmailBridgeSecret(renderEmailBridgeSecret);

  const loadDailyCleanup = useCallback(async () => {
    if (!renderEmailEnabled || !effectiveRenderSecret) return;
    try {
      const data = await fetchDailyCleanupLatest(effectiveRenderSecret);
      setDailyCleanup(data);
    } catch {
      setDailyCleanup(null);
    }
  }, [renderEmailEnabled, effectiveRenderSecret]);

  useEffect(() => {
    loadDailyCleanup();
  }, [loadDailyCleanup]);

  const handleSave = async () => {
    setEmailLimit(String(clampEmailLimit(emailLimit)));
    setEmailRecent(normalizeEmailRecent(emailRecent));
    await saveEmailSettings();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert("Saved", "Email bridge settings stored on this device.");
  };

  const handleRunDailyCleanup = async () => {
    if (!effectiveRenderSecret) {
      Alert.alert("Render email secret required", "Paste BRIDGE_SECRET from continuum-email-bridge.");
      return;
    }
    if (!emailDeleteEnabled) {
      Alert.alert("Allow move to Trash", "Turn on Allow move to Trash below before daily cleanup can run.");
      return;
    }
    setRunningDailyCleanup(true);
    try {
      const data = await runDailyCleanupNow(effectiveRenderSecret);
      setDailyCleanup({ enabled: true, last_run: data.run, runs: [data.run] });
      const run = data.run;
      Alert.alert(
        "Daily cleanup done",
        run?.moved_to_trash
          ? `Moved ${run.moved_to_trash} email(s) to Trash (scanned ${run.fetched} from last ${run.lookback}).`
          : run?.summary_text || "Cleanup finished.",
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Alert.alert("Daily cleanup failed", e.message || String(e));
    } finally {
      setRunningDailyCleanup(false);
    }
  };

  const handleTestRenderEmail = async () => {
    if (!effectiveRenderSecret) {
      Alert.alert(
        "Render email secret required",
        "Paste BRIDGE_SECRET from continuum-email-bridge on Render into Render email bridge secret below.",
      );
      return;
    }
    setTestingRenderEmail(true);
    try {
      const health = await testRenderEmailHealth(effectiveRenderSecret);
      const emailReady = health?.email?.ready;
      Alert.alert(
        emailReady ? "Render email OK" : "Render email bridge up",
        emailReady
          ? `Yahoo mail ready via ${RENDER_EMAIL_BRIDGE_URL.replace("https://", "")}`
          : `Bridge reachable but email not ready: ${health?.email?.error || "check Render env vars"}`,
      );
    } catch (e) {
      Alert.alert(
        "Render email unreachable",
        `${e.message || String(e)}\n\nCheck Render email bridge secret matches BRIDGE_SECRET on continuum-email-bridge.`,
      );
    } finally {
      setTestingRenderEmail(false);
    }
  };

  const toggleRenderEmail = async (value) => {
    setRenderEmailEnabled(value);
    await AsyncStorage.setItem("@render_email_enabled", value ? "true" : "false");
  };

  const toggleDeleteEnabled = async (value) => {
    setEmailDeleteEnabled(value);
    await AsyncStorage.setItem("@email_delete_enabled", value ? "true" : "false");
  };

  const toggleAutoTrashJunk = async (value) => {
    setEmailAutoTrashJunk(value);
    await AsyncStorage.setItem("@email_auto_trash_junk", value ? "true" : "false");
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
          Email & Bridge
        </Text>
      </View>

      <Text style={{ fontSize: 13, color: theme.colors.gray, lineHeight: 20, marginBottom: 20 }}>
        Yahoo email via Continuum on Render — no VPS needed. Powers the Email tab, Zillow feed,
        and family memory ingest. Chat can also read and clean your inbox when this is on.
      </Text>

      <Text style={[styles.categoryTitle, { marginTop: 0 }]}>RENDER CLOUD EMAIL</Text>
      <View style={[styles.groupedCard, { padding: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={{ fontSize: 14, fontWeight: "700", color: theme.colors.black }}>
            Use Render for Yahoo email
          </Text>
          <Text style={{ fontSize: 11, color: theme.colors.gray, marginTop: 6, lineHeight: 16 }}>
            Inbox fetch, date ranges, cleanup, and move-to-folder via {RENDER_EMAIL_BRIDGE_URL.replace("https://", "")}.
          </Text>
        </View>
        <Switch
          value={renderEmailEnabled}
          onValueChange={toggleRenderEmail}
        />
      </View>

      <Text style={[styles.categoryTitle, { marginTop: 16 }]}>RENDER EMAIL BRIDGE SECRET</Text>
      <View style={styles.groupedCard}>
        <TextInput
          style={[styles.keyInput, { borderWidth: 0 }]}
          value={renderEmailBridgeSecret}
          onChangeText={setRenderEmailBridgeSecret}
          placeholder="BRIDGE_SECRET from continuum-email-bridge"
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          secureTextEntry
        />
      </View>
      <Text style={{ fontSize: 11, color: theme.colors.gray, marginTop: 8, lineHeight: 16 }}>
        Render → continuum-email-bridge → Environment → BRIDGE_SECRET.
      </Text>

      <TouchableOpacity
        onPress={handleTestRenderEmail}
        disabled={testingRenderEmail}
        style={{
          backgroundColor: theme.colors.light,
          paddingVertical: 14,
          borderRadius: 16,
          marginTop: 12,
          alignItems: "center",
          opacity: testingRenderEmail ? 0.6 : 1,
        }}
      >
        <Text style={{ color: theme.colors.primary, fontWeight: "700", fontSize: 14 }}>
          {testingRenderEmail ? "Testing Render email..." : "Test Render email bridge"}
        </Text>
      </TouchableOpacity>

      <Text style={[styles.categoryTitle, { marginTop: 24 }]}>EMAIL FETCH LIMIT</Text>
      <View style={styles.groupedCard}>
        <TextInput
          style={[styles.keyInput, { borderWidth: 0 }]}
          value={emailLimit}
          onChangeText={setEmailLimit}
          placeholder={String(DEFAULT_EMAIL_LIMIT)}
          keyboardType="number-pad"
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
      </View>
      <Text style={{ fontSize: 11, color: theme.colors.gray, marginTop: 8, lineHeight: 16 }}>
        Max emails per inbox request (1–{MAX_EMAIL_LIMIT}). Default {DEFAULT_EMAIL_LIMIT}. Override in chat: “last 50 emails”, “skip 100, next 250 emails”, “emails 101–350”, or “fetch emails from 6/15/2026 back to 1/1/2026”.
      </Text>

      <Text style={[styles.categoryTitle, { marginTop: 24 }]}>EMAIL LOOKBACK</Text>
      <View style={styles.groupedCard}>
        <TextInput
          style={[styles.keyInput, { borderWidth: 0 }]}
          value={emailRecent}
          onChangeText={setEmailRecent}
          placeholder={DEFAULT_EMAIL_RECENT}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
      </View>
      <Text style={{ fontSize: 11, color: theme.colors.gray, marginTop: 8, lineHeight: 16 }}>
        How far back to search: 24h, 7d, or 30d. Override in chat: “last 7 days”.
      </Text>

      <Text style={[styles.categoryTitle, { marginTop: 24 }]}>ALLOW MOVE TO TRASH</Text>
      <View style={[styles.groupedCard, { padding: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={{ fontSize: 14, fontWeight: "700", color: theme.colors.black }}>
            Permit move to Trash
          </Text>
          <Text style={{ fontSize: 11, color: theme.colors.gray, marginTop: 6, lineHeight: 16 }}>
            When ON, chat can move Yahoo mail to Trash via the bridge (not permanent delete; max 100 per batch). Off by default.
          </Text>
        </View>
        <Switch
          value={emailDeleteEnabled}
          onValueChange={toggleDeleteEnabled}
        />
      </View>
      <Text style={{ fontSize: 11, color: theme.colors.gray, marginTop: 8, lineHeight: 16 }}>
        Examples: “move email 1 to trash”, “trash uid 12345”, “move category 6 to trash”.
      </Text>

      <Text style={[styles.categoryTitle, { marginTop: 24 }]}>AUTO-TRASH NEWSLETTERS</Text>
      <View style={[styles.groupedCard, { padding: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between", opacity: emailDeleteEnabled ? 1 : 0.5 }]}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={{ fontSize: 14, fontWeight: "700", color: theme.colors.black }}>
            Auto-trash promos & newsletters on fetch
          </Text>
          <Text style={{ fontSize: 11, color: theme.colors.gray, marginTop: 6, lineHeight: 16 }}>
            When ON, every inbox fetch moves newsletter/promo/spam to Trash (max 100; up to 500 on fetch-and-clean). Banks, DocuSign, OTP, and Cash App are never auto-deleted. Requires delete permission above.
          </Text>
        </View>
        <Switch
          value={emailAutoTrashJunk && emailDeleteEnabled}
          disabled={!emailDeleteEnabled}
          onValueChange={toggleAutoTrashJunk}
        />
      </View>
      <Text style={{ fontSize: 11, color: theme.colors.gray, marginTop: 8, lineHeight: 16 }}>
        Triggers on “check inbox”, “summarize email”, or any mail chat. Say “check my Yahoo inbox” daily to purge junk.
      </Text>
      <Text style={{ fontSize: 11, color: theme.colors.gray, marginTop: 8, lineHeight: 16 }}>
        Say “clean up inbox” to trash news, newsletters, promos, ads, GitHub/dev mail, and bank statements (not OTP/security). Supports “June 2026”, “for 2026”, etc. Fetch-and-clean moves up to 10,000 to Trash per run. Requires delete permission above.
      </Text>

      <Text style={[styles.categoryTitle, { marginTop: 24 }]}>DAILY EMAIL CLEANUP</Text>
      <View style={[styles.groupedCard, { padding: 16 }]}>
        <Text style={{ fontSize: 14, fontWeight: "700", color: theme.colors.black }}>
          Automatic daily purge + summary
        </Text>
        <Text style={{ fontSize: 11, color: theme.colors.gray, marginTop: 8, lineHeight: 16 }}>
          Scans the last 24 hours each day, trashes newsletters/promos (up to 500/run), and saves a report you can view here or ask in chat: “daily cleanup summary”.
        </Text>
        {dailyCleanup?.last_run ? (
          <View style={{ marginTop: 12, padding: 12, backgroundColor: theme.colors.light, borderRadius: 12 }}>
            <Text style={{ fontSize: 12, fontWeight: "700", color: theme.colors.black }}>
              Last run
            </Text>
            <Text style={{ fontSize: 12, color: theme.colors.gray, marginTop: 4 }}>
              {dailyCleanup.last_run.moved_to_trash} moved to Trash · {dailyCleanup.last_run.fetched} scanned · {dailyCleanup.last_run.lookback}
            </Text>
            <Text style={{ fontSize: 11, color: theme.colors.gray, marginTop: 4 }}>
              {dailyCleanup.last_run.ran_at ? new Date(dailyCleanup.last_run.ran_at).toLocaleString() : ""}
            </Text>
          </View>
        ) : (
          <Text style={{ fontSize: 12, color: theme.colors.gray, marginTop: 12 }}>
            No daily cleanup run yet.
          </Text>
        )}
        <TouchableOpacity
          onPress={handleRunDailyCleanup}
          disabled={runningDailyCleanup || !renderEmailEnabled}
          style={{
            backgroundColor: theme.colors.primary,
            paddingVertical: 12,
            borderRadius: 12,
            marginTop: 12,
            alignItems: "center",
            opacity: runningDailyCleanup || !renderEmailEnabled ? 0.6 : 1,
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>
            {runningDailyCleanup ? "Running cleanup…" : "Run daily cleanup now"}
          </Text>
        </TouchableOpacity>
        <Text style={{ fontSize: 11, color: theme.colors.gray, marginTop: 10, lineHeight: 16 }}>
          For automatic runs: Render Dashboard → New Cron Job → POST {RENDER_EMAIL_BRIDGE_URL}/cron/daily-cleanup with header X-Bridge-Secret (schedule 0 8 * * *).
        </Text>
      </View>

      <View style={[styles.groupedCard, { marginTop: 24, padding: 16 }]}>
        <Text style={{ fontSize: 12, fontWeight: "700", color: theme.colors.black, marginBottom: 8 }}>
          Status checklist
        </Text>
        <Text style={{ fontSize: 12, color: session ? theme.colors.success : theme.colors.danger }}>
          {session ? "✓" : "✗"} Continuum signed in
        </Text>
        <Text style={{ fontSize: 12, color: renderEmailEnabled ? theme.colors.success : theme.colors.gray, marginTop: 4 }}>
          Render cloud email: {renderEmailEnabled ? "enabled" : "disabled"}
        </Text>
        <Text style={{ fontSize: 12, color: effectiveRenderSecret ? theme.colors.success : theme.colors.danger, marginTop: 4 }}>
          {effectiveRenderSecret ? "✓" : "✗"} Render email secret {effectiveRenderSecret ? "set" : "(required)"}
        </Text>
        <Text style={{ fontSize: 12, color: theme.colors.gray, marginTop: 4 }}>
          Email fetch: {effectiveEmailLimit} messages / {effectiveEmailRecent}
        </Text>
        <Text style={{ fontSize: 12, color: emailDeleteEnabled ? theme.colors.danger : theme.colors.gray, marginTop: 4 }}>
          Email move to Trash: {emailDeleteEnabled ? "enabled" : "disabled"}
        </Text>
        <Text style={{ fontSize: 12, color: emailAutoTrashJunk && emailDeleteEnabled ? theme.colors.danger : theme.colors.gray, marginTop: 4 }}>
          Auto-trash junk: {emailAutoTrashJunk && emailDeleteEnabled ? "enabled" : "disabled"}
        </Text>
      </View>

      <TouchableOpacity onPress={handleSave} style={{ marginTop: 24, alignItems: "center" }}>
        <Text style={{ color: theme.colors.gray, fontSize: 13, fontWeight: "600" }}>
          Save settings on this device
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

export default EmailIntegrationSection;
