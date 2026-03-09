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
        { text: "Reference", link: "/reference/cli/" },
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
              { text: "Core Concepts", link: "/guide/concepts" },
              { text: "Configuration", link: "/guide/configuration" },
              { text: "Dashboard", link: "/guide/dashboard" },
            ],
          },
          {
            text: "Operations",
            items: [
              { text: "Multi-Machine Setup", link: "/guide/multi-machine" },
              { text: "Troubleshooting", link: "/guide/troubleshooting" },
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
              { text: "MCP Server", link: "/features/mcp-server" },
              { text: "Dashboard", link: "/features/dashboard" },
            ],
          },
        ],
        "/reference/": [
          {
            text: "CLI Reference",
            items: [
              { text: "Overview", link: "/reference/cli/" },
              { text: "Bot Commands", link: "/reference/cli/bot" },
              { text: "Schedule Commands", link: "/reference/cli/schedule" },
              { text: "Node Commands", link: "/reference/cli/node" },
              { text: "Meter & Budget", link: "/reference/cli/meter" },
              { text: "Plugin Commands", link: "/reference/cli/plugin" },
              { text: "System Commands", link: "/reference/cli/system" },
            ],
          },
          {
            text: "API Reference",
            items: [
              { text: "Routes & Server", link: "/reference/api/" },
              { text: "@mecha/core", link: "/reference/api/core" },
              { text: "@mecha/process", link: "/reference/api/process" },
              { text: "@mecha/service", link: "/reference/api/service" },
              { text: "@mecha/meter", link: "/reference/api/meter" },
              { text: "@mecha/connect", link: "/reference/api/connect" },
              { text: "@mecha/runtime", link: "/reference/api/runtime" },
              { text: "@mecha/server", link: "/reference/api/server" },
              { text: "@mecha/mcp-server", link: "/reference/api/mcp-server" },
            ],
          },
          {
            text: "Other",
            items: [
              { text: "Dashboard Components", link: "/reference/components" },
              { text: "Environment Variables", link: "/reference/environment" },
              { text: "Error Reference", link: "/reference/errors" },
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
        message: "Released under the ISC License.",
        copyright: "Copyright © 2024-present",
      },
    },
  }),
);
