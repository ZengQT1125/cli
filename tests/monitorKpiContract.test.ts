import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMonitorChannelStatsModelFilter,
  applyMonitorFailureAnalysisModelFilter,
  buildMonitorChannelDistributionItems,
  buildMonitorModelDistributionItems,
  calculateMonitorAggregateCost,
  calculateMonitorRequestCost,
  computeUncachedInputTokens,
  formatCacheTokenRatio,
  formatMonitorCost,
  normalizeMonitorInputTokens,
  formatOutputTokensPerSecond,
  formatMonitorNumber,
  mergeMonitorFilterOptions,
  normalizeMonitorHourlyModelsData,
  normalizeMonitorHourlyTokensData,
  normalizeMonitorKpiData,
} from '../src/utils/monitor.ts';
import { calculateModelCost } from '../src/utils/costCalculator.ts';
import {
  claudeModelPricing,
  geminiModelPricing,
  openAIModelPricing,
  xAIModelPricing,
  type ModelPricing,
} from '../src/data/modelPricing.generated.ts';

test('监控 KPI 响应缺少数字字段时归一化为 0', () => {
  const normalized = normalizeMonitorKpiData({
    total_requests: 12,
    success_requests: 9,
    failed_requests: 3,
    success_rate: 75,
    total_tokens: 12345,
  });

  assert.deepEqual(normalized, {
    total_requests: 12,
    success_requests: 9,
    failed_requests: 3,
    success_rate: 75,
    total_tokens: 12345,
    input_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
    cached_tokens: 0,
    cache_write_tokens: 0,
    avg_tpm: 0,
    avg_rpm: 0,
    avg_rpd: 0,
  });
});

test('监控 KPI 空响应保持为空数据', () => {
  assert.equal(normalizeMonitorKpiData({}), null);
  assert.equal(normalizeMonitorKpiData(null), null);
});

test('监控 KPI 数字格式化接受 undefined 和非数字脏值', () => {
  assert.equal(formatMonitorNumber(undefined), '0');
  assert.equal(formatMonitorNumber(Number.NaN), '0');
  assert.equal(formatMonitorNumber('1234'), '1.23K');
});

test('监控输入 token 展示同时扣除缓存读取和缓存写入部分', () => {
  assert.equal(computeUncachedInputTokens(42504, 36605), 5899);
  assert.equal(computeUncachedInputTokens(1000, 200, 300), 500);
  assert.equal(computeUncachedInputTokens(1000, 0), 1000);
  assert.equal(computeUncachedInputTokens(Number.NaN, 100), 0);
});

// 上游 input_tokens 是双口径的：Gemini/OpenAI 系的 promptTokenCount 已含缓存，
// Claude 系的 input_tokens 只是非缓存部分。两者必须归一到后端 TokenBreakdown.Input
// 的三段式契约（total = uncached + cacheRead + cacheWrite）后才能算缓存率和费用。
test('监控输入 token 口径归一：Claude 系非缓存口径按三段式求和还原总输入', () => {
  // Claude：input_tokens=2 不含缓存，总输入应为 2 + 53409 + 0
  assert.equal(normalizeMonitorInputTokens(2, 53409, 0), 53411);
  // Claude 含缓存写入
  assert.equal(normalizeMonitorInputTokens(2, 53409, 1000), 54411);
  // Gemini：promptTokenCount=132976 已含缓存，保持原值
  assert.equal(normalizeMonitorInputTokens(132976, 130587, 0), 132976);
  // 边界：input 恰等于缓存合计，视为已含缓存口径
  assert.equal(normalizeMonitorInputTokens(1000, 1000, 0), 1000);
  // 无缓存时原样返回
  assert.equal(normalizeMonitorInputTokens(1000, 0, 0), 1000);
  // 脏值归零
  assert.equal(normalizeMonitorInputTokens(Number.NaN, 100, 0), 100);
});

test('监控非缓存输入基于归一化后的总输入计算', () => {
  // Claude：非缓存输入就是原始的 2，不该被钳成 0
  assert.equal(computeUncachedInputTokens(normalizeMonitorInputTokens(2, 53409, 0), 53409, 0), 2);
  // Gemini：从含缓存的总输入里扣除
  assert.equal(
    computeUncachedInputTokens(normalizeMonitorInputTokens(132976, 130587, 0), 130587, 0),
    2389
  );
});

test('监控缓存率基于归一化后的总输入，不会超过 100%', () => {
  // 复现 bug：Claude 请求曾算出 2670450.0%
  assert.equal(
    formatCacheTokenRatio(53409, normalizeMonitorInputTokens(2, 53409, 0)).ratio,
    '100.0%'
  );
  assert.equal(
    formatCacheTokenRatio(130587, normalizeMonitorInputTokens(132976, 130587, 0)).ratio,
    '98.2%'
  );
});

test('监控 Tok/s 按有效输出耗时计算', () => {
  assert.equal(formatOutputTokensPerSecond(100, 5000, 2000, true), '33.3');
  assert.equal(formatOutputTokensPerSecond(100, 1500, 800, true), '66.7');
  assert.equal(formatOutputTokensPerSecond(100, 5000, 2000, false), '20.0');
  assert.equal(formatOutputTokensPerSecond(100, 4000, 0, false), '25.0');
  assert.equal(formatOutputTokensPerSecond(0, 4000, 0, false), '-');
  assert.equal(formatOutputTokensPerSecond(100, 0, 0, false), '-');
});

test('监控费用按模型价格和缓存 token 计算', () => {
  assert.equal(calculateMonitorRequestCost('gpt-5.5', 2_000_000, 1_000_000, 1_000_000), 56);
  assert.equal(calculateMonitorRequestCost('gemini-3.1-pro', 300_000, 100_000, 50_000), 2.82);
  assert.equal(
    calculateMonitorRequestCost('claude-sonnet-4-5-20250929', 2_000_000, 1_000_000, 1_000_000),
    18.3
  );
  assert.equal(calculateMonitorRequestCost('unknown-model', 1_000_000, 1_000_000, 0), 0);
});

test('OpenAI 费用包含 cache write 且按总输入扣除缓存 token', () => {
  assert.equal(calculateModelCost('gpt-5.6', 200_000, 100_000, 50_000, 50_000), 3.8375);
  assert.equal(calculateMonitorRequestCost('gpt-5.6', 200_000, 100_000, 50_000, 50_000), 3.8375);
  assert.equal(calculateMonitorAggregateCost('gpt-5.6', 200_000, 100_000, 50_000, 50_000), 3.8375);
});

test('Codex Fast 请求按模型扣费倍率计算', () => {
  const gpt56Standard = calculateMonitorRequestCost('gpt-5.6', 200_000, 100_000, 50_000, 50_000);
  const gpt55Standard = calculateMonitorRequestCost(
    'gpt-5.5-high',
    200_000,
    100_000,
    50_000,
    50_000
  );
  const gpt54Standard = calculateMonitorRequestCost('gpt-5.4', 200_000, 100_000, 50_000, 50_000);

  assert.equal(
    calculateMonitorRequestCost('gpt-5.6', 200_000, 100_000, 50_000, 50_000, true),
    gpt56Standard * 2.5
  );
  assert.equal(
    calculateMonitorRequestCost('gpt-5.5-high', 200_000, 100_000, 50_000, 50_000, true),
    gpt55Standard * 2.5
  );
  assert.equal(
    calculateMonitorRequestCost('gpt-5.4', 200_000, 100_000, 50_000, 50_000, true),
    gpt54Standard * 2
  );
  assert.equal(
    calculateMonitorRequestCost('gpt-5.3', 200_000, 100_000, 50_000, 50_000, true),
    calculateMonitorRequestCost('gpt-5.3', 200_000, 100_000, 50_000, 50_000)
  );
});

test('监控聚合费用只对 Fast token 部分追加倍率', () => {
  const standardCost = calculateMonitorAggregateCost('gpt-5.6', 200_000, 100_000, 50_000, 50_000);
  const fastStandardCost = calculateMonitorAggregateCost(
    'gpt-5.6',
    100_000,
    50_000,
    25_000,
    25_000
  );

  assert.equal(
    calculateMonitorAggregateCost('gpt-5.6', 200_000, 100_000, 50_000, 50_000, {
      inputTokens: 100_000,
      outputTokens: 50_000,
      cachedTokens: 25_000,
      cacheWriteTokens: 25_000,
    }),
    standardCost + fastStandardCost * 1.5
  );
});

test('OpenAI 长上下文阶梯价覆盖 cache read 和 cache write', () => {
  assert.equal(calculateModelCost('gpt-5.6', 400_000, 100_000, 100_000, 100_000), 7.85);
});

test('models.dev OpenAI 快照包含 o-series、embedding 和精确 Codex 价格', () => {
  assert.equal(calculateModelCost('o3', 1_000_000, 1_000_000), 10);
  assert.equal(calculateModelCost('text-embedding-3-large', 1_000_000, 0), 0.13);
  assert.equal(calculateModelCost('gpt-5.2-codex', 1_000_000, 1_000_000), 15.75);
});

test('models.dev 四家价格快照中的每个模型都参与费用计算', () => {
  const tables: Array<[string, Record<string, ModelPricing>]> = [
    ['Gemini', geminiModelPricing],
    ['OpenAI', openAIModelPricing],
    ['Claude', claudeModelPricing],
    ['xAI', xAIModelPricing],
  ];

  for (const [provider, table] of tables) {
    assert.ok(Object.keys(table).length > 0, `${provider} price table must not be empty`);
    for (const [model, pricing] of Object.entries(table)) {
      const actual = calculateModelCost(model, 1_000_000, 1_000_000, 0, 0, {
        applyLongContextTier: false,
      });
      const expected = pricing.inputPrice + pricing.outputPrice;
      assert.ok(Math.abs(actual - expected) < 1e-10, `${provider}:${model}`);
    }
  }
});

test('xAI context tier 使用生成快照中的阈值和高阶价格', () => {
  const tierEntry = Object.entries(xAIModelPricing).find(
    ([, pricing]) => pricing.tierThreshold !== undefined && pricing.inputPriceHigh !== undefined
  );
  assert.ok(tierEntry, 'xAI snapshot must include a context-tier model');

  const [model, pricing] = tierEntry;
  const inputTokens = pricing.tierThreshold + 1;
  const expected = (inputTokens * pricing.inputPriceHigh) / 1_000_000;
  assert.equal(calculateModelCost(model, inputTokens, 0), expected);
});

test('已下架模型继续使用明确的历史价格 fallback', () => {
  assert.equal(calculateModelCost('claude-3-haiku', 1_000_000, 1_000_000), 1.5);
  assert.equal(calculateModelCost('gemini-1.5-flash', 1_000_000, 1_000_000), 0.8);
});

// models.dev 的 openai 源下架了这些变体，但它们仍出现在真实请求日志里。
// 前缀 fallback 会把降档变体错配到基础型号（codex-mini 曾按 gpt-5.1 全价高估 5 倍），
// 因此必须在 legacy 表中固化 models.dev 其他 provider 记录的真实价格。
test('models.dev 已下架的 OpenAI 变体使用固化的真实价格而非前缀猜测', () => {
  // 降档变体：真实 0.25/2，前缀 fallback 到 gpt-5.1 会得到 11.25
  assert.equal(calculateModelCost('gpt-5.1-codex-mini', 1_000_000, 1_000_000), 2.25);
  // 同档变体：与基础型号价格一致
  assert.equal(calculateModelCost('gpt-5.1-codex', 1_000_000, 1_000_000), 11.25);
  assert.equal(calculateModelCost('gpt-5.1-codex-max', 1_000_000, 1_000_000), 11.25);
  assert.equal(calculateModelCost('gpt-5-codex', 1_000_000, 1_000_000), 11.25);
  assert.equal(calculateModelCost('gpt-5.2-codex', 1_000_000, 1_000_000), 15.75);
  assert.equal(calculateModelCost('gpt-5-chat-latest', 1_000_000, 1_000_000), 11.25);
  assert.equal(calculateModelCost('gpt-5.1-chat-latest', 1_000_000, 1_000_000), 11.25);
  // models.dev 已完全移除、无任何来源的模型保留上一版快照的真实价格。
  // 前缀 fallback 曾把它们错配到 o3(2+8=10) 和 o4-mini(1.1+4.4=5.5)。
  assert.equal(calculateModelCost('o3-deep-research', 1_000_000, 1_000_000), 50);
  assert.equal(calculateModelCost('o4-mini-deep-research', 1_000_000, 1_000_000), 10);
});

test('降档后缀不会被前缀 fallback 错配到基础型号', () => {
  // gpt-5.1-codex-mini 的 cache read 也应按 mini 档，而非 gpt-5.1 档
  const miniCacheCost = calculateModelCost('gpt-5.1-codex-mini', 1_000_000, 0, 1_000_000);
  const baseCacheCost = calculateModelCost('gpt-5.1', 1_000_000, 0, 1_000_000);
  assert.ok(
    miniCacheCost < baseCacheCost,
    `mini 档缓存费用 ${miniCacheCost} 必须低于基础档 ${baseCacheCost}`
  );
});

// 前缀 fallback 是猜测，对推理档位后缀（-high/-low）安全——同一模型价格相同；
// 对规格后缀（-mini/-nano/-lite）危险——那是价格差数倍的不同模型。
// 未知的降档变体宁可返回 0（费用显示为 "-"）也不能静默按基础型号高估。
test('未知降档变体不被前缀 fallback 按基础型号计费', () => {
  // 基础型号存在，但 -mini/-nano/-lite 变体未收录：拒绝猜测
  assert.equal(calculateModelCost('gpt-5.6-mini', 1_000_000, 1_000_000), 0);
  assert.equal(calculateModelCost('gpt-5.6-nano', 1_000_000, 1_000_000), 0);
  assert.equal(calculateModelCost('gemini-3.6-flash-lite', 1_000_000, 1_000_000), 0);
});

test('推理档位后缀仍走前缀 fallback 按基础型号计费', () => {
  const base = calculateModelCost('gemini-3.6-flash', 1_000_000, 1_000_000);
  assert.ok(base > 0, 'gemini-3.6-flash 必须已收录');
  assert.equal(calculateModelCost('gemini-3.6-flash-high', 1_000_000, 1_000_000), base);
  assert.equal(calculateModelCost('gemini-3.6-flash-low', 1_000_000, 1_000_000), base);
  // 已显式收录的降档模型不受影响，走精确匹配
  assert.equal(calculateModelCost('gpt-5.4-mini', 1_000_000, 1_000_000), 5.25);
});

test('观测到的 Gemini 名称映射到 canonical preview 定价', () => {
  const aliasCost = calculateModelCost('gemini-3.1-pro', 1_000_000, 1_000_000, 0, 0, {
    applyLongContextTier: false,
  });
  const canonicalCost = calculateModelCost('gemini-3.1-pro-preview', 1_000_000, 1_000_000, 0, 0, {
    applyLongContextTier: false,
  });
  assert.equal(aliasCost, canonicalCost);
});

test('gemini-3-flash-agent 使用 gemini-3.5-flash 定价', () => {
  const observedCost = calculateMonitorRequestCost('gemini-3-flash-agent', 1_000_000, 1_000_000, 0);
  const canonicalCost = calculateMonitorRequestCost('gemini-3.5-flash', 1_000_000, 1_000_000, 0);

  assert.equal(observedCost, canonicalCost);
});

test('缓存 token 超过输入 token 时普通输入费用归零', () => {
  assert.equal(calculateModelCost('gpt-5.6', 100, 0, 200, 300), 0.001975);
});

test('监控聚合费用不按累计 token 触发长上下文阶梯价', () => {
  assert.equal(calculateMonitorRequestCost('gpt-5.5', 3_715_000, 15_000, 3_200_000), 9.025);
  assert.equal(calculateMonitorAggregateCost('gpt-5.5', 3_715_000, 15_000, 3_200_000), 4.625);
});

test('监控费用格式化固定使用美元短格式', () => {
  assert.equal(formatMonitorCost(35.5), '$35.5000');
  assert.equal(formatMonitorCost(0.012345), '$0.0123');
  assert.equal(formatMonitorCost(0), '-');
});

test('小时图响应缺少数组字段时归一化为空数据', () => {
  assert.deepEqual(normalizeMonitorHourlyModelsData({ hours: ['2026-06-26T12:00:00Z'] }), {
    hours: ['2026-06-26T12:00:00Z'],
    models: [],
    model_data: {},
    success_rates: [],
  });

  assert.deepEqual(normalizeMonitorHourlyTokensData({ total_tokens: [1200] }), {
    hours: [],
    total_tokens: [1200],
    input_tokens: [],
    output_tokens: [],
    reasoning_tokens: [],
    cached_tokens: [],
    cache_write_tokens: [],
  });
});

test('渠道统计按选中模型过滤展开行并重算渠道汇总', () => {
  const raw = [
    {
      source: 'yga-key',
      total_requests: 467,
      success_requests: 445,
      failed_requests: 22,
      input_tokens: 5_117_000,
      output_tokens: 213_700,
      cached_tokens: 43_002_000,
      cache_write_tokens: 102_000,
      success_rate: 95.3,
      last_request_at: '2026-06-27T08:10:08Z',
      recent_requests: [{ failed: false, timestamp: '2026-06-27T08:10:08Z' }],
      models: [
        {
          model: 'gpt-5.5',
          requests: 458,
          success: 436,
          failed: 22,
          input_tokens: 5_100_000,
          output_tokens: 209_000,
          cached_tokens: 43_000_000,
          cache_write_tokens: 100_000,
          success_rate: 95.2,
          last_request_at: '2026-06-27T07:54:35Z',
          recent_requests: [{ failed: true, timestamp: '2026-06-27T07:54:35Z' }],
        },
        {
          model: 'gpt-5.4-mini',
          requests: 9,
          success: 9,
          failed: 0,
          input_tokens: 17_000,
          output_tokens: 4_700,
          cached_tokens: 2_700,
          cache_write_tokens: 2_000,
          success_rate: 100,
          last_request_at: '2026-06-27T08:10:08Z',
          recent_requests: [{ failed: false, timestamp: '2026-06-27T08:10:08Z' }],
        },
      ],
    },
    {
      source: 'other-key',
      total_requests: 1,
      success_requests: 1,
      failed_requests: 0,
      input_tokens: 100,
      output_tokens: 20,
      cached_tokens: 0,
      cache_write_tokens: 0,
      success_rate: 100,
      last_request_at: '2026-06-27T08:11:00Z',
      recent_requests: [{ failed: false, timestamp: '2026-06-27T08:11:00Z' }],
      models: [
        {
          model: 'gpt-5.5',
          requests: 1,
          success: 1,
          failed: 0,
          input_tokens: 100,
          output_tokens: 20,
          cached_tokens: 0,
          cache_write_tokens: 0,
          success_rate: 100,
          last_request_at: '2026-06-27T08:11:00Z',
          recent_requests: [{ failed: false, timestamp: '2026-06-27T08:11:00Z' }],
        },
      ],
    },
  ];

  const filtered = applyMonitorChannelStatsModelFilter(raw, 'gpt-5.4-mini');

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].source, 'yga-key');
  assert.deepEqual(
    filtered[0].models.map((model) => model.model),
    ['gpt-5.4-mini']
  );
  assert.equal(filtered[0].total_requests, 9);
  assert.equal(filtered[0].success_requests, 9);
  assert.equal(filtered[0].failed_requests, 0);
  assert.equal(filtered[0].input_tokens, 17_000);
  assert.equal(filtered[0].output_tokens, 4_700);
  assert.equal(filtered[0].cached_tokens, 2_700);
  assert.equal(filtered[0].cache_write_tokens, 2_000);
  assert.equal(filtered[0].success_rate, 100);
  assert.equal(filtered[0].last_request_at, '2026-06-27T08:10:08Z');
  assert.deepEqual(filtered[0].recent_requests, [
    { failed: false, timestamp: '2026-06-27T08:10:08Z' },
  ]);
  assert.equal(raw[0].total_requests, 467);
  assert.equal(raw[0].models.length, 2);
});

test('失败来源分析按选中模型过滤展开行并重算失败汇总', () => {
  const raw = [
    {
      source: 'yga-key',
      failed_count: 23,
      last_failed_at: '2026-06-27T08:10:08Z',
      models: [
        {
          model: 'gpt-5.5',
          requests: 458,
          success: 436,
          failed: 22,
          input_tokens: 5_100_000,
          output_tokens: 209_000,
          cached_tokens: 43_000_000,
          success_rate: 95.2,
          last_request_at: '2026-06-27T07:54:35Z',
          recent_requests: [{ failed: true, timestamp: '2026-06-27T07:54:35Z' }],
        },
        {
          model: 'gpt-5.4-mini',
          requests: 9,
          success: 8,
          failed: 1,
          input_tokens: 17_000,
          output_tokens: 4_700,
          cached_tokens: 2_700,
          success_rate: 88.9,
          last_request_at: '2026-06-27T08:10:08Z',
          recent_requests: [{ failed: true, timestamp: '2026-06-27T08:10:08Z' }],
        },
      ],
    },
    {
      source: 'other-key',
      failed_count: 2,
      last_failed_at: '2026-06-27T08:11:00Z',
      models: [
        {
          model: 'gpt-5.4-mini',
          requests: 4,
          success: 4,
          failed: 0,
          input_tokens: 100,
          output_tokens: 20,
          cached_tokens: 0,
          success_rate: 100,
          last_request_at: '2026-06-27T08:11:00Z',
          recent_requests: [{ failed: false, timestamp: '2026-06-27T08:11:00Z' }],
        },
        {
          model: 'gpt-5.5',
          requests: 2,
          success: 0,
          failed: 2,
          input_tokens: 100,
          output_tokens: 20,
          cached_tokens: 0,
          success_rate: 0,
          last_request_at: '2026-06-27T08:11:00Z',
          recent_requests: [{ failed: true, timestamp: '2026-06-27T08:11:00Z' }],
        },
      ],
    },
  ];

  const filtered = applyMonitorFailureAnalysisModelFilter(raw, 'gpt-5.4-mini');

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].source, 'yga-key');
  assert.equal(filtered[0].failed_count, 1);
  assert.equal(filtered[0].last_failed_at, '2026-06-27T08:10:08Z');
  assert.deepEqual(
    filtered[0].models.map((model) => model.model),
    ['gpt-5.4-mini']
  );
  assert.equal(raw[0].failed_count, 23);
  assert.equal(raw[0].models.length, 2);
});

test('监控筛选项在任一请求 Key、渠道或模型筛选激活时保留原始可选集合', () => {
  const previous = {
    requestKeys: ['request-key-a', 'request-key-b'],
    channels: ['alpha-key', 'beta-key', 'gamma-key'],
    models: ['gpt-5.5', 'gpt-5.4-mini'],
  };
  const narrowed = {
    requestKeys: ['request-key-a'],
    channels: ['alpha-key'],
    models: ['gpt-5.5'],
  };

  assert.deepEqual(
    mergeMonitorFilterOptions(previous, narrowed, { channel: 'alpha-key' }),
    previous
  );

  assert.deepEqual(mergeMonitorFilterOptions(previous, narrowed, { model: 'gpt-5.5' }), previous);

  assert.deepEqual(
    mergeMonitorFilterOptions(previous, narrowed, { channel: 'alpha-key', model: 'gpt-5.5' }),
    previous
  );

  assert.deepEqual(
    mergeMonitorFilterOptions(previous, narrowed, { requestKey: 'request-key-a' }),
    previous
  );

  assert.deepEqual(mergeMonitorFilterOptions(previous, narrowed, {}), narrowed);
});

test('渠道用量分布按 Token 或费用生成 Top 项并格式化渠道名', () => {
  const items = [
    {
      source: 'sk-alpha1234',
      total_requests: 8,
      success_requests: 8,
      failed_requests: 0,
      input_tokens: 1_000_000,
      output_tokens: 500_000,
      cached_tokens: 40,
      success_rate: 100,
      recent_requests: [],
      models: [
        {
          model: 'gpt-5.5',
          requests: 8,
          success: 8,
          failed: 0,
          input_tokens: 1_000_000,
          output_tokens: 500_000,
          cached_tokens: 40,
          success_rate: 100,
          recent_requests: [],
        },
      ],
    },
    {
      source: 'plainchannel',
      total_requests: 3,
      success_requests: 3,
      failed_requests: 0,
      input_tokens: 400_000,
      output_tokens: 10_000,
      cached_tokens: 300,
      success_rate: 100,
      recent_requests: [],
      models: [
        {
          model: 'gpt-5-mini',
          requests: 3,
          success: 3,
          failed: 0,
          input_tokens: 400_000,
          output_tokens: 10_000,
          cached_tokens: 300,
          success_rate: 100,
          recent_requests: [],
        },
      ],
    },
  ];

  assert.deepEqual(
    buildMonitorChannelDistributionItems(items, { 'sk-alpha1234': 'OpenAI' }, 'token', 2),
    [
      { label: 'OpenAI (sk-a***1234)', tokens: 1_500_000, cost: 19.99982 },
      { label: 'plai***nnel', tokens: 410_000, cost: 0.1199325 },
    ]
  );

  assert.deepEqual(
    buildMonitorChannelDistributionItems(items, { 'sk-alpha1234': 'OpenAI' }, 'cost', 1),
    [{ label: 'OpenAI (sk-a***1234)', tokens: 1_500_000, cost: 19.99982 }]
  );
});

test('渠道用量分布超过九个渠道时聚合为其他', () => {
  const items = Array.from({ length: 12 }, (_, index) => {
    const rank = 12 - index;

    return {
      source: `channel-${rank}`,
      total_requests: rank,
      success_requests: rank,
      failed_requests: 0,
      input_tokens: rank * 10,
      output_tokens: rank,
      cached_tokens: 0,
      success_rate: 100,
      recent_requests: [],
      models: [],
    };
  });

  const distribution = buildMonitorChannelDistributionItems(items, {}, 'token', 10, '其他');

  assert.equal(distribution.length, 10);
  assert.deepEqual(
    distribution.slice(0, 9).map((item) => item.tokens),
    [132, 121, 110, 99, 88, 77, 66, 55, 44]
  );
  assert.deepEqual(distribution[9], {
    label: '其他',
    tokens: 66,
    cost: 0,
  });
});

test('模型用量分布从渠道模型明细聚合 Token 和费用', () => {
  const items = [
    {
      source: 'channel-a',
      total_requests: 2,
      success_requests: 2,
      failed_requests: 0,
      input_tokens: 1_700_000,
      output_tokens: 600_000,
      cached_tokens: 50_000,
      success_rate: 100,
      recent_requests: [],
      models: [
        {
          model: 'gpt-5.5',
          requests: 1,
          success: 1,
          failed: 0,
          input_tokens: 1_000_000,
          output_tokens: 500_000,
          cached_tokens: 0,
          success_rate: 100,
          recent_requests: [],
        },
        {
          model: 'gpt-5-mini',
          requests: 1,
          success: 1,
          failed: 0,
          input_tokens: 700_000,
          output_tokens: 100_000,
          cached_tokens: 50_000,
          success_rate: 100,
          recent_requests: [],
        },
      ],
    },
    {
      source: 'channel-b',
      total_requests: 1,
      success_requests: 1,
      failed_requests: 0,
      input_tokens: 500_000,
      output_tokens: 100_000,
      cached_tokens: 0,
      success_rate: 100,
      recent_requests: [],
      models: [
        {
          model: 'gpt-5.5',
          requests: 1,
          success: 1,
          failed: 0,
          input_tokens: 500_000,
          output_tokens: 100_000,
          cached_tokens: 0,
          success_rate: 100,
          recent_requests: [],
        },
      ],
    },
  ];

  assert.deepEqual(buildMonitorModelDistributionItems(items, 'cost', 2), [
    { label: 'gpt-5.5', tokens: 2_100_000, cost: 25.5 },
    { label: 'gpt-5-mini', tokens: 800_000, cost: 0.36375 },
  ]);
});

test('渠道和模型费用分布包含 cache write 成本', () => {
  const items = [
    {
      source: 'openai-key',
      total_requests: 1,
      success_requests: 1,
      failed_requests: 0,
      input_tokens: 200_000,
      output_tokens: 100_000,
      cached_tokens: 50_000,
      cache_write_tokens: 50_000,
      success_rate: 100,
      recent_requests: [],
      models: [
        {
          model: 'gpt-5.6',
          requests: 1,
          success: 1,
          failed: 0,
          input_tokens: 200_000,
          output_tokens: 100_000,
          cached_tokens: 50_000,
          cache_write_tokens: 50_000,
          success_rate: 100,
          recent_requests: [],
        },
      ],
    },
  ];

  assert.deepEqual(buildMonitorChannelDistributionItems(items, {}, 'cost'), [
    { label: 'open***-key', tokens: 300_000, cost: 3.8375 },
  ]);
  assert.deepEqual(buildMonitorModelDistributionItems(items, 'cost'), [
    { label: 'gpt-5.6', tokens: 300_000, cost: 3.8375 },
  ]);
});

test('渠道和模型费用分布只对 Codex Fast token 子集加价', () => {
  const items = [
    {
      source: 'codex-key',
      total_requests: 2,
      success_requests: 2,
      failed_requests: 0,
      input_tokens: 200_000,
      output_tokens: 100_000,
      cached_tokens: 50_000,
      cache_write_tokens: 50_000,
      success_rate: 100,
      recent_requests: [],
      models: [
        {
          model: 'gpt-5.6',
          requests: 2,
          success: 2,
          failed: 0,
          input_tokens: 200_000,
          output_tokens: 100_000,
          cached_tokens: 50_000,
          cache_write_tokens: 50_000,
          fast_input_tokens: 100_000,
          fast_output_tokens: 50_000,
          fast_cached_tokens: 25_000,
          fast_cache_write_tokens: 25_000,
          success_rate: 100,
          recent_requests: [],
        },
      ],
    },
  ];
  const expectedCost = calculateMonitorAggregateCost('gpt-5.6', 200_000, 100_000, 50_000, 50_000, {
    inputTokens: 100_000,
    outputTokens: 50_000,
    cachedTokens: 25_000,
    cacheWriteTokens: 25_000,
  });

  assert.deepEqual(buildMonitorChannelDistributionItems(items, {}, 'cost'), [
    { label: 'code***-key', tokens: 300_000, cost: expectedCost },
  ]);
  assert.deepEqual(buildMonitorModelDistributionItems(items, 'cost'), [
    { label: 'gpt-5.6', tokens: 300_000, cost: expectedCost },
  ]);
});

test('渠道和模型用量分布对 Claude 非缓存输入口径补回缓存 token 与费用', () => {
  // Claude 系 input_tokens 不含缓存：总输入应为 10_000 + 190_000
  const items = [
    {
      source: 'claude-key',
      total_requests: 1,
      success_requests: 1,
      failed_requests: 0,
      input_tokens: 10_000,
      output_tokens: 100_000,
      cached_tokens: 150_000,
      cache_write_tokens: 40_000,
      success_rate: 100,
      recent_requests: [],
      models: [
        {
          model: 'claude-sonnet-4-6',
          requests: 1,
          success: 1,
          failed: 0,
          input_tokens: 10_000,
          output_tokens: 100_000,
          cached_tokens: 150_000,
          cache_write_tokens: 40_000,
          success_rate: 100,
          recent_requests: [],
        },
      ],
    },
  ];

  const expectedCost = calculateModelCost('claude-sonnet-4-6', 200_000, 100_000, 150_000, 40_000, {
    applyLongContextTier: false,
  });
  assert.deepEqual(buildMonitorChannelDistributionItems(items, {}, 'cost'), [
    { label: 'clau***-key', tokens: 300_000, cost: expectedCost },
  ]);
  assert.deepEqual(buildMonitorModelDistributionItems(items, 'cost'), [
    { label: 'claude-sonnet-4-6', tokens: 300_000, cost: expectedCost },
  ]);
});
