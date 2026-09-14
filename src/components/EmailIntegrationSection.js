import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  Switch,
  ActivityIndicator,
} from "react-native";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { useAppContext } from "../context/AppContext";
import { testRenderEmailHealth, fetchDailyCleanupLatest, runDailyCleanupNow, fetchDailyCleanupProgress } from "../services/apiService";
import {
  RENDER_EMAIL_BRIDGE_URL,
  DEFAULT_EMAIL_LIMIT,
  DEFAULT_EMAIL_RECENT,
  MAX_EMAIL_LIMIT,
  DAILY_CLEANUP_SCAN_LIMIT,
} from "../constants/Config";
import { resolveRenderEmailBridgeSecret } from "../utils/emailBridge";
import { clampEmailLimit, normalizeEmailRecent } from "../utils/emailOptions";
import { styles, theme } from "../styles/theme";

/** Elapsed time for an in-flight cleanup, e.g. "1m 05s". */
function formatElapsed(ms) {
  const total = Math.max(0, Math.floor((ms || 0) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes ? `${minutes}m ${String(seconds).padStart(2, "0")}s` : `${seconds}s`;
}

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
  const [cleanupProgress, setCleanupProgress] = useState(null);
  const progressTimerRef = useRef(null);

  const stopProgressPolling = useCallback(() => {
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  }, []);

  useEffect(() => stopProgressPolling, [stopProgressPolling]);

  const effectiveRenderSecret = resolveRenderEmailBridgeSecret(renderEmailBridgeSecret);

  const loadDailyCleanup = useCallback(async () => {
    if (!renderEmailEnabled) return;
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
    if (!emailDeleteEnabled) {
      Alert.alert("Allow move to Trash", "Turn on Allow move to Trash below before daily cleanup can run.");
      return;
    }
    setRunningDailyCleanup(true);
    setCleanupProgress({ stage: "Starting cleanup…", elapsed_ms: 0 });
    stopProgressPolling();
    let pollInFlight = false;
    progressTimerRef.current = setInterval(async () => {
      if (pollInFlight) return;
      pollInFlight = true;
      try {
        const { progress } = await fetchDailyCleanupProgress(effectiveRenderSecret);
        if (progress?.running) {
          setCleanupProgress({ stage: progress.stage, elapsed_ms: progress.elapsed_ms });
        }
      } catch {
        // Keep the last known stage — the run POST owns the final outcome.
      } finally {
        pollInFlight = false;
      }
    }, 2500);
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
      stopProgressPolling();
      setRunningDailyCleanup(false);
      setCleanupProgress(null);
    }
  };

  const handleTestRenderEmail = async () => {
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
        `${e.message || String(e)}\n\nCheck that CONTINUUM_EMAIL_BRIDGE_SECRET on the backend matches BRIDGE_SECRET on continuum-email-bridge.`,
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
        Yahoo email via Continuum on Render. Powers the Email tab, Zillow feed,
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

      <Text style={[styles.categoryTitle, { marginTop: 16 }]}>RENDER EMAIL BRIDGE SECRET (OPTIONAL)</Text>
      <View style={styles.groupedCard}>
        <TextInput
          style={[styles.keyInput, { borderWidth: 0 }]}
          value={renderEmailBridgeSecret}
          onChangeText={setRenderEmailBridgeSecret}
          placeholder="Leave blank — backend holds the secret"
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          secureTextEntry
        />
      </View>
      <Text style={{ fontSize: 11, color: theme.colors.gray, marginTop: 8, lineHeight: 16 }}>
        Optional. The backend forwards BRIDGE_SECRET from its own environment, so leave this
        blank. Set it only to bypass the backend and call the bridge directly.
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
          Scans the last 24 hours each day, trashes newsletters/promos (up to {DAILY_CLEANUP_SCAN_LIMIT}/run), and saves a report you can view here or ask in chat: “daily cleanup summary”.
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
        {runningDailyCleanup ? (
          <View style={{ marginTop: 12, padding: 12, backgroundColor: theme.colors.light, borderRadius: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <ActivityIndicator size="small" color={theme.colors.primary} />
              <Text style={{ fontSize: 12, fontWeight: "700", color: theme.colors.black, marginLeft: 8 }}>
                {formatElapsed(cleanupProgress?.elapsed_ms)} elapsed
              </Text>
            </View>
            <Text style={{ fontSize: 12, color: theme.colors.black, marginTop: 8 }}>
              {cleanupProgress?.stage || "Starting cleanup…"}
            </Text>
            <Text style={{ fontSize: 11, color: theme.colors.gray, marginTop: 6, lineHeight: 15 }}>
              Scanning up to {DAILY_CLEANUP_SCAN_LIMIT} emails. Large scans can take 5–15 minutes — you can leave this
              screen, the cleanup keeps running.
            </Text>
          </View>
        ) : null}
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
        <Text style={{ fontSize: 12, color: theme.colors.success, marginTop: 4 }}>
          ✓ Email secret held by backend{effectiveRenderSecret ? " (device override set)" : ""}
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
