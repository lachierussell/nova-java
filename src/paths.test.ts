import { beforeEach, describe, expect, it, vi } from "vitest";
import { installNova, NovaFake } from "./testing/nova";
import {
  findGradleWrapper,
  findJavaExecutable,
  findJdtls,
  findJdtlsConfigPath,
  findJavaHome,
  findProjectRoot,
  findPython,
  parseJavaMajor,
  sortJdkDirectoriesNewestFirst,
} from "./paths";

let nova: NovaFake;

beforeEach(() => {
  nova = installNova();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

/** Lay down a JDK the way macOS does. */
function installJdk(name: string): string {
  const home = `/Library/Java/JavaVirtualMachines/${name}/Contents/Home`;
  nova.fs.mkdirp(home);
  nova.fs.writeFile(`${home}/bin/java`, "", { executable: true });
  return home;
}

describe("parseJavaMajor", () => {
  it("reads modern version strings", () => {
    expect(parseJavaMajor("21.0.1")).toBe(21);
    expect(parseJavaMajor("17")).toBe(17);
  });

  it("reads the legacy 1.x form, where the major version is the second part", () => {
    expect(parseJavaMajor("1.8.0_401")).toBe(8);
  });

  it("reads vendor directory names", () => {
    expect(parseJavaMajor("temurin-17.jdk")).toBe(17);
    expect(parseJavaMajor("jdk1.8.0_401.jdk")).toBe(8);
  });

  it("returns null when there is no version to find", () => {
    expect(parseJavaMajor("openjdk")).toBeNull();
  });
});

describe("sortJdkDirectoriesNewestFirst", () => {
  it("orders by version, not lexically", () => {
    expect(
      sortJdkDirectoriesNewestFirst(["jdk-8.jdk", "jdk-21.jdk", "jdk-17.jdk"]),
    ).toEqual(["jdk-21.jdk", "jdk-17.jdk", "jdk-8.jdk"]);
  });

  it("sinks names with no version below real ones", () => {
    expect(sortJdkDirectoriesNewestFirst(["openjdk", "jdk-17.jdk"])).toEqual([
      "jdk-17.jdk",
      "openjdk",
    ]);
  });
});

describe("findJavaHome", () => {
  it("prefers the configured JDK, even when others are installed", () => {
    const configured = installJdk("temurin-21.jdk");
    installJdk("jdk-25.jdk");
    nova.config.set("java.jdk.home", configured);
    expect(findJavaHome()).toBe(configured);
  });

  it("lets a workspace setting override the global one", () => {
    const global = installJdk("jdk-21.jdk");
    const workspace = installJdk("jdk-25.jdk");
    nova.config.set("java.jdk.home", global);
    nova.workspace.config.set("java.jdk.home", workspace);
    expect(findJavaHome()).toBe(workspace);
  });

  it("falls back to JAVA_HOME", () => {
    const home = installJdk("jdk-21.jdk");
    nova.environment.JAVA_HOME = home;
    expect(findJavaHome()).toBe(home);
  });

  it("ignores a JAVA_HOME that is too old and picks the newest installed JDK", () => {
    nova.environment.JAVA_HOME = installJdk("jdk-8.jdk");
    installJdk("jdk-17.jdk");
    const newest = installJdk("jdk-25.jdk");
    expect(findJavaHome()).toBe(newest);
  });

  it("skips JDKs older than the minimum", () => {
    installJdk("jdk-8.jdk");
    installJdk("jdk-11.jdk");
    expect(findJavaHome()).toBeNull();
  });

  it("resolves a jenv version file in the project root", () => {
    const home = "/Users/tester/.jenv/versions/21.0.1";
    nova.fs.mkdirp(home);
    nova.fs.writeFile("/Users/tester/project/.java-version", "21.0.1\n");
    expect(findJavaHome()).toBe(home);
  });

  it("returns null when there is no JDK anywhere", () => {
    expect(findJavaHome()).toBeNull();
  });
});

describe("findJavaExecutable", () => {
  it("uses the java inside the resolved JAVA_HOME", () => {
    const home = installJdk("jdk-21.jdk");
    expect(findJavaExecutable()).toBe(`${home}/bin/java`);
  });

  it("falls back to the one on $PATH", () => {
    expect(findJavaExecutable()).toBe("java");
  });
});

describe("findJdtls", () => {
  it("finds the Homebrew launcher script", () => {
    nova.fs.writeFile("/opt/homebrew/bin/jdtls", "#!/usr/bin/env python3", {
      executable: true,
    });
    expect(findJdtls()).toBe("/opt/homebrew/bin/jdtls");
  });

  it("resolves the equinox launcher jar through its glob", () => {
    nova.fs.writeFile(
      "/usr/local/share/jdtls/plugins/org.eclipse.equinox.launcher_1.6.900.jar",
    );
    expect(findJdtls()).toBe(
      "/usr/local/share/jdtls/plugins/org.eclipse.equinox.launcher_1.6.900.jar",
    );
  });

  it("falls back to $PATH", () => {
    nova.environment.PATH = "/opt/tools/bin:/usr/bin";
    nova.fs.writeFile("/opt/tools/bin/jdtls", "", { executable: true });
    expect(findJdtls()).toBe("/opt/tools/bin/jdtls");
  });

  it("returns null when nothing is installed", () => {
    expect(findJdtls()).toBeNull();
  });
});

describe("findJdtlsConfigPath", () => {
  const jar = "/usr/local/share/jdtls/plugins/org.eclipse.equinox.launcher_1.jar";

  it("prefers the arm configuration on Apple silicon", () => {
    nova.fs.mkdirp("/opt/homebrew");
    nova.fs.mkdirp("/usr/local/share/jdtls/config_mac");
    nova.fs.mkdirp("/usr/local/share/jdtls/config_mac_arm");
    expect(findJdtlsConfigPath(jar)).toBe("/usr/local/share/jdtls/config_mac_arm");
  });

  it("returns null, with a warning, when the install has none", () => {
    nova.fs.mkdirp("/usr/local/share/jdtls/plugins");
    expect(findJdtlsConfigPath(jar)).toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });
});

describe("findPython", () => {
  it("prefers the system interpreter", () => {
    nova.fs.writeFile("/usr/bin/python3", "", { executable: true });
    nova.fs.writeFile("/opt/homebrew/bin/python3", "", { executable: true });
    expect(findPython()).toBe("/usr/bin/python3");
  });

  it("returns null when there is no python3", () => {
    expect(findPython()).toBeNull();
  });
});

describe("findProjectRoot", () => {
  it("defaults to the workspace", () => {
    expect(findProjectRoot()).toBe("/Users/tester/project");
  });

  it("honours a relative java.project.root", () => {
    nova.fs.mkdirp("/Users/tester/project/server");
    nova.workspace.config.set("java.project.root", "server");
    expect(findProjectRoot()).toBe("/Users/tester/project/server");
  });

  it("honours an absolute path and a ~ prefix", () => {
    nova.fs.mkdirp("/Users/tester/elsewhere");
    nova.workspace.config.set("java.project.root", "~/elsewhere");
    expect(findProjectRoot()).toBe("/Users/tester/elsewhere");
  });

  it("falls back to the workspace when the setting is not a directory", () => {
    nova.workspace.config.set("java.project.root", "nope");
    expect(findProjectRoot()).toBe("/Users/tester/project");
    expect(console.warn).toHaveBeenCalled();
  });
});

describe("findGradleWrapper", () => {
  it("walks up from the project root", () => {
    nova.fs.writeFile("/Users/tester/project/gradlew", "");
    nova.fs.mkdirp("/Users/tester/project/modules/app");
    nova.workspace.config.set("java.project.root", "modules/app");
    expect(findGradleWrapper()).toBe("/Users/tester/project/gradlew");
  });

  it("accepts a configured directory containing gradlew", () => {
    nova.fs.writeFile("/Users/tester/build/gradlew", "");
    nova.workspace.config.set("java.gradle.wrapperPath", "~/build");
    expect(findGradleWrapper()).toBe("/Users/tester/build/gradlew");
  });

  it("warns and gives up when the configured path does not exist", () => {
    nova.workspace.config.set("java.gradle.wrapperPath", "/nope/gradlew");
    expect(findGradleWrapper()).toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });

  it("returns null for a project with no wrapper", () => {
    expect(findGradleWrapper()).toBeNull();
  });
});
