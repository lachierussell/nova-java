#!/bin/bash
#
# Build tree-sitter Java grammar library for Nova
#

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
TREE_SITTER_DIR="$SCRIPT_DIR/tree-sitter-java"
OUTPUT_DIR="$SCRIPT_DIR/Syntaxes"

echo "🔨 Building tree-sitter Java grammar..."

# Check if tree-sitter-cli is installed
if ! command -v tree-sitter &> /dev/null; then
    echo "❌ Error: tree-sitter CLI not found"
    echo "Install it with: npm install -g tree-sitter-cli"
    exit 1
fi

# Check if tree-sitter-java submodule exists
if [ ! -d "$TREE_SITTER_DIR" ]; then
    echo "❌ Error: tree-sitter-java submodule not found"
    echo "Run: git submodule update --init --recursive"
    exit 1
fi

# Check if compiler is available
if ! command -v cc &> /dev/null; then
    echo "❌ Error: C compiler not found"
    echo "Install Xcode Command Line Tools: xcode-select --install"
    exit 1
fi

cd "$TREE_SITTER_DIR"

# Update submodule to latest
echo "📦 Updating tree-sitter-java to latest version..."
git pull origin master || git pull origin main || true

# Generate parser
echo "🔧 Generating parser..."
tree-sitter generate

# Detect architecture
ARCH=$(uname -m)
echo "🖥️  Detected architecture: $ARCH"

# Build for current architecture
if [ "$ARCH" = "arm64" ]; then
    echo "🔨 Building for Apple Silicon (arm64)..."
    cc -o libtree-sitter-java-arm64.dylib -shared \
        src/parser.c \
        -I./src \
        -O2 \
        -fPIC \
        -arch arm64
    
    echo "🔨 Building for Intel (x86_64) for compatibility..."
    cc -o libtree-sitter-java-x86_64.dylib -shared \
        src/parser.c \
        -I./src \
        -O2 \
        -fPIC \
        -arch x86_64 2>/dev/null || echo "⚠️  Intel build skipped (Apple Silicon only machine)"
    
    # Try to create universal binary
    if [ -f "libtree-sitter-java-x86_64.dylib" ]; then
        echo "🔨 Creating universal binary..."
        lipo -create \
            libtree-sitter-java-arm64.dylib \
            libtree-sitter-java-x86_64.dylib \
            -output libtree-sitter-java.dylib
        rm libtree-sitter-java-arm64.dylib libtree-sitter-java-x86_64.dylib
    else
        echo "ℹ️  Creating arm64-only binary..."
        mv libtree-sitter-java-arm64.dylib libtree-sitter-java.dylib
    fi
else
    echo "🔨 Building for Intel (x86_64)..."
    cc -o libtree-sitter-java.dylib -shared \
        src/parser.c \
        -I./src \
        -O2 \
        -fPIC \
        -arch x86_64
fi

# Verify the build
echo "✅ Verifying build..."
file libtree-sitter-java.dylib

# Copy to Syntaxes directory
echo "📋 Copying to $OUTPUT_DIR..."
mkdir -p "$OUTPUT_DIR"
cp libtree-sitter-java.dylib "$OUTPUT_DIR/"
chmod 755 "$OUTPUT_DIR/libtree-sitter-java.dylib"

# Verify final location
echo "✅ Verifying installation..."
ls -lh "$OUTPUT_DIR/libtree-sitter-java.dylib"
file "$OUTPUT_DIR/libtree-sitter-java.dylib"

echo ""
echo "✅ Build complete!"
echo "📍 Library installed at: $OUTPUT_DIR/libtree-sitter-java.dylib"
echo ""
echo "🧪 Test the grammar with:"
echo "   tree-sitter test"
echo ""
echo "🚀 Ready to use with Nova!"
