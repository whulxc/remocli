function escapeHtml(value = '') {
  return `${value || ''}`
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderBrowserAppRedirectPage(appUrl = '') {
  const normalizedAppUrl = `${appUrl || ''}`.trim();
  const escapedAppUrl = escapeHtml(normalizedAppUrl);

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>返回 APP</title>
    <style>
      :root {
        color-scheme: light;
        font-family: "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;
        background: #f6f7fb;
        color: #1f2937;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at top left, rgba(22, 119, 255, 0.08), transparent 28%),
          linear-gradient(180deg, #f9fbff, #f4f6fb);
      }
      main {
        width: min(460px, calc(100vw - 32px));
        padding: 24px 20px;
        border-radius: 24px;
        background: rgba(255, 255, 255, 0.96);
        border: 1px solid #dbe2ef;
        box-shadow: 0 18px 40px rgba(15, 23, 42, 0.08);
      }
      h1 {
        margin: 0 0 12px;
        font-size: 1.25rem;
      }
      p {
        margin: 0;
        line-height: 1.6;
      }
      .actions {
        margin-top: 18px;
        display: flex;
      }
      .button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 46px;
        padding: 0 18px;
        border-radius: 16px;
        border: 0;
        background: #1677ff;
        color: #fff;
        font: inherit;
        font-weight: 700;
        text-decoration: none;
      }
      .hint {
        margin-top: 12px;
        color: #6b7280;
        font-size: 0.95rem;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>验证成功，正在返回 APP</h1>
      <p>如果浏览器没有自动回到 RemoCLI，请点击下面的按钮继续。</p>
      <div class="actions">
        <a class="button" id="open-app-button" href="${escapedAppUrl}">返回 APP</a>
      </div>
      <p class="hint">浏览器完成登录后，后续 PIN 验证会继续在 APP 内完成。</p>
    </main>
    <script>
      (() => {
        const appUrl = ${JSON.stringify(normalizedAppUrl)};
        let redirected = false;
        if (!appUrl) {
          return;
        }
        const openApp = () => {
          if (redirected) {
            return;
          }
          redirected = true;
          window.location.replace(appUrl);
        };
        window.addEventListener('pageshow', () => {
          redirected = false;
          window.setTimeout(openApp, 40);
        }, { once: true });
        window.setTimeout(openApp, 40);
        window.setTimeout(() => {
          redirected = false;
        }, 1200);
      })();
    </script>
  </body>
</html>`;
}
