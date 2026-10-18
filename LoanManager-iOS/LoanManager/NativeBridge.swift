import UIKit
import WebKit
import LocalAuthentication
import ContactsUI

/// Handles every `window.Android.*` call coming from the page (see Shim.swift).
final class NativeBridge: NSObject, WKScriptMessageHandlerWithReply {
    let db = Database()
    weak var host: UIViewController?
    private var contacts: ContactPicker?
    private var printer: PrintHelper?
    private var voice: VoiceSearch?

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any], let method = body["method"] as? String else {
            replyHandler(nil, "Bad message"); return
        }
        let args = body["args"] as? [Any] ?? []
        func s(_ i: Int) -> String { i < args.count ? (args[i] as? String ?? "") : "" }

        switch method {
        case "canAuthenticate": replyHandler(canAuthenticate(), nil)
        case "authenticate":    authenticate { replyHandler($0, nil) }
        case "setLocked":       db.lock(); replyHandler(nil, nil)
        case "dbInit":          replyHandler(db.initSchema(s(0)), nil)
        case "dbQuery":         replyHandler(db.query(s(0), s(1)), nil)
        case "dbRun":           replyHandler(db.run(s(0), s(1)), nil)
        case "dbBatch":         replyHandler(db.batch(s(0)), nil)
        case "pickContact":     pickContact { replyHandler($0, nil) }
        case "voiceSearch":     startVoice { replyHandler($0, nil) }
        case "shareFile":       shareFile(s(0), s(1)) { replyHandler($0, nil) }
        case "printHtml":       printHtml(s(0), s(1)); replyHandler(nil, nil)
        case "openUrl":
            if let u = URL(string: s(0)) {
                UIApplication.shared.open(u, options: [:]) { replyHandler($0, nil) }
            } else {
                replyHandler(false, nil)
            }
        default: replyHandler(nil, "Unknown method \(method)")
        }
    }

    // MARK: unlock (Face ID / Touch ID / passcode)

    private func canAuthenticate() -> String {
        var err: NSError?
        if LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: &err) { return "ok" }
        if let e = err, e.domain == LAError.errorDomain, e.code == LAError.passcodeNotSet.rawValue { return "none_enrolled" }
        return "unavailable"
    }

    private func authenticate(_ done: @escaping ([String: Any]) -> Void) {
        LAContext().evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Unlock Loan Manager") { ok, error in
            DispatchQueue.main.async {
                if ok { self.db.unlock(); done(["ok": true]); return }
                var code = 0
                if let e = error as NSError?, e.domain == LAError.errorDomain {
                    switch e.code {
                    case LAError.userCancel.rawValue, LAError.systemCancel.rawValue, LAError.appCancel.rawValue:
                        code = 10   // main.js treats 10 as "cancelled"
                    default: code = e.code
                    }
                }
                done(["ok": false, "code": code, "message": error?.localizedDescription ?? "Could not unlock."])
            }
        }
    }

    // MARK: contacts / voice

    private func pickContact(_ done: @escaping ([String: Any]) -> Void) {
        guard let vc = top() else { done([:]); return }
        let picker = ContactPicker()
        contacts = picker
        picker.present(from: vc) { [weak self] result in self?.contacts = nil; done(result) }
    }

    private func startVoice(_ done: @escaping ([String: Any]) -> Void) {
        guard let vc = top() else { done(["text": ""]); return }
        let v = VoiceSearch()
        voice = v
        v.start(from: vc) { [weak self] result in self?.voice = nil; done(result) }
    }

    // MARK: share / print

    private func shareFile(_ filename: String, _ text: String, _ done: @escaping ([String: Any]) -> Void) {
        let safe = filename.replacingOccurrences(of: "/", with: "_")
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(safe.isEmpty ? "backup.json" : safe)
        do { try text.write(to: url, atomically: true, encoding: .utf8) }
        catch { done(["error": error.localizedDescription]); return }
        guard let vc = top() else { done(["error": "Nothing to present from"]); return }
        let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        sheet.completionWithItemsHandler = { _, _, _, err in
            done(err == nil ? [:] : ["error": err!.localizedDescription])
        }
        if let pop = sheet.popoverPresentationController {      // iPad
            pop.sourceView = vc.view
            pop.sourceRect = CGRect(x: vc.view.bounds.midX, y: vc.view.bounds.midY, width: 0, height: 0)
            pop.permittedArrowDirections = []
        }
        vc.present(sheet, animated: true)
    }

    private func printHtml(_ html: String, _ job: String) {
        guard let view = host?.view else { return }
        printer = PrintHelper(html: html, jobName: job.isEmpty ? "Report" : job, host: view) { [weak self] in
            self?.printer = nil
        }
    }

    private func top() -> UIViewController? {
        var vc = host
        while let p = vc?.presentedViewController { vc = p }
        return vc
    }
}

// MARK: - Contact picker (out-of-process; needs no Contacts permission)

final class ContactPicker: NSObject, CNContactPickerDelegate {
    private var done: (([String: Any]) -> Void)?

    func present(from vc: UIViewController, done: @escaping ([String: Any]) -> Void) {
        self.done = done
        let p = CNContactPickerViewController()
        p.delegate = self
        vc.present(p, animated: true)
    }

    func contactPicker(_ picker: CNContactPickerViewController, didSelect contact: CNContact) {
        let name = [contact.givenName, contact.familyName].filter { !$0.isEmpty }.joined(separator: " ")
        done?(["name": name, "tel": contact.phoneNumbers.map { $0.value.stringValue }])
        done = nil
    }

    func contactPickerDidCancel(_ picker: CNContactPickerViewController) {
        done?([:])      // no "name" key => main.js treats it as cancelled
        done = nil
    }
}

// MARK: - Print (loads the report HTML in a hidden web view, then opens the iOS print sheet)

final class PrintHelper: NSObject, WKNavigationDelegate {
    private let web = WKWebView(frame: CGRect(x: 0, y: 0, width: 612, height: 792))
    private let jobName: String
    private let onDone: () -> Void

    init(html: String, jobName: String, host: UIView, onDone: @escaping () -> Void) {
        self.jobName = jobName
        self.onDone = onDone
        super.init()
        web.navigationDelegate = self
        host.insertSubview(web, at: 0)          // sits underneath the visible web view
        web.loadHTMLString(html, baseURL: nil)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let info = UIPrintInfo(dictionary: nil)
        info.jobName = jobName
        info.outputType = .general
        let pic = UIPrintInteractionController.shared
        pic.printInfo = info
        pic.printFormatter = webView.viewPrintFormatter()
        pic.present(animated: true) { [weak self] _, _, _ in self?.finish() }
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { finish() }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { finish() }

    private func finish() { web.removeFromSuperview(); onDone() }
}
