import { defineConfig } from "vitepress";
import { withMermaid } from "vitepress-plugin-mermaid";

export default withMermaid(
  defineConfig({
    title: "Mecha",
    description: "Run autonomous Claude bots in Docker containers",
    cleanUrls: true,
    base: "/",

    head: [
      ["link", { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32x32.png" }],
      ["link", { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16x16.png" }],
      ["link", { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" }],
    ],

    themeConfig: {
      logo: "/logo.png",
      nav: [
        { text: "Guide", link: "/guide/" },
        { text: "Features", link: "/features/scheduling" },
        { text: "Reference", link: "/reference/cli" },
        {
          text: "GitHub",
          link: "https://github.com/xiaolai/mecha.im",
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
              { text: "Bot Configuration", link: "/guide/configuration" },
              { text: "Authentication", link: "/guide/auth" },
              { text: "Dashboard", link: "/guide/dashboard" },
            ],
          },
        ],
        "/features/": [
          {
            text: "Features",
            items: [
              { text: "Scheduling", link: "/features/scheduling" },
              { text: "Webhooks", link: "/features/webhooks" },
              { text: "Bot-to-Bot Communication", link: "/features/bot-communication" },
              { text: "Workspace Mounting", link: "/features/workspaces" },
              { text: "Tailscale Mesh", link: "/features/tailscale" },
              { text: "Dashboard", link: "/features/dashboard" },
            ],
          },
        ],
        "/reference/": [
          {
            text: "Reference",
            items: [
              { text: "CLI Commands", link: "/reference/cli" },
              { text: "Bot Config Schema", link: "/reference/config" },
              { text: "Environment Variables", link: "/reference/environment" },
              { text: "Architecture", link: "/reference/architecture" },
            ],
          },
        ],
      },

      socialLinks: [
        {
          icon: "github",
          link: "https://github.com/xiaolai/mecha.im",
        },
      ],

      footer: {
        message: "Released under the MIT License.",
        copyright: "Copyright &copy; 2026-present",
      },
    },
  }),
);
