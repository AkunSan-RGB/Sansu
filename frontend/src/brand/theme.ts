import { BRAND } from '@sansu/shared';
import type { ThemeConfig } from 'antd';

const c = BRAND.colors;

/** Aksen emas hangat untuk sorotan premium (teks emas di latar terang memakai GOLD_TEXT agar kontras cukup) */
export const GOLD = '#C9A24B';
export const GOLD_TEXT = '#8A6A1F';
/** Permukaan: latar halaman hangat, kartu putih */
export const SURFACE = '#F6F6F3';
export const LINE = '#E8E6DF';

/** Tema Ant Design berbrand SANSU: hitam putih tegas, permukaan lapang dan lembut */
export const sansuTheme: ThemeConfig = {
  token: {
    colorPrimary: c.primary,
    colorLink: c.primary,
    colorLinkHover: c.primaryHover,
    colorBgLayout: SURFACE,
    colorInfo: c.primary,
    colorBorderSecondary: LINE,
    colorSuccess: c.accent,
    colorWarning: '#D48A06',
    colorText: '#111111',
    colorTextSecondary: '#5B6477',
    borderRadius: 10,
    borderRadiusLG: 14,
    fontFamily: BRAND.font,
    fontSize: 14,
    controlHeight: 38,
    boxShadowTertiary: '0 1px 2px rgba(10,10,10,.04), 0 8px 24px -12px rgba(10,10,10,.12)',
  },
  components: {
    Layout: { siderBg: c.ink, triggerBg: c.inkSoft, headerBg: 'rgba(255,255,255,.82)', headerHeight: 64 },
    Menu: {
      darkItemBg: c.ink,
      darkSubMenuItemBg: '#050505',
      darkItemSelectedBg: 'rgba(255,255,255,.14)',
      darkItemSelectedColor: '#FFFFFF',
      darkItemHoverBg: 'rgba(255,255,255,.06)',
      darkItemColor: 'rgba(255,255,255,.72)',
      itemBorderRadius: 10,
      itemMarginInline: 8,
    },
    Card: { borderRadiusLG: 16, headerFontSize: 15, paddingLG: 22 },
    Table: { headerBg: '#F3F2EE', headerColor: '#3B4458', headerSplitColor: 'transparent', borderColor: LINE, rowHoverBg: '#FAF9F6', cellPaddingBlockSM: 10 },
    Button: { fontWeight: 600, primaryShadow: '0 6px 14px -6px rgba(17,17,17,.55)', defaultShadow: 'none', controlHeight: 38 },
    Input: { activeShadow: '0 0 0 3px rgba(17,17,17,.12)' },
    Select: { optionSelectedBg: c.primarySoft },
    Tabs: { inkBarColor: c.primary, itemSelectedColor: c.primary, titleFontSize: 14 },
    Statistic: { contentFontSize: 26 },
    Tag: { borderRadiusSM: 6 },
    Modal: { borderRadiusLG: 18 },
  },
};
