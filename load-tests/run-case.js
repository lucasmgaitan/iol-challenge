import { check, sleep } from 'k6';
import http from 'k6/http';
import { Counter } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const COLOR_ENABLED = __ENV.COLOR === 'true';
const testCase = JSON.parse(open(__ENV.CASE_FILE));
const clients = testCase.clients;
const expectations = testCase.expect || {};
const clientExpectations = expectations.clients || {};
const hasRedisOutage = Boolean(testCase.redis_outage);

const Pattern = {
  Constant: 'constant',
  Burst: 'burst',
  Spike: 'spike',
};

const Header = {
  ForwardedFor: 'X-Forwarded-For',
  RetryAfter: 'Retry-After',
  Remaining: 'X-Ratelimit-Remaining',
  Upstream: 'X-Upstream',
};

const Status = {
  Ok: 200,
  TooManyRequests: 429,
};

const Metric = {
  Requests: 'http_reqs',
  FailOpen: 'fail_open',
  Duration: 'http_req_duration',
  Failed: 'http_req_failed',
  Checks: 'checks',
};

const Check = {
  RetryAfter: '429 responses carry Retry-After',
  RateLimitHeaders: '200 responses carry rate limit headers',
  Replicas: 'requests are spread across enough API replicas',
};

const Color = {
  Green: '32',
  Red: '31',
  Yellow: '33',
  Dim: '2',
  Bold: '1',
};

const CLIENT_NETWORK = '198.51.100.';
const FIRST_CLIENT_HOST = 10;
const DISTRIBUTION_CLIENT_IP = '198.51.100.250';
const DISTRIBUTION_REQUESTS = 30;
const SECONDS_PER_UNIT = { ms: 0.001, s: 1, m: 60 };
const DURATION_PATTERN = /^(\d+(?:\.\d+)?)(ms|s|m)$/;
const ALWAYS_TRUE_COUNT = 'count>=0';
const NOT_EXPECTED = '—';

const failOpen = new Counter(Metric.FailOpen);

http.setResponseCallback(http.expectedStatuses(Status.Ok, Status.TooManyRequests));

function seconds(duration) {
  const match = DURATION_PATTERN.exec(String(duration));
  if (!match) throw new Error(`invalid duration "${String(duration)}", use e.g. 500ms, 10s or 1m`);
  return Number(match[1]) * SECONDS_PER_UNIT[match[2]];
}

function clientIp(index) {
  return `${CLIENT_NETWORK}${String(FIRST_CLIENT_HOST + index)}`;
}

function constantRate(rate) {
  if (Number.isInteger(rate)) return { rate, timeUnit: '1s' };
  return { rate: 1, timeUnit: `${String(Math.round(1000 / rate))}ms` };
}

function scenarioFor(client, index) {
  const { pattern } = client;
  const base = { env: { CLIENT_INDEX: String(index) } };
  switch (pattern.type) {
    case Pattern.Constant:
      return {
        ...base,
        executor: 'constant-arrival-rate',
        ...constantRate(pattern.rate),
        duration: testCase.duration,
        preAllocatedVUs: Math.max(1, Math.ceil(pattern.rate)),
        exec: 'constantTraffic',
      };
    case Pattern.Burst:
      return {
        ...base,
        executor: 'per-vu-iterations',
        vus: 1,
        iterations: Math.ceil(seconds(testCase.duration) / seconds(pattern.every)),
        maxDuration: `${String(seconds(testCase.duration) + seconds(pattern.every))}s`,
        exec: 'burstTraffic',
      };
    case Pattern.Spike:
      return {
        ...base,
        executor: 'per-vu-iterations',
        vus: 1,
        iterations: 1,
        startTime: pattern.at,
        exec: 'spikeTraffic',
      };
    default:
      throw new Error(`unknown pattern "${String(pattern.type)}" for client "${client.name}"`);
  }
}

function countThresholds(expected) {
  if (expected === undefined) return [ALWAYS_TRUE_COUNT];
  if (Array.isArray(expected)) {
    return [`count>=${String(expected[0])}`, `count<=${String(expected[1])}`];
  }
  return [`count==${String(expected)}`];
}

const submetric = {
  requests: (name) => `${Metric.Requests}{scenario:${name}}`,
  allowed: (name) => `${Metric.Requests}{scenario:${name},status:${String(Status.Ok)}}`,
  rejected: (name) =>
    `${Metric.Requests}{scenario:${name},status:${String(Status.TooManyRequests)}}`,
  failOpen: (name) => `${Metric.FailOpen}{scenario:${name}}`,
};

function buildThresholds() {
  const thresholds = {
    [Metric.Checks]: ['rate==1'],
    [Metric.Failed]: ['rate==0'],
    [Metric.Duration]: expectations.latency_p95_ms
      ? [`p(95)<${String(expectations.latency_p95_ms)}`]
      : ['p(95)>=0'],
  };
  for (const { name } of clients) {
    const expected = clientExpectations[name] || {};
    thresholds[submetric.requests(name)] = [ALWAYS_TRUE_COUNT];
    thresholds[submetric.allowed(name)] = countThresholds(expected.allowed);
    thresholds[submetric.rejected(name)] = countThresholds(expected.rejected);
    thresholds[submetric.failOpen(name)] = [ALWAYS_TRUE_COUNT];
  }
  return thresholds;
}

export const options = {
  scenarios: Object.fromEntries(
    clients.map((client, index) => [client.name, scenarioFor(client, index)]),
  ),
  thresholds: buildThresholds(),
};

function currentClient() {
  const index = Number(__ENV.CLIENT_INDEX);
  return { ...clients[index], ip: clientIp(index) };
}

function requestFor(client, ip) {
  return {
    method: 'GET',
    url: `${BASE_URL}${client.endpoint}`,
    params: { headers: { [Header.ForwardedFor]: ip } },
  };
}

function record(response) {
  const hasRateLimitHeaders = response.headers[Header.Remaining] !== undefined;
  check(response, {
    [Check.RetryAfter]: (r) =>
      r.status !== Status.TooManyRequests || r.headers[Header.RetryAfter] !== undefined,
    [Check.RateLimitHeaders]: (r) =>
      r.status !== Status.Ok || hasRedisOutage || hasRateLimitHeaders,
  });
  if (response.status === Status.Ok && !hasRateLimitHeaders) failOpen.add(1);
  return response;
}

function send(client, size) {
  const request = requestFor(client, client.ip);
  http.batch(Array.from({ length: size }, () => request)).forEach(record);
}

export function setup() {
  if (!expectations.min_replicas) return {};
  const upstreams = new Set();
  const request = requestFor(clients[0], DISTRIBUTION_CLIENT_IP);
  for (let attempt = 0; attempt < DISTRIBUTION_REQUESTS; attempt++) {
    upstreams.add(
      http.request(request.method, request.url, null, request.params).headers[Header.Upstream],
    );
  }
  check(upstreams, { [Check.Replicas]: (seen) => seen.size >= expectations.min_replicas });
  return { replicas: upstreams.size };
}

export function constantTraffic() {
  const client = currentClient();
  const { method, url, params } = requestFor(client, client.ip);
  record(http.request(method, url, null, params));
}

export function burstTraffic() {
  const client = currentClient();
  send(client, client.pattern.size);
  sleep(seconds(client.pattern.every));
}

export function spikeTraffic() {
  const client = currentClient();
  send(client, client.pattern.size);
}

function paint(color, text) {
  return COLOR_ENABLED ? `\u001b[${color}m${text}\u001b[0m` : text;
}

function describePattern({ type, rate, size, every, at }) {
  if (type === Pattern.Constant) return `constant ${String(rate)}/s`;
  if (type === Pattern.Burst) return `burst ${String(size)} every ${String(every)}`;
  return `spike ${String(size)} at ${String(at)}`;
}

function describeExpected(expected) {
  const parts = [];
  const format = (value) =>
    Array.isArray(value) ? `${String(value[0])}..${String(value[1])}` : String(value);
  if (expected.allowed !== undefined) parts.push(`allowed ${format(expected.allowed)}`);
  if (expected.rejected !== undefined) parts.push(`rejected ${format(expected.rejected)}`);
  return parts.length ? parts.join(', ') : NOT_EXPECTED;
}

function verdict(passed, applies = true) {
  if (!applies) return paint(Color.Dim, NOT_EXPECTED);
  return passed ? paint(Color.Green, '✓') : paint(Color.Red, '✗');
}

export function handleSummary(data) {
  const metric = (name) => data.metrics[name];
  const count = (name) => (metric(name) ? metric(name).values.count : 0);
  const passed = (name) =>
    !metric(name) ||
    Object.values(metric(name).thresholds || {}).every((threshold) => threshold.ok);

  const columns = [
    'CLIENT',
    'ENDPOINT',
    'PATTERN',
    'REQUESTS',
    'ALLOWED',
    'REJECTED',
    'FAIL-OPEN',
    'EXPECTED',
    'RESULT',
  ];
  const rows = clients.map(({ name, endpoint, pattern }) => {
    const expected = clientExpectations[name] || {};
    const clientPassed = passed(submetric.allowed(name)) && passed(submetric.rejected(name));
    return [
      name,
      endpoint,
      describePattern(pattern),
      String(count(submetric.requests(name))),
      String(count(submetric.allowed(name))),
      String(count(submetric.rejected(name))),
      String(count(submetric.failOpen(name))),
      describeExpected(expected),
      verdict(clientPassed, Boolean(clientExpectations[name])),
    ];
  });
  const widths = columns.map((column, index) =>
    Math.max(column.length, ...rows.map((row) => row[index].length)),
  );
  const line = (cells) => `  ${cells.map((cell, index) => cell.padEnd(widths[index])).join('  ')}`;

  const checks = metric(Metric.Checks);
  const p95 = metric(Metric.Duration).values['p(95)'];
  const allPassed = Object.values(data.metrics).every(
    (entry) =>
      !entry.thresholds || Object.values(entry.thresholds).every((threshold) => threshold.ok),
  );
  const footer = [
    `${verdict(passed(Metric.Checks) && passed(Metric.Failed))} HTTP contract: ${checks ? (checks.values.rate * 100).toFixed(1) : '100.0'}% of checks passed, ${(metric(Metric.Failed).values.rate * 100).toFixed(1)}% unexpected statuses`,
    `${verdict(passed(Metric.Duration), Boolean(expectations.latency_p95_ms))} Latency p95 ${p95.toFixed(1)} ms${expectations.latency_p95_ms ? ` (expected < ${String(expectations.latency_p95_ms)} ms)` : ''}`,
  ];
  if (data.setup_data && data.setup_data.replicas !== undefined) {
    footer.push(
      `${verdict(data.setup_data.replicas >= expectations.min_replicas)} Replicas that served traffic: ${String(data.setup_data.replicas)} (expected >= ${String(expectations.min_replicas)})`,
    );
  }

  const output = [
    '',
    paint(Color.Bold, line(columns)),
    ...rows.map(line),
    '',
    ...footer.map((text) => `  ${text}`),
    '',
    allPassed
      ? paint(Color.Green, `✓ Case "${testCase.name}" passed`)
      : paint(Color.Red, `✗ Case "${testCase.name}" failed`),
    '',
  ];
  return { stdout: output.join('\n') };
}
