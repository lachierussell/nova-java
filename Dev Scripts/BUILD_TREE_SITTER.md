# Building Tree-sitter Java Grammar

This guide explains how to build the tree-sitter Java grammar library from source.

## Prerequisites

- **Node.js** (v14 or later)
- **npm** or **yarn**
- **C Compiler:**
  - macOS: Xcode Command Line Tools (`xcode-select --install`)
  - Linux: GCC (`sudo apt install build-essential`)
- **tree-sitter CLI**

## Step-by-Step Build Process

### 1. Install Tree-sitter CLI

```bash
npm install -g tree-sitter-cli
```

Verify installation:
```bash
tree-sitter --version
```

### 2. Clone Tree-sitter Java Repository

```bash
git clone https://github.com/tree-sitter/tree-sitter-java.git
cd tree-sitter-java
```

### 3. Generate Parser

```bash
tree-sitter generate
```

This creates the parser source files in the `src/` directory.

### 4. Compile the Dynamic Library

#### macOS (Intel)
```bash
cc -o libtree-sitter-java.dylib -shared \
  src/parser.c \
  -I./src \
  -O2 \
  -fPIC \
  -arch x86_64
```

#### macOS (Apple Silicon - M1/M2)
```bash
cc -o libtree-sitter-java.dylib -shared \
  src/parser.c \
  -I./src \
  -O2 \
  -fPIC \
  -arch arm64
```

#### macOS (Universal Binary - Both architectures)
```bash
# Build for both architectures
cc -o libtree-sitter-java-x86_64.dylib -shared \
  src/parser.c -I./src -O2 -fPIC -arch x86_64

cc -o libtree-sitter-java-arm64.dylib -shared \
  src/parser.c -I./src -O2 -fPIC -arch arm64

# Combine into universal binary
lipo -create \
  libtree-sitter-java-x86_64.dylib \
  libtree-sitter-java-arm64.dylib \
  -output libtree-sitter-java.dylib
```

#### Linux
```bash
cc -o libtree-sitter-java.so -shared \
  src/parser.c \
  -I./src \
  -O2 \
  -fPIC
```

### 5. Verify the Build

```bash
# Check file type
file libtree-sitter-java.dylib

# Expected output (macOS Intel):
# libtree-sitter-java.dylib: Mach-O 64-bit dynamically linked shared library x86_64

# Expected output (macOS Apple Silicon):
# libtree-sitter-java.dylib: Mach-O 64-bit dynamically linked shared library arm64

# Expected output (Universal):
# libtree-sitter-java.dylib: Mach-O universal binary with 2 architectures
```

Test the grammar:
```bash
tree-sitter test
```

### 6. Copy to Extension

```bash
# Assuming you're in the tree-sitter-java directory
cp libtree-sitter-java.dylib /path/to/nova-java.novaextension/Syntaxes/

# Set proper permissions
chmod 755 /path/to/nova-java.novaextension/Syntaxes/libtree-sitter-java.dylib
```

## Alternative: Using npm Script

Some tree-sitter grammars include build scripts:

```bash
# Check for package.json
cat package.json

# If build scripts exist:
npm install
npm run build

# The output will be in build/Release/
cp build/Release/tree_sitter_java_binding.node \
  /path/to/nova-java.novaextension/Syntaxes/libtree-sitter-java.dylib
```

## Troubleshooting Build Issues

### Compiler Not Found

**macOS:**
```bash
xcode-select --install
# Then retry compilation
```

**Linux:**
```bash
sudo apt update
sudo apt install build-essential
```

### Wrong Architecture

If Nova complains about architecture mismatch:
```bash
# Check Nova's architecture
file /Applications/Nova.app/Contents/MacOS/Nova

# Build matching architecture
# For Apple Silicon Nova, use -arch arm64
# For Intel Nova, use -arch x86_64
```

### Missing Headers

If you get "parser.h not found" error:
```bash
# Make sure you ran generate first
tree-sitter generate

# Verify src directory exists
ls -la src/
```

## Advanced Options

### Optimization Levels

- `-O0`: No optimization (fastest compile, slowest runtime)
- `-O2`: Standard optimization (good balance)
- `-O3`: Maximum optimization (slowest compile, fastest runtime)

### Debug Build

For debugging tree-sitter issues:
```bash
cc -o libtree-sitter-java.dylib -shared \
  src/parser.c \
  -I./src \
  -g \
  -O0 \
  -fPIC
```

### Size Reduction

To minimize binary size:
```bash
cc -o libtree-sitter-java.dylib -shared \
  src/parser.c \
  -I./src \
  -Os \
  -fPIC

# Then strip symbols
strip -x libtree-sitter-java.dylib
```

## Updating the Grammar

To update to the latest tree-sitter Java grammar:

```bash
cd tree-sitter-java
git pull origin master
tree-sitter generate
# Rebuild using steps above
```

## Version Information

Record the version you built:
```bash
# In tree-sitter-java directory
git describe --tags
git rev-parse HEAD

# Save this info for reference
echo "Built from commit: $(git rev-parse HEAD)" > BUILD_INFO.txt
echo "Date: $(date)" >> BUILD_INFO.txt
```

## References

- [Tree-sitter Documentation](https://tree-sitter.github.io/tree-sitter/)
- [Tree-sitter Java Grammar](https://github.com/tree-sitter/tree-sitter-java)
- [Nova Extension Documentation](https://docs.nova.app/)
