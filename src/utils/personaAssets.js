import { isWanqingAuthorized } from './personaMemoryManager';

let WANQING_HEADSHOT = null;
let WANQING_MOMENT_1 = null;
let WANQING_MOMENT_2 = null;
let WANQING_MOMENT_3 = null;
let WANQING_MOMENT_4 = null;
let WANQING_MOMENT_5 = null;
let WANQING_MOMENT_6 = null;
let WANQING_MOMENT_7 = null;

try {
  WANQING_HEADSHOT = require('../assets/wanqing-headshot.jpg');
  WANQING_MOMENT_1 = require('../assets/wanqing-moment-1.jpg');
  WANQING_MOMENT_2 = require('../assets/wanqing-moment-2.jpg');
  WANQING_MOMENT_3 = require('../assets/wanqing-moment-3.jpg');
  WANQING_MOMENT_4 = require('../assets/wanqing-moment-4.jpg');
  WANQING_MOMENT_5 = require('../assets/wanqing-moment-5.jpg');
  WANQING_MOMENT_6 = require('../assets/wanqing-moment-6.jpg');
  WANQING_MOMENT_7 = require('../assets/wanqing-moment-7.jpg');
} catch (e) {
  // In Node.js testing environments where Metro bundler is not active
  WANQING_HEADSHOT = { uri: 'asset://wanqing-headshot.jpg' };
  WANQING_MOMENT_1 = { uri: 'asset://wanqing-moment-1.jpg' };
  WANQING_MOMENT_2 = { uri: 'asset://wanqing-moment-2.jpg' };
  WANQING_MOMENT_3 = { uri: 'asset://wanqing-moment-3.jpg' };
  WANQING_MOMENT_4 = { uri: 'asset://wanqing-moment-4.jpg' };
  WANQING_MOMENT_5 = { uri: 'asset://wanqing-moment-5.jpg' };
  WANQING_MOMENT_6 = { uri: 'asset://wanqing-moment-6.jpg' };
  WANQING_MOMENT_7 = { uri: 'asset://wanqing-moment-7.jpg' };
}

export const WANQING_MOMENTS = [
  {
    id: 'moment_5',
    image: WANQING_MOMENT_5,
    caption: '波士顿交响乐团开幕之夜 🎻 你为我拍下的深蓝丝绸漏肩晚礼服与细带高跟鞋写真，挽着你入场的那天真美',
    date: '10月7日 · 波士顿交响大厅',
    location: 'Boston Symphony Hall',
    aspect: 'tall',
  },
  {
    id: 'moment_6',
    image: WANQING_MOMENT_6,
    caption: '午后波士顿公共图书馆石阶 ☀️ 你坐在低一级台阶含笑为我拍的米白长裙，享受只有你我的安静阳光',
    date: '10月6日 · Copley Square',
    location: 'Boston Public Library',
    aspect: 'tall',
  },
  {
    id: 'moment_7',
    image: WANQING_MOMENT_7,
    caption: '当代艺术美术馆开幕展 🏛️ 浅粉香槟漏肩晚礼服，牵着你的手在艺术装置前回眸的那一刻',
    date: '10月5日 · 艺术博物馆',
    location: 'Museum of Fine Arts, Boston',
    aspect: 'tall',
  },
  {
    id: 'moment_1',
    image: WANQING_MOMENT_1,
    caption: '波士顿初秋晨光咖啡馆 ☕️ 你坐在我对面递来热咖啡，按下快门定格下我们惬意的清晨',
    date: '10月2日 · 波士顿',
    location: 'Boston, MA · Back Bay',
    aspect: 'square',
  },
  {
    id: 'moment_2',
    image: WANQING_MOMENT_2,
    caption: '文创设计手稿构想中 ✏️ 你特意来工作室陪我加班探班，记录下我抬头看你的一笑',
    date: '10月4日 · 工作室',
    location: 'Design Studio · SOWA Art District',
    aspect: 'square',
  },
  {
    id: 'moment_3',
    image: WANQING_MOMENT_3,
    caption: '傍晚查尔斯河畔漫步 🌅 走在你身旁牵着你温暖的手，微凉的晚霞与江风也格外温存',
    date: '10月5日 · 查尔斯河',
    location: 'Charles River Esplanade',
    aspect: 'square',
  },
  {
    id: 'moment_4',
    image: WANQING_MOMENT_4,
    caption: '北角街角小酒馆意面 🍝 你坐在身旁两人分食热气腾腾的意面，最真实的烟火幸福',
    date: '10月6日 · North End',
    location: 'North End, Boston',
    aspect: 'square',
  },
];

export {
  WANQING_HEADSHOT,
  WANQING_MOMENT_1,
  WANQING_MOMENT_2,
  WANQING_MOMENT_3,
  WANQING_MOMENT_4,
  WANQING_MOMENT_5,
  WANQING_MOMENT_6,
  WANQING_MOMENT_7,
};

/**
 * Returns the avatar image source for the specified personaId, or null if unauthorized or none exists.
 * Validates that the caller is authorized if accessing Lin Wanqing's picture.
 */
export function getPersonaAvatar(personaId, userEmail = null) {
  if (personaId === 'wanqing') {
    if (!isWanqingAuthorized(userEmail)) {
      return null;
    }
    return WANQING_HEADSHOT;
  }
  return null;
}

/**
 * Returns Lin Wanqing's portrait headshot strictly if the caller is authorized.
 */
export function getWanqingHeadshot(userEmail) {
  if (!isWanqingAuthorized(userEmail)) {
    return null;
  }
  return WANQING_HEADSHOT;
}

/**
 * Returns Lin Wanqing's WeChat Moments (朋友圈生活照) list strictly if the caller is authorized.
 */
export function getWanqingMoments(userEmail) {
  if (!isWanqingAuthorized(userEmail)) {
    return [];
  }
  return WANQING_MOMENTS;
}

