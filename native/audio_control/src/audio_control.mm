// audio_control.node — fast system-output mute/volume via CoreAudio.
//   read()            -> { deviceId, uid, name, transport, volume (0-100), muted, muteSupported }
//   setMuted(bool)    -> boolean (true if applied)
// transport: "bluetooth" | "bluetoothLE" | "usb" | "builtin" | "hdmi" | "displayport"
//            | "airplay" | "virtual" | "aggregate" | "other"
// Synchronous: each call is a few CoreAudio HAL property reads (~sub-ms).

#import <CoreAudio/CoreAudio.h>
#import <AudioToolbox/AudioToolbox.h>
#import <Foundation/Foundation.h>
#include <napi.h>
#include <string>
#include <vector>

namespace {

AudioObjectPropertyAddress Addr(AudioObjectPropertySelector sel,
                                AudioObjectPropertyScope scope = kAudioObjectPropertyScopeGlobal,
                                AudioObjectPropertyElement el = kAudioObjectPropertyElementMain) {
  return {sel, scope, el};
}

AudioDeviceID DefaultOutput() {
  AudioDeviceID dev = kAudioObjectUnknown;
  UInt32 size = sizeof(dev);
  auto a = Addr(kAudioHardwarePropertyDefaultOutputDevice);
  if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &a, 0, nullptr, &size, &dev) != noErr) return kAudioObjectUnknown;
  return dev;
}

std::string CFStringProp(AudioObjectID obj, AudioObjectPropertySelector sel) {
  CFStringRef s = nullptr;
  UInt32 size = sizeof(s);
  auto a = Addr(sel);
  if (AudioObjectGetPropertyData(obj, &a, 0, nullptr, &size, &s) != noErr || !s) return "";
  NSString* ns = (__bridge_transfer NSString*)s;
  return ns.UTF8String ?: "";
}

const char* Transport(AudioDeviceID dev) {
  UInt32 t = 0, size = sizeof(t);
  auto a = Addr(kAudioDevicePropertyTransportType);
  if (AudioObjectGetPropertyData(dev, &a, 0, nullptr, &size, &t) != noErr) return "other";
  switch (t) {
    case kAudioDeviceTransportTypeBluetooth: return "bluetooth";
    case kAudioDeviceTransportTypeBluetoothLE: return "bluetoothLE";
    case kAudioDeviceTransportTypeUSB: return "usb";
    case kAudioDeviceTransportTypeBuiltIn: return "builtin";
    case kAudioDeviceTransportTypeHDMI: return "hdmi";
    case kAudioDeviceTransportTypeDisplayPort: return "displayport";
    case kAudioDeviceTransportTypeAirPlay: return "airplay";
    case kAudioDeviceTransportTypeVirtual: return "virtual";
    case kAudioDeviceTransportTypeAggregate: return "aggregate";
    default: return "other";
  }
}

// Mute lives on the main element on most devices; some only expose it per channel.
bool MuteElements(AudioDeviceID dev, std::vector<AudioObjectPropertyElement>* out) {
  auto main = Addr(kAudioDevicePropertyMute, kAudioDevicePropertyScopeOutput);
  Boolean settable = false;
  if (AudioObjectHasProperty(dev, &main) &&
      AudioObjectIsPropertySettable(dev, &main, &settable) == noErr && settable) {
    out->push_back(kAudioObjectPropertyElementMain);
    return true;
  }
  for (AudioObjectPropertyElement ch = 1; ch <= 8; ++ch) {
    auto a = Addr(kAudioDevicePropertyMute, kAudioDevicePropertyScopeOutput, ch);
    if (AudioObjectHasProperty(dev, &a) &&
        AudioObjectIsPropertySettable(dev, &a, &settable) == noErr && settable) {
      out->push_back(ch);
    }
  }
  return !out->empty();
}

bool GetMuted(AudioDeviceID dev, bool* supported) {
  std::vector<AudioObjectPropertyElement> els;
  *supported = MuteElements(dev, &els);
  if (!*supported) return false;
  for (auto el : els) {  // muted only if every element is muted
    UInt32 m = 0, size = sizeof(m);
    auto a = Addr(kAudioDevicePropertyMute, kAudioDevicePropertyScopeOutput, el);
    if (AudioObjectGetPropertyData(dev, &a, 0, nullptr, &size, &m) != noErr || m == 0) return false;
  }
  return true;
}

bool SetMuted(AudioDeviceID dev, bool muted) {
  std::vector<AudioObjectPropertyElement> els;
  if (!MuteElements(dev, &els)) return false;
  UInt32 m = muted ? 1 : 0;
  bool ok = true;
  for (auto el : els) {
    auto a = Addr(kAudioDevicePropertyMute, kAudioDevicePropertyScopeOutput, el);
    ok &= AudioObjectSetPropertyData(dev, &a, 0, nullptr, sizeof(m), &m) == noErr;
  }
  return ok;
}

double GetVolume(AudioDeviceID dev) {
  Float32 v = 0;
  UInt32 size = sizeof(v);
  auto a = Addr(kAudioHardwareServiceDeviceProperty_VirtualMainVolume, kAudioDevicePropertyScopeOutput);
  if (AudioObjectHasProperty(dev, &a) &&
      AudioObjectGetPropertyData(dev, &a, 0, nullptr, &size, &v) == noErr) {
    return v * 100.0;
  }
  return -1;
}

Napi::Value Read(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  AudioDeviceID dev = DefaultOutput();
  if (dev == kAudioObjectUnknown) return env.Null();
  bool supported = false;
  bool muted = GetMuted(dev, &supported);
  Napi::Object o = Napi::Object::New(env);
  o.Set("deviceId", Napi::Number::New(env, dev));
  o.Set("uid", Napi::String::New(env, CFStringProp(dev, kAudioDevicePropertyDeviceUID)));
  o.Set("name", Napi::String::New(env, CFStringProp(dev, kAudioObjectPropertyName)));
  o.Set("transport", Napi::String::New(env, Transport(dev)));
  o.Set("volume", Napi::Number::New(env, GetVolume(dev)));
  o.Set("muted", Napi::Boolean::New(env, muted));
  o.Set("muteSupported", Napi::Boolean::New(env, supported));
  return o;
}

Napi::Value SetMutedJS(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsBoolean()) {
    Napi::TypeError::New(env, "setMuted(boolean)").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  AudioDeviceID dev = DefaultOutput();
  return Napi::Boolean::New(env, dev != kAudioObjectUnknown && SetMuted(dev, info[0].As<Napi::Boolean>().Value()));
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("read", Napi::Function::New(env, Read));
  exports.Set("setMuted", Napi::Function::New(env, SetMutedJS));
  return exports;
}

}  // namespace

NODE_API_MODULE(audio_control, Init)
