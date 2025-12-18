#!/usr/bin/env node

import { McpServer, StdioServerTransport } from '@modelcontextprotocol/sdk';
import { z } from 'zod';

const SERVICE_TYPES = ['application', 'database', 'service'] as const;

class CoolifyClient {
  constructor(private baseUrl: string, private accessToken: string) {}

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}/api/v1${path}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json();
  }

  async listServers() {
    return this.request('/servers');
  }

  async getServer(id: string) {
    return this.request(`/servers/${id}`);
  }

  async listServices() {
    return this.request('/services');
  }

  async createService(data: any) {
    return this.request('/services', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async deleteService(id: string) {
    return this.request(`/services/${id}`, {
      method: 'DELETE',
    });
  }
}

class GitHubClient {
  constructor(private token?: string) {}

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`https://api.github.com${path}`, {
      ...options,
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': this.token ? `token ${this.token}` : undefined,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub API error! status: ${response.status}`);
    }

    return response.json();
  }

  async searchRepositories(query: string) {
    return this.request(`/search/repositories?q=${encodeURIComponent(query)}`);
  }

  async createRepository(name: string, options: any = {}) {
    return this.request('/user/repos', {
      method: 'POST',
      body: JSON.stringify({ name, ...options }),
    });
  }

  async createIssue(owner: string, repo: string, title: string, body?: string) {
    return this.request(`/repos/${owner}/${repo}/issues`, {
      method: 'POST',
      body: JSON.stringify({ title, body }),
    });
  }

  async getIssue(owner: string, repo: string, number: number) {
    return this.request(`/repos/${owner}/${repo}/issues/${number}`);
  }

  async listIssues(owner: string, repo: string) {
    return this.request(`/repos/${owner}/${repo}/issues`);
  }

  async updateIssue(owner: string, repo: string, number: number, data: any) {
    return this.request(`/repos/${owner}/${repo}/issues/${number}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async addIssueComment(owner: string, repo: string, number: number, body: string) {
    return this.request(`/repos/${owner}/${repo}/issues/${number}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
  }

  async createBranch(owner: string, repo: string, branch: string, sha: string) {
    return this.request(`/repos/${owner}/${repo}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({
        ref: `refs/heads/${branch}`,
        sha,
      }),
    });
  }

  async createPullRequest(owner: string, repo: string, title: string, head: string, base: string, body?: string) {
    return this.request(`/repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      body: JSON.stringify({
        title,
        head,
        base,
        body,
      }),
    });
  }

  async forkRepository(owner: string, repo: string, organization?: string) {
    return this.request(`/repos/${owner}/${repo}/forks`, {
      method: 'POST',
      body: JSON.stringify(organization ? { organization } : {}),
    });
  }

  async getFileContents(owner: string, repo: string, path: string) {
    return this.request(`/repos/${owner}/${repo}/contents/${path}`);
  }

  async createOrUpdateFile(owner: string, repo: string, path: string, content: string, message: string) {
    return this.request(`/repos/${owner}/${repo}/contents/${path}`, {
      method: 'PUT',
      body: JSON.stringify({
        message,
        content: Buffer.from(content).toString('base64'),
      }),
    });
  }

  async pushFiles(owner: string, repo: string, files: Array<{ path: string; content: string }>, message: string) {
    // This is a simplified version - in reality, you'd want to use the Git Data API
    // to create a tree and commit multiple files at once
    for (const file of files) {
      await this.createOrUpdateFile(owner, repo, file.path, file.content, message);
    }
  }

  async listCommits(owner: string, repo: string) {
    return this.request(`/repos/${owner}/${repo}/commits`);
  }

  async searchCode(query: string) {
    return this.request(`/search/code?q=${encodeURIComponent(query)}`);
  }

  async searchIssues(query: string) {
    return this.request(`/search/issues?q=${encodeURIComponent(query)}`);
  }

  async searchUsers(query: string) {
    return this.request(`/search/users?q=${encodeURIComponent(query)}`);
  }
}

class CoolifyMcpServer extends McpServer {
  private coolifyClient: CoolifyClient;
  private githubClient: GitHubClient;

  constructor(coolifyBaseUrl: string, coolifyAccessToken: string, githubToken?: string) {
    super();
    this.coolifyClient = new CoolifyClient(coolifyBaseUrl, coolifyAccessToken);
    this.githubClient = new GitHubClient(githubToken);

    // Coolify endpoints
    this.addTool('list_servers', {
      description: 'List all Coolify servers',
      parameters: z.object({}),
      handler: async () => {
        return this.coolifyClient.listServers();
      },
    });

    this.addTool('get_server', {
      description: 'Get details about a specific Coolify server',
      parameters: z.object({
        id: z.string(),
      }),
      handler: async ({ id }) => {
        return this.coolifyClient.getServer(id);
      },
    });

    this.addTool('list_services', {
      description: 'List all Coolify services',
      parameters: z.object({}),
      handler: async () => {
        return this.coolifyClient.listServices();
      },
    });

    this.addTool('create_service', {
      description: 'Create a new Coolify service',
      parameters: z.object({
        name: z.string(),
        type: z.enum(SERVICE_TYPES),
        configuration: z.record(z.any()),
      }),
      handler: async (params) => {
        return this.coolifyClient.createService(params);
      },
    });

    this.addTool('delete_service', {
      description: 'Delete a Coolify service',
      parameters: z.object({
        id: z.string(),
      }),
      handler: async ({ id }) => {
        return this.coolifyClient.deleteService(id);
      },
    });

    // GitHub endpoints
    this.addTool('search_repositories', {
      description: 'Search for GitHub repositories',
      parameters: z.object({
        query: z.string(),
      }),
      handler: async ({ query }) => {
        return this.githubClient.searchRepositories(query);
      },
    });

    this.addTool('create_repository', {
      description: 'Create a new GitHub repository in your account',
      parameters: z.object({
        name: z.string(),
        description: z.string().optional(),
        private: z.boolean().optional(),
      }),
      handler: async (params) => {
        return this.githubClient.createRepository(params.name, params);
      },
    });

    this.addTool('create_issue', {
      description: 'Create a new issue in a GitHub repository',
      parameters: z.object({
        owner: z.string(),
        repo: z.string(),
        title: z.string(),
        body: z.string().optional(),
      }),
      handler: async ({ owner, repo, title, body }) => {
        return this.githubClient.createIssue(owner, repo, title, body);
      },
    });

    this.addTool('get_issue', {
      description: 'Get details of a specific issue in a GitHub repository',
      parameters: z.object({
        owner: z.string(),
        repo: z.string(),
        number: z.number(),
      }),
      handler: async ({ owner, repo, number }) => {
        return this.githubClient.getIssue(owner, repo, number);
      },
    });

    this.addTool('list_issues', {
      description: 'List issues in a GitHub repository',
      parameters: z.object({
        owner: z.string(),
        repo: z.string(),
      }),
      handler: async ({ owner, repo }) => {
        return this.githubClient.listIssues(owner, repo);
      },
    });

    this.addTool('update_issue', {
      description: 'Update an existing issue in a GitHub repository',
      parameters: z.object({
        owner: z.string(),
        repo: z.string(),
        number: z.number(),
        title: z.string().optional(),
        body: z.string().optional(),
        state: z.enum(['open', 'closed']).optional(),
      }),
      handler: async (params) => {
        const { owner, repo, number, ...data } = params;
        return this.githubClient.updateIssue(owner, repo, number, data);
      },
    });

    this.addTool('add_issue_comment', {
      description: 'Add a comment to an existing issue',
      parameters: z.object({
        owner: z.string(),
        repo: z.string(),
        number: z.number(),
        body: z.string(),
      }),
      handler: async ({ owner, repo, number, body }) => {
        return this.githubClient.addIssueComment(owner, repo, number, body);
      },
    });

    this.addTool('create_branch', {
      description: 'Create a new branch in a GitHub repository',
      parameters: z.object({
        owner: z.string(),
        repo: z.string(),
        branch: z.string(),
        sha: z.string(),
      }),
      handler: async ({ owner, repo, branch, sha }) => {
        return this.githubClient.createBranch(owner, repo, branch, sha);
      },
    });

    this.addTool('create_pull_request', {
      description: 'Create a new pull request in a GitHub repository',
      parameters: z.object({
        owner: z.string(),
        repo: z.string(),
        title: z.string(),
        head: z.string(),
        base: z.string(),
        body: z.string().optional(),
      }),
      handler: async ({ owner, repo, title, head, base, body }) => {
        return this.githubClient.createPullRequest(owner, repo, title, head, base, body);
      },
    });

    this.addTool('fork_repository', {
      description: 'Fork a GitHub repository to your account or specified organization',
      parameters: z.object({
        owner: z.string(),
        repo: z.string(),
        organization: z.string().optional(),
      }),
      handler: async ({ owner, repo, organization }) => {
        return this.githubClient.forkRepository(owner, repo, organization);
      },
    });

    this.addTool('get_file_contents', {
      description: 'Get the contents of a file or directory from a GitHub repository',
      parameters: z.object({
        owner: z.string(),
        repo: z.string(),
        path: z.string(),
      }),
      handler: async ({ owner, repo, path }) => {
        return this.githubClient.getFileContents(owner, repo, path);
      },
    });

    this.addTool('create_or_update_file', {
      description: 'Create or update a single file in a GitHub repository',
      parameters: z.object({
        owner: z.string(),
        repo: z.string(),
        path: z.string(),
        content: z.string(),
        message: z.string(),
      }),
      handler: async ({ owner, repo, path, content, message }) => {
        return this.githubClient.createOrUpdateFile(owner, repo, path, content, message);
      },
    });

    this.addTool('push_files', {
      description: 'Push multiple files to a GitHub repository in a single commit',
      parameters: z.object({
        owner: z.string(),
        repo: z.string(),
        files: z.array(z.object({
          path: z.string(),
          content: z.string(),
        })),
        message: z.string(),
      }),
      handler: async ({ owner, repo, files, message }) => {
        return this.githubClient.pushFiles(owner, repo, files, message);
      },
    });

    this.addTool('list_commits', {
      description: 'Get list of commits of a branch in a GitHub repository',
      parameters: z.object({
        owner: z.string(),
        repo: z.string(),
      }),
      handler: async ({ owner, repo }) => {
        return this.githubClient.listCommits(owner, repo);
      },
    });

    this.addTool('search_code', {
      description: 'Search for code across GitHub repositories',
      parameters: z.object({
        query: z.string(),
      }),
      handler: async ({ query }) => {
        return this.githubClient.searchCode(query);
      },
    });

    this.addTool('search_issues', {
      description: 'Search for issues and pull requests across GitHub repositories',
      parameters: z.object({
        query: z.string(),
      }),
      handler: async ({ query }) => {
        return this.githubClient.searchIssues(query);
      },
    });

    this.addTool('search_users', {
      description: 'Search for users on GitHub',
      parameters: z.object({
        query: z.string(),
      }),
      handler: async ({ query }) => {
        return this.githubClient.searchUsers(query);
      },
    });
  }
}

async function main() {
  const coolifyBaseUrl = process.env.COOLIFY_BASE_URL;
  const coolifyAccessToken = process.env.COOLIFY_ACCESS_TOKEN;
  const githubToken = process.env.GITHUB_TOKEN;

  if (!coolifyBaseUrl || !coolifyAccessToken) {
    console.error('Missing required environment variables: COOLIFY_BASE_URL, COOLIFY_ACCESS_TOKEN');
    process.exit(1);
  }

  const server = new CoolifyMcpServer(coolifyBaseUrl, coolifyAccessToken, githubToken);
  const transport = new StdioServerTransport();

  try {
    await server.connect(transport);
  } catch (error) {
    console.error('Failed to connect:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
