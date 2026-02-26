import { defineConfig } from "vitepress";
import { withMermaid } from "vitepress-plugin-mermaid";

export default withMermaid(
  defineConfig({
    title: "Mecha",
    description: "Local-first multi-agent runtime",
    cleanUrls: true,
    base: "/",

    head: [
      ["link", { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" }],
    ],

    themeConfig: {
      nav: [
        { text: "Guide", link: "/guide/" },
        { text: "Features", link: "/features/multi-agent" },
        { text: "Reference", link: "/reference/cli" },
        {
          text: "GitHub",
          link: "https://github.com/xiaolai/myprojects/tree/main/mecha.im",
        },
      ],

      sidebar: {
        "/guide/": [
          {
            text: "Getting Started",
            items: [
              { text: "What is Mecha?", link: "/guide/" },
              { text: "Installation", link: "/guide/installation" },
              { text: "Quick Start", link: "/guide/quickstart" },
            ],
          },
          {
            text: "Essentials",
            items: [
              { text: "Core Concepts", link: "/guide/concepts" },
              { text: "Configuration", link: "/guide/configuration" },
            ],
          },
        ],
        "/features/": [
          {
            text: "Features",
            items: [
              { text: "Multi-Agent", link: "/features/multi-agent" },
              { text: "Permissions (ACL)", link: "/features/permissions" },
              { text: "Mesh Networking", link: "/features/mesh-networking" },
              { text: "Sandbox", link: "/features/sandbox" },
              { text: "Metering & Budgets", link: "/features/metering" },
              { text: "Scheduling", link: "/features/scheduling" },
              { text: "Sessions", link: "/features/sessions" },
            ],
          },
        ],
        "/reference/": [
          {
            text: "Reference",
            items: [
              { text: "CLI Reference", link: "/reference/cli" },
              {
                text: "Environment Variables",
                link: "/reference/environment",
              },
              { text: "Architecture", link: "/reference/architecture" },
            ],
          },
        ],
        "/advanced/": [
          {
            text: "Advanced",
            items: [
              {
                text: "Multi-Machine Setup",
                link: "/advanced/multi-machine",
              },
              { text: "Troubleshooting", link: "/advanced/troubleshooting" },
            ],
          },
        ],
      },

      socialLinks: [
        {
          icon: "github",
          link: "https://github.com/xiaolai/myprojects/tree/main/mecha.im",
        },
      ],

      footer: {
        message: "Released under the ISC License.",
        copyright: "Copyright © 2024-present",
      },
    },
  }),
);
