import AppKit
import ApplicationServices
import Foundation

// One-shot, explicit window preview. No keyboard hooks, screen recording or background polling.
func emit(_ object: Any) { let data = try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]); FileHandle.standardOutput.write(data) }
func fail(_ message: String) -> Never { emit(["error": message]); exit(1) }
func attribute(_ node: AXUIElement, _ key: String) -> CFTypeRef? {
    var value: CFTypeRef?; guard AXUIElementCopyAttributeValue(node, key as CFString, &value) == .success else { return nil }; return value
}
func apps() -> [[String: Any]] { NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular && $0.processIdentifier != ProcessInfo.processInfo.processIdentifier && $0.bundleIdentifier != "app.tracelet.desktop" }.compactMap { app in
    guard let bundle = app.bundleIdentifier, let name = app.localizedName else { return nil }
    return ["pid": Int(app.processIdentifier), "bundleId": bundle, "name": name]
}.sorted { ($0["name"] as! String) < ($1["name"] as! String) } }
let args = CommandLine.arguments
if args.count == 2 && args[1] == "--apps" { emit(apps()); exit(0) }
guard args.count == 3, args[1] == "--read", let pid = Int32(args[2]), pid > 0 else { fail("参数无效") }
guard AXIsProcessTrusted() else { fail("请在系统设置的辅助功能中授权 Personal Memory，然后重试。") }
guard let app = apps().first(where: { ($0["pid"] as? Int) == Int(pid) }) else { fail("应用已退出，请刷新应用列表。") }
let target = AXUIElementCreateApplication(pid)
AXUIElementSetMessagingTimeout(target, 1)
// Chromium clients may expose their tree only after explicit accessibility activation.
AXUIElementSetAttributeValue(target, "AXManualAccessibility" as CFString, kCFBooleanTrue)
AXUIElementSetAttributeValue(target, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
guard let raw = attribute(target, kAXFocusedWindowAttribute), CFGetTypeID(raw) == AXUIElementGetTypeID() else { fail("没有可读取的窗口，请先在目标应用打开对话。") }
let window = unsafeBitCast(raw, to: AXUIElement.self)
let title = (attribute(window, kAXTitleAttribute) as? String ?? app["name"] as! String)
var nodes: [[String: String]] = []; var visited: [AXUIElement] = []; var scanned = 0; var bytes = 0; var truncated = false
let deadline = Date().addingTimeInterval(8)
func walk(_ node: AXUIElement, _ depth: Int) {
    if scanned >= 6000 || depth > 40 || Date() > deadline || nodes.count >= 1000 || bytes >= 700000 { truncated = true; return }
    guard !visited.contains(where: { CFEqual($0, node) }) else { return }; visited.append(node); scanned += 1
    if attribute(node, "AXHidden") as? Bool == true { return }
    let role = attribute(node, kAXRoleAttribute) as? String ?? ""
    // Exclude all editors and their descendants, even when their current value is empty.
    if ["AXTextField", "AXTextArea", "AXSecureTextField", "AXComboBox"].contains(role) || (attribute(node, "AXEditable") as? Bool == true) { return }
    if role == "AXStaticText" {
        let text = (attribute(node, kAXValueAttribute) as? String ?? attribute(node, kAXTitleAttribute) as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty && text.count <= 64000 {
            bytes += text.utf8.count
            if bytes <= 700000 { nodes.append(["id": String(nodes.count), "text": text]) } else { truncated = true }
        }
        return
    }
    if let children = attribute(node, kAXChildrenAttribute) as? [AXUIElement] { for child in children { walk(child, depth + 1); if truncated { break } } }
}
walk(window, 0)
emit(["app": app, "title": String(title.prefix(200)), "truncated": truncated, "nodes": nodes])
