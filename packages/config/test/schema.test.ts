import { describe, expect, it } from "vitest";
import { ConfigValidationError, parseConfig } from "../src/schema.js";

const validEnv = {
  COGNODB_URI: "bolt://localhost:7687",
  COGNODB_USER: "neo4j",
  COGNODB_PASSWORD: "s3cret",
  REDIS_URL: "redis://localhost:6379",
  GROQ_API_KEY: "gsk-test-key",
};

describe("parseConfig", () => {
  it("parses a valid environment into a typed config object", () => {
    const config = parseConfig(validEnv);
    expect(config).toEqual(validEnv);
  });

  it("throws a ConfigValidationError naming a missing variable", () => {
    const { COGNODB_URI, ...rest } = validEnv;
    expect(() => parseConfig(rest)).toThrow(ConfigValidationError);

    try {
      parseConfig(rest);
      throw new Error("expected parseConfig to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationError);
      const message = (error as ConfigValidationError).message;
      expect(message).toContain("COGNODB_URI");
    }
  });

  it("throws a ConfigValidationError naming a variable with an invalid URL", () => {
    const env = { ...validEnv, REDIS_URL: "not-a-valid-url" };

    try {
      parseConfig(env);
      throw new Error("expected parseConfig to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationError);
      const message = (error as ConfigValidationError).message;
      expect(message).toContain("REDIS_URL");
      expect(message.toLowerCase()).toContain("url");
    }
  });

  it("reports every missing variable, not just the first", () => {
    try {
      parseConfig({});
      throw new Error("expected parseConfig to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationError);
      const err = error as ConfigValidationError;
      expect(err.issues).toHaveLength(5);
      const names = err.issues.map((issue) => issue.path.join("."));
      expect(names).toEqual(
        expect.arrayContaining([
          "COGNODB_URI",
          "COGNODB_USER",
          "COGNODB_PASSWORD",
          "REDIS_URL",
          "GROQ_API_KEY",
        ])
      );
    }
  });
});
