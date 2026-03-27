package com.remoteconnect.mobile

import android.net.Uri
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

class RemoteApiClient {
  private val client = OkHttpClient.Builder()
    .connectTimeout(15, TimeUnit.SECONDS)
    .readTimeout(20, TimeUnit.SECONDS)
    .writeTimeout(20, TimeUnit.SECONDS)
    .build()

  fun fetchAuthPolicy(gatewayUrl: String): AuthPolicy {
    return AuthPolicy.fromJson(requestJson(gatewayUrl, "/api/auth/policy"))
  }

  fun localLogin(gatewayUrl: String, pin: String, deviceId: String, deviceName: String): AuthTokens {
    val body = JSONObject()
      .put("pin", pin)
      .put("deviceId", deviceId)
      .put("deviceName", deviceName)
    return AuthTokens.fromJson(requestJson(gatewayUrl, "/api/auth/local-login", method = "POST", body = body))
  }

  fun exchangeGrant(gatewayUrl: String, grant: String, pin: String, deviceId: String, deviceName: String): AuthTokens {
    val body = JSONObject()
      .put("grant", grant)
      .put("pin", pin)
      .put("deviceId", deviceId)
      .put("deviceName", deviceName)
    return AuthTokens.fromJson(requestJson(gatewayUrl, "/api/auth/grant/exchange", method = "POST", body = body))
  }

  fun refresh(gatewayUrl: String, refreshToken: String): AuthTokens {
    val body = JSONObject().put("refreshToken", refreshToken)
    return AuthTokens.fromJson(requestJson(gatewayUrl, "/api/auth/refresh", method = "POST", body = body))
  }

  fun listSessions(gatewayUrl: String, accessToken: String, workspacePath: String): List<SessionSummary> {
    val path = buildString {
      append("/api/sessions")
      if (workspacePath.isNotBlank()) {
        append("?workspacePath=")
        append(Uri.encode(workspacePath))
      }
    }
    val response = requestJson(gatewayUrl, path, accessToken = accessToken)
    val array = response.optJSONArray("sessions") ?: JSONArray()
    val sessions = mutableListOf<SessionSummary>()
    for (index in 0 until array.length()) {
      val item = array.optJSONObject(index) ?: continue
      sessions.add(SessionSummary.fromJson(item))
    }
    return sessions
  }

  fun attachSession(gatewayUrl: String, accessToken: String, sessionId: String): SessionAttachResult {
    val path = "/api/sessions/${Uri.encode(sessionId)}/attach"
    return SessionAttachResult.fromJson(requestJson(gatewayUrl, path, method = "POST", accessToken = accessToken))
  }

  fun releaseSession(gatewayUrl: String, accessToken: String, sessionId: String) {
    val path = "/api/sessions/${Uri.encode(sessionId)}/release"
    requestJson(gatewayUrl, path, method = "POST", accessToken = accessToken)
  }

  fun fetchSnapshot(gatewayUrl: String, accessToken: String, sessionId: String): SessionSnapshot {
    val path = "/api/sessions/${Uri.encode(sessionId)}/snapshot"
    return SessionSnapshot.fromJson(requestJson(gatewayUrl, path, accessToken = accessToken))
  }

  fun fetchSessionHistory(gatewayUrl: String, accessToken: String, sessionId: String): SessionHistoryPayload {
    val path = "/api/sessions/${Uri.encode(sessionId)}/history"
    return SessionHistoryPayload.fromJson(requestJson(gatewayUrl, path, accessToken = accessToken))
  }

  fun sendText(gatewayUrl: String, accessToken: String, sessionId: String, text: String) {
    val body = JSONObject().put("text", text)
    val path = "/api/sessions/${Uri.encode(sessionId)}/input"
    requestJson(gatewayUrl, path, method = "POST", body = body, accessToken = accessToken)
  }

  fun sendKey(gatewayUrl: String, accessToken: String, sessionId: String, key: String) {
    val body = JSONObject().put("key", key)
    val path = "/api/sessions/${Uri.encode(sessionId)}/input"
    requestJson(gatewayUrl, path, method = "POST", body = body, accessToken = accessToken)
  }

  fun openLocal(gatewayUrl: String, accessToken: String, sessionId: String): JSONObject {
    val path = "/api/sessions/${Uri.encode(sessionId)}/open-local"
    return requestJson(gatewayUrl, path, method = "POST", accessToken = accessToken)
  }

  fun createSession(
    gatewayUrl: String,
    accessToken: String,
    workspacePath: String,
    name: String,
    kind: String,
    openDesktop: Boolean,
    admin: Boolean,
  ): SessionSummary {
    val body = JSONObject()
      .put("workspace", workspacePath)
      .put("name", name)
      .put("kind", kind)
      .put("openDesktop", openDesktop)
      .put("admin", admin)
    val response = requestJson(gatewayUrl, "/api/sessions", method = "POST", body = body, accessToken = accessToken)
    return SessionSummary.fromJson(response.getJSONObject("session"))
  }

  fun renameSession(gatewayUrl: String, accessToken: String, sessionId: String, name: String): SessionSummary {
    val body = JSONObject().put("name", name)
    val path = "/api/sessions/${Uri.encode(sessionId)}/rename"
    val response = requestJson(gatewayUrl, path, method = "POST", body = body, accessToken = accessToken)
    return SessionSummary.fromJson(response.getJSONObject("session"))
  }

  fun closeSession(gatewayUrl: String, accessToken: String, sessionId: String) {
    val path = "/api/sessions/${Uri.encode(sessionId)}"
    requestJson(gatewayUrl, path, method = "DELETE", accessToken = accessToken)
  }

  fun listDevices(gatewayUrl: String, accessToken: String): List<DeviceInfo> {
    val response = requestJson(gatewayUrl, "/api/devices", accessToken = accessToken)
    val array = response.optJSONArray("devices") ?: JSONArray()
    val devices = mutableListOf<DeviceInfo>()
    for (index in 0 until array.length()) {
      val item = array.optJSONObject(index) ?: continue
      devices.add(DeviceInfo.fromJson(item))
    }
    return devices
  }

  fun revokeDevice(gatewayUrl: String, accessToken: String, deviceId: String) {
    val path = "/api/devices/${Uri.encode(deviceId)}/revoke"
    requestJson(gatewayUrl, path, method = "POST", accessToken = accessToken)
  }

  fun logout(gatewayUrl: String, accessToken: String) {
    requestJson(gatewayUrl, "/api/auth/logout", method = "POST", accessToken = accessToken)
  }

  private fun requestJson(
    gatewayUrl: String,
    path: String,
    method: String = "GET",
    body: JSONObject? = null,
    accessToken: String? = null,
  ): JSONObject {
    val url = gatewayUrl.trimEnd('/') + path
    val requestBuilder = Request.Builder().url(url)
    if (!accessToken.isNullOrBlank()) {
      requestBuilder.header("x-remote-connect-session", accessToken)
    }

    val requestBody = body?.toString()?.toRequestBody(JSON_MEDIA_TYPE)
    when (method.uppercase()) {
      "POST" -> requestBuilder.post(requestBody ?: EMPTY_JSON)
      "DELETE" -> requestBuilder.delete()
      else -> requestBuilder.get()
    }

    client.newCall(requestBuilder.build()).execute().use { response ->
      val text = response.body?.string().orEmpty()
      val trimmedText = text.trimStart()
      val contentType = response.header("content-type").orEmpty().lowercase()
      if (
        trimmedText.startsWith("<!doctype", ignoreCase = true) ||
        trimmedText.startsWith("<html", ignoreCase = true) ||
        contentType.contains("text/html")
      ) {
        throw RemoteApiException(
          response.code,
          "Cloudflare Access is still intercepting $path for the Android app. This endpoint must return gateway JSON instead of the Access HTML login page.",
        )
      }
      if (!response.isSuccessful) {
        throw RemoteApiException(response.code, text.ifBlank { response.message })
      }
      return if (text.isBlank()) {
        JSONObject()
      } else {
        try {
          JSONObject(text)
        } catch (_: Exception) {
          throw RemoteApiException(
            response.code,
            "Expected JSON from $path but received an unreadable response body.",
          )
        }
      }
    }
  }

  companion object {
    private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
    private val EMPTY_JSON = "{}".toRequestBody(JSON_MEDIA_TYPE)
  }
}

class RemoteApiException(
  val statusCode: Int,
  override val message: String,
) : IOException(message)
