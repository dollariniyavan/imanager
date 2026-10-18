import UIKit
import Speech
import AVFoundation

/// Tamil (ta-IN) voice search. Shows a small "Listening…" alert; stops on silence, Done, or Cancel.
final class VoiceSearch: NSObject {
    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "ta-IN"))
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var alert: UIAlertController?
    private var timer: Timer?
    private var best = ""
    private var finished = false
    private var done: (([String: Any]) -> Void)?

    func start(from vc: UIViewController, done: @escaping ([String: Any]) -> Void) {
        self.done = done
        SFSpeechRecognizer.requestAuthorization { status in
            DispatchQueue.main.async {
                guard status == .authorized else {
                    return self.abort(vc, "Speech recognition is off. Enable it in Settings → Loan Manager.")
                }
                AVAudioSession.sharedInstance().requestRecordPermission { granted in
                    DispatchQueue.main.async {
                        guard granted else { return self.abort(vc, "Microphone access is off. Enable it in Settings → Loan Manager.") }
                        self.begin(vc)
                    }
                }
            }
        }
    }

    private func begin(_ vc: UIViewController) {
        guard let rec = recognizer, rec.isAvailable else { return abort(vc, "Tamil speech recognition is not available right now.") }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)
            let req = SFSpeechAudioBufferRecognitionRequest()
            req.shouldReportPartialResults = true
            request = req
            let input = engine.inputNode
            input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buf, _ in req.append(buf) }
            engine.prepare()
            try engine.start()
            task = rec.recognitionTask(with: req) { [weak self] result, error in
                DispatchQueue.main.async {
                    guard let self = self, !self.finished else { return }
                    if let r = result {
                        self.best = r.bestTranscription.formattedString
                        self.arm(after: 1.8)                    // stop shortly after the user stops talking
                        if r.isFinal { self.finish() }
                    } else if error != nil { self.finish() }
                }
            }
        } catch {
            return abort(vc, error.localizedDescription)
        }
        let a = UIAlertController(title: "🎤 Listening…", message: "Speak in Tamil", preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Done", style: .default) { [weak self] _ in self?.finish() })
        a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { [weak self] _ in self?.best = ""; self?.finish() })
        alert = a
        vc.present(a, animated: true)
        arm(after: 8)                                           // nothing heard at all
    }

    private func arm(after seconds: TimeInterval) {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: seconds, repeats: false) { [weak self] _ in self?.finish() }
    }

    private func finish() {
        guard !finished else { return }
        finished = true
        timer?.invalidate()
        if engine.isRunning { engine.stop(); engine.inputNode.removeTap(onBus: 0) }
        request?.endAudio()
        task?.cancel()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        alert?.dismiss(animated: true)
        done?(["text": best])
        done = nil
    }

    private func abort(_ vc: UIViewController, _ message: String) {
        finished = true
        let a = UIAlertController(title: "Voice search", message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default))
        vc.present(a, animated: true)
        done?(["text": ""])
        done = nil
    }
}
