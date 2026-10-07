import React from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  Image,
  StyleSheet,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { theme } from '../../styles/theme';
import { getVisiblePersonaPresets } from '../../constants/personaPresets';
import { WANQING_HEADSHOT } from '../../utils/personaAssets';
import { isWanqingAuthorized } from '../../utils/personaMemoryManager';

export default function ConversationListModal({
  visible,
  onClose,
  activePersonaId,
  onSelectPersona,
  userEmail,
  allPersonaConversations = {},
  onOpenSettings,
}) {
  const isOwner = isWanqingAuthorized(userEmail);
  const presets = getVisiblePersonaPresets(userEmail);

  const formatTimestamp = (ts) => {
    if (!ts) return '';
    try {
      const d = new Date(ts);
      const now = new Date();
      const isToday = d.toDateString() === now.toDateString();
      if (isToday) {
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={onClose}
        />
        <View style={styles.sheetContainer}>
          {/* DRAG HANDLE */}
          <View style={styles.dragHandle} />

          {/* HEADER */}
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="chatbubbles" size={22} color={theme.colors.primary} style={{ marginRight: 8 }} />
                <Text style={styles.headerTitle}>Conversations</Text>
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>{presets.length}</Text>
                </View>
              </View>
              <Text style={styles.headerSubtitle}>
                Separate chat histories with dedicated personas
              </Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={styles.closeButton}
            >
              <Ionicons name="close" size={20} color={theme.colors.gray} />
            </TouchableOpacity>
          </View>

          {/* CONVERSATION LIST */}
          <ScrollView
            style={{ maxHeight: 460 }}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 20 }}
          >
            {presets.map((p, idx) => {
              const isActive = p.id === activePersonaId;
              const conv = allPersonaConversations[p.id];
              const lastSnippet = conv?.lastMessage || p.emptyGreeting || p.desc;
              const lastTime = formatTimestamp(conv?.timestamp);
              const msgCount = conv?.count || 0;

              return (
                <TouchableOpacity
                  key={p.id}
                  activeOpacity={0.7}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    onSelectPersona(p.id);
                    onClose();
                  }}
                  style={[
                    styles.convCard,
                    isActive && styles.activeConvCard,
                  ]}
                >
                  {/* AVATAR */}
                  <View style={styles.avatarWrapper}>
                    {p.id === 'wanqing' && isOwner && WANQING_HEADSHOT ? (
                      <Image
                        source={WANQING_HEADSHOT}
                        style={[styles.avatarImage, { borderColor: p.borderColor || '#F8BBD0' }]}
                      />
                    ) : (
                      <View
                        style={[
                          styles.avatarIconPlaceholder,
                          {
                            backgroundColor: p.bgColor || '#EFF6FF',
                            borderColor: p.borderColor || '#BFDBFE',
                          },
                        ]}
                      >
                        <Ionicons
                          name={p.icon || 'chatbubble-ellipses-outline'}
                          size={22}
                          color={p.badgeColor || theme.colors.primary}
                        />
                      </View>
                    )}
                    <View
                      style={[
                        styles.onlineDot,
                        { backgroundColor: isActive ? '#10B981' : '#34D399' },
                      ]}
                    />
                  </View>

                  {/* DETAILS */}
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <View style={styles.nameRow}>
                      <Text
                        style={[
                          styles.convName,
                          isActive && { color: p.badgeColor || theme.colors.primary },
                        ]}
                        numberOfLines={1}
                      >
                        {p.name}
                      </Text>
                      {lastTime ? (
                        <Text style={styles.convTime}>{lastTime}</Text>
                      ) : (
                        <Text style={[styles.convTime, { color: '#10B981', fontWeight: '700' }]}>
                          Online
                        </Text>
                      )}
                    </View>

                    <Text
                      style={[
                        styles.convSnippet,
                        isActive && { color: theme.colors.black },
                      ]}
                      numberOfLines={2}
                    >
                      {lastSnippet}
                    </Text>

                    <View style={styles.tagRow}>
                      <View
                        style={[
                          styles.roleTag,
                          {
                            backgroundColor: (p.badgeColor || theme.colors.primary) + '15',
                            borderColor: (p.badgeColor || theme.colors.primary) + '30',
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.roleTagText,
                            { color: p.badgeColor || theme.colors.primary },
                          ]}
                        >
                          {p.shortName}
                        </Text>
                      </View>
                      {msgCount > 0 && (
                        <Text style={styles.msgCountText}>
                          {msgCount} message{msgCount > 1 ? 's' : ''}
                        </Text>
                      )}
                    </View>
                  </View>

                  {/* ACTIVE INDICATOR */}
                  {isActive ? (
                    <View
                      style={[
                        styles.activeCheckmark,
                        { backgroundColor: p.badgeColor || theme.colors.primary },
                      ]}
                    >
                      <Ionicons name="checkmark" size={14} color="#fff" />
                    </View>
                  ) : (
                    <Ionicons name="chevron-forward" size={16} color="#CBD5E1" />
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* FOOTER */}
          <View style={styles.footerRow}>
            <Text style={styles.footerTip}>
              Each conversation retains its own private chat window.
            </Text>
            {onOpenSettings && (
              <TouchableOpacity
                onPress={() => {
                  onClose();
                  onOpenSettings();
                }}
                style={styles.settingsLink}
              >
                <Ionicons name="settings-outline" size={13} color={theme.colors.primary} style={{ marginRight: 4 }} />
                <Text style={styles.settingsLinkText}>Persona Setup</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheetContainer: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 10,
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 20,
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E2E8F0',
    alignSelf: 'center',
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    marginBottom: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  countBadge: {
    backgroundColor: theme.colors.primary + '18',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
    marginLeft: 8,
  },
  countBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: theme.colors.primary,
  },
  headerSubtitle: {
    fontSize: 12,
    color: theme.colors.gray,
    marginTop: 2,
  },
  closeButton: {
    padding: 6,
    borderRadius: 16,
    backgroundColor: '#F8FAFC',
  },
  convCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    marginBottom: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  activeConvCard: {
    backgroundColor: '#F0F9FF',
    borderColor: '#BAE6FD',
    borderWidth: 1.5,
  },
  avatarWrapper: {
    position: 'relative',
    marginRight: 12,
  },
  avatarImage: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1.5,
    backgroundColor: '#FFF0F5',
  },
  avatarIconPlaceholder: {
    width: 46,
    height: 46,
    borderRadius: 23,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  onlineDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  nameRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 3,
  },
  convName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  convTime: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '500',
  },
  convSnippet: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 17,
    marginBottom: 6,
  },
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  roleTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 0.5,
    marginRight: 8,
  },
  roleTagText: {
    fontSize: 10,
    fontWeight: '700',
  },
  msgCountText: {
    fontSize: 10,
    color: '#94A3B8',
  },
  activeCheckmark: {
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  footerTip: {
    fontSize: 11,
    color: '#94A3B8',
    flex: 1,
  },
  settingsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: theme.colors.primary + '10',
  },
  settingsLinkText: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.colors.primary,
  },
});
