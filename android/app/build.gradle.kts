plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
}

android {
  namespace = "com.remoteconnect.mobile"
  compileSdk = 34

  defaultConfig {
    applicationId = "com.remoteconnect.mobile"
    minSdk = 26
    targetSdk = 34
    versionCode = 1
    versionName = "0.1.0"

    testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
  }

  buildTypes {
    debug {
      manifestPlaceholders["usesCleartextTraffic"] = "true"
      buildConfigField("boolean", "ALLOW_DEBUG_LOCALHOST", "true")
    }
    release {
      isMinifyEnabled = false
      manifestPlaceholders["usesCleartextTraffic"] = "false"
      buildConfigField("boolean", "ALLOW_DEBUG_LOCALHOST", "false")
      proguardFiles(
        getDefaultProguardFile("proguard-android-optimize.txt"),
        "proguard-rules.pro",
      )
    }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }

  kotlinOptions {
    jvmTarget = "17"
  }

  buildFeatures {
    buildConfig = true
  }
}

dependencies {
  implementation("androidx.core:core-ktx:1.13.1")
  implementation("androidx.appcompat:appcompat:1.7.0")
  implementation("com.google.android.material:material:1.12.0")
  implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
  implementation("androidx.recyclerview:recyclerview:1.3.2")
  implementation("androidx.browser:browser:1.8.0")
  implementation("androidx.security:security-crypto:1.0.0")
  implementation("androidx.biometric:biometric:1.1.0")
  implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
