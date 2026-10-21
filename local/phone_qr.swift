import AppKit
import CoreImage
import Foundation

let arguments = CommandLine.arguments
guard arguments.count == 3 else { exit(2) }
let jsonData = try Data(contentsOf: URL(fileURLWithPath: arguments[1]))
let connections = try JSONSerialization.jsonObject(with: jsonData) as! [String:String]
let context = CIContext()
for name in ["certificate", "workbench"] {
    guard let value = connections[name] else { continue }
    guard let filter = CIFilter(name: "CIQRCodeGenerator") else { exit(3) }
    filter.setValue(Data(value.utf8), forKey: "inputMessage")
    filter.setValue("M", forKey: "inputCorrectionLevel")
    guard let output = filter.outputImage else { exit(4) }
    let scaled = output.transformed(by: CGAffineTransform(scaleX: 7, y: 7))
    let frame = scaled.extent.insetBy(dx: -28, dy: -28)
    let background = CIImage(color: CIColor(red: 1, green: 1, blue: 1)).cropped(to: frame)
    let padded = scaled.composited(over: background)
    guard let cgImage = context.createCGImage(padded, from: frame) else { exit(5) }
    let representation = NSBitmapImageRep(cgImage: cgImage)
    guard let png = representation.representation(using: .png, properties: [:]) else { exit(6) }
    let destination = URL(fileURLWithPath: arguments[2]).appendingPathComponent("iphone-" + name + ".png")
    try png.write(to: destination, options: .atomic)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: destination.path)
}
