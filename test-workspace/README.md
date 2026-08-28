# Test workspace

A tiny Maven project for exercising the Nova Java extension during development.

Open this folder as a workspace in Nova (with the extension installed or running
in dev mode). The JDT language server picks up `pom.xml`, resolves the classpath,
and language features light up across the files under `src/main/java`.

## What to try

| File | Feature |
| --- | --- |
| `Greeter.java` / `FriendlyGreeter.java` | Jump To Definition, Jump To Implementation, Find References |
| `App.java` | Hover, completion, Format File (⌥⇧F), Organize Imports |
| `Playground.java` | Diagnostics + **Code Actions** (⌥⏎): add a missing import; organize imports |

Any symbol works with **Find Symbol** and the **Language Server** sidebar shows
the server status and the resolved JDK.

## Building (optional)

The extension does not need the project to be built, but if you have a JDK and
Maven installed you can compile and run it:

```bash
mvn compile
mvn exec:java -Dexec.mainClass=com.example.App
```
