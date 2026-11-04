// Draws Refrain.app's icon: the R the collapsed rail shows (Archivo, weight
// 900, width 118%), on a machined plate in the macOS icon shape, with the plum
// light pipe under it. Run by scripts/build-mac-app.command.
//
// Every gradient is a light model (.claude/creative-direction.md): one light
// above the plate, and the pipe as the only emitter, spilling onto the plate.
//
// Usage: make-icon <archivo.woff2> <out-1024.png>
import AppKit
import CoreText

let args = CommandLine.arguments
guard args.count == 3 else { fputs("usage: make-icon <archivo.woff2> <out.png>\n", stderr); exit(2) }

func hex(_ v: UInt32, _ a: CGFloat = 1) -> CGColor {
  CGColor(srgbRed: CGFloat((v >> 16) & 0xFF) / 255, green: CGFloat((v >> 8) & 0xFF) / 255, blue: CGFloat(v & 0xFF) / 255, alpha: a)
}

// The palette's own tokens.
let ground = hex(0x0C0A11), raised = hex(0x221D2B), machined = hex(0x302838)
let shadowline = hex(0x060409), text = hex(0xF4EFF3), muted = hex(0xA295AC)
let plum = hex(0x8446C9), plumLit = hex(0xA96FE8)

// Archivo from the repo, at the rail's settings.
guard let data = FileManager.default.contents(atPath: args[1]) as CFData?,
      let descs = CTFontManagerCreateFontDescriptorsFromData(data) as? [CTFontDescriptor], let base = descs.first
else { fputs("can't read \(args[1])\n", stderr); exit(1) }
let tag = { (s: String) -> NSNumber in NSNumber(value: s.utf8.reduce(UInt32(0)) { $0 << 8 | UInt32($1) }) }
let varied = CTFontDescriptorCreateCopyWithAttributes(base, [kCTFontVariationAttribute: [tag("wght"): 900, tag("wdth"): 118]] as CFDictionary)

let size = 1024
let space = CGColorSpace(name: CGColorSpace.sRGB)!
let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: space,
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
// Origin bottom-left, y up.

// The macOS icon grid: an 824pt body inset 100pt with 185pt corners, the size
// every other icon in the Dock is drawn to. (A superellipse bulged at the
// sides and read puffier than the icons beside it.)
let body = CGRect(x: 100, y: 100, width: 824, height: 824)
let plate = CGPath(roundedRect: body, cornerWidth: 185, cornerHeight: 185, transform: nil)

func linear(_ stops: [(CGFloat, CGColor)], from: CGPoint, to: CGPoint) {
  let g = CGGradient(colorsSpace: space, colors: stops.map(\.1) as CFArray, locations: stops.map(\.0))!
  ctx.drawLinearGradient(g, start: from, end: to, options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
}

// 1. The plate sits on the desk: Apple's template shadow, straight down.
ctx.saveGState()
ctx.setShadow(offset: CGSize(width: 0, height: -12), blur: 28, color: hex(0x000000, 0.5))
ctx.addPath(plate); ctx.setFillColor(ground); ctx.fillPath()
ctx.restoreGState()

// 2. Anodized face, lit from above: raised at the top falling to ground.
ctx.saveGState()
ctx.addPath(plate); ctx.clip()
linear([(0, machined), (0.42, raised), (1, ground)], from: CGPoint(x: 512, y: 924), to: CGPoint(x: 512, y: 100))

// The R and pipe sit a little above centre, where the eye puts the middle.
let pipeY: CGFloat = 306, rBottom: CGFloat = 378

// 3. The pipe's light landing on the plate below it: a radial falloff
//    positioned where the emitter is, and nowhere else.
let spill = CGGradient(colorsSpace: space, colors: [hex(0xA96FE8, 0.30), hex(0x8446C9, 0.10), hex(0x8446C9, 0)] as CFArray, locations: [0, 0.45, 1])!
ctx.saveGState()
ctx.translateBy(x: 512, y: pipeY); ctx.scaleBy(x: 1, y: 0.42)
ctx.drawRadialGradient(spill, startCenter: .zero, startRadius: 0, endCenter: .zero, endRadius: 440, options: [])
ctx.restoreGState()
ctx.restoreGState()

// 4. Machined edges: room light catching the top lip, a shadowline at the foot.
func strokeEdge(width: CGFloat, _ stops: [(CGFloat, CGColor)]) {
  ctx.saveGState()
  ctx.addPath(plate); ctx.clip()
  ctx.addPath(plate); ctx.setLineWidth(width); ctx.replacePathWithStrokedPath(); ctx.clip()
  linear(stops, from: CGPoint(x: 512, y: 924), to: CGPoint(x: 512, y: 100))
  ctx.restoreGState()
}
strokeEdge(width: 6, [(0, hex(0xF4EFF3, 0.22)), (0.18, hex(0xF4EFF3, 0.05)), (0.5, hex(0xF4EFF3, 0)), (1, hex(0x000000, 0))])
strokeEdge(width: 4, [(0, hex(0x000000, 0)), (0.75, hex(0x000000, 0)), (1, hex(0x060409, 0.9))])

// 5. The R, a metal inlay: one curved surface under the same overhead light.
let font = CTFontCreateWithFontDescriptor(varied, 520, nil)
// A static font, or a CoreText that drops the axes, would draw a thin R
// with no error; refuse instead, so the build falls back to the web icon.
let applied = CTFontCopyVariation(font) as? [NSNumber: NSNumber]
guard let weight = applied?[tag("wght")]?.doubleValue, weight >= 850 else {
  fputs("Archivo's weight axis wasn't applied\n", stderr); exit(1)
}
var glyph = CGGlyph(0)
var ch: UniChar = 0x52 // "R"
guard CTFontGetGlyphsForCharacters(font, &ch, &glyph, 1),
      let outline = CTFontCreatePathForGlyph(font, glyph, nil) else { fputs("no R in font\n", stderr); exit(1) }
let gb = outline.boundingBoxOfPath
var place = CGAffineTransform(translationX: 512 - gb.midX, y: rBottom - gb.minY)
let r = outline.copy(using: &place)!
let rb = r.boundingBoxOfPath

ctx.saveGState() // standing just proud of the plate, so it casts a short shadow down
ctx.setShadow(offset: CGSize(width: 0, height: -7), blur: 9, color: hex(0x060409, 0.95))
ctx.addPath(r); ctx.setFillColor(shadowline); ctx.fillPath()
ctx.restoreGState()

ctx.saveGState()
ctx.addPath(r); ctx.clip()
linear([(0, hex(0xD9CFE3)), (0.40, text), (0.47, hex(0xFBF8FC)), (0.56, hex(0xC6B9D3)), (1, muted)],
       from: CGPoint(x: 512, y: rb.maxY), to: CGPoint(x: 512, y: rb.minY))
ctx.restoreGState()

ctx.saveGState() // the R's top lip catching the light
ctx.addPath(r); ctx.clip()
ctx.addPath(r); ctx.setLineWidth(5); ctx.replacePathWithStrokedPath(); ctx.clip()
linear([(0, hex(0xFFFFFF, 0.55)), (0.3, hex(0xFFFFFF, 0)), (1, hex(0x000000, 0))], from: CGPoint(x: 512, y: rb.maxY), to: CGPoint(x: 512, y: rb.minY))
ctx.restoreGState()

// 6. The light pipe: a hot near-white core in a saturated plum halo, as a
//    real emitter photographs. The one emitter on the icon.
let pipe = CGRect(x: rb.minX, y: pipeY - 13, width: rb.width, height: 26)
let pipePath = CGPath(roundedRect: pipe, cornerWidth: 13, cornerHeight: 13, transform: nil)
ctx.saveGState()
ctx.setShadow(offset: .zero, blur: 34, color: hex(0xA96FE8, 1))
ctx.addPath(pipePath); ctx.setFillColor(plum); ctx.fillPath()
ctx.restoreGState()
ctx.saveGState()
ctx.setShadow(offset: .zero, blur: 10, color: plumLit)
ctx.addPath(pipePath); ctx.setFillColor(plumLit); ctx.fillPath()
ctx.restoreGState()
let core = pipe.insetBy(dx: 10, dy: 8)
ctx.addPath(CGPath(roundedRect: core, cornerWidth: 5, cornerHeight: 5, transform: nil))
ctx.setFillColor(hex(0xF1E8FF, 0.95)); ctx.fillPath()

let image = ctx.makeImage()!
let rep = NSBitmapImageRep(cgImage: image)
guard let png = rep.representation(using: .png, properties: [:]) else { exit(1) }
try png.write(to: URL(fileURLWithPath: args[2]))
