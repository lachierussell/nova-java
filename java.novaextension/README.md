# Java for Nova

Java language support for Nova, powered by [Eclipse JDT.LS](https://github.com/eclipse-jdtls/eclipse.jdt.ls).
You get completion, diagnostics, navigation and refactoring — the things you'd
expect from a Java IDE — without leaving Nova.

Works with Maven, Gradle and plain Eclipse projects.

## The Java sidebar

![The Java sidebar in Nova, showing the Language Server, References and Symbols sections](https://raw.githubusercontent.com/lachierussell/nova-java/main/Images/sidebar.png)

Three sections, all in one place:

**Language Server** — is it running, and what is it running with? The status dot
turns green once the server has finished importing your project (which can take
a minute on a big one), and the rows below show the JDK, server and project root
it actually resolved. When something isn't working, this is the first place to
look. The refresh button restarts the server.

**References** — results from *Find References*. Click a row to jump to it.

**Symbols** — the structure of the file you're editing: classes, methods and
fields, nested the way they are in the code. It follows whichever file is in
front of you and updates as you type.

## What you get

**Writing code**
- Completion, hover documentation and signature help
- Real-time errors and warnings as you type
- Quick fixes and refactorings at the cursor (`⌥⏎`) — add an import, implement
  an interface, create a missing field
- Optional inline parameter-name hints

**Moving around**
- Jump to Definition, Type Definition and Implementation
- Find References
- Find Symbol across the whole project
- Jumping into a library or JDK class opens its decompiled source

**Tidying up**
- Format File (`⌥⇧F`) or just the selection
- Organize Imports
- Rename Symbol across every file that uses it
- Both formatting and organize-imports can run automatically on save

**Reading code**
- Fast tree-sitter syntax highlighting
- Code folding for classes, methods, blocks and comments

## Before you start

You need two things installed.

**A JDK, version 21 or newer.** The extension finds it automatically from
`JAVA_HOME`, jenv, or the standard macOS locations.

```bash
java -version          # check what you have
brew install openjdk@21
```

**The Eclipse JDT language server.**

```bash
brew install jdtls
```

If either one lives somewhere unusual, point at it in the extension preferences.

## Getting started

1. Install the extension from Nova's Extension Library.
2. Open a Java project. The extension starts on its own when you open a `.java`
   file.
3. Watch the **Language Server** section in the Java sidebar. It says
   *Starting…* with a progress percentage while JDT.LS imports the project, then
   *Running*. Completion and navigation work from that point on.

The first import on a large project takes a while. Later ones are much faster.

## Commands

In the **Editor** menu whenever a Java file is open:

| Command | Shortcut |
| --- | --- |
| Jump To Definition | |
| Jump To Type Definition | |
| Jump To Implementation | |
| Find References | |
| Find Symbol | |
| Code Actions… | `⌥⏎` |
| Rename Symbol | |
| Format File | `⌥⇧F` |
| Format Selection | |
| Organize Imports | |

**Restart Language Server** is in the Extensions menu, and on the sidebar's
Language Server header.

## Settings

Global settings live in `Extensions → Extension Library → Java → Preferences`.
Per-project settings live in `Project → Project Settings → Java`, and override
the global ones.

**Language server** — which server to use, a custom server path, and the JDK
home. Leave these blank unless auto-detection picks the wrong thing.

**Project** — the project root (point JDT.LS at one module instead of a whole
monorepo) and where `gradlew` lives. Per-project settings also cover extra
source paths, the output directory and referenced JARs.

**Formatting** — format on save, organize imports on save, which formatter, and
which style.

**Linting** — turn diagnostics off if you'd rather not see them.

## Formatting

Two options, set by **Formatter** in preferences.

**Language Server (Eclipse JDT)** is the default and needs no project setup.
Pick a style: Google Java Style, AOSP, Eclipse's own default, or Custom — which
takes an Eclipse formatter XML file, either a local path or a URL.

**Gradle Spotless** runs `./gradlew spotlessApply` instead, so your project's
own Spotless config decides the formatting. Use this if your team already
standardises on Spotless — it's also how to get Palantir Java Format, which the
Eclipse formatter can't do.

```gradle
plugins {
    id 'com.diffplug.spotless' version '6.x.x'
}

spotless {
    java {
        palantirJavaFormat()
    }
}
```

Spotless rewrites files on disk and Nova reloads them. On a machine with no
network, turn on **Run Spotless offline** — otherwise Gradle spends minutes
trying to reach the plugin portal and formatting appears to hang.

## When something's wrong

Check the **Language Server** section first. It tells you what the extension
resolved and what state the server is in:

- *Failed* with no JDK — install a JDK 21+, or set **Java JDK Home**.
- *Failed* with no server — `brew install jdtls`, or set a custom server path.
- Stuck on *Starting…* — JDT.LS is still importing. Large projects take a while.
- Nothing works, but the status says *Running* — open the Extension Console
  (`Extensions → Show Extension Console`). Turning on **Log language server
  traffic** in preferences records the full conversation with the server.

If the server gets wedged, **Restart Language Server** gives it a clean start.

## Building from source

Written in TypeScript, bundled with Vite.

```bash
npm install       # dev dependencies
npm run build     # bundle src/ → Scripts/main.dist.js
npm run watch     # rebuild on change
npm run typecheck # type-check only
npm test          # run the test suite
```

`Scripts/main.dist.js` is generated and not committed, so run `npm run build`
before installing or submitting.

## Acknowledgements

Originally forked from, and still heavily inspired by, the
[nova-gobee](https://github.com/gobee-dev/nova-gobee) extension.

---

Bugs and feature requests: [github.com/lachierussell/nova-java/issues](https://github.com/lachierussell/nova-java/issues)
