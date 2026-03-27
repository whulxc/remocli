package com.remoteconnect.mobile

import android.content.Context
import android.os.Build
import android.provider.Settings
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys
import org.json.JSONObject
import java.util.UUID

class SecureSessionStore(private val context: Context) {
  private val masterKeyAlias = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC)
  private val preferences = EncryptedSharedPreferences.create(
    PREFS_NAME,
    masterKeyAlias,
    context,
    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
  )

  var gatewayUrl: String?
    get() = loadActiveProfile()?.apiBaseUrl ?: preferences.getString(KEY_GATEWAY_URL, null)
    set(value) {
      val profile = ConnectionProfile.fromLegacyGatewayUrl(value)
      if (profile != null) {
        saveActiveProfile(profile)
      } else {
        preferences.edit().putString(KEY_GATEWAY_URL, value).apply()
      }
    }

  var projectPath: String
    get() = preferences.getString(KEY_PROJECT_PATH, "") ?: ""
    set(value) = preferences.edit().putString(KEY_PROJECT_PATH, value).apply()

  val accessToken: String?
    get() = loadAuthSession(loadActiveProfile())?.accessToken

  val refreshToken: String?
    get() = loadAuthSession(loadActiveProfile())?.refreshToken

  val expiresAt: Long
    get() = loadAuthSession(loadActiveProfile())?.expiresAt ?: 0L

  val clientName: String?
    get() = loadAuthSession(loadActiveProfile())?.clientName

  val deviceId: String
    get() {
      val existing = preferences.getString(KEY_DEVICE_ID, null)
      if (!existing.isNullOrBlank()) {
        return existing
      }

      val androidId = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
      val next = if (!androidId.isNullOrBlank()) {
        "android-${androidId.lowercase()}"
      } else {
        UUID.randomUUID().toString()
      }
      preferences.edit().putString(KEY_DEVICE_ID, next).apply()
      return next
    }

  val deviceName: String
    get() {
      val existing = preferences.getString(KEY_DEVICE_NAME, null)
      if (!existing.isNullOrBlank()) {
        return existing
      }

      val next = listOfNotNull(Build.MANUFACTURER?.trim(), Build.MODEL?.trim())
        .filter { it.isNotBlank() }
        .joinToString(" ")
        .ifBlank { "Android device" }
      preferences.edit().putString(KEY_DEVICE_NAME, next).apply()
      return next
    }

  fun loadActiveProfile(): ConnectionProfile? {
    val stored = preferences.getString(KEY_ACTIVE_PROFILE_JSON, null)?.takeIf { it.isNotBlank() }
    if (!stored.isNullOrBlank()) {
      try {
        return ConnectionProfile.fromJson(JSONObject(stored))
      } catch (_: Exception) {
        // Fall through to legacy migration.
      }
    }

    val legacyGateway = preferences.getString(KEY_GATEWAY_URL, null)
    val migrated = ConnectionProfile.fromLegacyGatewayUrl(legacyGateway)
    if (migrated != null) {
      saveActiveProfile(migrated)
    }
    return migrated
  }

  fun saveActiveProfile(profile: ConnectionProfile) {
    preferences.edit()
      .putString(KEY_ACTIVE_PROFILE_JSON, profile.toJson().toString())
      .putString(KEY_GATEWAY_URL, profile.apiBaseUrl)
      .apply()
  }

  fun saveAuth(profile: ConnectionProfile?, tokens: AuthTokens) {
    if (profile == null) {
      return
    }

    val sessions = loadProfileAuthSessions()
    sessions.put(
      profile.sessionScopeKey(),
      JSONObject()
        .put("accessToken", tokens.accessToken)
        .put("refreshToken", tokens.refreshToken)
        .put("expiresAt", tokens.expiresAt)
        .put("clientName", tokens.clientName)
        .put("authMethod", tokens.authMethod)
        .put("trustedIdentity", tokens.trustedIdentity),
    )
    preferences.edit()
      .putString(KEY_PROFILE_AUTH_SESSIONS, sessions.toString())
      .remove(KEY_ACCESS_TOKEN)
      .remove(KEY_REFRESH_TOKEN)
      .remove(KEY_EXPIRES_AT)
      .remove(KEY_CLIENT_NAME)
      .remove(KEY_AUTH_METHOD)
      .remove(KEY_TRUSTED_IDENTITY)
      .apply()
  }

  fun loadAuthSession(profile: ConnectionProfile?): StoredAuthSession? {
    if (profile == null) {
      return null
    }

    val raw = loadProfileAuthSessions().optJSONObject(profile.sessionScopeKey())
    if (raw != null) {
      return StoredAuthSession(
        accessToken = raw.optString("accessToken").ifBlank { null },
        refreshToken = raw.optString("refreshToken").ifBlank { null },
        expiresAt = raw.optLong("expiresAt"),
        clientName = raw.optString("clientName").ifBlank { null },
        authMethod = raw.optString("authMethod").ifBlank { null },
        trustedIdentity = raw.optString("trustedIdentity").ifBlank { null },
      )
    }

    val legacyRefreshToken = preferences.getString(KEY_REFRESH_TOKEN, null)
    val legacyAccessToken = preferences.getString(KEY_ACCESS_TOKEN, null)
    if (legacyRefreshToken.isNullOrBlank() && legacyAccessToken.isNullOrBlank()) {
      return null
    }

    return StoredAuthSession(
      accessToken = legacyAccessToken,
      refreshToken = legacyRefreshToken,
      expiresAt = preferences.getLong(KEY_EXPIRES_AT, 0L),
      clientName = preferences.getString(KEY_CLIENT_NAME, null),
      authMethod = preferences.getString(KEY_AUTH_METHOD, null),
      trustedIdentity = preferences.getString(KEY_TRUSTED_IDENTITY, null),
    )
  }

  fun clearAuth(profile: ConnectionProfile? = loadActiveProfile()) {
    if (profile != null) {
      val sessions = loadProfileAuthSessions()
      sessions.remove(profile.sessionScopeKey())
      preferences.edit().putString(KEY_PROFILE_AUTH_SESSIONS, sessions.toString()).apply()
    }

    preferences.edit()
      .remove(KEY_ACCESS_TOKEN)
      .remove(KEY_REFRESH_TOKEN)
      .remove(KEY_EXPIRES_AT)
      .remove(KEY_CLIENT_NAME)
      .remove(KEY_AUTH_METHOD)
      .remove(KEY_TRUSTED_IDENTITY)
      .apply()
  }

  fun hasRefreshSession(profile: ConnectionProfile?): Boolean {
    return !loadAuthSession(profile)?.refreshToken.isNullOrBlank()
  }

  private fun loadProfileAuthSessions(): JSONObject {
    val raw = preferences.getString(KEY_PROFILE_AUTH_SESSIONS, null)?.takeIf { it.isNotBlank() } ?: return JSONObject()
    return try {
      JSONObject(raw)
    } catch (_: Exception) {
      JSONObject()
    }
  }

  companion object {
    private const val PREFS_NAME = "remote_connect_secure_store"
    private const val KEY_GATEWAY_URL = "gateway_url"
    private const val KEY_ACCESS_TOKEN = "access_token"
    private const val KEY_REFRESH_TOKEN = "refresh_token"
    private const val KEY_EXPIRES_AT = "expires_at"
    private const val KEY_DEVICE_ID = "device_id"
    private const val KEY_DEVICE_NAME = "device_name"
    private const val KEY_CLIENT_NAME = "client_name"
    private const val KEY_PROJECT_PATH = "project_path"
    private const val KEY_AUTH_METHOD = "auth_method"
    private const val KEY_TRUSTED_IDENTITY = "trusted_identity"
    private const val KEY_ACTIVE_PROFILE_JSON = "active_profile_json"
    private const val KEY_PROFILE_AUTH_SESSIONS = "profile_auth_sessions"
  }
}

data class StoredAuthSession(
  val accessToken: String?,
  val refreshToken: String?,
  val expiresAt: Long,
  val clientName: String?,
  val authMethod: String?,
  val trustedIdentity: String?,
)
