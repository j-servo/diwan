// H.264 encoder for the promo render (macOS AVFoundation). ffmpeg is the usual tool, but the one
// installed here is an x86_64 build that cannot run on this Apple-silicon Mac without Rosetta.
//   promo-encode <out.mp4> <fps> <bitrate-mbps> <crossfade-seconds> <frames-dir>...
// Each frames dir holds 00000.png, 00001.png, ...; consecutive dirs are joined by a crossfade that
// overlaps the last frames of one with the first frames of the next. BT.709, yuv420p, faststart.
import AVFoundation
import CoreGraphics
import CoreVideo
import Foundation
import ImageIO

func fail(_ msg: String) -> Never {
    FileHandle.standardError.write(Data((msg + "\n").utf8))
    exit(1)
}

let argv = CommandLine.arguments
guard argv.count >= 6, let fps = Int32(argv[2]), let mbps = Double(argv[3]), let fade = Double(argv[4])
else { fail("usage: promo-encode out.mp4 fps mbps fade dir...") }
let outURL = URL(fileURLWithPath: argv[1])
let dirs = Array(argv[5...])
let overlap = Int((fade * Double(fps)).rounded())

func frames(_ dir: String) -> [String] {
    let names = (try? FileManager.default.contentsOfDirectory(atPath: dir)) ?? []
    return names.filter { $0.hasSuffix(".png") }.sorted().map { dir + "/" + $0 }
}
let lists = dirs.map(frames)
if lists.contains(where: { $0.isEmpty }) { fail("empty frames dir") }

func load(_ path: String) -> CGImage {
    guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
        let img = CGImageSourceCreateImageAtIndex(src, 0, nil)
    else { fail("cannot read \(path)") }
    return img
}
let first = load(lists[0][0])
let width = first.width
let height = first.height

// The output timeline: (segment, frame) pairs; the overlap frames carry the next segment too.
struct Out { let a: String; let b: String?; let alpha: Double }
var timeline: [Out] = []
for (i, list) in lists.enumerated() {
    let head = i == 0 ? 0 : overlap
    let tail = i == lists.count - 1 ? 0 : overlap
    for f in head..<(list.count - tail) { timeline.append(Out(a: list[f], b: nil, alpha: 0)) }
    if tail > 0 {
        for k in 0..<tail {
            let s = (Double(k) + 0.5) / Double(tail)
            timeline.append(Out(a: list[list.count - tail + k], b: lists[i + 1][k], alpha: s))
        }
    }
}

try? FileManager.default.removeItem(at: outURL)
let writer = try AVAssetWriter(outputURL: outURL, fileType: .mp4)
writer.shouldOptimizeForNetworkUse = true
let input = AVAssetWriterInput(
    mediaType: .video,
    outputSettings: [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: width,
        AVVideoHeightKey: height,
        AVVideoColorPropertiesKey: [
            AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
            AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
            AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2,
        ],
        AVVideoCompressionPropertiesKey: [
            AVVideoAverageBitRateKey: Int(mbps * 1_000_000),
            AVVideoMaxKeyFrameIntervalKey: Int(fps) * 2,
            AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
            AVVideoExpectedSourceFrameRateKey: Int(fps),
        ],
    ])
input.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(
    assetWriterInput: input,
    sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        kCVPixelBufferWidthKey as String: width,
        kCVPixelBufferHeightKey as String: height,
    ])
writer.add(input)
guard writer.startWriting() else { fail("cannot start: \(String(describing: writer.error))") }
writer.startSession(atSourceTime: .zero)

let space = CGColorSpace(name: CGColorSpace.sRGB)!
for (n, item) in timeline.enumerated() {
    while !input.isReadyForMoreMediaData { Thread.sleep(forTimeInterval: 0.002) }
    var buffer: CVPixelBuffer?
    CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &buffer)
    guard let pb = buffer else { fail("no pixel buffer") }
    CVBufferSetAttachment(pb, kCVImageBufferColorPrimariesKey, kCVImageBufferColorPrimaries_ITU_R_709_2, .shouldPropagate)
    CVBufferSetAttachment(pb, kCVImageBufferTransferFunctionKey, kCVImageBufferTransferFunction_ITU_R_709_2, .shouldPropagate)
    CVBufferSetAttachment(pb, kCVImageBufferYCbCrMatrixKey, kCVImageBufferYCbCrMatrix_ITU_R_709_2, .shouldPropagate)
    CVPixelBufferLockBaseAddress(pb, [])
    let ctx = CGContext(
        data: CVPixelBufferGetBaseAddress(pb), width: width, height: height, bitsPerComponent: 8,
        bytesPerRow: CVPixelBufferGetBytesPerRow(pb), space: space,
        bitmapInfo: CGBitmapInfo.byteOrder32Little.rawValue | CGImageAlphaInfo.premultipliedFirst.rawValue)!
    let rect = CGRect(x: 0, y: 0, width: width, height: height)
    ctx.draw(load(item.a), in: rect)
    if let b = item.b {
        ctx.setAlpha(CGFloat(item.alpha))
        ctx.draw(load(b), in: rect)
    }
    CVPixelBufferUnlockBaseAddress(pb, [])
    adaptor.append(pb, withPresentationTime: CMTime(value: CMTimeValue(n), timescale: fps))
}
input.markAsFinished()
let done = DispatchSemaphore(value: 0)
writer.finishWriting { done.signal() }
done.wait()
if writer.status != .completed { fail("write failed: \(String(describing: writer.error))") }
print("encoded \(timeline.count) frames, \(Double(timeline.count) / Double(fps)) s -> \(argv[1])")
