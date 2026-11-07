{
  "targets": [
    {
      "target_name": "input_control",
      "sources": ["src/input_control.mm"],
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
      "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS", "NAPI_VERSION=8"],
      "conditions": [
        ["OS=='mac'", {
          "xcode_settings": {
            "CLANG_ENABLE_OBJC_ARC": "YES",
            "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
            "MACOSX_DEPLOYMENT_TARGET": "12.0",
            "OTHER_CPLUSPLUSFLAGS": ["-ObjC++", "-fobjc-arc"]
          },
          "link_settings": {
            "libraries": ["-framework ApplicationServices", "-framework AppKit", "-framework Carbon", "-framework Foundation"]
          }
        }]
      ]
    }
  ]
}
