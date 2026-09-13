import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatAuthFileIdentity,
  formatProviderDisplay,
  getProviderDisplayParts,
  maskSecret,
  resolveProvider,
} from '../src/utils/monitor.ts';

const CODEX_SOURCE = 'codex-32816962-caidaoli+2@gmail.com-team.json';
const ANTIGRAVITY_SOURCE = 'antigravity-caidaoli@gmail.com.json';
const XAI_SOURCE = 'xai-blvox1vcv0oo@bq4bwo.cc.cd.json';
const BARE_EMAIL_JSON = 'soaresgabrielle891@gmail.com.json';
const GEMINI_FILE = 'gemini-putthzli.json';
const GEMINI_EMAIL = 'user@gmail.com';
const API_KEY = 'sk-alpha1234';

const providerMap: Record<string, string> = {
  [CODEX_SOURCE]: 'Codex',
  [ANTIGRAVITY_SOURCE]: 'Antigravity',
  [XAI_SOURCE]: 'xAI',
  [GEMINI_FILE]: 'Gemini',
  [API_KEY]: 'OpenAI',
};

test('resolveProvider 优先精确匹配 provider-map', () => {
  assert.equal(resolveProvider(CODEX_SOURCE, providerMap), 'Codex');
  assert.equal(resolveProvider(ANTIGRAVITY_SOURCE, providerMap), 'Antigravity');
  assert.equal(resolveProvider(API_KEY, providerMap), 'OpenAI');
  assert.equal(resolveProvider('unknown-key', providerMap), null);
});

test('凭证文件提取完整邮箱身份，剥离 provider 前缀与 .json', () => {
  assert.equal(formatAuthFileIdentity(ANTIGRAVITY_SOURCE), 'caidaoli@gmail.com');
  assert.equal(formatAuthFileIdentity(XAI_SOURCE), 'blvox1vcv0oo@bq4bwo.cc.cd');
  assert.equal(formatAuthFileIdentity(CODEX_SOURCE), 'caidaoli+2@gmail.com');
  assert.equal(formatAuthFileIdentity(BARE_EMAIL_JSON), 'soaresgabrielle891@gmail.com');
  assert.equal(formatAuthFileIdentity(GEMINI_FILE), 'putthzli');
});

test('凭证文件不显示外层渠道类型，只显示完整邮箱', () => {
  assert.equal(formatProviderDisplay(CODEX_SOURCE, providerMap), 'caidaoli+2@gmail.com');
  assert.equal(formatProviderDisplay(ANTIGRAVITY_SOURCE, providerMap), 'caidaoli@gmail.com');
  assert.equal(formatProviderDisplay(XAI_SOURCE, providerMap), 'blvox1vcv0oo@bq4bwo.cc.cd');
  assert.equal(formatProviderDisplay(BARE_EMAIL_JSON, {}), 'soaresgabrielle891@gmail.com');

  assert.deepEqual(getProviderDisplayParts(CODEX_SOURCE, providerMap), {
    provider: null,
    masked: 'caidaoli+2@gmail.com',
  });
  assert.deepEqual(getProviderDisplayParts(ANTIGRAVITY_SOURCE, providerMap), {
    provider: null,
    masked: 'caidaoli@gmail.com',
  });
  assert.deepEqual(getProviderDisplayParts(XAI_SOURCE, providerMap), {
    provider: null,
    masked: 'blvox1vcv0oo@bq4bwo.cc.cd',
  });
});

test('凭证文件在 map 缺失时同样不伪装成 Gemini、不带类型前缀', () => {
  assert.notEqual(formatProviderDisplay(CODEX_SOURCE, {}), 'g-cod*eam');
  assert.notEqual(formatProviderDisplay(ANTIGRAVITY_SOURCE, {}), 'g-ant*com');
  assert.notEqual(formatProviderDisplay(ANTIGRAVITY_SOURCE, {}), 'Antigravity (antigr*il.com)');

  assert.equal(formatProviderDisplay(CODEX_SOURCE, {}), 'caidaoli+2@gmail.com');
  assert.equal(formatProviderDisplay(ANTIGRAVITY_SOURCE, {}), 'caidaoli@gmail.com');

  assert.deepEqual(getProviderDisplayParts(CODEX_SOURCE, {}), {
    provider: null,
    masked: 'caidaoli+2@gmail.com',
  });
});

test('真正的 Gemini OAuth 来源保留 g- 紧凑显示（非 .json 裸邮箱）', () => {
  assert.equal(formatProviderDisplay(GEMINI_EMAIL, {}), 'g-user');

  // .json 凭证文件走完整身份提取，不再强制 g-
  assert.equal(formatProviderDisplay(GEMINI_FILE, {}), 'putthzli');
  assert.equal(formatProviderDisplay(GEMINI_FILE, providerMap), 'putthzli');
  assert.deepEqual(getProviderDisplayParts(GEMINI_FILE, providerMap), {
    provider: null,
    masked: 'putthzli',
  });
});

test('API Key 仍使用 maskSecret 风格并拼接 provider', () => {
  assert.equal(maskSecret(API_KEY), 'sk-a***1234');
  assert.equal(maskSecret('short'), 'shor***');
  assert.equal(maskSecret(''), '-');
  assert.equal(formatProviderDisplay(API_KEY, providerMap), 'OpenAI (sk-a***1234)');
  assert.equal(formatProviderDisplay(API_KEY, {}), 'sk-a***1234');
  assert.deepEqual(getProviderDisplayParts(API_KEY, providerMap), {
    provider: 'OpenAI',
    masked: 'sk-a***1234',
  });
});

test('空/unknown source 保持原样', () => {
  assert.equal(formatProviderDisplay('', {}), '-');
  assert.equal(formatProviderDisplay('unknown', {}), 'unknown');
  assert.deepEqual(getProviderDisplayParts('-', {}), {
    provider: null,
    masked: '-',
  });
});
