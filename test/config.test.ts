import assert from "node:assert/strict";
import { test } from "node:test";
import { readConfig } from "../src/config.ts";

const BASE = { DEEPSEEK_API_KEY: "sk-test" };

test("默认配置：deepseek-flash + max", () => {
  const config = readConfig(BASE);
  assert.equal(config.model, "deepseek-flash");
  assert.equal(config.effort, "max");
  assert.equal(config.threads, 10);
  assert.equal(config.maxSteps, 50);
  assert.equal(config.docLanguage, "中文");
});

test("环境变量覆盖", () => {
  const config = readConfig({
    ...BASE,
    ZREAD_MODEL: "deepseek-v4-pro",
    ZREAD_EFFORT: "low",
    ZREAD_THREADS: "3",
    ZREAD_DOC_LANGUAGE: "English",
  });
  assert.equal(config.model, "deepseek-v4-pro");
  assert.equal(config.effort, "low");
  assert.equal(config.threads, 3);
  assert.equal(config.docLanguage, "English");
});

test("非法值报错", () => {
  assert.throws(() => readConfig({ ...BASE, ZREAD_EFFORT: "ultra" }), /ZREAD_EFFORT/);
  assert.throws(() => readConfig({ ...BASE, ZREAD_THREADS: "x" }), /ZREAD_THREADS/);
});

test("缺少 DEEPSEEK_API_KEY 报错（deepseek 模型）", () => {
  assert.throws(() => readConfig({}), /DEEPSEEK_API_KEY/);
  // 非 deepseek 模型不强制要求该 key
  assert.equal(readConfig({ ZREAD_MODEL: "zai/glm-4.7" }).model, "zai/glm-4.7");
});
