import React, { memo, useCallback } from 'react';
import { StyleSheet, Platform, Linking } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { theme } from '../../styles/theme';

const markdownStyles = StyleSheet.create({
  body: {
    color: theme.colors.black,
    fontSize: 16,
    lineHeight: 22,
  },
  paragraph: {
    marginTop: 0,
    marginBottom: 10,
    flexWrap: 'wrap',
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    width: '100%',
  },
  heading1: {
    color: theme.colors.black,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    marginTop: 4,
    marginBottom: 10,
  },
  heading2: {
    color: theme.colors.black,
    fontSize: 19,
    lineHeight: 25,
    fontWeight: '700',
    marginTop: 4,
    marginBottom: 8,
  },
  heading3: {
    color: theme.colors.black,
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '700',
    marginTop: 2,
    marginBottom: 6,
  },
  heading4: {
    color: theme.colors.black,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
    marginBottom: 6,
  },
  heading5: {
    color: theme.colors.darkGray,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '700',
    marginBottom: 4,
  },
  heading6: {
    color: theme.colors.darkGray,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    marginBottom: 4,
  },
  strong: {
    fontWeight: '700',
    color: theme.colors.black,
  },
  em: {
    fontStyle: 'italic',
  },
  s: {
    textDecorationLine: 'line-through',
  },
  link: {
    color: theme.colors.primary,
    textDecorationLine: 'underline',
  },
  blockquote: {
    backgroundColor: '#E8E8ED',
    borderLeftColor: theme.colors.primary,
    borderLeftWidth: 3,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginVertical: 8,
  },
  code_inline: {
    backgroundColor: '#E5E5EA',
    borderRadius: 4,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 13,
    paddingHorizontal: 4,
    color: theme.colors.darkGray,
  },
  fence: {
    backgroundColor: '#E5E5EA',
    borderRadius: 8,
    padding: 10,
    marginVertical: 8,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    lineHeight: 18,
    color: theme.colors.darkGray,
  },
  code_block: {
    backgroundColor: '#E5E5EA',
    borderRadius: 8,
    padding: 10,
    marginVertical: 8,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    lineHeight: 18,
    color: theme.colors.darkGray,
  },
  bullet_list: {
    marginBottom: 8,
  },
  ordered_list: {
    marginBottom: 8,
  },
  list_item: {
    marginVertical: 2,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  bullet_list_icon: {
    marginLeft: 0,
    marginRight: 8,
    color: theme.colors.black,
    fontSize: 16,
    lineHeight: 22,
  },
  ordered_list_icon: {
    marginLeft: 0,
    marginRight: 8,
    color: theme.colors.black,
    fontSize: 16,
    lineHeight: 22,
  },
  table: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 8,
    marginVertical: 8,
    overflow: 'hidden',
  },
  thead: {
    backgroundColor: '#E8E8ED',
  },
  th: {
    padding: 8,
    fontWeight: '700',
    color: theme.colors.black,
    fontSize: 14,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  td: {
    padding: 8,
    color: theme.colors.black,
    fontSize: 14,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  tr: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    flexDirection: 'row',
  },
  hr: {
    backgroundColor: theme.colors.border,
    height: 1,
    marginVertical: 10,
  },
});

function AssistantMarkdown({ children }) {
  const content = children == null ? '' : String(children);
  const onLinkPress = useCallback((url) => {
    if (!url) return false;
    Linking.openURL(url).catch(() => {});
    return false;
  }, []);
  if (!content.trim()) return null;
  return (
    <Markdown style={markdownStyles} mergeStyle onLinkPress={onLinkPress}>
      {content}
    </Markdown>
  );
}

export default memo(AssistantMarkdown);
