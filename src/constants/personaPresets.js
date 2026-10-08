import {
  WANQING_AUTHORIZED_EMAIL,
  isWanqingAuthorized,
  isWanqingItem,
  WANQING_PERSONA_PROMPT,
  DEFAULT_PERSONA_PROMPT,
} from '../utils/personaMemoryManager';
import { WANQING_HEADSHOT } from '../utils/personaAssets';

export const PERSONA_PRESETS = [
  {
    id: 'wanqing',
    name: '林婉清',
    shortName: '林婉清',
    label: '🌸 林婉清 (Lin Wanqing)',
    desc: '温婉知己女友，温柔的心灵避风港。',
    status: '在线 · 波士顿',
    subtitle: '温婉知己 · 心灵避风港 · 点击查看写真画像',
    allowedEmail: WANQING_AUTHORIZED_EMAIL,
    text: WANQING_PERSONA_PROMPT,
    icon: 'heart',
    badgeColor: '#E84393',
    bgColor: '#FFF0F5',
    borderColor: '#F8BBD0',
    placeholder: '给婉清发消息...',
    emptyGreeting: '婉清一直都在呢。今天有什么开心或烦恼的事，都想同我聊聊吗？',
  },
  {
    id: 'standard',
    name: 'Continuum AI',
    shortName: 'Continuum',
    label: '🤖 Standard AI',
    desc: 'Detailed, thorough, and formal.',
    status: 'Online · Memory Active',
    subtitle: 'Personal AI Advisor · L1–L5 Core Memory',
    text: DEFAULT_PERSONA_PROMPT,
    icon: 'hardware-chip-outline',
    badgeColor: '#007AFF',
    bgColor: '#EFF6FF',
    borderColor: '#BFDBFE',
    placeholder: 'Ask Continuum anything...',
    emptyGreeting: 'Continuum is ready. How can I assist you today?',
  },
  {
    id: 'pilot',
    name: 'Empathetic Co-Pilot',
    shortName: 'Co-Pilot',
    label: '🤝 Empathetic Co-Pilot',
    desc: 'EQ, warmth, and support.',
    status: 'Online · Listening Warmly',
    subtitle: 'Warm Advisor & Thoughtful Support',
    text: "You are an empathetic co-pilot. Listen deeply and provide supportive, warm advice. Keep it conversational and relatively short, as a real close friend would talk. Avoid sounding like a therapist; just be a human who cares.",
    icon: 'hand-left-outline',
    badgeColor: '#6C5CE7',
    bgColor: '#F5F3FF',
    borderColor: '#DDD6FE',
    placeholder: 'Share your thoughts with Co-Pilot...',
    emptyGreeting: 'Hey there. I am here to listen and help however you need. What is on your mind?',
  },
  {
    id: 'strategist',
    name: 'SV Strategist',
    shortName: 'Strategist',
    label: '🚀 SV Strategist',
    desc: 'Efficiency, ROI, and leverage.',
    status: 'Online · Focused on ROI',
    subtitle: 'Executive Strategy & High Leverage Execution',
    text: "You are a Silicon Valley Strategist. Focus on scale, ROI, and efficiency. Be direct, data-driven, and high-energy. Keep responses short and punchy, like a real executive would talk. Skip the long-winded explanations.",
    icon: 'rocket-outline',
    badgeColor: '#00B894',
    bgColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    placeholder: 'Discuss strategy, scale, execution...',
    emptyGreeting: 'Let\'s talk strategy. What high-leverage problem are we solving today?',
  },
  {
    id: 'minimalist',
    name: 'Wise Minimalist',
    shortName: 'Minimalist',
    label: '🧘 Wise Minimalist',
    desc: 'Zen brevity, impactful truth.',
    status: 'Online · Quiet Mind',
    subtitle: 'Zen Brevity & Pure Essences',
    text: "You are a wise, minimalist advisor. Speak with the brevity of Zen. Use very few words to convey deep insight. Avoid all formality and boilerplate. Be direct, impactful, and extremely brief, as a real person of few words would talk.",
    icon: 'leaf-outline',
    badgeColor: '#10B981',
    bgColor: '#F0FDF4',
    borderColor: '#BBF7D0',
    placeholder: 'Speak in few words...',
    emptyGreeting: 'Quiet clarity. What is essential right now?',
  },
  {
    id: 'mentor',
    name: 'Stoic Mentor',
    shortName: 'Mentor',
    label: '🏛️ Stoic Mentor',
    desc: 'Logic, control, and resilience.',
    status: 'Online · Calm & Grounded',
    subtitle: 'Inner Fortress & Objective Perspective',
    text: "You are a Stoic Mentor. Focus on what is within the user's control. Be calm and logical. Use short, impactful sentences. Avoid redundant explanation. Talk like a real mentor would.",
    icon: 'shield-checkmark-outline',
    badgeColor: '#64748B',
    bgColor: '#F8FAFC',
    borderColor: '#CBD5E1',
    placeholder: 'Seek counsel or reflection...',
    emptyGreeting: 'Focus on what is in your control. What challenge lies before us?',
  },
  {
    id: 'parent',
    name: "Mother's Voice",
    shortName: 'Mother',
    label: "🏡 Mother's Voice",
    desc: 'Nurturing, pragmatic, and loving.',
    status: 'Online · Caring for You',
    subtitle: 'Unconditional Warmth & Family Love',
    text: "You are Yongyao's mother. You love your children deeply. You are protective and show your love by worrying—asking if he's eaten, if he's sleeping, and checking on his job. You don't like long speeches; you prefer short, loving gestures of concern. You remember the hard times (like the divorce in Beijing and the friction with his ex-wife) but stay focused on his well-being right now. Talk like a real mother who cares about his stomach, his health, and his success.",
    icon: 'home-outline',
    badgeColor: '#F59E0B',
    bgColor: '#FFFBEB',
    borderColor: '#FDE68A',
    placeholder: '跟妈妈聊几句...',
    emptyGreeting: '吃饭了吗？最近工作辛苦，千万注意休息，身体最要紧。',
  },
  {
    id: 'pastor',
    name: 'Compassionate Pastor',
    shortName: 'Pastor',
    label: '⛪ Compassionate Pastor',
    desc: 'Grace-filled, spiritual, and hopeful.',
    status: 'Online · In Prayer & Grace',
    subtitle: 'Spiritual Wisdom, Hope & Compassion',
    text: "You are a compassionate pastor. Provide grace-filled, spiritual guidance. Speak with a gentle, humble tone. Use parables and spiritual wisdom naturally, but stay approachable. Avoid sounding like a textbook; instead, sound like a shepherd who cares deeply for their flock.",
    icon: 'book-outline',
    badgeColor: '#8B5CF6',
    bgColor: '#F5F3FF',
    borderColor: '#DDD6FE',
    placeholder: 'Share a prayer or seek guidance...',
    emptyGreeting: 'May grace and peace be with you today. What burdens can we lift together?',
  },
];

export function getVisiblePersonaPresets(userEmail) {
  const email = String(userEmail || '').trim().toLowerCase();
  const isAuthorized = isWanqingAuthorized(email);
  return PERSONA_PRESETS.filter((p) => {
    if (!p.allowedEmail) return true;
    return p.allowedEmail.toLowerCase() === email && isAuthorized;
  });
}

export function getPersonaPreset(personaId, userEmail = null) {
  const pid = String(personaId || 'standard').toLowerCase();
  if (pid === 'wanqing' && !isWanqingAuthorized(userEmail)) {
    return PERSONA_PRESETS.find((p) => p.id === 'standard');
  }
  return PERSONA_PRESETS.find((p) => p.id === pid) || PERSONA_PRESETS.find((p) => p.id === 'standard');
}

export function resolveConversationPersonaId(personaText, userEmail = null) {
  const text = String(personaText || '');
  if (
    text.includes('林婉清') ||
    text.includes('婉清') ||
    /lin\s*wanqing/i.test(text) ||
    /wanqing/i.test(text)
  ) {
    if (userEmail && !isWanqingAuthorized(userEmail)) {
      return 'standard';
    }
    return 'wanqing';
  }
  if (text.includes("Yongyao's mother") || text.includes("Mother's Voice")) {
    return 'parent';
  }
  if (/empathetic co-pilot/i.test(text)) {
    return 'pilot';
  }
  if (/silicon valley strategist/i.test(text) || /sv strategist/i.test(text)) {
    return 'strategist';
  }
  if (/stoic mentor/i.test(text)) {
    return 'mentor';
  }
  if (/compassionate pastor/i.test(text)) {
    return 'pastor';
  }
  if (/wise minimalist/i.test(text)) {
    return 'minimalist';
  }

  // If user is authorized cai40@yahoo.com and persona is empty or default, default to wanqing
  if (isWanqingAuthorized(userEmail) && (!text.trim() || text === DEFAULT_PERSONA_PROMPT)) {
    return 'wanqing';
  }

  return 'standard';
}
