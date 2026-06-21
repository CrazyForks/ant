{ lib
, llvmPackages_21
, stdenv
, meson
, ninja
, cmake
, pkg-config
, python3
, nodejs_22
, git
, curl
, zig_0_16 ? null
, zig ? null
, importNpmLock
, apple-sdk_15 ? null
, darwin ? null
, callPackage
, gitRev ? "unknown"
}:

let
  zigPkg = if zig_0_16 != null then zig_0_16 else zig;

  cpuTuneFlag = "-mcpu=native";
  antVersion = import ./version.nix { inherit lib gitRev; };
  antVendor = callPackage ./vendor.nix { inherit gitRev; };

  toolsNodeModules = importNpmLock.buildNodeModules {
    package = lib.importJSON ../../src/tools/package.json;
    packageLock = lib.importJSON ../../src/tools/npm-shrinkwrap.json;
    nodejs = nodejs_22;
  };

  extraOptFlags = [
    cpuTuneFlag
    "-Qunused-arguments"
    "-fvisibility=hidden"
    "-fvisibility-inlines-hidden"
    "-fno-math-errno"
    "-fno-trapping-math"
    "-fno-stack-protector"
    "-mllvm" "-enable-machine-outliner=never"
  ];
  optArgs = lib.concatStringsSep " " extraOptFlags;

  pgoFileName = "ant-${stdenv.hostPlatform.parsed.kernel.name}-${stdenv.hostPlatform.parsed.cpu.name}.profdata";
  pgoProfile = ../pgo + "/${pgoFileName}";
  pgoEnabled = builtins.pathExists pgoProfile;
in

llvmPackages_21.stdenv.mkDerivation (finalAttrs: {
  pname = "ant";
  src = ../..;
  version = antVersion;

  nativeBuildInputs = [
    meson
    ninja
    cmake
    pkg-config
    python3
    nodejs_22
    git
    curl
    zigPkg
  ] ++ lib.optionals stdenv.isDarwin [ darwin.sigtool ];

  buildInputs = lib.optionals stdenv.isDarwin [ apple-sdk_15 ];

  postUnpack = ''
    chmod -R u+w "$sourceRoot/vendor"
    cp -rT --no-preserve=mode ${antVendor} "$sourceRoot/vendor"
    chmod -R u+w "$sourceRoot/vendor"
  '';

  mesonFlags = [
    "-Dbuild_git_hash=${gitRev}"
    "-Db_lto_mode=default"
  ];

  NIX_ENFORCE_NO_NATIVE = false;
  env.NIX_CFLAGS_COMPILE = optArgs;

  preConfigure = ''
    export ZIG_GLOBAL_CACHE_DIR=$TMPDIR/zig-cache
    export ZIG_LOCAL_CACHE_DIR=$TMPDIR/zig-local-cache
    mkdir -p "$ZIG_GLOBAL_CACHE_DIR" "$ZIG_LOCAL_CACHE_DIR"

    ln -sfn ${toolsNodeModules}/node_modules src/tools/node_modules
  '' + lib.optionalString pgoEnabled ''

    PROFDATA="$PWD/pgo/${pgoFileName}"
    echo "==> PGO enabled, using $PROFDATA"
    PGO_C_ARGS="-fprofile-use=$PROFDATA -Wno-profile-instr-unprofiled -Wno-profile-instr-out-of-date"
    
    mesonFlagsArray+=(
      "-Dc_args=$PGO_C_ARGS"
      "-Dcpp_args=$PGO_C_ARGS"
      "-Dc_link_args=-fprofile-use=$PROFDATA"
      "-Dcpp_link_args=-fprofile-use=$PROFDATA"
    )
  '';

  installPhase = ''
    runHook preInstall
    install -Dm755 ant "$out/bin/ant"
    ln -s ant          "$out/bin/antx"
    runHook postInstall
  '';

  postFixup = lib.optionalString stdenv.isDarwin ''
    codesign --force --sign - --entitlements ${../../meson/ant.entitlements} "$out/bin/ant"
  '';

  doCheck = false;

  meta = {
    description = "Ant JavaScript runtime";
    homepage = "https://github.com/themackabu/ant";
    license = lib.licenses.mit;
    platforms = lib.platforms.unix;
    mainProgram = "ant";
  };
})
