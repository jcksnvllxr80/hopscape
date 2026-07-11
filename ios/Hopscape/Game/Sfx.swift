import AVFoundation
import Foundation

// Hopscape — tiny synthesized sound effects (no audio files needed)
// Port of js/sfx.js. Each effect's WebAudio graph (oscillators with exponential
// frequency/gain ramps, faded white noise through a lowpass biquad, master gain
// 0.22) is rendered sample-for-sample into a PCM buffer and played through
// AVAudioEngine. Square/sawtooth use polyBLEP so they are band-limited like
// WebAudio's wavetable oscillators.

enum Sfx {
    private enum Wave { case sine, square, triangle, sawtooth }

    private struct ToneSpec {
        var freq: Double = 440
        var end: Double? = nil
        var dur: Double = 0.1
        var delay: Double = 0
        var vol: Double = 0.4
        var type: Wave = .sine
    }

    private struct NoiseSpec {
        var dur: Double = 0.3
        var delay: Double = 0
        var vol: Double = 0.5
        var freq: Double = 800 // lowpass cutoff
    }

    private static var engine: AVAudioEngine?
    private static var players: [AVAudioPlayerNode] = []
    private static var nextPlayer = 0
    private static var sampleRate: Double = 44100
    private static var format: AVAudioFormat?

    private(set) static var muted: Bool = UserDefaults.standard.string(forKey: "hs_muted") == "1"

    @discardableResult
    static func toggleMute() -> Bool {
        muted.toggle()
        UserDefaults.standard.set(muted ? "1" : "0", forKey: "hs_muted")
        return muted
    }

    // call on first user gesture in the web version; here it just lazily boots the engine
    static func unlock() {
        _ = ensure()
    }

    private static func ensure() -> Bool {
        if let engine { return engine.isRunning || ((try? engine.start()) != nil) }
        try? AVAudioSession.sharedInstance().setCategory(.ambient)
        try? AVAudioSession.sharedInstance().setActive(true)
        let eng = AVAudioEngine()
        sampleRate = eng.outputNode.outputFormat(forBus: 0).sampleRate
        if sampleRate <= 0 { sampleRate = 44100 }
        let fmt = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1)!
        format = fmt
        for _ in 0..<8 {
            let p = AVAudioPlayerNode()
            eng.attach(p)
            eng.connect(p, to: eng.mainMixerNode, format: fmt)
            players.append(p)
        }
        eng.mainMixerNode.outputVolume = 0.22 // master gain
        engine = eng
        do { try eng.start() } catch { return false }
        return true
    }

    // ---------- synthesis ----------
    // WebAudio exponentialRampToValueAtTime: v(t) = v0 * (v1/v0)^((t-t0)/(t1-t0))
    private static func renderTone(_ o: ToneSpec, into out: inout [Float]) {
        let sr = sampleRate
        let start = Int(o.delay * sr)
        let rampLen = o.dur * sr
        let total = Int((o.dur + 0.03) * sr) // o.stop(t0 + dur + 0.03)
        let end = max(1, o.end ?? o.freq)
        let hasRamp = end != o.freq
        let freqRatio = end / o.freq
        let gainRatio = 0.001 / o.vol
        var phase = 0.0 // normalized 0..1
        for i in 0..<total {
            let idx = start + i
            if idx >= out.count { break }
            let k = min(Double(i) / rampLen, 1)
            let f = hasRamp ? o.freq * pow(freqRatio, k) : o.freq
            let g = o.vol * pow(gainRatio, k)
            let dt = f / sr
            let v: Double
            switch o.type {
            case .sine:
                v = sin(phase * 2 * .pi)
            case .square:
                var s: Double = phase < 0.5 ? 1 : -1
                s += polyBlep(phase, dt)
                s -= polyBlep((phase + 0.5).truncatingRemainder(dividingBy: 1), dt)
                v = s
            case .sawtooth:
                // WebAudio sawtooth: 0 at phase 0, rising, jump at half period
                var u = phase + 0.5
                if u >= 1 { u -= 1 }
                v = 2 * u - 1 - polyBlep(u, dt)
            case .triangle:
                v = phase < 0.25 ? phase * 4
                    : phase < 0.75 ? 2 - phase * 4
                    : phase * 4 - 4
            }
            out[idx] += Float(v * g)
            phase += dt
            if phase >= 1 { phase -= 1 }
        }
    }

    private static func polyBlep(_ t: Double, _ dt: Double) -> Double {
        if dt <= 0 { return 0 }
        if t < dt {
            let x = t / dt
            return x + x - x * x - 1
        }
        if t > 1 - dt {
            let x = (t - 1) / dt
            return x * x + x + x + 1
        }
        return 0
    }

    private static func renderNoise(_ o: NoiseSpec, into out: inout [Float]) {
        let sr = sampleRate
        let start = Int(o.delay * sr)
        let len = Int(sr * o.dur)
        guard len > 0 else { return }
        // lowpass biquad, WebAudio semantics: Q defaults to 1 and is in dB
        let qLin = pow(10.0, 1.0 / 20.0)
        let w0 = 2 * Double.pi * min(o.freq, sr / 2 * 0.99) / sr
        let alpha = sin(w0) / (2 * qLin)
        let cosw = cos(w0)
        let a0 = 1 + alpha
        let b0 = ((1 - cosw) / 2) / a0
        let b1 = (1 - cosw) / a0
        let b2 = b0
        let a1 = (-2 * cosw) / a0
        let a2 = (1 - alpha) / a0
        var x1 = 0.0, x2 = 0.0, y1 = 0.0, y2 = 0.0
        for i in 0..<len {
            let idx = start + i
            if idx >= out.count { break }
            let x = (Double.random(in: 0..<1) * 2 - 1) * (1 - Double(i) / Double(len))
            let y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
            x2 = x1; x1 = x
            y2 = y1; y1 = y
            out[idx] += Float(y * o.vol)
        }
    }

    private static func play(tones: [ToneSpec] = [], noises: [NoiseSpec] = []) {
        if muted || !ensure() { return }
        guard let format else { return }
        var total = 0.0
        for t in tones { total = max(total, t.delay + t.dur + 0.03) }
        for n in noises { total = max(total, n.delay + n.dur) }
        let frames = Int(total * sampleRate) + 1
        guard frames > 1, let buf = AVAudioPCMBuffer(pcmFormat: format,
                                                     frameCapacity: AVAudioFrameCount(frames)) else { return }
        var samples = [Float](repeating: 0, count: frames)
        for t in tones { renderTone(t, into: &samples) }
        for n in noises { renderNoise(n, into: &samples) }
        buf.frameLength = AVAudioFrameCount(frames)
        samples.withUnsafeBufferPointer { src in
            buf.floatChannelData![0].update(from: src.baseAddress!, count: frames)
        }
        let player = players[nextPlayer]
        nextPlayer = (nextPlayer + 1) % players.count
        player.stop()
        player.scheduleBuffer(buf, completionHandler: nil)
        player.play()
    }

    // ---------- the effects (parameters identical to js/sfx.js) ----------
    static func hop() {
        play(tones: [ToneSpec(freq: 320 + Double.random(in: 0..<1) * 60, end: 490, dur: 0.07, vol: 0.3, type: .square)])
    }
    static func bump() {
        play(tones: [ToneSpec(freq: 135, end: 90, dur: 0.09, vol: 0.5, type: .triangle)])
    }
    static func coin() {
        play(tones: [ToneSpec(freq: 990, dur: 0.07, vol: 0.4, type: .sine),
                     ToneSpec(freq: 1320, dur: 0.13, delay: 0.07, vol: 0.4, type: .sine)])
    }
    static func select() {
        play(tones: [ToneSpec(freq: 620, end: 780, dur: 0.08, vol: 0.25, type: .square)])
    }
    static func start() {
        play(tones: [523.0, 659, 784].enumerated().map { i, f in
            ToneSpec(freq: f, dur: 0.12, delay: Double(i) * 0.09, vol: 0.32, type: .triangle)
        })
    }
    static func splash() {
        play(tones: [ToneSpec(freq: 300, end: 70, dur: 0.5, vol: 0.22, type: .sawtooth)],
             noises: [NoiseSpec(dur: 0.45, vol: 0.6, freq: 900)])
    }
    static func whoosh() {
        play(tones: [ToneSpec(freq: 260, end: 720, dur: 0.3, vol: 0.3, type: .sine)],
             noises: [NoiseSpec(dur: 0.3, vol: 0.45, freq: 1600)])
    }
    static func plane() {
        play(tones: [ToneSpec(freq: 170, end: 80, dur: 2.2, vol: 0.16, type: .sawtooth),
                     ToneSpec(freq: 340, end: 160, dur: 2.2, vol: 0.08, type: .sawtooth)],
             noises: [NoiseSpec(dur: 2.2, vol: 0.5, freq: 2400)])
    }
    static func screech() {
        play(tones: [ToneSpec(freq: 1650, end: 750, dur: 0.38, vol: 0.2, type: .sawtooth),
                     ToneSpec(freq: 1750, end: 850, dur: 0.32, delay: 0.45, vol: 0.16, type: .sawtooth)])
    }
    static func fall() {
        play(tones: [ToneSpec(freq: 640, end: 110, dur: 0.65, vol: 0.42, type: .sine)])
    }
    static func rumble() {
        play(tones: [ToneSpec(freq: 55, end: 75, dur: 1.6, vol: 0.2, type: .sawtooth)],
             noises: [NoiseSpec(dur: 1.6, vol: 0.5, freq: 200)])
    }
    static func honk() {
        play(tones: [ToneSpec(freq: 610, dur: 0.09, vol: 0.22, type: .square),
                     ToneSpec(freq: 610, dur: 0.16, delay: 0.14, vol: 0.22, type: .square)])
    }
    static func tractor() {
        var tones: [ToneSpec] = []
        for i in 0..<6 {
            tones.append(ToneSpec(freq: 82 + Double(i % 2) * 14, end: 70, dur: 0.09,
                                  delay: Double(i) * 0.13, vol: 0.2, type: .square))
        }
        play(tones: tones, noises: [NoiseSpec(dur: 0.8, vol: 0.25, freq: 300)])
    }
    static func crunch() {
        play(tones: [ToneSpec(freq: 160, end: 60, dur: 0.25, vol: 0.35, type: .triangle)],
             noises: [NoiseSpec(dur: 0.3, vol: 0.6, freq: 500)])
    }
    static func gallop() {
        play(noises: (0..<4).map { i in
            NoiseSpec(dur: 0.08, delay: Double(i) * 0.14, vol: 0.35, freq: 350)
        })
    }
    static func launch() {
        play(tones: [ToneSpec(freq: 85, end: 320, dur: 1.5, vol: 0.25, type: .sawtooth)],
             noises: [NoiseSpec(dur: 1.7, vol: 0.85, freq: 1000)])
    }
    static func crash() {
        play(tones: [ToneSpec(freq: 210, end: 55, dur: 0.35, vol: 0.3, type: .square)],
             noises: [NoiseSpec(dur: 0.4, vol: 0.7, freq: 650)])
    }
    static func boost() {
        play(tones: [ToneSpec(freq: 440, end: 880, dur: 0.09, vol: 0.28, type: .square),
                     ToneSpec(freq: 660, end: 1320, dur: 0.12, delay: 0.08, vol: 0.28, type: .square)])
    }
    static func over() {
        play(tones: [392.0, 330, 262, 196].enumerated().map { i, f in
            ToneSpec(freq: f, dur: 0.16, delay: Double(i) * 0.13, vol: 0.32, type: .triangle)
        })
    }
    static func best() {
        play(tones: [523.0, 659, 784, 1047].enumerated().map { i, f in
            ToneSpec(freq: f, dur: 0.1, delay: 0.5 + Double(i) * 0.09, vol: 0.22, type: .square)
        })
    }
}
