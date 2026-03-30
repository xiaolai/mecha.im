import { withMermaid } from 'vitepress-plugin-mermaid'
import { execFileSync } from 'node:child_process'

const version = (() => {
  try {
    return execFileSync('git', ['describe', '--tags', '--abbrev=0']).toString().trim().replace(/^v/, '')
  } catch {
    return '0.5.1'
  }
})()

export default withMermaid({
  lang: 'en-US',
  title: 'Mecha',
  description: 'Agentic Workflow Engine: Scheduling, Orchestrating, Managing Events.',
  base: '/',
  appearance: true,
  cleanUrls: true,

  vite: {
    define: {
      __MECHA_VERSION__: JSON.stringify(version),
    },
  },

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    ['link', { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32x32.png' }],
    ['link', { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' }],
    ['link', { rel: 'manifest', href: '/site.webmanifest' }],
    ['meta', { name: 'theme-color', content: '#2B2C2B' }],
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
            { text: 'Quick Start', link: '/guide/quickstart' },
            { text: 'Installation', link: '/guide/installation' },
          ],
        },
        {
          text: 'Configuration',
          items: [
            { text: 'Workers', link: '/guide/workers' },
            { text: 'Secrets', link: '/guide/secrets' },
            { text: 'Events & Webhooks', link: '/guide/events' },
            { text: 'Policy', link: '/guide/policy' },
          ],
        },
        {
          text: 'Reference',
          items: [
            { text: 'CLI', link: '/guide/cli' },
            { text: 'Server', link: '/guide/server' },
            { text: 'API', link: '/guide/api' },
            { text: 'Architecture', link: '/guide/architecture' },
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
      message: 'Released under the ISC License.',
      copyright: 'Copyright 2026 Mecha',
    },

    editLink: {
      pattern: 'https://github.com/xiaolai/mecha.im/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
  },
})
