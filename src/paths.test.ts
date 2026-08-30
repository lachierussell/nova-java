import { describe, expect, it } from "vitest";
import { parseJavaMajor, sortJdkDirectoriesNewestFirst } from "./paths";
import { spotlessArgs } from "./format";

describe("parseJavaMajor", () => {
  it("reads modern version strings", () => {
    expect(parseJavaMajor("21.0.1")).toBe(21);
    expect(parseJavaMajor("17")).toBe(17);
    expect(parseJavaMajor("25.0.2")).toBe(25);
  });

  it("reads the legacy 1.x form, where the major version is the second part", () => {
    expect(parseJavaMajor("1.8.0_401")).toBe(8);
    expect(parseJavaMajor("1.7.0")).toBe(7);
  });

  it("reads vendor directory names", () => {
    expect(parseJavaMajor("jdk-21.jdk")).toBe(21);
    expect(parseJavaMajor("temurin-17.jdk")).toBe(17);
    expect(parseJavaMajor("zulu-8.jdk")).toBe(8);
    expect(parseJavaMajor("jdk1.8.0_401.jdk")).toBe(8);
  });

  it("returns null when there is no version to find", () => {
    expect(parseJavaMajor("openjdk")).toBeNull();
  });
});

describe("sortJdkDirectoriesNewestFirst", () => {
  it("orders by version, not lexically", () => {
    // The bug this replaces: a lexical sort puts "jdk-8.jdk" above
    // "jdk-21.jdk", so the extension handed the language server a Java it
    // refuses to run on and the process died before answering anything.
    expect(
      sortJdkDirectoriesNewestFirst(["jdk-21.jdk", "jdk-8.jdk", "jdk-17.jdk"]),
    ).toEqual(["jdk-21.jdk", "jdk-17.jdk", "jdk-8.jdk"]);
  });

  it("puts a modern JDK ahead of a legacy 1.8 one", () => {
    expect(
      sortJdkDirectoriesNewestFirst(["jdk1.8.0_401.jdk", "jdk-21.jdk"]),
    ).toEqual(["jdk-21.jdk", "jdk1.8.0_401.jdk"]);
  });

  it("handles mixed vendors and two-digit versions", () => {
    expect(
      sortJdkDirectoriesNewestFirst([
        "temurin-11.jdk",
        "jdk-9.jdk",
        "zulu-25.jdk",
        "jdk-17.jdk",
      ]),
    ).toEqual(["zulu-25.jdk", "jdk-17.jdk", "temurin-11.jdk", "jdk-9.jdk"]);
  });

  it("sinks unparseable names below real versions", () => {
    const sorted = sortJdkDirectoriesNewestFirst(["openjdk", "jdk-21.jdk"]);
    expect(sorted[0]).toBe("jdk-21.jdk");
  });

  it("does not mutate its input", () => {
    const input = ["jdk-8.jdk", "jdk-21.jdk"];
    sortJdkDirectoriesNewestFirst(input);
    expect(input).toEqual(["jdk-8.jdk", "jdk-21.jdk"]);
  });
});

describe("spotlessArgs", () => {
  const gradlew = "/repo/gradlew";

  it("runs spotlessApply from the wrapper's own directory", () => {
    expect(spotlessArgs(gradlew, "/repo", "/repo", false)).toEqual([
      "bash",
      gradlew,
      "spotlessApply",
    ]);
  });

  it("points Gradle at the module when the project root is a subfolder", () => {
    expect(spotlessArgs(gradlew, "/repo", "/repo/service", false)).toEqual([
      "bash",
      gradlew,
      "-p",
      "/repo/service",
      "spotlessApply",
    ]);
  });

  it("passes --offline so a networkless Gradle fails instead of stalling", () => {
    expect(spotlessArgs(gradlew, "/repo", "/repo", true)).toEqual([
      "bash",
      gradlew,
      "--offline",
      "spotlessApply",
    ]);
  });

  it("combines a subfolder project root with offline mode", () => {
    expect(spotlessArgs(gradlew, "/repo", "/repo/service", true)).toEqual([
      "bash",
      gradlew,
      "-p",
      "/repo/service",
      "--offline",
      "spotlessApply",
    ]);
  });
});
