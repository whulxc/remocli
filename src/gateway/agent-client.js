const HEALTH_TIMEOUT_MS = 4_000;

export class AgentClient {
  constructor(agent) {
    this.agent = agent;
  }

  headers() {
    return {
      'x-agent-token': this.agent.token,
    };
  }

  async request(pathname, options = {}) {
    const timeoutMs = Number(options.timeoutMs || HEALTH_TIMEOUT_MS);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${this.agent.baseUrl}${pathname}`, {
        ...options,
        headers: {
          'content-type': 'application/json',
          ...this.headers(),
          ...(options.headers || {}),
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        const error = new Error(`Agent ${this.agent.id} ${pathname} failed: ${response.status} ${text}`);
        error.statusCode = response.status;
        error.responseText = text;
        throw error;
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        return response.json();
      }

      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  async health() {
    return this.request('/health');
  }

  async listSessions() {
    return this.request('/api/sessions');
  }

  async listProjects() {
    return this.request('/api/projects');
  }

  async listProjectSuggestions(params = {}) {
    const query = new URLSearchParams();
    if (`${params.input || ''}`.trim()) {
      query.set('input', `${params.input}`.trim());
    }
    if (`${params.preferredRoot || ''}`.trim()) {
      query.set('preferredRoot', `${params.preferredRoot}`.trim());
    }
    const suffix = query.toString();
    return this.request(`/api/projects/suggest${suffix ? `?${suffix}` : ''}`);
  }

  async startSession(body) {
    return this.request('/api/sessions', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async snapshot(sessionName, options = {}) {
    const query = new URLSearchParams();
    if (options.lines) {
      query.set('lines', `${options.lines}`);
    }
    if (options.view) {
      query.set('view', `${options.view}`);
    }
    const suffix = query.toString();
    return this.request(`/api/sessions/${encodeURIComponent(sessionName)}/snapshot${suffix ? `?${suffix}` : ''}`, {
      timeoutMs: Number(options.timeoutMs || 15_000),
    });
  }

  async conversationItem(sessionName, itemId, options = {}) {
    const query = new URLSearchParams();
    if (options.lines) {
      query.set('lines', `${options.lines}`);
    }
    const suffix = query.toString();
    return this.request(
      `/api/sessions/${encodeURIComponent(sessionName)}/conversation/items/${encodeURIComponent(itemId)}${suffix ? `?${suffix}` : ''}`,
      {
        timeoutMs: Number(options.timeoutMs || 15_000),
      },
    );
  }

  async history(sessionName) {
    return this.request(`/api/sessions/${encodeURIComponent(sessionName)}/history`, {
      timeoutMs: 15_000,
    });
  }

  async sendInput(sessionName, body) {
    return this.request(`/api/sessions/${encodeURIComponent(sessionName)}/input`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async closeSession(sessionName) {
    return this.request(`/api/sessions/${encodeURIComponent(sessionName)}`, {
      method: 'DELETE',
    });
  }

  async renameSession(sessionName, body) {
    return this.request(`/api/sessions/${encodeURIComponent(sessionName)}/rename`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async listArtifacts(sessionName) {
    return this.request(`/api/sessions/${encodeURIComponent(sessionName)}/artifacts`);
  }

  async uploadPastedImage(sessionName, body) {
    return this.request(`/api/sessions/${encodeURIComponent(sessionName)}/pasted-images`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async fetchArtifact(sessionName, artifactName) {
    return fetch(
      `${this.agent.baseUrl}/api/sessions/${encodeURIComponent(sessionName)}/artifacts/${encodeURIComponent(
        artifactName,
      )}`,
      {
        headers: this.headers(),
      },
    );
  }
}
