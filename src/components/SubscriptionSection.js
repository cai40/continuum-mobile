import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator, Platform, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as IAP from 'react-native-iap';
import { theme } from '../styles/theme';
import { useAppContext } from '../context/AppContext';

const itemSkus = Platform.select({
  ios: ['com.continuum.pro.monthly', 'com.continuum.elite.monthly'],
  android: ['com.continuum.pro.monthly', 'com.continuum.elite.monthly'],
});

// Apple's subscription management URL
const APPLE_SUBSCRIPTION_URL = 'itms-apps://apps.apple.com/account/subscriptions';

const SubscriptionSection = ({ onBack }) => {
  const { subscriptionTier, setSubscriptionTier, isSuperUser } = useAppContext();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const initIAP = async () => {
      try {
        await IAP.initConnection();
      } catch (err) {
        console.warn('IAP Init Error:', err);
      }
    };
    initIAP();
    return () => { IAP.endConnection(); };
  }, []);

  // ─── Subscribe ────────────────────────────────────────────────────────────────
  const handleSubscribe = async (sku, tier) => {
    if (isSuperUser) {
      Alert.alert('Super User', 'You already have full Elite access for life.');
      return;
    }
    setLoading(true);
    try {
      console.log(`Requesting purchase for ${sku}`);
      // await IAP.requestPurchase({ sku }); // Uncomment when IAP is live
      setTimeout(() => {
        setSubscriptionTier(tier);
        setLoading(false);
        Alert.alert('Success! 🎉', `Welcome to Continuum ${tier.toUpperCase()}!\n\nYour 30-day free trial has started.`);
      }, 1500);
    } catch (err) {
      Alert.alert('Purchase Error', err.message);
      setLoading(false);
    }
  };

  // ─── Downgrade to Free ────────────────────────────────────────────────────────
  const handleDowngrade = () => {
    if (subscriptionTier === 'free') {
      Alert.alert('Already on Free', 'You are already on the Free plan.');
      return;
    }
    Alert.alert(
      'Downgrade to Free?',
      'You will immediately lose access to Pro/Elite features. Your memories will be preserved, but L5 Global RAG and Voice Mode will be locked.\n\nThis does NOT cancel your Apple subscription — you must do that separately.',
      [
        { text: 'Keep My Plan', style: 'cancel' },
        {
          text: 'Downgrade to Free',
          style: 'destructive',
          onPress: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            setSubscriptionTier('free');
            Alert.alert('Downgraded', 'You are now on the Free plan. To stop future billing, cancel your Apple subscription below.');
          },
        },
      ]
    );
  };

  // ─── Cancel via Apple ─────────────────────────────────────────────────────────
  const handleCancelSubscription = () => {
    Alert.alert(
      'Cancel Subscription',
      'Apple requires all subscription cancellations to be done through the App Store. Tap "Open Settings" to manage your subscriptions.',
      [
        { text: 'Not Now', style: 'cancel' },
        {
          text: 'Open App Store',
          onPress: () => Linking.openURL(APPLE_SUBSCRIPTION_URL).catch(() =>
            Alert.alert('Error', 'Could not open App Store. Go to: Settings → Apple ID → Subscriptions → Continuum.')
          ),
        },
      ]
    );
  };

  // ─── Restore Purchases ────────────────────────────────────────────────────────
  const handleRestore = async () => {
    setLoading(true);
    try {
      await IAP.getAvailablePurchases();
      Alert.alert('Restored', 'Your purchases have been restored.');
    } catch (err) {
      Alert.alert('Restore Failed', 'Could not restore purchases. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // ─── Tier Card ────────────────────────────────────────────────────────────────
  const TierCard = ({ title, price, features, tier, icon, color, isPopular }) => {
    const isCurrent = subscriptionTier === tier;
    return (
      <View style={[styles.card, isCurrent && styles.activeCard]}>
        {isPopular && <View style={styles.popularBadge}><Text style={styles.popularText}>MOST POPULAR</Text></View>}
        <View style={[styles.iconCircle, { backgroundColor: color + '20' }]}>
          <Ionicons name={icon} size={32} color={color} />
        </View>
        <Text style={styles.tierTitle}>{title}</Text>
        <Text style={styles.tierPrice}>
          {price}<Text style={styles.pricePeriod}>{price === '$0' ? '' : '/mo'}</Text>
        </Text>
        {price !== '$0' && <Text style={styles.trialText}>Includes 30-Day Free Trial</Text>}

        <View style={styles.featureList}>
          {features.map((f, i) => (
            <View key={i} style={styles.featureItem}>
              <Ionicons name="checkmark-circle" size={18} color={color} />
              <Text style={styles.featureText}>{f}</Text>
            </View>
          ))}
        </View>

        {isCurrent ? (
          <View style={[styles.subscribeButton, { backgroundColor: color + '20' }]}>
            <Text style={[styles.subscribeButtonText, { color }]}>✓ Current Plan</Text>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.subscribeButton, { backgroundColor: color }]}
            onPress={() => tier === 'free'
              ? handleDowngrade()
              : handleSubscribe(itemSkus[tier === 'pro' ? 0 : 1], tier)
            }
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={styles.subscribeButtonText}>
                {tier === 'free' ? 'Downgrade to Free' : 'Start Free Trial'}
              </Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.black} />
        </TouchableOpacity>
        <Text style={styles.title}>Manage Subscription</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Current Plan Banner */}
        <View style={styles.currentBanner}>
          <Ionicons name="shield-checkmark" size={20} color={theme.colors.primary} />
          <Text style={styles.currentBannerText}>
            {isSuperUser
              ? 'Lifetime Elite — Super User Access'
              : `Active Plan: Continuum ${subscriptionTier.toUpperCase()}`}
          </Text>
        </View>

        <TierCard
          title="Continuum Free"
          price="$0"
          features={['L4 Recent Memory', 'Standard AI Core', 'Basic Support']}
          tier="free"
          icon="leaf-outline"
          color={theme.colors.gray}
        />

        <TierCard
          title="Continuum Pro"
          price="$9.99"
          features={['Unlimited L1-L4 Sync', 'Advanced Voice Mode', 'Faster Response', 'No Ads']}
          tier="pro"
          icon="flash-outline"
          color={theme.colors.primary}
          isPopular
        />

        <TierCard
          title="Continuum Elite"
          price="$24.99"
          features={['L5 Global RAG', 'External Doc Indexing', 'Multi-Device Sync', 'Priority Support']}
          tier="elite"
          icon="diamond-outline"
          color="#6C5CE7"
        />

        {/* Management Actions */}
        <View style={styles.managementSection}>
          <Text style={styles.managementTitle}>SUBSCRIPTION MANAGEMENT</Text>

          <TouchableOpacity style={styles.managementRow} onPress={handleRestore}>
            <Ionicons name="refresh-outline" size={20} color={theme.colors.primary} />
            <Text style={styles.managementText}>Restore Purchases</Text>
            <Ionicons name="chevron-forward" size={18} color={theme.colors.gray} />
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity style={styles.managementRow} onPress={handleCancelSubscription}>
            <Ionicons name="close-circle-outline" size={20} color={theme.colors.danger} />
            <Text style={[styles.managementText, { color: theme.colors.danger }]}>Cancel Subscription</Text>
            <Ionicons name="chevron-forward" size={18} color={theme.colors.gray} />
          </TouchableOpacity>
        </View>

        <Text style={styles.disclaimer}>
          Subscriptions renew automatically. Cancel at least 24 hours before renewal in your Apple ID settings. Cancellation takes effect at the end of the current billing period.
        </Text>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.light },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 12 : 20, // Adaptive safe padding
    paddingHorizontal: 20,
    paddingBottom: 20,
    backgroundColor: theme.colors.white,
  },
  backButton: { marginRight: 16 },
  title: { fontSize: 20, fontWeight: '800', color: theme.colors.black },
  scrollContent: { padding: 20, paddingBottom: 60 },
  currentBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.primary + '15',
    borderRadius: 14,
    padding: 14,
    marginBottom: 20,
    gap: 10,
  },
  currentBannerText: {
    color: theme.colors.primary,
    fontWeight: '700',
    fontSize: 14,
    flex: 1,
  },
  card: {
    backgroundColor: theme.colors.white,
    borderRadius: 24,
    padding: 24,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 3,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  activeCard: { borderColor: theme.colors.primary },
  popularBadge: {
    position: 'absolute',
    top: -12,
    right: 24,
    backgroundColor: theme.colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  popularText: { color: 'white', fontSize: 10, fontWeight: '800' },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  tierTitle: { fontSize: 22, fontWeight: '800', color: theme.colors.black },
  tierPrice: { fontSize: 32, fontWeight: '800', color: theme.colors.black, marginTop: 8 },
  pricePeriod: { fontSize: 16, color: theme.colors.gray, fontWeight: '400' },
  trialText: {
    color: theme.colors.primary,
    fontSize: 14,
    fontWeight: '700',
    marginTop: 4,
    marginBottom: 20,
  },
  featureList: { marginBottom: 24 },
  featureItem: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  featureText: { fontSize: 15, color: theme.colors.gray, marginLeft: 10 },
  subscribeButton: {
    height: 56,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  subscribeButtonText: { color: 'white', fontSize: 16, fontWeight: '700' },
  managementSection: {
    backgroundColor: theme.colors.white,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: 20,
  },
  managementTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: theme.colors.gray,
    letterSpacing: 1,
    padding: 16,
    paddingBottom: 8,
  },
  managementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  managementText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: theme.colors.black,
  },
  divider: { height: 1, backgroundColor: theme.colors.border, marginHorizontal: 16 },
  disclaimer: {
    textAlign: 'center',
    color: theme.colors.gray,
    fontSize: 12,
    lineHeight: 18,
    paddingHorizontal: 20,
  },
});

export default SubscriptionSection;
