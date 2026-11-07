// input_control.node — global dictation hotkeys + synthetic key presses.
//
//   start(cb)                cb({type, ...}) on the JS thread. Events:
//                              {type:'fn', down:bool}          fn/🌐 pressed or released alone
//                              {type:'fnChord'}                 another key pressed while fn held
//                              {type:'hotkey', name:'handsFree'|'cancel'|'pasteLast'|'copyLast'}
//   stop()
//   setRecording(bool)       while true, Esc is swallowed and reported as 'cancel'
//   paste()                  posts ⌘V to the focused app
//   pressKey('return'|'tab'|'z', {cmd?, shift?})
//   isTrusted(prompt?)       AXIsProcessTrustedWithOptions
//
// Uses an *active* CGEventTap (needs Accessibility) so the hands-free Space,
// Esc-to-cancel and ⌘⌃V / ⌘⌃C combos don't leak into the focused app.
// The fn flagsChanged event itself is never swallowed (that would desync
// modifier state); tell users to set "Press 🌐 key to: Do Nothing".

#import <ApplicationServices/ApplicationServices.h>
#import <Carbon/Carbon.h>
#import <Foundation/Foundation.h>
#include <napi.h>
#include <atomic>
#include <string>

namespace {

struct Event { std::string type; std::string name; bool down = false; };

CFMachPortRef gTap = nullptr;
CFRunLoopSourceRef gSource = nullptr;
Napi::ThreadSafeFunction gTsfn;
bool gHasTsfn = false;

std::atomic<bool> gRecording{false};
bool gFnDown = false;
bool gFnChorded = false;
int gSwallowKeyUp = -1;  // keycode whose keyUp we must also swallow

void Emit(Event ev) {
  if (!gHasTsfn) return;
  auto* heap = new Event(std::move(ev));
  gTsfn.NonBlockingCall(heap, [](Napi::Env env, Napi::Function cb, Event* e) {
    Napi::Object o = Napi::Object::New(env);
    o.Set("type", e->type);
    if (!e->name.empty()) o.Set("name", e->name);
    if (e->type == "fn") o.Set("down", e->down);
    cb.Call({o});
    delete e;
  });
}

const CGEventFlags kMods = kCGEventFlagMaskCommand | kCGEventFlagMaskControl |
                           kCGEventFlagMaskAlternate | kCGEventFlagMaskShift;

CGEventRef TapCallback(CGEventTapProxy, CGEventType type, CGEventRef event, void*) {
  if (type == kCGEventTapDisabledByTimeout || type == kCGEventTapDisabledByUserInput) {
    if (gTap) CGEventTapEnable(gTap, true);
    return event;
  }

  const int64_t code = CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode);
  const CGEventFlags flags = CGEventGetFlags(event);

  if (type == kCGEventFlagsChanged && code == kVK_Function) {
    const bool down = (flags & kCGEventFlagMaskSecondaryFn) != 0;
    if (down != gFnDown) {
      gFnDown = down;
      if (down) {
        gFnChorded = (flags & kMods) != 0;  // fn+⌘ etc. is not a dictation press
        if (!gFnChorded) Emit({"fn", "", true});
      } else if (!gFnChorded) {
        Emit({"fn", "", false});
      }
    }
    return event;
  }

  if (type == kCGEventKeyUp && code == gSwallowKeyUp) {
    gSwallowKeyUp = -1;
    return nullptr;
  }

  if (type != kCGEventKeyDown) return event;
  const bool autorepeat = CGEventGetIntegerValueField(event, kCGKeyboardEventAutorepeat) != 0;

  // fn + Space -> hands-free (swallow so no space is typed).
  if (gFnDown && !gFnChorded && code == kVK_Space) {
    if (!autorepeat) Emit({"hotkey", "handsFree"});
    gSwallowKeyUp = kVK_Space;
    return nullptr;
  }
  // Any other key while fn is held (fn+arrows = Home/End...) cancels the press.
  if (gFnDown && !gFnChorded) {
    gFnChorded = true;
    Emit({"fnChord"});
    return event;
  }
  // Esc cancels an active recording.
  if (gRecording.load() && code == kVK_Escape) {
    if (!autorepeat) Emit({"hotkey", "cancel"});
    gSwallowKeyUp = kVK_Escape;
    return nullptr;
  }
  // ⌘⌃V / ⌘⌃C -> paste / copy last transcript.
  const CGEventFlags cmdCtrl = kCGEventFlagMaskCommand | kCGEventFlagMaskControl;
  if ((flags & kMods) == cmdCtrl && (code == kVK_ANSI_V || code == kVK_ANSI_C)) {
    if (!autorepeat) Emit({"hotkey", code == kVK_ANSI_V ? "pasteLast" : "copyLast"});
    gSwallowKeyUp = (int)code;
    return nullptr;
  }
  return event;
}

Napi::Value Start(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (gTap) return Napi::Boolean::New(env, true);
  if (info.Length() < 1 || !info[0].IsFunction()) {
    Napi::TypeError::New(env, "start(callback)").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  CGEventMask mask = CGEventMaskBit(kCGEventKeyDown) | CGEventMaskBit(kCGEventKeyUp) |
                     CGEventMaskBit(kCGEventFlagsChanged);
  gTap = CGEventTapCreate(kCGSessionEventTap, kCGHeadInsertEventTap, kCGEventTapOptionDefault,
                          mask, TapCallback, nullptr);
  if (!gTap) return Napi::Boolean::New(env, false);  // no Accessibility permission

  gTsfn = Napi::ThreadSafeFunction::New(env, info[0].As<Napi::Function>(), "input_control", 0, 1);
  gHasTsfn = true;
  gSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, gTap, 0);
  CFRunLoopAddSource(CFRunLoopGetMain(), gSource, kCFRunLoopCommonModes);
  CGEventTapEnable(gTap, true);
  return Napi::Boolean::New(env, true);
}

Napi::Value Stop(const Napi::CallbackInfo& info) {
  if (gTap) {
    CGEventTapEnable(gTap, false);
    CFRunLoopRemoveSource(CFRunLoopGetMain(), gSource, kCFRunLoopCommonModes);
    CFRelease(gSource); CFRelease(gTap);
    gSource = nullptr; gTap = nullptr;
  }
  if (gHasTsfn) { gTsfn.Release(); gHasTsfn = false; }
  gFnDown = false;
  return info.Env().Undefined();
}

Napi::Value SetRecording(const Napi::CallbackInfo& info) {
  gRecording = info.Length() > 0 && info[0].ToBoolean().Value();
  return info.Env().Undefined();
}

void PostKey(CGKeyCode key, CGEventFlags flags) {
  CGEventSourceRef src = CGEventSourceCreate(kCGEventSourceStateHIDSystemState);
  CGEventRef down = CGEventCreateKeyboardEvent(src, key, true);
  CGEventRef up = CGEventCreateKeyboardEvent(src, key, false);
  CGEventSetFlags(down, flags);
  CGEventSetFlags(up, flags);
  CGEventPost(kCGAnnotatedSessionEventTap, down);
  CGEventPost(kCGAnnotatedSessionEventTap, up);
  CFRelease(down); CFRelease(up);
  if (src) CFRelease(src);
}

Napi::Value Paste(const Napi::CallbackInfo& info) {
  PostKey(kVK_ANSI_V, kCGEventFlagMaskCommand);
  return info.Env().Undefined();
}

Napi::Value PressKey(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::string name = info.Length() > 0 ? info[0].ToString().Utf8Value() : "";
  CGEventFlags flags = 0;
  if (info.Length() > 1 && info[1].IsObject()) {
    auto o = info[1].As<Napi::Object>();
    if (o.Get("cmd").ToBoolean()) flags |= kCGEventFlagMaskCommand;
    if (o.Get("shift").ToBoolean()) flags |= kCGEventFlagMaskShift;
  }
  CGKeyCode key;
  if (name == "return") key = kVK_Return;
  else if (name == "tab") key = kVK_Tab;
  else if (name == "z") key = kVK_ANSI_Z;
  else if (name == "c") key = kVK_ANSI_C;
  else { Napi::TypeError::New(env, "unknown key").ThrowAsJavaScriptException(); return env.Undefined(); }
  PostKey(key, flags);
  return env.Undefined();
}

Napi::Value IsTrusted(const Napi::CallbackInfo& info) {
  bool prompt = info.Length() > 0 && info[0].ToBoolean().Value();
  NSDictionary* opts = @{(__bridge NSString*)kAXTrustedCheckOptionPrompt: @(prompt)};
  return Napi::Boolean::New(info.Env(), AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)opts));
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("start", Napi::Function::New(env, Start));
  exports.Set("stop", Napi::Function::New(env, Stop));
  exports.Set("setRecording", Napi::Function::New(env, SetRecording));
  exports.Set("paste", Napi::Function::New(env, Paste));
  exports.Set("pressKey", Napi::Function::New(env, PressKey));
  exports.Set("isTrusted", Napi::Function::New(env, IsTrusted));
  return exports;
}

}  // namespace

NODE_API_MODULE(input_control, Init)
