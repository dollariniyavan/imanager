# Loan Manager for iOS

The original Android app was a WebView around an HTML/JS app. This project is the same web app
(`www/`) inside a `WKWebView`, with the Android native layer rewritten in Swift.

## Build (Mac + Xcode 15 or newer)

1. `brew install xcodegen`
2. In this folder run: `xcodegen`  (creates `LoanManager.xcodeproj`)
3. Open `LoanManager.xcodeproj`, select the **LoanManager** target > *Signing & Capabilities*,
   pick your Team (a free Apple ID works for running on your own iPhone).
4. Change the bundle identifier (`com.example.loanmanager`) to something unique, in `project.yml`
   or in Xcode.
5. Plug in your iPhone (or pick a simulator) and press Run.
   Face ID / voice search / contacts need a real device for a proper test.

### No XcodeGen? Manual setup
1. Xcode > New Project > iOS App (Interface: Storyboard, Language: Swift). Delete the generated
   `ViewController`, `SceneDelegate`, `Main.storyboard`, and the *Application Scene Manifest* and
   *Main storyboard file base name* entries in Info.
2. Drag the files from `LoanManager/` into the project. Remove the generated AppDelegate
   (this one has `@main`).
3. Drag the `www` folder in and choose **Create folder references** (it must show as a BLUE folder).
4. Add these Info keys: `NSFaceIDUsageDescription`, `NSMicrophoneUsageDescription`,
   `NSSpeechRecognitionUsageDescription`, `NSContactsUsageDescription`.

## Moving your data from Android
Android app: Menu > Backup > creates `loan_backup_*.json`. Send it to your iPhone (AirDrop / Drive / WhatsApp),
then in this app: Menu > Backup > Restore and choose that file.

## What changed vs. the Android build
| File | Change |
|---|---|
| `www/js/main.js` | `await` added to native calls (iOS can't call native synchronously); Android wording replaced |
| `www/index.html` | lock-screen text |
| `LoanManager/Shim.swift` | recreates `window.Android` so the rest of the JS is untouched |
| `LoanManager/NativeBridge.swift` | Face ID/passcode, contacts, share sheet, print, open URL |
| `LoanManager/Database.swift` | SQLite (same JSON-in/JSON-out contract as the Kotlin side) |
| `LoanManager/VoiceSearch.swift` | Tamil (ta-IN) speech recognition |
| `LoanManager/AssetSchemeHandler.swift` | serves `www` at `app://localhost` so ES modules + localStorage work |

The app locks again after 30 s in the background (`relockAfter` in `WebViewController.swift`) and
blurs the app-switcher preview.

## Not tested yet
This was written without access to Xcode, so it has not been compiled or run. Expect to fix a
compiler warning or small error on first build. Send me the Xcode error text and I'll fix it.
