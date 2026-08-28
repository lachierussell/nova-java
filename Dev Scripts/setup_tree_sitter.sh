#!/bin/bash
#
# Setup and build tree-sitter Java grammar library for Nova
#

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
TREE_SITTER_DIR="$SCRIPT_DIR/tree-sitter-java"
OUTPUT_DIR="$SCRIPT_DIR/../java.novaextension/Syntaxes"

echo "🌳 Setting up tree-sitter Java grammar..."

# Check if tree-sitter-cli is installed
if ! command -v tree-sitter &> /dev/null; then
    echo "❌ Error: tree-sitter CLI not found"
    echo "Install it with: npm install -g tree-sitter-cli"
    exit 1
fi

# Check if compiler is available
if ! command -v cc &> /dev/null; then
    echo "❌ Error: C compiler not found"
    echo "Install Xcode Command Line Tools: xcode-select --install"
    exit 1
fi

# Download tree-sitter-java if not present
if [ ! -d "$TREE_SITTER_DIR" ]; then
    echo "📦 Downloading tree-sitter-java..."
    if command -v git &> /dev/null; then
        git clone https://github.com/tree-sitter/tree-sitter-java.git "$TREE_SITTER_DIR"
    else
        echo "📦 Downloading tree-sitter-java as zip..."
        curl -L https://github.com/tree-sitter/tree-sitter-java/archive/refs/heads/master.zip -o /tmp/tree-sitter-java.zip
        unzip -q /tmp/tree-sitter-java.zip -d /tmp/
        mv /tmp/tree-sitter-java-master "$TREE_SITTER_DIR"
        rm /tmp/tree-sitter-java.zip
    fi
fi

cd "$TREE_SITTER_DIR"

# Generate parser if not already generated
if [ ! -f "src/parser.c" ]; then
    echo "🔧 Generating parser..."
    tree-sitter generate
fi

# Detect architecture
ARCH=$(uname -m)
echo "🖥️  Detected architecture: $ARCH"

# Clean previous builds
rm -f libtree-sitter-java*.dylib

# Build strategy based on architecture
if [ "$ARCH" = "arm64" ]; then
    echo "🔨 Building for Apple Silicon (arm64)..."
    cc -o libtree-sitter-java-arm64.dylib -shared \
        src/parser.c \
        -I./src \
        -O2 \
        -fPIC \
        -arch arm64
    
    # Try to also build for Intel for universal binary
    echo "🔨 Attempting to build for Intel (x86_64)..."
    if cc -o libtree-sitter-java-x86_64.dylib -shared \
        src/parser.c \
        -I./src \
        -O2 \
        -fPIC \
        -arch x86_64 2>/dev/null; then
        
        echo "🔨 Creating universal binary..."
        lipo -create \
            libtree-sitter-java-arm64.dylib \
            libtree-sitter-java-x86_64.dylib \
            -output libtree-sitter-java.dylib
        rm libtree-sitter-java-arm64.dylib libtree-sitter-java-x86_64.dylib
        echo "✅ Universal binary created"
    else
        echo "⚠️  Intel build not available, using arm64-only binary"
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
if [ ! -f "libtree-sitter-java.dylib" ]; then
    echo "❌ Error: Build failed - library not created"
    exit 1
fi

file libtree-sitter-java.dylib

# Test the grammar
echo "🧪 Testing grammar..."
if tree-sitter test 2>/dev/null; then
    echo "✅ Grammar tests passed"
else
    echo "⚠️  Some tests may have failed, but continuing..."
fi

# Copy to Syntaxes directory
echo "📋 Installing to $OUTPUT_DIR..."
mkdir -p "$OUTPUT_DIR"
cp libtree-sitter-java.dylib "$OUTPUT_DIR/"
chmod 755 "$OUTPUT_DIR/libtree-sitter-java.dylib"

# Verify final location
echo ""
echo "✅ Build complete!"
echo ""
echo "📍 Library installed at:"
ls -lh "$OUTPUT_DIR/libtree-sitter-java.dylib"
echo ""
echo "📋 File info:"
file "$OUTPUT_DIR/libtree-sitter-java.dylib"
echo ""
echo "🚀 Ready to use with Nova!"
echo ""
echo "💡 Next steps:"
echo "   1. Open Nova"
echo "   2. Open a .java file"
echo "   3. Enjoy syntax highlighting!"
