import { withMermaid } from 'vitepress-plugin-mermaid'

export default withMermaid({
  lang: 'en-US',
  title: 'Mecha',
  description: 'Agentic Workflow Engine: Scheduling, Orchestrating, Managing Events.',
  base: '/',
  appearance: true,
  cleanUrls: true,

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    ['link', { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32x32.png' }],
    ['link', { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' }],
    ['link', { rel: 'manifest', href: '/site.webmanifest' }],
    ['meta', { name: 'theme-color', content: '#C56F52' }],
  ],

  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'Mecha',

    nav: [
      { text: 'Guide', link: '/guide/' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Introduction', link: '/guide/' },
          ],
        },
      ],
    },

    search: {
      provider: 'local',
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/xiaolai/mecha.im' },
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright 2026 Mecha',
    },

    editLink: {
      pattern: 'https://github.com/xiaolai/mecha.im/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
  },
})
