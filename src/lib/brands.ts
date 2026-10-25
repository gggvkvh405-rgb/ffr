import {
  siDuckduckgo,
  siFigma,
  siGithub,
  siGoogle,
  siHabr,
  siNotion,
  siTelegram,
  siVk,
  siWikipedia,
  siYoutube,
  type SimpleIcon,
} from 'simple-icons';
import { hostOf } from './url';

const HOST_BRANDS: { match: string; icon: SimpleIcon }[] = [
  { match: 'github.com', icon: siGithub },
  { match: 'youtube.com', icon: siYoutube },
  { match: 'youtu.be', icon: siYoutube },
  { match: 'wikipedia.org', icon: siWikipedia },
  { match: 'telegram.org', icon: siTelegram },
  { match: 't.me', icon: siTelegram },
  { match: 'telegram.me', icon: siTelegram },
  { match: 'habr.com', icon: siHabr },
  { match: 'vk.com', icon: siVk },
  { match: 'figma.com', icon: siFigma },
  { match: 'notion.so', icon: siNotion },
  { match: 'notion.site', icon: siNotion },
  { match: 'duckduckgo.com', icon: siDuckduckgo },
  { match: 'google.com', icon: siGoogle },
];

export function brandForUrl(url: string): SimpleIcon | null {
  const host = hostOf(url).toLowerCase();
  for (const entry of HOST_BRANDS) {
    if (host === entry.match || host.endsWith(`.${entry.match}`)) return entry.icon;
  }
  return null;
}

export { siDuckduckgo, siGoogle };
