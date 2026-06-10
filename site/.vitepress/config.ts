import { defineConfig } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';

export default withMermaid(
  defineConfig({
    title: 'coolify-mcp',
    description: 'MCP server for Coolify — 42 token-optimized tools for AI assistants',

    cleanUrls: true,
    // lastUpdated needs git available at build time; disabled until we wire
    // .git into the Dockerfile build stage (or move to a build that has it).
    lastUpdated: false,
    ignoreDeadLinks: 'localhostLinks',

    head: [
      ['link', { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' }],
      [
        'meta',
        {
          name: 'og:title',
          content: 'coolify-mcp — A Coolify control surface for AI assistants',
        },
      ],
      [
        'meta',
        {
          name: 'og:description',
          content:
            '42 token-optimized MCP tools. Drop into Claude / Cursor / Code. Drive your Coolify with natural language.',
        },
      ],
    ],

    themeConfig: {
      siteTitle: 'coolify-mcp',
      nav: [
        { text: 'Guide', link: '/guide/installation', activeMatch: '/guide/' },
        { text: 'Tools', link: '/tools/', activeMatch: '/tools/' },
        { text: 'Concepts', link: '/concepts/mcp-primer', activeMatch: '/concepts/' },
        { text: 'Contributing', link: '/contributing/adding-tools', activeMatch: '/contributing/' },
        { text: 'Roadmap', link: '/roadmap/', activeMatch: '/roadmap/' },
        { text: 'Work with me', link: '/hire', activeMatch: '/hire' },
        {
          text: 'v2.11.0',
          items: [
            { text: 'Changelog', link: '/changelog' },
            { text: 'GitHub', link: 'https://github.com/StuMason/coolify-mcp' },
            { text: 'npm', link: 'https://www.npmjs.com/package/@masonator/coolify-mcp' },
          ],
        },
      ],

      sidebar: {
        '/guide/': [
          {
            text: 'Getting Started',
            items: [
              { text: 'Installation', link: '/guide/installation' },
              { text: 'Quickstart', link: '/guide/quickstart' },
            ],
          },
        ],
        '/tools/': [
          {
            text: 'Tools Reference',
            items: [{ text: 'Overview', link: '/tools/' }],
          },
        ],
        '/concepts/': [
          {
            text: 'Concepts',
            items: [
              { text: 'MCP primer', link: '/concepts/mcp-primer' },
              { text: 'How coolify-mcp works', link: '/concepts/how-it-works' },
              { text: 'Security model', link: '/concepts/security' },
              { text: 'Coolify API gotchas', link: '/concepts/coolify-api-gotchas' },
            ],
          },
        ],
        '/contributing/': [
          {
            text: 'Contributing',
            items: [
              { text: 'Adding tools', link: '/contributing/adding-tools' },
              { text: 'Testing', link: '/contributing/testing' },
              { text: 'PR flow', link: '/contributing/pr-flow' },
            ],
          },
        ],
        '/roadmap/': [
          {
            text: 'Roadmap',
            items: [
              { text: 'Overview', link: '/roadmap/' },
              { text: 'v3 vision', link: '/roadmap/v3-vision' },
            ],
          },
        ],
      },

      socialLinks: [{ icon: 'github', link: 'https://github.com/StuMason/coolify-mcp' }],

      editLink: {
        pattern: 'https://github.com/StuMason/coolify-mcp/edit/main/site/:path',
        text: 'Edit this page on GitHub',
      },

      search: {
        provider: 'local',
      },

      footer: {
        message:
          'MIT licensed. Built in the open. <a href="/hire">Need this on your own product? Work with me →</a>',
        copyright:
          'By <a href="https://stumason.dev">Stu Mason</a> and <a href="https://github.com/StuMason/coolify-mcp/graphs/contributors">contributors</a>.',
      },
    },

    mermaid: {
      theme: 'default',
    },
  }),
);
