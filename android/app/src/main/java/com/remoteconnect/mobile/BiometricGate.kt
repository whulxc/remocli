package com.remoteconnect.mobile

import android.app.KeyguardManager
import android.content.Context
import android.os.Build
import androidx.appcompat.app.AppCompatActivity
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat

class BiometricGate(private val activity: AppCompatActivity) {
  fun isDeviceSecure(): Boolean {
    val keyguardManager = activity.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
    return keyguardManager?.isDeviceSecure == true
  }

  fun authenticate(
    title: String,
    subtitle: String,
    onSuccess: () -> Unit,
    onError: (String) -> Unit,
  ) {
    if (!isDeviceSecure()) {
      onError(activity.getString(R.string.policy_requires_lock))
      return
    }

    val prompt = BiometricPrompt(
      activity,
      ContextCompat.getMainExecutor(activity),
      object : BiometricPrompt.AuthenticationCallback() {
        override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
          onSuccess()
        }

        override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
          onError(errString.toString())
        }

        override fun onAuthenticationFailed() {
          onError(activity.getString(R.string.unlock_canceled))
        }
      },
    )

    val promptInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      BiometricPrompt.PromptInfo.Builder()
        .setTitle(title)
        .setSubtitle(subtitle)
        .setAllowedAuthenticators(
          BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL,
        )
        .build()
    } else {
      @Suppress("DEPRECATION")
      BiometricPrompt.PromptInfo.Builder()
        .setTitle(title)
        .setSubtitle(subtitle)
        .setDeviceCredentialAllowed(true)
        .build()
    }

    prompt.authenticate(promptInfo)
  }
}
