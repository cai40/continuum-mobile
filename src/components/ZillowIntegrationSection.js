import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { theme } from '../styles/theme';
import { useAppContext } from '../context/AppContext';
import { syncZillowEmails, fetchZillowState } from '../services/apiService';
import { resolveRenderEmailBridgeSecret } from '../utils/emailBridge';

const STORAGE_KEY = '@continuum_zillow_properties_v1';

function defaultProperty() {
  return { id: `p${Date.now()}`, address: '', rent: '', beds: '', baths: '', available: '', notes: '' };
}

const ZillowIntegrationSection = ({ onBack }) => {
  const { renderEmailBridgeSecret } = useAppContext();
  const bridgeSecret = resolveRenderEmailBridgeSecret(renderEmailBridgeSecret);

  const [properties, setProperties] = useState([]);
  const [editing, setEditing] = useState(null); // property object being edited (null = not editing)
  const [form, setForm] = useState(defaultProperty());
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [ingestedCount, setIngestedCount] = useState(null);

  const load = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      setProperties(raw ? JSON.parse(raw) : []);
    } catch (err) {
      console.warn('[zillow] load:', err?.message);
    }
  }, []);

  useEffect(() => { load().catch(() => {}); }, [load]);

  useEffect(() => {
    if (!bridgeSecret) return;
    fetchZillowState(bridgeSecret)
      .then((s) => setIngestedCount(s.ingestedCount ?? null))
      .catch(() => {});
  }, [bridgeSecret]);

  const save = async (next) => {
    setProperties(next);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (err) {
      console.warn('[zillow] save:', err?.message);
    }
  };

  const addOrUpdate = () => {
    if (!form.address.trim()) {
      Alert.alert('Address required', 'Enter a street address for the property.');
      return;
    }
    if (editing) {
      const next = properties.map((p) => (p.id === editing.id ? { ...form, id: editing.id } : p));
      save(next);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Updated', `${form.address} saved.`);
    } else {
      const next = [...properties, { ...form, id: `p${Date.now()}` }];
      save(next);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Added', `${form.address} added to your portfolio.`);
    }
    setEditing(null);
    setForm(defaultProperty());
  };

  const startEdit = (p) => {
    setEditing(p);
    setForm({ ...p });
  };

  const removeProperty = (p) => {
    Alert.alert('Remove property?', `Remove ${p.address || 'this property'} from your portfolio?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          save(properties.filter((x) => x.id !== p.id));
          if (editing?.id === p.id) {
            setEditing(null);
            setForm(defaultProperty());
          }
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        },
      },
    ]);
  };

  const runSync = async (dryRun = false) => {
    if (!bridgeSecret) {
      Alert.alert('Bridge not configured', 'Set your Render email bridge secret in Setup → Email & Bridge first.');
      return;
    }
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await syncZillowEmails(bridgeSecret, { dryRun });
      setSyncResult(res);
      if (dryRun) {
        Alert.alert(
          'Zillow emails found',
          `${res.matched ?? 0} Zillow email(s) matched, ${res.ingested ?? 0} new.`,
        );
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert(
          'Zillow sync complete',
          `Found ${res.matched ?? 0} email(s); ingested ${res.ingested ?? 0} new event(s) into memory.`,
        );
        if (res.ingestedCount != null) setIngestedCount(res.ingestedCount);
      }
    } catch (err) {
      Alert.alert('Zillow sync failed', err?.message || 'Could not reach the email bridge.');
    } finally {
      setSyncing(false);
    }
  };

  const inputStyle = {
    backgroundColor: theme.colors.white,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: theme.colors.black,
    marginBottom: 10,
  };
  const labelStyle = { fontSize: 11, fontWeight: '700', color: theme.colors.gray, marginBottom: 6, marginTop: 4 };
  const buttonStyle = { borderRadius: 12, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: 20, paddingBottom: 120 }}
      keyboardShouldPersistTaps="handled"
    >
      <TouchableOpacity onPress={onBack} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 18 }}>
        <Ionicons name="arrow-back" size={22} color={theme.colors.primary} />
        <Text style={{ marginLeft: 8, color: theme.colors.primary, fontWeight: '700' }}>Setup</Text>
      </TouchableOpacity>

      <Text style={{ fontSize: 22, fontWeight: '800', color: theme.colors.black, marginBottom: 6 }}>
        Zillow Rental Manager
      </Text>
      <Text style={{ fontSize: 13, color: theme.colors.gray, lineHeight: 19, marginBottom: 18 }}>
        Zillow has no public API for landlords, so Continuum tracks your portfolio two ways: keep your
        properties listed here, and let Continuum read Zillow Rental Manager emails from your Yahoo
        inbox to auto-capture applications, screening, leases, and payments into memory.
      </Text>

      {/* Sync card */}
      <View style={{
        backgroundColor: theme.colors.white,
        borderRadius: 14,
        padding: 14,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Ionicons name="mail-outline" size={20} color={theme.colors.primary} />
          <Text style={{ fontWeight: '800', color: theme.colors.black, marginLeft: 8 }}>Email feed</Text>
        </View>
        <Text style={{ fontSize: 12, color: theme.colors.gray, marginTop: 8, lineHeight: 18 }}>
          Reads Zillow Rental Manager emails from your inbox and stores the facts in memory.
          {ingestedCount != null ? ` ${ingestedCount} event(s) ingested so far.` : ''}
        </Text>
        <TouchableOpacity
          onPress={() => runSync(false)}
          disabled={syncing}
          style={[buttonStyle, { backgroundColor: theme.colors.primary, marginTop: 12 }]}
        >
          {syncing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={{ color: '#fff', fontWeight: '800' }}>Sync Zillow emails now</Text>
          )}
        </TouchableOpacity>
        {syncResult ? (
          <Text style={{ fontSize: 12, color: theme.colors.gray, marginTop: 8 }}>
            Last sync: {syncResult.matched ?? 0} found · {syncResult.ingested ?? 0} new ingested
          </Text>
        ) : null}
      </View>

      {/* Portfolio list */}
      <Text style={{ fontSize: 11, fontWeight: '800', color: theme.colors.gray, letterSpacing: 1, marginBottom: 8 }}>
        MY PROPERTIES ({properties.length})
      </Text>
      {properties.length === 0 ? (
        <Text style={{ fontSize: 13, color: theme.colors.gray, marginBottom: 12 }}>
          No properties yet. Add your first listing below.
        </Text>
      ) : properties.map((p) => (
        <View key={p.id} style={{
          backgroundColor: theme.colors.white,
          borderRadius: 12,
          padding: 12,
          marginBottom: 8,
          borderWidth: 1,
          borderColor: theme.colors.border,
        }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Ionicons name="business-outline" size={18} color={theme.colors.primary} />
            <Text style={{ flex: 1, fontWeight: '700', color: theme.colors.black, marginLeft: 8 }}>
              {p.address}
            </Text>
            <TouchableOpacity onPress={() => startEdit(p)} hitSlop={10} style={{ padding: 6 }}>
              <Ionicons name="create-outline" size={18} color={theme.colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => removeProperty(p)} hitSlop={10} style={{ padding: 6 }}>
              <Ionicons name="trash-outline" size={18} color={theme.colors.danger} />
            </TouchableOpacity>
          </View>
          <Text style={{ fontSize: 12, color: theme.colors.gray, marginTop: 4 }}>
            {[p.rent ? `$${p.rent}/mo` : null, p.beds ? `${p.beds} bd` : null, p.baths ? `${p.baths} ba` : null, p.available ? `avail ${p.available}` : null].filter(Boolean).join(' · ') || 'No details yet'}
          </Text>
          {p.notes ? <Text numberOfLines={2} style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 4 }}>{p.notes}</Text> : null}
        </View>
      ))}

      {/* Add / edit form */}
      <Text style={{ fontSize: 11, fontWeight: '800', color: theme.colors.gray, letterSpacing: 1, marginTop: 8, marginBottom: 8 }}>
        {editing ? 'EDIT PROPERTY' : 'ADD PROPERTY'}
      </Text>
      <Text style={labelStyle}>Address *</Text>
      <TextInput
        value={form.address}
        onChangeText={(v) => setForm((f) => ({ ...f, address: v }))}
        placeholder="123 Main St, Boston MA"
        placeholderTextColor={theme.colors.gray}
        style={inputStyle}
      />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={labelStyle}>Rent / mo</Text>
          <TextInput
            value={form.rent}
            onChangeText={(v) => setForm((f) => ({ ...f, rent: v }))}
            placeholder="2500"
            placeholderTextColor={theme.colors.gray}
            keyboardType="numeric"
            style={inputStyle}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={labelStyle}>Beds</Text>
          <TextInput
            value={form.beds}
            onChangeText={(v) => setForm((f) => ({ ...f, beds: v }))}
            placeholder="3"
            placeholderTextColor={theme.colors.gray}
            keyboardType="numeric"
            style={inputStyle}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={labelStyle}>Baths</Text>
          <TextInput
            value={form.baths}
            onChangeText={(v) => setForm((f) => ({ ...f, baths: v }))}
            placeholder="2"
            placeholderTextColor={theme.colors.gray}
            keyboardType="numeric"
            style={inputStyle}
          />
        </View>
      </View>
      <Text style={labelStyle}>Available</Text>
      <TextInput
        value={form.available}
        onChangeText={(v) => setForm((f) => ({ ...f, available: v }))}
        placeholder="2026-09-01"
        placeholderTextColor={theme.colors.gray}
        style={inputStyle}
      />
      <Text style={labelStyle}>Notes</Text>
      <TextInput
        value={form.notes}
        onChangeText={(v) => setForm((f) => ({ ...f, notes: v }))}
        placeholder="Tenant, lease end date, quirks…"
        placeholderTextColor={theme.colors.gray}
        style={[inputStyle, { minHeight: 60, textAlignVertical: 'top' }]}
        multiline
      />
      <TouchableOpacity
        onPress={addOrUpdate}
        style={[buttonStyle, { backgroundColor: theme.colors.primary }]}
      >
        <Text style={{ color: '#fff', fontWeight: '800' }}>{editing ? 'Save changes' : 'Add property'}</Text>
      </TouchableOpacity>
      {editing ? (
        <TouchableOpacity
          onPress={() => { setEditing(null); setForm(defaultProperty()); }}
          style={[buttonStyle, { backgroundColor: theme.colors.light, marginTop: 8 }]}
        >
          <Text style={{ color: theme.colors.gray, fontWeight: '700' }}>Cancel</Text>
        </TouchableOpacity>
      ) : null}

      <Text style={{ fontSize: 11, color: theme.colors.gray, marginTop: 18, lineHeight: 16 }}>
        Your properties are stored on this device. The email feed uses your configured Render email bridge
        to search your inbox for Zillow Rental Manager messages.
      </Text>
    </ScrollView>
  );
};

export default ZillowIntegrationSection;
