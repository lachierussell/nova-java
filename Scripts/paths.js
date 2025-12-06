//
// Path utilities for Java extension
//

const Config = require("./config.js");

// Find Java home directory
function findJavaHome() {
  // Check configuration first
  let javaHome = nova.config.get(Config.jdkHome);
  if (javaHome && nova.fs.access(javaHome, nova.fs.F_OK)) {
    return javaHome;
  }

  if (nova.workspace) {
    javaHome = nova.workspace.config.get(Config.jdkHome);
    if (javaHome && nova.fs.access(javaHome, nova.fs.F_OK)) {
      return javaHome;
    }
  }

  // Try jenv first (but don't block on async)
  // jenv support is best-effort, if it fails we fall back to other methods
  try {
    const jenvHome = findJavaHomeViaJenv();
    if (jenvHome && typeof jenvHome === 'string') {
      return jenvHome;
    }
  } catch (err) {
    console.log("jenv check failed:", err);
  }

  // Check JAVA_HOME environment variable
  javaHome = nova.environment.JAVA_HOME;
  if (javaHome && nova.fs.access(javaHome, nova.fs.F_OK)) {
    return javaHome;
  }

  // Try common locations on macOS
  const commonPaths = [
    "/Library/Java/JavaVirtualMachines",
    "/System/Library/Java/JavaVirtualMachines",
  ];

  for (const basePath of commonPaths) {
    try {
      const contents = nova.fs.listdir(basePath);
      if (contents && contents.length > 0) {
        // Sort to get latest version (simple alphabetical sort)
        contents.sort().reverse();
        for (const jdkDir of contents) {
          const jdkPath = nova.path.join(basePath, jdkDir, "Contents", "Home");
          if (nova.fs.access(jdkPath, nova.fs.F_OK)) {
            return jdkPath;
          }
        }
      }
    } catch (err) {
      // Directory doesn't exist, continue
    }
  }

  return null;
}

// Find Java home via jenv
function findJavaHomeViaJenv() {
  try {
    const process = new Process("/usr/bin/env", {
      args: ["bash", "-c", "command -v jenv && jenv javahome"],
    });
    
    let output = "";
    process.onStdout((line) => {
      output += line;
    });
    
    process.start();
    
    // Use onDidExit instead of wait()
    return new Promise((resolve) => {
      process.onDidExit((status) => {
        if (status === 0 && output) {
          const javaHome = output.trim().split("\n").pop();
          if (javaHome && javaHome.startsWith("/") && nova.fs.access(javaHome, nova.fs.F_OK)) {
            console.log("Found Java via jenv:", javaHome);
            resolve(javaHome);
            return;
          }
        }
        resolve(null);
      });
    });
  } catch (err) {
    // jenv not available or error occurred
    console.log("jenv not found or error:", err);
  }
  
  return null;
}

// Find java executable
function findJavaExecutable() {
  const javaHome = findJavaHome();
  if (javaHome) {
    const javaExec = nova.path.join(javaHome, "bin", "java");
    if (nova.fs.access(javaExec, nova.fs.X_OK)) {
      return javaExec;
    }
  }

  // Fallback to PATH
  return "java";
}

module.exports = {
  findJavaHome,
  findJavaExecutable,
};
