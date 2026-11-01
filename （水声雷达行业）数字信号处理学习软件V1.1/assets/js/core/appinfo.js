/* =============================================================
   appinfo.js —— 应用元信息（名称 / 版本 / 口号 / 联系方式）
   全局命名空间：window.DSP.APP

   全站标题、导出文件、侧栏页脚、分享脚注统一从这里取名，
   改名或升版本只需要改这一个文件。
   ============================================================= */
(function (global) {
  'use strict';

  const DSP = global.DSP || (global.DSP = {});

  const NAME = '数字信号处理知识学习实践系统';
  const VERSION = 'V1.1';
  const SLOGAN = '老海出手必是精品，更多好用软件关注海疆智造公众号加老海微信，视频教学关注海疆智造抖音号';
  const TAGLINE = '理论 · 仿真 · 工程案例 · 公式手册';

  DSP.APP = {
    name: NAME,
    version: VERSION,
    slogan: SLOGAN,
    /** 带括号的口号（用于顶栏展示） */
    sloganParen: '（' + SLOGAN + '）',
    tagline: TAGLINE,
    /** 微信 / 抖音 等联系渠道，用于「关于」弹窗 */
    contact: [
      ['微信公众号', '海疆智造（更多好用软件）'],
      ['微信好友', '老海'],
      ['抖音号', '海疆智造（视频教学）']
    ],

    /** 顶栏主标题（名称 + 版本） */
    brandTitle: function () { return NAME; },
    /** 浏览器标签页标题 */
    docTitle: function (pageTitle) {
      return pageTitle
        ? pageTitle + ' · ' + NAME + ' ' + VERSION
        : NAME + ' ' + VERSION + ' — ' + TAGLINE;
    }
  };
})(window);
