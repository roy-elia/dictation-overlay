// panel_activation.node
// Exposes one function:
//   preventActivation(target, options) -> { applied: boolean, reason: string }
//     target  : Buffer from BrowserWindow.getNativeWindowHandle() (NSView*),
//               or a string = window title to search NSApp.windows for.
//     options : { allowOnMacOS27: boolean }  (feature flag from JS)
//
// Calls the private -[NSWindow _setPreventsActivation:YES] so clicking the
// dictation pill never makes our app key/active and the target text field
// keeps focus. Must be called on the main thread (Electron main process JS is).

#import <AppKit/AppKit.h>
#import <objc/runtime.h>
#import <objc/message.h>
#include <napi.h>

namespace {

SEL PreventsActivationSelector() {
  return NSSelectorFromString(@"_setPreventsActivation:");
}

// Verify the private method still has the shape we expect:
//   - (void)_setPreventsActivation:(BOOL)flag   => "v@:B" (or "v@:c" on older ABIs)
// If Apple renames it or changes its signature we bail out instead of crashing.
bool HasExpectedShape(NSWindow* window, SEL sel, std::string* why) {
  if (![window respondsToSelector:sel]) { *why = "selector-missing"; return false; }
  Method m = class_getInstanceMethod([window class], sel);
  if (m == nullptr) { *why = "method-missing"; return false; }
  if (method_getNumberOfArguments(m) != 3) { *why = "arg-count-mismatch"; return false; }

  char ret[8] = {0};
  method_getReturnType(m, ret, sizeof(ret));
  if (ret[0] != 'v') { *why = std::string("return-type-mismatch:") + ret; return false; }

  char arg[8] = {0};
  method_getArgumentType(m, 2, arg, sizeof(arg));
  if (arg[0] != 'B' && arg[0] != 'c') { *why = std::string("arg-type-mismatch:") + arg; return false; }

  NSMethodSignature* sig = [window methodSignatureForSelector:sel];
  if (sig == nil || sig.numberOfArguments != 3 || sig.methodReturnLength != 0) {
    *why = "signature-mismatch";
    return false;
  }
  return true;
}

bool IsMacOS27OrLater() {
  NSOperatingSystemVersion v27 = {27, 0, 0};
  return [[NSProcessInfo processInfo] isOperatingSystemAtLeastVersion:v27];
}

NSWindow* WindowFromHandle(const Napi::Buffer<uint8_t>& buf) {
  if (buf.Length() < sizeof(void*)) return nil;
  // Electron's getNativeWindowHandle() on macOS returns a buffer holding an NSView*.
  void* raw = *reinterpret_cast<void**>(buf.Data());
  if (raw == nullptr) return nil;
  NSView* view = (__bridge NSView*)raw;
  if (![view isKindOfClass:[NSView class]]) return nil;
  return view.window;
}

NSWindow* WindowFromTitle(NSString* title) {
  for (NSWindow* w in [NSApp windows]) {
    if ([w.title isEqualToString:title]) return w;
  }
  return nil;
}

Napi::Object Result(Napi::Env env, bool applied, const std::string& reason) {
  Napi::Object o = Napi::Object::New(env);
  o.Set("applied", Napi::Boolean::New(env, applied));
  o.Set("reason", Napi::String::New(env, reason));
  return o;
}

Napi::Value PreventActivation(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (![NSThread isMainThread]) return Result(env, false, "not-main-thread");

  bool allowOn27 = false;
  if (info.Length() > 1 && info[1].IsObject()) {
    Napi::Value f = info[1].As<Napi::Object>().Get("allowOnMacOS27");
    allowOn27 = f.IsBoolean() && f.As<Napi::Boolean>().Value();
  }
  if (IsMacOS27OrLater() && !allowOn27) {
    return Result(env, false, "macos27-flag-off");
  }

  NSWindow* window = nil;
  if (info.Length() > 0 && info[0].IsBuffer()) {
    window = WindowFromHandle(info[0].As<Napi::Buffer<uint8_t>>());
  } else if (info.Length() > 0 && info[0].IsString()) {
    std::string t = info[0].As<Napi::String>().Utf8Value();
    window = WindowFromTitle([NSString stringWithUTF8String:t.c_str()]);
  } else {
    Napi::TypeError::New(env, "preventActivation(handle: Buffer | title: string, options?)")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  if (window == nil) return Result(env, false, "window-not-found");

  SEL sel = PreventsActivationSelector();
  std::string why;
  if (!HasExpectedShape(window, sel, &why)) return Result(env, false, why);

  using SetBoolFn = void (*)(id, SEL, BOOL);
  reinterpret_cast<SetBoolFn>(objc_msgSend)(window, sel, YES);
  return Result(env, true, "ok");
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("preventActivation", Napi::Function::New(env, PreventActivation));
  return exports;
}

}  // namespace

NODE_API_MODULE(panel_activation, Init)
