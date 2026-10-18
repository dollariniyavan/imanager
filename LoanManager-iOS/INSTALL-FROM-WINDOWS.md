# Install Loan Manager on your iPhone from Windows

You need: a free GitHub account, a free Apple ID, your iPhone, and a USB cable.
No Mac is needed. GitHub builds the app on a cloud Mac; Sideloadly installs it from your PC.

## Part 1 - Build the app on GitHub (about 10 minutes, once)

1. Open `project.yml` in Notepad and make the app name unique to you: change `com.example` (line 3) to
   `com.yourname` and `com.example.loanmanager` (line 16) to `com.yourname.loanmanager`.
   Use only letters and dots. Apple rejects an ID that someone else already used.
2. Sign in at github.com > **New repository** > name it `loan-manager-ios` > choose **Private** > Create.
3. Upload the project. Easiest way on Windows, with Git for Windows installed, in this folder:
   ```
   git init
   git add .
   git commit -m "Loan Manager iOS"
   git branch -M main
   git remote add origin https://github.com/YOUR-NAME/loan-manager-ios.git
   git push -u origin main
   ```
   (Without Git: on the repository page click **Add file > Upload files** and drag in the
   *contents* of this folder, including the `.github` folder.)
4. Open the **Actions** tab. The build starts by itself (or click *Build iPhone app (.ipa)* > **Run workflow**).
   It takes about 5 minutes. A green tick means success.
5. Click the finished run, scroll to **Artifacts**, download **LoanManager-ipa**, and unzip it.
   You now have `LoanManager.ipa`.

If the run shows a red cross: open it, download the **build-log** artifact, and send me the last 40 lines.
The Swift code was written without a compiler, so a small fix may be needed on the first build.

## Part 2 - Install on the iPhone with Sideloadly

1. On the PC install **iTunes** and **iCloud** from apple.com (the versions from the Microsoft Store do not work).
2. Install **Sideloadly** from sideloadly.io.
3. On the iPhone, turn on Developer Mode: Settings > Privacy & Security > Developer Mode > On (it restarts).
4. Connect the iPhone by USB and tap **Trust** on the phone.
5. In Sideloadly drag in `LoanManager.ipa`, type your Apple ID, and click **Start**. Enter the password when asked.
6. On the iPhone: Settings > General > VPN & Device Management > your Apple ID > **Trust**.
7. Open Loan Manager.

## Free Apple ID limits
- The app stops opening after **7 days**. Connect the phone and press Start in Sideloadly again with the same
  IPA to renew it. Your data stays.
- A free Apple ID can have 3 sideloaded apps and a limited number of new app IDs per week.
- A paid Apple Developer account ($99/year) removes the 7-day limit but needs a Mac-style signing setup;
  ask me if you want that route.

## Before you start, protect your data
In the Android app: Menu > Backup. Keep that JSON file safe. After installing on the iPhone use
Menu > Backup > Restore. Make a backup in the iPhone app regularly, because a sideloaded app that
expires or is deleted loses its data.
