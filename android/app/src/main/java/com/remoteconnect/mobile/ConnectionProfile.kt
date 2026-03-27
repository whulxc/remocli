package com.remoteconnect.mobile

import android.net.Uri
import org.json.JSONObject

data class ConnectionProfile(
  val id: String,
  val label: String,
  val mode: String,
  val entryUrl: String,
  val apiBaseUrl: String,
) {
  fun usesBrowserLogin(): Boolean {
    return mode == MODE_PUBLIC_CUSTOM_DOMAIN || mode == MODE_PUBLIC_TEAM_DOMAIN
  }

  fun sessionScopeKey(): String {
    return "$mode|$entryUrl|$apiBaseUrl"
  }

  fun toJson(): JSONObject {
    return JSONObject()
      .put("id", id)
      .put("label", label)
      .put("mode", mode)
      .put("entryUrl", entryUrl)
      .put("apiBaseUrl", apiBaseUrl)
  }

  companion object {
    const val MODE_PUBLIC_CUSTOM_DOMAIN = "public_custom_domain"
    const val MODE_PUBLIC_TEAM_DOMAIN = "public_team_domain"
    const val MODE_LAN_DIRECT = "lan_direct"
    const val MODE_USB_DIRECT = "usb_direct"

    fun fromJson(json: JSONObject?): ConnectionProfile? {
      if (json == null) {
        return null
      }
      val entryUrl = normalizeUrl(json.optString("entryUrl")).orEmpty()
      val apiBaseUrl = normalizeUrl(json.optString("apiBaseUrl")).orEmpty()
      if (entryUrl.isBlank() || apiBaseUrl.isBlank()) {
        return null
      }
      val mode = json.optString("mode").ifBlank { inferMode(entryUrl, apiBaseUrl) }
      return ConnectionProfile(
        id = json.optString("id").ifBlank { buildId(mode, entryUrl, apiBaseUrl) },
        label = json.optString("label").ifBlank { defaultLabel(mode) },
        mode = mode,
        entryUrl = entryUrl,
        apiBaseUrl = apiBaseUrl,
      )
    }

    fun fromUrls(entryUrl: String, apiBaseUrl: String? = null): ConnectionProfile? {
      val normalizedEntry = normalizeUrl(entryUrl) ?: return null
      val normalizedApi = normalizeUrl(apiBaseUrl).takeUnless { it.isNullOrBlank() } ?: normalizedEntry
      val mode = inferMode(normalizedEntry, normalizedApi)
      return ConnectionProfile(
        id = buildId(mode, normalizedEntry, normalizedApi),
        label = defaultLabel(mode),
        mode = mode,
        entryUrl = normalizedEntry,
        apiBaseUrl = normalizedApi,
      )
    }

    fun fromMode(mode: String, entryUrl: String, apiBaseUrl: String? = null): ConnectionProfile? {
      val normalizedEntry = normalizeUrl(entryUrl) ?: return null
      val normalizedApi = when (mode) {
        MODE_USB_DIRECT, MODE_LAN_DIRECT, MODE_PUBLIC_CUSTOM_DOMAIN -> {
          normalizeUrl(apiBaseUrl).takeUnless { it.isNullOrBlank() } ?: normalizedEntry
        }
        MODE_PUBLIC_TEAM_DOMAIN -> {
          normalizeUrl(apiBaseUrl).takeUnless { it.isNullOrBlank() } ?: normalizedEntry
        }
        else -> return null
      }
      return ConnectionProfile(
        id = buildId(mode, normalizedEntry, normalizedApi),
        label = defaultLabel(mode),
        mode = mode,
        entryUrl = normalizedEntry,
        apiBaseUrl = normalizedApi,
      )
    }

    fun fromLegacyGatewayUrl(gatewayUrl: String?): ConnectionProfile? {
      return fromUrls(gatewayUrl.orEmpty())
    }

    fun normalizeUrl(raw: String?): String? {
      val trimmed = raw?.trim().orEmpty()
      if (trimmed.isBlank()) {
        return null
      }

      val candidate = if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
        trimmed
      } else {
        "https://$trimmed"
      }

      val uri = Uri.parse(candidate)
      if (uri.scheme.isNullOrBlank() || uri.host.isNullOrBlank()) {
        return null
      }

      return candidate.trimEnd('/')
    }

    private fun inferMode(entryUrl: String, apiBaseUrl: String): String {
      val apiHost = Uri.parse(apiBaseUrl).host?.trim()?.lowercase().orEmpty()
      if (isTrustedLocalHost(apiHost)) {
        return if (apiHost == "localhost" || apiHost == "127.0.0.1" || apiHost == "::1") {
          MODE_USB_DIRECT
        } else {
          MODE_LAN_DIRECT
        }
      }

      return if (entryUrl != apiBaseUrl) {
        MODE_PUBLIC_TEAM_DOMAIN
      } else {
        MODE_PUBLIC_CUSTOM_DOMAIN
      }
    }

    private fun isTrustedLocalHost(host: String): Boolean {
      if (host.isBlank()) {
        return false
      }
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

    private fun defaultLabel(mode: String): String {
      return when (mode) {
        MODE_USB_DIRECT -> "USB 直连"
        MODE_LAN_DIRECT -> "局域网直连"
        MODE_PUBLIC_TEAM_DOMAIN -> "公网团队域名"
        else -> "公网私人域名"
      }
    }

    private fun buildId(mode: String, entryUrl: String, apiBaseUrl: String): String {
      val digest = "${entryUrl.lowercase()}|${apiBaseUrl.lowercase()}".hashCode().toUInt().toString(16)
      return "$mode-$digest"
    }
  }
}
