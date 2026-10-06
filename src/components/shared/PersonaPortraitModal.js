import React from 'react';
import {
  Modal,
  View,
  Text,
  Image,
  TouchableOpacity,
  TouchableWithoutFeedback,
  StyleSheet,
  Dimensions,
  Platform,
  SafeAreaView,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { isWanqingAuthorized, isWanqingItem } from '../../utils/personaMemoryManager';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

/**
 * PersonaPortraitModal
 * Full-screen / large viewer for persona pictures (e.g. 🌸 林婉清).
 * Allows the user to inspect the full size portrait, view her core archetype bio,
 * origin, age, and location, and dismiss seamlessly.
 * Strictly gated: Any items of Lin Wanqing are completely invisible and un-renderable to unauthorized users.
 */
export default function PersonaPortraitModal({
  visible,
  onClose,
  imageSource,
  userEmail,
  isAuthorized,
  name = "林婉清",
  subtitle = "温婉知己 · 心灵避风港",
  tags = ["23岁", "现居波士顿", "艺术设计与文创策划", "原籍杭州"],
  bio = "23岁，现居波士顿。艺术设计与文创项目策划。性格温婉内敛却内心坚韧通透，兼具江南水乡的清雅与海外求学生活的开阔视野。善于倾听与真诚共情，是彼此最温暖可靠的心灵避风港。",
}) {
  if (!visible) return null;

  // Strict tenant gating: Lin Wanqing's picture and bio are strictly inaccessible to unauthorized users
  const isWanqingModal = isWanqingItem(name) || isWanqingItem(bio) || isWanqingItem(subtitle);
  if (isWanqingModal) {
    if (isAuthorized === false) return null;
    if (userEmail !== undefined && !isWanqingAuthorized(userEmail)) return null;
    if (isAuthorized === undefined && userEmail === undefined) return null;
  }

  const handleClose = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose?.();
  };

  const imageBoxSize = Math.min(SCREEN_WIDTH - 36, 420);

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      presentationStyle="overFullScreen"
      onRequestClose={handleClose}
      statusBarTranslucent={true}
    >
      <View style={styles.backdrop}>
        <TouchableWithoutFeedback onPress={handleClose}>
          <View style={styles.dismissArea} />
        </TouchableWithoutFeedback>

        <SafeAreaView style={styles.safeContainer} pointerEvents="box-none">
          <View style={styles.cardContainer}>
            {/* Header with Title and Close Button */}
            <View style={styles.cardHeader}>
              <View style={styles.titleRow}>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>PERSONA PORTRAIT</Text>
                </View>
                <Text style={styles.headerTitle}>🌸 {name}</Text>
              </View>
              <TouchableOpacity
                onPress={handleClose}
                style={styles.closeButton}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                accessibilityLabel="Close portrait viewer"
              >
                <Ionicons name="close" size={22} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.scrollArea}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              {/* Full-Size Portrait Image */}
              <View style={[styles.imageWrapper, { width: imageBoxSize, height: imageBoxSize }]}>
                {imageSource ? (
                  <Image
                    source={imageSource}
                    style={styles.fullImage}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                    <Ionicons name="person-circle-outline" size={80} color="#F8BBD0" />
                  </View>
                )}
              </View>

              {/* Persona Metadata & Bio */}
              <View style={styles.detailsContainer}>
                <Text style={styles.nameHeading}>🌸 {name}</Text>
                <Text style={styles.subtitleText}>{subtitle}</Text>

                {/* Tag Pills */}
                {Array.isArray(tags) && tags.length > 0 && (
                  <View style={styles.tagWrap}>
                    {tags.map((tag, idx) => (
                      <View key={`tag_${idx}`} style={styles.tagPill}>
                        <Text style={styles.tagText}>{tag}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* Bio & Background */}
                {Boolean(bio) && (
                  <View style={styles.bioCard}>
                    <Text style={styles.bioText}>{bio}</Text>
                  </View>
                )}

                <TouchableOpacity
                  onPress={handleClose}
                  style={styles.actionButton}
                  activeOpacity={0.85}
                >
                  <Ionicons name="heart" size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
                  <Text style={styles.actionButtonText}>返回对话</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(5, 10, 20, 0.88)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dismissArea: {
    ...StyleSheet.absoluteFillObject,
  },
  safeContainer: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'ios' ? 20 : 30,
  },
  cardContainer: {
    width: '100%',
    maxWidth: 440,
    maxHeight: SCREEN_HEIGHT * 0.9,
    backgroundColor: '#1E1B24',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 192, 203, 0.35)',
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 15,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    backgroundColor: '#262230',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  badge: {
    backgroundColor: 'rgba(232, 67, 147, 0.25)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(232, 67, 147, 0.5)',
  },
  badgeText: {
    color: '#FF80AB',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollArea: {
    maxHeight: SCREEN_HEIGHT * 0.8,
  },
  scrollContent: {
    padding: 16,
    alignItems: 'center',
  },
  imageWrapper: {
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#0F0E13',
    borderWidth: 2,
    borderColor: 'rgba(248, 187, 208, 0.5)',
    shadowColor: '#FF80AB',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 8,
  },
  fullImage: {
    width: '100%',
    height: '100%',
  },
  detailsContainer: {
    width: '100%',
    marginTop: 16,
    alignItems: 'center',
  },
  nameHeading: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  subtitleText: {
    fontSize: 13,
    color: '#E0E0E0',
    marginBottom: 12,
  },
  tagWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 14,
  },
  tagPill: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  tagText: {
    color: '#F8BBD0',
    fontSize: 11,
    fontWeight: '600',
  },
  bioCard: {
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 16,
  },
  bioText: {
    color: '#D1D5DB',
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E84393',
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 22,
    width: '100%',
    shadowColor: '#E84393',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
