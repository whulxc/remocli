package com.remoteconnect.mobile

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.ImageButton
import android.widget.PopupMenu
import android.widget.RadioGroup
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.google.android.material.button.MaterialButton
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout
import org.json.JSONObject
import kotlin.math.max

class MainActivity : AppCompatActivity() {
  private lateinit var store: SecureSessionStore
  private lateinit var notifier: SessionNotifier
  private val apiClient = RemoteApiClient()

  private lateinit var rootView: View
  private lateinit var webView: WebView
  private lateinit var emptyState: View
  private lateinit var emptyStateMessage: TextView
  private lateinit var authPanel: View
  private lateinit var gatewaySummaryView: TextView
  private lateinit var authModeSummaryView: TextView
  private lateinit var authPinLayout: TextInputLayout
  private lateinit var authPinInput: TextInputEditText
  private lateinit var authPrimaryButton: MaterialButton
  private lateinit var authBrowserButton: MaterialButton
  private lateinit var authSwitchGatewayButton: MaterialButton
  private lateinit var configureGatewayButton: MaterialButton
  private lateinit var retryGatewayButton: MaterialButton
  private lateinit var shellMenuButton: ImageButton
  private lateinit var loadingOverlay: View

  private var currentConnectionProfile: ConnectionProfile? = null
  private var currentGatewayUrl: String? = null
  private var currentAuthPolicy: AuthPolicy? = null
  private var pendingSessionId: String? = null
  private var pendingBrowserGrant: String? = null
  private var authPromptState: AuthPromptState? = null
  private var isGatewayAuthorized: Boolean = false
  private var authRequestVersion: Int = 0
  private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
  private var shouldReloadOnResume: Boolean = false
  private var lastLoadedUrl: String? = null
  private var pageLoadFailed: Boolean = false
  private var lastLoadErrorMessage: String? = null
  private var isActivityVisible: Boolean = false
  private var authRestoreRetryPending: Boolean = false
  private var autoRetryAttemptCount: Int = 0
  private val autoRetryHandler = Handler(Looper.getMainLooper())
  private val autoRetryRunnable = Runnable {
    if (!isActivityVisible || currentGatewayUrl.isNullOrBlank() || isFinishing || isDestroyed) {
      return@Runnable
    }

    if (authRestoreRetryPending) {
      Log.d(
        TAG,
        "autoRetryRememberedSession attempt=${autoRetryAttemptCount + 1} gateway=$currentGatewayUrl",
      )
      beginGatewayValidation()
      return@Runnable
    }

    if (!pageLoadFailed) {
      return@Runnable
    }

    Log.d(
      TAG,
      "autoRetryGateway attempt=${autoRetryAttemptCount + 1} gateway=$currentGatewayUrl",
    )
    loadGatewayPage(forceReload = true)
  }

  private val fileChooserLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
    val callback = fileChooserCallback
    fileChooserCallback = null
    callback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    Log.d(TAG, "onCreate intent=${intent?.dataString}")
    if (!BuildConfig.DEBUG) {
      window.setFlags(
        WindowManager.LayoutParams.FLAG_SECURE,
        WindowManager.LayoutParams.FLAG_SECURE,
      )
    }

    setContentView(R.layout.activity_main)
    store = SecureSessionStore(this)
    notifier = SessionNotifier(this)

    bindViews()
    setupInsets()
    setupBackNavigation()
    requestNotificationsIfNeeded()
    setupShellMenu()
    setupWebView()

    currentConnectionProfile = store.loadActiveProfile() ?: defaultConnectionProfile()?.also { store.saveActiveProfile(it) }
    currentGatewayUrl = currentConnectionProfile?.apiBaseUrl
    handleIntent(intent)
    renderGatewayState()

    if (!pendingBrowserGrant.isNullOrBlank()) {
      beginGatewayValidation()
    } else if (currentGatewayUrl.isNullOrBlank()) {
      showGatewayDialog(force = true)
    } else if (store.hasRefreshSession(currentConnectionProfile)) {
      beginGatewayValidation()
    } else {
      showGatewayDialog(force = true)
    }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    Log.d(TAG, "onNewIntent intent=${intent.dataString}")
    setIntent(intent)
    handleIntent(intent)
    renderGatewayState()
    if (currentGatewayUrl.isNullOrBlank()) {
      showGatewayDialog(force = true)
      return
    }

    if (!pendingBrowserGrant.isNullOrBlank()) {
      beginGatewayValidation()
    } else if (!isGatewayAuthorized && !store.hasRefreshSession(currentConnectionProfile)) {
      showGatewayDialog(force = true)
    } else if (!isGatewayAuthorized) {
      beginGatewayValidation()
    } else {
      loadGatewayPage(forceReload = true)
    }
  }

  override fun onResume() {
    super.onResume()
    isActivityVisible = true
    recoverWebViewIfNeeded()
    scheduleGatewayRetryIfNeeded()
  }

  override fun onPause() {
    super.onPause()
    isActivityVisible = false
    cancelGatewayRetry()
  }

  override fun onDestroy() {
    super.onDestroy()
    cancelGatewayRetry()
    fileChooserCallback?.onReceiveValue(null)
    fileChooserCallback = null
    webView.removeJavascriptInterface(ANDROID_BRIDGE_NAME)
    webView.destroy()
  }

  private fun bindViews() {
    rootView = findViewById(R.id.root)
    webView = findViewById(R.id.web_view)
    emptyState = findViewById(R.id.empty_state)
    emptyStateMessage = findViewById(R.id.empty_state_message)
    authPanel = findViewById(R.id.auth_panel)
    gatewaySummaryView = findViewById(R.id.gateway_summary_view)
    authModeSummaryView = findViewById(R.id.auth_mode_summary_view)
    authPinLayout = findViewById(R.id.auth_pin_layout)
    authPinInput = findViewById(R.id.auth_pin_input)
    authPrimaryButton = findViewById(R.id.auth_primary_button)
    authBrowserButton = findViewById(R.id.auth_browser_button)
    authSwitchGatewayButton = findViewById(R.id.auth_switch_gateway_button)
    configureGatewayButton = findViewById(R.id.configure_gateway_button)
    retryGatewayButton = findViewById(R.id.retry_gateway_button)
    shellMenuButton = findViewById(R.id.shell_menu_button)
    loadingOverlay = findViewById(R.id.loading_overlay)
  }

  private fun setupInsets() {
    ViewCompat.setOnApplyWindowInsetsListener(rootView) { view, insets ->
      val systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
      view.setPadding(systemBars.left, systemBars.top, systemBars.right, systemBars.bottom)
      insets
    }
  }

  private fun setupBackNavigation() {
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        handleWebBackOrFinish()
      }
    })
  }

  private fun requestNotificationsIfNeeded() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      ActivityCompat.requestPermissions(
        this,
        arrayOf(Manifest.permission.POST_NOTIFICATIONS),
        REQUEST_NOTIFICATIONS,
      )
    }
  }

  private fun setupShellMenu() {
    configureGatewayButton.setOnClickListener { showGatewayDialog(force = currentGatewayUrl.isNullOrBlank()) }
    retryGatewayButton.setOnClickListener {
      if (pageLoadFailed && isGatewayAuthorized) {
        loadGatewayPage(forceReload = true)
      } else {
        beginGatewayValidation()
      }
    }
    authPrimaryButton.setOnClickListener {
      when (authPromptState?.primaryAction) {
        AuthPrimaryAction.LOCAL_PIN,
        AuthPrimaryAction.BROWSER_PIN -> submitPinLogin()
        AuthPrimaryAction.NONE,
        null -> Unit
      }
    }
    authBrowserButton.setOnClickListener {
      launchBrowserValidation(userInitiated = true)
    }
    authSwitchGatewayButton.setOnClickListener {
      showGatewayDialog(force = false)
    }
    shellMenuButton.setOnClickListener { showShellMenu() }
  }

  @SuppressLint("SetJavaScriptEnabled")
  private fun setupWebView() {
    WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

    val cookieManager = CookieManager.getInstance()
    cookieManager.setAcceptCookie(true)
    cookieManager.setAcceptThirdPartyCookies(webView, false)

    webView.settings.apply {
      javaScriptEnabled = true
      domStorageEnabled = true
      databaseEnabled = true
      loadsImagesAutomatically = true
      allowContentAccess = false
      allowFileAccess = false
      mediaPlaybackRequiresUserGesture = false
      mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
      userAgentString = "$userAgentString RemoteConnectAndroid"
    }

    webView.addJavascriptInterface(WebAppBridge(), ANDROID_BRIDGE_NAME)
    webView.webChromeClient = object : WebChromeClient() {
      override fun onShowFileChooser(
        view: WebView?,
        filePathCallback: ValueCallback<Array<Uri>>?,
        fileChooserParams: FileChooserParams?,
      ): Boolean {
        if (filePathCallback == null) {
          return false
        }

        fileChooserCallback?.onReceiveValue(null)
        fileChooserCallback = filePathCallback

        val chooserIntent = try {
          fileChooserParams?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "image/*"
          }
        } catch (error: Exception) {
          Log.w(TAG, "createIntent for file chooser failed", error)
          null
        }

        if (chooserIntent == null) {
          fileChooserCallback = null
          Toast.makeText(this@MainActivity, R.string.file_picker_failed, Toast.LENGTH_SHORT).show()
          return false
        }

        return try {
          fileChooserLauncher.launch(chooserIntent)
          true
        } catch (_: ActivityNotFoundException) {
          fileChooserCallback?.onReceiveValue(null)
          fileChooserCallback = null
          Toast.makeText(this@MainActivity, R.string.file_picker_failed, Toast.LENGTH_SHORT).show()
          false
        }
      }

      override fun onConsoleMessage(consoleMessage: ConsoleMessage): Boolean {
        Log.d(TAG, "web ${consoleMessage.messageLevel()}: ${consoleMessage.message()} @${consoleMessage.sourceId()}:${consoleMessage.lineNumber()}")
        return super.onConsoleMessage(consoleMessage)
      }
    }

    webView.webViewClient = object : WebViewClient() {
      override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
        val uri = request?.url ?: return false
        return maybeOpenExternally(uri)
      }

      override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
        Log.d(TAG, "onPageStarted url=$url")
        pageLoadFailed = false
        lastLoadErrorMessage = null
        cancelGatewayRetry()
        renderGatewayState()
        showLoading(true)
      }

      override fun onPageFinished(view: WebView?, url: String?) {
        Log.d(
          TAG,
          "onPageFinished url=$url progress=${view?.progress ?: -1} contentHeight=${view?.contentHeight ?: -1}",
        )
        if (!pageLoadFailed) {
          lastLoadErrorMessage = null
          autoRetryAttemptCount = 0
          cancelGatewayRetry()
        }
        renderGatewayState()
        showLoading(false)
      }

      override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
        if (request?.isForMainFrame == true) {
          Log.w(
            TAG,
            "onReceivedError url=${request.url} code=${error?.errorCode} description=${error?.description}",
          )
          pageLoadFailed = true
          lastLoadErrorMessage = error?.description?.toString()?.takeIf { it.isNotBlank() }
          autoRetryAttemptCount += 1
          renderGatewayState()
          showLoading(false)
          scheduleGatewayRetryIfNeeded()
        }
      }
    }
  }

  private fun beginGatewayValidation() {
    val gateway = currentGatewayUrl
    if (gateway.isNullOrBlank()) {
      isGatewayAuthorized = false
      currentAuthPolicy = null
      authPromptState = null
      authRestoreRetryPending = false
      renderGatewayState()
      return
    }

    cancelGatewayRetry()
    pageLoadFailed = false
    lastLoadErrorMessage = null
    autoRetryAttemptCount = 0
    authRestoreRetryPending = false
    isGatewayAuthorized = false

    if (!pendingBrowserGrant.isNullOrBlank()) {
      currentAuthPolicy = currentAuthPolicy ?: buildPublicAuthPolicy(gateway)
      showBrowserPinPrompt()
      return
    }

    val requestVersion = nextAuthRequestVersion()
    if (restoreSavedDeviceSession(gateway, requestVersion)) {
      return
    }

    continueGatewayValidation(gateway, requestVersion)
  }

  private fun continueGatewayValidation(gateway: String, requestVersion: Int) {
    showLoading(false)

    if (shouldUseBrowserFirstValidation(gateway)) {
      currentAuthPolicy = buildPublicAuthPolicy(gateway)
      showBrowserHandoffPrompt()
      return
    }

    showAuthPrompt(
      AuthPromptState(
        message = getString(R.string.gateway_auth_loading),
        modeSummary = "",
      ),
    )
    showLoading(true)

    Thread {
      try {
        val policy = apiClient.fetchAuthPolicy(gateway)
        runOnUiThread {
          if (!isAuthResponseCurrent(requestVersion, gateway)) {
            return@runOnUiThread
          }

          showLoading(false)
          currentAuthPolicy = policy
          when {
            policy.browserLoginEnabled -> {
              showBrowserHandoffPrompt()
            }
            policy.publicMode && policy.trustedLocalLoginEnabled -> showPreviewPublicPinPrompt()
            policy.trustedLocalLoginEnabled -> showLocalPinPrompt()
            else -> {
              showAuthPrompt(
                AuthPromptState(
                  message = getString(R.string.login_unavailable),
                  modeSummary = modeSummaryFor(policy),
                  allowRetry = true,
                ),
              )
            }
          }
        }
      } catch (error: Throwable) {
        runOnUiThread {
          if (!isAuthResponseCurrent(requestVersion, gateway)) {
            return@runOnUiThread
          }
          showLoading(false)
          showAuthPrompt(
            AuthPromptState(
              message = friendlyRemoteError(error),
              modeSummary = "",
              allowRetry = true,
            ),
          )
        }
      }
    }.start()
  }

  private fun restoreSavedDeviceSession(gateway: String, requestVersion: Int): Boolean {
    val refreshToken = store.loadAuthSession(currentConnectionProfile)?.refreshToken?.trim().orEmpty()
    if (refreshToken.isBlank()) {
      return false
    }

    showAuthPrompt(
      AuthPromptState(
        message = getString(R.string.gateway_auth_restoring),
        modeSummary = if (shouldUseBrowserFirstValidation(gateway)) {
          getString(R.string.gateway_public_auth_summary)
        } else {
          getString(R.string.gateway_local_auth_summary)
        },
      ),
    )
    showLoading(true)

    Thread {
      try {
        val tokens = apiClient.refresh(gateway, refreshToken)
        runOnUiThread {
          if (!isAuthResponseCurrent(requestVersion, gateway)) {
            return@runOnUiThread
          }

          showLoading(false)
          completeNativeLogin(tokens)
        }
      } catch (error: Throwable) {
        Log.w(TAG, "restoreSavedDeviceSession failed gateway=$gateway", error)
        runOnUiThread {
          if (!isAuthResponseCurrent(requestVersion, gateway)) {
            return@runOnUiThread
          }

          showLoading(false)
          if (shouldClearRememberedSession(error)) {
            store.clearAuth(currentConnectionProfile)
            continueGatewayValidation(gateway, requestVersion)
            return@runOnUiThread
          }

          authRestoreRetryPending = true
          autoRetryAttemptCount += 1
          showAuthPrompt(
            AuthPromptState(
              message = getString(
                R.string.gateway_auth_restore_retrying,
                friendlyRemoteError(error),
              ),
              modeSummary = rememberedSessionModeSummary(gateway),
              allowRetry = true,
            ),
          )
          scheduleGatewayRetryIfNeeded()
        }
      }
    }.start()

    return true
  }

  private fun showLocalPinPrompt() {
    showAuthPrompt(
      AuthPromptState(
        message = getString(R.string.gateway_local_auth_message),
        modeSummary = getString(R.string.gateway_local_auth_summary),
        showPin = true,
        primaryAction = AuthPrimaryAction.LOCAL_PIN,
        primaryLabelRes = R.string.pin_login,
      ),
    )
  }

  private fun showPreviewPublicPinPrompt() {
    showAuthPrompt(
      AuthPromptState(
        message = getString(R.string.gateway_preview_auth_message),
        modeSummary = getString(R.string.gateway_preview_auth_summary),
        showPin = true,
        primaryAction = AuthPrimaryAction.LOCAL_PIN,
        primaryLabelRes = R.string.pin_login,
      ),
    )
  }

  private fun showBrowserHandoffPrompt(message: String = getString(R.string.gateway_public_auth_message)) {
    showAuthPrompt(
      AuthPromptState(
        message = message,
        modeSummary = getString(R.string.gateway_public_auth_summary),
        showBrowserButton = true,
      ),
    )
  }

  private fun showBrowserPinPrompt(message: String = getString(R.string.gateway_browser_pin_message)) {
    showAuthPrompt(
      AuthPromptState(
        message = message,
        modeSummary = getString(R.string.gateway_public_auth_summary),
        showPin = true,
        primaryAction = AuthPrimaryAction.BROWSER_PIN,
        primaryLabelRes = R.string.pin_login,
      ),
    )
  }

  private fun buildPublicAuthPolicy(gateway: String): AuthPolicy {
    return AuthPolicy(
      publicMode = true,
      browserLoginEnabled = true,
      trustedLocalLoginEnabled = false,
      deviceRevocationEnabled = true,
      browserLoginPath = "/api/auth/browser/start",
      localLoginPath = "/api/auth/local-login",
      refreshPath = "/api/auth/refresh",
      devicesPath = "/api/devices",
      publicBaseUrl = gateway,
      mobileDeepLinkBase = null,
      entryOrigin = currentConnectionProfile?.entryUrl,
      apiOrigin = gateway,
      currentTrustedIdentity = null,
    )
  }

  private fun showAuthPrompt(prompt: AuthPromptState) {
    authPromptState = prompt
    authPinLayout.error = null
    if (!prompt.showPin) {
      authPinInput.text?.clear()
    }
    renderGatewayState()
  }

  private fun submitPinLogin() {
    val gateway = currentGatewayUrl ?: return
    val prompt = authPromptState ?: return
    val pin = authPinInput.text?.toString().orEmpty().trim()
    if (pin.isBlank()) {
      authPinLayout.error = getString(R.string.pin_required)
      return
    }

    authPinLayout.error = null
    val requestVersion = nextAuthRequestVersion()
    val action = prompt.primaryAction
    showLoading(true)

    Thread {
      try {
        val tokens = when (action) {
          AuthPrimaryAction.LOCAL_PIN -> apiClient.localLogin(gateway, pin, store.deviceId, store.deviceName)
          AuthPrimaryAction.BROWSER_PIN -> {
            val grant = pendingBrowserGrant ?: throw IllegalStateException(getString(R.string.gateway_browser_grant_expired))
            apiClient.exchangeGrant(gateway, grant, pin, store.deviceId, store.deviceName)
          }
          AuthPrimaryAction.NONE -> return@Thread
        }

        runOnUiThread {
          if (!isAuthResponseCurrent(requestVersion, gateway)) {
            return@runOnUiThread
          }

          showLoading(false)
          completeNativeLogin(tokens)
        }
      } catch (error: Throwable) {
        runOnUiThread {
          if (!isAuthResponseCurrent(requestVersion, gateway)) {
            return@runOnUiThread
          }

          showLoading(false)
          val message = friendlyRemoteError(error)
          if (
            action == AuthPrimaryAction.BROWSER_PIN &&
            (message == getString(R.string.gateway_browser_grant_expired)
              || message == getString(R.string.trusted_browser_missing))
          ) {
            pendingBrowserGrant = null
            showBrowserHandoffPrompt(message)
          } else {
            authPinLayout.error = message
          }
        }
      }
    }.start()
  }

  private fun completeNativeLogin(tokens: AuthTokens) {
    val gateway = currentGatewayUrl ?: return
    store.saveAuth(currentConnectionProfile, tokens)
    applyGatewaySessionCookie(gateway, tokens.accessToken, tokens.expiresAt)
    pendingBrowserGrant = null
    pendingSessionId = tokens.redirectSessionId ?: pendingSessionId
    authRestoreRetryPending = false
    autoRetryAttemptCount = 0
    isGatewayAuthorized = true
    authPromptState = null
    renderGatewayState()
    loadGatewayPage(forceReload = true)
  }

  private fun handleWebLogout() {
    val gateway = currentGatewayUrl
    store.clearAuth(currentConnectionProfile)
    pendingBrowserGrant = null
    pendingSessionId = null
    authRestoreRetryPending = false
    autoRetryAttemptCount = 0
    currentAuthPolicy = null
    authPromptState = null
    isGatewayAuthorized = false
    pageLoadFailed = false
    lastLoadErrorMessage = null

    if (!gateway.isNullOrBlank()) {
      clearGatewaySessionCookie(gateway)
    }

    closeWebViewIntoGatewayAuth()
  }

  private fun applyGatewaySessionCookie(gateway: String, accessToken: String, expiresAt: Long) {
    val cookieManager = CookieManager.getInstance()
    val maxAgeSeconds = max(0L, (expiresAt - System.currentTimeMillis()) / 1000L)
    val secureFlag = if (gateway.startsWith("https://", ignoreCase = true)) "; Secure" else ""
    val cookie = "remote_connect_session=$accessToken; Path=/; Max-Age=$maxAgeSeconds; SameSite=Strict$secureFlag"
    cookieManager.setCookie(gateway, cookie)
    cookieManager.flush()
  }

  private fun clearGatewaySessionCookie(gateway: String) {
    val cookieManager = CookieManager.getInstance()
    val secureFlag = if (gateway.startsWith("https://", ignoreCase = true)) "; Secure" else ""
    val cookie = "remote_connect_session=; Path=/; Max-Age=0; SameSite=Strict$secureFlag"
    cookieManager.setCookie(gateway, cookie)
    cookieManager.flush()
  }

  private fun closeWebViewIntoGatewayAuth() {
    webView.stopLoading()
    webView.loadUrl("about:blank")
    renderGatewayState()
    if (currentGatewayUrl.isNullOrBlank()) {
      showGatewayDialog(force = true)
    } else {
      beginGatewayValidation()
    }
  }

  private fun launchBrowserValidation(userInitiated: Boolean = false) {
    if (!userInitiated) {
      Log.d(TAG, "Ignored non-user browser launch request")
      return
    }

    if (authPromptState?.showBrowserButton != true) {
      Log.d(TAG, "Ignored browser launch request because the browser button is not active")
      return
    }

    val profile = currentConnectionProfile ?: return
    val browserUrl = buildBrowserLoginUrl(profile, pendingSessionId)
    shouldReloadOnResume = false
    openExternal(browserUrl)
  }

  private fun buildBrowserLoginUrl(profile: ConnectionProfile, sessionId: String?): Uri {
    val queryParts = mutableListOf(
      "deviceId=${Uri.encode(store.deviceId)}",
      "deviceName=${Uri.encode(store.deviceName)}",
      "profile=${Uri.encode(profile.id)}",
      "gateway=${Uri.encode(profile.apiBaseUrl)}",
      "entry=${Uri.encode(profile.entryUrl)}",
    )
    if (!sessionId.isNullOrBlank()) {
      queryParts.add("session=${Uri.encode(sessionId)}")
    }
    return Uri.parse("${profile.entryUrl.trimEnd('/')}/api/auth/browser/start?${queryParts.joinToString("&")}")
  }

  private fun nextAuthRequestVersion(): Int {
    authRequestVersion += 1
    return authRequestVersion
  }

  private fun isAuthResponseCurrent(requestVersion: Int, gateway: String): Boolean {
    return requestVersion == authRequestVersion && gateway == currentGatewayUrl
  }

  private fun modeSummaryFor(policy: AuthPolicy): String {
    return if (policy.browserLoginEnabled) {
      getString(R.string.gateway_public_auth_summary)
    } else if (policy.publicMode && policy.trustedLocalLoginEnabled) {
      getString(R.string.gateway_preview_auth_summary)
    } else {
      getString(R.string.gateway_local_auth_summary)
    }
  }

  private fun rememberedSessionModeSummary(gateway: String): String {
    return if (shouldUseBrowserFirstValidation(gateway)) {
      getString(R.string.gateway_public_auth_summary)
    } else if (isQuickTunnelPreviewGateway(gateway)) {
      getString(R.string.gateway_preview_auth_summary)
    } else {
      getString(R.string.gateway_local_auth_summary)
    }
  }

  private fun shouldClearRememberedSession(error: Throwable): Boolean {
    return (error as? RemoteApiException)?.statusCode == 401
  }

  private fun shouldUseBrowserFirstValidation(gateway: String): Boolean {
    currentConnectionProfile?.let { profile ->
      return when (profile.mode) {
        ConnectionProfile.MODE_PUBLIC_TEAM_DOMAIN -> true
        ConnectionProfile.MODE_PUBLIC_CUSTOM_DOMAIN -> !isQuickTunnelPreviewGateway(profile.apiBaseUrl)
        else -> false
      }
    }

    val uri = Uri.parse(gateway)
    val host = uri.host?.trim()?.lowercase().orEmpty()
    if (host.isBlank()) {
      return false
    }

    return !isTrustedLocalHost(host) && !isQuickTunnelPreviewGateway(gateway)
  }

  private fun isQuickTunnelPreviewGateway(gateway: String): Boolean {
    val host = Uri.parse(gateway).host?.trim()?.lowercase().orEmpty()
    return host.endsWith(".trycloudflare.com")
  }

  private fun isTrustedLocalHost(host: String): Boolean {
    if (host == "localhost" || host == "127.0.0.1" || host == "::1") {
      return true
    }

    if (host.endsWith(".local") || host.endsWith(".lan") || host.endsWith(".home")) {
      return true
    }

    if (!host.contains('.')) {
      return true
    }

    val segments = host.split('.')
    if (segments.size == 4 && segments.all { segment -> segment.all(Char::isDigit) }) {
      val first = segments[0].toIntOrNull() ?: return false
      val second = segments[1].toIntOrNull() ?: return false
      return when {
        first == 10 -> true
        first == 192 && second == 168 -> true
        first == 172 && second in 16..31 -> true
        else -> false
      }
    }

    return false
  }

  private fun friendlyRemoteError(error: Throwable): String {
    val rawMessage = (error.message ?: error.toString()).trim()
    val parsedMessage = if (rawMessage.startsWith("{") && rawMessage.endsWith("}")) {
      try {
        JSONObject(rawMessage).optString("error").ifBlank { rawMessage }
      } catch (_: Exception) {
        rawMessage
      }
    } else {
      rawMessage
    }

    return when {
      parsedMessage.contains("Invalid PIN") -> getString(R.string.invalid_pin)
      parsedMessage.contains("Trusted browser identity required") -> getString(R.string.trusted_browser_missing)
      parsedMessage.contains("Grant is invalid or expired") -> getString(R.string.gateway_browser_grant_expired)
      parsedMessage.contains("Cloudflare Access is still intercepting") ->
        "当前公网入口还在用 Cloudflare Access 拦截 APP 的认证接口，所以这次请求没有到达网关。"
      parsedMessage.contains("Browser login is disabled") -> getString(R.string.login_browser_disabled)
      parsedMessage.contains("Local login is disabled") -> getString(R.string.login_local_disabled)
      parsedMessage.isBlank() -> getString(R.string.status_failed)
      else -> parsedMessage
    }
  }

  private fun maybeOpenExternally(uri: Uri): Boolean {
    val scheme = uri.scheme?.lowercase() ?: return false
    if (scheme != "http" && scheme != "https") {
      openExternal(uri)
      return true
    }

    val gateway = currentGatewayUrl ?: return false
    val gatewayUri = Uri.parse(gateway)
    val sameHost = uri.host == gatewayUri.host
    val samePort = normalizedPort(uri) == normalizedPort(gatewayUri)
    if (!sameHost || !samePort) {
      openExternal(uri)
      return true
    }
    return false
  }

  private fun normalizedPort(uri: Uri): Int {
    return when {
      uri.port >= 0 -> uri.port
      uri.scheme.equals("https", ignoreCase = true) -> 443
      uri.scheme.equals("http", ignoreCase = true) -> 80
      else -> -1
    }
  }

  private fun showShellMenu() {
    PopupMenu(this, shellMenuButton).apply {
      menuInflater.inflate(R.menu.main_actions, menu)
      setOnMenuItemClickListener { item ->
        when (item.itemId) {
          R.id.action_configure -> {
            showGatewayDialog(force = false)
            true
          }
          R.id.action_reload -> {
            webView.reload()
            true
          }
          R.id.action_open_external -> {
            openCurrentPageInBrowser()
            true
          }
          else -> false
        }
      }
      show()
    }
  }

  private fun handleIntent(intent: Intent?) {
    val data = intent?.data ?: return
    Log.d(TAG, "handleIntent data=$data")
    if (data.scheme != APP_SCHEME || data.host != APP_HOST) {
      return
    }

    val nextGateway = ConnectionProfile.normalizeUrl(data.getQueryParameter("gateway").orEmpty()) ?: currentGatewayUrl
    val nextEntry = ConnectionProfile.normalizeUrl(data.getQueryParameter("entry").orEmpty()) ?: currentConnectionProfile?.entryUrl ?: nextGateway
    val nextProfile = if (!nextEntry.isNullOrBlank() && !nextGateway.isNullOrBlank()) {
      ConnectionProfile.fromUrls(nextEntry, nextGateway)
    } else {
      currentConnectionProfile
    }

    if (nextProfile != null && nextProfile.sessionScopeKey() != currentConnectionProfile?.sessionScopeKey()) {
      currentConnectionProfile = nextProfile
      currentGatewayUrl = nextProfile.apiBaseUrl
      store.saveActiveProfile(nextProfile)
      authRestoreRetryPending = false
      isGatewayAuthorized = false
      currentAuthPolicy = null
      authPromptState = null
      pageLoadFailed = false
      lastLoadErrorMessage = null
    } else if (nextProfile != null) {
      currentConnectionProfile = nextProfile
      currentGatewayUrl = nextProfile.apiBaseUrl
      store.saveActiveProfile(nextProfile)
    }

    val grant = data.getQueryParameter("grant")?.takeIf { it.isNotBlank() }
    if (!grant.isNullOrBlank()) {
      pendingBrowserGrant = grant
      isGatewayAuthorized = false
      pageLoadFailed = false
      lastLoadErrorMessage = null
    }
    pendingSessionId = data.getQueryParameter("session")?.takeIf { it.isNotBlank() } ?: pendingSessionId
    maybeHandleDebugNotification(data)
  }

  private fun maybeHandleDebugNotification(data: Uri) {
    if (!BuildConfig.DEBUG) {
      return
    }

    val kind = data.getQueryParameter("debugNotify")?.trim().orEmpty()
    if (kind.isBlank()) {
      return
    }

    val title = data.getQueryParameter("debugTitle")?.takeIf { it.isNotBlank() } ?: "RemoCLI debug notification"
    val body = data.getQueryParameter("debugBody")?.takeIf { it.isNotBlank() } ?: "Debug notification triggered from deep link."
    val showNotification = data.getQueryParameter("debugShowNotification")?.toBooleanStrictOrNull() ?: true
    val playSound = data.getQueryParameter("debugPlaySound")?.toBooleanStrictOrNull() ?: true
    val shouldVibrate = data.getQueryParameter("debugVibrate")?.toBooleanStrictOrNull() ?: true
    Log.d(
      TAG,
      "debug notification trigger kind=$kind notify=$showNotification sound=$playSound vibrate=$shouldVibrate",
    )
    notifier.show(kind, title, body, showNotification, playSound, shouldVibrate)
  }

  private fun renderGatewayState() {
    val hasGateway = !currentGatewayUrl.isNullOrBlank()
    val authState = authPromptState
    val showAuthPrompt = hasGateway && !isGatewayAuthorized && !pageLoadFailed && authState != null
    val showFallback = !hasGateway || pageLoadFailed || showAuthPrompt
    val modeSummary = authState?.modeSummary.orEmpty()
    val primaryLabelRes = authState?.primaryLabelRes
    val gatewaySummary = when {
      currentConnectionProfile == null || currentGatewayUrl.isNullOrBlank() -> ""
      currentConnectionProfile?.entryUrl == currentGatewayUrl ->
        getString(R.string.gateway_summary_format, "${currentConnectionProfile?.label.orEmpty()} · ${currentGatewayUrl.orEmpty()}")
      else ->
        getString(
          R.string.gateway_summary_format,
          "${currentConnectionProfile?.label.orEmpty()} · 入口 ${currentConnectionProfile?.entryUrl.orEmpty()} · API ${currentGatewayUrl.orEmpty()}",
        )
    }

    emptyState.visibility = if (showFallback) View.VISIBLE else View.GONE
    webView.visibility = if (showFallback) View.GONE else View.VISIBLE

    emptyStateMessage.text = when {
      !hasGateway -> getString(R.string.web_shell_hint)
      pageLoadFailed -> getString(
        R.string.gateway_unreachable_message,
        currentGatewayUrl.orEmpty(),
        lastLoadErrorMessage ?: getString(R.string.status_failed),
      )
      showAuthPrompt -> authState?.message ?: getString(R.string.gateway_auth_loading)
      else -> getString(R.string.web_shell_hint)
    }

    authPanel.visibility = if (showAuthPrompt) View.VISIBLE else View.GONE
    gatewaySummaryView.text = gatewaySummary
    authModeSummaryView.text = modeSummary
    authModeSummaryView.visibility = if (showAuthPrompt && modeSummary.isNotBlank()) View.VISIBLE else View.GONE
    authPinLayout.visibility = if (showAuthPrompt && authState?.showPin == true) View.VISIBLE else View.GONE
    authPrimaryButton.visibility = if (
      showAuthPrompt &&
      authState?.primaryAction != AuthPrimaryAction.NONE &&
      primaryLabelRes != null
    ) {
      View.VISIBLE
    } else {
      View.GONE
    }
    authPrimaryButton.text = if (primaryLabelRes != null) getString(primaryLabelRes) else ""
    authBrowserButton.visibility = if (showAuthPrompt && authState?.showBrowserButton == true) View.VISIBLE else View.GONE
    authSwitchGatewayButton.visibility = if (showAuthPrompt && hasGateway) View.VISIBLE else View.GONE

    configureGatewayButton.text = getString(if (hasGateway) R.string.gateway_switch else R.string.gateway_configure)
    configureGatewayButton.visibility = if (showAuthPrompt) View.GONE else View.VISIBLE
    retryGatewayButton.visibility = if ((pageLoadFailed && hasGateway) || (showAuthPrompt && authState?.allowRetry == true)) {
      View.VISIBLE
    } else {
      View.GONE
    }
    shellMenuButton.visibility = View.GONE
  }

  private fun cancelGatewayRetry() {
    autoRetryHandler.removeCallbacks(autoRetryRunnable)
  }

  private fun scheduleGatewayRetryIfNeeded() {
    if (!isActivityVisible || currentGatewayUrl.isNullOrBlank() || (!pageLoadFailed && !authRestoreRetryPending)) {
      return
    }

    cancelGatewayRetry()
    val delayMillis = if (autoRetryAttemptCount <= 1) {
      AUTO_RETRY_INITIAL_DELAY_MS
    } else {
      AUTO_RETRY_STEADY_DELAY_MS
    }
    Log.d(
      TAG,
      "scheduleGatewayRetry delay=${delayMillis}ms attempt=$autoRetryAttemptCount gateway=$currentGatewayUrl pageLoadFailed=$pageLoadFailed authRestoreRetryPending=$authRestoreRetryPending",
    )
    autoRetryHandler.postDelayed(autoRetryRunnable, delayMillis)
  }

  private fun handleWebBackOrFinish() {
    if (webView.visibility != View.VISIBLE) {
      finish()
      return
    }

    webView.evaluateJavascript(
      """
        (() => {
          try {
            return Boolean(window.RemoteConnectAppHandleSystemBack && window.RemoteConnectAppHandleSystemBack());
          } catch (_error) {
            return false;
          }
        })();
      """.trimIndent(),
    ) { result ->
      if (result == "true") {
        return@evaluateJavascript
      }
      if (webView.canGoBack()) {
        webView.goBack()
      } else {
        finish()
      }
    }
  }

  private fun loadGatewayPage(sessionId: String? = pendingSessionId, forceReload: Boolean = false) {
    val gateway = currentGatewayUrl ?: return
    cancelGatewayRetry()
    pageLoadFailed = false
    lastLoadErrorMessage = null
    renderGatewayState()
    val targetUrl = buildGatewayPageUrl(gateway, sessionId)
    lastLoadedUrl = targetUrl
    pendingSessionId = null
    if (forceReload || webView.url != targetUrl) {
      Log.d(TAG, "loadGatewayPage target=$targetUrl forceReload=$forceReload current=${webView.url}")
      webView.loadUrl(targetUrl)
    } else {
      Log.d(TAG, "reloadGatewayPage target=$targetUrl")
      webView.reload()
    }
  }

  private fun buildGatewayPageUrl(gateway: String, sessionId: String?): String {
    val uri = Uri.parse(gateway)
    val builder = uri.buildUpon().clearQuery()
    if (!sessionId.isNullOrBlank()) {
      builder.appendQueryParameter("session", sessionId)
    }
    return builder.build().toString()
  }

  private fun showGatewayDialog(force: Boolean) {
    val dialogView = layoutInflater.inflate(R.layout.dialog_gateway, null)
    val modeGroup = dialogView.findViewById<RadioGroup>(R.id.gateway_mode_group)
    val input = dialogView.findViewById<TextInputEditText>(R.id.gateway_input)
    val apiInput = dialogView.findViewById<TextInputEditText>(R.id.gateway_api_input)
    val defaultProfile = defaultConnectionProfile()
    val initialProfile = currentConnectionProfile ?: defaultProfile
    input.setText(initialProfile?.entryUrl.orEmpty())
    apiInput.setText(
      initialProfile?.apiBaseUrl
        ?.takeIf { it != initialProfile.entryUrl }
        ?: "",
    )
    setGatewayModeSelection(modeGroup, initialProfile?.mode ?: ConnectionProfile.MODE_USB_DIRECT)

    val dialog = MaterialAlertDialogBuilder(this)
      .setTitle(R.string.gateway_dialog_title)
      .setView(dialogView)
      .setPositiveButton(R.string.gateway_dialog_validate, null)
      .setNeutralButton(if (defaultProfile == null) R.string.cancel else R.string.gateway_dialog_local_usb, null)
      .setNegativeButton(if (force) R.string.exit else R.string.cancel) { _, _ ->
        if (force) {
          finish()
        }
      }
      .create()

    dialog.setOnShowListener {
      dialog.getButton(AlertDialog.BUTTON_NEUTRAL)?.setOnClickListener {
        val localProfile = defaultConnectionProfile() ?: return@setOnClickListener
        setGatewayModeSelection(modeGroup, localProfile.mode)
        input.setText(localProfile.entryUrl)
        input.setSelection(localProfile.entryUrl.length)
        apiInput.setText("")
      }
      dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
        val profile = ConnectionProfile.fromMode(
          mode = selectedGatewayMode(modeGroup),
          entryUrl = input.text?.toString().orEmpty(),
          apiBaseUrl = apiInput.text?.toString().orEmpty(),
        )
        if (profile == null) {
          input.error = getString(R.string.gateway_dialog_error)
          return@setOnClickListener
        }

        currentConnectionProfile = profile
        currentGatewayUrl = profile.apiBaseUrl
        store.saveActiveProfile(profile)
        authRestoreRetryPending = false
        currentAuthPolicy = null
        pendingBrowserGrant = null
        isGatewayAuthorized = false
        authPromptState = null
        autoRetryAttemptCount = 0
        pageLoadFailed = false
        lastLoadErrorMessage = null
        renderGatewayState()
        beginGatewayValidation()
        dialog.dismiss()
      }
    }

    dialog.setCancelable(!force)
    dialog.show()
  }

  private fun setGatewayModeSelection(group: RadioGroup, mode: String) {
    val checkedId = when (mode) {
      ConnectionProfile.MODE_USB_DIRECT -> R.id.gateway_mode_usb
      ConnectionProfile.MODE_LAN_DIRECT -> R.id.gateway_mode_lan
      ConnectionProfile.MODE_PUBLIC_TEAM_DOMAIN -> R.id.gateway_mode_public_team
      else -> R.id.gateway_mode_public_custom
    }
    group.check(checkedId)
  }

  private fun selectedGatewayMode(group: RadioGroup): String {
    return when (group.checkedRadioButtonId) {
      R.id.gateway_mode_usb -> ConnectionProfile.MODE_USB_DIRECT
      R.id.gateway_mode_lan -> ConnectionProfile.MODE_LAN_DIRECT
      R.id.gateway_mode_public_team -> ConnectionProfile.MODE_PUBLIC_TEAM_DOMAIN
      else -> ConnectionProfile.MODE_PUBLIC_CUSTOM_DOMAIN
    }
  }

  private fun openCurrentPageInBrowser() {
    val target = webView.url ?: currentGatewayUrl ?: return
    shouldReloadOnResume = true
    openExternal(Uri.parse(target))
  }

  private fun openExternal(uri: Uri) {
    try {
      startActivity(Intent(Intent.ACTION_VIEW, uri))
    } catch (_: ActivityNotFoundException) {
      Toast.makeText(this, R.string.browser_missing, Toast.LENGTH_SHORT).show()
    }
  }

  private fun showLoading(visible: Boolean) {
    loadingOverlay.visibility = if (visible) View.VISIBLE else View.GONE
  }

  private fun recoverWebViewIfNeeded() {
    if (pageLoadFailed) {
      scheduleGatewayRetryIfNeeded()
      shouldReloadOnResume = false
      return
    }

    if (currentGatewayUrl.isNullOrBlank() || webView.visibility != View.VISIBLE) {
      shouldReloadOnResume = false
      return
    }

    val currentUrl = webView.url
    val isBlankPage = currentUrl.isNullOrBlank() || currentUrl == "about:blank"
    val hasNoVisibleContent = webView.progress >= 100 && webView.contentHeight == 0
    if (!shouldReloadOnResume && !isBlankPage && !hasNoVisibleContent) {
      return
    }

    shouldReloadOnResume = false
    Log.d(
      TAG,
      "recoverWebViewIfNeeded currentUrl=$currentUrl progress=${webView.progress} contentHeight=${webView.contentHeight} lastLoaded=$lastLoadedUrl",
    )
    webView.post {
      loadGatewayPage(forceReload = true)
    }
  }

  private fun normalizeUrl(raw: String): String? {
    return ConnectionProfile.normalizeUrl(raw)
  }

  private fun defaultConnectionProfile(): ConnectionProfile? {
    return if (BuildConfig.ALLOW_DEBUG_LOCALHOST) {
      ConnectionProfile.fromUrls("http://127.0.0.1:8080")
    } else {
      null
    }
  }

  private fun withTrustedBridgeCaller(actionName: String, action: () -> Unit) {
    val gateway = currentGatewayUrl?.trim().orEmpty()
    val currentUrl = webView.url?.trim().orEmpty()
    if (!isTrustedBridgeCaller(currentUrl, gateway)) {
      Log.w(TAG, "Rejected bridge action=$actionName currentUrl=$currentUrl gateway=$gateway")
      return
    }
    runOnUiThread(action)
  }

  private fun isTrustedBridgeCaller(currentUrl: String, gatewayUrl: String): Boolean {
    if (currentUrl.isBlank() || gatewayUrl.isBlank()) {
      return false
    }

    val currentUri = Uri.parse(currentUrl)
    val gatewayUri = Uri.parse(gatewayUrl)
    val currentScheme = currentUri.scheme?.lowercase().orEmpty()
    val gatewayScheme = gatewayUri.scheme?.lowercase().orEmpty()
    if ((currentScheme != "http" && currentScheme != "https") || (gatewayScheme != "http" && gatewayScheme != "https")) {
      return false
    }

    return currentUri.host == gatewayUri.host && normalizedPort(currentUri) == normalizedPort(gatewayUri)
  }

  private inner class WebAppBridge {
    @JavascriptInterface
    fun reloadPage() {
      withTrustedBridgeCaller("reloadPage") {
        webView.reload()
      }
    }

    @JavascriptInterface
    fun openExternalBrowser() {
      withTrustedBridgeCaller("openExternalBrowser") {
        openCurrentPageInBrowser()
      }
    }

    @JavascriptInterface
    fun notifyState(kind: String?, title: String?, body: String?) {
      withTrustedBridgeCaller("notifyState") {
        notifier.show(kind.orEmpty(), title.orEmpty(), body.orEmpty())
      }
    }

    @JavascriptInterface
    fun notifyStateWithOptions(
      kind: String?,
      title: String?,
      body: String?,
      showNotification: Boolean,
      playSound: Boolean,
      shouldVibrate: Boolean,
    ) {
      withTrustedBridgeCaller("notifyStateWithOptions") {
        notifier.show(
          kind = kind.orEmpty(),
          title = title.orEmpty(),
          body = body.orEmpty(),
          showNotification = showNotification,
          playSound = playSound,
          shouldVibrate = shouldVibrate,
        )
      }
    }

    @JavascriptInterface
    fun handleLogout() {
      withTrustedBridgeCaller("handleLogout") {
        handleWebLogout()
      }
    }
  }

  private data class AuthPromptState(
    val message: String,
    val modeSummary: String,
    val showPin: Boolean = false,
    val primaryAction: AuthPrimaryAction = AuthPrimaryAction.NONE,
    val primaryLabelRes: Int? = null,
    val showBrowserButton: Boolean = false,
    val allowRetry: Boolean = false,
  )

  private enum class AuthPrimaryAction {
    NONE,
    LOCAL_PIN,
    BROWSER_PIN,
  }

  companion object {
    private const val TAG = "RemoteConnect"
    private const val APP_SCHEME = "remoteconnect"
    private const val APP_HOST = "open"
    private const val ANDROID_BRIDGE_NAME = "AndroidBridge"
    private const val REQUEST_NOTIFICATIONS = 1001
    private const val AUTO_RETRY_INITIAL_DELAY_MS = 1500L
    private const val AUTO_RETRY_STEADY_DELAY_MS = 3000L
  }
}
