import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';
import { storageGet, storageSet } from '../storage';

export const SUPPORTED_LANGUAGES = ['en', 'zh-CN'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const STORAGE_KEY = 'api-pressure-language';

export function detectLanguage(): SupportedLanguage {
  const uiLang = chrome.i18n?.getUILanguage?.() ?? navigator.language ?? 'en';
  return uiLang.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

export async function initI18n(): Promise<typeof i18n> {
  const stored = await storageGet<SupportedLanguage>(STORAGE_KEY);
  await i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      'zh-CN': { translation: zhCN },
    },
    lng: stored ?? detectLanguage(),
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });
  return i18n;
}

export async function changeLanguage(lang: SupportedLanguage): Promise<void> {
  await i18n.changeLanguage(lang);
  await storageSet(STORAGE_KEY, lang);
}
