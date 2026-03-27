package com.remoteconnect.mobile

import org.json.JSONArray
import org.json.JSONObject

data class AuthPolicy(
  val publicMode: Boolean,
  val browserLoginEnabled: Boolean,
  val trustedLocalLoginEnabled: Boolean,
  val deviceRevocationEnabled: Boolean,
  val browserLoginPath: String,
  val localLoginPath: String,
  val refreshPath: String,
  val devicesPath: String,
  val publicBaseUrl: String?,
  val mobileDeepLinkBase: String?,
  val entryOrigin: String?,
  val apiOrigin: String?,
  val currentTrustedIdentity: String?,
) {
  companion object {
    fun fromJson(json: JSONObject): AuthPolicy {
      return AuthPolicy(
        publicMode = json.optBoolean("publicMode"),
        browserLoginEnabled = json.optBoolean("browserLoginEnabled"),
        trustedLocalLoginEnabled = json.optBoolean("trustedLocalLoginEnabled"),
        deviceRevocationEnabled = json.optBoolean("deviceRevocationEnabled"),
        browserLoginPath = json.optString("browserLoginPath", "/api/auth/browser/start"),
        localLoginPath = json.optString("localLoginPath", "/api/auth/local-login"),
        refreshPath = json.optString("refreshPath", "/api/auth/refresh"),
        devicesPath = json.optString("devicesPath", "/api/devices"),
        publicBaseUrl = json.optString("publicBaseUrl").ifBlank { null },
        mobileDeepLinkBase = json.optString("mobileDeepLinkBase").ifBlank { null },
        entryOrigin = json.optString("entryOrigin").ifBlank { null },
        apiOrigin = json.optString("apiOrigin").ifBlank { null },
        currentTrustedIdentity = json.optString("currentTrustedIdentity").ifBlank { null },
      )
    }
  }
}

data class AuthTokens(
  val clientId: String,
  val clientName: String,
  val deviceId: String?,
  val authMethod: String?,
  val accessToken: String,
  val refreshToken: String?,
  val expiresAt: Long,
  val trustedIdentity: String?,
  val redirectSessionId: String?,
) {
  companion object {
    fun fromJson(json: JSONObject): AuthTokens {
      return AuthTokens(
        clientId = json.optString("clientId"),
        clientName = json.optString("clientName"),
        deviceId = json.optString("deviceId").ifBlank { null },
        authMethod = json.optString("authMethod").ifBlank { null },
        accessToken = json.optString("accessToken", json.optString("sessionToken")),
        refreshToken = json.optString("refreshToken").ifBlank { null },
        expiresAt = json.optLong("expiresAt"),
        trustedIdentity = json.optString("trustedIdentity").ifBlank { null },
        redirectSessionId = json.optString("redirectSessionId").ifBlank { null },
      )
    }
  }
}

data class SessionSummary(
  val id: String,
  val name: String,
  val kind: String,
  val kindLabel: String,
  val workspace: String,
  val currentPath: String,
  val state: String,
  val previewText: String,
  val unreadCompleted: Boolean,
  val hidden: Boolean,
  val attached: Boolean,
  val admin: Boolean,
) {
  companion object {
    fun fromJson(json: JSONObject): SessionSummary {
      return SessionSummary(
        id = json.optString("id"),
        name = json.optString("name"),
        kind = json.optString("kind"),
        kindLabel = json.optString("kindLabel"),
        workspace = json.optString("workspace"),
        currentPath = json.optString("currentPath"),
        state = json.optString("state"),
        previewText = json.optString("previewText"),
        unreadCompleted = json.optBoolean("unreadCompleted"),
        hidden = json.optBoolean("hidden"),
        attached = json.optBoolean("attached"),
        admin = json.optBoolean("admin"),
      )
    }
  }
}

data class ConversationItem(
  val role: String,
  val text: String,
) {
  companion object {
    fun fromJson(json: JSONObject): ConversationItem {
      return ConversationItem(
        role = json.optString("role"),
        text = json.optString("text"),
      )
    }
  }
}

data class SessionSnapshot(
  val state: String,
  val mode: String,
  val shellKind: String?,
  val appKind: String?,
  val statusLine: String?,
  val snapshot: String,
  val conversationItems: List<ConversationItem>,
  val updatedAt: Long,
) {
  companion object {
    fun fromJson(json: JSONObject): SessionSnapshot {
      val conversation = json.optJSONObject("conversation") ?: JSONObject()
      val items = mutableListOf<ConversationItem>()
      val rawItems = conversation.optJSONArray("items") ?: JSONArray()
      for (index in 0 until rawItems.length()) {
        val item = rawItems.optJSONObject(index) ?: continue
        items.add(ConversationItem.fromJson(item))
      }

      val mode = conversation.optString("mode", "raw_terminal")
      val snapshot = json.optString("snapshot")
      val normalizedItems = if (mode == "raw_terminal" && items.isEmpty() && snapshot.isNotBlank()) {
        listOf(ConversationItem(role = "assistant", text = snapshot.trim()))
      } else {
        items
      }

      return SessionSnapshot(
        state = json.optString("state"),
        mode = mode,
        shellKind = conversation.optString("shellKind").ifBlank { null },
        appKind = conversation.optString("appKind").ifBlank { null },
        statusLine = conversation.optString("statusLine").ifBlank { null },
        snapshot = snapshot,
        conversationItems = normalizedItems,
        updatedAt = json.optLong("updatedAt"),
      )
    }
  }
}

data class SessionAttachResult(
  val sessionId: String,
  val snapshot: SessionSnapshot,
) {
  companion object {
    fun fromJson(json: JSONObject): SessionAttachResult {
      return SessionAttachResult(
        sessionId = json.optString("sessionId"),
        snapshot = SessionSnapshot.fromJson(json.optJSONObject("snapshot") ?: JSONObject()),
      )
    }
  }
}

data class SessionHistoryPayload(
  val name: String,
  val snapshot: String,
  val lineCount: Int,
  val updatedAt: Long,
) {
  companion object {
    fun fromJson(json: JSONObject): SessionHistoryPayload {
      val snapshot = json.optString("snapshot")
      return SessionHistoryPayload(
        name = json.optString("name"),
        snapshot = snapshot,
        lineCount = json.optInt("lineCount", if (snapshot.isBlank()) 0 else snapshot.split('\n').size),
        updatedAt = json.optLong("updatedAt"),
      )
    }
  }
}

data class DeviceInfo(
  val deviceId: String,
  val deviceName: String,
  val authMethod: String?,
  val trustedIdentity: String?,
  val current: Boolean,
  val createdAt: Long,
  val lastSeenAt: Long,
  val revokedAt: Long,
) {
  companion object {
    fun fromJson(json: JSONObject): DeviceInfo {
      return DeviceInfo(
        deviceId = json.optString("deviceId"),
        deviceName = json.optString("deviceName"),
        authMethod = json.optString("authMethod").ifBlank { null },
        trustedIdentity = json.optString("trustedIdentity").ifBlank { null },
        current = json.optBoolean("current"),
        createdAt = json.optLong("createdAt"),
        lastSeenAt = json.optLong("lastSeenAt"),
        revokedAt = json.optLong("revokedAt"),
      )
    }
  }
}
