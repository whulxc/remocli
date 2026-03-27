export class GotifyNotifier {
  constructor(config) {
    this.config = config?.gotify || null;
  }

  async send({ title, message, priority = 5, extras }) {
    if (!this.config?.baseUrl || !this.config?.token) {
      return false;
    }

    try {
      const body = {
        title,
        message,
        priority,
      };

      if (extras) {
        body.extras = extras;
      }

      const response = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}/message?token=${this.config.token}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      return response.ok;
    } catch {
      return false;
    }
  }
}
