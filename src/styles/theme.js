import { StyleSheet, Platform, Dimensions } from 'react-native';

const { width } = Dimensions.get('window');

export const theme = {
  colors: {
    primary: '#007AFF',
    secondary: '#5856D6',
    success: '#34C759',
    danger: '#FF3B30',
    warning: '#FFCC00',
    light: '#F2F2F7',
    gray: '#8E8E93',
    darkGray: '#3A3A3C',
    white: '#FFFFFF',
    black: '#000000',
    background: '#F9FAFB',
    border: '#E5E5E5',
    textPrimary: '#1F2937',
    textSecondary: '#6B7280',
  }
};

export const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.white },
  mainArea: { flex: 1 },
  chatArea: { flex: 1, backgroundColor: theme.colors.white },
  
  tabBar: {
    flexDirection: 'row',
    height: 60,
    backgroundColor: 'rgba(255, 255, 255, 0.98)',
    borderTopWidth: 0.5,
    borderColor: theme.colors.border,
    paddingBottom: Platform.OS === 'ios' ? 10 : 0,
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  tabItem: { alignItems: 'center', justifyContent: 'center', flex: 1 },
  tabLabel: { fontSize: 10, marginTop: 4, fontWeight: '600' },

  userBubble: { 
    alignSelf: 'flex-end', 
    backgroundColor: theme.colors.primary, 
    paddingHorizontal: 16, 
    paddingVertical: 10, 
    borderRadius: 18, 
    marginVertical: 4, 
    maxWidth: '85%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2
  },
  aiBubble: { 
    alignSelf: 'flex-start', 
    paddingHorizontal: 12, 
    paddingVertical: 10, 
    marginVertical: 8, 
    maxWidth: '92%',
    backgroundColor: theme.colors.light,
    borderRadius: 16
  },
  chatText: { color: theme.colors.black, fontSize: 16, lineHeight: 22 },
  userChatText: { color: theme.colors.white, fontSize: 16, lineHeight: 22 },
  
  inputWrapper: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 24 : 12,
    backgroundColor: theme.colors.white,
  },
  capsuleInput: {
    flexDirection: 'row',
    backgroundColor: theme.colors.light,
    borderRadius: 28,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    borderWidth: 0.5,
    borderColor: theme.colors.border,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 4
  },
  textInput: {
    flex: 1,
    color: theme.colors.black,
    fontSize: 15,
    maxHeight: 120,
    paddingTop: Platform.OS === 'ios' ? 8 : 4,
    paddingHorizontal: 10
  },
  sendPill: {
    backgroundColor: theme.colors.primary,
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  
  providerBar: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    paddingHorizontal: 16, 
    marginVertical: 8 
  },
  
  memoryArea: { flex: 1, paddingHorizontal: 16 },
  memoryTitle: { fontSize: 32, fontWeight: '800', marginTop: 16, color: theme.colors.black },
  
  groupedCard: { 
    backgroundColor: theme.colors.white, 
    borderRadius: 20, 
    overflow: 'hidden', 
    borderWidth: 1, 
    borderColor: theme.colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 5
  },
  
  cardItem: { 
    backgroundColor: theme.colors.white, 
    marginHorizontal: 16, 
    padding: 16, 
    borderRadius: 16, 
    marginBottom: 12,
    borderWidth: 1,
    borderColor: theme.colors.border
  },
  
  keyInput: { 
    backgroundColor: theme.colors.light, 
    borderRadius: 12, 
    padding: 12, 
    marginVertical: 10, 
    fontSize: 14, 
    color: theme.colors.black,
    minHeight: 100,
    textAlignVertical: 'top'
  },
  
  pulseIndicator: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.colors.danger,
  },
  typingIndicator: {
    fontSize: 12,
    color: theme.colors.gray,
    fontStyle: 'italic'
  },
  stopButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  }
});
