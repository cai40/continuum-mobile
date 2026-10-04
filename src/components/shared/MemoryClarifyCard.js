import React, { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { theme } from '../../styles/theme';

/**
 * The chat card for a contradiction the app refuses to guess about.
 *
 * The user picks the claim that is true, or types the correct version instead, and then says what
 * to do with each memory being rejected — archive (recoverable) or delete (permanent). That choice
 * is per memory on purpose: only the user knows whether a memory was merely stale or never true,
 * and a blanket policy would permanently destroy the first kind.
 */
export default function MemoryClarifyCard({ offer, onResolve, onDismiss, result }) {
  const claims = Array.isArray(offer?.claims) ? offer.claims : [];
  const [choice, setChoice] = useState(null); // a claim id, or 'other'
  const [customText, setCustomText] = useState('');
  const [dispositions, setDispositions] = useState({}); // id -> 'archive' | 'delete'
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!claims.length) return null;

  const usingTyped = choice === 'other';
  const chosenId = usingTyped ? null : choice;
  const dispositionOf = (id) => dispositions[String(id)] || 'archive';
  const canSubmit = !busy && (usingTyped ? customText.trim().length > 0 : !!chosenId);

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError('');
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      // Everything NOT chosen is rejected; when the user typed the truth, that is every claim.
      const rejected = claims
        .filter((c) => String(c.id) !== String(chosenId))
        .map((c) => ({ id: c.id, disposition: dispositionOf(c.id) }));
      await onResolve({
        signature: offer.signature,
        correct_id: chosenId,
        correct_text: usingTyped ? customText.trim() : '',
        rejected,
      });
    } catch (e) {
      setError(e?.message || 'Could not save that.');
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    const kept = result.applied?.wrote?.content
      || result.correctText
      || claims.find((c) => String(c.id) === String(result.correctId))?.content
      || 'the version you gave';
    const archived = (result.applied?.archived || []).length;
    const deleted = (result.applied?.deleted || []).length;
    return (
      <View style={card}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Ionicons name="checkmark-circle" size={16} color={theme.colors.success || '#15803d'} />
          <Text style={{ marginLeft: 6, fontSize: 12, fontWeight: '700', color: theme.colors.success || '#15803d' }}>
            Got it — I'll use that
          </Text>
        </View>
        <Text style={{ fontSize: 11, color: theme.colors.gray, marginTop: 6, lineHeight: 16 }}>
          Kept: {kept}
          {archived ? ` · ${archived} archived` : ''}
          {deleted ? ` · ${deleted} deleted` : ''}
        </Text>
      </View>
    );
  }

  return (
    <View style={card}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Ionicons name="git-compare-outline" size={15} color={theme.colors.primary} />
        <Text style={{ marginLeft: 6, fontSize: 10, fontWeight: '800', color: theme.colors.primary, letterSpacing: 0.4 }}>
          ONE THING TO CLEAR UP
        </Text>
      </View>
      <Text style={{ fontSize: 12, color: theme.colors.black, marginTop: 6, lineHeight: 17 }}>
        {offer.question || 'Two of my memories disagree. Which is right?'}
      </Text>

      {claims.map((c) => {
        const selected = String(chosenId) === String(c.id);
        return (
          <View key={String(c.id)} style={{ marginTop: 10 }}>
            <TouchableOpacity
              onPress={() => {
                Haptics.selectionAsync();
                setChoice(c.id);
              }}
              activeOpacity={0.8}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                borderWidth: 1,
                borderColor: selected ? theme.colors.primary : theme.colors.border,
                backgroundColor: selected ? `${theme.colors.primary}10` : 'transparent',
                borderRadius: 9,
                padding: 10,
              }}
            >
              <Ionicons
                name={selected ? 'radio-button-on' : 'radio-button-off'}
                size={16}
                color={selected ? theme.colors.primary : theme.colors.gray}
                style={{ marginTop: 1 }}
              />
              <Text style={{ flex: 1, marginLeft: 8, fontSize: 12, color: theme.colors.black, lineHeight: 17 }}>
                {c.content}
              </Text>
            </TouchableOpacity>
            {selected ? null : (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, marginLeft: 24 }}>
                <Text style={{ fontSize: 9, color: theme.colors.gray, marginRight: 8 }}>IF THIS IS WRONG:</Text>
                {['archive', 'delete'].map((d) => {
                  const on = dispositionOf(c.id) === d;
                  const tint = d === 'delete' ? (theme.colors.danger || '#dc2626') : theme.colors.primary;
                  return (
                    <TouchableOpacity
                      key={d}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setDispositions((prev) => ({ ...prev, [String(c.id)]: d }));
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      style={{
                        paddingHorizontal: 9,
                        paddingVertical: 4,
                        borderRadius: 6,
                        marginRight: 6,
                        backgroundColor: on ? tint : `${theme.colors.border}66`,
                      }}
                    >
                      <Text style={{ fontSize: 9, fontWeight: '700', color: on ? '#fff' : theme.colors.black }}>
                        {d === 'delete' ? 'Delete' : 'Archive'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        );
      })}

      <TouchableOpacity
        onPress={() => {
          Haptics.selectionAsync();
          setChoice('other');
        }}
        activeOpacity={0.8}
        accessibilityRole="radio"
        accessibilityState={{ selected: usingTyped }}
        style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}
      >
        <Ionicons
          name={usingTyped ? 'radio-button-on' : 'radio-button-off'}
          size={16}
          color={usingTyped ? theme.colors.primary : theme.colors.gray}
        />
        <Text style={{ marginLeft: 8, fontSize: 11, color: theme.colors.black, fontWeight: '600' }}>
          Neither — let me type the correct version
        </Text>
      </TouchableOpacity>

      {usingTyped ? (
        <TextInput
          value={customText}
          onChangeText={setCustomText}
          placeholder="Type what's actually true…"
          placeholderTextColor={theme.colors.gray}
          multiline
          accessibilityLabel="Corrected memory"
          style={{
            marginTop: 8,
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: 9,
            padding: 10,
            fontSize: 12,
            color: theme.colors.black,
            minHeight: 54,
            textAlignVertical: 'top',
          }}
        />
      ) : null}

      {error ? (
        <Text style={{ color: theme.colors.danger || '#dc2626', fontSize: 10, marginTop: 8 }}>{error}</Text>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
        <TouchableOpacity
          onPress={submit}
          disabled={!canSubmit}
          accessibilityRole="button"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: canSubmit ? theme.colors.primary : theme.colors.border,
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 8,
          }}
        >
          {busy ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="checkmark" size={14} color="#fff" />
          )}
          <Text style={{ marginLeft: 6, fontSize: 11, fontWeight: '800', color: '#fff' }}>
            {usingTyped ? 'Save correction' : 'Use this one'}
          </Text>
        </TouchableOpacity>
        {onDismiss ? (
          <TouchableOpacity onPress={onDismiss} accessibilityRole="button" style={{ marginLeft: 12 }}>
            <Text style={{ fontSize: 11, color: theme.colors.gray, fontWeight: '600' }}>Not now</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <Text style={{ fontSize: 9, color: theme.colors.gray, marginTop: 8, lineHeight: 13 }}>
        Archive hides a memory from chat but keeps it recoverable. Delete removes it from the database.
      </Text>
    </View>
  );
}

const card = {
  marginTop: 10,
  padding: 12,
  borderRadius: 12,
  borderWidth: 1,
  borderColor: `${theme.colors.primary}40`,
  backgroundColor: theme.colors.white,
};
