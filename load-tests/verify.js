import { check, sleep } from 'k6';
import http from 'k6/http';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

const Endpoint = {
  TokenBucket: '/hello',
  SlidingWindow: '/hello-window',
};

const Client = {
  Steady: '198.51.100.10',
  Greedy: '198.51.100.11',
  Bursty: '198.51.100.12',
  GreedyWindow: '198.51.100.13',
  Distribution: '198.51.100.14',
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

const DURATION = '30s';
const GREEDY_RATE_PER_SECOND = 10;
const BURST_SIZE = 8;
const BURSTS = 3;
const BURST_INTERVAL_S = 10;
const DISTRIBUTION_REQUESTS = 30;
const MIN_REPLICAS = 2;

http.setResponseCallback(http.expectedStatuses(Status.Ok, Status.TooManyRequests));

const constantRate = (rate, exec) => ({
  executor: 'constant-arrival-rate',
  rate,
  timeUnit: '1s',
  duration: DURATION,
  preAllocatedVUs: rate,
  exec,
});

export const options = {
  scenarios: {
    steady: constantRate(1, 'steady'),
    greedy: constantRate(GREEDY_RATE_PER_SECOND, 'greedy'),
    bursty: { executor: 'per-vu-iterations', vus: 1, iterations: BURSTS, exec: 'bursty' },
    greedyWindow: constantRate(GREEDY_RATE_PER_SECOND, 'greedyWindow'),
  },
  thresholds: {
    'http_reqs{scenario:steady,status:429}': ['count==0'],
    // capacity 5 + 1 token/s refilled during the 30 s run, minus/plus 2 for request timing
    'http_reqs{scenario:greedy,status:200}': ['count>=33', 'count<=37'],
    // each burst finds a full bucket after 10 s idle: 5 allowed and 3 rejected, 3 times
    'http_reqs{scenario:bursty,status:200}': ['count==15'],
    'http_reqs{scenario:bursty,status:429}': ['count==9'],
    // first window 5; then c + 1 <= 5 - n(1 - e/W) settles at n = 4 per window (rejections are not counted)
    // 5 + 4 x 5 full windows + 1..4 in the last partial window = 26..29, plus/minus 1 for request timing
    'http_reqs{scenario:greedyWindow,status:200}': ['count>=25', 'count<=30'],
    http_req_failed: ['rate==0'],
    checks: ['rate==1'],
    http_req_duration: ['p(95)<50'],
  },
};

function hello(endpoint, client) {
  const response = http.get(`${BASE_URL}${endpoint}`, {
    headers: { [Header.ForwardedFor]: client },
  });
  check(response, {
    '429 responses carry Retry-After': (r) =>
      r.status !== Status.TooManyRequests || r.headers[Header.RetryAfter] !== undefined,
    '200 responses carry rate limit headers': (r) =>
      r.status !== Status.Ok || r.headers[Header.Remaining] !== undefined,
  });
  return response;
}

export function setup() {
  const upstreams = new Set();
  for (let request = 0; request < DISTRIBUTION_REQUESTS; request++) {
    upstreams.add(hello(Endpoint.TokenBucket, Client.Distribution).headers[Header.Upstream]);
  }
  check(upstreams, {
    'requests are spread across several API replicas': (seen) => seen.size >= MIN_REPLICAS,
  });
}

export function steady() {
  hello(Endpoint.TokenBucket, Client.Steady);
}

export function greedy() {
  hello(Endpoint.TokenBucket, Client.Greedy);
}

export function greedyWindow() {
  hello(Endpoint.SlidingWindow, Client.GreedyWindow);
}

export function bursty() {
  const request = {
    method: 'GET',
    url: `${BASE_URL}${Endpoint.TokenBucket}`,
    params: { headers: { [Header.ForwardedFor]: Client.Bursty } },
  };
  http.batch(Array.from({ length: BURST_SIZE }, () => request));
  sleep(BURST_INTERVAL_S);
}
