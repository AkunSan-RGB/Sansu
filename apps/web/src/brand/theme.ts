import { BRAND } from '@sansu/shared';
import type { ThemeConfig } from 'antd';

const c = BRAND.colors;

/** Tema Ant Design berbrand SANSU */
export const sansuTheme: ThemeConfig = {
  token: {
    colorPrimary: c.primary,
    colorLink: c.primary,
    colorLinkHover: c.primaryHover,
    colorBgLayout: c.surface,
    borderRadius: 8,
    fontFamily: BRAND.font,
  },
  components: {
    Layout: { siderBg: c.ink, triggerBg: c.inkSoft, headerBg: '#fff' },
    Menu: {
      darkItemBg: c.ink,
      darkSubMenuItemBg: c.inkSoft,
      darkItemSelectedBg: c.primary,
      darkItemSelectedColor: '#fff',
      darkItemHoverBg: c.inkSoft,
    },
    Card: { borderRadiusLG: 12 },
    Statistic: { contentFontSize: 26 },
  },
};
